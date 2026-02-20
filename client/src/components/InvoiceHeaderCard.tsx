import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import {
  MoreHorizontal, Send, DollarSign, PenTool, RotateCw, Ban, Edit, FileText,
  Printer, CheckCircle, Undo2, MapPin, Phone, Mail, User, Briefcase, Calendar,
  Check, X,
} from "lucide-react";
import { Link } from "wouter";
import type { Invoice, Client, CustomerCompany, Job } from "@shared/schema";

/** Structured address from the details DTO */
interface StructuredAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
  locationName?: string;
}

/** Primary contact from the details DTO */
interface PrimaryContact {
  name: string;
  email: string;
  phone: string;
}

/** Payment terms options matching spec: 0, 15, 30, 45, custom */
const PAYMENT_TERMS_OPTIONS = [
  { value: "0", label: "Due on receipt" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "custom", label: "Custom" },
] as const;

export interface InvoiceHeaderCardProps {
  invoice: Invoice;
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;
  // Address + contact from details DTO
  billingAddress?: StructuredAddress | null;
  serviceAddress?: StructuredAddress | null;
  primaryContact?: PrimaryContact | null;

  onEdit?: () => void;
  onSend?: () => void;
  onCollectPayment?: () => void;
  onVoid?: () => void;
  onRefreshFromJob?: () => void;
  refreshPending?: boolean;
  voidPending?: boolean;
  onDownloadPdf?: () => void;
  onPrintPdf?: () => void;
  pdfPending?: boolean;
  onToggleSent?: (isSent: boolean) => void;
  toggleSentPending?: boolean;
  canEdit?: boolean;
  isDraft?: boolean;
  isEditing?: boolean;
  sendPending?: boolean;
  statusLabel?: string;
  statusVariant?: "default" | "destructive" | "secondary" | "outline";
  isPastDue?: boolean;

  // Invoice number + payment terms editing callbacks
  onUpdateInvoiceNumber?: (invoiceNumber: string) => void;
  invoiceNumberPending?: boolean;
  onUpdatePaymentTerms?: (data: { paymentTermsDays: number | null; dueDate?: string }) => void;
  paymentTermsPending?: boolean;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

/** Format a structured address into a display string */
function formatAddress(addr: StructuredAddress | null | undefined): string | null {
  if (!addr?.street) return null;
  const parts = [addr.street];
  const cityLine = [addr.city, addr.province].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  if (addr.postalCode) parts.push(addr.postalCode);
  return parts.join("\n");
}

export function InvoiceHeaderCard({
  invoice,
  location,
  customerCompany,
  job,
  billingAddress,
  serviceAddress,
  primaryContact,
  onEdit,
  onSend,
  onCollectPayment,
  onVoid,
  onRefreshFromJob,
  refreshPending,
  voidPending,
  onDownloadPdf,
  onPrintPdf,
  pdfPending,
  onToggleSent,
  toggleSentPending,
  canEdit,
  isDraft,
  isEditing,
  sendPending,
  statusLabel,
  statusVariant = "outline",
  isPastDue,
  onUpdateInvoiceNumber,
  invoiceNumberPending,
  onUpdatePaymentTerms,
  paymentTermsPending,
}: InvoiceHeaderCardProps) {
  // Derived status flags
  const isAwaitingPayment = invoice.status === "awaiting_payment" || invoice.status === "sent";
  const isPartialPaid = invoice.status === "partial_paid";
  const isPayable = isAwaitingPayment || isPartialPaid;
  const isTerminal = invoice.status === "paid" || invoice.status === "voided";
  const canVoid = !isTerminal && (isDraft || isAwaitingPayment || isPartialPaid);

  // Invoice number editing state
  const [editingNumber, setEditingNumber] = useState(false);
  const [numberDraft, setNumberDraft] = useState(invoice.invoiceNumber || "");

  // Custom due date state (for "Custom" payment terms)
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDueDate, setCustomDueDate] = useState(invoice.dueDate || "");

