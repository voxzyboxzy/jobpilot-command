import type { Eligibility, NormalizedJob, RoleFamily, Workplace } from "../types.js";
import { splitClauses } from "../util/text.js";

const SENIOR_TITLE =
  /\b(senior|sr\.?|staff|principal|director|vp\b|vice president|head\b|lead\b|manager|architect)\b/i;

const ENTRY_TITLE =
  /\b(junior|jr\.?|entry[-\s]?level|new grad|recent graduate|associate|apprentice|intern)\b|\b(specialist|engineer|analyst|developer)\s+i\b/i;

export interface EligibilityOptions {
  families: RoleFamily[];
}

function skipYearsClause(clause: string): boolean {
  return /base pay|per year|compensation|salary|stipend|pto|vacation|parental|benefits|year over year|over the past|every \d+ years|home office|\$\d/i.test(
    clause,
  );
}

export function minYearsRequired(text: string): number | null {
  let min: number | null = null;
  for (const clause of splitClauses(text)) {
    if (skipYearsClause(clause)) continue;
    const patterns = [
      /(?<![\d-])(\d+)\s*\+\s*years?/i,
      /(\d+)\s*[-–to]{1,3}\s*(\d+)\s*\+?\s*years?/i,
      /(?:minimum of|minimum|at least)\s*(\d+)\s*\+?\s*years?/i,
      /(?:three|3)\s+or more years/i,
    ];
    for (const pattern of patterns) {
      const match = clause.match(pattern);
      if (!match) continue;
      const value = pattern.source.startsWith("(?:three") ? 3 : Number(match[1]);
      if (!Number.isFinite(value)) continue;
      min = min === null ? value : Math.max(min, value);
    }
  }
  return min;
}

