/**
 * LeadSummaryCard — top-of-page lead summary panel.
 *
 * Two modes:
 *   - "saved": uses CanonicalDetailHeader layout="card" with structured props
 *     (2026-05-08 Task 3). entityLabel="Lead" + onBack + title string +
 *     clientName/contactName/addressLines/phone/email +
 *     primaryActions/overflowActions from the LeadSummaryActions shape.
 *     descriptionEditNode slot (always visible; handles own read/edit state).
 *     No bottom action bar — actions live in the right-column cluster.
 *
 *   - "draft": renders the same card chrome with the title as an editable
 *     input, a "Draft" pill in place of the status pill, an inline
 *     priority Select, and a slot for the client/location selector (the
 *     create page passes CreateOrSelectField + inline create-client form).
 *     Draft mode is intentionally NOT migrated to CanonicalDetailHeader —
 *     the editable affordances (Input label + required marker, priority
 *     Select, clientLocationSlot) don't fit the slot API without forcing
 *     an artificial separation that buys nothing. (2026-05-08 audit note)
 *
 * Sharing this card is the entire reason we extracted it — both pages
 * source the same DOM/CSS, so they cannot drift. Don't redesign in either
 * caller; if a chrome change is needed, change it here.
 */
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getClientDisplayName } from "@shared/clientDisplayName";
import {
  CanonicalDetailHeader,
  type HeaderAction,
  type HeaderOverflowItem,
  type HeaderEditControls,
} from "@/components/detail/CanonicalDetailHeader";
import { getLeadStatusMeta } from "@/lib/statusBadges";

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
 * 2026-05-08 Task 3: actions expressed as structured data, not JSX.
 * primaryActions / overflowActions built inline in LeadSummaryCard below.
 * No bottom action bar — all controls live in the right-column cluster.
 */
export interface LeadSummaryActions {
  canConvert: boolean;
  canContact: boolean;
  canMarkLost: boolean;
  convertedQuoteId: string | null;
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
  actions?: LeadSummaryActions;
  /** Lead description text shown in CDH. */
  description?: string | null;
  /** When true, lead is won/lost — pencil and title/description editing are hidden. */
  isTerminal?: boolean;
  /** Inline title + description edit — unified edit session matching Job/Quote. */
  isHeaderEditing?: boolean;
  headerTitleDraft?: string;
  onHeaderTitleChange?: (v: string) => void;
  headerDescDraft?: string;
  onHeaderDescChange?: (v: string) => void;
  onStartHeaderEdit?: () => void;
  onHeaderSave?: () => void;
  onHeaderCancel?: () => void;
  isHeaderSaving?: boolean;
  headerError?: string | null;
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
  // ── Saved mode — CanonicalDetailHeader (structured props) ──────────────
  if (props.mode === "saved") {
    const {
      lead, actions, description,
      isTerminal,
      isHeaderEditing, headerTitleDraft, onHeaderTitleChange,
      headerDescDraft, onHeaderDescChange,
      onStartHeaderEdit, onHeaderSave, onHeaderCancel, isHeaderSaving, headerError,
    } = props;

    const statusMeta = getLeadStatusMeta(lead.status);

    const companyDisplay = lead.customerCompany
      ? getClientDisplayName(lead.customerCompany)
      : lead.customerCompanyName || lead.location?.companyName;

    const addressLine = [
      lead.location?.address,
      lead.location?.city,
      lead.location?.province,
      lead.location?.postalCode,
    ]
      .filter(Boolean)
      .join(", ");

    // ── Build structured action arrays ──────────────────────────────
    const primaryActions: HeaderAction[] = actions
      ? [
          {
            id: "convert-to-quote",
            label: "Convert to Quote",
            onClick: actions.onConvertToQuote,
            variant: "primary",
            hidden: !actions.canConvert || !!actions.convertedQuoteId,
            testId: "button-convert-to-quote",
          },
          {
            id: "mark-contacted",
            label: "Mark Contacted",
            onClick: actions.onMarkContacted,
            variant: "outline",
            disabled: actions.isStatusMutating,
            hidden: !actions.canContact,
            testId: "button-mark-contacted",
          },
          {
            id: "mark-lost",
            label: "Mark Lost",
            onClick: actions.onMarkLost,
            variant: "danger",
            disabled: actions.isStatusMutating,
            hidden: !actions.canMarkLost,
            testId: "button-mark-lost",
          },
          {
            id: "view-quote",
            label: "View Quote",
            onClick: actions.onViewQuote,
            variant: "outline",
            hidden: !actions.convertedQuoteId,
            testId: "button-view-quote",
          },
        ]
      : [];

    const overflowActions: HeaderOverflowItem[] = actions
      ? [
          {
            id: "archive",
            label: "Archive lead",
            onClick: actions.onArchive,
            testId: "button-archive-lead",
          },
          {
            id: "hard-delete",
            label: "Delete permanently",
            onClick: actions.onHardDelete,
            separator: true,
            tone: "destructive",
            testId: "button-hard-delete-lead",
          },
        ]
      : [];

    // Terminal leads (won/lost) are immutable: no pencil, no title edit, no description edit.
    const canEdit = !isTerminal;

    const leadEditControls: HeaderEditControls | undefined =
      canEdit && isHeaderEditing
        ? {
            onSave: onHeaderSave ?? (() => {}),
            onCancel: onHeaderCancel ?? (() => {}),
            isSaving: isHeaderSaving,
            error: headerError,
          }
        : undefined;

    return (
      <CanonicalDetailHeader
        testId="lead-detail-header"
        isEditing={canEdit && isHeaderEditing}
        title={lead.title}
        titleEdit={
          canEdit && isHeaderEditing && onHeaderTitleChange
            ? {
                value: headerTitleDraft ?? "",
                onChange: onHeaderTitleChange,
                placeholder: "Lead title…",
                maxLength: 500,
              }
            : undefined
        }
        status={{ label: statusMeta.label, tone: statusMeta.tone }}
        clientName={companyDisplay ?? undefined}
        contactName={lead.location?.contactName ?? undefined}
        addressLines={addressLine ? [addressLine] : undefined}
        phone={lead.location?.phone ?? undefined}
        email={lead.location?.email ?? undefined}
        editCapability={{
          enabled: canEdit,
          ariaLabel: "Edit lead title",
          onStartEdit: onStartHeaderEdit,
        }}
        primaryActions={primaryActions}
        overflowActions={overflowActions}
        description={description ?? null}
        descriptionEdit={
          canEdit && isHeaderEditing && onHeaderDescChange
            ? {
                value: headerDescDraft ?? "",
                onChange: onHeaderDescChange,
                maxLength: 600,
              }
            : undefined
        }
        editControls={leadEditControls}
        items={[
          {
            key: "source",
            label: "Source",
            value: (
              <span className="capitalize" data-testid="header-lead-source">
                {lead.sourceType}
              </span>
            ),
          },
          {
            key: "priority",
            label: "Priority",
            value: (
              <span className="capitalize" data-testid="header-lead-priority">
                {lead.priority}
              </span>
            ),
            hidden: !lead.priority,
          },
        ]}
      />
    );
  }

  // ── Draft mode — unchanged (shared with CreateLeadPage) ──────────────
  // Intentionally not migrated to CanonicalDetailHeader. The editable
  // affordances (Input with label + required marker, priority Select,
  // clientLocationSlot) don't compose cleanly through the slot API.
  // (2026-05-08 audit note — see file docstring above)
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
        {renderDraft(props)}
      </div>
    </div>
  );
}

// ── Draft-mode body — same chrome, editable affordances ──────────────
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
