/**
 * DispatchTechnicianSidebar — left column with technician names/avatars.
 * Each row aligns with a DispatchLaneRow in the timeline.
 * Splits technicians into working (on-shift) and off-shift groups.
 */
import type { Technician } from "./dispatchPreviewTypes";
import { LANE_HEIGHT_PX, DIVIDER_HEIGHT_PX } from "./dispatchPreviewUtils";

type Props = {
  technicians: Technician[];
};

/** Thin separator between working and off-shift groups — explicit height matches all board columns */
function OffShiftDivider() {
  return (
    <div className="flex items-center gap-2 px-3 border-b bg-slate-50/80" style={{ height: DIVIDER_HEIGHT_PX }}>
      <div className="flex-1 h-px bg-slate-200" />
      <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">Off shift</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

export default function DispatchTechnicianSidebar({ technicians }: Props) {
  // Split into working and off-shift groups
  const working = technicians.filter(t => t.isWorking !== false);
  const offShift = technicians.filter(t => t.isWorking === false);

  return (
    <div className="flex-shrink-0 border-r bg-white">
      {/* Header spacer — aligns with hour header row */}
      <div className="flex h-8 items-center border-b px-3">
        <span className="text-[11px] font-medium text-muted-foreground">Technicians</span>
      </div>

      {/* Working technicians */}
      {working.map((t, i) => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-3 ${i < working.length - 1 || offShift.length > 0 ? "border-b border-slate-200/80" : ""}`}
          style={{ height: LANE_HEIGHT_PX }}
        >
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: t.color }}
          >
            {t.initials}
          </div>
          <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
        </div>
      ))}

      {/* Off-shift divider and technicians */}
      {offShift.length > 0 && (
        <>
          <OffShiftDivider />
          {offShift.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-2.5 px-3 ${i < offShift.length - 1 ? "border-b border-slate-200/80" : ""}`}
              style={{ height: LANE_HEIGHT_PX }}
            >
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white opacity-50"
                style={{ backgroundColor: t.color }}
              >
                {t.initials}
              </div>
              <p className="truncate text-sm font-medium text-slate-400">{t.name}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
