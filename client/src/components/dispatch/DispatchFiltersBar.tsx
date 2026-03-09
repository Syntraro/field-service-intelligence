/**
 * DispatchFiltersBar — shared filter bar for Day and Week views.
 * Multi-select tech filter + visit status filter + hide weekends (Week only).
 */
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Check } from "lucide-react";
import type { Technician, VisitStatus } from "./dispatchPreviewTypes";
import { VISIT_STATUS_OPTIONS } from "./dispatchPreviewTypes";
import { visitStatusDot } from "./dispatchPreviewUtils";

type Props = {
  technicians: Technician[];
  selectedTechIds: Set<string>;
  onTechToggle: (id: string) => void;
  onTechSelectAll: () => void;
  onTechClearAll: () => void;
  selectedStatuses: Set<VisitStatus>;
  onStatusToggle: (s: VisitStatus) => void;
  /** Week view only: hide weekends toggle */
  showHideWeekends?: boolean;
  hideWeekends?: boolean;
  onToggleHideWeekends?: () => void;
};

function MultiSelectDropdown({
  label, children, count, total,
}: {
  label: string;
  children: React.ReactNode;
  count: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const badge = count === total ? "All" : `${count}`;

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(o => !o)}>
        {label}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{badge}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border bg-white shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

export default function DispatchFiltersBar({
  technicians, selectedTechIds, onTechToggle, onTechSelectAll, onTechClearAll,
  selectedStatuses, onStatusToggle,
  showHideWeekends, hideWeekends, onToggleHideWeekends,
}: Props) {
  return (
    <div className="flex items-center gap-2 border-b bg-slate-50 px-5 py-2">
      {/* Technician multi-select */}
      <MultiSelectDropdown label="Technicians" count={selectedTechIds.size} total={technicians.length}>
        <div className="p-2">
          <div className="mb-2 flex gap-1">
            <button onClick={onTechSelectAll} className="text-[11px] text-primary hover:underline">Select All</button>
            <span className="text-[11px] text-muted-foreground">|</span>
            <button onClick={onTechClearAll} className="text-[11px] text-primary hover:underline">Clear All</button>
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
    </div>
  );
}
