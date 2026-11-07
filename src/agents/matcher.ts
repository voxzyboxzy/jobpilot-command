import type { CandidateFile } from "../candidate/facts.js";
import { factsWithTag } from "../candidate/facts.js";
import type { EvidenceItem, FitResult, NormalizedJob, RoleFamily } from "../types.js";
import { clamp } from "../util/text.js";

interface SkillSpec {
  id: string;
  label: string;
  pattern: RegExp;
  tags: string[];
  requiredHint: RegExp;
}

const SKILLS: SkillSpec[] = [
  { id: "javascript", label: "JavaScript", pattern: /javascript/i, tags: ["javascript"], requiredHint: /javascript/i },
  { id: "typescript", label: "TypeScript", pattern: /typescript/i, tags: ["typescript"], requiredHint: /typescript/i },
  { id: "sql", label: "SQL", pattern: /\bsql\b/i, tags: ["sql"], requiredHint: /\bsql\b/i },
  { id: "playwright", label: "Playwright", pattern: /playwright/i, tags: ["playwright"], requiredHint: /playwright/i },
  { id: "spanish", label: "Spanish", pattern: /spanish|bilingual/i, tags: ["spanish", "bilingual"], requiredHint: /spanish|bilingual/i },
  {
    id: "customer-support",
    label: "Customer support",
    pattern: /customer (support|service|experience)|help desk|ticketing|technical support/i,
    tags: ["support", "customer", "ticketing"],
    requiredHint: /customer (support|service|experience)|help desk|technical support/i,
  },
  { id: "troubleshooting", label: "Troubleshooting", pattern: /troubleshoot/i, tags: ["troubleshooting"], requiredHint: /troubleshoot/i },
  { id: "windows", label: "Windows support", pattern: /\bwindows\b/i, tags: ["windows"], requiredHint: /\bwindows\b/i },
  { id: "excel", label: "Spreadsheets", pattern: /excel|spreadsheet/i, tags: ["excel"], requiredHint: /excel|spreadsheet/i },
  { id: "python", label: "Python", pattern: /\bpython\b/i, tags: ["python"], requiredHint: /\bpython\b/i },
  { id: "kotlin", label: "Kotlin", pattern: /\bkotlin\b/i, tags: ["kotlin"], requiredHint: /\bkotlin\b/i },
  { id: "kubernetes", label: "Kubernetes", pattern: /kubernetes|\bk8s\b/i, tags: ["kubernetes"], requiredHint: /kubernetes|\bk8s\b/i },
  {
    id: "security-admin",
    label: "Security administration",
    pattern: /security administration|access management|\bscim\b|information security/i,
    tags: ["security-admin"],
    requiredHint: /security administration|access management|\bscim\b|information security/i,
  },
  { id: "billing", label: "Billing support", pattern: /billing support|accounts payable/i, tags: ["billing"], requiredHint: /billing/i },
  {
    id: "backend-scale",
    label: "Backend systems at scale",
    pattern: /backend systems at scale|distributed systems/i,
    tags: ["backend"],
    requiredHint: /backend systems at scale|distributed systems/i,
  },
  {
    id: "generative-ai",
    label: "Generative AI copilots",
    pattern: /generative ai|copilot/i,
    tags: ["generative-ai"],
    requiredHint: /generative ai|copilot/i,
  },
];

function looksRequired(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 280), index + 80);
  return /require|must|minimum|what we look for|what you'll bring|you have|you'll need|qualifications/i.test(window);
}

export function scoreJob(job: NormalizedJob, candidate: CandidateFile, families: RoleFamily[]): FitResult {
  const text = `${job.title}\n${job.contentText}`;
  const evidence: EvidenceItem[] = [];
  let supports = 0;
  let gaps = 0;
  for (const skill of SKILLS) {
    const match = skill.pattern.exec(text);
    if (!match) continue;
    const facts = factsWithTag(candidate, skill.tags);
    const required = looksRequired(text, match.index);
    if (facts.length > 0) {
      supports += 1;
      evidence.push({
        requirement: skill.label,
        factIds: facts.map((fact) => fact.id),
        relation: "supports",
        detail: `Posting mentions ${skill.label}. ${facts.map((fact) => fact.id).join(", ")} ${facts.length > 1 ? "mention" : "mentions"} it.`,
      });
    } else if (required) {
      gaps += 1;
      evidence.push({
        requirement: skill.label,
        factIds: [],
        relation: "gap",
        detail: `${skill.label} appears in a requirement-like passage and is not in the candidate facts.`,
      });
    } else {
      evidence.push({
        requirement: skill.label,
        factIds: [],
        relation: "partial",
        detail: `${skill.label} is mentioned, without a clear requirement line tied to a candidate fact.`,
      });
    }
  }

  let score = 18;
  if (families.length > 0) score += 22;
  score += Math.min(12, Math.max(0, families.length - 1) * 6);
  if (/\b(specialist|representative|\brep\b|new grad|junior|associate|recent graduate)\b/i.test(job.title)) score += 12;
  if (/\b(software engineer|fullstack|full-stack)\s+i\b/i.test(job.title)) score += 8;
  if (evidence.some((item) => item.requirement === "Spanish" && item.relation === "supports")) score += 12;
  score += Math.min(24, supports * 6);
  score -= Math.min(32, gaps * 8);
  if (/\bengineer\b/i.test(job.title)) {
    const acceptsProjects = /side projects?|personal projects?|equivalent experience|practical experience/i.test(text);
    const hasProjects = candidate.facts.some((fact) => fact.kind === "project" || fact.kind === "skill");
    score -= acceptsProjects && hasProjects ? 4 : 22;
  }
  if (/\bsecurity administrator\b|\bsme\b|subject matter expert/i.test(job.title)) score -= 10;
  if (/\bbilling\b/i.test(job.title) && factsWithTag(candidate, ["billing"]).length === 0) score -= 28;
  score = clamp(Math.round(score), 0, 100);

  const supportNames = evidence.filter((item) => item.relation === "supports").map((item) => item.requirement);
  const gapNames = evidence.filter((item) => item.relation === "gap").map((item) => item.requirement);
  const summary = [
    families.length ? `Matches ${families.join(", ")}.` : "No role family.",
    supportNames.length ? `Facts support: ${supportNames.join(", ")}.` : "No direct fact overlap.",
    gapNames.length ? `Gaps: ${gapNames.join(", ")}.` : "No hard skill gaps detected.",
  ].join(" ");

  return { jobId: job.id, score, roleFamilies: families, evidence, summary };
}
