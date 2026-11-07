import type { CandidateFile, Fact } from "../candidate/facts.js";
import type { PacketAnswer, PacketField, ReviewResult } from "../types.js";
import { normalizeSpace } from "../util/text.js";

const INJECTION =
  /ignore (all|any|previous|above) instructions|disregard (the )?(system|previous|all)|you are now|system prompt|<\s*system\s*>|\bsystem\s*:|\[INST\]|claim (that )?you (have|hold|earned)|do not follow the candidate facts/i;

const DEMOGRAPHIC_KEYS = ["gender", "race_ethnicity", "veteran", "disability"];

export function findInjections(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (INJECTION.test(line)) hits.push(line.trim().slice(0, 240));
  }
  if (hits.length === 0 && INJECTION.test(text)) hits.push(text.match(INJECTION)?.[0] ?? "injection");
  return hits;
}

export function extractCitations(text: string): string[] {
  return [...text.matchAll(/\[fact:([a-z0-9-]+)\]/g)].map((match) => match[1] ?? "").filter(Boolean);
}

function stripCitations(text: string): string {
  return normalizeSpace(text.replace(/\[fact:[a-z0-9-]+\]/g, " "));
}

export function claimSupported(sentence: string, citedFacts: Fact[]): { ok: boolean; reason: string } {
  const ids = extractCitations(sentence);
  if (ids.length === 0) return { ok: false, reason: "Missing a fact citation." };
  const unknown = ids.filter((id) => !citedFacts.some((fact) => fact.id === id) && !citedFacts.find((fact) => fact.id === id));
  const known = citedFacts.filter((fact) => ids.includes(fact.id));
  if (known.length !== ids.length) {
    const missing = ids.filter((id) => !known.some((fact) => fact.id === id));
    return { ok: false, reason: `Unknown fact id: ${missing.join(", ") || unknown.join(", ")}.` };
  }
  const bare = stripCitations(sentence).replace(/[.]+$/g, "").trim();
  const citedText = normalizeSpace(known.map((fact) => fact.text).join(" "));
  if (bare.length === 0) return { ok: false, reason: "Citation has no claim text." };
  if (citedText.toLowerCase().includes(bare.toLowerCase())) return { ok: true, reason: "Claim text is contained in the cited facts." };
  const entailment = entailed(bare, known);
  if (entailment) return { ok: true, reason: entailment };
  return { ok: false, reason: "Claim text is not contained in the cited facts." };
}

function entailed(bare: string, facts: Fact[]): string | null {
  const blob = facts.map((fact) => fact.text).join(" ");
  if (/^yes$/i.test(bare) && /authorized to work in the united states/i.test(blob)) {
    return "Yes is entailed by the authorization fact.";
  }
  if (/^no$/i.test(bare) && /does not need visa sponsorship/i.test(blob)) {
    return "No is entailed by the sponsorship fact.";
  }
  return null;
}

export interface DraftText {
  coverLetter: string;
  bullets: string[];
  answers: PacketAnswer[];
  fields: PacketField[];
}

export function reviewDraft(draft: DraftText, candidate: CandidateFile, postingText: string, allowedTemplates: string[]): ReviewResult {
  const injections = findInjections(postingText);
  const removed: ReviewResult["removed"] = [];
  const notes: string[] = [];
  if (injections.length > 0) {
    notes.push("Posting text contained instruction-like lines. They were treated as data and not as commands.");
  }
  const allowed = new Set(allowedTemplates.map((line) => normalizeSpace(line)));
  const pieces = [
    ...draft.coverLetter.split(/\n+/),
    ...draft.bullets,
    ...draft.answers.filter((answer) => answer.value).map((answer) => answer.value ?? ""),
  ];
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (allowed.has(normalizeSpace(trimmed))) continue;
    const result = claimSupported(trimmed, candidate.facts);
    if (!result.ok) removed.push({ text: trimmed.slice(0, 400), reason: result.reason });
    for (const injection of injections) {
      const needle = injection.slice(0, 80).toLowerCase();
      if (needle.length > 20 && trimmed.toLowerCase().includes(needle)) {
        removed.push({ text: trimmed.slice(0, 400), reason: "Repeats posting instruction text." });
      }
    }
  }
  const forbidden = ["ph.d", "phd from", "mit", "10 years at google", "i am compromised"];
  const factBlob = candidate.facts.map((fact) => fact.text.toLowerCase()).join(" ");
  const produced = `${draft.coverLetter}\n${draft.bullets.join("\n")}`.toLowerCase();
  for (const phrase of forbidden) {
    if (produced.includes(phrase) && !factBlob.includes(phrase)) {
      removed.push({ text: phrase, reason: "Unsupported credential or injected phrase." });
    }
  }
  for (const key of DEMOGRAPHIC_KEYS) {
    const field = draft.fields.find((item) => item.key === key);
    if (field && field.value !== null) {
      removed.push({ text: `${key}=${field.value}`, reason: "Demographic value was inferred." });
    }
  }
  const demographicAnswers = draft.answers.filter((answer) => /gender|race|veteran|disability|ethnicity/i.test(answer.question));
  for (const answer of demographicAnswers) {
    if (answer.value !== null) removed.push({ text: answer.question, reason: "Demographic answer was inferred." });
  }
  return {
    passed: removed.length === 0,
    removed,
    injections,
    demographicKeys: DEMOGRAPHIC_KEYS,
    notes,
  };
}

export function stripUnsupported(coverLetter: string, removed: { text: string }[]): string {
  let next = coverLetter;
  for (const item of removed) {
    if (item.text.length < 12) continue;
    next = next.replace(item.text, "").replace(/\n{3,}/g, "\n\n");
  }
  return next.trim();
}
