import PDFDocument from "pdfkit";
import { format, parseISO, isValid } from "date-fns";
import type { Invoice, InvoiceLine, Company } from "@shared/schema";

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
      const { invoice, lines, company, location, customerCompany } = data;
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
      if (company.address) {
        doc.text(company.address, leftCol, companyY);
        companyY += 14;
      }
      const cityLine = [company.city, company.provinceState, company.postalCode].filter(Boolean).join(", ");
      if (cityLine) {
        doc.text(cityLine, leftCol, companyY);
        companyY += 14;
      }
      if (company.phone) {
        doc.text(`Phone: ${company.phone}`, leftCol, companyY);
        companyY += 14;
      }
      if (company.email) {
        doc.text(`Email: ${company.email}`, leftCol, companyY);
        companyY += 14;
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

      // Customer company name (if different from location)
      const clientName = customerCompany?.name || location.companyName;
      doc.font("Helvetica-Bold").text(clientName, leftCol, clientInfoY);
      clientInfoY += 14;

      // Location name (if different from customer company)
      if (customerCompany && location.companyName !== customerCompany.name) {
        doc.font("Helvetica").text(location.companyName, leftCol, clientInfoY);
        clientInfoY += 14;
      }

      doc.font("Helvetica");
      if (location.address) {
        doc.text(location.address, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      if (location.address2) {
        doc.text(location.address2, leftCol, clientInfoY);
        clientInfoY += 14;
      }
      const locCityLine = [location.city, location.provinceState, location.postalCode].filter(Boolean).join(", ");
      if (locCityLine) {
        doc.text(locCityLine, leftCol, clientInfoY);
        clientInfoY += 14;
      }
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

      addDetail("Issue Date:", formatDate(invoice.issuedAt || invoice.issueDate));
      addDetail("Due Date:", formatDate(invoice.dueDate));

      // Status badge
      detailsY += 8;
      const statusColors: Record<string, string> = {
        draft: "#9e9e9e",
        awaiting_payment: "#2196f3",
        sent: "#2196f3",
        partial_paid: "#ff9800",
        paid: "#4caf50",
        voided: "#f44336",
      };
      const statusLabels: Record<string, string> = {
        draft: "DRAFT",
        awaiting_payment: "AWAITING PAYMENT",
        sent: "SENT",
        partial_paid: "PARTIAL",
        paid: "PAID",
        voided: "VOIDED",
      };
      const statusColor = statusColors[invoice.status] || "#9e9e9e";
      const statusLabel = statusLabels[invoice.status] || invoice.status.toUpperCase();
      doc.roundedRect(detailsX, detailsY, 100, 20, 4).fill(statusColor);
      doc.fontSize(9).fillColor("#ffffff").font("Helvetica-Bold");
      doc.text(statusLabel, detailsX + 5, detailsY + 5, { width: 90, align: "center" });

      // ========================================
      // LINE ITEMS TABLE (respects visibility flags)
      // ========================================
      const showLineItems = invoice.showLineItems !== false;
      const showQty = invoice.showQuantity !== false;
      const showUnitPrice = invoice.showUnitPrice !== false;
      const showLineTotals = invoice.showLineTotals !== false;

      const tableTop = Math.max(clientInfoY + 30, detailsY + 50);
      let rowY: number;

      if (showLineItems) {
        // Table header
        doc.rect(leftCol, tableTop, pageWidth, 24).fill("#f5f5f5");

        doc.fontSize(10).fillColor("#333333").font("Helvetica-Bold");
        doc.text("Description", leftCol + 10, tableTop + 7, { width: 280 });
        if (showQty) doc.text("Qty", leftCol + 300, tableTop + 7, { width: 50, align: "center" });
        if (showUnitPrice) doc.text("Rate", leftCol + 360, tableTop + 7, { width: 80, align: "right" });
        if (showLineTotals) doc.text("Amount", leftCol + 450, tableTop + 7, { width: 80, align: "right" });

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
            doc.text(line.description || "", leftCol + 10, rowY + 7, { width: 280 });
            if (showQty) doc.text(line.quantity || "1", leftCol + 300, rowY + 7, { width: 50, align: "center" });
            if (showUnitPrice) doc.text(formatCurrency(line.unitPrice), leftCol + 360, rowY + 7, { width: 80, align: "right" });
            if (showLineTotals) doc.text(formatCurrency(line.lineSubtotal), leftCol + 450, rowY + 7, { width: 80, align: "right" });

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

      // Calculate totals box height based on discount
      const hasDiscount = invoice.discountAmount && parseFloat(invoice.discountAmount) > 0;
      const totalsHeight = hasDiscount ? 100 : 70;

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

      // Amount Paid and Balance (if any payments and showBalance is enabled)
      const showBalance = invoice.showBalance !== false;
      const amountPaid = parseFloat(invoice.amountPaid || "0");
      if (showBalance && amountPaid > 0) {
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
      // ========================================
      const notesY = rowY + totalsHeight + 20;
      if (invoice.clientMessage || invoice.notesCustomer) {
        doc.fontSize(11).fillColor("#333333").font("Helvetica-Bold");
        doc.text("Notes:", leftCol, notesY);
        doc.fontSize(10).fillColor("#666666").font("Helvetica");
        doc.text(invoice.clientMessage || invoice.notesCustomer || "", leftCol, notesY + 16, { width: pageWidth });
      }

      // ========================================
      // FOOTER
      // ========================================
      const footerY = doc.page.height - 50;
      doc.fontSize(9).fillColor("#999999").font("Helvetica");
      doc.text(
        `Invoice generated on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`,
        leftCol,
        footerY,
        { width: pageWidth, align: "center" }
      );

      // Finalize PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
