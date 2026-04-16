/**
 * DispatchTechnicianSidebar — left column with technician names/avatars.
 * Each row aligns with a DispatchLaneRow in the timeline.
 * Splits technicians into working (on-shift) and off-shift groups.
 *
 * 2026-04-10: Renders a small live-state chip next to each tech name (Clocked
 * Out / Clocked In / En Route / On Site / Paused). The state is sourced from
 * the canonical /api/team/technicians/live-state projection — no client-side
 * stitching of attendance + visit state.
 */
import { useMemo } from "react";
import type { Technician } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import { LANE_HEIGHT_PX, DIVIDER_HEIGHT_PX } from "./dispatchPreviewUtils";
import { useTechnicianLiveStates, type TechnicianLiveState } from "@/hooks/useTechnicians";

type Props = {
  technicians: Technician[];
};

/**
 * Color mapping for the live-state chip. Reuses the same palette family the
 * dispatch board already uses for visit status (visitStatusColor in
 * dispatchPreviewUtils.ts) so En Route/On Site/Paused render in identical
 * colors at the tech level and the visit level.
 */
function liveStateChipClasses(state: TechnicianLiveState | undefined): string {
  if (!state) return "bg-slate-100 text-slate-500 border-slate-200";
  switch (state.activityStatus) {
    case "paused":
      return "bg-yellow-50 text-yellow-800 border-yellow-200";
    case "on_site":
      return "bg-lime-50 text-lime-800 border-lime-300";
    case "en_route":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "idle":
    default:
      // No active visit — fall back to attendance.
      return state.attendanceStatus === "clocked_in"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-100 text-slate-500 border-slate-200";
  }
}

/** Thin separator between working and off-shift groups — explicit height matches all board columns */
function OffShiftDivider() {
  return (
    <div className="flex items-center gap-2 px-3 border-b bg-slate-50/80" style={{ height: DIVIDER_HEIGHT_PX }}>
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">Off shift</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

export default function DispatchTechnicianSidebar({ technicians }: Props) {
  // Split into working and off-shift groups
  const working = technicians.filter(t => t.isWorking !== false);
  const offShift = technicians.filter(t => t.isWorking === false);

  // 2026-04-10: Live state map keyed by technician id. Sourced from the
  // canonical /api/team/technicians/live-state projection. The hook returns
  // an empty array on first paint and SSE-invalidated refreshes — both safe.
  const { states } = useTechnicianLiveStates();
  const liveStateById = useMemo(() => {
    const m = new Map<string, TechnicianLiveState>();
    for (const s of states) m.set(s.technicianId, s);
    return m;
  }, [states]);

  return (
    <div className="flex-shrink-0 border-r bg-white">
      {/* Header spacer — aligns with hour header row */}
      <div className="flex h-8 items-center border-b px-3">
        <span className="text-xs font-medium text-muted-foreground">Technicians</span>
      </div>

      {/* Working technicians — Unassigned row gets double-divider bottom */}
      {working.map((t, i) => {
        const isUnassigned = t.id === UNASSIGNED_TECH_ID;
        const hasNext = i < working.length - 1 || offShift.length > 0;
        // 2026-04-10: live state chip — only for real techs, not the Unassigned virtual row
        const liveState = isUnassigned ? undefined : liveStateById.get(t.id);
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-3 relative ${
              isUnassigned
                ? "" /* double divider via pseudo-element below */
                : hasNext ? "border-b border-slate-200/80" : ""
            }`}
            style={{ height: LANE_HEIGHT_PX }}
          >
            {/* 2026-03-27: Double-divider for Unassigned row — visually separates from tech rows */}
            {isUnassigned && (
              <div className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none"
                style={{ background: "linear-gradient(to bottom, rgba(100,116,139,0.25) 0px, rgba(100,116,139,0.25) 1px, transparent 1px, transparent 2px, rgba(100,116,139,0.18) 2px, rgba(100,116,139,0.18) 3px)" }} />
            )}
            <div
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${isUnassigned ? "opacity-60" : ""}`}
              style={{ backgroundColor: t.color }}
            >
              {t.initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-xs font-medium leading-tight ${isUnassigned ? "text-slate-500 italic" : "text-slate-900"}`}>{t.name}</p>
              {!isUnassigned && liveState && (
                <span
                  className={`mt-0.5 inline-block rounded-full border px-1.5 py-px text-[11px] font-medium leading-none ${liveStateChipClasses(liveState)}`}
                  data-testid={`tech-live-state-${t.id}`}
                  data-state={liveState.activityStatus === "idle" ? liveState.attendanceStatus : liveState.activityStatus}
                  title={liveState.label}
                >
                  {liveState.label}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Off-shift divider and technicians */}
      {offShift.length > 0 && (
        <>
          <OffShiftDivider />
          {offShift.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-3 ${i < offShift.length - 1 ? "border-b border-slate-200/80" : ""}`}
              style={{ height: LANE_HEIGHT_PX }}
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white opacity-50"
                style={{ backgroundColor: t.color }}
              >
                {t.initials}
              </div>
              <p className="truncate text-xs font-medium leading-tight text-slate-400">{t.name}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
