/**
 * LeadSummaryCard — top-of-page lead summary panel.
 *
 * Two modes:
 *   - "saved": renders the saved lead's title, status pill, priority/source,
 *     and client/location identity block. This is the chrome the existing
 *     LeadDetailPage rendered inline; visual output is unchanged.
 *   - "draft": renders the same chrome with the title as an editable input,
 *     a "Draft" pill in place of the status pill, an inline priority Select,
 *     and a slot for the client/location selector (the create page passes
 *     CreateOrSelectField + inline create-client form here).
 *
 * Sharing this card is the entire reason we extracted it — both pages
 * source the same DOM/CSS, so they cannot drift. Don't redesign in either
 * caller; if a chrome change is needed, change it here.
 */
import type { ReactNode } from "react";
import {
  ArrowLeft, MapPin, User,
  // 2026-05-08 (Phase 3 — Lead Actions relocation): icons for the
  // canonical Section B action bar, mirroring the Quote / Invoice
  // header action-bar pattern (h-7 text-xs gap-1).
  FileText, Send, Trash2, AlertTriangle, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { getLeadStatusColors } from "./shared/leadBadges";

// ── Types ──

export interface LeadSummaryLocation {
  companyName: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

export interface LeadSummaryCustomerCompany {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  useCompanyAsPrimary: boolean;
}

export interface LeadSummaryShape {
  title: string;
  status: string;
  priority: string | null;
  sourceType: string;
  location?: LeadSummaryLocation | null;
  customerCompanyName?: string | null;
  customerCompany?: LeadSummaryCustomerCompany | null;
}

/**
 * 2026-05-08 (Phase 3 — Lead Actions relocation): the prior right-rail
 * "Actions" tab was retired. Convert / Mark Contacted / Mark Lost /
 * Archive / Delete / View-Linked-Quote moved into a Section B action
 * bar at the bottom of this card, mirroring the QuoteHeaderCard /
 * InvoiceHeaderCard pattern (border-t divider, h-7 text-xs buttons,
 * flex-wrap gap-1.5). Gating flags (`canConvert`, `canContact`,
 * `canMarkLost`) and the destructive AlertDialogs stay on
 * LeadDetailPage; this card only renders the buttons + forwards clicks
 * via callbacks. All optional — when omitted (or in draft mode), the
 * action bar is not rendered.
 */
export interface LeadSummaryActions {
  /** Show the primary `Convert to Quote` button. */
  canConvert: boolean;
  /** Show the `Mark Contacted` button. */
  canContact: boolean;
  /** Show the `Mark Lost` button. */
  canMarkLost: boolean;
  /** Pre-existing converted-quote id; when set, surfaces a `View Quote` button. */
  convertedQuoteId: string | null;
  /** Disabled state mirror of `statusMutation.isPending`. */
  isStatusMutating?: boolean;
  onConvertToQuote: () => void;
  onMarkContacted: () => void;
  onMarkLost: () => void;
  onArchive: () => void;
  onHardDelete: () => void;
  onViewQuote: () => void;
}

type SavedProps = {
  mode: "saved";
  lead: LeadSummaryShape;
  onBack: () => void;
  /** Optional action handlers — when provided, the card renders a
   *  Section B action bar at the bottom (border-t separator). When
   *  omitted, the card renders identity-only chrome. */
  actions?: LeadSummaryActions;
};

type DraftProps = {
  mode: "draft";
  onBack: () => void;
  title: string;
  onTitleChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  sourceType?: string;
  /**
   * Slot for the client/location selector. The create page owns this
   * control so search → select → "create new client" inline behavior
   * stays unchanged when the user has no existing location.
   */
  clientLocationSlot: ReactNode;
};

export type LeadSummaryCardProps = SavedProps | DraftProps;

// ── Component ──

export function LeadSummaryCard(props: LeadSummaryCardProps) {
  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={props.onBack}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
            aria-label="Back to leads"
            data-testid="button-lead-back"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Lead
          </span>
        </div>

        {props.mode === "saved"
          ? renderSaved(props.lead)
          : renderDraft(props)}
      </div>

      {/* Section B — action bar (saved mode + actions present).
          Mirrors QuoteHeaderCard's border-t + px-4 py-1.5 + h-7 text-xs
          density so Lead belongs to the same header-action visual
          family as Quote / Invoice / Job. */}
      {props.mode === "saved" && props.actions
        ? renderActionBar(props.actions)
        : null}
    </div>
  );
}

// ── Action bar — mirrors QuoteHeaderCard "Section B" ──────────────

function renderActionBar(actions: LeadSummaryActions) {
  const {
    canConvert, canContact, canMarkLost, convertedQuoteId, isStatusMutating,
    onConvertToQuote, onMarkContacted, onMarkLost, onArchive, onHardDelete, onViewQuote,
  } = actions;
  // Hide the bar entirely when no action is currently applicable. Archive
  // + Delete are always allowed, so this guard never trips in practice
  // — left in place as a defensive zero-state.
  const hasAnyAction =
    canConvert || canContact || canMarkLost || !!convertedQuoteId || true;
  if (!hasAnyAction) return null;
  return (
    <div
      className="px-4 py-1.5 border-t border-slate-200/60 flex items-center gap-1.5 flex-wrap"
      data-testid="lead-header-action-bar"
    >
      {canConvert && !convertedQuoteId && (
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white gap-1.5 h-7"
          onClick={onConvertToQuote}
          data-testid="button-convert-to-quote"
        >
          <FileText className="h-3.5 w-3.5" />Convert to Quote
        </Button>
      )}
      {canContact && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-7"
          onClick={onMarkContacted}
          disabled={isStatusMutating}
          data-testid="button-mark-contacted"
        >
          <Send className="h-3.5 w-3.5" />Mark Contacted
        </Button>
      )}
      {canMarkLost && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={onMarkLost}
          disabled={isStatusMutating}
          data-testid="button-mark-lost"
        >
          Mark Lost
        </Button>
      )}
      {convertedQuoteId && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-7"
          onClick={onViewQuote}
          data-testid="button-view-quote"
        >
          <ChevronRight className="h-3.5 w-3.5" />View Quote
        </Button>
      )}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-xs h-7 text-slate-500 hover:text-amber-700 hover:bg-amber-50"
        onClick={onArchive}
        data-testid="button-archive-lead"
      >
        <Trash2 className="h-3.5 w-3.5" />Archive
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-xs h-7 text-slate-500 hover:text-red-700 hover:bg-red-50"
        onClick={onHardDelete}
        data-testid="button-hard-delete-lead"
      >
        <AlertTriangle className="h-3.5 w-3.5" />Delete
      </Button>
    </div>
  );
}

