/**
 * DispatchUnscheduledPanel — right rail showing visits waiting to be dispatched,
 * grouped into operational staging sections (Urgent / Today / On Hold / Less Urgent).
 *
 * Cards are draggable sources; bucket sections are droppable targets.
 * Dropping onto a section updates dispatchQueueBucket via the parent handleDragEnd.
 * Dropping onto the calendar schedules the visit exactly as before.
 *
 * Collapse state: panel open/collapsed persisted to localStorage.
 * Section collapse state: per-bucket, persisted to localStorage.
 */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Input } from "@/components/ui/input";
import { Search, Inbox, PanelRightClose, PanelRightOpen, Filter, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { RAIL_WIDTH_TRANSITION } from "@/components/detail-rail/DetailRightRail";
import type { DispatchVisit, DispatchQueueBucket } from "./dispatchPreviewTypes";
import { DISPATCH_QUEUE_BUCKET_VALUES, QUEUE_BUCKET_LABELS } from "./dispatchPreviewTypes";
import type { DispatchDropData } from "./dispatchDndTypes";
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

type UnscheduledPanelState = "open" | "collapsed";

const PANEL_STORAGE_KEY = "syntraro:dispatch-unscheduled-panel-state";
const SECTIONS_STORAGE_KEY = "syntraro:dispatch-queue-sections-collapsed";

type Props = {
  visits: DispatchVisit[];
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
};

// ── Droppable bucket section ──────────────────────────────────────────────────

type SectionProps = {
  bucket: DispatchQueueBucket;
  visits: DispatchVisit[];
  savingIds: Set<string>;
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: DispatchVisit) => void;
  collapsed: boolean;
  onToggleCollapse: (bucket: DispatchQueueBucket) => void;
};

