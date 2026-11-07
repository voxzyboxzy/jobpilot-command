import type { CandidateFile, Fact } from "../candidate/facts.js";
import { splitName } from "../candidate/facts.js";
import type { NormalizedJob, PacketAnswer, PacketField } from "../types.js";
import { tokenize } from "../util/text.js";
import { findInjections } from "./reviewer.js";

export interface TailorDraft {
  bullets: string[];
  coverLetter: string;
  fields: PacketField[];
  answers: PacketAnswer[];
  factIdsUsed: string[];
}

function relevantFacts(job: NormalizedJob, candidate: CandidateFile): Fact[] {
  const cleaned = stripInstructionLines(job.contentText);
  const tokens = new Set(tokenize(`${job.title} ${cleaned}`));
  const ranked = candidate.facts
    .map((fact) => {
      const factTokens = new Set([...tokenize(fact.text), ...fact.tags.map((tag) => tag.toLowerCase())]);
      let overlap = 0;
      for (const token of factTokens) if (tokens.has(token)) overlap += 1;
      return { fact, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || a.fact.id.localeCompare(b.fact.id));
  const picked: Fact[] = [];
  const must = ["auth-us", "loc-tampa", "lang-es", "exp-helpdesk"];
  for (const id of must) {
    const fact = candidate.facts.find((item) => item.id === id);
    if (fact && ranked.some((item) => item.overlap > 0 || id === "auth-us" || id === "loc-tampa")) picked.push(fact);
  }
  for (const item of ranked) {
    if (picked.some((fact) => fact.id === item.fact.id)) continue;
    if (item.overlap === 0 && item.fact.kind === "preference") continue;
    if (item.overlap === 0) continue;
    picked.push(item.fact);
    if (picked.length >= 6) break;
  }
  if (!picked.some((fact) => fact.id === "auth-us")) {
    const auth = candidate.facts.find((fact) => fact.id === "auth-us");
    if (auth) picked.unshift(auth);
  }
  return picked;
}

export function stripInstructionLines(text: string): string {
  return text
    .split(/\n+/)
    .filter((line) => findInjections(line).length === 0)
    .join("\n");
}

export function templateSentences(job: NormalizedJob, candidate: CandidateFile): string[] {
  return [
    "Dear Hiring Team,",
    `I am applying for the ${job.title} role at ${job.company}.`,
    "The following points are copied from my candidate facts.",
    "Sincerely,",
    candidate.candidate.name,
  ];
}

export function tailor(job: NormalizedJob, candidate: CandidateFile): TailorDraft {
  const selected = relevantFacts(job, candidate);
  const bullets = selected
    .filter((fact) => fact.kind !== "authorization" && fact.kind !== "preference")
    .slice(0, 4)
    .map((fact) => `${fact.text} [fact:${fact.id}]`);
  const body = selected.map((fact) => `${fact.text} [fact:${fact.id}]`);
  const cover = [
    "Dear Hiring Team,",
    `I am applying for the ${job.title} role at ${job.company}.`,
    "The following points are copied from my candidate facts.",
    ...body,
    "Sincerely,",
    candidate.candidate.name,
  ].join("\n\n");
  const { first, last } = splitName(candidate.candidate.name);
  const location = `${candidate.candidate.location.city}, ${candidate.candidate.location.region}`;
  const auth = candidate.facts.find((fact) => fact.tags.includes("authorization"));
  const education = candidate.facts.find((fact) => fact.kind === "education");
  const fields: PacketField[] = [
    { key: "first_name", label: "First name", value: first, factIds: [], source: "template", notes: "Split from the candidate name on file." },
    { key: "last_name", label: "Last name", value: last, factIds: [], source: "template", notes: "Split from the candidate name on file." },
    { key: "email", label: "Email", value: candidate.candidate.email, factIds: [], source: "template", notes: null },
    { key: "phone", label: "Phone", value: candidate.candidate.phone ?? null, factIds: [], source: "template", notes: null },
    { key: "location", label: "Location", value: location, factIds: ["loc-tampa"], source: "fact", notes: null },
    { key: "work_authorization", label: "Authorized to work in the US", value: auth ? "Yes" : null, factIds: auth ? [auth.id] : [], source: auth ? "fact" : "human-required", notes: auth?.text ?? null },
    { key: "sponsorship", label: "Requires sponsorship", value: auth ? "No" : null, factIds: auth ? [auth.id] : [], source: auth ? "fact" : "human-required", notes: auth?.text ?? null },
    { key: "linkedin", label: "LinkedIn URL", value: null, factIds: [], source: "human-required", notes: "No LinkedIn fact is on file, so this stays blank." },
    { key: "website", label: "Website", value: null, factIds: [], source: "human-required", notes: "No website fact is on file." },
    { key: "cover_letter", label: "Cover letter", value: cover, factIds: selected.map((fact) => fact.id), source: "fact", notes: null },
    { key: "gender", label: "Gender", value: null, factIds: [], source: "human-required", notes: "Demographic answers are never inferred." },
    { key: "race_ethnicity", label: "Race or ethnicity", value: null, factIds: [], source: "human-required", notes: "Demographic answers are never inferred." },
    { key: "veteran", label: "Veteran status", value: null, factIds: [], source: "human-required", notes: "Demographic answers are never inferred." },
    { key: "disability", label: "Disability status", value: null, factIds: [], source: "human-required", notes: "Demographic answers are never inferred." },
  ];
  const answers: PacketAnswer[] = [
    {
      question: "Are you authorized to work in the United States?",
      value: auth ? `${auth.text} [fact:${auth.id}]` : null,
      factIds: auth ? [auth.id] : [],
      disposition: auth ? "answered" : "human-required",
      reason: null,
    },
    {
      question: "Will you now or in the future require visa sponsorship?",
      value: auth ? `${auth.text} [fact:${auth.id}]` : null,
      factIds: auth ? [auth.id] : [],
      disposition: auth ? "answered" : "human-required",
      reason: null,
    },
    {
      question: "Highest completed degree",
      value: education ? `${education.text} [fact:${education.id}]` : null,
      factIds: education ? [education.id] : [],
      disposition: education ? "answered" : "human-required",
      reason: null,
    },
    {
      question: "Desired salary",
      value: null,
      factIds: [],
      disposition: "human-required",
      reason: "Salary is not in the candidate facts and is not invented.",
    },
    {
      question: "Gender, race, ethnicity, veteran status, or disability",
      value: null,
      factIds: [],
      disposition: "human-required",
      reason: "Demographic answers are never inferred.",
    },
  ];
  return { bullets, coverLetter: cover, fields, answers, factIdsUsed: selected.map((fact) => fact.id) };
}
