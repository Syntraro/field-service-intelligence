/**
 * InvoiceHeaderCard — Unified invoice header matching Job Detail header card pattern.
 *
 * 2026-04-11: Rewritten to match Job Detail header structure:
 * - Single card with left/right split
 * - Left: invoice title + status → company/addresses
 * - Right: metadata table (invoice #, dates, job #)
 * - Bottom: action bar with border-t
 */

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MoreHorizontal, Send, DollarSign, PenTool, RotateCw, Ban, Edit, FileText,
  Printer, CheckCircle, Undo2, MapPin, Mail, Briefcase,
  Check, X, Trash2,
} from "lucide-react";
import { Link } from "wouter";
import type { Invoice, Client, CustomerCompany, Job } from "@shared/schema";
import { formatCurrency } from "@/lib/formatters";

interface StructuredAddress {
  street: string;
  street2?: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  locationName?: string;
}

function formatAddress(addr?: StructuredAddress | null): string {
  if (!addr) return "";
  const parts = [addr.street, addr.street2, addr.city, addr.province, addr.postalCode].filter(Boolean);
  return parts.join(", ");
}

const PAYMENT_TERMS_OPTIONS = [
  { value: "0", label: "Due on receipt" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "custom", label: "Custom date" },
];

interface InvoiceHeaderCardProps {
  invoice: Invoice;
  location: Client;
  customerCompany: CustomerCompany | null;
  job: Job | null;
  billingAddress?: StructuredAddress | null;
  serviceAddress?: StructuredAddress | null;
  primaryContact?: { name?: string; phone?: string; email?: string } | null;
  onEdit?: () => void;
  onSend?: () => void;
  onCollectPayment?: () => void;
  onVoid?: () => void;
  onDelete?: () => void;
  onRefreshFromJob?: () => void;
  refreshPending?: boolean;
  voidPending?: boolean;
  deletePending?: boolean;
  onDownloadPdf?: () => void;
  onPrintPdf?: () => void;
  onPreview?: () => void;
  pdfPending?: boolean;
  onToggleSent?: (sentStatus: boolean) => void;
  toggleSentPending?: boolean;
  canEdit?: boolean;
  isDraft?: boolean;
  isEditing?: boolean;
  sendPending?: boolean;
  statusLabel?: string;
  statusVariant?: any;
  isPastDue?: boolean;
  onUpdateInvoiceNumber?: (num: string) => void;
  invoiceNumberPending?: boolean;
  onUpdatePaymentTerms?: (data: { paymentTermsDays?: number; dueDate?: string }) => void;
  paymentTermsPending?: boolean;
  onUpdateIssueDate?: (date: string) => void;
  issueDatePending?: boolean;
}

