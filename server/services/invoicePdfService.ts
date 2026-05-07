/**
 * Invoice PDF generator — compact modern layout (2026-05-06 RALPH v2).
 *
 * v2 changes the brand cue from green to a muted dark blue accent and
 * pushes CLIENT COMMUNICATION near the bottom of the last page when
 * line items leave room (so it reads as the closing message rather
 * than a "Notes after totals" block). Centres the Business Information
 * footer block. Bumps the table row height for slightly better
 * readability while still optimising for 8–15+ line items per page.
 *
 * Layout zones (top → bottom):
 *
 *   1. Top header (compact two-column)
 *      • Left:  Tenant company name (large bold) + tight company-info
 *               rows (address / phone / email / website / tax IDs).
 *      • Right: "INVOICE" word + invoice-number pill (muted-blue
 *               border) + Issue Date and Due Date rows. Due Date
 *               value uses the muted-blue accent.
 *      • Hairline divider closes the header.
 *
 *   2. BILL TO (muted-blue uppercase label) — sits HIGH on the page so
 *      it reads as part of the masthead.
 *
 *   3. SERVICE SUMMARY (full-width, light bordered container) —
 *      conditional on `invoice.workDescription`. Single label only;
 *      "Scope of Work" is intentionally NOT used as a second heading.
 *
 *   4. Line items table — navy header row (#0F172A) with white text,
 *      columns `Description | Qty | Unit Price | Amount` (the "Rate"
 *      header is replaced by "Unit Price"). 22pt row height — slightly
 *      taller than v1 for breathing room while still hosting 8+ items
 *      on page 1. Subtle row dividers + alternating fill.
 *
 *   5. Totals box — right-aligned, compact, light border. Subtotal /
 *      optional Discount / Tax / divider / TOTAL DUE. TOTAL DUE label
 *      bold + Amount slightly larger and rendered in the muted-blue
 *      accent. Amount Paid + Balance Due render only when
 *      `invoice.amountPaid > 0` AND `invoice.showBalance !== false`.
 *
 *   6. CLIENT COMMUNICATION (full-width, light bordered container) —
 *      conditional on `policy.clientMessage ?? invoice.notesCustomer`.
 *      v2: positioned NEAR the bottom of the last page (just above the
 *      footer band) when the body left room. When the body almost
 *      fills the page, it falls back to immediately after totals.
 *      Single label only; the prior "Notes:" heading is gone.
 *
 *   7. Footer — pinned LOW on the last page only. A thin hairline,
 *      then optional centred Business Information block (only when
 *      `taxRegistrations` is non-empty), then a centred
 *      "Thank you for choosing {company.name}." line. The Business
 *      Information block reads as two centred lines: a bold uppercase
 *      label and the formatted tax registration(s) below it.
 *
 * Multi-page behavior:
 *   • Line items page-break: when a row would overflow the bottom
 *     margin, a new page is created and the navy table header is
 *     redrawn so subsequent rows still read as a continuation.
 *   • Totals + Client Communication: each block computes its
 *     anticipated height up front; if the current page can't fit
 *     it, we move to the next page BEFORE drawing so the block
 *     never splits awkwardly.
 *   • Footer renders ONCE on the LAST page only via
 *     `bufferPages: true` + `switchToPage(lastPage)`. Y coordinates
 *     sit safely inside the bottom margin so PDFKit's auto-paginate
 *     trigger never fires.
 *
 * Constraints honoured (per the brief):
 *   • No tenant logo rendering.
 *   • No status badges (Paid / Due / Overdue / Draft) in the chrome —
 *     the diagonal centred WATERMARK for `draft` / `paid` / `voided`
 *     is preserved because it's a customer-actionable document-state
 *     stamp, not a header pill.
 *   • No payment information block.
 *   • No warranty section.
 *   • No "Need help?" section.
 *   • No configurable PDF settings (the existing `policy` flags drive
 *     visibility only; this redesign does not add new tenant knobs).
 *   • No service-summary "card" that wastes vertical space — the
 *     section omits when `workDescription` is empty and stays compact
 *     when present.
 *   • No DB-field renames; every binding reads existing columns.
 *   • Optimised for 8–15+ line items on page 1.
 */

