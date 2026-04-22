/**
 * DashboardViewToggle — shared segmented switcher between the Operations
 * and Financial dashboards.
 *
 * 2026-04-21: Introduced to replace the two separate "jump to the other
 * dashboard" Buttons that previously sat in each page header. The active
 * segment reflects the current route; clicking the inactive segment
 * navigates. Purely presentational — no data fetching, no side effects.
 *
 * Visual: compact height (h-8), rounded-md, subtle border, neutral
 * inactive background, stronger background for the active segment.
 * Matches the Syntraro header utility rhythm (same h-8 as the outline
 * buttons it replaces).
 */

import { useLocation } from "wouter";

export type DashboardView = "operations" | "financial";

const VIEW_PATHS: Record<DashboardView, string> = {
  operations: "/",
  financial: "/financials",
};

interface DashboardViewToggleProps {
  /** Which segment should render as active. */
  active: DashboardView;
}

export function DashboardViewToggle({ active }: DashboardViewToggleProps) {
  const [, setLocation] = useLocation();

  const go = (view: DashboardView) => {
    if (view === active) return;
    setLocation(VIEW_PATHS[view]);
  };

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className="inline-flex h-8 items-center rounded-md border border-[#e2e8f0] bg-[#F4F8F4] p-0.5 text-xs dark:border-gray-700 dark:bg-gray-900"
      data-testid="dashboard-view-toggle"
    >
      <Segment
        label="Operations"
        isActive={active === "operations"}
        onClick={() => go("operations")}
        testId="dashboard-view-toggle-operations"
      />
      <Segment
        label="Financial"
        isActive={active === "financial"}
        onClick={() => go("financial")}
        testId="dashboard-view-toggle-financial"
      />
    </div>
  );
}

function Segment({
  label,
  isActive,
  onClick,
  testId,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex h-7 items-center rounded-[4px] px-3 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40 ${
        isActive
          ? "bg-white text-[#111827] shadow-sm dark:bg-gray-800 dark:text-gray-100"
          : "text-[#4b5563] hover:text-[#111827] dark:text-gray-400 dark:hover:text-gray-100"
      }`}
    >
      {label}
    </button>
  );
}
