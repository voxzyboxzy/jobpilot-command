import type { NormalizedJob, WatchBoard } from "../types.js";
import { normalizeAshby, normalizeGreenhouse, normalizeLever } from "./normalize.js";

const USER_AGENT = "jobpilot-command/1.0 (personal job search; public ATS boards)";

export interface FetchResult {
  board: WatchBoard;
  jobs: NormalizedJob[];
  error?: string;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchBoard(board: WatchBoard, timeoutMs = 45000): Promise<NormalizedJob[]> {
  if (board.source === "greenhouse") {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`;
    const body = (await fetchJson(url, timeoutMs)) as { jobs?: unknown[] };
    return (body.jobs ?? []).map((job) => normalizeGreenhouse(job as never, board));
  }
  if (board.source === "ashby") {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`;
    const body = (await fetchJson(url, timeoutMs)) as { jobs?: unknown[] };
    return (body.jobs ?? []).map((job) => normalizeAshby(job as never, board));
  }
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`;
  const body = (await fetchJson(url, timeoutMs)) as unknown[];
  if (!Array.isArray(body)) throw new Error("Lever response was not a list");
  return body.map((job) => normalizeLever(job as never, board));
}

export async function fetchBoards(
  boards: WatchBoard[],
  options: { concurrency?: number; timeoutMs?: number; onBoard?: (result: FetchResult) => void } = {},
): Promise<FetchResult[]> {
  const concurrency = options.concurrency ?? 4;
  const results: FetchResult[] = new Array(boards.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < boards.length) {
      const current = index;
      index += 1;
      const board = boards[current];
      if (!board) continue;
      try {
        const jobs = await fetchBoard(board, options.timeoutMs);
        const result = { board, jobs };
        results[current] = result;
        options.onBoard?.(result);
      } catch (error) {
        const result = { board, jobs: [], error: error instanceof Error ? error.message : String(error) };
        results[current] = result;
        options.onBoard?.(result);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, () => worker()));
  return results;
}

export function boardProbeUrl(board: WatchBoard): string {
  if (board.source === "greenhouse") {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=false`;
  }
  if (board.source === "ashby") {
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}`;
  }
  return `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`;
}
