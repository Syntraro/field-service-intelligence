/**
 * Canonical detail header — source-pin contract
 * (2026-05-08 Task 3 structured props, 2026-05-08 Task 4 ownership consolidation).
 *
 * Pins the structured props API and ownership rules for CanonicalDetailHeader
 * across both layout variants and all consuming pages.
 *
 * CanonicalDetailHeader supports two layouts:
 *   layout="strip" (default) — compact single-row (InvoiceDetailPage)
 *   layout="card"  — full header card (Job/Quote/Lead)
 *
 * Task 4 ownership contract (all card-mode callers):
 *   - CDH owns ALL chrome: card shell, padding, borders, typography tokens,
 *     description section chrome, description visibility logic,
 *     edit-footer chrome (border-t), workflow row container.
 *   - Pages/cards pass: data strings, typed arrays, callbacks only.
 *   - headerAlert replaces outer-wrapper-div pattern for expiry warnings.
 *   - onDescriptionSave enables CDH's InlineDescriptionEditor (click-to-edit).
 *   - editFooter content only — CDH wraps with border-t chrome.
 *   - workflowSlot content only — CDH wraps with flex container.
 *
 * Migration state (final, 2026-05-08 Task 4):
 *   InvoiceDetailPage — strip layout (backward compat — actions?: ReactNode)
 *   JobDetailPage     — card layout, structured props, CDH owns chrome
 *   QuoteHeaderCard   — card layout, structured props, headerAlert, onDescriptionSave
 *   LeadSummaryCard   — card layout (saved mode), structured props, onDescriptionSave
 *                       draft mode intentionally unchanged
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const canonicalSrc = readFileSync(
  resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx"),
  "utf-8",
);
const jobSrc = readFileSync(
  resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
  "utf-8",
);
const invoiceSrc = readFileSync(
  resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
  "utf-8",
);
const quoteHeaderSrc = readFileSync(
  resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx"),
  "utf-8",
);
const leadSummaryCardSrc = readFileSync(
  resolve(ROOT, "client/src/components/leads/LeadSummaryCard.tsx"),
  "utf-8",
);
const quoteDetailSrc = readFileSync(
  resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx"),
  "utf-8",
);
const leadDetailSrc = readFileSync(
  resolve(ROOT, "client/src/pages/LeadDetailPage.tsx"),
  "utf-8",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ── 1. CanonicalDetailHeader exports and structured props API ───────

describe("CanonicalDetailHeader — exports and type surface (Task 3 + Task 4)", () => {
  it("exports CanonicalDetailHeader as a named export", () => {
    expect(canonicalSrc).toMatch(/export function CanonicalDetailHeader/);
  });

  it("exports DetailHeaderItem interface", () => {
    expect(canonicalSrc).toMatch(/export interface DetailHeaderItem/);
  });

  it("exports HeaderAction interface (Task 3 new)", () => {
    expect(canonicalSrc).toMatch(/export interface HeaderAction/);
  });

  it("exports HeaderOverflowItem interface (Task 3 new)", () => {
    expect(canonicalSrc).toMatch(/export interface HeaderOverflowItem/);
  });

  it("exports CanonicalDetailHeaderProps interface", () => {
    expect(canonicalSrc).toMatch(/export interface CanonicalDetailHeaderProps/);
  });

  it("CanonicalDetailHeaderProps has layout prop with strip and card variants", () => {
    expect(canonicalSrc).toMatch(/layout\?.*"strip"/);
    expect(canonicalSrc).toMatch(/layout\?.*"card"/);
  });

  // Task 3: structured identity props replace ReactNode slots
  it("CanonicalDetailHeaderProps has clientName?: string (not clientSlot)", () => {
    expect(canonicalSrc).toMatch(/clientName\?:\s*string/);
    expect(stripComments(canonicalSrc)).not.toMatch(/clientSlot\?:\s*ReactNode/);
  });

  it("CanonicalDetailHeaderProps has clientHref?: string", () => {
    expect(canonicalSrc).toMatch(/clientHref\?:\s*string/);
  });

  it("CanonicalDetailHeaderProps has contactName?: string", () => {
    expect(canonicalSrc).toMatch(/contactName\?:\s*string/);
  });

  it("CanonicalDetailHeaderProps has addressLines?: string[]", () => {
    expect(canonicalSrc).toMatch(/addressLines\?:\s*string\[\]/);
  });

  it("CanonicalDetailHeaderProps has phone?: string and email?: string", () => {
    expect(canonicalSrc).toMatch(/phone\?:\s*string/);
    expect(canonicalSrc).toMatch(/email\?:\s*string/);
  });

  it("CanonicalDetailHeaderProps has addressSlot removed", () => {
    expect(stripComments(canonicalSrc)).not.toMatch(/addressSlot\?:\s*ReactNode/);
  });

  // Task 3: structured action props replace actionBar ReactNode
  it("CanonicalDetailHeaderProps has primaryActions?: HeaderAction[]", () => {
    expect(canonicalSrc).toMatch(/primaryActions\?:\s*HeaderAction\[\]/);
  });

  it("CanonicalDetailHeaderProps has overflowActions?: HeaderOverflowItem[]", () => {
    expect(canonicalSrc).toMatch(/overflowActions\?:\s*HeaderOverflowItem\[\]/);
  });

  it("CanonicalDetailHeaderProps has onEdit?: () => void", () => {
    expect(canonicalSrc).toMatch(/onEdit\?:\s*\(\)\s*=>/);
  });

  it("CanonicalDetailHeaderProps has workflowSlot?: ReactNode (content only — CDH owns container)", () => {
    expect(canonicalSrc).toMatch(/workflowSlot\?:\s*ReactNode/);
  });

  it("CanonicalDetailHeaderProps has headerAlert?: ReactNode (Task 4 — replaces outer wrapper div)", () => {
    expect(canonicalSrc).toMatch(/headerAlert\?:\s*ReactNode/);
  });

  it("actionBar slot is REMOVED from CanonicalDetailHeaderProps", () => {
    expect(stripComments(canonicalSrc)).not.toMatch(/actionBar\?:\s*ReactNode/);
  });

  // Task 3: statusChip is canonical; statusBadge kept as deprecated alias
  it("CanonicalDetailHeaderProps has statusChip?: ReactNode", () => {
    expect(canonicalSrc).toMatch(/statusChip\?:\s*ReactNode/);
  });

  it("statusBadge?: ReactNode is kept as deprecated alias for strip compat", () => {
    expect(canonicalSrc).toMatch(/statusBadge\?:\s*ReactNode/);
  });

  // Task 3: description is string | null; Task 4: onDescriptionSave enables inline editor
  it("description?: string | null (not ReactNode)", () => {
    expect(canonicalSrc).toMatch(/description\?:\s*string\s*\|\s*null/);
  });

  it("descriptionEditContent?: ReactNode for Job edit-mode textarea (Task 4 canonical name)", () => {
    expect(canonicalSrc).toMatch(/descriptionEditContent\?:\s*ReactNode/);
  });

  it("descriptionEditNode?: ReactNode kept as deprecated alias for descriptionEditContent", () => {
    expect(canonicalSrc).toMatch(/descriptionEditNode\?:\s*ReactNode/);
  });

  it("onDescriptionSave?: callback enables InlineDescriptionEditor (Task 4)", () => {
    expect(canonicalSrc).toMatch(/onDescriptionSave\?:\s*\(text:\s*string\)/);
  });

  it("isDescriptionSaving?: boolean spinner prop (Task 4)", () => {
    expect(canonicalSrc).toMatch(/isDescriptionSaving\?:\s*boolean/);
  });

  it("descriptionPlaceholder?: string custom placeholder (Task 4)", () => {
    expect(canonicalSrc).toMatch(/descriptionPlaceholder\?:\s*string/);
  });

  // entityLabel and onBack are new structured props
  it("CanonicalDetailHeaderProps has entityLabel?: string", () => {
    expect(canonicalSrc).toMatch(/entityLabel\?:\s*string/);
  });

  it("CanonicalDetailHeaderProps has onBack?: () => void", () => {
    expect(canonicalSrc).toMatch(/onBack\?:\s*\(\)\s*=>/);
  });

  it("DetailHeaderItem includes hidden prop for card read-mode filtering", () => {
    expect(canonicalSrc).toMatch(/hidden\?:\s*boolean/);
  });

  it("strip layout backward-compat: actions?: ReactNode still in props", () => {
    expect(canonicalSrc).toMatch(/actions\?:\s*ReactNode/);
  });
});

// ── 2. Card layout structure ────────────────────────────────────────

describe("CanonicalDetailHeader — card layout structure", () => {
  it("card layout has two-column flex (column on mobile, row on lg)", () => {
    expect(canonicalSrc).toMatch(
      /flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between/,
    );
  });

  it("card layout left column is flex-1 min-w-0 max-w-2xl", () => {
    expect(canonicalSrc).toMatch(/flex-1 min-w-0 max-w-2xl/);
  });

  it("card layout right column is shrink-0 flex flex-col items-end gap-3", () => {
    expect(canonicalSrc).toMatch(/shrink-0 flex flex-col items-end gap-3/);
  });

  it("card layout meta grid wraps with flex-wrap justify-end", () => {
    expect(canonicalSrc).toMatch(
      /flex items-start gap-x-6 gap-y-3 flex-wrap justify-end/,
    );
  });

  it("card layout outer chrome uses canonical card tokens (bg-card border-card-border shadow-card overflow-hidden)", () => {
    expect(canonicalSrc).toMatch(
      /rounded-md border bg-card border-card-border shadow-card overflow-hidden/,
    );
  });

  it("card layout outer chrome element has data-testid={testId}", () => {
    expect(canonicalSrc).toMatch(/data-testid=\{testId\}/);
  });

  it("card layout actions cluster testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-actions`/);
  });

  it("card layout right column testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-right`/);
  });

  it("card layout item testids use the testId prefix pattern", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-item-\$\{it\.key\}`/);
  });

  it("card layout description section testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-description`/);
  });

  it("card layout back-arrow button testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-back`/);
  });

  it("card layout client link testid uses the testId prefix", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-client`/);
  });

  it("editFooter prop exists and CDH wraps it with border-t chrome (Task 4 — callers pass content only)", () => {
    expect(canonicalSrc).toMatch(/editFooter\?:\s*ReactNode/);
    // CDH renders editFooter inside its own wrapper — not a bare {editFooter}
    expect(canonicalSrc).toMatch(/`\$\{testId\}-footer`/);
    expect(canonicalSrc).toMatch(/border-t border-card-border px-5 py-3/);
  });

  it("InlineDescriptionEditor sub-component exists in CDH source (Task 4)", () => {
    expect(canonicalSrc).toMatch(/function InlineDescriptionEditor/);
  });

  it("card layout headerAlert renders inside card chrome with its own container (Task 4)", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-alert`/);
  });

  it("workflowSlot is wrapped in CDH's own flex container (Task 4 — no caller wrapper needed)", () => {
    expect(canonicalSrc).toMatch(/`\$\{testId\}-workflow`/);
  });

  it("renderHeaderAction helper function exists for mapping HeaderAction[] to buttons", () => {
    expect(canonicalSrc).toMatch(/function renderHeaderAction/);
  });

  it("card layout filters hidden items via action.hidden check", () => {
    expect(canonicalSrc).toMatch(/action\.hidden/);
  });

  it("card layout filters hidden overflow items", () => {
    // overflowActions?.filter((a) => !a.hidden)
    expect(canonicalSrc).toMatch(/\.filter\(\(a\)\s*=>\s*!a\.hidden\)/);
  });
});

// ── 3. Strip layout backward-compat ────────────────────────────────

describe("CanonicalDetailHeader — strip layout backward-compat", () => {
  it("strip layout has bg-app-bg background (not bg-card)", () => {
    expect(canonicalSrc).toMatch(/bg-app-bg/);
  });

  it("strip layout has vertical dividers between items (h-7 w-px bg-card-border)", () => {
    expect(canonicalSrc).toMatch(/h-7 w-px bg-card-border/);
  });

  it("statusChip ?? statusBadge alias resolution is in the component body", () => {
    expect(canonicalSrc).toMatch(/statusChip\s*\?\?\s*statusBadge/);
  });
});

// ── 4. Consuming pages: InvoiceDetailPage (strip) ──────────────────

describe("InvoiceDetailPage — already uses CanonicalDetailHeader (strip)", () => {
  it("imports CanonicalDetailHeader", () => {
    expect(invoiceSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("renders <CanonicalDetailHeader …> JSX", () => {
    expect(invoiceSrc).toMatch(/<CanonicalDetailHeader\b/);
  });

  it("uses strip layout (no explicit layout='card')", () => {
    expect(invoiceSrc).not.toMatch(/layout="card"/);
  });

  it("passes testId='invoice-detail-header'", () => {
    expect(invoiceSrc).toMatch(/testId="invoice-detail-header"/);
  });

  it("passes statusBadge or statusChip with StatusPill and invoice status", () => {
    expect(invoiceSrc).toMatch(/status(?:Badge|Chip)=\{/);
    expect(invoiceSrc).toMatch(/StatusPill/);
  });

  it("passes items array with invoice-number, due-date, job-number keys", () => {
    expect(invoiceSrc).toMatch(/key:\s*["']invoice-number["']/);
    expect(invoiceSrc).toMatch(/key:\s*["']due-date["']/);
    expect(invoiceSrc).toMatch(/key:\s*["']job-number["']/);
  });
});

// ── 5. Consuming pages: JobDetailPage (card, structured props) ──────

describe("JobDetailPage — uses CanonicalDetailHeader with layout='card' and structured props (Task 3)", () => {
  const codeOnly = stripComments(jobSrc);

  it("imports CanonicalDetailHeader", () => {
    expect(jobSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports HeaderAction and HeaderOverflowItem types", () => {
    expect(jobSrc).toMatch(/\bHeaderAction\b/);
    expect(jobSrc).toMatch(/\bHeaderOverflowItem\b/);
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …>", () => {
    expect(jobSrc).toMatch(/<CanonicalDetailHeader\b/);
    expect(jobSrc).toMatch(/layout="card"/);
  });

  it("passes testId='job-detail-header'", () => {
    expect(jobSrc).toMatch(/testId="job-detail-header"/);
  });

  it("passes clientName= (not clientSlot=)", () => {
    expect(codeOnly).toMatch(/clientName=/);
    expect(codeOnly).not.toMatch(/clientSlot=/);
  });

  it("passes addressLines= (not addressSlot=)", () => {
    expect(codeOnly).toMatch(/addressLines=/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
  });

  it("passes onEdit={enterHeaderEdit} (not an inline Pencil button in actions JSX)", () => {
    expect(codeOnly).toMatch(/onEdit=\{enterHeaderEdit\}/);
  });

  it("passes primaryActions={[…]} structured array", () => {
    expect(codeOnly).toMatch(/primaryActions=\{/);
  });

  it("passes overflowActions={[…]} structured array", () => {
    expect(codeOnly).toMatch(/overflowActions=\{/);
  });

  it("does NOT pass actions={<>…</>} as a ReactNode slot in card mode", () => {
    expect(codeOnly).not.toMatch(/actions=\{<>/);
  });

  it("passes description={job.description} as string (not ReactNode)", () => {
    expect(codeOnly).toMatch(/description=\{/);
    expect(jobSrc).toMatch(/job\.description/);
  });

  it("passes descriptionEditContent for edit-mode textarea (Task 4 — canonical prop name)", () => {
    expect(codeOnly).toMatch(/descriptionEditContent=\{/);
    expect(jobSrc).toMatch(/data-testid="textarea-job-description"/);
  });

  it("passes editFooter={…} content only — CDH owns the border-t chrome (Task 4)", () => {
    expect(codeOnly).toMatch(/editFooter=\{/);
    // CDH's wrapper testid is job-detail-header-footer; page provides button testids only
    expect(jobSrc).toMatch(/data-testid="button-header-save"/);
    expect(jobSrc).toMatch(/data-testid="button-header-cancel"/);
    // No page-level border-t wrapper around editFooter content (CDH owns that chrome)
    expect(codeOnly).not.toMatch(/editFooter=\{[\s\S]*?border-t border-card-border px-5 py-3/);
  });

  it("does NOT use a separate CardShell wrapper for the header card (chrome is canonical)", () => {
    expect(codeOnly).not.toMatch(/<CardShell\s+data-testid="card-job-context"/);
    expect(codeOnly).not.toMatch(/data-testid="card-job-context"/);
  });

  it("passes items array with job-number, scheduled, invoice-number", () => {
    expect(jobSrc).toMatch(/key:\s*["']job-number["']/);
    expect(jobSrc).toMatch(/key:\s*["']scheduled["']/);
    expect(jobSrc).toMatch(/key:\s*["']invoice-number["']/);
  });

  it("primary action testids are present in the primaryActions array expression", () => {
    // In the structured API, testIds are `testId:` values (not `data-testid=`)
    expect(jobSrc).toMatch(/testId:\s*["']button-schedule-visit-action["']/);
    expect(jobSrc).toMatch(/testId:\s*["']button-invoice-action["']/);
    expect(jobSrc).toMatch(/testId:\s*["']button-restore-job["']/);
  });

  it("there is exactly ONE CanonicalDetailHeader mount (no duplicate)", () => {
    const matches = codeOnly.match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly ONE job-detail-header testid (no duplicate)", () => {
    const matches = jobSrc.match(/testId="job-detail-header"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 6. Consuming pages: QuoteHeaderCard (card, structured props) ────

describe("QuoteHeaderCard — thin assembler with structured props (Task 3 2026-05-08)", () => {
  const codeOnly = stripComments(quoteHeaderSrc);

  it("imports CanonicalDetailHeader from @/components/detail/CanonicalDetailHeader", () => {
    expect(quoteHeaderSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports HeaderAction and HeaderOverflowItem types", () => {
    expect(quoteHeaderSrc).toMatch(
      /import\s*\{[^}]*\bHeaderAction\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
    expect(quoteHeaderSrc).toMatch(
      /import\s*\{[^}]*\bHeaderOverflowItem\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports StatusChip from @/components/ui/chip", () => {
    expect(quoteHeaderSrc).toMatch(
      /import\s*\{[^}]*\bStatusChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("imports getQuoteStatusMeta from @/lib/statusBadges", () => {
    expect(quoteHeaderSrc).toMatch(
      /import\s*\{[^}]*\bgetQuoteStatusMeta\b[^}]*\}\s*from\s*["']@\/lib\/statusBadges["']/,
    );
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …>", () => {
    expect(quoteHeaderSrc).toMatch(/<CanonicalDetailHeader\b/);
    expect(quoteHeaderSrc).toMatch(/layout="card"/);
  });

  it("passes testId='quote-detail-header'", () => {
    expect(quoteHeaderSrc).toMatch(/testId="quote-detail-header"/);
  });

  it("passes statusChip (not statusBadge) using StatusChip and getQuoteStatusMeta", () => {
    expect(codeOnly).toMatch(/statusChip=\{/);
    expect(codeOnly).not.toMatch(/statusBadge=\{/);
    expect(quoteHeaderSrc).toMatch(/<StatusChip/);
    expect(quoteHeaderSrc).toMatch(/getQuoteStatusMeta/);
  });

  it("passes clientName= and clientHref= (not clientSlot=)", () => {
    expect(codeOnly).toMatch(/clientName=/);
    expect(codeOnly).toMatch(/clientHref=/);
    expect(codeOnly).not.toMatch(/clientSlot=/);
  });

  it("passes addressLines= and phone= and email= (not addressSlot=)", () => {
    expect(codeOnly).toMatch(/addressLines=/);
    expect(codeOnly).toMatch(/phone=/);
    expect(codeOnly).toMatch(/email=/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
  });

  it("passes primaryActions= as a typed HeaderAction[] array", () => {
    expect(codeOnly).toMatch(/primaryActions=/);
    expect(quoteHeaderSrc).toMatch(/const primaryActions:\s*HeaderAction\[\]/);
  });

  it("passes overflowActions= as a typed HeaderOverflowItem[] array", () => {
    expect(codeOnly).toMatch(/overflowActions=/);
    expect(quoteHeaderSrc).toMatch(/const overflowActions:\s*HeaderOverflowItem\[\]/);
  });

  it("does NOT pass clientSlot, addressSlot, or actionBar as ReactNode slots", () => {
    expect(codeOnly).not.toMatch(/clientSlot=/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
    expect(codeOnly).not.toMatch(/actionBar=\{/);
  });

  it("workflowSlot= is passed with content only — CDH owns flex container (Task 4)", () => {
    expect(codeOnly).toMatch(/workflowSlot=/);
    // CDH generates quote-detail-header-workflow; no page-level flex container div
    expect(codeOnly).not.toMatch(/workflowSlot=\{[\s\S]*?className="flex items-center/);
  });

  it("expiry warning uses headerAlert= prop — no outer wrapper div (Task 4)", () => {
    expect(quoteHeaderSrc).toMatch(/data-testid="quote-expiry-warning"/);
    expect(codeOnly).toMatch(/headerAlert=/);
    // The outer wrapper div pattern is GONE — CDH owns the chrome
    expect(quoteHeaderSrc).not.toMatch(/data-testid="quote-expiry-warning-row"/);
  });

  it("primary CTA testids are in the primaryActions array", () => {
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-send-quote["']/);
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-approve-quote["']/);
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-decline-quote["']/);
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-convert-to-job["']/);
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-preview-pdf["']/);
    expect(quoteHeaderSrc).toMatch(/testId:\s*["']button-apply-template["']/);
  });

  it("accepts description=, onDescriptionSave=, isDescriptionSaving= (Task 4 — CDH manages edit state)", () => {
    // Interface accepts these instead of descriptionEditNode (Task 4)
    expect(quoteHeaderSrc).toMatch(/onDescriptionSave\?/);
    expect(quoteHeaderSrc).toMatch(/isDescriptionSaving\?/);
    expect(codeOnly).toMatch(/onDescriptionSave=/);
    expect(codeOnly).toMatch(/description=/);
    // No descriptionEditNode prop any more
    expect(codeOnly).not.toMatch(/descriptionEditNode=/);
  });

  it("passes items array with quote-number, issued, expiry, total keys", () => {
    expect(quoteHeaderSrc).toMatch(/key:\s*["']quote-number["']/);
    expect(quoteHeaderSrc).toMatch(/key:\s*["']issued["']/);
    expect(quoteHeaderSrc).toMatch(/key:\s*["']expiry["']/);
    expect(quoteHeaderSrc).toMatch(/key:\s*["']total["']/);
  });

  it("passes sent-at, approved-at, declined-at items with hidden: !sentAt/approvedAt/declinedAt", () => {
    expect(quoteHeaderSrc).toMatch(/key:\s*["']sent-at["']/);
    expect(quoteHeaderSrc).toMatch(/key:\s*["']approved-at["']/);
    expect(quoteHeaderSrc).toMatch(/key:\s*["']declined-at["']/);
    expect(quoteHeaderSrc).toMatch(/hidden:\s*!sentAt/);
    expect(quoteHeaderSrc).toMatch(/hidden:\s*!approvedAt/);
    expect(quoteHeaderSrc).toMatch(/hidden:\s*!declinedAt/);
  });

  it("passes from-lead item with hidden: !quote.leadId and originating-lead testid", () => {
    expect(quoteHeaderSrc).toMatch(/key:\s*["']from-lead["']/);
    expect(quoteHeaderSrc).toMatch(/hidden:\s*!quote\.leadId/);
    expect(quoteHeaderSrc).toMatch(/data-testid="link-quote-originating-lead"/);
  });

  it("there is exactly ONE CanonicalDetailHeader mount (no duplicate)", () => {
    const matches = codeOnly.match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 7. Consuming pages: LeadSummaryCard (card — saved mode) ─────────

describe("LeadSummaryCard — saved mode uses structured props (Task 3 2026-05-08)", () => {
  const codeOnly = stripComments(leadSummaryCardSrc);

  it("imports CanonicalDetailHeader from @/components/detail/CanonicalDetailHeader", () => {
    expect(leadSummaryCardSrc).toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports HeaderAction and HeaderOverflowItem types", () => {
    expect(leadSummaryCardSrc).toMatch(
      /import\s*\{[^}]*\bHeaderAction\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
    expect(leadSummaryCardSrc).toMatch(
      /import\s*\{[^}]*\bHeaderOverflowItem\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("imports StatusChip from @/components/ui/chip", () => {
    expect(leadSummaryCardSrc).toMatch(
      /import\s*\{[^}]*\bStatusChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("imports getLeadStatusMeta from @/lib/statusBadges", () => {
    expect(leadSummaryCardSrc).toMatch(
      /import\s*\{[^}]*\bgetLeadStatusMeta\b[^}]*\}\s*from\s*["']@\/lib\/statusBadges["']/,
    );
  });

  it("renders <CanonicalDetailHeader layout=\"card\" …> in saved mode", () => {
    expect(leadSummaryCardSrc).toMatch(/<CanonicalDetailHeader\b/);
    expect(leadSummaryCardSrc).toMatch(/layout="card"/);
  });

  it("passes testId='lead-detail-header'", () => {
    expect(leadSummaryCardSrc).toMatch(/testId="lead-detail-header"/);
  });

  it("passes entityLabel=\"Lead\"", () => {
    expect(leadSummaryCardSrc).toMatch(/entityLabel="Lead"/);
  });

  it("passes statusChip (not statusBadge) using StatusChip and getLeadStatusMeta", () => {
    expect(codeOnly).toMatch(/statusChip=\{/);
    expect(codeOnly).not.toMatch(/statusBadge=\{/);
    expect(leadSummaryCardSrc).toMatch(/<StatusChip/);
    expect(leadSummaryCardSrc).toMatch(/getLeadStatusMeta/);
  });

  it("passes clientName= and contactName= (not clientSlot=)", () => {
    expect(codeOnly).toMatch(/clientName=/);
    expect(codeOnly).toMatch(/contactName=/);
    expect(codeOnly).not.toMatch(/clientSlot=/);
  });

  it("passes addressLines=, phone=, email= (not addressSlot=)", () => {
    expect(codeOnly).toMatch(/addressLines=/);
    expect(codeOnly).toMatch(/phone=/);
    expect(codeOnly).toMatch(/email=/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
  });

  it("passes primaryActions= as a typed HeaderAction[] array (not actions={<>…</>})", () => {
    expect(codeOnly).toMatch(/primaryActions=/);
    expect(leadSummaryCardSrc).toMatch(/const primaryActions:\s*HeaderAction\[\]/);
    expect(codeOnly).not.toMatch(/actions=\{<>/);
  });

  it("passes overflowActions= as a typed HeaderOverflowItem[] array", () => {
    expect(codeOnly).toMatch(/overflowActions=/);
    expect(leadSummaryCardSrc).toMatch(/const overflowActions:\s*HeaderOverflowItem\[\]/);
  });

  it("does NOT pass clientSlot, addressSlot, or actionBar as ReactNode slots", () => {
    expect(codeOnly).not.toMatch(/clientSlot=/);
    expect(codeOnly).not.toMatch(/addressSlot=/);
    expect(codeOnly).not.toMatch(/actionBar=\{/);
  });

  it("action testIds are in the primaryActions and overflowActions arrays", () => {
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-convert-to-quote["']/);
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-mark-contacted["']/);
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-mark-lost["']/);
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-archive-lead["']/);
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-hard-delete-lead["']/);
    expect(leadSummaryCardSrc).toMatch(/testId:\s*["']button-view-quote["']/);
  });

  it("SavedProps accepts description + onDescriptionSave + isDescriptionSaving (Task 4 — CDH manages edit state)", () => {
    expect(leadSummaryCardSrc).toMatch(/onDescriptionSave\?/);
    expect(leadSummaryCardSrc).toMatch(/isDescriptionSaving\?/);
    expect(codeOnly).toMatch(/onDescriptionSave=/);
    expect(codeOnly).toMatch(/description=/);
    // descriptionEditNode replaced by structured props
    expect(codeOnly).not.toMatch(/descriptionEditNode=/);
  });

  it("items array has source and priority keys", () => {
    expect(leadSummaryCardSrc).toMatch(/key:\s*["']source["']/);
    expect(leadSummaryCardSrc).toMatch(/key:\s*["']priority["']/);
  });

  it("priority item uses hidden: !lead.priority (read-mode filtering)", () => {
    expect(leadSummaryCardSrc).toMatch(/hidden:\s*!lead\.priority/);
  });

  it("there is exactly ONE CanonicalDetailHeader mount in saved mode", () => {
    const matches = codeOnly.match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 8. Draft mode intentionally unchanged ──────────────────────────

describe("LeadSummaryCard — draft mode intentionally not migrated to structured props", () => {
  it("draft mode still renders the editable title input (input-lead-title)", () => {
    expect(leadSummaryCardSrc).toMatch(/data-testid="input-lead-title"/);
  });

  it("draft mode still renders the priority select (select-priority)", () => {
    expect(leadSummaryCardSrc).toMatch(/data-testid="select-priority"/);
  });

  it("draft mode still renders the required indicator (lead-title-required-indicator)", () => {
    expect(leadSummaryCardSrc).toMatch(/data-testid="lead-title-required-indicator"/);
  });

  it("file documents the draft-mode deferral reason (audit note present)", () => {
    expect(leadSummaryCardSrc).toMatch(/[Ii]ntentionally not migrated/);
  });
});

// ── 9. No duplicate canonical headers ──────────────────────────────

describe("Detail header — no duplicate canonical headers", () => {
  it("there is exactly one CanonicalDetailHeader mount in InvoiceDetailPage", () => {
    const matches = stripComments(invoiceSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly one CanonicalDetailHeader mount in JobDetailPage", () => {
    const matches = stripComments(jobSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly one CanonicalDetailHeader mount in LeadSummaryCard", () => {
    const matches = stripComments(leadSummaryCardSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly one CanonicalDetailHeader mount in QuoteHeaderCard", () => {
    const matches = stripComments(quoteHeaderSrc).match(/<CanonicalDetailHeader\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ── 10. Task 4 ownership — callers pass data not chrome ──────────────

describe("QuoteDetailPage — passes description + onDescriptionSave to QuoteHeaderCard (Task 4)", () => {
  const codeOnly = stripComments(quoteDetailSrc);

  it("uses onDescriptionSave= (not descriptionEditNode=) when calling QuoteHeaderCard", () => {
    expect(codeOnly).toMatch(/onDescriptionSave=/);
    expect(codeOnly).not.toMatch(/descriptionEditNode=/);
  });

  it("does NOT import or use QuoteDescriptionCard (CDH's InlineDescriptionEditor handles it)", () => {
    expect(quoteDetailSrc).not.toMatch(/QuoteDescriptionCard/);
  });

  it("passes updateDescriptionMutation.mutateAsync as the onDescriptionSave callback", () => {
    expect(quoteDetailSrc).toMatch(/updateDescriptionMutation/);
    expect(quoteDetailSrc).toMatch(/onDescriptionSave/);
  });
});

describe("LeadDetailPage — passes description + onDescriptionSave to LeadSummaryCard (Task 4)", () => {
  const codeOnly = stripComments(leadDetailSrc);

  it("uses onDescriptionSave= (not descriptionEditNode=)", () => {
    expect(codeOnly).toMatch(/onDescriptionSave=/);
    expect(codeOnly).not.toMatch(/descriptionEditNode=/);
  });

  it("description edit state removed from page (CDH's InlineDescriptionEditor manages it)", () => {
    expect(leadDetailSrc).not.toMatch(/editingDescription/);
    expect(leadDetailSrc).not.toMatch(/descriptionDraft/);
  });

  it("updateDescriptionMutation still on page — passed as callback to LeadSummaryCard", () => {
    expect(leadDetailSrc).toMatch(/updateDescriptionMutation/);
  });

  it("isTerminal check gates onDescriptionSave (terminal leads are read-only)", () => {
    expect(leadDetailSrc).toMatch(/isTerminal/);
    expect(leadDetailSrc).toMatch(/onDescriptionSave.*isTerminal|isTerminal.*onDescriptionSave/);
  });

  it("lead-description-section testid removed (CDH owns description section chrome)", () => {
    expect(leadDetailSrc).not.toMatch(/data-testid="lead-description-section"/);
  });
});

// ── 11. InlineDescriptionEditor error handling regression (2026-05-09) ────────
// Regression guard: InlineDescriptionEditor.handleSave must catch rejected
// onSave Promises so that a network failure (mutateAsync throws) does NOT
// propagate as an unhandled Promise rejection that crashes the subtree.
// React 18 can escalate unhandled async errors from event handlers into
// component tree crashes, which would manifest as empty list pages and
// "Failed to load" dashboard states via React Query cache corruption.

describe("InlineDescriptionEditor — handleSave catches onSave rejections (regression 2026-05-09)", () => {
  it("handleSave wraps await onSave in a try/catch block", () => {
    // Must have try { await onSave(... } catch — no bare await without catch
    expect(canonicalSrc).toMatch(/try\s*\{[\s\S]*await onSave\([\s\S]*\}\s*catch/);
  });

  it("catch block does NOT rethrow — keeps editing state on save failure", () => {
    // The catch block must not re-throw (empty catch or swallowed error)
    // so the component stays in editing mode when the network fails.
    expect(canonicalSrc).toMatch(/catch\s*\{[^}]*\}/);
    // No `throw` inside the catch block
    const catchMatch = canonicalSrc.match(/catch\s*\{([^}]*)\}/);
    if (catchMatch) {
      expect(catchMatch[1]).not.toMatch(/\bthrow\b/);
    }
  });

  it("setEditing(false) is inside the try block so it only runs on success", () => {
    // setEditing(false) and setDraft("") must appear INSIDE the try block
    // (before catch), guaranteeing editing mode persists on failure.
    expect(canonicalSrc).toMatch(/try\s*\{[\s\S]*setEditing\(false\)[\s\S]*\}\s*catch/);
  });
});
