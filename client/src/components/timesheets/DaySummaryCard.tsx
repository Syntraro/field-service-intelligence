/**
 * DaySummaryCard — Header card for the Day View timeline
 * (2026-05-04 v2: grouped-cards refactor).
 *
 * Compact single-row layout: employee selector | name + date |
 * category-totals strip (inline) | total | live badge.
 *
 * The category strip used to be a separate full-width row. Spec calls
 * for it inline with the header for visual density, so it's folded in
 * here. Pure / no fetch.
 */
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLE, type EntryCategory } from "./categoryMap";

export interface DayTeamMember {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface DaySummaryCardProps {
  date: string;
  members: DayTeamMember[];
  selectedMemberId: string;
  totalMinutes: number;
  hasRunning: boolean;
  /** Pre-summed minutes per UI category (onsite / drive / general). */
  categoryTotals: Record<EntryCategory, number>;
  formatMemberName: (member: DayTeamMember) => string;
  onSelectMember: (memberId: string) => void;
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0h 0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

function formatMinutesShort(minutes: number): string {
  if (minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

const STRIP_ORDER: EntryCategory[] = ["onsite", "drive", "general"];
const STRIP_SHORT: Record<EntryCategory, string> = {
  onsite: "On-site",
  drive: "Drive",
  general: "Unbillable",
};

export function DaySummaryCard({
  date,
  members,
  selectedMemberId,
  totalMinutes,
  hasRunning,
  categoryTotals,
  formatMemberName,
  onSelectMember,
}: DaySummaryCardProps) {
  const selected = members.find((m) => m.id === selectedMemberId) ?? null;

  return (
    <Card data-testid="day-summary-card">
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Left cluster: selector + name + date */}
          <div className="flex items-center gap-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedMemberId} onValueChange={onSelectMember}>
              <SelectTrigger className="h-9 w-[220px]" data-testid="day-employee-select">
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {formatMemberName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <div className="flex items-baseline gap-3">
                <span className="text-base font-semibold">{formatMemberName(selected)}</span>
                <span className="text-xs text-muted-foreground">
                  {format(parseISO(date), "EEE, MMM d, yyyy")}
                </span>
              </div>
            )}
          </div>

          {/* Inline category strip — same row as the header. Compact
              chips with dot + label + total. */}
          {selected && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid="day-category-strip"
            >
              {STRIP_ORDER.map((cat) => {
                const style = CATEGORY_STYLE[cat];
                return (
                  <div
                    key={cat}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                      style.chip,
                    )}
                    data-testid={`category-total-${cat}`}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
                    <span className="font-medium">{STRIP_SHORT[cat]}</span>
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMinutesShort(categoryTotals[cat] ?? 0)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Right cluster: live badge + total + count */}
          {selected && (
            <div className="ml-auto flex items-center gap-3">
              {hasRunning && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                  data-testid="day-live-badge"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </span>
              )}
              <div className="text-right">
                <p className="font-mono text-lg font-semibold tabular-nums" data-testid="day-total">
                  {formatMinutes(totalMinutes)}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
