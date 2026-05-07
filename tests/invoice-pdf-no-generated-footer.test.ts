/**
 * Invoice PDF — compact modern layout contract (2026-05-06 RALPH).
 *
 * Replaces the prior narrow "no generated-on footer" test with a
 * complete layout-pin set covering:
 *
 *   • The forbidden footer text and any equivalent generated-at
 *     timestamp.
 *   • The new BILL TO / SERVICE SUMMARY / line-items / Totals /
 *     CLIENT COMMUNICATION / footer zones.
 *   • The brief's hard "no" list — no logo rendering, no header status
 *     badges, no payment information block, no warranty section, no
 *     "Need help?" section, no configurable PDF settings introduced.
 *   • Multi-page table pagination + last-page-only footer mechanics.
 *   • Optional Business Information block under the thank-you line —
 *     only renders when at least one tax registration exists.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const INVOICE_PDF = resolve(ROOT, "server/services/invoicePdfService.ts");

const pdfSrc = readFileSync(INVOICE_PDF, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const codeOnly = stripComments(pdfSrc);

// ── 1. The "generated on" footer is gone ───────────────────────────

describe("invoicePdfService — no generated-on timestamp footer", () => {
  it("does NOT render 'Invoice generated on …' anywhere in the executable source", () => {
    expect(codeOnly).not.toMatch(/Invoice generated on/);
    expect(codeOnly).not.toMatch(/Generated on/);
    expect(codeOnly).not.toMatch(/generatedAt/);
  });

  it("does NOT call format(new Date(), …) — the only `format` calls wrap invoice fields", () => {
    expect(codeOnly).not.toMatch(/format\(new Date\(\),/);
  });

  it("does NOT draw at the bottom-margin coordinate `doc.page.height - 50` (auto-paginate trap)", () => {
    // The exact coordinate that produced the original blank trailing
    // page. The footer now positions at `pageH - 60` which sits
    // safely inside the bottom margin.
    expect(codeOnly).not.toMatch(/doc\.page\.height\s*-\s*50/);
  });
});

// ── 2. Hard "no" constraints from the brief ────────────────────────

describe("invoicePdfService — forbidden additions stay forbidden", () => {
  it("does NOT render a tenant logo", () => {
    // PDFKit's `doc.image()` call is the only way a raster logo lands
    // in the document. Pin its absence to forbid logo rendering.
    expect(codeOnly).not.toMatch(/doc\.image\(/);
  });

  it("does NOT render a header status badge (Paid / Due / Overdue / Draft pill)", () => {
    // The brief forbids new pill-style status indicators in the
    // header chrome. The existing diagonal WATERMARK is preserved
    // (kept under the `getStatusWatermark` helper for DRAFT/VOID/PAID
    // — that is a centred document-state stamp, not a header pill),
    // but any fresh "Status: Awaiting Payment" / "STATUS PILL" /
    // similar UI must not appear.
    expect(codeOnly).not.toMatch(/STATUS PILL/i);
    expect(codeOnly).not.toMatch(/Awaiting Payment/);
    expect(codeOnly).not.toMatch(/badgeStatus/);
    expect(codeOnly).not.toMatch(/statusBadge/);
  });

  it("does NOT render a payment-information / payment-instructions block", () => {
    // Customer-facing PDFs must NOT include payment instructions by
    // default. Pin the absence of common labels so a future addition
    // trips this guard.
    expect(codeOnly).not.toMatch(/Payment Information/i);
    expect(codeOnly).not.toMatch(/Payment Instructions/i);
    expect(codeOnly).not.toMatch(/E-?Transfer/i);
    expect(codeOnly).not.toMatch(/Pay your invoices/i);
  });

  it("does NOT render a warranty section", () => {
    expect(codeOnly).not.toMatch(/Warranty/i);
  });

  it("does NOT render a 'Need help?' section", () => {
    expect(codeOnly).not.toMatch(/Need Help/i);
    expect(codeOnly).not.toMatch(/Need help\?/i);
  });

  it("does NOT introduce new tenant-configurable PDF settings", () => {
    // The redesign reuses the existing `policy` flags only. No fresh
    // visibility knob is added at the InvoicePdfData / policy layer.
    // Pin against new top-level data props that would suggest new
    // tenant configuration entered the contract.
    expect(codeOnly).not.toMatch(/showWarranty/);
    expect(codeOnly).not.toMatch(/showPaymentInfo/);
    expect(codeOnly).not.toMatch(/showLogo/);
    expect(codeOnly).not.toMatch(/showNeedHelp/);
  });
});

// ── 3. New layout zones present + named correctly ──────────────────

describe("invoicePdfService — compact modern layout zones", () => {
  it("uses 'BILL TO:' as a green uppercase label early in the page", () => {
    // The label must render as the literal string "BILL TO:" so the
    // previous selector / spec contract still resolves.
    expect(pdfSrc).toMatch(/"BILL TO:"/);
    // Compact: BILL TO renders ABOVE both Service Summary and the
    // line-items table in the source order. Source ordering is the
    // same order PDFKit draws absolute-positioned content top-to-
    // bottom, so the brief's "high on the page" goal is enforced
    // by source ordering plus the absolute Y math.
    const billIdx = pdfSrc.indexOf('"BILL TO:"');
    const summaryIdx = pdfSrc.indexOf('"SERVICE SUMMARY"');
    const tableHdrIdx = pdfSrc.indexOf("drawTableHeader");
    expect(billIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(tableHdrIdx).toBeGreaterThan(-1);
    expect(billIdx).toBeLessThan(summaryIdx);
    expect(summaryIdx).toBeLessThan(tableHdrIdx);
  });

  it("uses 'SERVICE SUMMARY' as the single label (no separate 'Scope of Work' heading)", () => {
    expect(pdfSrc).toMatch(/"SERVICE SUMMARY"/);
    // Strip comments before negative pins — doc commentary references
    // the prior "Scope of Work" label for context.
    expect(codeOnly).not.toMatch(/"Scope of Work"/);
  });

  it("renders SERVICE SUMMARY only when invoice.workDescription has content", () => {
    // The conditional gate: policy.showJobDescription AND a non-empty
    // workDescription. Pin both halves so an empty section never lands
    // on the page.
    expect(pdfSrc).toMatch(/policy\.showJobDescription\s*&&\s*workDesc\s*&&\s*workDesc\.trim\(\)\.length\s*>\s*0/);
  });

  it("table header columns are Description | Qty | Unit Price | Amount (no 'Rate')", () => {
    expect(pdfSrc).toMatch(/"Description"/);
    expect(pdfSrc).toMatch(/"Qty"/);
    expect(pdfSrc).toMatch(/"Unit Price"/);
    expect(pdfSrc).toMatch(/"Amount"/);
    // Strip comments first — the file's own doc-block legitimately
    // references the prior "Rate" label for context.
    expect(codeOnly).not.toMatch(/"Rate"/);
  });

  it("table header is dark navy (#0F172A) with white text + 24pt header height", () => {
    expect(pdfSrc).toMatch(/const NAVY = "#0F172A"/);
    expect(pdfSrc).toMatch(/const TABLE_HEADER_H = 24/);
    expect(pdfSrc).toMatch(/\.fill\(NAVY\)/);
    expect(pdfSrc).toMatch(/fillColor\("#ffffff"\)/);
  });

  it("table rows bumped to 22pt for breathing room with subtle dividers", () => {
    // v2 bumped from 20pt → 22pt for slightly better readability while
    // still hosting 8–15+ items per page.
    expect(pdfSrc).toMatch(/const TABLE_ROW_H = 22/);
    expect(pdfSrc).toMatch(/lineWidth\(0\.4\)\.strokeColor\(BORDER\)\.stroke\(\)/);
  });

  it("totals box uses uppercase 'TOTAL DUE' with muted-blue ACCENT + larger amount", () => {
    expect(pdfSrc).toMatch(/"TOTAL DUE"/);
    // The label renders bold at 11pt and the amount renders larger
    // (14pt) in the muted-blue ACCENT color.
    expect(pdfSrc).toMatch(
      /fontSize\(11\)\.fillColor\(TEXT_DARK\)\.font\("Helvetica-Bold"\)[\s\S]+?"TOTAL DUE"[\s\S]+?fontSize\(14\)\.fillColor\(ACCENT\)/,
    );
  });

  it("totals box renders Subtotal + Tax + TOTAL DUE rows + divider above TOTAL DUE", () => {
    expect(pdfSrc).toMatch(/"Subtotal"/);
    expect(pdfSrc).toMatch(/`Tax \(\$\{company\.taxName/);
    // Divider above TOTAL DUE — drawn just before the label text.
    expect(pdfSrc).toMatch(/strokeColor\(BORDER\)\.stroke\(\);[\s\S]+?trY \+= 6;[\s\S]+?"TOTAL DUE"/);
  });

  it("CLIENT COMMUNICATION block is rendered (not 'Notes:')", () => {
    expect(pdfSrc).toMatch(/"CLIENT COMMUNICATION"/);
    // The prior "Notes:" heading is gone from the executable source.
    expect(codeOnly).not.toMatch(/"Notes:"/);
  });

  it("CLIENT COMMUNICATION renders ONLY when policy.clientMessage / invoice.notesCustomer is non-empty", () => {
    expect(pdfSrc).toMatch(
      /policy\.clientMessage\s*\?\?\s*invoice\.notesCustomer/,
    );
    // The block is gated on a trimmed non-empty messageText.
    expect(pdfSrc).toMatch(/if\s*\(messageText\.length\s*>\s*0\)/);
  });
});

// ── 4. Footer contract: low + thin + last-page-only ───────────────

describe("invoicePdfService — footer contract", () => {
  it("renders the centred 'Thank you for choosing {company.name}.' line", () => {
    expect(pdfSrc).toMatch(/`Thank you for choosing \$\{company\.name\}\.`/);
    // The line is rendered with `align: "center"` so it spans the
    // full content width.
    expect(pdfSrc).toMatch(/thankYou[\s\S]+?align:\s*"center"/);
  });

  it("does NOT render a 'BUSINESS INFORMATION' heading anywhere in the footer (2026-05-07 narrow)", () => {
    // The 2026-05-07 narrow simplification removes the heading entirely.
    // Tax registrations now sit directly under the thank-you line, one
    // line per registration, with the configured label as the prefix
    // (no extra section title).
    expect(codeOnly).not.toMatch(/"BUSINESS INFORMATION"/);
    expect(codeOnly).not.toMatch(/Business Information/);
  });

  it("tax registration lines render directly under the thank-you, gated on policy.showTaxNumber", () => {
    // The footer gathers tax-reg lines from `taxRegistrations` ONLY
    // when `policy.showTaxNumber === true` AND the tenant has at
    // least one registration with a non-empty number. Each survives
    // through to a centred row in muted gray.
    expect(pdfSrc).toMatch(
      /const showTaxRegs\s*=\s*!!policy\.showTaxNumber;/,
    );
    expect(pdfSrc).toMatch(
      /const taxRegLines:\s*string\[\]\s*=\s*showTaxRegs\s*&&\s*taxRegistrations[\s\S]+?\.filter\(\(s\)\s*=>\s*s\.length\s*>\s*0\)/,
    );
    expect(pdfSrc).toMatch(/if\s*\(regCount\s*>\s*0\)/);
  });

  it("tax-reg line label is taken from the registration row — never hardcoded HST", () => {
    // The mapper uses `r.label` (configured by the tenant) and falls
    // back to "Tax ID" only when the label is empty. No hardcoded
    // "HST" string survives in the footer rendering path.
    expect(pdfSrc).toMatch(
      /const label\s*=\s*\(r\.label\s*\?\?\s*""\)\.trim\(\);[\s\S]+?return label\s*\?\s*`\$\{label\} # \$\{number\}`\s*:\s*`Tax ID # \$\{number\}`/,
    );
    // Negative pin: no `"HST"` string-literal fallback inside the
    // mapper. (The tenant CAN configure a label of "HST" — that's
    // data, not code — but the renderer doesn't synthesize it.)
    const codeOnly = pdfSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/=\s*"HST"\s*[);,]/);
    expect(codeOnly).not.toMatch(/`HST\s*#/);
  });

  it("footer Y coordinates sit INSIDE the bottom margin (no auto-pagination trigger)", () => {
    // 2026-05-07 narrow: bottom-up geometry anchored at
    // `SAFE_LAST_TOP_Y = pageH - 65`. Lines stack upward — regs (when
    // present) at the bottom, thank-you above the topmost reg, divider
    // 6pt above thank-you. Each line bottom stays ≥ 4pt clear of the
    // PDFKit margin boundary (`pageH - 50`) so PDFKit never auto-
    // paginates a phantom trailing page.
    expect(pdfSrc).toMatch(/const SAFE_LAST_TOP_Y\s*=\s*pageH\s*-\s*65/);
    expect(pdfSrc).toMatch(/const TAX_REG_LINE_H\s*=\s*11/);
    expect(pdfSrc).toMatch(/const THANK_YOU_LINE_H\s*=\s*11/);
    // Thank-you sits one row above the topmost reg when regs exist;
    // it occupies the bottom slot when there are no regs.
    expect(pdfSrc).toMatch(
      /const thankYouY\s*=\s*regCount\s*>\s*0\s*\?\s*firstRegY\s*-\s*THANK_YOU_LINE_H\s*:\s*SAFE_LAST_TOP_Y/,
    );
    // Divider always 6pt above the thank-you.
    expect(pdfSrc).toMatch(/const dividerY\s*=\s*thankYouY\s*-\s*6/);
  });

  it("uses bufferPages + switchToPage(lastPage) so the footer renders only on the LAST page", () => {
    // The redesign reinstates the buffered-pages pattern intentionally
    // — this is what makes the footer single-page chrome regardless
    // of how many pages the body produced. The previous test forbade
    // these two calls because the bug at the time was caused by
    // text() at the bottom-margin coordinate. The actual auto-paginate
    // trigger has been removed (footer now sits at `pageH - 60`), so
    // these two PDFKit primitives are safe to use again.
    expect(pdfSrc).toMatch(/bufferPages:\s*true/);
    expect(pdfSrc).toMatch(/doc\.bufferedPageRange\(\)/);
    expect(pdfSrc).toMatch(/doc\.switchToPage\(lastPage\)/);
  });
});

// ── 5. Multi-page table mechanics ─────────────────────────────────

describe("invoicePdfService — multi-page table support", () => {
  it("declares a `drawTableHeader(topY)` helper that re-emits the navy header on each page", () => {
    expect(pdfSrc).toMatch(/const drawTableHeader\s*=\s*\(topY: number\):\s*number\s*=>\s*\{/);
  });

  it("calls doc.addPage() inside ensureRowRoom() before redrawing the table header", () => {
    // Page-break helper: when the next row would overflow the bottom
    // margin, add a new page + redraw the header so multi-page tables
    // stay readable.
    expect(pdfSrc).toMatch(
      /const ensureRowRoom\s*=\s*\(rowY:\s*number,\s*neededHeight:\s*number\)(?:\s*:\s*number)?\s*=>\s*\{[\s\S]+?doc\.addPage\(\);[\s\S]+?return drawTableHeader\(PAGE_MARGIN\)/,
    );
  });

  it("page-breaks BEFORE drawing totals when totalsH would not fit on the current page", () => {
    expect(pdfSrc).toMatch(
      /if\s*\(cursorY\s*\+\s*totalsH\s*>\s*tableBottomY\)\s*\{[\s\S]+?doc\.addPage\(\);/,
    );
  });

  it("page-breaks BEFORE drawing CLIENT COMMUNICATION when commH would not fit on the current page", () => {
    // v2 keeps the page-break-before guard but uses a `pageBottomBudget`
    // local (= pageH - PAGE_MARGIN). The block is then placed using a
    // "push low if room, otherwise right after totals" rule.
    expect(pdfSrc).toMatch(
      /if\s*\(cursorY\s*\+\s*16\s*\+\s*commH\s*>\s*pageBottomBudget\)\s*\{[\s\S]+?doc\.addPage\(\);/,
    );
  });

  it("redraws the diagonal watermark on every new page (consistent document-state stamp)", () => {
    // After addPage() in the table loop, the watermark redraw call
    // is invoked so multi-page DRAFT / PAID / VOID invoices keep the
    // same backdrop on every page.
    expect(pdfSrc).toMatch(
      /doc\.addPage\(\);[\s\S]+?drawWatermark\(\)/,
    );
  });
});

// ── 6. Issue Date + Due Date preserved + Due Date green ──────────

describe("invoicePdfService — Issue Date and Due Date preserved + Due Date uses green accent", () => {
  it("renders Issue Date label + invoice.issuedAt || invoice.issueDate value", () => {
    expect(pdfSrc).toMatch(/"Issue Date:"/);
    expect(pdfSrc).toMatch(/formatDate\(invoice\.issuedAt\s*\|\|\s*invoice\.issueDate\)/);
  });

  it("renders Due Date label + invoice.dueDate value with the muted-blue ACCENT", () => {
    expect(pdfSrc).toMatch(/"Due Date:"/);
    expect(pdfSrc).toMatch(/formatDate\(invoice\.dueDate\)/);
    // The Due Date value renders right after a fillColor(ACCENT) call.
    expect(pdfSrc).toMatch(
      /"Due Date:"[\s\S]+?fillColor\(ACCENT\)\.font\("Helvetica-Bold"\);\s*\n\s*doc\.text\(formatDate\(invoice\.dueDate\)/,
    );
  });

  it("formatDate helper still uses date-fns format under the hood", () => {
    expect(pdfSrc).toMatch(/function formatDate\(value: unknown\):/);
    expect(pdfSrc).toMatch(
      /import\s*\{[^}]*\bformat\b[^}]*\}\s*from\s*"date-fns"/,
    );
  });
});

// ── 7. Color tokens locked ────────────────────────────────────────

describe("invoicePdfService — color token contract (RALPH v2 muted-blue palette)", () => {
  it("declares the v2 brand color tokens (NAVY / ACCENT / BORDER / CONTAINER / TEXT_*)", () => {
    expect(pdfSrc).toMatch(/const NAVY = "#0F172A"/);
    expect(pdfSrc).toMatch(/const ACCENT = "#1E3A5F"/);
    expect(pdfSrc).toMatch(/const TEXT_DARK = "#0F172A"/);
    expect(pdfSrc).toMatch(/const TEXT_BODY = "#334155"/);
    expect(pdfSrc).toMatch(/const TEXT_MUTED = "#475569"/);
    expect(pdfSrc).toMatch(/const BORDER = "#E2E8F0"/);
    expect(pdfSrc).toMatch(/const CONTAINER = "#F8FAFC"/);
  });

  it("dropped the bright green accent entirely (no GREEN constant, no #76B054 anywhere)", () => {
    // v2 swap: green removed, muted-blue ACCENT is the brand cue.
    // Strip comments first so doc commentary that explains the v1→v2
    // change for context doesn't false-trip.
    expect(codeOnly).not.toMatch(/const\s+GREEN\b/);
    expect(codeOnly).not.toMatch(/#76B054/);
  });

  it("does NOT use raw inline hex values for the navy/accent/container/border tokens", () => {
    // After the token map is in place, the layout body should
    // reference the constants. A future refactor that re-inlines a
    // hex value defeats the canonicalization. The token hex values
    // appear only ONCE each — inside their `const` declarations.
    // (TEXT_DARK aliases NAVY's #0F172A, so that hex shows up twice:
    // once for NAVY, once for TEXT_DARK; both are token decls.)
    const accentMatches = codeOnly.match(/#1E3A5F/g) ?? [];
    expect(accentMatches.length).toBe(1);
    const borderMatches = codeOnly.match(/#E2E8F0/g) ?? [];
    expect(borderMatches.length).toBe(1);
    const containerMatches = codeOnly.match(/#F8FAFC/g) ?? [];
    expect(containerMatches.length).toBe(1);
  });
});

// ── 8. CLIENT COMMUNICATION pushes LOW on the page (v2) ───────────

describe("invoicePdfService — CLIENT COMMUNICATION pushes near the footer band", () => {
  it("computes a `desiredTop` from the footer band so the block sits low when room exists", () => {
    // v2 anchors the comm block above the footer band when the body
    // left vertical room. The desiredTop computation references the
    // footerTopY constant the bottom-up footer geometry uses.
    expect(pdfSrc).toMatch(
      /const footerTopY\s*=\s*pageH\s*-\s*95;/,
    );
    expect(pdfSrc).toMatch(
      /const desiredTop\s*=\s*footerTopY\s*-\s*COMM_GAP_ABOVE_FOOTER\s*-\s*commH;/,
    );
  });

  it("falls back to immediately-after-totals placement when the body has consumed the room", () => {
    // The Y picker prefers `desiredTop` (push low) but falls back to
    // `cursorY + 16` (just below totals) when desiredTop would
    // overlap the totals block.
    expect(pdfSrc).toMatch(
      /const minTopAfterTotals\s*=\s*cursorY\s*\+\s*16;\s*\n\s*const commTop\s*=\s*desiredTop\s*>\s*minTopAfterTotals\s*\?\s*desiredTop\s*:\s*minTopAfterTotals;/,
    );
  });

  it("renders the bordered container + label + body text at the chosen Y (commTop)", () => {
    expect(pdfSrc).toMatch(
      /doc\.roundedRect\(leftCol,\s*commTop,\s*contentW,\s*commH,\s*4\)/,
    );
    expect(pdfSrc).toMatch(
      /"CLIENT COMMUNICATION"[\s\S]+?leftCol\s*\+\s*COMM_PAD,\s*commTop\s*\+\s*COMM_PAD,/,
    );
  });
});

// ── 9. Invoice-number pill border uses the muted-blue ACCENT (v2) ──

describe("invoicePdfService — invoice-number pill carries the brand cue", () => {
  it("pill border uses the ACCENT color (not the neutral gray BORDER)", () => {
    expect(pdfSrc).toMatch(
      /doc\.roundedRect\(pillX,\s*pillY,\s*pillW,\s*pillH,\s*9\)\.lineWidth\(0\.7\)\.strokeColor\(ACCENT\)\.stroke\(\)/,
    );
  });
});
