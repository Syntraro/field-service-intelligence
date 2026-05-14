/**
 * Jobs list — secondary "location" line is suppressed when blank or
 * when it would visually duplicate the primary client/company line
 * (2026-05-06 RALPH polish, post blank-location-name change).
 *
 * Locks the contract that:
 *   • Both the live and history Jobs-list columns route their secondary
 *     line through the shared `secondaryLocationLine()` helper. The
 *     helper is the single source of truth for whether the under-line
 *     renders.
 *   • The helper returns null when `locationName` is null / empty, OR
 *     when its trimmed lowercase value matches the trimmed lowercase
 *     primary `locationDisplayName`. Otherwise it returns the trimmed
 *     raw `locationName` verbatim.
 *   • The helper does NOT synthesize a fallback: when both values are
 *     present and distinct it returns the raw user-entered location
 *     name only. There is no `locationName ?? customerName` chain.
 *   • The Invoice list rendering is NOT modified by this change — the
 *     existing `{invoice.locationName && invoice.locationDisplayName &&
 *     ...}` shape is preserved verbatim, and no helper from the Jobs
 *     page leaks into the InvoicesListPage source.
 *   • The backend canonical mappings keep returning the raw
 *     `clients.location` column (`getJobsFeed` + `getInvoicesFeed`) — no
 *     fallback to customer/company name lives at the storage layer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOBS_PAGE = resolve(ROOT, "client/src/pages/Jobs.tsx");
const INVOICES_PAGE = resolve(ROOT, "client/src/pages/InvoicesListPage.tsx");
const JOBS_FEED = resolve(ROOT, "server/storage/jobsFeed.ts");
const INVOICES_FEED = resolve(ROOT, "server/storage/invoicesFeed.ts");

const jobsSrc = readFileSync(JOBS_PAGE, "utf-8");
const invoicesSrc = readFileSync(INVOICES_PAGE, "utf-8");
const jobsFeedSrc = readFileSync(JOBS_FEED, "utf-8");
const invoicesFeedSrc = readFileSync(INVOICES_FEED, "utf-8");

// ── Helper: extract secondaryLocationLine + run it inline ──────────

/**
 * Re-implement the production helper here so the unit tests exercise
 * the EXACT semantics in pure TS, without booting the React tree. The
 * source-pin test below verifies the production helper carries the
 * same shape, so the two stay locked together.
 */
function secondaryLocationLine(job: {
  locationName?: string | null;
  locationDisplayName?: string | null;
}): string | null {
  const raw = (job.locationName ?? "").trim();
  if (!raw) return null;
  const primary = (job.locationDisplayName ?? "").trim();
  if (primary && raw.toLowerCase() === primary.toLowerCase()) return null;
  return raw;
}

// ── 1. Helper semantics (the user-visible contract) ────────────────

describe("Jobs list secondaryLocationLine — render contract", () => {
  it("returns null when locationName is null", () => {
    expect(secondaryLocationLine({ locationName: null, locationDisplayName: "ACME Corp" })).toBeNull();
  });

  it("returns null when locationName is undefined", () => {
    expect(secondaryLocationLine({ locationDisplayName: "ACME Corp" })).toBeNull();
  });

  it("returns null when locationName is an empty string", () => {
    expect(secondaryLocationLine({ locationName: "", locationDisplayName: "ACME Corp" })).toBeNull();
  });

  it("returns null when locationName is whitespace-only", () => {
    expect(secondaryLocationLine({ locationName: "   ", locationDisplayName: "ACME Corp" })).toBeNull();
  });

  it("returns null when locationName equals locationDisplayName (case-insensitive)", () => {
    // Catches the legacy auto-copied data the user explicitly chose
    // not to migrate. Old `clients.location` columns still hold the
    // customer name verbatim; without this check the duplicate would
    // visibly stack under the primary line.
    expect(
      secondaryLocationLine({ locationName: "ACME Corp", locationDisplayName: "ACME Corp" }),
    ).toBeNull();
    expect(
      secondaryLocationLine({ locationName: "acme corp", locationDisplayName: "ACME Corp" }),
    ).toBeNull();
    expect(
      secondaryLocationLine({ locationName: "  ACME Corp  ", locationDisplayName: "ACME Corp" }),
    ).toBeNull();
  });

  it("returns the raw trimmed name when it is a real, distinct location label", () => {
    expect(
      secondaryLocationLine({ locationName: "Warehouse B", locationDisplayName: "ACME Corp" }),
    ).toBe("Warehouse B");
    expect(
      secondaryLocationLine({ locationName: "  Main Office  ", locationDisplayName: "ACME Corp" }),
    ).toBe("Main Office");
  });

  it("does NOT synthesize a fallback when locationName is missing — returns null, not customer name", () => {
    // Negative pin on the spec'd "no fallback" rule. The secondary
    // line should NEVER fall back to the primary display name.
    expect(
      secondaryLocationLine({ locationName: null, locationDisplayName: "ACME Corp" }),
    ).toBeNull();
    expect(
      secondaryLocationLine({ locationName: "", locationDisplayName: "ACME Corp" }),
    ).toBeNull();
  });

  it("returns the raw value when locationDisplayName is missing (no false-positive suppress)", () => {
    // If the primary line is missing for some reason, the helper
    // should not collapse the secondary too — render the raw name.
    expect(
      secondaryLocationLine({ locationName: "Branch A", locationDisplayName: null }),
    ).toBe("Branch A");
    expect(
      secondaryLocationLine({ locationName: "Branch A", locationDisplayName: undefined }),
    ).toBe("Branch A");
  });
});

// ── 2. Production helper exists with the same shape ────────────────

