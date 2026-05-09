/**
 * Job Detail — canonical detail header (2026-05-07 unified card,
 * 2026-05-08 CanonicalDetailHeader migration, 2026-05-08 full-card
 * consolidation, 2026-05-08 Task 3 structured props API).
 *
 * 2026-05-07: the standalone `<CanonicalDetailHeader>` strip + the
 * separate `card-job-context` CardShell were merged into ONE unified
 * primary detail card.
 *
 * 2026-05-08 (layout="card" migration): the merged card's 2-column
 * content layout was extracted into `CanonicalDetailHeader layout="card"`.
 *
 * 2026-05-08 (full-card consolidation): CanonicalDetailHeader now owns
 * the full card chrome (bg-card border-card-border shadow-card). The
 * outer CardShell wrapper was removed from the job header. Description
 * section and edit footer moved from CardShell siblings into
 * `description={}` and `editFooter={}` props on CanonicalDetailHeader.
 *
 * 2026-05-08 (Task 3 structured props): Pages pass STRUCTURED DATA only —
 * no arbitrary styled JSX slots. clientSlot / addressSlot / actionBar
 * ReactNode slots removed. Replaced with clientName, addressLines,
 * primaryActions, overflowActions, onEdit typed props.
 *
 * This file pins:
 *   - CanonicalDetailHeader IS imported and used with layout="card"
 *   - CanonicalDetailHeader owns the chrome — NO CardShell wrapping the header
 *   - title is a string; titleEditNode is the edit-mode textarea (in source)
 *   - statusChip (not statusBadge) contains StatusPill with header-status-pill testid
 *   - clientName= and clientHref= replace clientSlot= (no link-client-context in page source)
 *   - addressLines= and addressLabel= replace addressSlot= and AddressBlock (page source)
 *   - onEdit={enterHeaderEdit} replaces inline Pencil button with button-edit-job-card
 *   - primaryActions and overflowActions replace actions={<>…</>}
 *   - The three meta items (job-number, scheduled, invoice-number) are
 *     passed with the canonical keys and EntityNumber variants
 *   - description={job.description} as string + descriptionEditNode for edit mode
 *   - editFooter passed as prop (not CardShell sibling)
 *   - Exactly one CanonicalDetailHeader with testId="job-detail-header"
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const codeOnly = stripComments(jobDetailSrc);

// ── 1. CanonicalDetailHeader IS now imported and used ──────────────

describe("JobDetailPage — uses CanonicalDetailHeader for card content layout", () => {
  it("imports CanonicalDetailHeader from @/components/detail/CanonicalDetailHeader", () => {
    expect(codeOnly).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports HeaderAction and HeaderOverflowItem types (Task 3)", () => {
    expect(codeOnly).toMatch(/\bHeaderAction\b/);
    expect(codeOnly).toMatch(/\bHeaderOverflowItem\b/);
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …> JSX", () => {
    expect(codeOnly).toMatch(/<CanonicalDetailHeader\b/);
    expect(codeOnly).toMatch(/layout="card"/);
  });

  it("passes testId=\"job-detail-header\" to CanonicalDetailHeader", () => {
    expect(codeOnly).toMatch(/testId="job-detail-header"/);
  });
});

// ── 2. CanonicalDetailHeader owns the card chrome — no CardShell wrapper ──

describe("JobDetailPage — CanonicalDetailHeader owns the card chrome (full-card consolidation 2026-05-08)", () => {
  it("does NOT use a CardShell to wrap the job header (CanonicalDetailHeader owns chrome)", () => {
    expect(codeOnly).not.toMatch(/<CardShell\s+data-testid="card-job-context"/);
    expect(codeOnly).not.toMatch(/data-testid="card-job-context"/);
  });

  it("CardShell is still imported (used for card-billing-summary and other cards)", () => {
    expect(codeOnly).toMatch(/\bCardShell\b/);
  });

  it("there is exactly ONE CanonicalDetailHeader with testId='job-detail-header' (no duplicate)", () => {
    const matches = jobDetailSrc.match(/testId="job-detail-header"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly ONE CanonicalDetailHeader mount (no duplicate)", () => {
    const matches = codeOnly.match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 3. Title, status, client, address passed as structured props ────

describe("JobDetailPage — identity props on CanonicalDetailHeader (Task 3 structured)", () => {
  it("passes title as a string prop (not ReactNode)", () => {
    // title={job.summary || clientName || "Job"} — string expression
    expect(codeOnly).toMatch(/title=\{job\.summary/);
  });

  it("renders the editable summary textarea with text-page-title typography (in titleEditNode prop)", () => {
    // The textarea is defined inline in titleEditNode={editingHeader ? <textarea …> : undefined}
    expect(jobDetailSrc).toMatch(
      /<textarea[\s\S]*?className="[^"]*\btext-page-title\b[^"]*\bfont-semibold\b[^"]*"[\s\S]*?data-testid="input-job-summary-header"/,
    );
  });

  it("renders StatusPill in the statusChip prop (not statusBadge) with header-status-pill testid", () => {
    expect(codeOnly).toMatch(/statusChip=\{/);
    expect(codeOnly).not.toMatch(/statusBadge=\{/);
    expect(jobDetailSrc).toMatch(
      /<StatusPill[\s\S]*?data-testid="header-status-pill"/,
    );
  });

  it("passes clientName= string prop (not clientSlot= ReactNode)", () => {
    expect(codeOnly).toMatch(/clientName=\{clientName\s*\?\?\s*undefined\}/);
    expect(codeOnly).not.toMatch(/clientSlot=/);
  });

  it("passes clientHref= for the location link", () => {
    expect(codeOnly).toMatch(/clientHref=/);
    expect(jobDetailSrc).toMatch(/\/clients\//);
  });

  it("passes addressLines= array with resolveServiceLocationName (not addressSlot= or AddressBlock)", () => {
    expect(codeOnly).toMatch(/addressLines=/);
    expect(jobDetailSrc).toMatch(/resolveServiceLocationName/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
    expect(codeOnly).not.toMatch(/<AddressBlock/);
  });

  it("passes addressLabel=\"Service Address\"", () => {
    expect(codeOnly).toMatch(/addressLabel="Service Address"/);
  });
});

// ── 4. Meta items passed with correct keys and variants ─────────────

describe("JobDetailPage — meta items passed to CanonicalDetailHeader", () => {
  it("passes key='job-number' with EntityNumber primary variant", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']job-number["']/);
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="primary"[\s\S]*?data-testid="header-job-number-pill"/,
    );
    expect(jobDetailSrc).toMatch(/data-testid="input-job-number"/);
  });

  it("passes key='scheduled' with nextVisit?.scheduledStart check", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']scheduled["']/);
    expect(jobDetailSrc).toMatch(/nextVisit\?\.scheduledStart/);
  });

  it("passes key='invoice-number' with EntityNumber linked and missing variants", () => {
    expect(jobDetailSrc).toMatch(/key:\s*["']invoice-number["']/);
    expect(jobDetailSrc).toMatch(
      /<EntityNumber\s+variant="linked"[\s\S]*?data-testid="header-invoice-link"/,
    );
    expect(jobDetailSrc).toMatch(/<EntityNumber\s+variant="missing"\s*\/>/);
  });
});

// ── 5. Actions via structured props (Task 3) ─────────────────────────

describe("JobDetailPage — action buttons via structured props (Task 3)", () => {
  it("passes onEdit={enterHeaderEdit} for the pencil button (not an inline button-edit-job-card)", () => {
    expect(codeOnly).toMatch(/onEdit=\{enterHeaderEdit\}/);
    // button-edit-job-card testId is gone — it's now job-detail-header-edit from CanonicalDetailHeader
    expect(codeOnly).not.toMatch(/data-testid="button-edit-job-card"/);
  });

  it("passes primaryActions={[…]} typed array (not actions={<>…</>} ReactNode slot)", () => {
    expect(codeOnly).toMatch(/primaryActions=\{/);
    expect(codeOnly).not.toMatch(/actions=\{<>/);
  });

  it("passes overflowActions={[…]} typed array (not inline DropdownMenu with button-more-actions)", () => {
    expect(codeOnly).toMatch(/overflowActions=\{/);
    // button-more-actions testId is gone — overflow is now job-detail-header-overflow from CanonicalDetailHeader
    expect(codeOnly).not.toMatch(/data-testid="button-more-actions"/);
  });

  it("does NOT render the Add Equipment combo button in the header (moved to the Equipment rail tab)", () => {
    expect(jobDetailSrc).not.toMatch(/data-testid="button-add-equipment-header"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-add-equipment-rail"/);
  });

  it("renders all status-driven primary CTAs as primaryActions entries", () => {
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-schedule-visit-action["']/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-invoice-action["']/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']button-restore-job["']/);
  });

  it("overflow items use testId: (not data-testid=) in the overflowActions array", () => {
    expect(jobDetailSrc).toMatch(/testId:\s*["']menu-complete-job["']/);
    expect(jobDetailSrc).toMatch(/testId:\s*["']menu-delete-job["']/);
  });
});

// ── 6. Description + edit footer are CanonicalDetailHeader props ──────

describe("JobDetailPage — description + edit footer passed as props to CanonicalDetailHeader (Task 3)", () => {
  it("passes description={job.description ?? null} as a string prop (not ReactNode)", () => {
    expect(codeOnly).toMatch(/description=\{job\.description\s*\?\?\s*null\}/);
  });

  it("does NOT pass a border-t wrapper inside editFooter (CDH owns that chrome — Task 4)", () => {
    // CDH wraps editFooter with border-t border-card-border px-5 py-3
    expect(codeOnly).not.toMatch(/editFooter=\{[\s\S]*?border-t border-card-border/);
  });

  it("passes descriptionLabel prop", () => {
    expect(codeOnly).toMatch(/descriptionLabel=/);
  });

  it("passes descriptionEditContent with textarea for edit mode (Task 4 — canonical prop name)", () => {
    expect(codeOnly).toMatch(/descriptionEditContent=\{/);
    expect(jobDetailSrc).toMatch(/data-testid="textarea-job-description"/);
  });

  it("does NOT render a job-description-section testid (CDH generates job-detail-header-description)", () => {
    expect(codeOnly).not.toMatch(/data-testid="job-description-section"/);
  });

  it("passes editFooter content only — CDH owns the border-t chrome (Task 4)", () => {
    expect(codeOnly).toMatch(/editFooter=\{/);
    // CDH's wrapper gets testid="job-detail-header-footer"; page provides button testids
    expect(jobDetailSrc).toMatch(/data-testid="button-header-save"/);
    expect(jobDetailSrc).toMatch(/data-testid="button-header-cancel"/);
  });
});
