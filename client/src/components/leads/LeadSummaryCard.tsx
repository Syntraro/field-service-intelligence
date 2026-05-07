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
import { ArrowLeft, MapPin, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

type SavedProps = {
  mode: "saved";
  lead: LeadSummaryShape;
  onBack: () => void;
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

function renderDraft(props: DraftProps) {
  const sourceType = props.sourceType ?? "office";
  return (
    <>
      <Input
        value={props.title}
        onChange={(e) => props.onTitleChange(e.target.value)}
        placeholder="Enter lead title"
        maxLength={500}
        className="text-lg font-bold text-slate-900 leading-tight border-0 px-0 py-0 h-auto shadow-none focus-visible:ring-0 placeholder:font-bold placeholder:text-slate-300 bg-transparent"
        data-testid="input-lead-title"
      />
      <div className="flex items-center gap-2 mt-1 flex-wrap">
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
