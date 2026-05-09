/**
 * TimesheetSummaryStrip — shared identity + summary header strip.
 *
 * Canonical shell used by both the Day View (DaySummaryCard) and the
 * Week Stack View (WeekStackPage context header).
 *
 * Structure:
 *   LEFT  → User icon + member selector (generic id/label list)
 *   RIGHT → tech name + date/range label + chips slot
 *           + optional animated Live badge + total time
 *           (right section hidden when techName is null/empty)
 *
 * Callers own:
 *   - date string formatting
 *   - chip/pill rendering and wrappers
 *   - total duration formatting
 *
 * This component owns:
 *   - shell layout + border
 *   - selector pattern (User icon + Select trigger sizing)
 *   - name + date label layout tokens
 *   - live badge animation
 *   - total span layout tokens
 */
import type { ReactNode } from "react";
import { User } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface TimesheetSummaryStripMember {
  id: string;
  label: string;
}

export interface TimesheetSummaryStripProps {
  // ── Selector (left side) ───────────────────────────────────────────
  members: TimesheetSummaryStripMember[];
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
  selectorPlaceholder?: string;

  // ── Right side — rendered only when techName is non-empty ──────────
  /** Pre-resolved display name for the selected technician. */
  techName?: string | null;
  /** Pre-formatted date string or range label (e.g. "Mon, May 4, 2026"
   *  or "May 4 – May 10, 2026"). Caller formats it. */
  dateLabel?: string;
  /** Chip / pill block. Caller supplies the fully-formed ReactNode
   *  including any wrapper div with gap/flex classes. */
  chips?: ReactNode;
  /** When true, renders an animated green Live badge between chips and total. */
  hasRunning?: boolean;
  /** Pre-formatted total duration string (e.g. "3h 15m"). Caller formats it.
   *  Null / undefined hides the total span. */
  totalFormatted?: string | null;

  // ── Test surface ───────────────────────────────────────────────────
  containerTestId?: string;
  selectorTestId?: string;
  totalTestId?: string;
}

export function TimesheetSummaryStrip({
  members,
  selectedMemberId,
  onSelectMember,
  selectorPlaceholder = "Select team member",
  techName,
  dateLabel,
  chips,
  hasRunning = false,
  totalFormatted,
  containerTestId,
  selectorTestId,
  totalTestId,
}: TimesheetSummaryStripProps) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-md px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      data-testid={containerTestId}
    >
      {/* LEFT: technician selector */}
      <div className="flex items-center gap-2 min-w-0">
        <User className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={selectedMemberId} onValueChange={onSelectMember}>
          <SelectTrigger
            className="h-8 w-[220px] text-sm"
            data-testid={selectorTestId}
          >
            <SelectValue placeholder={selectorPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* RIGHT: name + date label + chips slot + optional Live badge + total */}
      {techName && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-row font-semibold text-foreground">
              {techName}
            </span>
            {dateLabel && (
              <span className="text-helper text-muted-foreground tabular-nums">
                {dateLabel}
              </span>
            )}
          </div>
          {chips}
          {hasRunning && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-helper font-semibold text-emerald-700"
              data-testid="strip-live-badge"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          )}
          {totalFormatted != null && (
            <span
              className="text-row font-semibold tabular-nums text-foreground"
              data-testid={totalTestId}
            >
              {totalFormatted}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