export function InvoiceHeaderCard({
  invoice, location, customerCompany, job,
  billingAddress, serviceAddress, primaryContact,
  onEdit, onSend, onCollectPayment, onVoid, onDelete,
  onRefreshFromJob, refreshPending, voidPending, deletePending,
  onDownloadPdf, onPrintPdf, onPreview, pdfPending,
  onToggleSent, toggleSentPending,
  canEdit, isDraft, isEditing, sendPending,
  statusLabel, statusVariant = "outline", isPastDue,
  onUpdateInvoiceNumber, invoiceNumberPending,
  onUpdatePaymentTerms, paymentTermsPending,
  onUpdateIssueDate, issueDatePending,
}: InvoiceHeaderCardProps) {
  const isAwaitingPayment = invoice.status === "awaiting_payment" || invoice.status === "sent";
  const isPartialPaid = invoice.status === "partial_paid";
  const isPayable = isAwaitingPayment || isPartialPaid;
  const isTerminal = invoice.status === "paid" || invoice.status === "voided";
  const canVoid = !isTerminal && (isDraft || isAwaitingPayment || isPartialPaid);
  const canDeleteDraft = isDraft && !invoice.qboInvoiceId && parseFloat(invoice.amountPaid || "0") === 0;

  const [editingNumber, setEditingNumber] = useState(false);
  const [numberDraft, setNumberDraft] = useState(invoice.invoiceNumber || "");
  const [editingIssueDate, setEditingIssueDate] = useState(false);
  const issueDateRaw = (invoice as any).issuedAt || invoice.issueDate;
  const issueDateForInput = issueDateRaw ? new Date(issueDateRaw).toISOString().split("T")[0] : "";
  const [issueDateDraft, setIssueDateDraft] = useState(issueDateForInput);
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDueDate, setCustomDueDate] = useState(invoice.dueDate || "");

  const currentTermsValue = (() => {
    const days = invoice.paymentTermsDays;
    if (days === 0 || days === 15 || days === 30 || days === 45) return String(days);
    return "custom";
  })();

  const handleSaveInvoiceNumber = () => {
    if (numberDraft.trim() && onUpdateInvoiceNumber) {
      onUpdateInvoiceNumber(numberDraft.trim());
      setEditingNumber(false);
    }
  };

  const handleTermsChange = (value: string) => {
    if (value === "custom") { setShowCustomDate(true); return; }
    setShowCustomDate(false);
    onUpdatePaymentTerms?.({ paymentTermsDays: parseInt(value, 10) });
  };

  const handleCustomDateSave = () => {
    if (customDueDate) {
      onUpdatePaymentTerms?.({ dueDate: customDueDate });
      setShowCustomDate(false);
    }
  };

  const clientName = customerCompany?.name ?? location.companyName;
  const billingText = formatAddress(billingAddress);
  const serviceText = formatAddress(serviceAddress);

  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="invoice-header-area">
      {/* Section A: Header content — matches Job Detail pattern */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-6">
          {/* Left: title + status → company/addresses */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Invoice title + status + total */}
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 leading-snug truncate">
                Invoice #{invoice.invoiceNumber || "Draft"}
              </h1>
              {statusLabel && <Badge variant={statusVariant}>{statusLabel}</Badge>}
              <span className="text-sm text-muted-foreground">{formatCurrency(invoice.total)}</span>
            </div>

            {/* Separator + company/addresses */}
            <div className="border-t border-slate-100 mt-3 pt-2">
              {/* Company name */}
              {customerCompany?.id ? (
                <Link href={`/clients/${customerCompany.id}`}>
                  <span className="text-xs font-medium text-slate-600 hover:text-[#76B054] transition-colors cursor-pointer block truncate">
                    {clientName}
                  </span>
                </Link>
              ) : (
                <span className="text-xs font-medium text-slate-600 block truncate">{clientName}</span>
              )}

              {/* Billing address */}
              {billingText && (
                <span className="flex items-center gap-0.5 text-[11px] text-slate-400 mt-0.5">
                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                  {billingText}
                </span>
              )}

              {/* Service address (if different from billing) */}
              {serviceText && serviceText !== billingText && (
                <span className="flex items-center gap-0.5 text-[11px] text-slate-400 mt-0.5">
                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                  {serviceAddress?.locationName && <span className="font-medium text-slate-500 mr-1">{serviceAddress.locationName}</span>}
                  {serviceText}
                </span>
              )}

              {/* Contact email */}
              {primaryContact?.email && (
                <span className="flex items-center gap-0.5 text-[11px] text-slate-400 mt-0.5">
                  <Mail className="h-2.5 w-2.5 shrink-0" />
                  <a href={`mailto:${primaryContact.email}`} className="hover:text-primary truncate">{primaryContact.email}</a>
                </span>
              )}
            </div>
          </div>

          {/* Right: metadata table */}
          <div className="shrink-0 w-48">
            <table className="text-left text-xs w-full">
              <tbody>
                <tr>
                  <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Invoice #</td>
                  <td className="font-semibold text-slate-700 py-0.5">
                    {editingNumber ? (
                      <div className="flex items-center gap-1">
                        <Input value={numberDraft} onChange={(e) => setNumberDraft(e.target.value)}
                          className="w-20 h-5 px-1 text-xs border rounded" autoFocus data-testid="input-invoice-number" />
                        <button type="button" onClick={handleSaveInvoiceNumber} className="text-primary text-[10px] font-medium" disabled={invoiceNumberPending}>{invoiceNumberPending ? "…" : "✓"}</button>
                        <button type="button" onClick={() => { setEditingNumber(false); setNumberDraft(invoice.invoiceNumber || ""); }} className="text-muted-foreground text-[10px]">✕</button>
                      </div>
                    ) : (
                      <button type="button" className="group cursor-text" onClick={() => { setEditingNumber(true); setNumberDraft(invoice.invoiceNumber || ""); }} data-testid="text-invoice-number">
                        {invoice.invoiceNumber || "—"}
                        <Edit className="inline ml-0.5 h-2 w-2 opacity-0 group-hover:opacity-40 transition-opacity" />
                      </button>
                    )}
                  </td>
                </tr>
                {job && (
                  <tr>
                    <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Job #</td>
                    <td className="py-0.5">
                      <Link href={`/jobs/${job.id}`} className="font-semibold text-primary hover:underline">{job.jobNumber}</Link>
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Issued</td>
                  <td className="text-slate-600 py-0.5">
                    {isEditing && editingIssueDate ? (
                      <div className="flex items-center gap-1">
                        <Input type="date" value={issueDateDraft} onChange={(e) => setIssueDateDraft(e.target.value)}
                          className="w-28 h-5 px-1 text-xs border rounded" data-testid="input-issue-date" />
                        <button type="button" className="text-primary text-[10px]" disabled={issueDatePending}
                          onClick={() => { if (issueDateDraft && onUpdateIssueDate) { onUpdateIssueDate(issueDateDraft); setEditingIssueDate(false); } }}>✓</button>
                        <button type="button" className="text-muted-foreground text-[10px]" onClick={() => { setEditingIssueDate(false); setIssueDateDraft(issueDateForInput); }}>✕</button>
                      </div>
                    ) : (
                      <span className="group" onClick={isEditing ? () => setEditingIssueDate(true) : undefined} style={isEditing ? { cursor: "text" } : undefined}>
                        {issueDateRaw ? format(new Date(issueDateRaw), "MMM d, yyyy") : "—"}
                        {isEditing && <Edit className="inline ml-0.5 h-2 w-2 opacity-0 group-hover:opacity-40 transition-opacity" />}
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="text-[11px] text-slate-400 pr-3 py-0.5 whitespace-nowrap">Due</td>
                  <td className={`py-0.5 ${isPastDue ? "text-destructive font-medium" : "text-slate-600"}`}>
                    {invoice.dueDate ? format(new Date(invoice.dueDate), "MMM d, yyyy") : "—"}
                    {isPastDue && <span className="text-[10px] ml-1">(Past due)</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            {/* Payment terms selector (edit mode) */}
            {isEditing && (
              <div className="mt-1.5">
                <Select value={currentTermsValue} onValueChange={handleTermsChange} disabled={paymentTermsPending}>
                  <SelectTrigger className="h-7 text-xs w-full" data-testid="select-invoice-payment-terms"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showCustomDate && (
                  <div className="flex items-center gap-1 mt-1">
                    <Input type="date" value={customDueDate} onChange={(e) => setCustomDueDate(e.target.value)} className="h-7 text-xs flex-1" data-testid="input-custom-due-date" />
                    <button type="button" className="text-primary text-[10px]" onClick={handleCustomDateSave}>✓</button>
                  </div>
                )}
                {paymentTermsPending && <span className="text-[10px] text-muted-foreground">Saving...</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section B: Action bar — matches Job Detail action row */}
      <div className="px-4 py-1.5 border-t border-slate-200/60 flex items-center gap-1.5 flex-wrap">
        {isDraft && onEdit && (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />{isEditing ? "Done Editing" : "Edit Invoice"}
          </Button>
        )}
        {canEdit && !isDraft && onEdit && (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5" />{isEditing ? "Done Editing" : "Edit"}
          </Button>
        )}
        <div className="flex-1" />
        {onPreview && (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={onPreview}>
            <FileText className="h-3.5 w-3.5" />Preview
          </Button>
        )}
        {isDraft && onSend && (
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7" onClick={onSend} disabled={sendPending}>
            <Send className="h-3.5 w-3.5" />{sendPending ? "Sending..." : "Send Invoice"}
          </Button>
        )}
        {isPayable && onCollectPayment && (
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7" onClick={onCollectPayment}>
            <DollarSign className="h-3.5 w-3.5" />Add Payment
          </Button>
        )}
        {isTerminal && (
          <span className="text-xs text-muted-foreground">{invoice.status === "paid" ? "Fully paid" : "Voided"}</span>
        )}
        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDownloadPdf && (
              <DropdownMenuItem onClick={onDownloadPdf} disabled={pdfPending}>
                <FileText className="h-4 w-4 mr-2" />{pdfPending ? "Loading..." : "Download PDF"}
              </DropdownMenuItem>
            )}
            {onPrintPdf && (
              <DropdownMenuItem onClick={onPrintPdf} disabled={pdfPending}>
                <Printer className="h-4 w-4 mr-2" />Print
              </DropdownMenuItem>
            )}
            {isDraft && job && onRefreshFromJob && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onRefreshFromJob} disabled={refreshPending}>
                  <RotateCw className="h-4 w-4 mr-2" />Refresh from Job
                </DropdownMenuItem>
              </>
            )}
            {onToggleSent && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onToggleSent(!invoice.sentAt)} disabled={toggleSentPending}>
                  {invoice.sentAt ? <><Undo2 className="h-4 w-4 mr-2" />{toggleSentPending ? "Updating..." : "Undo sent"}</> : <><CheckCircle className="h-4 w-4 mr-2" />{toggleSentPending ? "Updating..." : "Mark as sent"}</>}
                </DropdownMenuItem>
              </>
            )}
            {canDeleteDraft && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} disabled={deletePending} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />{deletePending ? "Deleting..." : "Delete Draft"}
                </DropdownMenuItem>
              </>
            )}
            {canVoid && !canDeleteDraft && onVoid && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onVoid} disabled={voidPending} className="text-destructive focus:text-destructive">
                  <Ban className="h-4 w-4 mr-2" />{voidPending ? "Voiding..." : "Void Invoice"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
