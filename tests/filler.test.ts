import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCandidate } from "../src/candidate/facts.js";
import { Store } from "../src/db/store.js";
import { approve, buildPacket, ingestFixture, scoreAll } from "../src/agents/pipeline.js";
import { fillApplication } from "../src/fill/filler.js";
import { startMockAts, mockGreenhouseUrl } from "../src/mock/server.js";
import { ROLE_FAMILIES } from "../src/types.js";

const root = path.resolve(".");

describe("form filler", () => {
  it("fills known fields, leaves demographics blank, and submits only with approval", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jobpilot-fill-"));
    const resume = path.join(dir, "resume.pdf");
    writeFileSync(resume, readFileSync(path.join(root, "examples/Alex-Rivera-Resume.pdf")));
    const store = new Store(path.join(dir, "jobs.db"));
    const candidate = loadCandidate(path.join(root, "examples/candidate.example.yaml"));
    ingestFixture(store, path.join(root, "fixtures/recorded/jobs.json"), path.join(root, "config/watchlist.yaml"), [...ROLE_FAMILIES]);
    scoreAll(store, candidate);
    const job = store.listJobs({ eligible: true })[0];
    expect(job).toBeTruthy();
    if (!job) return;
    const packet = await buildPacket(store, job, candidate, resume);
    const mock = await startMockAts(0);
    try {
      const clean = await fillApplication({
        jobId: job.id,
        url: mockGreenhouseUrl(mock.url),
        packet,
        resumePath: resume,
        stopBeforeSubmit: true,
        screenshotPath: path.join(dir, "clean.png"),
      });
      expect(clean.submitted).toBe(false);
      expect(clean.handoff).toBe(false);
      for (const key of ["first_name", "last_name", "email", "phone", "location", "work_authorization", "sponsorship", "cover_letter"]) {
        expect(clean.fields.find((field) => field.name === key)?.ok).toBe(true);
      }
      expect(clean.fields.some((field) => field.action === "uploaded")).toBe(true);
      expect(clean.demographicLeftBlank.join(" ")).toMatch(/gender/i);
      expect(mock.submissions).toHaveLength(0);

      const unknown = await fillApplication({
        jobId: job.id,
        url: `${mock.url}/greenhouse/acme/jobs/job-1/unknown`,
        packet,
        resumePath: resume,
        stopBeforeSubmit: true,
        screenshotPath: path.join(dir, "unknown.png"),
      });
      expect(unknown.handoff).toBe(true);
      expect(unknown.unknownQuestions.length).toBeGreaterThan(0);

      const captcha = await fillApplication({
        jobId: job.id,
        url: `${mock.url}/greenhouse/acme/jobs/job-1/captcha`,
        packet,
        resumePath: resume,
        stopBeforeSubmit: true,
        screenshotPath: path.join(dir, "captcha.png"),
      });
      expect(captcha.handoff).toBe(true);
      expect(captcha.handoffReasons.join(" ")).toMatch(/captcha/i);

      await expect(
        fillApplication({
          jobId: job.id,
          url: mockGreenhouseUrl(mock.url, "no-token"),
          packet,
          resumePath: resume,
          stopBeforeSubmit: false,
          submit: true,
          secret: store.approvalSecret(),
          screenshotPath: path.join(dir, "denied.png"),
        }),
      ).rejects.toThrow(/Submission blocked/);
      expect(mock.submissions).toHaveLength(0);

      const approved = approve(store, job.id, "tester");
      const submitted = await fillApplication({
        jobId: job.id,
        url: mockGreenhouseUrl(mock.url, "approved"),
        packet: approved,
        resumePath: resume,
        stopBeforeSubmit: false,
        submit: true,
        approvalToken: approved.approval?.token,
        secret: store.approvalSecret(),
        screenshotPath: path.join(dir, "submitted.png"),
      });
      expect(submitted.submitted).toBe(true);
      expect(mock.submissions).toHaveLength(1);
      expect(mock.submissions[0]?.body).toContain("alex.rivera@example.com");
    } finally {
      await mock.close();
      store.close();
    }
  });
});