export function degreeBlocks(text: string): boolean {
  for (const clause of splitClauses(text)) {
    if (!/bachelor|master'?s|\bph\.?d\b|b\.s\.|bs\/ba|university degree|college degree/i.test(clause)) continue;
    if (/equivalent|practical experience|or related experience/i.test(clause)) continue;
    if (/preferred|nice to have|plus|bonus|a plus/i.test(clause)) continue;
    if (/required|must hold|must have|minimum|graduated\b|with a bachelor|degree in a/i.test(clause)) return true;
  }
  return false;
}

export function clearanceBlocks(text: string): boolean {
  for (const clause of splitClauses(text)) {
    if (!/security clearance|ts\/sci|top secret|secret clearance/i.test(clause)) continue;
    if (/(not required|plus|bonus|preferred)/i.test(clause) && !/\bmust\b|required active|active us security/i.test(clause)) {
      continue;
    }
    return true;
  }
  return false;
}

export function linkedinBlocks(text: string): boolean {
  return /linkedin (profile|url|account).{0,40}required|required.{0,40}linkedin (profile|url)|must (?:have|provide|include) (?:a |your )?linkedin/i.test(
    text,
  );
}

const NON_US =
  /\b(united kingdom|uk\b|london|england|india|ireland|dublin|canada|toronto|ontario|british columbia|quebec|alberta|vancouver|emea|apac|europe|australia|singapore|germany|berlin|spain|japan|tokyo|hong kong|colombia|france|paris|poland|warsaw|brazil|mexico|netherlands|amsterdam|sweden|stockholm|israel|uae|dubai|south korea|seoul|romania|austria|vienna|new zealand|philippines|taiwan|china|beijing|shanghai)\b/i;

const US_OK =
  /\b(united states|u\.s\.a?\.?|usa\b|\bus\b|us-remote|remote - us|remote, u\.s|remote us\b|us remote|north america|americas|\bamer\b|american|florida|\bfl\b)\b/i;

const BROAD_GEO =
  /^(remote[, ]*)?(united states|usa|u\.s\.a?\.?|us|north america|the americas|americas|global|worldwide|remote)$/i;

export function classifyWorkplace(job: Pick<NormalizedJob, "location" | "contentText" | "workplaceType" | "sourceWorkplace" | "isRemoteFlag" | "workplaceNote">): {
  workplace: Workplace;
  note: string | null;
} {
  if (job.workplaceType !== "unknown") {
    if (job.workplaceType === "remote" && isSpecificOffice(job.location) && !/\bremote\b/i.test(job.location)) {
      return { workplace: "onsite", note: "The location names a specific office and does not say remote." };
    }
    return { workplace: job.workplaceType, note: job.workplaceNote };
  }
  const location = job.location || "";
  const fromLocation = tokenWorkplace(location);
  if (fromLocation) return { workplace: fromLocation, note: null };
  const broad = BROAD_GEO.test(location.trim()) || location.trim().length === 0;
  const strongRemote =
    /#li-remote|remote-first|this (role|position) (is|may be).{0,50}remote|fully remote position|may be a hybrid or fully remote/i.test(
      job.contentText,
    );
  if ((broad || /#li-remote/i.test(job.contentText)) && strongRemote) {
    return { workplace: "remote", note: "Remote inferred from the posting text because the location field is not a specific office." };
  }
  if (broad && /\bhybrid\b/i.test(job.contentText)) {
    return { workplace: "hybrid", note: null };
  }
  if (isSpecificOffice(location)) return { workplace: "onsite", note: null };
  return { workplace: "unknown", note: null };
}

function tokenWorkplace(location: string): Workplace | null {
  const text = location.toLowerCase();
  if (/\bremote\b/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bon-?site\b|\bin[- ]office\b/.test(text)) return "onsite";
  return null;
}

function isSpecificOffice(location: string): boolean {
  if (!location.trim()) return false;
  if (BROAD_GEO.test(location.trim())) return false;
  return /,/.test(location) || /\b(new york|san francisco|seattle|chicago|boston|austin|denver|atlanta|pittsburgh|los angeles|bay area)\b/i.test(location);
}

const NON_FL_METRO =
  /\b(new york|nyc|san francisco|bay area|seattle|chicago|boston|austin|denver|atlanta|pittsburgh|los angeles|london|dublin|toronto|berlin|paris|singapore)\b/i;

export function locationDecision(
  job: Pick<NormalizedJob, "title" | "location" | "contentText">,
  workplace: Workplace,
): { ok: boolean; reason: string } {
  const blob = `${job.title}\n${job.location}\n${job.contentText.slice(0, 2500)}`;
  const exclusion = blob.match(/not eligible to be performed in ([^.]+)/i);
  if (exclusion && /\bflorida\b/i.test(exclusion[1] ?? "")) {
    return { ok: false, reason: "Posting says the role cannot be performed in Florida." };
  }
  if (/exclusively to candidates.{0,80}(california|bay area)|must be (?:based|located) in (?:the )?(?:bay area|california|new york|seattle|london)/i.test(blob)) {
    return { ok: false, reason: "Posting limits residency to a place other than Florida." };
  }
  if (/pacific\s*\/\s*mountain/i.test(job.title)) {
    return { ok: false, reason: "Role is limited to Pacific or Mountain time, which does not include Florida." };
  }
  if (workplace === "onsite" || workplace === "unknown") {
    return { ok: false, reason: `Workplace is ${workplace}; only remote or hybrid roles are in scope.` };
  }
  const us = US_OK.test(job.location) || (workplace === "remote" && !NON_US.test(job.location) && job.location.trim().length > 0 && /\bremote\b/i.test(job.location) && !NON_US.test(job.location));
  const worldwideRemote = workplace === "remote" && (job.location.trim().length === 0 || /^(remote|global|worldwide|hq)$/i.test(job.location.trim()) || /\b(global|worldwide)\b/i.test(job.location));
  const nonUs = NON_US.test(job.location);
  const usOk = US_OK.test(job.location);
  if (nonUs && !usOk && !worldwideRemote) {
    return { ok: false, reason: `Location looks outside the US: ${job.location}` };
  }
  if (workplace === "hybrid" && !usOk && !/\bflorida\b/i.test(job.location)) {
    if (NON_FL_METRO.test(job.location) || nonUs) {
      return { ok: false, reason: "Hybrid location is not Florida and does not include a US-wide remote option." };
    }
  }
  if (workplace === "hybrid" && NON_FL_METRO.test(job.location) && !/\bflorida\b|\bremote\b/i.test(job.location)) {
    return { ok: false, reason: "Hybrid office is outside Florida." };
  }
  if (usOk || worldwideRemote || us || (workplace === "remote" && !nonUs)) {
    return {
      ok: true,
      reason: usOk ? "Location is open to the US, so Florida is eligible." : "Unspecified or worldwide remote treated as open to Florida.",
    };
  }
  return { ok: false, reason: "Could not confirm US or Florida eligibility." };
}

function titleMatches(title: string, pattern: RegExp): boolean {
  return pattern.test(title) && !SENIOR_TITLE.test(title);
}

export function matchRoleFamilies(title: string, text: string, allowed: RoleFamily[]): RoleFamily[] {
  const families: RoleFamily[] = [];
  const entrySoftware =
    /\b(software engineer|frontend|front-end|backend|back-end|fullstack|full-stack|web developer)\b/i.test(title) &&
    (ENTRY_TITLE.test(title) || /\b(software engineer|fullstack|full-stack)\s+i\b/i.test(title));
  if (entrySoftware && !SENIOR_TITLE.test(title)) families.push("entry-software");
  if (titleMatches(title, /\b(qa|quality assurance|sdet|test engineer|software tester|quality analyst|qa specialist)\b/i)) {
    families.push("qa");
  }
  const automationTitle = titleMatches(title, /\b(automation|rpa|prompt engineer)\b/i);
  const aiEntry = /\b(ai|machine learning|llm)\b/i.test(title) && ENTRY_TITLE.test(title) && !SENIOR_TITLE.test(title);
  if (automationTitle || aiEntry) families.push("automation-ai");
  if (
    titleMatches(
      title,
      /\b(technical support|tech support|it support|help desk|helpdesk|product support|customer support|support specialist|support engineer|support representative|customer experience|service desk|implementation specialist|desktop support|social support)\b/i,
    )
  ) {
    families.push("it-support");
  }
  if (titleMatches(title, /\b(data analyst|analytics analyst|business analyst|bi analyst|data specialist)\b/i)) {
    families.push("data");
  }
  const bilingual = /\b(spanish|bilingual)\b/i.test(`${title} ${text.slice(0, 400)}`);
  const supportish = families.includes("it-support") || /\b(support|customer experience|customer success)\b/i.test(title);
  if (bilingual && supportish && !SENIOR_TITLE.test(title)) families.push("spanish-bilingual");
  return families.filter((family) => allowed.includes(family));
}

export function assessEligibility(job: NormalizedJob, options: EligibilityOptions): Eligibility {
  const reasons: string[] = [];
  const exclusions: string[] = [];
  const classified = classifyWorkplace(job);
  const workplace = classified.workplace;
  if (classified.note) reasons.push(classified.note);
  if (workplace !== "remote" && workplace !== "hybrid") {
    exclusions.push(`Workplace is ${workplace}; need remote or hybrid.`);
  } else {
    reasons.push(`Workplace classified as ${workplace}.`);
  }
  const location = locationDecision(job, workplace);
  if (!location.ok) exclusions.push(location.reason);
  else reasons.push(location.reason);

  const years = minYearsRequired(job.contentText);
  if (years !== null && years >= 3) exclusions.push(`Requires about ${years}+ years.`);
  else if (years !== null) reasons.push(`Stated minimum experience is about ${years} year(s), under the 3-year cutoff.`);

  if (degreeBlocks(job.contentText)) exclusions.push("Degree appears required without an equivalent-experience path.");
  if (clearanceBlocks(job.contentText)) exclusions.push("Security clearance is required.");
  if (linkedinBlocks(job.contentText)) exclusions.push("A LinkedIn profile is required.");

  const roleFamilies = matchRoleFamilies(job.title, job.contentText, options.families);
  if (roleFamilies.length === 0) exclusions.push("Title is outside the configured role families or reads as senior.");
  else reasons.push(`Role families: ${roleFamilies.join(", ")}.`);

  return {
    eligible: exclusions.length === 0,
    reasons,
    roleFamilies,
    workplace,
    locationOk: location.ok,
    exclusions,
  };
}