import PDFDocument from "pdfkit";
import { format, parseISO, isValid } from "date-fns";
import type { Invoice, InvoiceLine, Company } from "@shared/schema";
import {
  resolveInvoiceDisplayPolicy,
  type InvoiceDisplayPolicy,
} from "@shared/invoiceDisplayPolicy";

interface InvoicePdfData {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: Company;
  location: {
    companyName: string;
    address?: string | null;
    address2?: string | null;
    city?: string | null;
    provinceState?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  customerCompany?: {
    name: string;
  } | null;
  taxRegistrations?: ReadonlyArray<{
    label: string | null;
    number: string;
  }>;
  policy?: InvoiceDisplayPolicy;
  jobNumber?: string | null;
  companyWebsite?: string | null;
}

// ─── Color tokens ────────────────────────────────────────────────────
//
// 2026-05-06 RALPH v2: bright green accent dropped entirely. The brand
// cue is now a muted dark blue (#1E3A5F) used sparingly for section
// labels (BILL TO, SERVICE SUMMARY, CLIENT COMMUNICATION, BUSINESS
// INFORMATION), the Due Date value, the invoice-number pill border,
// and the TOTAL DUE amount. Strong headings + the table header use a
// near-black navy (#0F172A). All other colors come from a tight gray
// scale so the document reads as modern and corporate.
const NAVY = "#0F172A";          // table header background + strong text
const ACCENT = "#1E3A5F";        // muted dark blue brand cue
const TEXT_DARK = "#0F172A";     // primary headings (alias of NAVY for clarity)
const TEXT_BODY = "#334155";     // body text
const TEXT_MUTED = "#475569";    // labels, secondary metadata
const BORDER = "#E2E8F0";        // hairlines, container borders
const CONTAINER = "#F8FAFC";     // light fill for SERVICE SUMMARY / CLIENT COMM

// ─── Layout constants ────────────────────────────────────────────────
const PAGE_MARGIN = 50;          // standard letter-page margins
const TABLE_HEADER_H = 24;       // navy header row height (slight bump from 22 for breathing room)
const TABLE_ROW_H = 22;          // body row height — readable density for 8–15+ items per page

function formatCurrency(amount: string | number | null | undefined): string {
  const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(num);
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
  return isValid(d) ? format(d, "MMMM d, yyyy") : "-";
}

function getStatusWatermark(status: string): string | null {
  switch (status) {
    case "draft":  return "DRAFT";
    case "voided": return "VOID";
    case "paid":   return "PAID";
    default:       return null;
  }
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const { invoice, lines, company, location, customerCompany, taxRegistrations, jobNumber, companyWebsite } = data;
      const policy: InvoiceDisplayPolicy =
        data.policy ??
        resolveInvoiceDisplayPolicy({
          tenantSettings: null,
          invoice: invoice as any,
        });

      const doc = new PDFDocument({
        size: "LETTER",
        margin: PAGE_MARGIN,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageW = doc.page.width;          // 612pt
      const pageH = doc.page.height;         // 792pt
      const contentW = pageW - PAGE_MARGIN * 2; // 512pt
      const leftCol = PAGE_MARGIN;            // 50
      const rightEdge = pageW - PAGE_MARGIN;  // 562
      // Right column anchor for the header — the INVOICE word + dates
      // pill align to a column whose left edge sits 220pt from the
      // right edge of the page. Wide enough for "Due Date: November
      // 30, 2026" to render in one line at fontSize 10.
      const headerRightX = rightEdge - 220;

      // ─── Watermark (pre-existing customer-actionable stamp) ───────
      // Kept from prior implementation. The diagonal stamp marks
      // DRAFT / VOID / PAID for the recipient — it is intentionally
      // distinct from the "no header status badge" rule, which targets
      // pill-style chips that would otherwise live in the masthead.
      const watermark = getStatusWatermark(invoice.status);
      const drawWatermark = () => {
        if (!watermark) return;
        doc.save();
        doc.fontSize(72);
        doc.fillColor("#e0e0e0");
        doc.rotate(-45, { origin: [pageW / 2, pageH / 2] });
        doc.text(watermark, 0, pageH / 2 - 50, {
          align: "center",
          width: pageW,
        });
        doc.restore();
      };
      drawWatermark();

      // ════════════════════════════════════════════════════════════
      // 1. TOP HEADER (compact two-column)
      // ════════════════════════════════════════════════════════════

      // Left column — company identity
      doc.fontSize(20).fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text(company.name, leftCol, PAGE_MARGIN, { width: headerRightX - leftCol - 20 });

      // Tight 11pt line-height on contact rows so the masthead stays
      // compressed even with multiple lines.
      const COMPANY_LINE_H = 12;
      let companyY = PAGE_MARGIN + 26;
      doc.fontSize(9).fillColor(TEXT_MUTED).font("Helvetica");
      const writeCompanyLine = (text: string) => {
        doc.text(text, leftCol, companyY, { width: headerRightX - leftCol - 20, lineBreak: false });
        companyY += COMPANY_LINE_H;
      };
      if (policy.showCompanyAddress && company.address) writeCompanyLine(company.address);
      const cityLine = [company.city, company.provinceState, company.postalCode].filter(Boolean).join(", ");
      if (policy.showCompanyAddress && cityLine) writeCompanyLine(cityLine);
      if (policy.showCompanyPhone && company.phone) writeCompanyLine(company.phone);
      if (policy.showCompanyEmail && company.email) writeCompanyLine(company.email);
      if (policy.showCompanyWebsite && companyWebsite && companyWebsite.trim().length > 0) {
        writeCompanyLine(companyWebsite);
      }
      if (policy.showTaxNumber && taxRegistrations && taxRegistrations.length > 0) {
        for (const reg of taxRegistrations) {
          const number = (reg.number ?? "").trim();
          if (!number) continue;
          const label = (reg.label ?? "").trim();
          writeCompanyLine(label ? `${label}: ${number}` : `Tax ID: ${number}`);
        }
      }

      // Right column — INVOICE word + invoice-# pill + Issue/Due dates
      doc.fontSize(28).fillColor(NAVY).font("Helvetica-Bold");
      doc.text("INVOICE", headerRightX, PAGE_MARGIN, { width: 220, align: "right" });

      // Invoice-# pill: small bordered chip aligned to the right edge.
      const invNumber = invoice.invoiceNumber || `#${invoice.id.slice(0, 8)}`;
      const pillLabel = `Invoice #${invNumber}`;
      const pillFontSize = 10;
      doc.fontSize(pillFontSize).font("Helvetica");
      const pillTextW = doc.widthOfString(pillLabel);
      const pillW = pillTextW + 16;
      const pillH = 18;
      const pillX = rightEdge - pillW;
      const pillY = PAGE_MARGIN + 36;
      // 2026-05-06 RALPH v2: pill border uses the muted-blue accent
      // so the invoice-number chip carries the brand cue (matches the
      // BILL TO / SERVICE SUMMARY / CLIENT COMMUNICATION label color).
      doc.roundedRect(pillX, pillY, pillW, pillH, 9).lineWidth(0.7).strokeColor(ACCENT).stroke();
      doc.fillColor(TEXT_DARK).text(pillLabel, pillX, pillY + 4, { width: pillW, align: "center", lineBreak: false });

      // Issue / Due dates — two compact rows under the pill. Due Date
      // value uses the muted-blue accent per the brief.
      const datesY = pillY + pillH + 10;
      const labelW = 70;
      const dateRowH = 14;
      const dateLabelX = rightEdge - 200;
      const dateValueX = dateLabelX + labelW;
      doc.fontSize(10).font("Helvetica").fillColor(TEXT_MUTED);
      doc.text("Issue Date:", dateLabelX, datesY, { width: labelW, lineBreak: false });
      doc.fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text(formatDate(invoice.issuedAt || invoice.issueDate), dateValueX, datesY, { width: 200 - labelW, lineBreak: false });
      doc.font("Helvetica").fillColor(TEXT_MUTED);
      doc.text("Due Date:", dateLabelX, datesY + dateRowH, { width: labelW, lineBreak: false });
      doc.fillColor(ACCENT).font("Helvetica-Bold");
      doc.text(formatDate(invoice.dueDate), dateValueX, datesY + dateRowH, { width: 200 - labelW, lineBreak: false });

      // Optional Job # / Summary appended under the dates (compact).
      let extraDatesY = datesY + dateRowH * 2;
      if (policy.showJobNumber && jobNumber && jobNumber.trim().length > 0) {
        doc.fontSize(10).font("Helvetica").fillColor(TEXT_MUTED);
        doc.text("Job #:", dateLabelX, extraDatesY, { width: labelW, lineBreak: false });
        doc.fillColor(TEXT_DARK).font("Helvetica-Bold");
        doc.text(jobNumber, dateValueX, extraDatesY, { width: 200 - labelW, lineBreak: false });
        extraDatesY += dateRowH;
      }
      if (policy.showSummary && (invoice as any).summary && String((invoice as any).summary).trim().length > 0) {
        doc.fontSize(10).font("Helvetica").fillColor(TEXT_MUTED);
        doc.text("Summary:", dateLabelX, extraDatesY, { width: labelW, lineBreak: false });
        doc.fillColor(TEXT_DARK).font("Helvetica-Bold");
        const summaryStr = String((invoice as any).summary);
        doc.text(summaryStr, dateValueX, extraDatesY, { width: 200 - labelW, lineBreak: false, ellipsis: true });
        extraDatesY += dateRowH;
      }

      // Hairline divider closes the masthead.
      const headerBottom = Math.max(companyY + 4, extraDatesY + 8);
      doc.moveTo(leftCol, headerBottom).lineTo(rightEdge, headerBottom).lineWidth(0.6).strokeColor(BORDER).stroke();

      // ════════════════════════════════════════════════════════════
      // 2. BILL TO  (green uppercase label, compact body)
      // ════════════════════════════════════════════════════════════
      let cursorY = headerBottom + 14;
      doc.fontSize(9).fillColor(ACCENT).font("Helvetica-Bold");
      doc.text("BILL TO:", leftCol, cursorY, { characterSpacing: 1, lineBreak: false });
      cursorY += 13;

      const clientName = customerCompany?.name || location.companyName;
      doc.fontSize(11).fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text(clientName, leftCol, cursorY, { width: contentW, lineBreak: false });
      cursorY += 14;

      doc.fontSize(10).font("Helvetica").fillColor(TEXT_BODY);
      // Show distinct location label only when the resolved value
      // would not duplicate the customer name.
      if (
        policy.showLocationName &&
        customerCompany &&
        location.companyName &&
        location.companyName.trim().toLowerCase() !== customerCompany.name.trim().toLowerCase()
      ) {
        doc.text(location.companyName, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }
      const showAddressBlock = policy.showServiceAddress || policy.showBillingAddress;
      if (showAddressBlock && location.address) {
        doc.text(location.address, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }
      if (showAddressBlock && location.address2) {
        doc.text(location.address2, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }
      const billCityLine = [location.city, location.provinceState, location.postalCode].filter(Boolean).join(", ");
      if (showAddressBlock && billCityLine) {
        doc.text(billCityLine, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }
      if (location.phone) {
        doc.text(location.phone, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }
      if (location.email) {
        doc.text(location.email, leftCol, cursorY, { width: contentW, lineBreak: false });
        cursorY += 13;
      }

      // ════════════════════════════════════════════════════════════
      // 3. SERVICE SUMMARY  (conditional, compact bordered container)
      // ════════════════════════════════════════════════════════════
      const workDesc = (invoice as any).workDescription as string | null | undefined;
      const showServiceSummary =
        policy.showJobDescription && workDesc && workDesc.trim().length > 0;
      if (showServiceSummary) {
        cursorY += 14;
        const SUMMARY_LABEL_H = 14;
        const SUMMARY_PAD = 8;
        // Compute body height first so the bordered container sizes
        // tightly to its text. heightOfString accounts for wrapping.
        doc.fontSize(10).font("Helvetica");
        const bodyH = doc.heightOfString(workDesc.trim(), { width: contentW - SUMMARY_PAD * 2 });
        const summaryH = SUMMARY_LABEL_H + bodyH + SUMMARY_PAD * 2 + 4;
        // Draw container.
        doc.roundedRect(leftCol, cursorY, contentW, summaryH, 4).lineWidth(0.6).strokeColor(BORDER).stroke();
        // Label.
        doc.fontSize(9).fillColor(ACCENT).font("Helvetica-Bold");
        doc.text("SERVICE SUMMARY", leftCol + SUMMARY_PAD, cursorY + SUMMARY_PAD, {
          characterSpacing: 1,
          width: contentW - SUMMARY_PAD * 2,
          lineBreak: false,
        });
        // Body.
        doc.fontSize(10).fillColor(TEXT_BODY).font("Helvetica");
        doc.text(workDesc.trim(), leftCol + SUMMARY_PAD, cursorY + SUMMARY_PAD + SUMMARY_LABEL_H, {
          width: contentW - SUMMARY_PAD * 2,
        });
        cursorY += summaryH;
      }

      // ════════════════════════════════════════════════════════════
      // 4. LINE ITEMS TABLE
      // ════════════════════════════════════════════════════════════
      // Bottom of the page that the table is allowed to draw into.
      // We reserve a band at the bottom for footer content; totals +
      // CLIENT COMMUNICATION live above the footer band. Footer
      // content reserve is ~FOOTER_RESERVE pt; tables can extend to
      // (pageH - PAGE_MARGIN) but new pages add headers cleanly.
      const tableBottomY = pageH - PAGE_MARGIN;

      // Column geometry. Description: leftCol+10 .. width 248. Numeric
      // columns right-anchored. Same right edge as `rightEdge`.
      const COL_DESC_X = leftCol + 10;
      const COL_DESC_W = 248;
      const COL_QTY_X = leftCol + 268;
      const COL_QTY_W = 40;
      const COL_PRICE_X = leftCol + 320;
      const COL_PRICE_W = 92;
      const COL_AMT_X = leftCol + 420;
      const COL_AMT_W = 92;

      const showLineItems = policy.showLineItems;
      const showQty = policy.showQuantities;
      const showUnitPrice = policy.showUnitPrices;
      const showLineTotals = policy.showLineTotals;

      // Helper to draw the navy table header. Returns the Y position
      // of the first row below it.
      const drawTableHeader = (topY: number): number => {
        doc.rect(leftCol, topY, contentW, TABLE_HEADER_H).fill(NAVY);
        doc.fontSize(10).fillColor("#ffffff").font("Helvetica-Bold");
        const headerTextY = topY + 6;
        doc.text("Description", COL_DESC_X, headerTextY, { width: COL_DESC_W, lineBreak: false });
        if (showQty) doc.text("Qty", COL_QTY_X, headerTextY, { width: COL_QTY_W, align: "center", lineBreak: false });
        if (showUnitPrice) doc.text("Unit Price", COL_PRICE_X, headerTextY, { width: COL_PRICE_W, align: "right", lineBreak: false });
        if (showLineTotals) doc.text("Amount", COL_AMT_X, headerTextY, { width: COL_AMT_W, align: "right", lineBreak: false });
        return topY + TABLE_HEADER_H;
      };

      // Page-break helper for the line-items loop. When called, ensures
      // the next row of `neededHeight` will fit without crossing the
      // page bottom. Adds a new page + redraws the navy header when
      // necessary, then returns the new rowY.
      const ensureRowRoom = (rowY: number, neededHeight: number): number => {
        if (rowY + neededHeight <= tableBottomY) return rowY;
        doc.addPage();
        drawWatermark();
        return drawTableHeader(PAGE_MARGIN);
      };

      let rowY: number;
      if (showLineItems) {
        cursorY += 12;
        rowY = drawTableHeader(cursorY);

        if (lines.length === 0) {
          rowY = ensureRowRoom(rowY, TABLE_ROW_H);
          doc.fontSize(10).fillColor(TEXT_MUTED).font("Helvetica");
          doc.text("No line items", COL_DESC_X, rowY + 6, { width: COL_DESC_W, lineBreak: false });
          rowY += TABLE_ROW_H;
        } else {
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            rowY = ensureRowRoom(rowY, TABLE_ROW_H);
            // Alternate fill on odd rows (subtle).
            if (i % 2 === 1) {
              doc.rect(leftCol, rowY, contentW, TABLE_ROW_H).fill("#fafafa");
            }
            // Subtle row divider.
            doc.moveTo(leftCol, rowY + TABLE_ROW_H)
              .lineTo(rightEdge, rowY + TABLE_ROW_H)
              .lineWidth(0.4).strokeColor(BORDER).stroke();
            doc.fontSize(10).fillColor(TEXT_BODY).font("Helvetica");
            const cellTextY = rowY + 5;
            doc.text(line.description || "", COL_DESC_X, cellTextY, { width: COL_DESC_W, lineBreak: false, ellipsis: true });
            if (showQty) doc.text(line.quantity || "1", COL_QTY_X, cellTextY, { width: COL_QTY_W, align: "center", lineBreak: false });
            if (showUnitPrice) doc.text(formatCurrency(line.unitPrice), COL_PRICE_X, cellTextY, { width: COL_PRICE_W, align: "right", lineBreak: false });
            if (showLineTotals) doc.text(formatCurrency(line.lineSubtotal), COL_AMT_X, cellTextY, { width: COL_AMT_W, align: "right", lineBreak: false });
            rowY += TABLE_ROW_H;
          }
        }
        cursorY = rowY;
      }

      // ════════════════════════════════════════════════════════════
      // 5. TOTALS BOX (right-aligned, compact)
      // ════════════════════════════════════════════════════════════
      const totalsX = leftCol + 280;
      const totalsW = contentW - 280;
      const hasDiscount = !!invoice.discountAmount && parseFloat(invoice.discountAmount) > 0;
      const showAmountPaid =
        invoice.showBalance !== false && parseFloat(invoice.amountPaid || "0") > 0;
      const TOTALS_PAD_TOP = 10;
      const TOTALS_PAD_BOT = 12;
      const TOTAL_ROW_H = 16;
      const totalsH =
        TOTALS_PAD_TOP +
        TOTAL_ROW_H +                                // subtotal
        (hasDiscount ? TOTAL_ROW_H : 0) +            // discount
        TOTAL_ROW_H +                                // tax
        6 +                                          // separator gap
        18 +                                         // total due (slightly taller)
        (showAmountPaid ? 36 : 0) +
        TOTALS_PAD_BOT;

      // Page-break BEFORE drawing — totals must stay together.
      cursorY += 12;
      if (cursorY + totalsH > tableBottomY) {
        doc.addPage();
        drawWatermark();
        cursorY = PAGE_MARGIN;
      }

      // Container.
      doc.roundedRect(totalsX, cursorY, totalsW, totalsH, 4).lineWidth(0.6).strokeColor(BORDER).stroke();
      let trY = cursorY + TOTALS_PAD_TOP;
      const totalsLabelX = totalsX + 12;
      const totalsValueX = totalsX + totalsW - 102;
      const totalsValueW = 90;

      doc.fontSize(10).font("Helvetica").fillColor(TEXT_MUTED);
      doc.text("Subtotal", totalsLabelX, trY, { lineBreak: false });
      doc.fillColor(TEXT_BODY).font("Helvetica-Bold");
      doc.text(formatCurrency(invoice.subtotal), totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });
      trY += TOTAL_ROW_H;

      if (hasDiscount) {
        const discountLabel = invoice.discountPercent
          ? `Discount (${invoice.discountPercent}%)`
          : "Discount";
        doc.font("Helvetica").fillColor(TEXT_MUTED);
        doc.text(discountLabel, totalsLabelX, trY, { lineBreak: false });
        doc.font("Helvetica-Bold").fillColor(ACCENT);
        doc.text(`-${formatCurrency(invoice.discountAmount)}`, totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });
        trY += TOTAL_ROW_H;
      }

      doc.font("Helvetica").fillColor(TEXT_MUTED);
      doc.text(`Tax (${company.taxName || "Tax"})`, totalsLabelX, trY, { lineBreak: false });
      doc.font("Helvetica-Bold").fillColor(TEXT_BODY);
      doc.text(formatCurrency(invoice.taxTotal), totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });
      trY += TOTAL_ROW_H;

      // Divider above Total Due.
      doc.moveTo(totalsLabelX, trY).lineTo(totalsX + totalsW - 12, trY).lineWidth(0.5).strokeColor(BORDER).stroke();
      trY += 6;

      // 2026-05-06 RALPH v2: TOTAL DUE label is uppercase + bold; the
      // amount is slightly larger (14pt) and rendered in the muted-blue
      // accent so it reads as the document's primary number.
      doc.fontSize(11).fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text("TOTAL DUE", totalsLabelX, trY + 1, { characterSpacing: 0.5, lineBreak: false });
      doc.fontSize(14).fillColor(ACCENT);
      doc.text(formatCurrency(invoice.total), totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });

      if (showAmountPaid) {
        trY += 22;
        doc.fontSize(10).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text("Amount Paid", totalsLabelX, trY, { lineBreak: false });
        doc.fillColor(TEXT_BODY).font("Helvetica-Bold");
        doc.text(formatCurrency(invoice.amountPaid), totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });
        trY += TOTAL_ROW_H;
        const balanceColor = parseFloat(invoice.balance || "0") > 0 ? "#d92d20" : ACCENT;
        doc.fontSize(11).fillColor(balanceColor).font("Helvetica-Bold");
        doc.text("Balance Due", totalsLabelX, trY, { lineBreak: false });
        doc.text(formatCurrency(invoice.balance), totalsValueX, trY, { width: totalsValueW, align: "right", lineBreak: false });
      }

      cursorY += totalsH;

      // ════════════════════════════════════════════════════════════
      // 6. CLIENT COMMUNICATION  (conditional, pushed LOW on the page)
      //
      // 2026-05-06 RALPH v2: instead of rendering this block right
      // after totals (which left the bottom of the page empty when
      // line items were sparse), we anchor it just above the footer
      // band when there is room, so the closing message visually
      // grounds the bottom of the page. The fallback sits right after
      // totals only when the body has consumed enough vertical space
      // that pushing-low would cross the totals.
      //
      // The footer band starts at `pageH - 95` (computed from the
      // bottom-up footer Ys below; see footer geometry doc-block).
      // Subtract a 12pt gap above the footer divider, then the
      // computed comm height, to find the desired top.
      // ════════════════════════════════════════════════════════════
      const messageToRender = policy.clientMessage ?? invoice.notesCustomer ?? null;
      const messageText = messageToRender ? String(messageToRender).trim() : "";
      if (messageText.length > 0) {
        const COMM_LABEL_H = 14;
        const COMM_PAD = 8;
        const COMM_GAP_ABOVE_FOOTER = 14;
        // Compute body height for the bordered container first.
        doc.fontSize(10).font("Helvetica");
        const bodyH = doc.heightOfString(messageText, { width: contentW - COMM_PAD * 2 });
        const commH = COMM_LABEL_H + bodyH + COMM_PAD * 2 + 4;
        // Footer divider Y (matches the bottom-up footer geometry).
        // hasTaxRegs branch decides which divider Y is used; we use
        // the higher (more conservative) of the two so the comm block
        // never overlaps the optional Business Information line.
        const footerTopY = pageH - 95; // safe inset above the topmost footer Y (divider with tax regs at pageH-88)
        const desiredTop = footerTopY - COMM_GAP_ABOVE_FOOTER - commH;

        // Page-break BEFORE drawing — keep the block together. If
        // the comm block won't fit on the current page even with the
        // "push low" placement, move to a new page first.
        const pageBottomBudget = pageH - PAGE_MARGIN; // hard bottom for body content
        if (cursorY + 16 + commH > pageBottomBudget) {
          doc.addPage();
          drawWatermark();
          cursorY = PAGE_MARGIN;
        }

        // Choose Y: push to the bottom band when the body left room;
        // otherwise drop the block right after totals.
        const minTopAfterTotals = cursorY + 16;
        const commTop = desiredTop > minTopAfterTotals ? desiredTop : minTopAfterTotals;

        doc.roundedRect(leftCol, commTop, contentW, commH, 4).lineWidth(0.6).strokeColor(BORDER).fillAndStroke(CONTAINER, BORDER);
        doc.fontSize(9).fillColor(ACCENT).font("Helvetica-Bold");
        doc.text("CLIENT COMMUNICATION", leftCol + COMM_PAD, commTop + COMM_PAD, {
          characterSpacing: 1,
          width: contentW - COMM_PAD * 2,
          lineBreak: false,
        });
        doc.fontSize(10).fillColor(TEXT_BODY).font("Helvetica");
        doc.text(messageText, leftCol + COMM_PAD, commTop + COMM_PAD + COMM_LABEL_H, {
          width: contentW - COMM_PAD * 2,
        });
        cursorY = commTop + commH;
      }

      // ════════════════════════════════════════════════════════════
      // 7. FOOTER (last page only, pinned LOW)
      // ════════════════════════════════════════════════════════════
      // Walk to the last buffered page so the footer is single-page
      // chrome regardless of how many pages the body produced.
      const range = doc.bufferedPageRange();
      const lastPage = range.start + range.count - 1;
      doc.switchToPage(lastPage);

      // Footer Y positions are computed BOTTOM-UP from a safe inset
      // INSIDE the page's bottom margin. PDFKit pre-emptively
      // auto-paginates a `doc.text()` call when `y + lineHeight` would
      // cross `pageH - bottomMargin` (= 742 for LETTER + 50pt margin),
      // which would create a phantom trailing page. Every footer line
      // here ends at least 9pt above that boundary so PDFKit never
      // trips the threshold even with `lineBreak: false`.
      //
      // 2026-05-06 RALPH v2: Business Information renders as TWO
      // centred lines (label on its own row above the formatted tax
      // registrations) so the footer reads as a stacked block instead
      // of an inline label/value pair.
      //
      // Layout (bottom-up, all Ys reference the TOP of the line):
      //   pageH - 65  thank-you Y     (9pt font, line bottom ≈ pageH-54)
      //   pageH - 79  Business Info value Y (8pt font, line bottom ≈ pageH-69)
      //   pageH - 90  Business Info label Y (8pt font, line bottom ≈ pageH-80)
      //   pageH - 95  divider Y       (with tax regs)
      //   pageH - 75  divider Y       (without tax regs)
      //
      // Footer band: ~45pt with tax regs, ~25pt without. Keeps the
      // body's vertical budget wide without crowding the margin.
      const hasTaxRegs =
        !!taxRegistrations &&
        taxRegistrations.some((r) => (r.number ?? "").trim().length > 0);
      const thankYou = company.name
        ? `Thank you for choosing ${company.name}.`
        : null;

      const thankYouY = pageH - 65;
      const bizInfoLabelY = pageH - 90;
      const bizInfoValueY = pageH - 79;
      const dividerY = hasTaxRegs ? pageH - 95 : pageH - 75;

      // Hairline divider above the footer content.
      doc.moveTo(leftCol, dividerY).lineTo(rightEdge, dividerY).lineWidth(0.5).strokeColor(BORDER).stroke();

      // Optional Business Information block — centred two-line stack.
      // Label line (uppercase, muted-blue) on top, formatted tax
      // registration(s) below in muted gray. Renders ONLY when the
      // tenant has at least one tax registration; we never reserve
      // blank space for it.
      if (hasTaxRegs) {
        doc.fontSize(8).fillColor(ACCENT).font("Helvetica-Bold");
        doc.text("BUSINESS INFORMATION", leftCol, bizInfoLabelY, {
          characterSpacing: 1,
          width: contentW,
          align: "center",
          lineBreak: false,
        });
        // Tax registrations rendered on a single line under the label.
        const regs = taxRegistrations!
          .map((r) => {
            const number = (r.number ?? "").trim();
            if (!number) return "";
            const label = (r.label ?? "").trim();
            return label ? `${label} # ${number}` : `Tax ID # ${number}`;
          })
          .filter((s) => s.length > 0)
          .join("     ");
        doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text(regs, leftCol, bizInfoValueY, {
          width: contentW,
          align: "center",
          lineBreak: false,
        });
      }

      if (thankYou) {
        doc.fontSize(9).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text(thankYou, leftCol, thankYouY, {
          width: contentW,
          align: "center",
          lineBreak: false,
        });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