// ── Saved-mode body — must match the prior LeadDetailPage DOM exactly ──

function renderSaved(lead: LeadSummaryShape) {
  const statusColor = getLeadStatusColors(lead.status);
  const addressLine = [
    lead.location?.address,
    lead.location?.city,
    lead.location?.province,
    lead.location?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const contactLine = [lead.location?.phone, lead.location?.email]
    .filter(Boolean)
    .join(" • ");
  const hasCompanyDisplay =
    lead.customerCompany || lead.customerCompanyName || lead.location?.companyName;
  const companyDisplay = lead.customerCompany
    ? getClientDisplayName(lead.customerCompany)
    : lead.customerCompanyName || lead.location?.companyName;

  return (
    <>
      <h1 className="text-lg font-bold text-slate-900 leading-tight truncate">
        {lead.title}
      </h1>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${statusColor.bg} ${statusColor.text}`}
        >
          {lead.status}
        </span>
        {lead.priority && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 capitalize">
            {lead.priority}
          </Badge>
        )}
        <span className="text-xs text-slate-400 uppercase tracking-wide">
          {lead.sourceType}
        </span>
      </div>
      {/* Client / Location */}
      <div className="mt-2 pt-1.5 border-t border-slate-100">
        {hasCompanyDisplay && (
          <p className="text-sm font-semibold text-slate-800">{companyDisplay}</p>
        )}
        {lead.location?.contactName && (
          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
            <User className="h-3 w-3 text-slate-400" />
            {lead.location.contactName}
          </p>
        )}
        {addressLine && (
          <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3 w-3 shrink-0" />
            {addressLine}
          </p>
        )}
        {contactLine && (
          <p className="text-xs text-slate-400 mt-0.5">{contactLine}</p>
        )}
      </div>
    </>
  );
}

// ── Draft-mode body — same chrome, editable affordances ──
//
// 2026-05-07 affordance fix: the title used to render with `border-0
// px-0 py-0 shadow-none focus-visible:ring-0 placeholder:text-slate-300
// bg-transparent`, which made it visually equivalent to faded H1 chrome
// — first-time users couldn't tell it was an input. The field is now
// chrome-bearing (label + required marker, subtle border + bg, visible
// focus ring) but keeps the same large title typography so it still
// reads as the page heading. Mirrors the canonical pattern Job Detail
// uses for its editable summary header.

function renderDraft(props: DraftProps) {
  const sourceType = props.sourceType ?? "office";
  const titleEmpty = props.title.trim().length === 0;
  return (
    <>
      <div className="space-y-1">
        <label
          htmlFor="lead-title-input"
          className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1"
        >
          Title
          <span
            aria-hidden="true"
            className="text-rose-500"
            data-testid="lead-title-required-indicator"
          >
            *
          </span>
          <span className="sr-only">(required)</span>
        </label>
        <Input
          id="lead-title-input"
          value={props.title}
          onChange={(e) => props.onTitleChange(e.target.value)}
          placeholder="What's this lead about? e.g., AC tune-up at Basil Box"
          maxLength={500}
          required
          aria-required="true"
          aria-invalid={titleEmpty || undefined}
          className="text-lg font-bold text-slate-900 leading-tight h-auto py-2 px-3 bg-white border border-slate-300 rounded-md shadow-sm cursor-text placeholder:font-medium placeholder:text-slate-400 hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-brand/25 focus-visible:border-brand transition-colors"
          data-testid="input-lead-title"
        />
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-slate-100 text-slate-500">
          Draft
        </span>
        <Select value={props.priority} onValueChange={props.onPriorityChange}>
          <SelectTrigger
            className="h-6 px-2 text-xs capitalize w-auto gap-1 border-slate-200"
            data-testid="select-priority"
            aria-label="Priority"
          >
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400 uppercase tracking-wide">
          {sourceType}
        </span>
      </div>
      {/* Client / Location slot — owned by the create page */}
      <div className="mt-2 pt-1.5 border-t border-slate-100">
        {props.clientLocationSlot}
      </div>
    </>
  );
}
