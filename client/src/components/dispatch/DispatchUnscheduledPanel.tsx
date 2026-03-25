/**
 * DispatchUnscheduledPanel — right panel showing visits waiting to be dispatched.
 * Cards are draggable sources for drag-and-drop scheduling.
 * Collapsible — collapses to a slim vertical tab to maximize timeline width.
 * Search and scroll state are preserved across collapse/expand cycles.
 */
import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, Inbox, PanelRightClose, PanelRightOpen } from "lucide-react";
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
};

export default function DispatchUnscheduledPanel({
  visits, savingIds, selectedVisitId, onSelectVisit,
}: Props) {
  const [search, setSearch] = useState("");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [collapsed, setCollapsed] = useState(false);

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

  // Collapsed slim tab — vertical label with count badge
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
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 leading-none">
              {visits.length}
            </span>
          )}
        </button>
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-widest"
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
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {visits.length}
            </span>
            <button
              onClick={toggleCollapse}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse panel"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search visits..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        {/* Job type filter chips */}
        <div className="flex flex-wrap gap-1 mt-2">
          {JOB_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setJobTypeFilter(opt.value)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                jobTypeFilter === opt.value
                  ? "bg-primary text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
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
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 text-slate-300" />
            <p className="text-xs">{search ? "No matching visits" : "All visits scheduled"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
