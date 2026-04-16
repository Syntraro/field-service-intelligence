/**
 * DispatchUnscheduledPanel — right panel showing visits waiting to be dispatched.
 * Cards are draggable sources for drag-and-drop scheduling.
 * Collapsible — collapses to a slim vertical tab to maximize timeline width.
 * Search and scroll state are preserved across collapse/expand cycles.
 *
 * 2026-03-30: Optional selection mode props for DAY-VIEW-ONLY Focus workflow.
 * Selection (selectedVisitIdsForFocus) is separate from Focus (focusedVisitIds).
 * "Add to Focus" commits selection into focus. All props optional for week view safety.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Inbox, PanelRightClose, PanelRightOpen, CheckSquare, X, Plus, Filter } from "lucide-react";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import DispatchUnscheduledCard from "./DispatchUnscheduledCard";

/** Known job type values for filtering */
const JOB_TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "maintenance", label: "PM" },
  { value: "repair", label: "Repair" },
  { value: "service", label: "Service" },
  { value: "install", label: "Install" },
  { value: "inspection", label: "Inspection" },
] as const;

type Props = {
  visits: DispatchVisit[];
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
  /** DAY-VIEW-ONLY: selection/focus props — all optional, defaults preserve current behavior */
  isSelectionMode?: boolean;
  selectedVisitIdsForFocus?: Set<string>;
  focusedVisitIds?: Set<string>;
  onToggleSelectionMode?: () => void;
  onExitSelectionMode?: () => void;
  onToggleSelectVisit?: (visitId: string) => void;
  onClearSelection?: () => void;
  onAddToFocus?: () => void;
};

export default function DispatchUnscheduledPanel({
  visits, savingIds, selectedVisitId, onSelectVisit,
  isSelectionMode, selectedVisitIdsForFocus, focusedVisitIds,
  onToggleSelectionMode, onExitSelectionMode,
  onToggleSelectVisit, onClearSelection, onAddToFocus,
}: Props) {
  const [search, setSearch] = useState("");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  // Filter by search and job type
  const filtered = useMemo(() => {
    let result = visits;
    if (jobTypeFilter !== "all") {
      result = result.filter(v => (v.jobType ?? "").toLowerCase() === jobTypeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(v =>
        v.summary.toLowerCase().includes(q) ||
        v.locationName.toLowerCase().includes(q) ||
        String(v.jobNumber).includes(q)
      );
    }
    return result;
  }, [visits, search, jobTypeFilter]);

  const toggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  // Selection mode helpers
  const selectionEnabled = !!onToggleSelectionMode;
  const selectionCount = selectedVisitIdsForFocus?.size ?? 0;

  // Select all filtered items
  const handleSelectAllFiltered = useCallback(() => {
    if (!onToggleSelectVisit) return;
    const allSelected = filtered.every(v => selectedVisitIdsForFocus?.has(v.id));
    for (const v of filtered) {
      if (allSelected) {
        if (selectedVisitIdsForFocus?.has(v.id)) onToggleSelectVisit(v.id);
      } else {
        if (!selectedVisitIdsForFocus?.has(v.id)) onToggleSelectVisit(v.id);
      }
    }
  }, [filtered, selectedVisitIdsForFocus, onToggleSelectVisit]);

  // Collapsed slim tab
  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-shrink-0 flex-col items-center border-l bg-slate-50">
        <button
          onClick={toggleCollapse}
          className="flex flex-col items-center gap-1.5 py-3 px-1 hover:bg-slate-100 transition-colors w-full"
          title="Expand unscheduled panel"
        >
          <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
          {visits.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-700 leading-none">
              {visits.length}
            </span>
          )}
        </button>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest"
          style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}>
          Unscheduled
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-72 flex-shrink-0 flex-col border-l bg-slate-50">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
          <div className="flex items-center gap-1.5">
            {selectionEnabled && !isSelectionMode && (
              <button
                onClick={onToggleSelectionMode}
                className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                title="Enter focus selection mode"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Focus
              </button>
            )}
            <button
              onClick={toggleCollapse}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse panel"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Selection mode header — "Focus mode" controls */}
        {isSelectionMode && (
          <div className="mt-2 py-2 px-2.5 rounded-md bg-blue-50 border border-blue-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-800">
                {selectionCount > 0 ? `${selectionCount} selected` : "Select items to focus"}
              </span>
              <div className="flex items-center gap-1.5">
                {filtered.length > 0 && (
                  <button
                    onClick={handleSelectAllFiltered}
                    className="text-xs text-blue-600 hover:text-blue-800 px-1 font-medium"
                  >
                    {filtered.every(v => selectedVisitIdsForFocus?.has(v.id)) ? "Deselect all" : "Select all"}
                  </button>
                )}
                {selectionCount > 0 && (
                  <button
                    onClick={onClearSelection}
                    className="text-xs text-slate-500 hover:text-slate-700 px-1 font-medium"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={onExitSelectionMode}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-blue-100 text-blue-600 transition-colors"
                  title="Exit focus mode"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {/* Add to Focus button — only when items are selected */}
            {selectionCount > 0 && onAddToFocus && (
              <button
                onClick={onAddToFocus}
                className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-1.5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add to Focus
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search visits..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-7 text-sm"
            />
          </div>
          {/* Single Filter button with dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(f => !f)}
              className={`flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                jobTypeFilter !== "all"
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              title="Filter by job type"
            >
              <Filter className="h-3.5 w-3.5" />
              {jobTypeFilter !== "all"
                ? JOB_TYPE_OPTIONS.find(o => o.value === jobTypeFilter)?.label
                : "Filter"}
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-md border bg-white shadow-lg py-1 min-w-[120px]">
                {JOB_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setJobTypeFilter(opt.value); setFilterOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      jobTypeFilter === opt.value
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length > 0 ? (
          filtered.map(v => (
            <DispatchUnscheduledCard
              key={v.id}
              visit={v}
              isSaving={savingIds.has(v.id)}
              isSelected={selectedVisitId === v.id}
              onSelect={onSelectVisit}
              isSelectionMode={isSelectionMode}
              isChecked={selectedVisitIdsForFocus?.has(v.id) ?? false}
              isFocused={focusedVisitIds?.has(v.id) ?? false}
              onToggleSelect={onToggleSelectVisit}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 text-slate-300" />
            <p className="text-sm">{search ? "No matching visits" : "All visits scheduled"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