  // Determine current terms selector value
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
    if (value === "custom") {
      setShowCustomDate(true);
      return;
    }
    setShowCustomDate(false);
    onUpdatePaymentTerms?.({ paymentTermsDays: parseInt(value, 10) });
  };

  const handleCustomDateSave = () => {
    if (customDueDate && onUpdatePaymentTerms) {
      onUpdatePaymentTerms({ paymentTermsDays: null, dueDate: customDueDate });
      setShowCustomDate(false);
    }
  };

  const clientName = customerCompany?.name ?? location.companyName;
  const billingText = formatAddress(billingAddress);
  const serviceText = formatAddress(serviceAddress);

  return (
    <Card className="p-4 mb-6">
      {/* Row 1: Invoice title + status + total + actions */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Invoice number (editable in edit mode) */}
          {isEditing && editingNumber ? (
            <div className="flex items-center gap-1">
              <span className="text-lg font-semibold text-muted-foreground">#</span>
              <Input
                value={numberDraft}
                onChange={(e) => setNumberDraft(e.target.value)}
                className="h-8 w-32 text-lg font-semibold"
                autoFocus
                data-testid="input-invoice-number"
              />
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSaveInvoiceNumber} disabled={invoiceNumberPending}>
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingNumber(false); setNumberDraft(invoice.invoiceNumber || ""); }}>
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">
                Invoice #{invoice.invoiceNumber || "Draft"}
              </span>
              {isEditing && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingNumber(true); setNumberDraft(invoice.invoiceNumber || ""); }} data-testid="button-edit-invoice-number">
                  <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          )}
          {statusLabel && <Badge variant={statusVariant}>{statusLabel}</Badge>}
        </div>

        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total</div>
          <div className="text-lg font-semibold">{formatCurrency(invoice.total)}</div>
        </div>
      </div>

      {/* Row 2: Jobber-style info grid — addresses, contact, terms */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm border-t pt-4">
        {/* Billing Address */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Billing Address</div>
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{clientName}</p>
              {billingText ? (
                <p className="text-muted-foreground whitespace-pre-line">{billingText}</p>
              ) : (
                <p className="text-muted-foreground italic">No billing address</p>
              )}
            </div>
          </div>
        </div>

        {/* Service / Property Address */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Service Address</div>
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              {serviceAddress?.locationName && (
                <p className="font-medium">{serviceAddress.locationName}</p>
              )}
              {serviceText ? (
                <p className="text-muted-foreground whitespace-pre-line">{serviceText}</p>
              ) : (
                <p className="text-muted-foreground italic">No service address</p>
              )}
            </div>
          </div>
        </div>

        {/* Contact Details */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Contact</div>
          <div className="space-y-1">
            {primaryContact?.name && (
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>{primaryContact.name}</span>
              </div>
            )}
            {primaryContact?.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <a href={`tel:${primaryContact.phone}`} className="text-primary hover:underline">{primaryContact.phone}</a>
              </div>
            )}
            {primaryContact?.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <a href={`mailto:${primaryContact.email}`} className="text-primary hover:underline truncate">{primaryContact.email}</a>
              </div>
            )}
            {!primaryContact?.name && !primaryContact?.phone && !primaryContact?.email && (
              <p className="text-muted-foreground italic">No contact info</p>
            )}
          </div>
        </div>

        {/* Payment Terms / Dates (moved from sidebar) */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Details</div>
          <div className="space-y-1.5">
            {/* Job # link */}
            {job && (
              <div className="flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Link href={`/jobs/${job.id}`}>
                  <span className="text-primary hover:underline cursor-pointer" data-testid="link-job-number">
                    Job #{job.jobNumber}
                  </span>
                </Link>
              </div>
            )}
            {/* Issued date */}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>
                Issued: {invoice.issuedAt || invoice.issueDate
                  ? format(new Date(invoice.issuedAt || invoice.issueDate), "MMM d, yyyy")
                  : "Not set"}
              </span>
            </div>
            {/* Due date */}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className={isPastDue ? "text-destructive font-medium" : ""}>
                Due: {invoice.dueDate
                  ? format(new Date(invoice.dueDate), "MMM d, yyyy")
                  : "Not set"}
                {isPastDue && <span className="ml-1 text-xs">(Past due)</span>}
              </span>
            </div>
            {/* Payment terms selector (edit mode only) */}
            {isEditing && (
              <div className="pt-1">
                <Select
                  value={currentTermsValue}
                  onValueChange={handleTermsChange}
                  disabled={paymentTermsPending}
                >
                  <SelectTrigger className="h-7 text-xs w-full" data-testid="select-invoice-payment-terms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TERMS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showCustomDate && (
                  <div className="flex items-center gap-1 mt-1">
                    <Input
                      type="date"
                      value={customDueDate}
                      onChange={(e) => setCustomDueDate(e.target.value)}
                      className="h-7 text-xs flex-1"
                      data-testid="input-custom-due-date"
                    />
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCustomDateSave}>
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                  </div>
                )}
                {paymentTermsPending && <span className="text-xs text-muted-foreground">Saving...</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Action buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        {isDraft && onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-1" />
            {isEditing ? "Done Editing" : "Edit Invoice"}
          </Button>
        )}
        {canEdit && !isDraft && onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-1" />
            {isEditing ? "Done Editing" : "Edit"}
          </Button>
        )}

        {isDraft && onSend && (
          <Button variant="default" size="sm" onClick={onSend} disabled={sendPending}>
            <Send className="h-4 w-4 mr-1" />
            {sendPending ? "Sending..." : "Send Invoice"}
          </Button>
        )}

        {isPayable && onCollectPayment && (
          <Button variant="default" size="sm" onClick={onCollectPayment}>
            <DollarSign className="h-4 w-4 mr-1" />
            Add Payment
          </Button>
        )}

        {onDownloadPdf && (
          <Button variant="outline" size="sm" onClick={onDownloadPdf} disabled={pdfPending}>
            <FileText className="h-4 w-4 mr-1" />
            {pdfPending ? "Loading..." : "Download PDF"}
          </Button>
        )}
        {onPrintPdf && (
          <Button variant="outline" size="sm" onClick={onPrintPdf} disabled={pdfPending}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        )}

        {!isTerminal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4 mr-1" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem disabled>
                <PenTool className="h-4 w-4 mr-2" />
                Collect Signature
              </DropdownMenuItem>

              {isDraft && job && onRefreshFromJob && (
                <DropdownMenuItem onClick={onRefreshFromJob} disabled={refreshPending}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Refresh from Job
                </DropdownMenuItem>
              )}

              {onToggleSent && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onToggleSent(!invoice.sentAt)}
                    disabled={toggleSentPending}
                  >
                    {invoice.sentAt ? (
                      <>
                        <Undo2 className="h-4 w-4 mr-2" />
                        {toggleSentPending ? "Updating..." : "Undo sent"}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {toggleSentPending ? "Updating..." : "Mark as sent"}
                      </>
                    )}
                  </DropdownMenuItem>
                </>
              )}

              {canVoid && onVoid && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onVoid}
                    disabled={voidPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    {voidPending ? "Voiding..." : "Void Invoice"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {isTerminal && (
          <span className="text-sm text-muted-foreground ml-2">
            {invoice.status === "paid" ? "Fully paid" : "Invoice voided"}
          </span>
        )}
      </div>
    </Card>
  );
}

export default InvoiceHeaderCard;
