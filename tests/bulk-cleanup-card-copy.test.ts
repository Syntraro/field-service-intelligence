/**
 * Bulk Archived Jobs Cleanup Card — destructive warning copy lock (2026-04-09)
 *
 * The repo has no React component-test harness (no jsdom + RTL wiring), so we
 * lock the destructive copy at the source level. If someone deletes the
 * warning text or reworks the "invoice detach" follow-up, this test will fail
 * and surface the regression before it ships.
 *
 * Asserts:
 *   1. The persistent destructive note is present in
 *      client/src/components/admin/BulkArchivedJobsCleanupCard.tsx with the
 *      exact product-approved wording.
 *   2. The conditional invoice-detach follow-up is gated on
 *      preview.invoiceLinkedCount > 0 and carries the approved wording.
 *   3. The note lives inside CardContent (above the filters grid), not
 *      buried inside the preview-results or run-results panels.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CARD_PATH = resolve(
  process.cwd(),
  "client/src/components/admin/BulkArchivedJobsCleanupCard.tsx",
);

const source = readFileSync(CARD_PATH, "utf8");

describe("BulkArchivedJobsCleanupCard — destructive copy", () => {
  it("contains the persistent destructive warning text (exact wording)", () => {
    expect(source).toContain(
      "This permanently deletes jobs and related job records. This cannot be undone.",
    );
  });

  it("contains the conditional invoice-detach follow-up (exact wording)", () => {
    expect(source).toContain(
      "Linked invoices will be kept, but detached from the deleted jobs.",
    );
  });

  it("gates the invoice-detach follow-up on preview.invoiceLinkedCount > 0", () => {
    // Guard against someone dropping the guard and showing the line unconditionally.
    expect(source).toMatch(/preview\s*&&\s*preview\.invoiceLinkedCount\s*>\s*0/);
  });

  it("exposes testids so runtime tests can still target the notes later", () => {
    expect(source).toContain('data-testid="alert-bulk-cleanup-destructive-note"');
    expect(source).toContain('data-testid="text-bulk-cleanup-destructive-note"');
    expect(source).toContain('data-testid="text-bulk-cleanup-invoice-detach-note"');
  });

  it("keeps the destructive note above the filters grid (not buried in preview results)", () => {
    const noteIdx = source.indexOf("alert-bulk-cleanup-destructive-note");
    const filtersIdx = source.indexOf("{/* Filters */}");
    const previewResultsIdx = source.indexOf("bulk-cleanup-preview-results");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(filtersIdx).toBeGreaterThan(-1);
    expect(previewResultsIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(filtersIdx);
    expect(noteIdx).toBeLessThan(previewResultsIdx);
  });
});
