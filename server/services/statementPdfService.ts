/**
 * Customer Statement PDF generator (simplified layout).
 *
 * Layout (letter, 612×792pt, 50pt margins, 512pt content width):
 *
 *  1. Top header (three zones)
 *     • Left  (x=50,  w=168): Tenant company name + address / phone / email.
 *     • Center (x=226, w=188): "STATEMENT" + Statement Date + Statement For + address.
 *     • Right  (x=422, w=140): AMOUNT DUE bordered box.
 *     • Hairline divider.
 *
 *  2. Bill To section (compact, below header)
 *     BILL TO label + customer name + billing address + phone + email.
 *
 *  3. ACCOUNT ACTIVITY flat table (no per-location group headers)
 *     Columns: Invoice # | Location | Description | Due Date | Amount Due
 *     Grand total row (TOTAL AMOUNT DUE) after the last invoice row.
 *
 *  4. Footer (last page only) — thank-you line + tax registrations + page numbers.
 *
 * Y-tracking rule:
 *   After every doc.text() call that may wrap (i.e., without lineBreak:false),
 *   read doc.y and update the local cursor before computing subsequent Y positions.
 *   This prevents the summary/table band from overlapping a wrapped address.
 *
 * Removed vs. previous version:
 *   • Account Summary card.
 *   • Aging Summary card.
 *   • Account Information card.
 *   • Bottom info boxes (payment options, questions, payment stub).
 *   • Issued-date and status-label columns.
 *   • Per-location group header rows and location subtotal rows.
 */

import PDFDocument from "pdfkit";
import { format, parseISO, isValid, differenceInCalendarDays } from "date-fns";

// ─── Color tokens (identical to invoicePdfService) ────────────────────────────
const NAVY = "#0F172A";
const ACCENT = "#1E3A5F";
const TEXT_DARK = "#0F172A";
const TEXT_BODY = "#334155";
const TEXT_MUTED = "#475569";
const BORDER = "#E2E8F0";
const ROW_ALT = "#fafafa";
const STATUS_RED = "#d92d20";

// ─── Layout constants ─────────────────────────────────────────────────────────
const PAGE_MARGIN = 50;
const TABLE_HEADER_H = 24;
const TABLE_ROW_H = 24;   // two-line location column
// Reserve for footer so ensureRoom never forces a page break into the footer zone.
const FOOTER_RESERVE = 75;

// Header zones — three non-overlapping columns that sum to 512pt
const LEFT_W = 168;                                       // company block
const AMOUNT_BOX_W = 140;                                 // right amount box
const CENTER_START_X = PAGE_MARGIN + LEFT_W + 8;          // 226
const AMOUNT_BOX_X_OFFSET = AMOUNT_BOX_W + PAGE_MARGIN;  // measured from right edge

// Table columns (total = 512pt)
const COL_INV_X = PAGE_MARGIN;                    // Invoice #
const COL_INV_W = 65;
const COL_LOC_X = COL_INV_X + COL_INV_W;         // Location
const COL_LOC_W = 115;
const COL_DESC_X = COL_LOC_X + COL_LOC_W;        // Description
const COL_DESC_W = 148;
const COL_DUE_X = COL_DESC_X + COL_DESC_W;       // Due Date
const COL_DUE_W = 75;
const COL_AMT_X = COL_DUE_X + COL_DUE_W;        // Amount Due
const COL_AMT_W = 109;  // right edge = PAGE_MARGIN + 512 = 562

// ─── Formatters ──────────────────────────────────────────────────────────────
function formatCurrency(amount: string | number | null | undefined): string {
  const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(num);
}

function formatShortDate(value: unknown): string {
  if (!value) return "—";
  const d =
    value instanceof Date
      ? value
      : typeof value === "string"
      ? parseISO(value)
      : new Date(String(value));
  return isValid(d) ? format(d, "MMM d, yyyy") : "—";
}

// ─── Public data shape ────────────────────────────────────────────────────────

