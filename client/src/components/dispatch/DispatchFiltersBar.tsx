/**
 * DispatchFiltersBar — shared filter bar for Day and Week views.
 * Multi-select tech filter + visit status filter + hide weekends (Week only).
 */
import { Link } from "wouter";
import { Check, MapPin, Route, ExternalLink, Settings2 } from "lucide-react";
import type { Technician, VisitStatus } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import { VISIT_STATUS_OPTIONS } from "@/lib/visitStatusDisplay";
import { visitStatusDot } from "./dispatchPreviewUtils";
import { UNASSIGNED_COLOR } from "@shared/colors";
// 2026-04-21: dropdown shell extracted so the dashboard workload card can
// mirror the dispatcher interaction pattern. Behavior here is unchanged.
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

type Props = {
  technicians: Technician[];
  selectedTechIds: Set<string>;
  onTechToggle: (id: string) => void;
  onTechSelectAll: () => void;
  onTechClearAll: () => void;
  selectedStatuses: Set<VisitStatus>;
  onStatusToggle: (s: VisitStatus) => void;
  /** Show "Unassigned" as a filter option (when unassigned visits exist) */
  includeUnassigned?: boolean;
  /** Week view only: hide weekends toggle */
  showHideWeekends?: boolean;
  hideWeekends?: boolean;
  onToggleHideWeekends?: () => void;
  /** Map panel toggle — right-aligned in filter row */
  showMap?: boolean;
  onToggleMap?: () => void;
  /** Show unscheduled jobs on map toggle — visible only when map is open */
  showUnscheduledOnMap?: boolean;
  onToggleUnscheduledOnMap?: () => void;
  /** Show route lines on map toggle — visible only when map is open */
  showRoutes?: boolean;
  onToggleRoutes?: () => void;
};

