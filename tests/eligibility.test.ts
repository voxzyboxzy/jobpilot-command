import { describe, expect, it } from "vitest";
import { assessEligibility, clearanceBlocks, degreeBlocks, linkedinBlocks, minYearsRequired } from "../src/filters/eligibility.js";
import type { NormalizedJob, RoleFamily } from "../src/types.js";

const families: RoleFamily[] = ["entry-software", "qa", "automation-ai", "it-support", "data", "spanish-bilingual"];

function job(partial: Partial<NormalizedJob>): NormalizedJob {
  return {
    id: "greenhouse:example:1",
    source: "greenhouse",
    board: "example",
    externalId: "1",
    company: "Example",
    title: "Product Support Specialist",
    location: "Remote - US",
    workplaceType: "unknown",
    workplaceNote: null,
    url: "https://example.com",
    applyUrl: "https://example.com",
    contentText: "Help customers troubleshoot account issues.",
    departments: [],
    compensation: null,
    updatedAt: null,
    isRemoteFlag: null,
    sourceWorkplace: null,
    ...partial,
  };
}

describe("eligibility", () => {
  it("blocks 3+ years and allows 1-3 or 2+", () => {
    expect(minYearsRequired("You have 5+ years of experience.")).toBe(5);
    expect(minYearsRequired("1-3 years of experience in a similar role.")).toBe(1);
    expect(minYearsRequired("2+ years of billing support.")).toBe(2);
    expect(minYearsRequired("3-5+ years of QA automation experience.")).toBe(3);
    expect(minYearsRequired("Paid month off after 4 years. Base pay $80,000 per year.")).toBeNull();
  });

  it("blocks required degrees and allows equivalent or preferred", () => {
    expect(degreeBlocks("Graduated between Spring 2025 and Spring 2026 with a bachelor's degree in a related field.")).toBe(true);
    expect(degreeBlocks("Bachelor's degree or equivalent experience.")).toBe(false);
    expect(degreeBlocks("This position requires either equivalent practical experience or a Bachelor’s degree.")).toBe(false);
    expect(degreeBlocks("A degree in Computer Science is a plus.")).toBe(false);
  });

  it("blocks required clearance and ignores clearance listed as a plus", () => {
    expect(clearanceBlocks("Active US Security clearance or willingness to obtain a US Security clearance.")).toBe(true);
    expect(clearanceBlocks("An active security clearance is not required, but a plus.")).toBe(false);
  });

  it("blocks a required LinkedIn profile and ignores a LinkedIn URL in prose", () => {
    expect(linkedinBlocks("A LinkedIn profile is required with your application.")).toBe(true);
    expect(linkedinBlocks("Read more at https://www.linkedin.com/pulse/stop-adding-ai")).toBe(false);
  });

  it("treats Ashby isRemote without workplaceType as remote-or-hybrid", () => {
    const decision = assessEligibility(
      job({
        source: "ashby",
        workplaceType: "remote",
        workplaceNote: "Ashby isRemote can mean remote or hybrid; treated as remote-or-hybrid.",
        isRemoteFlag: true,
        location: "Remote",
      }),
      { families },
    );
    expect(decision.eligible).toBe(true);
    expect(decision.reasons.join(" ")).toMatch(/remote or hybrid/i);
  });

  it("does not treat Ashby onsite as remote when isRemote is true", () => {
    const decision = assessEligibility(
      job({ workplaceType: "onsite", isRemoteFlag: true, location: "New York", sourceWorkplace: "OnSite" }),
      { families },
    );
    expect(decision.eligible).toBe(false);
    expect(decision.exclusions.join(" ")).toMatch(/onsite/i);
  });

  it("rejects NYC hybrid and accepts remote US support", () => {
    const nyc = assessEligibility(job({ location: "New York, New York, United States", contentText: "This role is based in our New York office. We are a hybrid environment." }), { families });
    expect(nyc.eligible).toBe(false);
    const remote = assessEligibility(job({ title: "Bilingual Customer Experience Specialist (Spanish)", location: "United States - Remote", contentText: "Fluent Spanish. 1+ year in a customer-facing role." }), { families });
    expect(remote.eligible).toBe(true);
    expect(remote.roleFamilies).toContain("spanish-bilingual");
  });

  it("rejects Pacific/Mountain titles and senior titles", () => {
    const pacific = assessEligibility(job({ title: "Product Support Specialist, Pacific/Mountain Time", location: "North America" }), { families });
    expect(pacific.eligible).toBe(false);
    const senior = assessEligibility(job({ title: "Senior Support Engineer", location: "United States" }), { families });
    expect(senior.eligible).toBe(false);
  });

  it("does not treat a named headquarters as remote", () => {
    const decision = assessEligibility(
      job({ title: "Customer Experience Associate", location: "New York, NY (HQ)", workplaceType: "remote", contentText: "Join the support team at headquarters." }),
      { families },
    );
    expect(decision.eligible).toBe(false);
  });

  it("rejects a Canadian remote location", () => {
    const decision = assessEligibility(job({ title: "Dedicated Support Engineer - Toronto", location: "Ontario - Remote", workplaceType: "remote" }), { families });
    expect(decision.eligible).toBe(false);
  });

  it("accepts a broad US location when the posting says the role may be remote", () => {
    const decision = assessEligibility(
      job({
        title: "Technical Support and Sales Rep",
        location: "United States",
        contentText: "This position may be a hybrid or fully remote position. This position is not eligible to be performed in California or New York.",
      }),
      { families },
    );
    expect(decision.eligible).toBe(true);
  });
});
