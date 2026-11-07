export interface Evidence {
  requirement: string;
  factIds: string[];
  relation: "supports" | "partial" | "gap";
  detail: string;
}

export interface JobCard {
  rank: number;
  job: {
    id: string;
    company: string;
    title: string;
    location: string;
    workplaceType: string;
    url: string;
    source: string;
    firstSeenAt: string;
    eligibility: { roleFamilies: string[]; reasons: string[]; exclusions: string[] } | null;
  };
  fit: { score: number; summary: string; evidence: Evidence[]; roleFamilies: string[] };
  stage: string | null;
  packet: { contentHash: string; approved: boolean } | null;
}

export interface Packet {
  jobId: string;
  company: string;
  title: string;
  url: string;
  contentHash: string;
  coverLetter: string;
  bullets: string[];
  fields: { key: string; label: string; value: string | null; factIds: string[]; source: string; notes: string | null }[];
  answers: { question: string; value: string | null; disposition: string; reason: string | null; factIds: string[] }[];
  review: { passed: boolean; removed: { text: string; reason: string }[]; injections: string[]; notes: string[] };
  approval: null | { token: string; contentHash: string; approvedAt: string; approver: string };
}

export interface Overview {
  jobs: { total: number; eligible: number };
  agentCounts: { scout: number; matcher: number; tailor: number; reviewer: number };
  approved: number;
  awaitingApproval: number;
  blocked: number;
  timezone: string;
  dailyAt: string;
  llm: string;
  latestScout: { startedAt: string; stats: { fetched?: number; eligible?: number; failedBoards?: unknown[] } } | null;
}

export interface TrackerEvent {
  id: number;
  jobId: string | null;
  status: string;
  note: string;
  createdAt: string;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
