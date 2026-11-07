import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCandidate } from "../src/candidate/facts.js";
import { Store } from "../src/db/store.js";
import { PipelineMachine, IllegalTransition } from "../src/agents/machine.js";
import { approve, buildPacket, editPacketField, ingestFixture, scoreAll } from "../src/agents/pipeline.js";
import { ApprovalError, assertCanSubmit } from "../src/packet/approval.js";
import { signApproval, verifyApproval } from "../src/util/hash.js";
import { nextDailyRun } from "../src/scheduler/schedule.js";
import { loadWatchlist } from "../src/sources/watchlist.js";
import { ROLE_FAMILIES } from "../src/types.js";
import { reviewDraft } from "../src/agents/reviewer.js";
import { tailor, templateSentences } from "../src/agents/tailor.js";

const root = path.resolve(".");

describe("state machine", () => {
  it("rejects illegal jumps and records history", () => {
    const machine = PipelineMachine.start("2026-11-07T12:00:00.000Z");
    expect(() => machine.transition("submitted", "tester", "no", "2026-11-07T12:00:01.000Z")).toThrow(IllegalTransition);
    machine.transition("eligible", "scout", "ok", "2026-11-07T12:00:01.000Z");
    machine.transition("ranked", "matcher", "scored", "2026-11-07T12:00:02.000Z");
    expect(machine.stage).toBe("ranked");
    expect(machine.history.map((entry) => entry.to)).toEqual(["discovered", "eligible", "ranked"]);
  });
});

describe("schedule", () => {
  it("schedules 07:30 America/New_York", () => {
    const morning = nextDailyRun(new Date("2026-11-07T12:00:00.000Z"), "America/New_York", "07:30");
    const afternoon = nextDailyRun(new Date("2026-11-07T13:30:00.000Z"), "America/New_York", "07:30");
    expect(morning.toISOString()).toBe("2026-11-07T12:30:00.000Z");
    expect(afternoon.toISOString()).toBe("2026-11-08T12:30:00.000Z");
  });
});

describe("scout dedupe", () => {
  it("keeps the first-seen date across ingests", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jobpilot-"));
    const database = path.join(dir, "jobs.db");
    const store = new Store(database);
    const fixture = path.join(root, "fixtures/recorded/jobs.json");
    const watchlist = path.join(root, "config/watchlist.yaml");
    ingestFixture(store, fixture, watchlist, [...ROLE_FAMILIES]);
    const first = store.getJob("greenhouse:instacart:8157774");
    expect(first?.firstSeenAt).toBeTruthy();
    store.db.prepare("UPDATE jobs SET first_seen_at = ? WHERE id = ?").run("2026-01-02T00:00:00.000Z", first?.id);
    ingestFixture(store, fixture, watchlist, [...ROLE_FAMILIES]);
    const second = store.getJob("greenhouse:instacart:8157774");
    expect(second?.firstSeenAt).toBe("2026-01-02T00:00:00.000Z");
    expect(second?.lastSeenAt).not.toBe("2026-01-02T00:00:00.000Z");
    const counts = store.countJobs();
    expect(counts.total).toBe(37);
    store.close();
  });
});

describe("matcher tailor reviewer approval", () => {
  it("ranks a bilingual support role above a backend-at-scale engineer", () => {
    const candidate = loadCandidate(path.join(root, "examples/candidate.example.yaml"));
    const store = new Store(path.join(mkdtempSync(path.join(tmpdir(), "jobpilot-")), "jobs.db"));
    ingestFixture(store, path.join(root, "fixtures/recorded/jobs.json"), path.join(root, "config/watchlist.yaml"), [...ROLE_FAMILIES]);
    scoreAll(store, candidate);
    const top = store.topScores(10);
    const ids = top.map((item) => item.job.id);
    expect(ids).toContain("greenhouse:instacart:8157774");
    const support = top.find((item) => item.job.id === "greenhouse:instacart:8157774");
    const engineer = store.getScore("greenhouse:affirm:8017340003");
    expect(support?.fit.evidence.some((item) => item.factIds.includes("lang-es"))).toBe(true);
    if (engineer) expect(engineer.fit.score).toBeLessThan(support?.fit.score ?? 100);
    store.close();
  });

  it("cites facts and removes an edited unsupported claim", async () => {
    const candidate = loadCandidate(path.join(root, "examples/candidate.example.yaml"));
    const dir = mkdtempSync(path.join(tmpdir(), "jobpilot-"));
    const resume = path.join(dir, "resume.pdf");
    writeFileSync(resume, readFileSync(path.join(root, "examples/Alex-Rivera-Resume.pdf")));
    const store = new Store(path.join(dir, "jobs.db"));
    ingestFixture(store, path.join(root, "fixtures/recorded/jobs.json"), path.join(root, "config/watchlist.yaml"), [...ROLE_FAMILIES]);
    scoreAll(store, candidate);
    const job = store.getJob("ashby:linear:b4df9dbe-618e-4a3b-874c-c9abf87ca5c0");
    expect(job).toBeTruthy();
    if (!job) return;
    const draft = tailor(job, candidate);
    const review = reviewDraft(draft, candidate, job.contentText, templateSentences(job, candidate));
    expect(review.passed).toBe(true);
    expect(draft.coverLetter).toContain("[fact:exp-helpdesk]");
    expect(draft.coverLetter.toLowerCase()).not.toContain("phd");
    const packet = await buildPacket(store, job, candidate, resume);
    expect(packet.fields.find((field) => field.key === "gender")?.value).toBeNull();
    const approved = approve(store, job.id, "tester");
    const edited = editPacketField(store, job.id, "cover_letter", "I have a PhD from MIT and 10 years at Google.", candidate);
    expect(edited.approval).toBeNull();
    expect(edited.review.passed).toBe(false);
    expect(store.getPipeline(job.id)?.stage).toBe("awaiting_approval");
    expect(() => assertCanSubmit(store.approvalSecret(), edited, approved.approval?.token)).toThrow(ApprovalError);
    const secret = "a".repeat(64);
    const token = signApproval(secret, "packet", "hash");
    expect(verifyApproval(secret, "packet", "hash", token)).toBe(true);
    expect(verifyApproval(secret, "packet", "other", token)).toBe(false);
    store.close();
  });
});

describe("watchlist", () => {
  it("ships at least 50 boards across all three ATS sources", () => {
    const boards = loadWatchlist(path.join(root, "config/watchlist.yaml"));
    expect(boards.length).toBeGreaterThanOrEqual(50);
    expect(new Set(boards.map((board) => board.source))).toEqual(new Set(["greenhouse", "ashby", "lever"]));
  });
});
