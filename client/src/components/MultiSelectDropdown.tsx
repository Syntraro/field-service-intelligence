/**
 * MultiSelectDropdown — compact filter-style dropdown shared by the dispatch
 * filter bar and the dashboard's Today's Operations card.
 *
 * Extracted from DispatchFiltersBar on 2026-04-21 so the dashboard workload
 * card can mirror the exact interaction pattern dispatchers already know
 * (mouse-outside closes, chevron rotates, content slot owns its own layout).
 *
 * The component is deliberately unopinionated about what goes inside — it's
 * a trigger + popover shell. Callers render their own checkbox lists, single-
 * select rows, or footer utility actions as children.
 *
 * Props:
 *   label     — trigger text (e.g. "Technicians", "All", "Open").
 *   count,total — optional. When BOTH are provided, render a badge showing
 *                 either "All" (when count===total) or the numeric count.
 *                 Omit both when the trigger text already carries the state
 *                 (e.g. dashboard view filter shows "All" or "Open" directly).
 *   align     — "left" (default) or "right"; controls popover alignment for
 *                 dropdowns pinned to the right of their parent.
 *   width     — Tailwind width class for the popover. Defaults to "w-56".
 */
import { useState, useRef, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

interface MultiSelectDropdownProps {
  label: string;
  children: ReactNode;
  count?: number;
  total?: number;
  align?: "left" | "right";
  width?: string;
  /** Optional testid for the trigger button. */
  testId?: string;
}

export function MultiSelectDropdown({
  label,
  children,
  count,
  total,
  align = "left",
  width = "w-56",
  testId,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Only render the badge when the caller opts in by supplying BOTH count
  // and total. Without this guard the dashboard trigger would be "All All",
  // because its state is already encoded in the label string.
  const showBadge = typeof count === "number" && typeof total === "number";
  const badge = showBadge
    ? count === total
      ? "All"
      : `${count}`
    : null;

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-xs"
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        {label}
        {badge !== null && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
            {badge}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <div
          className={`absolute top-full z-50 mt-1 ${width} rounded-md border bg-white shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
