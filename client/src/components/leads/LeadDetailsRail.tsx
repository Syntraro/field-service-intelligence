/**
 * LeadDetailsRail — right-rail metadata card for lead surfaces.
 *
 * Two modes:
 *   - "saved": MetaRows for Estimated Value, Captured By, Created By,
 *     optional Next Visit Assignee, and the Created/Updated/Converted
 *     timestamp block. This is the chrome the existing LeadDetailPage
 *     rendered inline; visual output is unchanged.
 *   - "draft": editable Estimated Value input + Captured By selector slot,
 *     with placeholder rows for Created By and Created (saved-only metadata
 *     that doesn't exist before first save). Next Visit and Updated/
 *     Converted rows are omitted in draft mode — they only have meaning
 *     after the lead has visits or has been mutated.
 */
import type { ReactNode } from "react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { LeadMetaRow } from "./shared/LeadMetaRow";
import { fmtDate, fmtValue } from "./shared/leadFormatters";

// ── Types ──

export interface NextLeadVisit {
  scheduledStart: string | null;
  /** Pre-resolved assignee display name (e.g., "Alice, Bob"). */
  assigneeName: string | null;
}

type SavedRailProps = {
  mode: "saved";
  estimatedValue: string | null;
  capturedByName: string | null;
  createdByName: string | null;
  /**
   * Whether this lead has any visits at all. When false, the next-visit
   * rows are hidden entirely — matches the prior behavior where the row
   * only appeared once at least one visit existed on the lead.
   */
  hasVisits: boolean;
  /** First upcoming scheduled-or-in-progress visit, if any. */
  nextVisit: NextLeadVisit | null;
  createdAt: string;
  updatedAt: string | null;
  convertedAt: string | null;
};

type DraftRailProps = {
  mode: "draft";
  estimatedValue: string;
  onEstimatedValueChange: (value: string) => void;
  /**
   * Slot for the Captured By selector (the create page passes a
   * <TechnicianSelector mode="single" />). Left as a slot so the rail
   * doesn't take a hard dependency on the technicians directory hook.
   */
  capturedBySlot: ReactNode;
};

export type LeadDetailsRailProps = SavedRailProps | DraftRailProps;

// ── Component ──

export function LeadDetailsRail(props: LeadDetailsRailProps) {
  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-[#f8fafc] border-b border-slate-100">
        <span className="text-sm font-semibold text-[#0f172a]">Details</span>
      </div>
      <div className="px-4 py-2.5 space-y-2 text-xs">
        {props.mode === "saved" ? renderSaved(props) : renderDraft(props)}
      </div>
    </div>
  );
}

// ── Saved-mode body — must match prior LeadDetailPage DOM exactly ──

function renderSaved(props: SavedRailProps) {
  const { estimatedValue, capturedByName, createdByName, hasVisits, nextVisit, createdAt, updatedAt, convertedAt } = props;
  return (
    <>
      <LeadMetaRow label="Estimated Value" value={fmtValue(estimatedValue)} />
      <LeadMetaRow label="Captured By" value={capturedByName || "—"} />
      <LeadMetaRow label="Created By" value={createdByName || "—"} />
      {hasVisits && nextVisit && (
        <LeadMetaRow
          label="Next Visit Assignee"
          value={`${nextVisit.assigneeName ?? "Unassigned"}${
            nextVisit.scheduledStart
              ? ` · ${format(new Date(nextVisit.scheduledStart), "MMM d, h:mm a")}`
              : ""
          }`}
        />
      )}
      {hasVisits && !nextVisit && (
        <LeadMetaRow label="Next visit" value="No upcoming visit" />
      )}
      <div className="border-t border-slate-100 pt-1.5">
        <LeadMetaRow label="Created" value={fmtDate(createdAt)} />
        {updatedAt && <LeadMetaRow label="Updated" value={fmtDate(updatedAt)} />}
        {convertedAt && <LeadMetaRow label="Converted" value={fmtDate(convertedAt)} />}
      </div>
    </>
  );
}

// ── Draft-mode body — editable inputs + saved-only placeholders ──

function renderDraft(props: DraftRailProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Estimated Value</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={props.estimatedValue}
          onChange={(e) => props.onEstimatedValueChange(e.target.value)}
          placeholder="0.00"
          className="h-7 px-2 text-xs w-28 text-right tabular-nums"
          data-testid="input-estimated-value"
        />
      </div>
      {/* Captured By — server immutability: server/routes/leads.ts rejects
          PATCH attempts to mutate originTechnicianId, so we surface the
          permanence with a small hint below the selector. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground shrink-0">Captured By</span>
          <div className="min-w-0 flex-1 max-w-[200px]">{props.capturedBySlot}</div>
        </div>
        <p
          className="text-[11px] text-slate-400 italic text-right"
          data-testid="text-captured-by-immutable-hint"
        >
          Cannot be changed after creation.
        </p>
      </div>
      <LeadMetaRow label="Created By" value="—" />
      <div className="border-t border-slate-100 pt-1.5">
        <LeadMetaRow label="Created" value="—" />
      </div>
    </>
  );
}
