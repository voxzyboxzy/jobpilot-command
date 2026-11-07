import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { contentHash } from "../util/hash.js";

const FactSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum([
    "skill",
    "experience",
    "project",
    "education",
    "language",
    "authorization",
    "preference",
    "link",
    "other",
  ]),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
  start: z.string().optional(),
  end: z.string().optional(),
});

const CandidateSchema = z.object({
  version: z.literal(1),
  candidate: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    location: z.object({
      city: z.string(),
      region: z.string(),
      country: z.string(),
    }),
    headline: z.string().optional(),
  }),
  facts: z.array(FactSchema).min(1),
  resume: z.object({ path: z.string() }).optional(),
});

export type Fact = z.infer<typeof FactSchema>;
export type CandidateFile = z.infer<typeof CandidateSchema>;

export function loadCandidate(filePath: string): CandidateFile {
  const raw = readFileSync(filePath, "utf8");
  const parsed = filePath.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  return CandidateSchema.parse(parsed);
}

export function factsHash(candidate: CandidateFile): string {
  return contentHash(candidate);
}

export function factMap(candidate: CandidateFile): Map<string, Fact> {
  const map = new Map<string, Fact>();
  for (const fact of candidate.facts) {
    if (map.has(fact.id)) throw new Error(`Duplicate fact id ${fact.id}`);
    map.set(fact.id, fact);
  }
  return map;
}

export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ") || first;
  return { first, last };
}

export function hasTag(candidate: CandidateFile, tag: string): boolean {
  const needle = tag.toLowerCase();
  return candidate.facts.some((fact) => fact.tags.some((item) => item.toLowerCase() === needle));
}

export function factsWithTag(candidate: CandidateFile, tags: string[]): Fact[] {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()));
  return candidate.facts.filter((fact) => fact.tags.some((tag) => wanted.has(tag.toLowerCase())));
}
