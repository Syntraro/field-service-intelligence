/**
 * Detail page top-spacing parity — source-pin guard (2026-05-09).
 *
 * JobDetailPage and InvoiceDetailPage must share the same body-wrapper
 * top padding (pt-4) so both pages start at the same distance below
 * the app shell header after the CDH migration.
 *
 * Root cause of the original bug: InvoiceDetailPage was using pt-0
 * (set during the 2026-05-08 scroll-canonicalization pass) while
 * JobDetailPage uses pt-4. Fixed 2026-05-09.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const jobPageSrc = readFileSync(
  resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
  "utf8",
);
const invoicePageSrc = readFileSync(
  resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
  "utf8",
);

describe("Detail page top-spacing parity — Job vs Invoice", () => {
  it("JobDetailPage body wrapper has pt-4 (canonical detail page top padding)", () => {
    expect(jobPageSrc).toMatch(/px-4 lg:px-6 pt-4 pb-4/);
  });

  it("InvoiceDetailPage body wrapper has pt-4 matching Job (not legacy pt-0)", () => {
    expect(invoicePageSrc).toMatch(/px-4 lg:px-6 pt-4 pb-4/);
  });

  it("InvoiceDetailPage does not use pt-0 on any body wrapper div", () => {
    // Guard against regression to the wrong value. pt-0 is legitimate
    // elsewhere (e.g. a card section with its own padding) but must not
    // appear on the main body wrapper that hosts CanonicalDetailHeader.
    // We check the specific offending pattern from the bug.
    expect(invoicePageSrc).not.toMatch(/px-4 lg:px-6 pt-0/);
  });

  it("InvoiceDetailPage outer container bg matches Job (bg-app-bg)", () => {
    expect(jobPageSrc).toMatch(/flex h-full flex-col lg:flex-row bg-app-bg/);
    expect(invoicePageSrc).toMatch(/flex h-full flex-col lg:flex-row bg-app-bg/);
  });

  it("InvoiceDetailPage left-column shell matches Job flex layout", () => {
    expect(jobPageSrc).toMatch(/flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden/);
    expect(invoicePageSrc).toMatch(/flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden/);
  });
});