export interface StatementInvoiceItem {
  invoiceNumber: string | null;
  dueDate: string | null;
  description: string | null;
  status: string;
  balance: string;
  isPastDue: boolean;
  locationName: string;
  locationAddress: string;
}

export interface StatementPdfData {
  company: {
    name: string;
    address?: string | null;
    city?: string | null;
    provinceState?: string | null;
    postalCode?: string | null;
    email?: string | null;
    phone?: string | null;
    taxName?: string | null;
  };
  taxRegistrations: ReadonlyArray<{ label: string | null; number: string }>;
  customer: {
    name: string;
    billingAddress: string | null;
    phone: string | null;
    email: string | null;
  };
  statementDate: string;
  payByDate: string;
  invoices: StatementInvoiceItem[];
  totals: {
    totalOutstanding: string;
    pastDueTotal: string;
    currentTotal: string;
  };
  /** Kept for backend compatibility; not rendered in the simplified PDF. */
  aging: {
    band0to30: string;
    band31to60: string;
    band61to90: string;
    bandOver90: string;
  };
  /** null = full account; non-null = location display name (scope identifier). */
  scopeLabel: string | null;
}

// ─── Aging computation helper (exported for tests) ───────────────────────────

export interface AgingBands {
  band0to30: string;
  band31to60: string;
  band61to90: string;
  bandOver90: string;
}

export function computeAgingBands(
  invoices: ReadonlyArray<{ dueDate: string | null; balance: string; isPastDue: boolean }>,
  today: Date = new Date(),
): AgingBands {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);

  for (const inv of invoices) {
    const bal = parseFloat(inv.balance ?? "0") || 0;
    if (bal <= 0) continue;
    if (!inv.dueDate) { b0 += bal; continue; }
    const due = parseISO(inv.dueDate);
    if (!isValid(due)) { b0 += bal; continue; }
    const daysOverdue = differenceInCalendarDays(todayMidnight, due);
    if (daysOverdue <= 30)       b0 += bal;
    else if (daysOverdue <= 60)  b1 += bal;
    else if (daysOverdue <= 90)  b2 += bal;
    else                          b3 += bal;
  }
  return {
    band0to30:  b0.toFixed(2),
    band31to60: b1.toFixed(2),
    band61to90: b2.toFixed(2),
    bandOver90: b3.toFixed(2),
  };
}

// ─── Main generator ──────────────────────────────────────────────────────────

