/**
 * LeadDetailsRail — right-rail metadata card for lead surfaces.
 *
 * Two modes:
 *   - "saved": label/value field rows for Estimated Value, Captured By,
 *     Created By, optional Next Visit Assignee, and the
 *     Created/Updated/Converted timestamp block.
 *   - "draft": editable Estimated Value input + Captured By selector slot,
 *     with placeholder rows for Created By and Created (saved-only metadata
 *     that doesn't exist before first save). Next Visit and Updated/
 *     Converted rows are omitted in draft mode.
 *
 * 2026-05-08 (Phase 4 — RailContentCard adoption): migrated off the
 * hand-rolled `bg-white rounded-md border shadow-sm` chrome onto the
 * canonical `<RailContentCard>` family (`RailContentCardHeader` /
 * `RailContentCardTitle` for the "Details" row, `RailContentCardFieldList`
 * + `RailContentCardField` for the label/value rows). Typography drift
 * — `text-xs`, `text-[11px]`, ad-hoc `text-muted-foreground` — replaced
 * by canonical role tokens via the field primitive's `<dt class="text-label">`
 * / `<dd class="text-row">` bindings. Behavior + content + saved/draft
 * branching unchanged.
 */
import type { ReactNode } from "react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
  RailContentCardFieldList,
  RailContentCardField,
} from "@/components/detail-rail/RailContentCard";
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
    <RailContentCard testId="lead-details-rail">
      <RailContentCardHeader>
        <RailContentCardTitle>Details</RailContentCardTitle>
      </RailContentCardHeader>
      {props.mode === "saved" ? renderSaved(props) : renderDraft(props)}
    </RailContentCard>
  );
}

// ── Saved-mode body — primary fields + audit-timestamp footer ──

function renderSaved(props: SavedRailProps) {
  const { estimatedValue, capturedByName, createdByName, hasVisits, nextVisit, createdAt, updatedAt, convertedAt } = props;
  const nextVisitValue = hasVisits && nextVisit
    ? `${nextVisit.assigneeName ?? "Unassigned"}${
        nextVisit.scheduledStart
          ? ` · ${format(new Date(nextVisit.scheduledStart), "MMM d, h:mm a")}`
          : ""
      }`
    : null;
  return (
    <>
      <RailContentCardFieldList>
        <RailContentCardField label="Estimated Value">
          {fmtValue(estimatedValue)}
        </RailContentCardField>
        <RailContentCardField label="Captured By">
          {capturedByName || "—"}
        </RailContentCardField>
        <RailContentCardField label="Created By">
          {createdByName || "—"}
        </RailContentCardField>
        {hasVisits && nextVisit && (
          <RailContentCardField label="Next Visit Assignee">
            {nextVisitValue}
          </RailContentCardField>
        )}
        {hasVisits && !nextVisit && (
          <RailContentCardField label="Next visit">
            No upcoming visit
          </RailContentCardField>
        )}
      </RailContentCardFieldList>
      <RailContentCardFieldList className="mt-3 pt-3 border-t border-slate-100">
        <RailContentCardField label="Created">
          {fmtDate(createdAt)}
        </RailContentCardField>
        {updatedAt && (
          <RailContentCardField label="Updated">
            {fmtDate(updatedAt)}
          </RailContentCardField>
        )}
        {convertedAt && (
          <RailContentCardField label="Converted">
            {fmtDate(convertedAt)}
          </RailContentCardField>
        )}
      </RailContentCardFieldList>
    </>
  );
}

// ── Draft-mode body — editable inputs + saved-only placeholders ──

function renderDraft(props: DraftRailProps) {
  return (
    <>
      <RailContentCardFieldList>
        <RailContentCardField label="Estimated Value">
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
        </RailContentCardField>
        {/* Captured By — server immutability: server/routes/leads.ts rejects
            PATCH attempts to mutate originTechnicianId, so we surface the
            permanence with a small hint below the selector. */}
        <RailContentCardField label="Captured By">
          <div className="space-y-1">
            <div className="max-w-[200px]">{props.capturedBySlot}</div>
            <p
              className="text-helper text-text-secondary italic"
              data-testid="text-captured-by-immutable-hint"
            >
              Cannot be changed after creation.
            </p>
          </div>
        </RailContentCardField>
        <RailContentCardField label="Created By">—</RailContentCardField>
      </RailContentCardFieldList>
      <RailContentCardFieldList className="mt-3 pt-3 border-t border-slate-100">
        <RailContentCardField label="Created">—</RailContentCardField>
      </RailContentCardFieldList>
    </>
  );
}