describe("Jobs page mounts the production secondaryLocationLine helper", () => {
  it("declares a `secondaryLocationLine` function in Jobs.tsx", () => {
    expect(jobsSrc).toMatch(/function\s+secondaryLocationLine\s*\(/);
  });

  it("compares trimmed lowercase locationName against trimmed lowercase locationDisplayName", () => {
    // Pin the canonical predicate so a refactor that drops the case-
    // insensitive trim re-introduces the duplicate visual.
    expect(jobsSrc).toMatch(/raw\.toLowerCase\(\)\s*===\s*primary\.toLowerCase\(\)/);
    expect(jobsSrc).toMatch(/\(job\.locationName\s*\?\?\s*""\)\.trim\(\)/);
    expect(jobsSrc).toMatch(/\(job\.locationDisplayName\s*\?\?\s*""\)\.trim\(\)/);
  });

  it("returns null for empty raw values BEFORE any further checks", () => {
    // Pin the early-out so the empty-string + whitespace cases stay
    // suppressed even if the dedupe predicate moves around.
    expect(jobsSrc).toMatch(/if\s*\(!raw\)\s*return\s+null/);
  });

  it("never synthesizes a fallback — returns null or the raw value only", () => {
    // Strip comments so the doc-block (which describes the no-fallback
    // contract in prose) doesn't false-trip the negative pin.
    const codeOnly = jobsSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const fnMatch = codeOnly.match(
      /function\s+secondaryLocationLine\s*\([\s\S]+?\n\}/,
    );
    expect(fnMatch, "secondaryLocationLine body must be parseable").toBeTruthy();
    const fn = fnMatch![0];
    // No `locationName || locationDisplayName` style fallback.
    expect(fn).not.toMatch(/locationDisplayName\s*\|\|/);
    // No COALESCE / synthesis of a customer name into the return.
    expect(fn).not.toMatch(/customerName/);
    expect(fn).not.toMatch(/companyName/);
  });
});

// ── 3. Both Jobs columns route through the helper ──────────────────

describe("Jobs list — both column variants render through secondaryLocationLine()", () => {
  it("liveJobColumns + historyJobColumns each call secondaryLocationLine(job)", () => {
    const calls = jobsSrc.match(/secondaryLocationLine\(job\)/g) ?? [];
    // Two render sites: live mode and history mode.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("the secondary <div> renders only when the helper returns a truthy value", () => {
    // Pin the consume-pattern: `{secondary && (<div>{secondary}</div>)}`.
    // If a future refactor drops the `secondary &&` gate, the
    // duplicate visual returns even though the helper still returns
    // null/empty.
    expect(jobsSrc).toMatch(
      /\{secondary && \(\s*<div\s+className="text-row text-slate-500 font-normal truncate">\{secondary\}<\/div>\s*\)\}/,
    );
  });

  it("does NOT render `{job.locationName && ...}` directly anymore", () => {
    // The pre-fix shape is gone — every render must go through the
    // helper. Strip comments so doc commentary about the prior shape
    // doesn't false-trip the negative pin.
    const codeOnly = jobsSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/\{job\.locationName && \(\s*<div/);
  });

  it("the column primary line still uses the canonical locationDisplayName fallback", () => {
    // The PRIMARY line behavior is unchanged: shows
    // locationDisplayName, falls back to "Unknown Company" only when
    // the backend returns null. Pin both render sites.
    const primaryHits = jobsSrc.match(
      /<div className="truncate">\{job\.locationDisplayName \|\| "Unknown Company"\}<\/div>/g,
    ) ?? [];
    expect(primaryHits.length).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. Invoice list behavior is NOT modified by this change ────────

describe("Invoice list — secondary location render is unchanged", () => {
  it("preserves the existing `{locationName && locationDisplayName && ...}` gate", () => {
    expect(invoicesSrc).toMatch(
      /\{invoice\.locationName && invoice\.locationDisplayName && \(/,
    );
  });

  it("does NOT import / call the Jobs helper from the Invoice list", () => {
    expect(invoicesSrc).not.toMatch(/secondaryLocationLine/);
  });

  it("still falls back to locationName for the primary line when locationDisplayName is missing", () => {
    // Pre-existing primary-line behavior on InvoicesListPage. Pin so
    // a Jobs-side refactor doesn't accidentally regress it.
    expect(invoicesSrc).toMatch(
      /\{invoice\.locationDisplayName \|\| invoice\.locationName \|\| "Unknown"\}/,
    );
  });
});

// ── 5. Backend mappings stay raw (no fallback to customer name) ────

describe("Backend canonical feeds — locationName maps the raw clients.location column", () => {
  it("getJobsFeed selects locationName from clients.location (no COALESCE)", () => {
    expect(jobsFeedSrc).toMatch(/locationName:\s*clients\.location,/);
    // Negative pin: no COALESCE/sql expression dressing on the
    // locationName field in the feed select shape.
    expect(jobsFeedSrc).not.toMatch(/locationName:\s*locationDisplayNameExpr/);
    expect(jobsFeedSrc).not.toMatch(/locationName:\s*sql<string>`COALESCE/);
  });

  it("getJobsFeed mapper passes locationName through verbatim", () => {
    expect(jobsFeedSrc).toMatch(/locationName:\s*row\.locationName\s*\?\?\s*null,/);
  });

  it("getInvoicesFeed also keeps locationName as the raw clients.location column", () => {
    expect(invoicesFeedSrc).toMatch(/locationName:\s*clients\.location,/);
    expect(invoicesFeedSrc).toMatch(/locationName:\s*row\.locationName\s*\?\?\s*null,/);
  });
});
