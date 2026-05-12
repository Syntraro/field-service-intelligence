/**
 * Lead visit mutation CSRF guard (2026-05-12).
 *
 * Source-pin test: assert that the three lead visit mutations
 * (schedule POST, cancel POST, archive DELETE) use the canonical
 * apiRequest() helper and do NOT contain raw fetch() calls for
 * those endpoints. apiRequest() injects the x-csrf-token header
 * automatically; raw fetch() bypasses it and produces EBADCSRFTOKEN.
 *
 * If any of these tests fail it means a mutation has regressed to
 * raw fetch() and will fail with a 403 CSRF error in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const scheduleModal = read(
  "client/src/components/leads/ScheduleLeadVisitModal.tsx",
);
const visitsCard = read("client/src/components/leads/LeadVisitsCard.tsx");

describe("ScheduleLeadVisitModal — schedule mutation uses apiRequest", () => {
  it("imports apiRequest from @/lib/queryClient", () => {
    expect(scheduleModal).toMatch(/import\s*\{[^}]*apiRequest[^}]*\}\s*from\s*["']@\/lib\/queryClient["']/);
  });

  it("calls apiRequest for POST /api/leads/:leadId/visits", () => {
    expect(scheduleModal).toMatch(
      /apiRequest\(`\/api\/leads\/\$\{leadId\}\/visits`/,
    );
  });

  it("does NOT use raw fetch() for the schedule POST endpoint", () => {
    // Allow the queryFn GET fetch in LeadVisitsCard (different file),
    // but the schedule modal must have zero raw fetch calls.
    const rawFetchCalls = (scheduleModal.match(/\bfetch\s*\(/g) ?? []).length;
    expect(rawFetchCalls).toBe(0);
  });
});

describe("LeadVisitsCard — cancel mutation uses apiRequest", () => {
  it("calls apiRequest for POST /api/leads/:leadId/visits/:visitId/cancel", () => {
    expect(visitsCard).toMatch(
      /apiRequest\(`\/api\/leads\/\$\{leadId\}\/visits\/\$\{visitId\}\/cancel`/,
    );
  });

  it("does NOT use raw fetch() for the cancel POST endpoint", () => {
    // The only allowed raw fetch() in this file is the GET queryFn
    // that reads the visits list (not a mutating call, no CSRF needed).
    const rawFetchLines = visitsCard
      .split("\n")
      .filter((line) => /\bfetch\s*\(/.test(line));
    for (const line of rawFetchLines) {
      // Every remaining raw fetch must be a GET (no method: "POST"|"DELETE").
      expect(line).not.toMatch(/method:\s*["'](POST|DELETE|PATCH|PUT)["']/);
    }
  });
});

describe("LeadVisitsCard — archive mutation uses apiRequest", () => {
  it("calls apiRequest for DELETE /api/leads/:leadId/visits/:visitId", () => {
    expect(visitsCard).toMatch(
      /apiRequest\(`\/api\/leads\/\$\{leadId\}\/visits\/\$\{visitId\}`[\s\S]{0,60}method:\s*["']DELETE["']/,
    );
  });
});

describe("Lead visit mutations — no raw fetch on mutating endpoints", () => {
  it("ScheduleLeadVisitModal has zero raw fetch() calls", () => {
    expect((scheduleModal.match(/\bfetch\s*\(/g) ?? []).length).toBe(0);
  });

  it("LeadVisitsCard raw fetch() calls are GET-only (visits list queryFn)", () => {
    // Collect every line that calls fetch().
    const rawFetchLines = visitsCard
      .split("\n")
      .filter((line) => /\bfetch\s*\(/.test(line));

    // There must be exactly one (the GET queryFn for loading visits).
    expect(rawFetchLines.length).toBe(1);

    // That one call must NOT specify a mutating method.
    expect(rawFetchLines[0]).not.toMatch(
      /method:\s*["'](POST|DELETE|PATCH|PUT)["']/,
    );
  });
});
