import type { NormalizedJob, Source, WatchBoard, Workplace } from "../types.js";
import { htmlToText } from "../util/text.js";

interface GreenhouseJob {
  id: number | string;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  departments?: { name?: string }[];
}

interface AshbyJob {
  id: string;
  title?: string;
  location?: string;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  department?: string;
  team?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  compensationTierSummary?: string;
  publishedAt?: string;
}

interface LeverJob {
  id: string;
  text?: string;
  categories?: { location?: string; department?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string | null;
}

function cap(text: string): string {
  return text.slice(0, 16000);
}

function workplaceFromSource(value: string | null | undefined): Workplace | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (text.includes("hybrid")) return "hybrid";
  if (text.includes("remote")) return "remote";
  if (text.includes("on-site") || text.includes("onsite") || text.includes("on site")) return "onsite";
  return null;
}

export function normalizeGreenhouse(job: GreenhouseJob, board: WatchBoard): NormalizedJob {
  const location = job.location?.name ?? "";
  const contentText = cap(htmlToText(job.content ?? ""));
  return {
    id: `greenhouse:${board.token}:${job.id}`,
    source: "greenhouse",
    board: board.token,
    externalId: String(job.id),
    company: board.company,
    title: (job.title ?? "").replace(/\s+/g, " ").trim(),
    location,
    workplaceType: "unknown",
    workplaceNote: null,
    url: job.absolute_url ?? "",
    applyUrl: job.absolute_url ?? "",
    contentText,
    departments: (job.departments ?? []).map((item) => item.name ?? "").filter(Boolean),
    compensation: null,
    updatedAt: job.updated_at ?? null,
    isRemoteFlag: null,
    sourceWorkplace: null,
  };
}

export function normalizeAshby(job: AshbyJob, board: WatchBoard): NormalizedJob {
  const location = job.location ?? "";
  const contentText = cap(htmlToText(job.descriptionPlain || job.descriptionHtml || ""));
  const sourceWorkplace = job.workplaceType ?? null;
  let workplaceNote: string | null = null;
  let workplace = workplaceFromSource(sourceWorkplace) ?? "unknown";
  if (job.isRemote === true && !sourceWorkplace) {
    workplace = "remote";
    workplaceNote = "Ashby isRemote can mean remote or hybrid; treated as remote-or-hybrid.";
  }
  if (job.isRemote === true && workplace === "hybrid") {
    workplaceNote = "Ashby isRemote is true and workplaceType is Hybrid, so this is hybrid, not fully remote.";
  }
  return {
    id: `ashby:${board.token}:${job.id}`,
    source: "ashby",
    board: board.token,
    externalId: job.id,
    company: board.company,
    title: (job.title ?? "").replace(/\s+/g, " ").trim(),
    location,
    workplaceType: workplace,
    workplaceNote,
    url: job.jobUrl ?? job.applyUrl ?? "",
    applyUrl: job.applyUrl ?? job.jobUrl ?? "",
    contentText,
    departments: [job.department, job.team].filter((item): item is string => Boolean(item)),
    compensation: job.compensationTierSummary ?? null,
    updatedAt: job.publishedAt ?? null,
    isRemoteFlag: job.isRemote ?? null,
    sourceWorkplace,
  };
}

export function normalizeLever(job: LeverJob, board: WatchBoard): NormalizedJob {
  const location = job.categories?.location ?? "";
  const listText = (job.lists ?? [])
    .map((list) => `${list.text ?? ""} ${htmlToText(list.content ?? "")}`)
    .join("\n");
  const contentText = cap(htmlToText(`${job.descriptionPlain ?? ""} ${job.description ?? ""} ${listText}`));
  const sourceWorkplace = job.workplaceType ?? null;
  return {
    id: `lever:${board.token}:${job.id}`,
    source: "lever",
    board: board.token,
    externalId: job.id,
    company: board.company,
    title: (job.text ?? "").replace(/\s+/g, " ").trim(),
    location,
    workplaceType: workplaceFromSource(sourceWorkplace) ?? "unknown",
    workplaceNote: null,
    url: job.hostedUrl ?? "",
    applyUrl: job.applyUrl ?? job.hostedUrl ?? "",
    contentText,
    departments: [job.categories?.department, job.categories?.team].filter((item): item is string => Boolean(item)),
    compensation: null,
    updatedAt: null,
    isRemoteFlag: null,
    sourceWorkplace,
  };
}

export function normalizeRecorded(
  record: { source: Source; board: string; raw: unknown },
  company: string,
): NormalizedJob {
  const board: WatchBoard = { source: record.source, token: record.board, company };
  if (record.source === "greenhouse") return normalizeGreenhouse(record.raw as GreenhouseJob, board);
  if (record.source === "ashby") return normalizeAshby(record.raw as AshbyJob, board);
  return normalizeLever(record.raw as LeverJob, board);
}
