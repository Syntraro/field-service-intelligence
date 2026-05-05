import PDFDocument from "pdfkit";
import { format, parseISO, isValid } from "date-fns";
import type { Invoice, InvoiceLine, Company } from "@shared/schema";
// 2026-05-05: canonical resolved Invoice Display policy. See
// `shared/invoiceDisplayPolicy.ts` for the merge rules. Callers that
// don't pass a policy fall back to the resolver's defaults — matches
// the prior, pre-tenant-policy rendering behavior exactly.
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
    address2?: string | null; // Address line 2 (suite, unit, floor)
    city?: string | null;
    provinceState?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  customerCompany?: {
    name: string;
  } | null;
  /**
   * 2026-05-03: tenant tax-registration identity (multi-row).
   * One line is rendered per entry under the company contact
   * block. Empty / undefined / empty-array → no lines rendered.
   * Each entry's label is optional (PDF falls back to "Tax ID:");
   * each entry's number is required to render. Source of truth:
   * `company_tax_registrations` table, fetched by callers via
   * `companyTaxRegistrationRepository.list(tenantId)` and passed
   * here in presentation order.
   */
  taxRegistrations?: ReadonlyArray<{
    label: string | null;
    number: string;
  }>;
  /**
   * 2026-05-05: resolved Invoice Display policy. If omitted, the PDF
   * falls back to the resolver's defaults using the invoice row alone
   * — preserving the pre-tenant-policy rendering exactly. Callers that
   * have access to the tenant `company_settings` row SHOULD pass a
   * resolved policy so per-tenant overrides take effect.
   */
  policy?: InvoiceDisplayPolicy;
  /**
   * 2026-05-05: optional fields the policy may surface on the PDF.
   * `jobNumber` shows up only when `policy.showJobNumber` is true.
   * `companyWebsite` shows up only when `policy.showCompanyWebsite`
   * is true. Both are passed in by callers (resolved from job +
   * company storage) since the PDF service has no DB access.
   */
  jobNumber?: string | null;
  companyWebsite?: string | null;
}

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
    case "draft":
      return "DRAFT";
    case "voided":
      return "VOID";
    case "paid":
      return "PAID";
    default:
      return null;
  }
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const { invoice, lines, company, location, customerCompany, taxRegistrations, jobNumber, companyWebsite } = data;
      // 2026-05-05: resolved display policy — every visibility decision
      // below reads from `policy` instead of hand-rolling per-flag null
      // coalescing. When the caller doesn't supply one, fall back to the
      // pure resolver against the invoice alone (defaults preserve
      // pre-tenant-policy behavior exactly).
      const policy: InvoiceDisplayPolicy =
        data.policy ??
        resolveInvoiceDisplayPolicy({
          tenantSettings: null,
          invoice: invoice as any,
        });
      const doc = new PDFDocument({
        size: "LETTER",
        margin: 50,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - 100; // Margins
      const leftCol = 50;
      const rightCol = doc.page.width - 200;

      // ========================================
      // WATERMARK (if applicable)
      // ========================================
      const watermark = getStatusWatermark(invoice.status);
      if (watermark) {
        doc.save();
        doc.fontSize(72);
        doc.fillColor("#e0e0e0");
        doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.text(watermark, 0, doc.page.height / 2 - 50, {
          align: "center",
          width: doc.page.width,
        });
        doc.restore();
      }

      // ========================================
      // HEADER - Company Info
      // ========================================
      doc.fontSize(20).fillColor("#333333").font("Helvetica-Bold");
      doc.text(company.name, leftCol, 50);

      doc.fontSize(10).fillColor("#666666").font("Helvetica");
      let companyY = 75;
      // 2026-05-05: each company-info line gates on the resolved policy.
      // "Show address" combines the street + city/state line into one
      // toggle (they are conceptually one address block).
      if (policy.showCompanyAddress && company.address) {
        doc.text(company.address, leftCol, companyY);
        companyY += 14;
      }
      const cityLine = [company.city, company.provinceState, company.postalCode].filter(Boolean).join(", ");
      if (policy.showCompanyAddress && cityLine) {
        doc.text(cityLine, leftCol, companyY);
        companyY += 14;
      }
      // 2026-05-03 polish (round 4): drop the "Phone: " / "Email: "
      // label prefixes so the company block matches the location
      // block formatting (which already renders raw values). The
      // surrounding visual context already implies what each line is.
      if (policy.showCompanyPhone && company.phone) {
        doc.text(company.phone, leftCol, companyY);
        companyY += 14;
      }
      if (policy.showCompanyEmail && company.email) {
        doc.text(company.email, leftCol, companyY);
        companyY += 14;
      }
      // 2026-05-05: optional company website line. Renders only when the
      // tenant policy enables it AND a value was passed in (no schema
      // column for website yet — caller resolves the value).
      if (policy.showCompanyWebsite && companyWebsite && companyWebsite.trim().length > 0) {
        doc.text(companyWebsite, leftCol, companyY);
        companyY += 14;
      }
      // 2026-05-03: tenant tax-registration identity (multi-row).
      // One line is rendered per active entry directly under the
      // contact block so they read as part of the sender's identity
      // (matches the Canadian invoice convention for the HST/GST
      // registration line — and supports tenants with multiple
      // registrations, e.g. HST + GST or VAT + EORI).
      //   • label + number → "{label}: {number}"  e.g. "HST: 739597326 RT0001"
      //   • only number    → "Tax ID: {number}"
      //   • blank entries  → skipped (`number` is required to render)
      //   • empty list     → no lines rendered, no whitespace
      //                      advance — preserves the existing-tenant
      //                      default and the current vertical rhythm
      //                      for tenants who haven't filled it in.
      // Source: `company_tax_registrations` table, passed in by the
      // caller via `taxRegistrations` (already in presentation order).
      // `companyY` advances 14pt per rendered entry — same line-height
      // as every other contact-block line above.
      // 2026-05-05: tax-number lines gated by the resolved policy.
      if (policy.showTaxNumber && taxRegistrations && taxRegistrations.length > 0) {
        for (const reg of taxRegistrations) {
          const number = (reg.number ?? "").trim();
          if (!number) continue;
          const label = (reg.label ?? "").trim();
          const line = label ? `${label}: ${number}` : `Tax ID: ${number}`;
          doc.text(line, leftCol, companyY);
          companyY += 14;
        }
      }

      // ========================================
      // INVOICE TITLE + NUMBER
      // ========================================
      doc.fontSize(24).fillColor("#333333").font("Helvetica-Bold");
      doc.text("INVOICE", rightCol, 50);

      doc.fontSize(11).fillColor("#666666").font("Helvetica");
      doc.text(invoice.invoiceNumber || `#${invoice.id.slice(0, 8)}`, rightCol, 80);

      // ========================================
      // CLIENT INFO
      // ========================================
      const clientY = Math.max(companyY + 20, 140);

      doc.fontSize(11).fillColor("#333333").font("Helvetica-Bold");
      doc.text("BILL TO:", leftCol, clientY);

      doc.fontSize(11).fillColor("#333333").font("Helvetica");
      let clientInfoY = clientY + 16;

      // Client name is MANDATORY — always rendered (per spec).
      const clientName = customerCompany?.name || location.companyName;
      doc.font("Helvetica-Bold").text(clientName, leftCol, clientInfoY);
      clientInfoY += 14;

      // 2026-05-05: location name is now policy-gated. We still skip
      // the line entirely when it would duplicate the customer-company
      // name (display-equality, not tenant policy).
      if (
        policy.showLocationName &&
        customerCompany &&
        location.companyName !== customerCompany.name
      ) {
        doc.font("Helvetica").text(location.companyName, leftCol, clientInfoY);
        clientInfoY += 14;
      }

      doc.font("Helvetica");
      // 2026-05-05: service address (the location address block). Spec
      // distinguishes billing address from service address — when only
      // one address is known (today's data shape), gating on the union
      // of the two policy flags keeps existing tenants seeing their
      // address block until they explicitly turn both off.
      const showAddressBlock = policy.showServiceAddress || policy.showBillingAddress;
      if (showAddressBlock && location.address) {
        doc.text(location.address, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      if (showAddressBlock && location.address2) {
        doc.text(location.address2, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      const locCityLine = [location.city, location.provinceState, location.postalCode].filter(Boolean).join(", ");
      if (showAddressBlock && locCityLine) {
        doc.text(locCityLine, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      // Location-level phone/email are NOT in the new tenant policy
      // (Section 2 explicitly omits them) — render as-before so this
      // change stays visibility-only and additive.
      if (location.phone) {
        doc.text(location.phone, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      if (location.email) {
        doc.text(location.email, leftCol, clientInfoY);
        clientInfoY += 14;
      }

      // ========================================
      // INVOICE DETAILS (right side)
      // ========================================
      doc.fontSize(10).fillColor("#666666").font("Helvetica");

      const detailsX = rightCol;
      let detailsY = clientY;

      const addDetail = (label: string, value: string) => {
        doc.font("Helvetica").text(label, detailsX, detailsY, { continued: false });
        doc.font("Helvetica-Bold").text(value, detailsX + 80, detailsY);
        detailsY += 16;
      };

      // Mandatory locked: Issue Date + Due Date always render.
      addDetail("Issue Date:", formatDate(invoice.issuedAt || invoice.issueDate));
      addDetail("Due Date:", formatDate(invoice.dueDate));
      // 2026-05-05: optional policy-gated details — Job Number + Summary.
      // Both render under the dates only when the tenant policy enables
      // them AND a value exists. Spec keeps the layout summary-style; no
      // separate header section is added.
      if (policy.showJobNumber && jobNumber && jobNumber.trim().length > 0) {
        addDetail("Job #:", jobNumber);
      }
      if (policy.showSummary && (invoice as any).summary && String((invoice as any).summary).trim().length > 0) {
        addDetail("Summary:", String((invoice as any).summary));
      }

      // 2026-05-03 polish: the customer-facing PDF previously rendered an
      // internal status pill ("AWAITING PAYMENT" / "PARTIAL" / etc.) under
      // the dates. That state is internal context — customers don't need
      // to see our billing-pipeline labels — so the badge has been removed.
      // The diagonal watermark for DRAFT/VOID/PAID handled above remains,
      // since those carry meaningful guidance for the recipient.

      // ========================================
      // LINE ITEMS TABLE (respects visibility flags)
      // ========================================
      // 2026-05-05: visibility flags now come from the resolved policy
      // (per-invoice override + tenant default merged upstream).
      const showLineItems = policy.showLineItems;
      const showQty = policy.showQuantities;
      const showUnitPrice = policy.showUnitPrices;
      const showLineTotals = policy.showLineTotals;
      const showJobDescription = policy.showJobDescription;

      // 2026-05-03 polish (round 4): the `+50` here used to reserve
      // 30pt gap + 20pt for the status pill that lived under the
      // dates. The pill was removed in an earlier polish pass; the
      // stale 20pt was leaving a visible whitespace hole below the
      // dates block. Now `+30` matches the gap below BILL TO.
      let descriptionTop = Math.max(clientInfoY + 30, detailsY + 30);
      const workDesc = (invoice as any).workDescription as string | null | undefined;
      if (showJobDescription && workDesc && workDesc.trim().length > 0) {
        // 2026-05-03 polish (round 4): section header was muted gray
        // (#666) at fontSize 10 — visually weaker than the body text
        // (#333) it introduced. Bumped to fontSize 11 + #333 so the
        // header reads as a proper section title.
        doc.fontSize(11).fillColor("#333333").font("Helvetica-Bold");
        doc.text("Scope of Work", leftCol, descriptionTop);
        doc.font("Helvetica").fontSize(10).fillColor("#333333");
        const descHeight = doc.heightOfString(workDesc, { width: pageWidth });
        doc.text(workDesc, leftCol, descriptionTop + 14, { width: pageWidth });
        descriptionTop = descriptionTop + 14 + descHeight + 12;
      }

      const tableTop = descriptionTop;
      let rowY: number;

      if (showLineItems) {
        // Table header
        doc.rect(leftCol, tableTop, pageWidth, 24).fill("#f5f5f5");

        // 2026-05-03 polish (round 4): column offsets realigned so
        // the Amount column ends inside the 512pt content width
        // (was overflowing 18pt past the right margin). All four
        // columns now fit within `pageWidth` with ~10pt right
        // padding from the table edge.
        //   Description: leftCol+10 .. width 240 → x 60..300
        //   Qty:         leftCol+260 .. width 40, center → x 310..350
        //   Rate:        leftCol+310 .. width 90, right → text ends at x 450
        //   Amount:      leftCol+410 .. width 92, right → text ends at x 552
        // Right margin starts at leftCol+pageWidth = 562 (pageWidth=512).
        doc.fontSize(10).fillColor("#333333").font("Helvetica-Bold");
        doc.text("Description", leftCol + 10, tableTop + 7, { width: 240 });
        if (showQty) doc.text("Qty", leftCol + 260, tableTop + 7, { width: 40, align: "center" });
        if (showUnitPrice) doc.text("Rate", leftCol + 310, tableTop + 7, { width: 90, align: "right" });
        if (showLineTotals) doc.text("Amount", leftCol + 410, tableTop + 7, { width: 92, align: "right" });

        // Table rows
        rowY = tableTop + 24;
        doc.font("Helvetica").fontSize(10).fillColor("#333333");

        if (lines.length === 0) {
          doc.fillColor("#999999").text("No line items", leftCol + 10, rowY + 10);
          rowY += 30;
        } else {
          for (const line of lines) {
            const lineHeight = 24;

            // Alternate row background
            if (lines.indexOf(line) % 2 === 1) {
              doc.rect(leftCol, rowY, pageWidth, lineHeight).fill("#fafafa");
            }

            doc.fillColor("#333333");
            doc.text(line.description || "", leftCol + 10, rowY + 7, { width: 240 });
            if (showQty) doc.text(line.quantity || "1", leftCol + 260, rowY + 7, { width: 40, align: "center" });
            if (showUnitPrice) doc.text(formatCurrency(line.unitPrice), leftCol + 310, rowY + 7, { width: 90, align: "right" });
            if (showLineTotals) doc.text(formatCurrency(line.lineSubtotal), leftCol + 410, rowY + 7, { width: 92, align: "right" });

            rowY += lineHeight;
          }
        }
      } else {
        // Line items hidden — just leave space for totals
        rowY = tableTop;
      }

      // ========================================
      // TOTALS
      // ========================================
      const totalsX = leftCol + 350;
      const totalsWidth = pageWidth - 350;
      rowY += 10;

      // 2026-05-03 polish (round 4): totals-box height is now
      // computed dynamically from the rows we will actually
      // render. Was a fixed `hasDiscount ? 100 : 70` that ignored
      // the optional Amount Paid + Balance Due block, leaving
      // those rows rendered OUTSIDE the colored box on
      // partially-paid invoices. Padding is a consistent 12pt
      // top + 12pt bottom regardless of variant.
      const hasDiscount = invoice.discountAmount && parseFloat(invoice.discountAmount) > 0;
      const showAmountPaid =
        invoice.showBalance !== false && parseFloat(invoice.amountPaid || "0") > 0;
      const totalsHeight =
        12 +                              // top padding
        16 +                              // subtotal row
        (hasDiscount ? 16 : 0) +          // optional discount row
        16 +                              // tax row
        6 +                               // separator gap
        16 +                              // total row (fontSize:12)
        (showAmountPaid ? 36 : 0) +       // amount paid + balance due block
        12;                               // bottom padding

      // Totals box
      doc.rect(totalsX, rowY, totalsWidth, totalsHeight).fill("#f9f9f9").stroke("#e0e0e0");

      let totalsRowY = rowY + 12;
      doc.fontSize(10).fillColor("#666666").font("Helvetica");
      doc.text("Subtotal:", totalsX + 10, totalsRowY);
      doc.text(formatCurrency(invoice.subtotal), totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });
      totalsRowY += 16;

      // Discount (if applicable)
      if (hasDiscount) {
        const discountLabel = invoice.discountPercent
          ? `Discount (${invoice.discountPercent}%):`
          : "Discount:";
        doc.fillColor("#4caf50");
        doc.text(discountLabel, totalsX + 10, totalsRowY);
        doc.text(`-${formatCurrency(invoice.discountAmount)}`, totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });
        totalsRowY += 16;
        doc.fillColor("#666666");
      }

      doc.text(`Tax (${company.taxName || "Tax"}):`, totalsX + 10, totalsRowY);
      doc.text(formatCurrency(invoice.taxTotal), totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });
      totalsRowY += 16;

      doc.rect(totalsX + 10, totalsRowY, totalsWidth - 20, 1).fill("#e0e0e0");
      totalsRowY += 6;

      doc.fontSize(12).fillColor("#333333").font("Helvetica-Bold");
      doc.text("Total:", totalsX + 10, totalsRowY);
      doc.text(formatCurrency(invoice.total), totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });

      // Amount Paid and Balance (if any payments and showBalance is enabled).
      // `showAmountPaid` was computed above so the box height calc and
      // the actual render path can never disagree.
      if (showAmountPaid) {
        totalsRowY += 20;
        doc.fontSize(10).fillColor("#666666").font("Helvetica");
        doc.text("Amount Paid:", totalsX + 10, totalsRowY);
        doc.text(formatCurrency(invoice.amountPaid), totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });

        totalsRowY += 16;
        const balanceColor = parseFloat(invoice.balance || "0") > 0 ? "#f44336" : "#4caf50";
        doc.fontSize(12).fillColor(balanceColor).font("Helvetica-Bold");
        doc.text("Balance Due:", totalsX + 10, totalsRowY);
        doc.text(formatCurrency(invoice.balance), totalsX + totalsWidth - 90, totalsRowY, { width: 80, align: "right" });
      }

      // ========================================
      // NOTES / CLIENT MESSAGE
      //
      // 2026-05-03 polish (round 4): Notes Y is now derived from
      // the (dynamic, accurate) end of the totals box rather than
      // the old fixed `totalsHeight`. With the height bug fixed
      // above, `totalsEndY` is the actual bottom edge of the
      // rendered box for every invoice variant, so notes can
      // never overprint Amount Paid / Balance Due rows.
      // ========================================
      const totalsEndY = rowY + totalsHeight;
      const notesY = totalsEndY + 20;
      // 2026-05-05: client message is gated by the resolved policy.
      // The resolver returns null when the tenant has the block off
      // entirely OR when the per-invoice content is empty/whitespace,
      // so the renderer never has to second-guess intent. notesCustomer
      // is the QBO-mirrored CustomerMemo and is still rendered when the
      // primary client message is absent — that's pre-existing behavior
      // and is unrelated to the new tenant Client-Message toggle.
      const messageToRender = policy.clientMessage ?? invoice.notesCustomer ?? null;
      if (messageToRender && messageToRender.trim().length > 0) {
        doc.fontSize(11).fillColor("#333333").font("Helvetica-Bold");
        doc.text("Notes:", leftCol, notesY);
        doc.fontSize(10).fillColor("#666666").font("Helvetica");
        doc.text(messageToRender, leftCol, notesY + 16, { width: pageWidth });
      }

      // ========================================
      // FOOTER (rendered ONCE on the last page)
      //
      // 2026-05-03 polish (round 4): previously the footer was
      // drawn inline at `Y = doc.page.height - 50`, which would
      // either land on whichever page the PDFKit cursor happened
      // to be on at that moment OR (worse) trigger an auto-paginate
      // if the cursor had already crossed the bottom margin —
      // producing occasional blank-looking page-2s.
      //
      // The new pattern uses the `bufferPages: true` doc option
      // (already set on the constructor): walk the buffered page
      // range AFTER all main rendering has finished, switch to
      // the LAST page, and draw the footer there with
      // `lineBreak: false` so the call cannot itself trigger a
      // new page. Single-page invoices: footer on page 1.
      // Multi-page invoices: footer on the last page only.
      // ========================================
      const range = doc.bufferedPageRange();
      const lastPage = range.start + range.count - 1;
      doc.switchToPage(lastPage);
      const footerY = doc.page.height - 50;
      doc.fontSize(9).fillColor("#999999").font("Helvetica");
      doc.text(
        `Invoice generated on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`,
        leftCol,
        footerY,
        { width: pageWidth, align: "center", lineBreak: false }
      );

      // Finalize PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
