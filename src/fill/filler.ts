import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { assertCanSubmit } from "../packet/approval.js";
import type { FillReport, StoredPacket } from "../types.js";

interface KnownField {
  key: string;
  patterns: RegExp[];
}

const KNOWN: KnownField[] = [
  { key: "first_name", patterns: [/first[ _-]?name/i, /given name/i] },
  { key: "last_name", patterns: [/last[ _-]?name/i, /family name/i, /surname/i] },
  { key: "email", patterns: [/e-?mail/i] },
  { key: "phone", patterns: [/phone/i, /mobile/i, /telephone/i] },
  { key: "location", patterns: [/\blocation\b/i, /\bcity\b/i] },
  { key: "work_authorization", patterns: [/work authorization/i, /authorized to work/i, /legally authorized/i] },
  { key: "sponsorship", patterns: [/sponsor/i] },
  { key: "cover_letter", patterns: [/cover[ _-]?letter/i] },
  { key: "linkedin", patterns: [/linkedin/i] },
  { key: "website", patterns: [/website/i, /portfolio/i, /\burl\b/i] },
];

const DEMOGRAPHIC = /gender|race|ethnic|veteran|disability|hispanic|latino|pronoun/i;

function knownHost(url: string): boolean {
  return /greenhouse|ashbyhq|ashby|lever\.co|lever|127\.0\.0\.1|localhost/i.test(url);
}

function fieldValue(packet: StoredPacket, key: string): string | null {
  return packet.fields.find((field) => field.key === key)?.value ?? null;
}

async function labelText(control: Locator): Promise<string> {
  return control.evaluate((element) => {
    const input = element as unknown as {
      name: string;
      id: string;
      placeholder?: string;
      getAttribute(name: string): string | null;
      ownerDocument: { querySelector(selector: string): { textContent: string | null } | null } | null;
      closest(selector: string): { textContent: string | null } | null;
    };
    const bits = [input.name, input.id, input.getAttribute("aria-label") ?? "", input.placeholder ?? ""];
    if (input.id && input.ownerDocument) {
      const label = input.ownerDocument.querySelector(`label[for="${input.id.replace(/"/g, "")}"]`);
      if (label?.textContent) bits.push(label.textContent);
    }
    const parent = input.closest("label");
    if (parent?.textContent) bits.push(parent.textContent);
    return bits.join(" ").replace(/\s+/g, " ").trim();
  });
}

export async function fillApplication(options: {
  jobId: string;
  url: string;
  packet: StoredPacket;
  resumePath: string;
  stopBeforeSubmit?: boolean;
  submit?: boolean;
  approvalToken?: string;
  secret?: string;
  screenshotPath: string;
}): Promise<FillReport> {
  const stopBeforeSubmit = options.stopBeforeSubmit ?? !options.submit;
  const report: FillReport = {
    jobId: options.jobId,
    url: options.url,
    handoff: false,
    handoffReasons: [],
    stoppedBeforeSubmit: stopBeforeSubmit,
    submitted: false,
    fields: [],
    unknownQuestions: [],
    demographicLeftBlank: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
  };
  if (options.submit && !stopBeforeSubmit) {
    if (!options.secret) throw new Error("Submission blocked: approval secret missing.");
    assertCanSubmit(options.secret, options.packet, options.approvalToken);
  }
  mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!knownHost(options.url)) {
      report.handoff = true;
      report.handoffReasons.push("Unsupported host. Open the page and finish it by hand.");
    }
    const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey]').count();
    if (captcha > 0) {
      report.handoff = true;
      report.handoffReasons.push("Captcha detected. A person has to continue.");
    }
    const formCount = await page.locator("form").count();
    if (formCount === 0) {
      report.handoff = true;
      report.handoffReasons.push("No application form found.");
    } else {
      await fillForm(page, options, report);
    }
    await page.screenshot({ path: options.screenshotPath, fullPage: true });
    report.screenshotPath = options.screenshotPath;
    if (report.handoff || stopBeforeSubmit) {
      report.stoppedBeforeSubmit = true;
      report.submitted = false;
      return report;
    }
    if (!options.secret) throw new Error("Submission blocked: approval secret missing.");
    assertCanSubmit(options.secret, options.packet, options.approvalToken);
    await page.locator('form button[type="submit"], form input[type="submit"]').first().click();
    await page.waitForTimeout(300);
    report.submitted = true;
    report.stoppedBeforeSubmit = false;
    return report;
  } finally {
    await browser.close();
  }
}

