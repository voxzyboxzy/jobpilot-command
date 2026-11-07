import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { CandidateFile } from "../candidate/facts.js";
import type { NormalizedJob } from "../types.js";
import { factsHash } from "../candidate/facts.js";
import { Store, type StoredJob } from "../db/store.js";
import { assessEligibility } from "../filters/eligibility.js";
import { sha256File, grantApproval, invalidateIfEdited, packetHash } from "../packet/approval.js";
import { normalizeRecorded } from "../sources/normalize.js";
import { fetchBoards } from "../sources/fetch.js";
import { companyFor, loadWatchlist } from "../sources/watchlist.js";
import type { PacketBody, RoleFamily, Source, StoredPacket, WatchBoard } from "../types.js";
import { PipelineMachine } from "./machine.js";
import { scoreJob } from "./matcher.js";
import { reviewDraft, stripUnsupported } from "./reviewer.js";
import { tailor, templateSentences } from "./tailor.js";

function nowIso(): string {
  return new Date().toISOString();
}

function advance(store: Store, jobId: string, to: Parameters<PipelineMachine["transition"]>[0], actor: string, note: string): void {
  const at = nowIso();
  const current = store.getPipeline(jobId);
  const machine = current ? new PipelineMachine(current.stage, current.history) : PipelineMachine.start(at);
  if (machine.stage === "discovered" && current === null) {
    store.savePipeline({ jobId, stage: machine.stage, history: machine.history, updatedAt: at });
  }
  if (machine.stage === to) return;
  machine.transition(to, actor, note, at);
  store.savePipeline({ jobId, stage: machine.stage, history: machine.history, updatedAt: at });
}

export function applyEligibility(store: Store, families: RoleFamily[]): { eligible: number; ineligible: number } {
  let eligible = 0;
  let ineligible = 0;
  for (const job of store.listJobs()) {
    const decision = assessEligibility(job, { families });
    const previous = job.eligible;
    store.saveEligibility(job.id, decision);
    const existing = store.getPipeline(job.id);
    if (!existing) {
      const at = nowIso();
      const machine = PipelineMachine.start(at);
      machine.transition(decision.eligible ? "eligible" : "ineligible", "scout", decision.eligible ? "Passed filters." : decision.exclusions.join(" "), at);
      store.savePipeline({ jobId: job.id, stage: machine.stage, history: machine.history, updatedAt: at });
    } else if (previous === false && decision.eligible && existing.stage === "ineligible") {
      advance(store, job.id, "eligible", "scout", "Filters now pass.");
    } else if (previous === true && !decision.eligible && existing.stage === "eligible") {
      advance(store, job.id, "ineligible", "scout", decision.exclusions.join(" "));
    }
    if (decision.eligible) eligible += 1;
    else ineligible += 1;
  }
  return { eligible, ineligible };
}

export async function scoutLive(store: Store, boards: WatchBoard[], families: RoleFamily[]): Promise<Record<string, unknown>> {
  const started = nowIso();
  const runId = randomUUID();
  store.startRun(runId, "scout", started);
  const seenAt = nowIso();
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  const failedBoards: { source: string; token: string; error: string }[] = [];
  await fetchBoards(boards, {
    concurrency: 4,
    onBoard: (result) => {
      if (result.error) {
        failedBoards.push({ source: result.board.source, token: result.board.token, error: result.error });
        process.stderr.write(`fail ${result.board.source}:${result.board.token} ${result.error}\n`);
        return;
      }
      const upsert = store.upsertJobs(result.jobs, seenAt);
      fetched += result.jobs.length;
      inserted += upsert.inserted;
      updated += upsert.updated;
      process.stderr.write(`ok ${result.board.source}:${result.board.token} ${result.jobs.length}\n`);
    },
  });
  const filters = applyEligibility(store, families);
  const stats = {
    boards: boards.length,
    failedBoards,
    fetched,
    inserted,
    updated,
    ...filters,
  };
  store.finishRun(runId, nowIso(), stats);
  store.track(null, "scout", `Fetched ${fetched} postings from ${boards.length} boards.`, stats, nowIso());
  return stats;
}

export function ingestFixture(store: Store, fixturePath: string, watchlistPath: string, families: RoleFamily[]): Record<string, unknown> {
  const boards = loadWatchlist(watchlistPath);
  const records = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    source: Source;
    board: string;
    raw: unknown;
  }[];
  const seenAt = nowIso();
  const jobs = records.map((record) => normalizeRecorded(record, companyFor(boards, record.source, record.board)));
  const upsert = store.upsertJobs(jobs, seenAt);
  const filters = applyEligibility(store, families);
  const stats = { fixturePath, fetched: jobs.length, ...upsert, ...filters };
  store.track(null, "scout", `Ingested ${jobs.length} recorded postings.`, stats, nowIso());
  return stats;
}

export function scoreAll(store: Store, candidate: CandidateFile): { scored: number } {
  const hash = factsHash(candidate);
  const at = nowIso();
  let scored = 0;
  for (const job of store.listJobs({ eligible: true })) {
    const families = job.eligibility?.roleFamilies ?? [];
    const fit = scoreJob(job, candidate, families);
    store.saveScore(job.id, fit, hash, at);
    const stage = store.getPipeline(job.id)?.stage;
    if (stage === "eligible") advance(store, job.id, "ranked", "matcher", `Score ${fit.score}.`);
    scored += 1;
  }
  return { scored };
}

