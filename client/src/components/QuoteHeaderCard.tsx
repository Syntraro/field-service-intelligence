/**
 * QuoteHeaderCard (Phase 3B, 2026-04-14)
 *
 * Canonical quote detail header — mirrors the Invoice Detail
 * `InvoiceMetaCard` structure so Quote Detail belongs to the same
 * visual/system family as Invoice Detail and Job Detail:
 *
 *   Section A — card shell (`bg-white rounded-md border ...`):
 *     Left:   quote title + status badge + total
 *             company name (linked if customer company) + service address
 *     Right:  fixed-width metadata table (quote #, issued, expiry, sent,
 *             approved, declined dates)
 *   Section B — action bar (`border-t`, same density as Invoice/Job):
 *     Primary actions (Send / Approve / Decline / Convert to Job)
 *     Secondary: Preview / Download / Apply Template
 *     Overflow: Email / Delete (where applicable)
 *
 * No business logic lives here — mutations + modal state stay on the
 * page. This component is a pure structural/visual shell that receives
 * already-computed flags (`isDraft`, `isSent`, `isApproved`, `isExpired`)
 * and bound callback handlers.
 */

import { Link } from "wouter";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  Download,
  Edit,
  Eye,
  FileText,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Send,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import type { Quote, Client, CustomerCompany } from "@shared/schema";
import { formatCurrency } from "@/lib/formatters";
import { isValid, parseISO } from "date-fns";

function safeFormatDate(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : typeof value === "string" ? parseISO(value) : new Date(String(value));
  return isValid(d) ? format(d, "MMM d, yyyy") : null;
}

type StatusInfo = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

interface QuoteHeaderCardProps {
  quote: Quote;
  location: Client;
  customerCompany: CustomerCompany | null;
  statusInfo: StatusInfo;
  isDraft: boolean;
  isSent: boolean;
  isApproved: boolean;
  isExpired: boolean;
  // Callback handlers — page owns all mutations/modal state.
  onBack: () => void;
  onPreviewPdf: () => void;
  onDownloadPdf: () => void;
  onSend: () => void;
  onApplyTemplate: () => void;
  onApprove: () => void;
  onDecline: () => void;
  onConvertToJob: () => void;
  onDelete: () => void;
  onEditPlaceholder?: () => void;
}

