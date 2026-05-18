/**
 * WeekDispatchBoardTechRow — one technician row spanning all visible day cells.
 *
 * Identity column:
 *   - Avatar + name + live-state chip (matches DispatchTechnicianSidebar treatment).
 *   - Clicking the identity column opens a DropdownMenu with Clock In / Clock Out.
 *   - Uses the manager clock-in/out endpoints so dispatchers can act on behalf of techs.
 *
 * Typography follows the Day timeline technician sidebar:
 *   - Name: text-xs font-medium (matching DispatchTechnicianSidebar)
 *   - Avatar: text-xs font-semibold text-white (matching DispatchTechnicianSidebar)
 *   - Off-shift meta: text-helper text-slate-400
 * Column width: TECH_SIDEBAR_WIDTH_PX (200px) — same as Day sidebar for visual consistency.
 */
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BoardTechRow } from "./weekDispatchBoardAdapter";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import { TECH_SIDEBAR_WIDTH_PX, liveStateTone } from "./dispatchPreviewUtils";
import { useTechnicianLiveStates } from "@/hooks/useTechnicians";
import { StatusChip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import WeekDispatchBoardCell from "./WeekDispatchBoardCell";

type Props = {
  row: BoardTechRow;
  weekDays: Date[];
  todayKey: string;
  colCount: number;
  onCellClick: (techId: string, dayKey: string) => void;
  onSelectVisit: (visit: DispatchVisit) => void;
};

export default function WeekDispatchBoardTechRow({
  row, weekDays, todayKey, colCount, onCellClick, onSelectVisit,
}: Props) {
  const { tech } = row;
  const isOffShift = tech.isWorking === false;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Live state — same canonical hook as Day sidebar.
  // All board rows share the same cached query; only one HTTP request is made.
  const { states } = useTechnicianLiveStates();
  const liveState = useMemo(
    () => states.find((s) => s.technicianId === tech.id),
    [states, tech.id],
  );
  const isClockedIn = liveState?.attendanceStatus === "clocked_in";

  const clockInMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/time/manager/clock-in", {
        method: "POST",
        body: JSON.stringify({ technicianId: tech.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/live-state"] });
      toast({ title: `${tech.name} clocked in` });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Could not clock in";
      toast({ title: "Clock-in failed", description: msg, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/time/manager/clock-out", {
        method: "POST",
        body: JSON.stringify({ technicianId: tech.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/technicians/live-state"] });
      toast({ title: `${tech.name} clocked out` });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Could not clock out";
      toast({ title: "Clock-out failed", description: msg, variant: "destructive" });
    },
  });

  const isMutating = clockInMutation.isPending || clockOutMutation.isPending;

  return (
    <div
      className="grid border-b"
      style={{ gridTemplateColumns: `${TECH_SIDEBAR_WIDTH_PX}px repeat(${colCount}, 1fr)` }}
    >
      {/* Identity column — DropdownMenu trigger; only this section is interactive */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`flex w-full items-center gap-2 border-r px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 ${
              isOffShift ? "bg-slate-50 hover:bg-slate-100" : "bg-white"
            } ${isMutating ? "pointer-events-none opacity-60" : ""}`}
          >
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${isOffShift ? "opacity-50" : ""}`}
              style={{ backgroundColor: tech.color }}
            >
              {tech.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-xs font-medium leading-tight ${
                  isOffShift ? "text-slate-400" : "text-slate-900"
                }`}
                title={tech.name}
              >
                {tech.name}
              </p>
              {/* Live-state chip — mirrors DispatchTechnicianSidebar */}
              {liveState ? (
                <div className="mt-0.5">
                  <StatusChip tone={liveStateTone(liveState)}>
                    {liveState.label}
                  </StatusChip>
                </div>
              ) : isOffShift ? (
                <span className="text-helper leading-none text-slate-400">Off shift</span>
              ) : null}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
          {isClockedIn ? (
            <DropdownMenuItem
              onSelect={() => clockOutMutation.mutate()}
              disabled={isMutating}
            >
              Clock Out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => clockInMutation.mutate()}
              disabled={isMutating}
            >
              Clock In
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Day cells */}
      {weekDays.map((day) => {
        const dayKey = format(day, "yyyy-MM-dd");
        const cell = row.cells.get(dayKey) ?? {
          dayKey,
          jobCount: 0,
          scheduledMinutes: 0,
          urgentCount: 0,
          utilizationPct: 0,
          visits: [],
          tasks: [],
        };
        return (
          <div key={dayKey} className="border-r p-1">
            <WeekDispatchBoardCell
              cell={cell}
              techId={tech.id}
              isToday={dayKey === todayKey}
              onCellClick={onCellClick}
              onSelectVisit={onSelectVisit}
            />
          </div>
        );
      })}
    </div>
  );
}