function BucketSection({
  bucket, visits, savingIds, selectedVisitId, onSelectVisit, collapsed, onToggleCollapse,
}: SectionProps) {
  const dropData: DispatchDropData = { queueBucket: bucket };
  const { setNodeRef, isOver } = useDroppable({
    id: `queue-bucket-${bucket}`,
    data: dropData,
  });

  const label = QUEUE_BUCKET_LABELS[bucket];

  return (
    <div ref={setNodeRef} className={cn("rounded-md", isOver && "ring-2 ring-blue-400 ring-inset bg-blue-50/50")}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => onToggleCollapse(bucket)}
        className="flex w-full items-center gap-1.5 px-2 py-1 hover:bg-slate-100 rounded-t-md transition-colors"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        }
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex-1 text-left">{label}</span>
        {visits.length > 0 && (
          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 leading-none">
            {visits.length}
          </span>
        )}
      </button>

      {/* Cards — always mounted for droppable registration stability */}
      <div
        className={cn(
          "transition-all duration-200 overflow-hidden",
          collapsed ? "max-h-0 opacity-0 pointer-events-none" : "max-h-[2000px] opacity-100",
        )}
      >
        <div className="px-2 pb-2 space-y-1">
          {visits.length > 0 ? (
            visits.map(v => (
              <DispatchUnscheduledCard
                key={v.id}
                visit={v}
                isSaving={savingIds.has(v.id)}
                isSelected={selectedVisitId === v.id}
                onSelect={onSelectVisit}
              />
            ))
          ) : (
            <p className="py-1.5 text-center text-xs text-muted-foreground">Empty</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function DispatchUnscheduledPanel({
  visits, savingIds, selectedVisitId, onSelectVisit,
}: Props) {
  const [search, setSearch] = useState("");
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [panelState, setPanelState] = useState<UnscheduledPanelState>(() => {
    if (typeof window === "undefined") return "open";
    try {
      const saved = window.localStorage.getItem(PANEL_STORAGE_KEY);
      return saved === "collapsed" || saved === "open" ? saved : "open";
    } catch {
      return "open";
    }
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Per-section collapse state
  const [collapsedSections, setCollapsedSections] = useState<Set<DispatchQueueBucket>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = window.localStorage.getItem(SECTIONS_STORAGE_KEY);
      if (!saved) return new Set();
      const arr = JSON.parse(saved) as string[];
      return new Set(arr.filter((v): v is DispatchQueueBucket =>
        (DISPATCH_QUEUE_BUCKET_VALUES as readonly string[]).includes(v)
      ));
    } catch {
      return new Set();
    }
  });

  const collapsed = panelState === "collapsed";

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

  // Group filtered visits by bucket
  const byBucket = useMemo(() => {
    const map = new Map<DispatchQueueBucket, DispatchVisit[]>();
    for (const b of DISPATCH_QUEUE_BUCKET_VALUES) map.set(b, []);
    for (const v of filtered) {
      const bucket = v.dispatchQueueBucket;
      map.get(bucket)!.push(v);
    }
    return map;
  }, [filtered]);

  const toggleCollapse = useCallback(() => {
    setPanelState((current) => {
      const next = current === "collapsed" ? "open" : "collapsed";
      if (next === "collapsed") setFilterOpen(false);
      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, next);
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleSectionCollapse = useCallback((bucket: DispatchQueueBucket) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(bucket) ? next.delete(bucket) : next.add(bucket);
      try {
        window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    const all = new Set<DispatchQueueBucket>(DISPATCH_QUEUE_BUCKET_VALUES);
    setCollapsedSections(all);
    try {
      window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(Array.from(all)));
    } catch { /* ignore */ }
  }, []);

  return (
    // Single wrapper — both content areas stay mounted so draggable/droppable
    // registrations are never torn down.
    <div
      className={cn(
        "relative flex-shrink-0 h-full border-l bg-slate-50 overflow-hidden",
        RAIL_WIDTH_TRANSITION,
        collapsed ? "w-9" : "w-72"
      )}
    >
      {/* ── Collapsed affordance ─────────────────────────────────────── */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "absolute inset-0 flex flex-col items-center",
          "transition-opacity duration-300 motion-reduce:transition-none",
          collapsed ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <button
          onClick={toggleCollapse}
          className="flex flex-col items-center gap-1.5 py-3 px-1 hover:bg-slate-100 transition-colors w-full"
          title="Expand unscheduled panel"
          tabIndex={collapsed ? 0 : -1}
        >
          <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
          {visits.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-700 leading-none">
              {visits.length}
            </span>
          )}
        </button>
        <span
          className="text-xs font-medium text-muted-foreground uppercase tracking-widest"
          style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
        >
          Unscheduled
        </span>
      </div>

      {/* ── Open panel content ─────────────────────────────────────────── */}
      <div
        aria-hidden={collapsed}
        className={cn(
          "absolute inset-0 flex flex-col",
          "transition-opacity duration-300 motion-reduce:transition-none",
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        )}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b bg-white px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
              {visits.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 leading-none">
                  {visits.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={collapseAll}
                className="flex h-6 items-center rounded px-1.5 text-[10px] font-medium text-muted-foreground hover:bg-slate-100 hover:text-foreground transition-colors"
                title="Collapse all sections"
                tabIndex={collapsed ? -1 : 0}
              >
                Collapse all
              </button>
              <button
                onClick={toggleCollapse}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 text-muted-foreground hover:text-foreground transition-colors"
                title="Collapse panel"
                tabIndex={collapsed ? -1 : 0}
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search visits..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-7 text-sm"
                tabIndex={collapsed ? -1 : 0}
              />
            </div>
            {/* Filter button with dropdown */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setFilterOpen(f => !f)}
                className={`flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                  jobTypeFilter !== "all"
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title="Filter by job type"
                tabIndex={collapsed ? -1 : 0}
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

        {/* Bucket sections */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Inbox className="h-8 w-8 mb-2 text-slate-300" />
              <p className="text-sm">{search ? "No matching visits" : "All visits scheduled"}</p>
            </div>
          ) : (
            DISPATCH_QUEUE_BUCKET_VALUES.map(bucket => (
              <BucketSection
                key={bucket}
                bucket={bucket}
                visits={byBucket.get(bucket) ?? []}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                onSelectVisit={onSelectVisit}
                collapsed={collapsedSections.has(bucket)}
                onToggleCollapse={toggleSectionCollapse}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