export async function buildPacket(store: Store, job: StoredJob, candidate: CandidateFile, resumePath: string): Promise<StoredPacket> {
  const fit = store.getScore(job.id);
  if (!fit) throw new Error(`Job ${job.id} has not been scored.`);
  const draft = tailor(job, candidate);
  const review = reviewDraft(draft, candidate, job.contentText, templateSentences(job, candidate));
  const coverLetter = review.passed ? draft.coverLetter : stripUnsupported(draft.coverLetter, review.removed);
  const body: PacketBody = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    applyUrl: job.applyUrl,
    fields: draft.fields.map((field) => (field.key === "cover_letter" ? { ...field, value: coverLetter } : field)),
    answers: draft.answers,
    bullets: draft.bullets,
    coverLetter,
    attachments: [
      {
        name: "resume.pdf",
        path: resumePath,
        sha256: await sha256File(resumePath),
      },
    ],
    review,
  };
  const at = nowIso();
  const stored: StoredPacket = { ...body, contentHash: packetHash(body), approval: null, updatedAt: at };
  const existing = store.getPacket(job.id);
  if (existing && existing.contentHash === stored.contentHash && existing.approval) {
    stored.approval = existing.approval;
    stored.updatedAt = existing.updatedAt;
  }
  const stage = store.getPipeline(job.id)?.stage;
  if (stage === "ranked") advance(store, job.id, "tailored", "tailor", "Drafted packet from candidate facts.");
  const afterTailor = store.getPipeline(job.id)?.stage;
  if (afterTailor === "tailored") advance(store, job.id, "reviewed", "reviewer", review.passed ? "No unsupported claims." : "Unsupported claims removed or flagged.");
  const afterReview = store.getPipeline(job.id)?.stage;
  if (afterReview === "reviewed") {
    advance(store, job.id, review.passed ? "awaiting_approval" : "blocked", "reviewer", review.passed ? "Waiting for a person." : "Blocked until claims are clean.");
  }
  if (store.getPipeline(job.id)?.stage === "approved") {
    advance(store, job.id, "awaiting_approval", "reviewer", "Packet rebuilt, so the old approval is void.");
  }
  store.savePacket(stored);
  store.track(job.id, "packet", `Packet ${stored.contentHash.slice(0, 12)} awaiting approval.`, { score: fit.fit.score }, at);
  return stored;
}

export function approve(store: Store, jobId: string, approver: string): StoredPacket {
  const packet = store.getPacket(jobId);
  if (!packet) throw new Error(`No packet for ${jobId}`);
  const stage = store.getPipeline(jobId)?.stage;
  if (stage !== "awaiting_approval" && stage !== "approved") {
    throw new Error(`Cannot approve from stage ${stage ?? "missing"}`);
  }
  const approved = grantApproval(store.approvalSecret(), packet, approver, nowIso());
  store.savePacket(approved);
  if (stage === "awaiting_approval") advance(store, jobId, "approved", approver, "Human approved this exact packet hash.");
  store.track(jobId, "approved", `Approved ${approved.contentHash.slice(0, 12)}.`, { approver }, nowIso());
  return approved;
}

export function editPacketField(store: Store, jobId: string, key: string, value: string, candidate: CandidateFile): StoredPacket {
  const packet = store.getPacket(jobId);
  if (!packet) throw new Error(`No packet for ${jobId}`);
  const job = store.getJob(jobId);
  const fields = packet.fields.map((field) =>
    field.key === key ? { ...field, value, source: "human-edit" as const, factIds: [] } : field,
  );
  const coverLetter = key === "cover_letter" ? value : packet.coverLetter;
  const stub = job ?? stubJob(packet);
  const review = reviewDraft(
    { coverLetter, bullets: packet.bullets, answers: packet.answers, fields },
    candidate,
    stub.contentText,
    templateSentences(stub, candidate),
  );
  const next: StoredPacket = invalidateIfEdited(
    { ...packet, fields, coverLetter, review, answers: packet.answers },
    nowIso(),
  );
  store.savePacket(next);
  const stage = store.getPipeline(jobId)?.stage;
  if (stage === "approved") advance(store, jobId, "awaiting_approval", "human", "Edit invalidated approval.");
  store.track(jobId, "edited", `Edited ${key}. Approval cleared.`, { passed: review.passed }, nowIso());
  return next;
}

function stubJob(packet: StoredPacket): NormalizedJob {
  return {
    id: packet.jobId,
    source: "greenhouse",
    board: "",
    externalId: "",
    company: packet.company,
    title: packet.title,
    location: "",
    workplaceType: "remote",
    workplaceNote: null,
    url: packet.url,
    applyUrl: packet.applyUrl,
    contentText: "",
    departments: [],
    compensation: null,
    updatedAt: null,
    isRemoteFlag: null,
    sourceWorkplace: null,
  };
}

export async function prepareTopPackets(
  store: Store,
  candidate: CandidateFile,
  resumePath: string,
  limit: number,
): Promise<StoredPacket[]> {
  const top = store.topScores(limit);
  const packets: StoredPacket[] = [];
  for (const item of top) {
    packets.push(await buildPacket(store, item.job, candidate, resumePath));
  }
  return packets;
}