export default function DispatchFiltersBar({
  technicians, selectedTechIds, onTechToggle, onTechSelectAll, onTechClearAll,
  selectedStatuses, onStatusToggle,
  includeUnassigned,
  showHideWeekends, hideWeekends, onToggleHideWeekends,
  showMap, onToggleMap,
  showUnscheduledOnMap, onToggleUnscheduledOnMap,
  showRoutes, onToggleRoutes,
}: Props) {
  // 2026-03-23: Total includes Unassigned when present, for accurate badge count
  const totalFilterable = technicians.length + (includeUnassigned ? 1 : 0);

  return (
    <div className="flex items-center gap-2 border-b bg-slate-50 px-5 py-2">
      {/* Team multi-select (generic workforce filter — renamed from
          "Technicians" 2026-04-21 for multi-vertical tenants). */}
      <MultiSelectDropdown label="Team" count={selectedTechIds.size} total={totalFilterable}>
        <div className="p-2">
          <div className="mb-2 flex gap-1">
            <button onClick={onTechSelectAll} className="text-xs text-primary hover:underline">Select All</button>
            <span className="text-xs text-muted-foreground">|</span>
            <button onClick={onTechClearAll} className="text-xs text-primary hover:underline">Clear All</button>
          </div>
          {technicians.map(t => (
            <button key={t.id} onClick={() => onTechToggle(t.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
              <div className={`flex h-4 w-4 items-center justify-center rounded border ${
                selectedTechIds.has(t.id) ? "border-primary bg-primary" : "border-slate-300"
              }`}>
                {selectedTechIds.has(t.id) && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
              <span>{t.name}</span>
            </button>
          ))}
          {/* 2026-03-23: Unassigned filter option — shown when unassigned visits exist */}
          {includeUnassigned && (
            <>
              <div className="my-1.5 border-t border-slate-100" />
              <button onClick={() => onTechToggle(UNASSIGNED_TECH_ID)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
                <div className={`flex h-4 w-4 items-center justify-center rounded border ${
                  selectedTechIds.has(UNASSIGNED_TECH_ID) ? "border-primary bg-primary" : "border-slate-300"
                }`}>
                  {selectedTechIds.has(UNASSIGNED_TECH_ID) && <Check className="h-3 w-3 text-white" />}
                </div>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: UNASSIGNED_COLOR }} />
                <span className="italic text-slate-500">Unassigned</span>
              </button>
            </>
          )}
          {/* Footer utility link to Shift Management (canonical schedule surface).
              Lives below the checkbox list with its own divider. Uses wouter
              <Link> so route-level ProtectedRoute + URL-state still run normally. */}
          <div className="my-1.5 border-t border-slate-100" />
          <Link href="/shift-management">
            <a
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              data-testid="tech-filter-manage-team-link"
            >
              <Settings2 className="h-3 w-3" />
              <span className="flex-1">Manage schedules</span>
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </Link>
        </div>
      </MultiSelectDropdown>

      {/* Visit status multi-select */}
      <MultiSelectDropdown label="Visit Status" count={selectedStatuses.size} total={VISIT_STATUS_OPTIONS.length}>
        <div className="p-2">
          {VISIT_STATUS_OPTIONS.map(s => (
            <button key={s.value} onClick={() => onStatusToggle(s.value)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
              <div className={`flex h-4 w-4 items-center justify-center rounded border ${
                selectedStatuses.has(s.value) ? "border-primary bg-primary" : "border-slate-300"
              }`}>
                {selectedStatuses.has(s.value) && <Check className="h-3 w-3 text-white" />}
              </div>
              <span className={`h-2 w-2 rounded-full ${visitStatusDot(s.value)}`} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </MultiSelectDropdown>

      {/* Hide weekends toggle — Week view only */}
      {showHideWeekends && (
        <button
          onClick={onToggleHideWeekends}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            hideWeekends
              ? "border-primary bg-primary/5 text-primary"
              : "border-slate-200 text-muted-foreground hover:bg-slate-50"
          }`}
        >
          <div className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
            hideWeekends ? "border-primary bg-primary" : "border-slate-300"
          }`}>
            {hideWeekends && <Check className="h-2.5 w-2.5 text-white" />}
          </div>
          Hide Weekends
        </button>
      )}

      {/* 2026-03-31: Map toggle + unscheduled toggle — right-aligned in filter row */}
      <div className="ml-auto flex items-center gap-1.5">
        {showMap && onToggleUnscheduledOnMap && (
          <button
            onClick={onToggleUnscheduledOnMap}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showUnscheduledOnMap
                ? "border-primary bg-primary/5 text-primary"
                : "bg-white text-muted-foreground border-slate-200 hover:bg-slate-50"
            }`}
            title={showUnscheduledOnMap ? "Hide unscheduled jobs on map" : "Show unscheduled jobs on map"}
          >
            <div className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
              showUnscheduledOnMap ? "border-primary bg-primary" : "border-slate-300"
            }`}>
              {showUnscheduledOnMap && <Check className="h-2.5 w-2.5 text-white" />}
            </div>
            Unscheduled
          </button>
        )}
        {showMap && onToggleRoutes && (
          <button
            onClick={onToggleRoutes}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showRoutes
                ? "border-primary bg-primary/5 text-primary"
                : "bg-white text-muted-foreground border-slate-200 hover:bg-slate-50"
            }`}
            title={showRoutes ? "Hide route lines" : "Show route lines between stops"}
          >
            <Route className="h-3.5 w-3.5" />
            Routes
          </button>
        )}
        {onToggleMap && (
          <button
            onClick={onToggleMap}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showMap
                ? "bg-primary text-white border-primary"
                : "bg-white text-muted-foreground border-slate-200 hover:bg-slate-50"
            }`}
            title={showMap ? "Hide map panel" : "Show map panel"}
          >
            <MapPin className="h-3.5 w-3.5" />
            Map
          </button>
        )}
      </div>
    </div>
  );
}
