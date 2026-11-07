export const SOURCES = ["greenhouse", "ashby", "lever"] as const;
export type Source = (typeof SOURCES)[number];

export const ROLE_FAMILIES = [
  "entry-software",
  "qa",
  "automation-ai",
  "it-support",
  "data",
  "spanish-bilingual",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

export const WORKPLACES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type Workplace = (typeof WORKPLACES)[number];

export interface WatchBoard {
  source: Source;
  token: string;
  company: string;
}

export interface NormalizedJob {
  id: string;
  source: Source;
  board: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  workplaceType: Workplace;
  workplaceNote: string | null;
  url: string;
  applyUrl: string;
  contentText: string;
  departments: string[];
  compensation: string | null;
  updatedAt: string | null;
  isRemoteFlag: boolean | null;
  sourceWorkplace: string | null;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  roleFamilies: RoleFamily[];
  workplace: Workplace;
  locationOk: boolean;
  exclusions: string[];
}

export type EvidenceRelation = "supports" | "partial" | "gap";

export interface EvidenceItem {
  requirement: string;
  factIds: string[];
  relation: EvidenceRelation;
  detail: string;
}

export interface FitResult {
  jobId: string;
  score: number;
  roleFamilies: RoleFamily[];
  evidence: EvidenceItem[];
  summary: string;
}

export interface PacketField {
  key: string;
  label: string;
  value: string | null;
  factIds: string[];
  source: "fact" | "template" | "human-required" | "human-edit";
  notes: string | null;
}

export interface PacketAnswer {
  question: string;
  value: string | null;
  factIds: string[];
  disposition: "answered" | "human-required" | "blank";
  reason: string | null;
}

export interface ReviewRemoval {
  text: string;
  reason: string;
}

export interface ReviewResult {
  passed: boolean;
  removed: ReviewRemoval[];
  injections: string[];
  demographicKeys: string[];
  notes: string[];
}

export interface PacketAttachment {
  name: string;
  path: string;
  sha256: string | null;
}

export interface PacketBody {
  jobId: string;
  company: string;
  title: string;
  url: string;
  applyUrl: string;
  fields: PacketField[];
  answers: PacketAnswer[];
  bullets: string[];
  coverLetter: string;
  attachments: PacketAttachment[];
  review: ReviewResult;
}

export interface StoredPacket extends PacketBody {
  contentHash: string;
  approval: null | {
    token: string;
    contentHash: string;
    approvedAt: string;
    approver: string;
  };
  updatedAt: string;
}

export const STAGES = [
  "discovered",
  "ineligible",
  "eligible",
  "ranked",
  "tailored",
  "reviewed",
  "awaiting_approval",
  "approved",
  "blocked",
  "filling",
  "stopped",
  "handoff",
  "submitted",
] as const;
export type Stage = (typeof STAGES)[number];

export interface HistoryEntry {
  from: Stage | null;
  to: Stage;
  actor: string;
  note: string;
  at: string;
}

export interface PipelineRecord {
  jobId: string;
  stage: Stage;
  history: HistoryEntry[];
  updatedAt: string;
}

export interface TrackerEvent {
  id: number;
  jobId: string | null;
  status: string;
  note: string;
  artifact: unknown;
  createdAt: string;
}

export interface FillFieldReport {
  name: string;
  action: "filled" | "uploaded" | "skipped" | "unknown" | "left-blank";
  expected: string | null;
  observed: string | null;
  ok: boolean;
}

export interface FillReport {
  jobId: string;
  url: string;
  handoff: boolean;
  handoffReasons: string[];
  stoppedBeforeSubmit: boolean;
  submitted: boolean;
  fields: FillFieldReport[];
  unknownQuestions: string[];
  demographicLeftBlank: string[];
  screenshotPath: string | null;
  capturedAt: string;
}