export function QuoteHeaderCard({
  quote,
  location,
  customerCompany,
  statusInfo,
  isDraft,
  isSent,
  isApproved,
  isExpired,
  onBack,
  onPreviewPdf,
  onDownloadPdf,
  onSend,
  onApplyTemplate,
  onApprove,
  onDecline,
  onConvertToJob,
  onDelete,
  onEditPlaceholder,
}: QuoteHeaderCardProps) {
  const clientName = customerCompany?.name ?? location.companyName ?? "Client";
  const addressParts = [location.address, location.address2].filter(Boolean);
  const serviceAddress = addressParts.length > 0 ? addressParts.join(", ") : null;
  const showServiceAddress = !!serviceAddress;

  const issueDate = safeFormatDate(quote.issueDate);
  const expiryDate = safeFormatDate(quote.expiryDate);
  const sentAt = safeFormatDate(quote.sentAt);
  const approvedAt = safeFormatDate(quote.approvedAt);
  const declinedAt = safeFormatDate(quote.declinedAt);

  const canDeleteDraft = isDraft;
  const canShowApproveDecline = isSent && !isExpired;
  const canShowConvert = isApproved;

  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden" data-testid="quote-header-area">
      {/* Section A — identity + addresses / metadata table */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-6">
          {/* Left: title + status, company link + addresses */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Back button inline with title — mirrors Job Detail pattern where
                  back nav sits at card top-left rather than as a floating icon above. */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-1 shrink-0"
                onClick={onBack}
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1
                className="text-2xl font-bold text-slate-900 leading-snug truncate"
                data-testid="text-quote-number"
              >
                Quote {quote.quoteNumber || `#${quote.id.slice(0, 8)}`}
              </h1>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              <span className="text-sm text-muted-foreground">{formatCurrency(quote.total)}</span>
            </div>

            {/* Title subtitle — quote name if present */}
            {quote.title && (
              <p className="text-sm text-slate-600 mt-1 pl-8 truncate">{quote.title}</p>
            )}

            {/* Separator + company/addresses block — matches InvoiceMetaCard */}
            <div className="border-t border-slate-100 mt-3 pt-2 pl-8">
              {customerCompany?.id ? (
                <Link href={`/clients/${customerCompany.id}`}>
                  <span className="text-xs font-medium text-slate-600 hover:text-[#76B054] transition-colors cursor-pointer block truncate">
                    {clientName}
                  </span>
                </Link>
              ) : (
                <span className="text-xs font-medium text-slate-600 block truncate">{clientName}</span>
              )}

              {showServiceAddress && (
                <span className="flex items-center gap-0.5 text-xs text-slate-400 mt-0.5">
                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                  {serviceAddress}
                </span>
              )}

              {location.phone && (
                <span className="flex items-center gap-0.5 text-xs text-slate-400 mt-0.5">
                  <Phone className="h-2.5 w-2.5 shrink-0" />
                  {location.phone}
                </span>
              )}

              {location.email && (
                <span className="flex items-center gap-0.5 text-xs text-slate-400 mt-0.5">
                  <Mail className="h-2.5 w-2.5 shrink-0" />
                  <a href={`mailto:${location.email}`} className="hover:text-primary truncate">
                    {location.email}
                  </a>
                </span>
              )}
            </div>
          </div>

          {/* Right: metadata table — mirrors InvoiceMetaCard */}
          <div className="shrink-0 w-48">
            <table className="text-left text-xs w-full">
              <tbody>
                <tr>
                  <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Quote #</td>
                  <td className="font-semibold text-slate-700 py-0.5">
                    {quote.quoteNumber || "—"}
                  </td>
                </tr>
                <tr>
                  <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Issued</td>
                  <td className="text-slate-600 py-0.5">{issueDate ?? "—"}</td>
                </tr>
                <tr>
                  <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Expiry</td>
                  <td className={`py-0.5 ${isExpired ? "text-destructive font-medium" : "text-slate-600"}`}>
                    {expiryDate ?? "—"}
                    {isExpired && <span className="text-xs ml-1">(Expired)</span>}
                  </td>
                </tr>
                {sentAt && (
                  <tr>
                    <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Sent</td>
                    <td className="text-slate-600 py-0.5">{sentAt}</td>
                  </tr>
                )}
                {approvedAt && (
                  <tr>
                    <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Approved</td>
                    <td className="text-slate-600 py-0.5">{approvedAt}</td>
                  </tr>
                )}
                {declinedAt && (
                  <tr>
                    <td className="text-xs text-slate-500 pr-3 py-0.5 whitespace-nowrap font-normal">Declined</td>
                    <td className="text-slate-600 py-0.5">{declinedAt}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expiry warning banner — inline inside the card when expired + sent */}
        {isExpired && isSent && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-xs">
              <span className="font-medium">This quote has expired.</span> The expiry date ({expiryDate}) has passed and it can no longer be approved.
            </p>
          </div>
        )}
      </div>

      {/* Section B — action bar. Matches Invoice/Job density (h-7 buttons, px-4 py-1.5). */}
      <div className="px-4 py-1.5 border-t border-slate-200/60 flex items-center gap-1.5 flex-wrap">
        {isDraft && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs h-7"
            onClick={onApplyTemplate}
            data-testid="button-apply-template"
          >
            <FileText className="h-3.5 w-3.5" />Apply Template
          </Button>
        )}

        <div className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-7"
          onClick={onPreviewPdf}
          data-testid="button-preview-pdf"
        >
          <Eye className="h-3.5 w-3.5" />Preview
        </Button>

        {isDraft && (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
            onClick={onSend}
            data-testid="button-send-quote"
          >
            <Send className="h-3.5 w-3.5" />Send Quote
          </Button>
        )}

        {canShowApproveDecline && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7"
              onClick={onApprove}
              data-testid="button-approve-quote"
            >
              <Check className="h-3.5 w-3.5" />Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7"
              onClick={onDecline}
              data-testid="button-decline-quote"
            >
              <X className="h-3.5 w-3.5" />Decline
            </Button>
          </>
        )}

        {canShowConvert && (
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
            onClick={onConvertToJob}
            data-testid="button-convert-to-job"
          >
            <ClipboardList className="h-3.5 w-3.5" />Convert to Job
          </Button>
        )}

        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" data-testid="button-quote-menu">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onPreviewPdf}>
              <Eye className="h-4 w-4 mr-2" />Preview PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDownloadPdf}>
              <Download className="h-4 w-4 mr-2" />Download PDF
            </DropdownMenuItem>
            {onEditPlaceholder && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onEditPlaceholder}>
                  <Edit className="h-4 w-4 mr-2" />Edit Quote
                </DropdownMenuItem>
              </>
            )}
            {canShowConvert && (
              <DropdownMenuItem onClick={onConvertToJob}>
                <ClipboardList className="h-4 w-4 mr-2" />Convert to Job
              </DropdownMenuItem>
            )}
            {canDeleteDraft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />Delete Quote
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
