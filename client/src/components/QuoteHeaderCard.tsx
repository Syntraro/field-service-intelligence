/**
 * QuoteHeaderCard (Phase 3B, 2026-04-14; structured props API 2026-05-08 Task 3,
 * ownership consolidation 2026-05-08 Task 4, CDH descriptor refactor 2026-05-09)
 *
 * Thin adapter: transforms quote + location + customerCompany data into
 * CanonicalDetailHeader's typed descriptor props. Owns NO business logic —
 * mutations, modal state, and team-member queries stay on QuoteDetailPage.
 *
 * Post-2026-05-09: all ReactNode slots replaced with typed descriptors.
 *   status   → StatusDescriptor (CDH renders <StatusChip>)
 *   alert    → AlertDescriptor (CDH renders icon + text with canonical tone)
 *   workflow → WorkflowDescriptor (CDH renders canonical <Select> + Assessment)
 *
 * Address fix (2026-05-09): full city/province/postalCode passed — no silent drops.
 */

import { format } from "date-fns";
import {
  Check,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { Quote, Client, CustomerCompany } from "@shared/schema";
import { formatCurrency } from "@/lib/formatters";
import { isValid, parseISO } from "date-fns";
import {
  CanonicalDetailHeader,
  type HeaderAction,
  type HeaderOverflowItem,
  type WorkflowDescriptor,
  type AlertDescriptor,
  type HeaderEditControls,
} from "@/components/detail/CanonicalDetailHeader";
import { getQuoteStatusMeta } from "@/lib/statusBadges";

function safeFormatDate(value: unknown): string | null {
  if (!value) return null;
  const d =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? parseISO(value)
        : new Date(String(value));
  return isValid(d) ? format(d, "MMM d, yyyy") : null;
}

/**
 * Owner + Assessment lifecycle controls passed from QuoteDetailPage.
 * Adapted to WorkflowDescriptor before forwarding to CDH.
 */
export interface QuoteHeaderWorkflow {
  salesOwnerUserId: string | null;
  teamMembers: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  assessmentStatus: "required" | "scheduled" | "completed" | null;
  isOwnerMutating?: boolean;
  isAssessmentMutating?: boolean;
  onOwnerChange: (userId: string | null) => void;
  onMarkAssessmentNeeded: () => void;
  onClearAssessmentNeeded: () => void;
  onScheduleAssessment: () => void;
  onCompleteAssessment: () => void;
  onCancelAssessment: () => void;
}

interface QuoteHeaderCardProps {
  quote: Quote;
  location: Client;
  customerCompany: CustomerCompany | null;
  /** Legacy prop — kept for API compat. Status chip derived from quote.status. */
  statusInfo: { label: string; variant: string };
  isDraft: boolean;
  isSent: boolean;
  isApproved: boolean;
  isExpired: boolean;
  onPreviewPdf: () => void;
  onDownloadPdf: () => void;
  onSend: () => void;
  onApplyTemplate: () => void;
  onApprove: () => void;
  onDecline: () => void;
  onConvertToJob: () => void;
  onDelete: () => void;
  /** Inline title edit (2026-05-09 — replaces onEditPlaceholder toast). */
  isHeaderEditing?: boolean;
  headerTitleDraft?: string;
  onHeaderTitleChange?: (v: string) => void;
  onStartHeaderEdit?: () => void;
  onHeaderSave?: () => void;
  onHeaderCancel?: () => void;
  isHeaderSaving?: boolean;
  headerError?: string | null;
  /** Owner + Assessment workflow row. Adapted to WorkflowDescriptor for CDH. */
  workflow?: QuoteHeaderWorkflow;
  /** Quote description text (quote.notesCustomer). Shown in CDH. */
  description?: string | null;
  /** Unified edit session — title + description saved together. */
  headerDescDraft?: string;
  onHeaderDescChange?: (v: string) => void;
}

export function QuoteHeaderCard({
  quote,
  location,
  customerCompany,
  isDraft,
  isSent,
  isApproved,
  isExpired,
  onPreviewPdf,
  onDownloadPdf,
  onSend,
  onApplyTemplate,
  onApprove,
  onDecline,
  onConvertToJob,
  onDelete,
  isHeaderEditing,
  headerTitleDraft,
  onHeaderTitleChange,
  onStartHeaderEdit,
  onHeaderSave,
  onHeaderCancel,
  isHeaderSaving,
  headerError,
  workflow,
  description,
  headerDescDraft,
  onHeaderDescChange,
}: QuoteHeaderCardProps) {
  const clientName = customerCompany?.name ?? location.companyName ?? "Client";

  // Full address — no silent data loss (2026-05-09 fix: city/province/postal now included)
  const streetParts = [location.address, location.address2].filter(Boolean);
  const cityProvPostal = [location.city, location.province, location.postalCode]
    .filter(Boolean)
    .join(", ");
  const addressLines: string[] = [
    ...streetParts as string[],
    ...(cityProvPostal ? [cityProvPostal] : []),
  ];

  const issueDate = safeFormatDate(quote.issueDate);
  const expiryDate = safeFormatDate(quote.expiryDate);
  const sentAt = safeFormatDate(quote.sentAt);
  const approvedAt = safeFormatDate(quote.approvedAt);
  const declinedAt = safeFormatDate(quote.declinedAt);

  const canShowApproveDecline = isSent && !isExpired;
  const canShowConvert = isApproved;

  const statusMeta = getQuoteStatusMeta(quote.status);

  // ── Primary actions ──────────────────────────────────────────────
  const primaryActions: HeaderAction[] = [
    {
      id: "apply-template",
      label: "Apply Template",
      icon: FileText,
      onClick: onApplyTemplate,
      variant: "outline",
      hidden: !isDraft,
      testId: "button-apply-template",
    },
    {
      id: "preview",
      label: "Preview",
      icon: Eye,
      onClick: onPreviewPdf,
      variant: "outline",
      testId: "button-preview-pdf",
    },
    {
      id: "send-quote",
      label: "Send Quote",
      icon: Send,
      onClick: onSend,
      variant: "primary",
      hidden: !isDraft,
      testId: "button-send-quote",
    },
    {
      id: "approve",
      label: "Approve",
      icon: Check,
      onClick: onApprove,
      variant: "outline",
      hidden: !canShowApproveDecline,
      testId: "button-approve-quote",
    },
    {
      id: "decline",
      label: "Decline",
      icon: X,
      onClick: onDecline,
      variant: "outline",
      hidden: !canShowApproveDecline,
      testId: "button-decline-quote",
    },
    {
      id: "convert-to-job",
      label: "Convert to Job",
      icon: ClipboardList,
      onClick: onConvertToJob,
      variant: "primary",
      hidden: !canShowConvert,
      testId: "button-convert-to-job",
    },
  ];

  // ── Overflow actions ─────────────────────────────────────────────
  const overflowActions: HeaderOverflowItem[] = [
    {
      id: "preview-pdf",
      label: "Preview PDF",
      icon: Eye,
      onClick: onPreviewPdf,
    },
    {
      id: "download-pdf",
      label: "Download PDF",
      icon: Download,
      onClick: onDownloadPdf,
    },
    ...(canShowConvert
      ? [{
          id: "convert-overflow",
          label: "Convert to Job",
          icon: ClipboardList,
          onClick: onConvertToJob,
        } as HeaderOverflowItem]
      : []),
    ...(isDraft
      ? [{
          id: "delete-quote",
          label: "Delete Quote",
          icon: Trash2,
          onClick: onDelete,
          separator: true,
          tone: "destructive",
        } as HeaderOverflowItem]
      : []),
  ];

  // ── Workflow descriptor (replaces workflowSlot ReactNode) ─────────
  // teamMembers → ownerOptions with pre-formatted label so CDH doesn't
  // need to know about firstName/lastName.
  const workflowDescriptor: WorkflowDescriptor | undefined = workflow
    ? {
        kind: "quote-owner-assessment",
        ownerUserId: workflow.salesOwnerUserId,
        ownerOptions: workflow.teamMembers.map((u) => ({
          id: u.id,
          label: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.id,
        })),
        isOwnerMutating: workflow.isOwnerMutating,
        assessmentStatus: workflow.assessmentStatus,
        isAssessmentMutating: workflow.isAssessmentMutating,
        onOwnerChange: workflow.onOwnerChange,
        onMarkAssessmentNeeded: workflow.onMarkAssessmentNeeded,
        onClearAssessmentNeeded: workflow.onClearAssessmentNeeded,
        onScheduleAssessment: workflow.onScheduleAssessment,
        onCompleteAssessment: workflow.onCompleteAssessment,
        onCancelAssessment: workflow.onCancelAssessment,
      }
    : undefined;

  // ── Alert descriptor (replaces headerAlert ReactNode) ─────────────
  // Preserves data-testid="quote-expiry-warning" via testId field.
  const alertDescriptor: AlertDescriptor | undefined =
    isExpired && isSent
      ? {
          text: `Expired${expiryDate ? ` (${expiryDate})` : ""}`,
          tone: "warning",
          icon: "alert",
          testId: "quote-expiry-warning",
        }
      : undefined;

  // ── Edit controls footer (replaces onEditPlaceholder toast) ─────────
  const editControls: HeaderEditControls | undefined =
    isHeaderEditing
      ? {
          onSave: onHeaderSave ?? (() => {}),
          onCancel: onHeaderCancel ?? (() => {}),
          isSaving: isHeaderSaving,
          error: headerError,
          saveLabel: "Save",
          cancelLabel: "Cancel",
        }
      : undefined;

  return (
    <CanonicalDetailHeader
      testId="quote-detail-header"
      isEditing={isHeaderEditing}
      // 2026-05-09 parity fix: project name as primary editable title (H1).
      // No entityLabel/subtitle — Job uses neither, so Quote must not either.
      // Quote number lives solely in the items metadata grid (key "quote-number").
      title={quote.title || `Quote ${quote.quoteNumber || `#${quote.id.slice(0, 8)}`}`}
      // onBack intentionally omitted — Job does not pass onBack to CDH; Quote must match.
      titleEdit={
        isHeaderEditing && onHeaderTitleChange
          ? {
              value: headerTitleDraft ?? "",
              onChange: onHeaderTitleChange,
              placeholder: "Project name or title…",
              maxLength: 200,
            }
          : undefined
      }
      editCapability={{
        enabled: isDraft,
        ariaLabel: "Edit quote title",
        onStartEdit: onStartHeaderEdit,
      }}
      status={{ label: statusMeta.label, tone: statusMeta.tone }}
      clientName={clientName}
      clientHref={
        customerCompany?.id ? `/clients/${customerCompany.id}` : undefined
      }
      addressLines={addressLines.length > 0 ? addressLines : undefined}
      phone={location.phone ?? undefined}
      email={location.email ?? undefined}
      primaryActions={primaryActions}
      overflowActions={overflowActions}
      workflow={workflowDescriptor}
      alert={alertDescriptor}
      description={description ?? null}
      descriptionEdit={
        isHeaderEditing && onHeaderDescChange
          ? {
              value: headerDescDraft ?? "",
              onChange: onHeaderDescChange,
              maxLength: 2000,
            }
          : undefined
      }
      items={[
        {
          key: "quote-number",
          label: "Quote #",
          value: (
            <span className="tabular-nums" data-testid="header-quote-number">
              {quote.quoteNumber || "—"}
            </span>
          ),
        },
        {
          key: "issued",
          label: "Issued",
          value: <span className="tabular-nums">{issueDate ?? "—"}</span>,
        },
        {
          key: "expiry",
          label: "Expiry",
          value: (
            <span
              className={
                isExpired
                  ? "text-destructive font-medium tabular-nums"
                  : "tabular-nums"
              }
              data-testid="header-quote-expiry"
            >
              {expiryDate ?? "—"}
              {isExpired && <span className="text-xs ml-1">(Expired)</span>}
            </span>
          ),
        },
        {
          key: "total",
          label: "Total",
          value: (
            <span className="tabular-nums" data-testid="header-quote-total">
              {formatCurrency(quote.total)}
            </span>
          ),
        },
        {
          key: "sent-at",
          label: "Sent",
          value: <span className="tabular-nums">{sentAt}</span>,
          hidden: !sentAt,
        },
        {
          key: "approved-at",
          label: "Approved",
          value: <span className="tabular-nums">{approvedAt}</span>,
          hidden: !approvedAt,
        },
        {
          key: "declined-at",
          label: "Declined",
          value: <span className="tabular-nums">{declinedAt}</span>,
          hidden: !declinedAt,
        },
        {
          key: "from-lead",
          label: "From Lead",
          value: (
            <a
              href={`/leads/${quote.leadId}`}
              className="text-brand hover:underline cursor-pointer"
              data-testid="link-quote-originating-lead"
            >
              View lead →
            </a>
          ),
          hidden: !quote.leadId,
        },
      ]}
      editControls={editControls}
    />
  );
}