export function generateStatementPdf(data: StatementPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const {
        company,
        taxRegistrations,
        customer,
        statementDate,
        payByDate,
        invoices,
        totals,
        scopeLabel,
      } = data;

      const doc = new PDFDocument({
        size: "LETTER",
        margin: PAGE_MARGIN,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageW = doc.page.width;   // 612
      const pageH = doc.page.height;  // 792
      const contentW = pageW - PAGE_MARGIN * 2; // 512
      const leftCol = PAGE_MARGIN;
      const rightEdge = pageW - PAGE_MARGIN;
      // ensureRoom checks rowY + needed <= tableBottomY before adding a new page.
      const tableBottomY = pageH - FOOTER_RESERVE;

      // ════════════════════════════════════════════════════════════
      // 1. TOP HEADER
      // ════════════════════════════════════════════════════════════
      const amountBoxW = AMOUNT_BOX_W;
      const amountBoxX = rightEdge - amountBoxW;
      const amountBoxH = 76;
      const amountBoxY = PAGE_MARGIN;
      const centerStartX = CENTER_START_X;
      const centerW = amountBoxX - 8 - centerStartX; // non-overlapping gap

      // — Left: Company info —
      doc.fontSize(14).fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text(company.name, leftCol, PAGE_MARGIN, { width: LEFT_W, lineBreak: false });

      const CO_LINE_H = 12;
      let companyY = PAGE_MARGIN + 18;
      doc.fontSize(8.5).fillColor(TEXT_MUTED).font("Helvetica");
      const writeCoLine = (t: string) => {
        doc.text(t, leftCol, companyY, { width: LEFT_W, lineBreak: false });
        companyY += CO_LINE_H;
      };
      if (company.address) writeCoLine(company.address);
      const cityLine = [company.city, company.provinceState, company.postalCode]
        .filter(Boolean).join(", ");
      if (cityLine) writeCoLine(cityLine);
      if (company.phone) writeCoLine(company.phone);
      if (company.email) writeCoLine(company.email);

      // — Right: AMOUNT DUE box —
      doc
        .roundedRect(amountBoxX, amountBoxY, amountBoxW, amountBoxH, 4)
        .lineWidth(0.8)
        .strokeColor(ACCENT)
        .stroke();
      doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica-Bold");
      doc.text("AMOUNT DUE", amountBoxX, amountBoxY + 7, {
        width: amountBoxW, align: "center", characterSpacing: 1, lineBreak: false,
      });
      doc.fontSize(17).fillColor(ACCENT).font("Helvetica-Bold");
      doc.text(formatCurrency(totals.totalOutstanding), amountBoxX, amountBoxY + 19, {
        width: amountBoxW, align: "center", lineBreak: false,
      });
      doc.fontSize(7.5).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text(`Pay by: ${formatShortDate(payByDate)}`, amountBoxX, amountBoxY + 42, {
        width: amountBoxW, align: "center", lineBreak: false,
      });
      doc.text("Thank you for your business.", amountBoxX, amountBoxY + 53, {
        width: amountBoxW, align: "center", lineBreak: false,
      });

      // — Center: STATEMENT title + metadata —
      doc.fontSize(20).fillColor(NAVY).font("Helvetica-Bold");
      doc.text("STATEMENT", centerStartX, PAGE_MARGIN + 2, {
        width: centerW, align: "center", lineBreak: false,
      });

      const META_LINE_H = 13;
      let metaY = PAGE_MARGIN + 28;
      const metaLabelX = centerStartX;
      const metaValueX = centerStartX + 68;
      const metaValueW = centerW - 68;

      const writeMeta = (label: string, value: string) => {
        doc.fontSize(8.5).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text(label, metaLabelX, metaY, { width: 66, lineBreak: false });
        doc.fontSize(8.5).fillColor(TEXT_DARK).font("Helvetica-Bold");
        doc.text(value, metaValueX, metaY, { width: metaValueW, lineBreak: false });
        metaY += META_LINE_H;
      };

      writeMeta("Date:", formatShortDate(statementDate));
      writeMeta("Statement For:", customer.name);
      if (customer.billingAddress) {
        doc.fontSize(8.5).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text("Address:", metaLabelX, metaY, { width: 66, lineBreak: false });
        doc.fontSize(8.5).fillColor(TEXT_BODY).font("Helvetica");
        // May wrap — read doc.y afterwards to update metaY correctly
        doc.text(customer.billingAddress, metaValueX, metaY, { width: metaValueW });
        metaY = doc.y + 2;
      }
      if (scopeLabel) {
        writeMeta("Location:", scopeLabel);
      }

      // Hairline — max of all three zones
      const headerBottom = Math.max(
        companyY + 4,
        amountBoxY + amountBoxH + 8,
        metaY + 4,
      );
      doc
        .moveTo(leftCol, headerBottom)
        .lineTo(rightEdge, headerBottom)
        .lineWidth(0.6)
        .strokeColor(BORDER)
        .stroke();

      let cursorY = headerBottom + 10;

      // ════════════════════════════════════════════════════════════
      // 2. BILL TO section
      // ════════════════════════════════════════════════════════════
      const BILL_TO_W = 240;

      doc.fontSize(7).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text("BILL TO", leftCol, cursorY, { characterSpacing: 0.8, lineBreak: false });
      cursorY += 10;

      doc.fontSize(10).fillColor(TEXT_DARK).font("Helvetica-Bold");
      doc.text(customer.name, leftCol, cursorY, { width: BILL_TO_W, lineBreak: false });
      cursorY += 14;

      doc.fontSize(8.5).fillColor(TEXT_BODY).font("Helvetica");
      if (customer.billingAddress) {
        // May wrap — update cursorY from doc.y
        doc.text(customer.billingAddress, leftCol, cursorY, { width: BILL_TO_W });
        cursorY = doc.y + 2;
      }
      if (customer.phone) {
        doc.text(customer.phone, leftCol, cursorY, { width: BILL_TO_W, lineBreak: false });
        cursorY += 11;
      }
      if (customer.email) {
        doc.text(customer.email, leftCol, cursorY, { width: BILL_TO_W, lineBreak: false });
        cursorY += 11;
      }

      cursorY += 12;

      // ════════════════════════════════════════════════════════════
      // 3. ACCOUNT ACTIVITY TABLE
      // ════════════════════════════════════════════════════════════
      doc.fontSize(10).fillColor(ACCENT).font("Helvetica-Bold");
      doc.text("ACCOUNT ACTIVITY", leftCol, cursorY, {
        characterSpacing: 0.5, lineBreak: false,
      });
      cursorY += 14;

      const drawTableHeader = (topY: number): number => {
        doc.rect(leftCol, topY, contentW, TABLE_HEADER_H).fill(NAVY);
        doc.fontSize(8.5).fillColor("#ffffff").font("Helvetica-Bold");
        const hy = topY + 8;
        doc.text("Invoice #",   COL_INV_X + 4,  hy, { width: COL_INV_W - 4,  lineBreak: false });
        doc.text("Location",    COL_LOC_X + 3,  hy, { width: COL_LOC_W - 3,  lineBreak: false });
        doc.text("Description", COL_DESC_X + 3, hy, { width: COL_DESC_W - 3, lineBreak: false });
        doc.text("Due Date",    COL_DUE_X + 3,  hy, { width: COL_DUE_W - 3,  lineBreak: false });
        doc.text("Amount Due",  COL_AMT_X,      hy, { width: COL_AMT_W - 4,  align: "right", lineBreak: false });
        return topY + TABLE_HEADER_H;
      };

      // Add a new page only when the next row cannot fit; always redraw header.
      const ensureRoom = (rowY: number, needed: number): number => {
        if (rowY + needed <= tableBottomY) return rowY;
        doc.addPage();
        return drawTableHeader(PAGE_MARGIN);
      };

      let rowY = drawTableHeader(cursorY);
      let rowIndex = 0;

      for (const inv of invoices) {
        rowY = ensureRoom(rowY, TABLE_ROW_H);
        if (rowIndex % 2 === 1) {
          doc.rect(leftCol, rowY, contentW, TABLE_ROW_H).fillColor(ROW_ALT).fill();
        }
        doc
          .moveTo(leftCol, rowY + TABLE_ROW_H)
          .lineTo(rightEdge, rowY + TABLE_ROW_H)
          .lineWidth(0.3)
          .strokeColor(BORDER)
          .stroke();

        const amtColor = inv.isPastDue ? STATUS_RED : TEXT_DARK;
        const dueDateColor = inv.isPastDue ? STATUS_RED : TEXT_BODY;

        // Vertically center single-line columns; location gets two lines
        const textY = rowY + 7;
        const locLine1Y = rowY + 4;
        const locLine2Y = rowY + 14;

        // Invoice #
        doc.fontSize(8.5).fillColor(TEXT_BODY).font("Helvetica");
        doc.text(
          inv.invoiceNumber ? `#${inv.invoiceNumber}` : "—",
          COL_INV_X + 4, textY,
          { width: COL_INV_W - 4, lineBreak: false },
        );

        // Location — name (bold) + address (muted, smaller)
        doc.fontSize(8).fillColor(TEXT_BODY).font("Helvetica-Bold");
        doc.text(
          inv.locationName || "—",
          COL_LOC_X + 3, locLine1Y,
          { width: COL_LOC_W - 3, lineBreak: false, ellipsis: true },
        );
        if (inv.locationAddress) {
          doc.fontSize(7).fillColor(TEXT_MUTED).font("Helvetica");
          doc.text(
            inv.locationAddress,
            COL_LOC_X + 3, locLine2Y,
            { width: COL_LOC_W - 3, lineBreak: false, ellipsis: true },
          );
        }

        // Description
        doc.fontSize(8.5).fillColor(TEXT_BODY).font("Helvetica");
        doc.text(
          inv.description ?? "—",
          COL_DESC_X + 3, textY,
          { width: COL_DESC_W - 3, lineBreak: false, ellipsis: true },
        );

        // Due Date (red if overdue)
        doc.fontSize(8.5).fillColor(dueDateColor).font("Helvetica");
        doc.text(
          formatShortDate(inv.dueDate),
          COL_DUE_X + 3, textY,
          { width: COL_DUE_W - 3, lineBreak: false },
        );

        // Amount Due (right-aligned, red if overdue)
        doc.fillColor(amtColor).font("Helvetica-Bold");
        doc.text(
          formatCurrency(inv.balance),
          COL_AMT_X, textY,
          { width: COL_AMT_W - 4, align: "right", lineBreak: false },
        );

        rowY += TABLE_ROW_H;
        rowIndex++;
      }

      // ─── TOTAL AMOUNT DUE row ─────────────────────────────────
      const TOTAL_ROW_H = 28;
      rowY = ensureRoom(rowY, TOTAL_ROW_H + 4);
      doc
        .moveTo(leftCol, rowY + 4)
        .lineTo(rightEdge, rowY + 4)
        .lineWidth(0.8)
        .strokeColor(ACCENT)
        .stroke();
      doc.fontSize(9).fillColor(TEXT_MUTED).font("Helvetica");
      doc.text("TOTAL AMOUNT DUE", leftCol + 4, rowY + 11, { lineBreak: false });
      doc.fontSize(11).fillColor(ACCENT).font("Helvetica-Bold");
      doc.text(formatCurrency(totals.totalOutstanding), COL_AMT_X, rowY + 9, {
        width: COL_AMT_W - 4, align: "right", lineBreak: false,
      });

      // ════════════════════════════════════════════════════════════
      // 4. FOOTER — page numbers on every page; thank-you on last page
      // ════════════════════════════════════════════════════════════
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(range.start + i);
        doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica");
        // Y must stay ≤ maxY (pageH − PAGE_MARGIN = 742) to avoid PDFKit
        // auto-adding a blank page. pageH − 38 = 754 exceeds maxY and
        // caused a phantom second page on single-invoice statements.
        doc.text(`Page ${i + 1} of ${totalPages}`, leftCol, pageH - PAGE_MARGIN - 8, {
          width: contentW, align: "right", lineBreak: false,
        });
      }

      doc.switchToPage(range.start + totalPages - 1);

      const taxRegLines: string[] = (taxRegistrations ?? [])
        .map((r) => {
          const num = (r.number ?? "").trim();
          if (!num) return "";
          const lbl = (r.label ?? "").trim();
          return lbl ? `${lbl} # ${num}` : `Tax ID # ${num}`;
        })
        .filter((s) => s.length > 0);

      const thankYou = company.name
        ? `Thank you for choosing ${company.name}.`
        : null;

      const TAX_LINE_H = 11;
      const SAFE_BOTTOM_Y = pageH - 65;
      const regCount = taxRegLines.length;
      const firstRegY = regCount > 0
        ? SAFE_BOTTOM_Y - (regCount - 1) * TAX_LINE_H
        : SAFE_BOTTOM_Y;
      const thanksY = regCount > 0 ? firstRegY - TAX_LINE_H : SAFE_BOTTOM_Y;
      const dividerY = thanksY - 6;

      doc
        .moveTo(leftCol, dividerY)
        .lineTo(rightEdge, dividerY)
        .lineWidth(0.5)
        .strokeColor(BORDER)
        .stroke();

      if (thankYou) {
        doc.fontSize(9).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text(thankYou, leftCol, thanksY, {
          width: contentW, align: "center", lineBreak: false,
        });
      }
      for (let i = 0; i < regCount; i++) {
        doc.fontSize(8).fillColor(TEXT_MUTED).font("Helvetica");
        doc.text(taxRegLines[i], leftCol, firstRegY + i * TAX_LINE_H, {
          width: contentW, align: "center", lineBreak: false,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
