import { readFileSync, appendFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { SOURCES, type Source, type WatchBoard } from "../types.js";

const WatchSchema = z.object({
  boards: z.array(
    z.object({
      source: z.enum(SOURCES),
      token: z.string().regex(/^[A-Za-z0-9._-]+$/),
      company: z.string().min(1),
    }),
  ),
});

export function loadWatchlist(filePath: string): WatchBoard[] {
  const parsed = WatchSchema.parse(parseYaml(readFileSync(filePath, "utf8")));
  return parsed.boards;
}

export function companyFor(boards: WatchBoard[], source: Source, token: string): string {
  return boards.find((board) => board.source === source && board.token === token)?.company ?? token;
}

export function appendBoard(filePath: string, board: WatchBoard): void {
  const safe = WatchSchema.parse({ boards: [board] }).boards[0];
  if (!safe) throw new Error("Invalid board");
  const company = /[^A-Za-z0-9 .&'+-]/.test(safe.company) ? JSON.stringify(safe.company) : safe.company;
  appendFileSync(filePath, `\n  - source: ${safe.source}\n    token: ${safe.token}\n    company: ${company}\n`);
}
