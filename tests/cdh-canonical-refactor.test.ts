/**
 * CDH canonical refactor — source-pin tests (2026-05-09).
 *
 * Proves the 2026-05-09 architectural refactor landed correctly:
 *   - CDH is card-only (strip layout removed)
 *   - All ReactNode escape hatches replaced with typed descriptors
 *   - Invoice uses CanonicalDetailHeader (InvoiceDetailStrip deleted 2026-05-09)
 *   - Quote uses descriptor workflow (canonical Select, not native select)
 *   - Quote passes full address (city/province/postal)
 *   - Header adapters carry no raw color tokens
 *   - CDH renders StatusChip internally from descriptor
 *
 * Behavioral normalization (2026-05-09 follow-up):
 *   - editCapability replaces onEdit/editAriaLabel (pencil for all entities)
 *   - descriptionEdit typed descriptor replaces descriptionEditContent ReactNode
 *   - subtitleEdit added for Quote inline title edit
 *   - All three entities (Job/Quote/Lead) pass editCapability
 *
 * Uses the source-pin pattern (grep source text rather than run React)
 * matching the project's existing test convention.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const CDH_PATH = resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx");
const INVOICE_PAGE_PATH = resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx");
const NEW_INVOICE_PAGE_PATH = resolve(ROOT, "client/src/pages/NewInvoicePage.tsx");
const QUOTE_CARD_PATH = resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx");
const LEAD_CARD_PATH = resolve(ROOT, "client/src/components/leads/LeadSummaryCard.tsx");
const JOB_PAGE_PATH = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const QUOTE_PAGE_PATH = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const LEAD_PAGE_PATH = resolve(ROOT, "client/src/pages/LeadDetailPage.tsx");

const cdhSrc = readFileSync(CDH_PATH, "utf-8");
const invoicePageSrc = readFileSync(INVOICE_PAGE_PATH, "utf-8");
const newInvoicePageSrc = readFileSync(NEW_INVOICE_PAGE_PATH, "utf-8");
const quoteCardSrc = readFileSync(QUOTE_CARD_PATH, "utf-8");
const leadCardSrc = readFileSync(LEAD_CARD_PATH, "utf-8");
const jobPageSrc = readFileSync(JOB_PAGE_PATH, "utf-8");
const quotePageSrc = readFileSync(QUOTE_PAGE_PATH, "utf-8");
const leadPageSrc = readFileSync(LEAD_PAGE_PATH, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const cdhCode = stripComments(cdhSrc);
const quoteCode = stripComments(quoteCardSrc);

// ── 1. CDH is card-only ──────────────────────────────────────────────

describe("CDH is card-only — strip layout removed", () => {
  it("CDH props interface does NOT include a layout property", () => {
    expect(cdhCode).not.toMatch(/layout\?\s*:\s*["']strip["']/);
    expect(cdhCode).not.toMatch(/layout\s*=\s*["']strip["']/);
  });

  it("CDH source does NOT mention strip layout branch", () => {
    expect(cdhCode).not.toMatch(/layout\s*===\s*["']strip["']/);
  });

  it("InvoiceDetailPage uses CanonicalDetailHeader (migrated from InvoiceDetailStrip)", () => {
    expect(invoicePageSrc).toMatch(/CanonicalDetailHeader/);
    expect(invoicePageSrc).not.toMatch(/layout=["']strip["']/);
  });

  it("NewInvoicePage uses CanonicalCreateHeader (migrated 2026-05-09)", () => {
    expect(newInvoicePageSrc).toMatch(/CanonicalCreateHeader/);
    expect(newInvoicePageSrc).not.toMatch(/InvoiceDetailStrip/);
  });
});

// ── 2. CDH uses typed status descriptor — no ReactNode statusChip ────

describe("CDH status — typed descriptor, CDH renders StatusChip", () => {
  it("CDH does NOT expose statusChip prop", () => {
    expect(cdhCode).not.toMatch(/statusChip\s*\?/);
  });

  it("CDH does NOT expose statusBadge prop", () => {
    expect(cdhCode).not.toMatch(/statusBadge\s*\?/);
  });

  it("CDH defines StatusDescriptor with label and tone", () => {
    expect(cdhSrc).toMatch(/StatusDescriptor/);
    expect(cdhSrc).toMatch(/label:\s*string/);
    expect(cdhSrc).toMatch(/tone:\s*ChipTone/);
  });

  it("CDH imports StatusChip from chip primitive", () => {
    expect(cdhSrc).toMatch(/StatusChip.*from.*chip/);
  });

  it("CDH renders StatusChip using status.tone", () => {
    expect(cdhCode).toMatch(/StatusChip[\s\S]{0,50}tone=\{status\.tone\}/);
  });
});

// ── 3. CDH uses typed alert descriptor — no ReactNode headerAlert ────

describe("CDH alert — typed descriptor, no ReactNode headerAlert prop", () => {
  it("CDH does NOT expose headerAlert prop", () => {
    expect(cdhCode).not.toMatch(/headerAlert\s*\?/);
  });

  it("CDH defines AlertDescriptor", () => {
    expect(cdhSrc).toMatch(/AlertDescriptor/);
    expect(cdhSrc).toMatch(/AlertTone/);
    expect(cdhSrc).toMatch(/AlertIcon/);
  });

  it("CDH ALERT_TONE_CLASS maps warning to text-warning-foreground (semantic token, WCAG AA)", () => {
    // 2026-05-09 Phase 3.1: replaced text-amber-700 (2.18:1, inaccessible) with
    // text-warning-foreground (~4.88:1, passes WCAG AA on light backgrounds).
    expect(cdhSrc).toMatch(/warning.*text-warning-foreground/);
  });
});

// ── 4. CDH uses typed workflow descriptor — no native select ─────────

describe("CDH workflow — typed descriptor, canonical Select primitive", () => {
  it("CDH does NOT expose workflowSlot prop", () => {
    expect(cdhCode).not.toMatch(/workflowSlot\s*\?/);
  });

  it("CDH defines WorkflowDescriptor", () => {
    expect(cdhSrc).toMatch(/WorkflowDescriptor/);
    expect(cdhSrc).toMatch(/kind:\s*["']quote-owner-assessment["']/);
  });

  it("CDH renders canonical Select (not native select) for workflow", () => {
    expect(cdhSrc).toMatch(/SelectTrigger/);
    expect(cdhSrc).toMatch(/SelectContent/);
    expect(cdhSrc).toMatch(/SelectItem/);
    // No native <select> element
    expect(cdhCode).not.toMatch(/<select[\s>]/);
  });
});

// ── 5. CDH uses typed edit descriptors — no ReactNode escape hatches ──

describe("CDH editControls and titleEdit — no ReactNode escape hatches", () => {
  it("CDH does NOT expose editFooter prop", () => {
    expect(cdhCode).not.toMatch(/editFooter\s*\?/);
  });

  it("CDH does NOT expose titleEditNode prop", () => {
    expect(cdhCode).not.toMatch(/titleEditNode\s*\?/);
  });

  it("CDH defines HeaderEditControls descriptor", () => {
    expect(cdhSrc).toMatch(/HeaderEditControls/);
    expect(cdhSrc).toMatch(/onSave:\s*\(\)\s*=>/);
    expect(cdhSrc).toMatch(/onCancel:\s*\(\)\s*=>/);
  });

  it("CDH defines HeaderTitleEdit descriptor", () => {
    expect(cdhSrc).toMatch(/HeaderTitleEdit/);
    expect(cdhSrc).toMatch(/onChange:\s*\(value:\s*string\)\s*=>/);
  });

  it("CDH renders autoFocus input (not textarea) when titleEdit is defined", () => {
    expect(cdhCode).toMatch(/titleEdit\s*!==\s*undefined/);
    expect(cdhCode).toMatch(/autoFocus/);
    expect(cdhCode).toMatch(/titleEdit\.onChange/);
  });

  it("CDH titleEdit renders <input type=\"text\"> — no scrollbar possible", () => {
    // Guard against regression to textarea (which shows a scrollbar on creation pages).
    // titleEdit is single-line by design; input is the correct element.
    const titleEditBlock = cdhSrc.slice(
      cdhSrc.indexOf("titleEdit !== undefined"),
      cdhSrc.indexOf("subtitleEdit !== undefined"),
    );
    expect(titleEditBlock).toMatch(/<input/);
    expect(titleEditBlock).not.toMatch(/<textarea/);
  });
});

// ── 6. Quote uses descriptor workflow, not native select ─────────────

describe("QuoteHeaderCard — workflow uses WorkflowDescriptor", () => {
  it("QuoteHeaderCard does NOT contain native <select> element", () => {
    expect(quoteCode).not.toMatch(/<select[\s>]/);
  });

  it("QuoteHeaderCard builds workflowDescriptor object", () => {
    expect(quoteCardSrc).toMatch(/workflowDescriptor/);
    expect(quoteCardSrc).toMatch(/kind:\s*["']quote-owner-assessment["']/);
  });

  it("QuoteHeaderCard does NOT pass workflowSlot to CDH", () => {
    expect(quoteCode).not.toMatch(/workflowSlot=/);
  });

  it("QuoteHeaderCard passes workflow={workflowDescriptor}", () => {
    expect(quoteCardSrc).toMatch(/workflow=\{workflowDescriptor\}/);
  });
});

// ── 7. Quote passes full address ─────────────────────────────────────

describe("QuoteHeaderCard — full address (city/province/postal included)", () => {
  it("QuoteHeaderCard references location.city", () => {
    expect(quoteCardSrc).toMatch(/location\.city/);
  });

  it("QuoteHeaderCard references location.province", () => {
    expect(quoteCardSrc).toMatch(/location\.province/);
  });

  it("QuoteHeaderCard references location.postalCode", () => {
    expect(quoteCardSrc).toMatch(/location\.postalCode/);
  });
});

// ── 8. No raw color tokens in header adapters ────────────────────────

describe("Header adapters — no raw Tailwind color tokens", () => {
  it("QuoteHeaderCard does NOT use text-amber-700", () => {
    expect(quoteCode).not.toMatch(/text-amber-700/);
  });

  it("QuoteHeaderCard does NOT use a native alert span with amber", () => {
    expect(quoteCode).not.toMatch(/className.*amber/);
  });

  it("QuoteHeaderCard does NOT pass statusChip prop (uses status descriptor)", () => {
    expect(quoteCode).not.toMatch(/statusChip=/);
  });

  it("LeadSummaryCard does NOT pass statusChip prop (uses status descriptor)", () => {
    expect(stripComments(leadCardSrc)).not.toMatch(/statusChip=/);
  });

  it("JobDetailPage does NOT pass statusChip prop (uses status descriptor)", () => {
    expect(stripComments(jobPageSrc)).not.toMatch(/statusChip=/);
  });
});

// ── 9. All entities use CDH ───────────────────────────────────────────

describe("Entity → renderer mapping", () => {
  it("QuoteHeaderCard uses CDH (no layout prop — card is now the only mode)", () => {
    expect(quoteCardSrc).toMatch(/CanonicalDetailHeader/);
    expect(quoteCode).not.toMatch(/layout=/);
  });

  it("LeadSummaryCard uses CDH", () => {
    expect(leadCardSrc).toMatch(/CanonicalDetailHeader/);
    expect(stripComments(leadCardSrc)).not.toMatch(/layout=/);
  });

  it("JobDetailPage uses CDH", () => {
    expect(jobPageSrc).toMatch(/CanonicalDetailHeader/);
    expect(stripComments(jobPageSrc)).not.toMatch(/layout=/);
  });

  it("InvoiceDetailPage uses CDH directly (migrated 2026-05-09)", () => {
    expect(invoicePageSrc).toMatch(/CanonicalDetailHeader/);
    expect(invoicePageSrc).not.toMatch(/InvoiceDetailStrip/);
  });
});

// ── 10. Deprecated aliases removed from CDH ──────────────────────────

describe("CDH deprecated aliases removed", () => {
  it("CDH does NOT define descriptionEditNode alias", () => {
    expect(cdhCode).not.toMatch(/descriptionEditNode\s*\?/);
  });

  it("CDH does NOT define actions prop (strip-only prop removed)", () => {
    expect(cdhCode).not.toMatch(/actions\s*\?:\s*ReactNode/);
  });
});

// ── 11. editCapability replaces onEdit/editAriaLabel ─────────────────

describe("CDH editCapability — typed pencil descriptor", () => {
  it("CDH does NOT expose onEdit prop (standalone, not part of descriptionEdit)", () => {
    // Use word boundary so descriptionEdit?:/subtitleEdit? don't false-positive.
    expect(cdhCode).not.toMatch(/\bonEdit\s*\?\s*:/);
  });

  it("CDH does NOT expose editAriaLabel prop", () => {
    expect(cdhCode).not.toMatch(/editAriaLabel\s*\?/);
  });

  it("CDH defines HeaderEditCapability with enabled and onStartEdit", () => {
    expect(cdhSrc).toMatch(/HeaderEditCapability/);
    expect(cdhSrc).toMatch(/enabled:\s*boolean/);
    expect(cdhSrc).toMatch(/onStartEdit\s*\?/);
  });

  it("CDH renders pencil from editCapability.enabled", () => {
    expect(cdhCode).toMatch(/editCapability\?\.enabled/);
    expect(cdhCode).toMatch(/editCapability\.onStartEdit/);
  });
});

// ── 12. descriptionEdit typed descriptor — no ReactNode escape hatch ──

describe("CDH descriptionEdit — typed descriptor, CDH owns textarea", () => {
  it("CDH does NOT expose descriptionEditContent prop", () => {
    expect(cdhCode).not.toMatch(/descriptionEditContent\s*\?/);
  });

  it("CDH defines HeaderDescriptionEdit descriptor", () => {
    expect(cdhSrc).toMatch(/HeaderDescriptionEdit/);
  });

  it("CDH renders textarea from descriptionEdit descriptor", () => {
    expect(cdhCode).toMatch(/descriptionEdit\s*!==\s*undefined/);
    expect(cdhCode).toMatch(/descriptionEdit\.onChange/);
    expect(cdhCode).toMatch(/descriptionEdit\.testId/);
  });
});

// ── 13. titleEdit — Quote inline title edit (2026-05-09 parity fix) ──────
// Root cause: Quote used subtitleEdit (muted small text, subtle) instead of
// titleEdit (H1 textarea, same prominence as Job). Fix: project name is now
// the primary title; quote number is the subtitle. Mirrors Job exactly.

describe("CDH subtitleEdit — prop still exists in CDH interface", () => {
  it("CDH defines subtitleEdit prop", () => {
    expect(cdhSrc).toMatch(/subtitleEdit\s*\?/);
  });

  it("CDH renders subtitle input from subtitleEdit descriptor", () => {
    expect(cdhCode).toMatch(/subtitleEdit\s*!==\s*undefined/);
    expect(cdhCode).toMatch(/subtitleEdit\.onChange/);
  });

  it("QuoteHeaderCard passes titleEdit (not subtitleEdit) when isHeaderEditing", () => {
    // 2026-05-09 parity fix: Quote uses titleEdit so the H1 area becomes
    // editable on pencil click — same visual weight as Job.
    expect(quoteCardSrc).toMatch(/titleEdit=/);
    expect(quoteCardSrc).not.toMatch(/subtitleEdit=/);
    expect(quoteCardSrc).toMatch(/isHeaderEditing/);
  });

  it("QuoteHeaderCard does NOT use entityLabel, subtitle, or onBack — matches Job identity model", () => {
    // Job uses none of these: H1 starts directly at title, no row above it.
    // Quote must follow the same model. Quote number stays only in items grid.
    // onBack omitted from CDH call so Quote doesn't render an extra row above H1.
    expect(quoteCardSrc).not.toMatch(/entityLabel=/);
    expect(quoteCardSrc).not.toMatch(/subtitle=\{/);
    // Confirm onBack is not forwarded to CDH (the comment line mentioning it is ok)
    expect(quoteCardSrc).not.toMatch(/^\s*onBack=\{/m);
  });
});

// ── 14. All three entities pass editCapability ────────────────────────

describe("All entities pass editCapability — pencil appears consistently", () => {
  it("JobDetailPage passes editCapability to CDH", () => {
    expect(jobPageSrc).toMatch(/editCapability=/);
    expect(jobPageSrc).toMatch(/onStartEdit.*enterHeaderEdit|enterHeaderEdit.*onStartEdit/);
  });

  it("JobDetailPage does NOT use old onEdit prop", () => {
    // The old onEdit={enterHeaderEdit} pattern should be gone
    expect(jobPageSrc).not.toMatch(/onEdit=\{enterHeaderEdit\}/);
  });

  it("JobDetailPage passes descriptionEdit instead of descriptionEditContent", () => {
    expect(jobPageSrc).toMatch(/descriptionEdit=/);
    expect(jobPageSrc).not.toMatch(/descriptionEditContent=/);
  });

  it("QuoteHeaderCard passes editCapability to CDH", () => {
    expect(quoteCardSrc).toMatch(/editCapability=/);
    expect(quoteCardSrc).toMatch(/onStartEdit.*onStartHeaderEdit|onStartHeaderEdit/);
  });

  it("QuoteDetailPage wires onStartHeaderEdit and title mutation", () => {
    expect(quotePageSrc).toMatch(/onStartHeaderEdit/);
    expect(quotePageSrc).toMatch(/updateTitleMutation/);
    expect(quotePageSrc).toMatch(/editingHeader/);
  });

  it("LeadSummaryCard passes editCapability to CDH", () => {
    expect(leadCardSrc).toMatch(/editCapability=/);
    expect(leadCardSrc).toMatch(/onStartEdit.*onStartHeaderEdit|onStartHeaderEdit/);
  });

  it("LeadDetailPage wires onStartHeaderEdit and header mutation", () => {
    expect(leadPageSrc).toMatch(/onStartHeaderEdit/);
    expect(leadPageSrc).toMatch(/updateHeaderMutation/);
    expect(leadPageSrc).toMatch(/editingHeader/);
  });

  it("LeadSummaryCard passes titleEdit when editing", () => {
    expect(leadCardSrc).toMatch(/titleEdit=/);
    expect(leadCardSrc).toMatch(/isHeaderEditing/);
  });
});

// ── 15. Lead terminal gating — pencil/edit hidden for won/lost leads ──

describe("Lead terminal gating — editCapability disabled for won/lost status", () => {
  const leadCode = stripComments(leadCardSrc);
  const leadPageCode = stripComments(leadPageSrc);

  it("LeadSummaryCard SavedProps declares isTerminal prop", () => {
    expect(leadCardSrc).toMatch(/isTerminal\s*\?/);
  });

  it("LeadSummaryCard derives canEdit from isTerminal", () => {
    expect(leadCode).toMatch(/canEdit\s*=\s*!isTerminal/);
  });

  it("editCapability.enabled uses canEdit — not hardcoded true", () => {
    // enabled: canEdit (not enabled: true)
    expect(leadCode).toMatch(/enabled:\s*canEdit/);
    expect(leadCode).not.toMatch(/enabled:\s*true/);
  });

  it("titleEdit is gated on canEdit — terminal leads cannot enter title edit mode", () => {
    expect(leadCode).toMatch(/canEdit\s*&&\s*isHeaderEditing/);
  });

  it("editControls footer is gated on canEdit — terminal leads show no Save/Cancel", () => {
    // The leadEditControls assignment gates on canEdit && isHeaderEditing
    expect(leadCode).toMatch(/canEdit\s*&&\s*isHeaderEditing[\s\S]{0,30}onSave|canEdit[\s\S]{0,60}onSave/);
  });

  it("LeadDetailPage passes isTerminal to LeadSummaryCard", () => {
    expect(leadPageCode).toMatch(/isTerminal=\{isTerminal\}/);
  });

  it("LeadDetailPage computes isTerminal from won/lost status", () => {
    expect(leadPageSrc).toMatch(/isTerminal\s*=.*won.*lost|isTerminal\s*=.*lost.*won/);
  });

  it("LeadDetailPage uses unified updateHeaderMutation (title + description together)", () => {
    expect(leadPageSrc).toMatch(/updateHeaderMutation/);
    expect(leadPageSrc).not.toMatch(/updateDescriptionMutation/);
  });
});

// ── 16. Final CDH parity — Job / Quote / Lead (2026-05-09 followup) ──────────

describe("CDH final parity — Job, Quote, Lead uniform identity model", () => {
  const leadCardCode = stripComments(leadCardSrc);
  const jobPageCode = stripComments(jobPageSrc);
  const quoteCardCode = stripComments(quoteCardSrc);
  const quotePageCode = stripComments(quotePageSrc);
  const leadPageCode = stripComments(leadPageSrc);

  // Lead: no entityLabel or onBack in saved-mode CDH call
  it("LeadSummaryCard CDH call has no entityLabel prop", () => {
    expect(leadCardCode).not.toMatch(/entityLabel=/);
  });

  it("LeadSummaryCard CDH call has no onBack prop", () => {
    // saved-mode CDH call — onBack should not be forwarded
    expect(leadCardCode).not.toMatch(/^\s*onBack=\{/m);
  });

  it("LeadSummaryCard SavedProps does not declare onBack", () => {
    // onBack is still on DraftProps, but not SavedProps
    // Check the SavedProps type block doesn't have it
    expect(leadCardSrc).not.toMatch(/mode.*"saved"[\s\S]{0,500}onBack\s*:/);
  });

  // Job: has addressLabel="Service Address" (added in parity pass 2026-05-10), phone + email from location
  it("JobDetailPage CDH call passes addressLabel=\"Service Address\"", () => {
    expect(jobPageSrc).toMatch(/addressLabel="Service Address"/);
  });

  it("JobDetailPage CDH call passes phone from job.location", () => {
    expect(jobPageSrc).toMatch(/phone=\{job\.location\?\.phone/);
  });

  it("JobDetailPage CDH call passes email from job.location", () => {
    expect(jobPageSrc).toMatch(/email=\{job\.location\?\.email/);
  });

  it("JobDetailPage CDH call has no descriptionLabel prop", () => {
    expect(jobPageCode).not.toMatch(/descriptionLabel=/);
  });

  // All three: descriptionEdit descriptor present
  it("JobDetailPage CDH call passes descriptionEdit", () => {
    expect(jobPageSrc).toMatch(/descriptionEdit=\{/);
  });

  it("QuoteHeaderCard CDH call passes descriptionEdit", () => {
    expect(quoteCardSrc).toMatch(/descriptionEdit=\{/);
  });

  it("LeadSummaryCard CDH call passes descriptionEdit", () => {
    expect(leadCardSrc).toMatch(/descriptionEdit=\{/);
  });

  // Quote + Lead: onDescriptionSave removed from CDH call
  it("QuoteHeaderCard CDH call has no onDescriptionSave prop", () => {
    expect(quoteCardCode).not.toMatch(/onDescriptionSave=/);
  });

  it("LeadSummaryCard CDH call has no onDescriptionSave prop", () => {
    expect(leadCardCode).not.toMatch(/onDescriptionSave=/);
  });

  // Quote + Lead: unified save sends both title and description
  it("QuoteDetailPage updateTitleMutation sends notesCustomer", () => {
    expect(quotePageSrc).toMatch(/notesCustomer/);
    expect(quotePageSrc).not.toMatch(/updateDescriptionMutation/);
  });

  it("LeadDetailPage updateHeaderMutation sends both title and description", () => {
    expect(leadPageSrc).toMatch(/updateHeaderMutation/);
    expect(leadPageSrc).toMatch(/title.*description|description.*title/);
    expect(leadPageSrc).not.toMatch(/updateDescriptionMutation/);
  });
});

// ── 17. Canonical description semantics — "Scope of work" (2026-05-09) ──

describe("Canonical description semantics — uniform label and placeholder", () => {
  const cdhRaw = readFileSync(CDH_PATH, "utf-8");

  // CDH exports canonical constants
  it("CDH exports DESCRIPTION_LABEL = 'Scope of work'", () => {
    expect(cdhRaw).toMatch(/DESCRIPTION_LABEL\s*=\s*["']Scope of work["']/);
  });

  it("CDH exports DESCRIPTION_PLACEHOLDER = 'Describe the scope of work'", () => {
    expect(cdhRaw).toMatch(/DESCRIPTION_PLACEHOLDER\s*=\s*["']Describe the scope of work/);
  });

  // CDH uses canonical constant as default for descriptionEdit.placeholder
  it("CDH defaults descriptionEdit placeholder to DESCRIPTION_PLACEHOLDER", () => {
    expect(cdhRaw).toMatch(/descriptionEdit\.placeholder\s*\?\?\s*DESCRIPTION_PLACEHOLDER/);
  });

  // CDH shows canonical label when descriptionEdit is active
  it("CDH renders DESCRIPTION_LABEL when descriptionEdit is active and no override", () => {
    expect(cdhRaw).toMatch(/descriptionLabel\s*\?\?\s*DESCRIPTION_LABEL/);
  });

  // No old entity-specific wording anywhere in source
  it("No old wording: 'Visible only to your team'", () => {
    const jobSrc = readFileSync(JOB_PAGE_PATH, "utf-8");
    expect(jobSrc).not.toMatch(/Visible only to your team/);
  });

  it("No old wording: 'Customer-facing notes' in QuoteHeaderCard", () => {
    expect(quoteCardSrc).not.toMatch(/Customer-facing notes/i);
  });

  it("No old wording: 'Lead description' as placeholder in LeadSummaryCard", () => {
    expect(leadCardSrc).not.toMatch(/placeholder.*[Ll]ead description/);
  });

  // InlineDescriptionEditor removed — CDH no longer has onDescriptionSave branch
  it("CDH interface does not declare onDescriptionSave prop", () => {
    expect(cdhRaw).not.toMatch(/onDescriptionSave\s*\?:/);
  });

  it("CDH does not render InlineDescriptionEditor", () => {
    expect(cdhRaw).not.toMatch(/InlineDescriptionEditor/);
  });
});

// ── 18. InvoiceDetailPage CDH migration (2026-05-09) ──────────────────

describe("InvoiceDetailPage — CDH migration correctness", () => {
  const invoiceCode = stripComments(invoicePageSrc);

  // Import shape
  it("InvoiceDetailPage imports CanonicalDetailHeader", () => {
    expect(invoicePageSrc).toMatch(/import\s*\{[^}]*CanonicalDetailHeader[^}]*\}\s*from.*CanonicalDetailHeader/);
  });

  it("InvoiceDetailPage does NOT import InvoiceDetailStrip", () => {
    expect(invoicePageSrc).not.toMatch(/InvoiceDetailStrip/);
  });

  // Status descriptor
  it("InvoiceDetailPage uses getInvoiceStatusMeta for CDH status prop", () => {
    expect(invoicePageSrc).toMatch(/getInvoiceStatusMeta/);
  });

  it("InvoiceDetailPage passes status descriptor to CDH (not ReactNode statusBadge)", () => {
    expect(invoiceCode).toMatch(/status=\{getInvoiceStatusMeta/);
    expect(invoiceCode).not.toMatch(/statusBadge=/);
  });

  // Actions are typed arrays, not ReactNode
  it("InvoiceDetailPage passes primaryActions array to CDH", () => {
    expect(invoiceCode).toMatch(/primaryActions=\{/);
    expect(invoiceCode).not.toMatch(/actions=\{/);
  });

  it("InvoiceDetailPage passes overflowActions array to CDH", () => {
    expect(invoiceCode).toMatch(/overflowActions=\{/);
  });

  // Key invoice actions are present
  it("InvoiceDetailPage CDH has send-invoice action", () => {
    expect(invoicePageSrc).toMatch(/button-send-invoice/);
  });

  it("InvoiceDetailPage CDH has collect-payment action", () => {
    expect(invoicePageSrc).toMatch(/button-collect-payment/);
  });

  it("InvoiceDetailPage CDH has preview-pdf action", () => {
    expect(invoicePageSrc).toMatch(/button-preview-pdf/);
  });

  // Title edit wired to metaDraft.summary
  it("InvoiceDetailPage passes titleEdit bound to metaDraft.summary", () => {
    expect(invoicePageSrc).toMatch(/titleEdit=/);
    expect(invoicePageSrc).toMatch(/metaDraft\.summary/);
  });

  // editCapability wired to canEdit + enterMetaEdit
  it("InvoiceDetailPage passes editCapability to CDH", () => {
    expect(invoiceCode).toMatch(/editCapability=/);
    expect(invoicePageSrc).toMatch(/enterMetaEdit/);
  });

  // Client identity props
  it("InvoiceDetailPage passes clientName to CDH", () => {
    expect(invoiceCode).toMatch(/clientName=/);
  });

  it("InvoiceDetailPage passes addressLines to CDH", () => {
    expect(invoiceCode).toMatch(/addressLines=/);
  });

  // items array preserved with editNodes
  it("InvoiceDetailPage items still have editNode for invoice-number", () => {
    expect(invoicePageSrc).toMatch(/header-input-invoice-number/);
  });

  it("InvoiceDetailPage items still have editNode for due-date", () => {
    expect(invoicePageSrc).toMatch(/header-input-due-date/);
  });

  it("InvoiceDetailPage items still have job-number link", () => {
    expect(invoicePageSrc).toMatch(/header-job-link/);
  });

  // NewInvoicePage migrated to CCH (2026-05-09)
  it("NewInvoicePage uses CanonicalCreateHeader (not InvoiceDetailStrip)", () => {
    expect(newInvoicePageSrc).toMatch(/CanonicalCreateHeader/);
    expect(newInvoicePageSrc).not.toMatch(/InvoiceDetailStrip/);
  });
});

// ── Section 19: InvoiceDetailPage duplicate-header removal (2026-05-09 Task 4) ──
describe("Section 19 — InvoiceDetailPage: InvoiceMetaCard removed, CDH owns everything", () => {
  const invoicePageSrc = readFileSync(
    resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
    "utf8",
  );

  // InvoiceMetaCard is gone
  it("InvoiceDetailPage does not import InvoiceMetaCard", () => {
    expect(invoicePageSrc).not.toMatch(/import.*InvoiceMetaCard/);
  });

  it("InvoiceDetailPage does not render InvoiceMetaCard", () => {
    expect(invoicePageSrc).not.toMatch(/<InvoiceMetaCard/);
  });

  // headerActions variable removed
  it("InvoiceDetailPage no longer has a headerActions variable", () => {
    expect(invoicePageSrc).not.toMatch(/const headerActions\s*=/);
  });

  // billLine1 / billLine2 removed
  it("InvoiceDetailPage no longer has billLine1 / billLine2 variables", () => {
    expect(invoicePageSrc).not.toMatch(/const billLine1\s*=/);
    expect(invoicePageSrc).not.toMatch(/const billLine2\s*=/);
  });

  // resolveServiceLocationName removed
  it("InvoiceDetailPage does not import resolveServiceLocationName", () => {
    expect(invoicePageSrc).not.toMatch(/resolveServiceLocationName/);
  });

  // Named save/cancel handlers extracted
  it("InvoiceDetailPage has handleHeaderSave function", () => {
    expect(invoicePageSrc).toMatch(/const handleHeaderSave\s*=/);
  });

  it("InvoiceDetailPage has handleHeaderCancel function", () => {
    expect(invoicePageSrc).toMatch(/const handleHeaderCancel\s*=/);
  });

  // editControls wired to CDH
  it("InvoiceDetailPage passes editControls to CDH", () => {
    expect(invoicePageSrc).toMatch(/editControls=/);
    expect(invoicePageSrc).toMatch(/handleHeaderSave/);
    expect(invoicePageSrc).toMatch(/handleHeaderCancel/);
  });

  // descriptionEdit wired for workDesc
  it("InvoiceDetailPage passes descriptionEdit with workDescDraft", () => {
    expect(invoicePageSrc).toMatch(/descriptionEdit=/);
    expect(invoicePageSrc).toMatch(/workDescDraft/);
  });

  // Issued + Terms added to CDH items
  it("InvoiceDetailPage items include issued date", () => {
    expect(invoicePageSrc).toMatch(/key:\s*["']issued["']/);
    expect(invoicePageSrc).toMatch(/header-input-issue-date/);
  });

  it("InvoiceDetailPage items include terms", () => {
    expect(invoicePageSrc).toMatch(/key:\s*["']terms["']/);
    expect(invoicePageSrc).toMatch(/header-input-payment-terms/);
  });

  // Reference fields mapped into items
  it("InvoiceDetailPage maps referenceFields into CDH items", () => {
    expect(invoicePageSrc).toMatch(/referenceFields\.map/);
    expect(invoicePageSrc).toMatch(/header-input-ref-/);
  });

  // addressLines uses serviceAddress with billing fallback
  it("InvoiceDetailPage addressLines prefers serviceAddress over billingAddress", () => {
    expect(invoicePageSrc).toMatch(/serviceAddress\s*\?\?\s*billingAddress/);
  });

  // isMetaSaving consolidates the two mutation pending flags
  it("InvoiceDetailPage has isMetaSaving combining both mutation pending flags", () => {
    expect(invoicePageSrc).toMatch(/const isMetaSaving\s*=/);
  });
});

// ── Section 20: Creation pages CCH migration (2026-05-09) ─────────────
describe("Section 20 — Creation pages: CanonicalCreateHeader on CreateLeadPage, CreateQuotePage, NewInvoicePage", () => {
  const createLeadSrc = readFileSync(
    resolve(ROOT, "client/src/pages/CreateLeadPage.tsx"),
    "utf8",
  );
  const createQuoteSrc = readFileSync(
    resolve(ROOT, "client/src/pages/CreateQuotePage.tsx"),
    "utf8",
  );
  const newInvoiceSrc = readFileSync(
    resolve(ROOT, "client/src/pages/NewInvoicePage.tsx"),
    "utf8",
  );
  const cchSrc = readFileSync(
    resolve(ROOT, "client/src/components/create/CanonicalCreateHeader.tsx"),
    "utf8",
  );

  // ── CanonicalCreateHeader component ────────────────────────────────

  it("CCH file exists at canonical path", () => {
    expect(cchSrc.length).toBeGreaterThan(0);
  });

  it("CCH exports CanonicalCreateHeader named export", () => {
    expect(cchSrc).toMatch(/export function CanonicalCreateHeader/);
  });

  it("CCH Section A (client) always renders before title and description", () => {
    const clientIdx = cchSrc.indexOf("client-section");
    const titleIdx = cchSrc.indexOf("title-section");
    const descIdx = cchSrc.indexOf("description-section");
    expect(clientIdx).toBeGreaterThan(-1);
    expect(titleIdx).toBeGreaterThan(-1);
    expect(descIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeLessThan(titleIdx);
    expect(titleIdx).toBeLessThan(descIdx);
  });

  it("CCH owns card chrome (rounded-md border bg-card)", () => {
    expect(cchSrc).toMatch(/rounded-md border bg-card/);
  });

  it("CCH does NOT expose clientReplaceSlot (dead prop removed)", () => {
    expect(cchSrc).not.toMatch(/clientReplaceSlot/);
  });

  it("CCH supports afterClientSlot for entity-specific controls", () => {
    expect(cchSrc).toMatch(/afterClientSlot/);
  });

  // ── CreateLeadPage ──────────────────────────────────────────────────

  it("CreateLeadPage imports CanonicalCreateHeader (not CanonicalDetailHeader)", () => {
    expect(createLeadSrc).toMatch(/CanonicalCreateHeader/);
    expect(createLeadSrc).not.toMatch(/CanonicalDetailHeader/);
  });

  it("CreateLeadPage does not import LeadSummaryCard", () => {
    expect(createLeadSrc).not.toMatch(/import.*LeadSummaryCard/);
  });

  it("CreateLeadPage does not import CreateOrSelectField (CCH owns it)", () => {
    expect(createLeadSrc).not.toMatch(/import.*CreateOrSelectField/);
  });

  it("CreateLeadPage uses testId create-lead-header", () => {
    expect(createLeadSrc).toMatch(/testId="create-lead-header"/);
  });

  it("CreateLeadPage passes titleValue to CCH", () => {
    expect(createLeadSrc).toMatch(/titleValue=/);
  });

  it("CreateLeadPage passes descriptionValue to CCH", () => {
    expect(createLeadSrc).toMatch(/descriptionValue=/);
  });

  it("CreateLeadPage body wrapper has pt-4 pb-4 (canonical)", () => {
    expect(createLeadSrc).toMatch(/px-4 lg:px-6 pt-4 pb-4/);
  });

  it("CreateLeadPage passes clientSearchResults and onLocationChange to CCH", () => {
    expect(createLeadSrc).toMatch(/clientSearchResults=/);
    expect(createLeadSrc).toMatch(/onLocationChange=/);
  });

  it("CreateLeadPage does NOT pass clientReplaceSlot (inline form removed)", () => {
    expect(createLeadSrc).not.toMatch(/clientReplaceSlot=/);
  });

  it("CreateLeadPage CCH has cancel and create-lead test ids", () => {
    expect(createLeadSrc).toMatch(/button-cancel-lead/);
    expect(createLeadSrc).toMatch(/button-create-lead/);
  });

  // ── CreateQuotePage ─────────────────────────────────────────────────

  it("CreateQuotePage imports CanonicalCreateHeader (not CanonicalDetailHeader)", () => {
    expect(createQuoteSrc).toMatch(/CanonicalCreateHeader/);
    expect(createQuoteSrc).not.toMatch(/CanonicalDetailHeader/);
  });

  it("CreateQuotePage does not import QuoteDescriptionCard", () => {
    expect(createQuoteSrc).not.toMatch(/import.*QuoteDescriptionCard/);
  });

  it("CreateQuotePage does not render QuoteDescriptionCard", () => {
    expect(createQuoteSrc).not.toMatch(/<QuoteDescriptionCard/);
  });

  it("CreateQuotePage does not render the old headerCard variable", () => {
    expect(createQuoteSrc).not.toMatch(/const headerCard\s*=/);
  });

  it("CreateQuotePage uses testId create-quote-header", () => {
    expect(createQuoteSrc).toMatch(/testId="create-quote-header"/);
  });

  it("CreateQuotePage body wrapper has pt-4 pb-4 (canonical)", () => {
    expect(createQuoteSrc).toMatch(/px-4 lg:px-6 pt-4 pb-4/);
  });

  it("CreateQuotePage CCH has issued and expiry meta items", () => {
    expect(createQuoteSrc).toMatch(/key:\s*["']issued["']/);
    expect(createQuoteSrc).toMatch(/key:\s*["']expiry["']/);
  });

  it("CreateQuotePage passes clientSearchResults and onLocationChange to CCH", () => {
    expect(createQuoteSrc).toMatch(/clientSearchResults=/);
    expect(createQuoteSrc).toMatch(/onLocationChange=/);
  });

  // ── NewInvoicePage ──────────────────────────────────────────────────

  it("NewInvoicePage imports CanonicalCreateHeader (CDH not imported)", () => {
    expect(newInvoiceSrc).toMatch(/CanonicalCreateHeader/);
    expect(newInvoiceSrc).not.toMatch(/import.*CanonicalDetailHeader/);
  });

  it("NewInvoicePage does not import InvoiceDetailStrip", () => {
    expect(newInvoiceSrc).not.toMatch(/import.*InvoiceDetailStrip/);
  });

  it("NewInvoicePage does not import InvoiceMetaCard", () => {
    expect(newInvoiceSrc).not.toMatch(/import.*InvoiceMetaCard/);
  });

  it("NewInvoicePage does not import CreateOrSelectField (CCH owns it)", () => {
    expect(newInvoiceSrc).not.toMatch(/import.*CreateOrSelectField/);
  });

  it("NewInvoicePage uses testId new-invoice-header", () => {
    expect(newInvoiceSrc).toMatch(/testId="new-invoice-header"/);
  });

  it("NewInvoicePage body wrapper has pt-4 (not pt-0)", () => {
    expect(newInvoiceSrc).toMatch(/px-4 lg:px-6 pt-4 pb-4/);
    expect(newInvoiceSrc).not.toMatch(/px-4 lg:px-6 pt-0/);
  });

  it("NewInvoicePage CCH has issued and due date meta items", () => {
    expect(newInvoiceSrc).toMatch(/key:\s*["']issued["']/);
    expect(newInvoiceSrc).toMatch(/key:\s*["']due["']/);
  });

  it("NewInvoicePage CCH has save-invoice primaryAction", () => {
    expect(newInvoiceSrc).toMatch(/button-new-invoice-save/);
    expect(newInvoiceSrc).toMatch(/primaryAction=/);
  });

  it("NewInvoicePage no longer has billLine1 / billLine2 variables", () => {
    expect(newInvoiceSrc).not.toMatch(/const billLine1\s*=/);
    expect(newInvoiceSrc).not.toMatch(/const billLine2\s*=/);
  });

  it("NewInvoicePage passes workDescDraft as descriptionValue to CCH", () => {
    expect(newInvoiceSrc).toMatch(/descriptionValue=/);
    expect(newInvoiceSrc).toMatch(/workDescDraft/);
  });
});

// ── Address container typography ─────────────────────────────────────

describe("CDH address container typography — text-list-body (2026-05-09)", () => {
  it("address container uses text-list-body", () => {
    expect(cdhCode).toMatch(/text-list-body\s+text-muted-foreground/);
  });

  it("address container does not use text-helper", () => {
    // Isolate the address block (addressLines/phone/email container) and confirm no text-helper
    const addressBlock = cdhCode.match(/addressLines.*?<\/div>/s)?.[0] ?? cdhCode;
    const containerMatch = cdhCode.match(/space-y-0\.5[^"]*"/)?.[0] ?? "";
    expect(containerMatch).not.toMatch(/text-helper/);
  });

  it("address container does not use text-sm or text-base", () => {
    const containerMatch = cdhCode.match(/space-y-0\.5[^"]*"/)?.[0] ?? "";
    expect(containerMatch).not.toMatch(/\btext-sm\b/);
    expect(containerMatch).not.toMatch(/\btext-base\b/);
  });

  it("address container does not use arbitrary text-[...px] sizing", () => {
    const containerMatch = cdhCode.match(/space-y-0\.5[^"]*"/)?.[0] ?? "";
    expect(containerMatch).not.toMatch(/text-\[\d+px\]/);
  });

  it("CCH (CanonicalCreateHeader) has no addressLines prop — no address display on create pages", () => {
    const CREATE_HEADER_PATH = resolve(ROOT, "client/src/components/create/CanonicalCreateHeader.tsx");
    const { readFileSync: rfs } = require("fs");
    const cchSrc = rfs(CREATE_HEADER_PATH, "utf-8");
    expect(cchSrc).not.toMatch(/addressLines/);
  });

  it("DetailHeaderItem.editNode has JSDoc escape-hatch contract", () => {
    // Check raw source — JSDoc is a block comment, stripped in cdhCode
    expect(cdhSrc).toMatch(/Escape hatch for structured controls/);
    expect(cdhSrc).toMatch(/text-row/);
    expect(cdhSrc).toMatch(/h-7/);
  });
});

describe("Tier 1 dead-code removal", () => {
  const { readFileSync: rfs } = require("fs");
  const invoiceSrc: string = rfs(resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"), "utf-8");
  const quoteSrc: string = rfs(resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx"), "utf-8");
  const quoteCardSrc: string = rfs(resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx"), "utf-8");

  it("InvoiceDetailPage has no actionBarDropdown variable", () => {
    expect(invoiceSrc).not.toMatch(/\bactionBarDropdown\b/);
  });

  it("InvoiceDetailPage still has actionBarItems (feeds CDH overflowActions)", () => {
    expect(invoiceSrc).toMatch(/\bactionBarItems\b/);
  });

  it("QuoteHeaderCard interface has no statusInfo prop", () => {
    expect(quoteCardSrc).not.toMatch(/statusInfo/);
  });

  it("QuoteDetailPage does not pass statusInfo to QuoteHeaderCard", () => {
    expect(quoteSrc).not.toMatch(/statusInfo/);
  });

  it("Invoice editNode widgets use text-row not raw text-sm", () => {
    const editNodeBlocks = [...invoiceSrc.matchAll(/editNode:\s*metaDraft[\s\S]*?undefined,/g)].map((m) => m[0]);
    expect(editNodeBlocks.length).toBeGreaterThan(0);
    for (const block of editNodeBlocks) {
      expect(block).not.toMatch(/\btext-sm\b/);
    }
  });
});