async function fillForm(
  page: Page,
  options: { packet: StoredPacket; resumePath: string },
  report: FillReport,
): Promise<void> {
  const controls = page.locator("form input, form textarea, form select");
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const meta = await control.evaluate((element) => {
      const input = element as unknown as {
        tagName: string;
        required: boolean;
        getAttribute(name: string): string | null;
      };
      return {
        tag: input.tagName.toLowerCase(),
        type: (input.getAttribute("type") ?? "text").toLowerCase(),
        name: input.getAttribute("name") ?? "",
        required: input.required,
      };
    });
    if (["hidden", "submit", "button"].includes(meta.type)) continue;
    const label = `${meta.name} ${await labelText(control)}`;
    if (DEMOGRAPHIC.test(label)) {
      report.demographicLeftBlank.push(meta.name || label);
      report.fields.push({ name: meta.name || "demographic", action: "left-blank", expected: null, observed: null, ok: true });
      if (meta.required) {
        report.handoff = true;
        report.handoffReasons.push(`Required demographic question left blank: ${meta.name || label}`);
      }
      continue;
    }
    if (meta.type === "file") {
      const resumeOk = options.packet.attachments.some((file) => file.sha256);
      if (!resumeOk) {
        report.handoff = true;
        report.handoffReasons.push("Resume file is missing, so it was not uploaded.");
        report.fields.push({ name: meta.name || "resume", action: "unknown", expected: options.resumePath, observed: null, ok: false });
        continue;
      }
      await control.setInputFiles(options.resumePath);
      report.fields.push({
        name: meta.name || "resume",
        action: "uploaded",
        expected: path.basename(options.resumePath),
        observed: path.basename(options.resumePath),
        ok: true,
      });
      continue;
    }
    const known = KNOWN.find((field) => field.patterns.some((pattern) => pattern.test(label)));
    if (!known) {
      const observed = await readValue(control);
      if (meta.required && !observed) {
        report.unknownQuestions.push(label.trim());
        report.handoff = true;
        report.handoffReasons.push(`Unknown required question: ${label.trim()}`);
        report.fields.push({ name: meta.name || label, action: "unknown", expected: null, observed, ok: false });
      }
      continue;
    }
    const expected = fieldValue(options.packet, known.key);
    if (!expected) {
      report.fields.push({ name: known.key, action: "left-blank", expected: null, observed: null, ok: !meta.required });
      if (meta.required) {
        report.handoff = true;
        report.handoffReasons.push(`Required field ${known.key} has no packet value.`);
      }
      continue;
    }
    if (meta.tag === "select") {
      await control.selectOption({ label: expected }).catch(async () => {
        await control.selectOption(expected);
      });
    } else {
      await control.fill(expected);
    }
    const observed = await readValue(control);
    const ok = meta.tag === "select" ? observed === expected : observed.includes(expected.slice(0, 80));
    report.fields.push({ name: known.key, action: "filled", expected, observed, ok });
  }
}

async function readValue(control: Locator): Promise<string> {
  return control.inputValue().catch(async () =>
    control.evaluate((element) => {
      const input = element as unknown as { value?: string; selectedOptions?: { textContent: string | null }[] };
      const selected = input.selectedOptions?.[0]?.textContent?.trim();
      return selected || input.value || "";
    }),
  );
}
