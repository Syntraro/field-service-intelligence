/**
 * useCalendarState - Calendar UI State Management + Persistence
 *
 * Handles:
 * - View mode (monthly/weekly/daily)
 * - Weekly view mode (time/technician)
 * - Sidebar collapsed state
 * - Search/filter state
 * - Hidden technician IDs
 * - Show full day toggle for business hours
 * - LocalStorage persistence
 *
 * NOTE: Density modes removed - always uses "expanded" for readability
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CalendarDensity } from "@/components/calendar/calendarUtils";

// ============================================================================
// Types
// ============================================================================

export type CalendarView = "monthly" | "weekly" | "daily";
export type WeeklyViewMode = "time" | "technician";
/** Day view layout: vertical tech columns (default) or horizontal tech rows */
export type DayLayout = "columns" | "rows";

export interface CalendarPreferences {
  view: CalendarView;
  weeklyViewMode: WeeklyViewMode;
  sidebarCollapsed: boolean;
  showFullDay: boolean;
  hiddenTechnicianIds: string[];
  /** Day view layout: vertical tech columns or horizontal tech rows (Polish Pass 2026-03-04) */
  dayLayout: DayLayout;
  /** @deprecated Tasks always shown on calendar — kept for localStorage compat */
  showTasks?: boolean;
  /** Sort technician lanes by risk level descending (Calendar Improvement 2026-03-05) */
  riskFirstSort?: boolean;
  /** Only show lanes with active alerts (Calendar Improvement 2026-03-05) */
  alertsOnly?: boolean;
}

const STORAGE_KEY = "calendar-preferences";

const DEFAULT_PREFERENCES: CalendarPreferences = {
  view: "weekly",
  weeklyViewMode: "technician", // Phase 4: tech-first is now the default layout
  sidebarCollapsed: false,
  showFullDay: false,
  hiddenTechnicianIds: [],
  dayLayout: "columns", // Default: vertical tech columns (Polish Pass 2026-03-04)
  showTasks: true, // Tasks always shown (Polish Pass 2026-03-04)
  riskFirstSort: false, // Calendar Improvement 2026-03-05
  alertsOnly: false, // Calendar Improvement 2026-03-05
};

// Business hours defaults
export const BUSINESS_HOURS = {
  start: 6,  // 6 AM
  end: 20,   // 8 PM
};

// ============================================================================
// LocalStorage Helpers
// ============================================================================

/** Valid view values for type safety */
const VALID_VIEWS: CalendarView[] = ["monthly", "weekly", "daily"];
const VALID_WEEKLY_MODES: WeeklyViewMode[] = ["time", "technician"];
const VALID_DAY_LAYOUTS: DayLayout[] = ["columns", "rows"];

/**
 * Validate and sanitize a view value from localStorage
 * Falls back to 'weekly' if invalid to prevent crashes
 */
function validateView(view: unknown): CalendarView {
  if (typeof view === 'string' && VALID_VIEWS.includes(view as CalendarView)) {
    return view as CalendarView;
  }
  if (process.env.NODE_ENV === 'development' && view !== undefined) {
    console.warn('[useCalendarState] Invalid view in localStorage, falling back to weekly:', view);
  }
  return 'weekly';
}

function validateWeeklyViewMode(mode: unknown): WeeklyViewMode {
  if (typeof mode === 'string' && VALID_WEEKLY_MODES.includes(mode as WeeklyViewMode)) {
    return mode as WeeklyViewMode;
  }
  return 'time';
}

function validateDayLayout(layout: unknown): DayLayout {
  if (typeof layout === 'string' && VALID_DAY_LAYOUTS.includes(layout as DayLayout)) {
    return layout as DayLayout;
  }
  return 'columns';
}

function loadPreferences(): CalendarPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    let parsed: any;
    try {
      parsed = JSON.parse(stored);
    } catch (parseError) {
      // Corrupted JSON - clear it and return defaults
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useCalendarState] Corrupted localStorage, resetting to defaults:', parseError);
      }
      localStorage.removeItem(STORAGE_KEY);
      return DEFAULT_PREFERENCES;
    }

    // Validate and sanitize all fields to prevent crashes
    return {
      view: validateView(parsed.view),
      weeklyViewMode: validateWeeklyViewMode(parsed.weeklyViewMode),
      sidebarCollapsed: typeof parsed.sidebarCollapsed === 'boolean' ? parsed.sidebarCollapsed : false,
      showFullDay: typeof parsed.showFullDay === 'boolean' ? parsed.showFullDay : false,
      // Ensure hiddenTechnicianIds is always an array
      hiddenTechnicianIds: Array.isArray(parsed.hiddenTechnicianIds)
        ? parsed.hiddenTechnicianIds.filter((id: unknown) => typeof id === 'string')
        : [],
      dayLayout: validateDayLayout(parsed.dayLayout),
      showTasks: true, // Tasks always shown — ignore persisted value
      riskFirstSort: typeof parsed.riskFirstSort === 'boolean' ? parsed.riskFirstSort : false,
      alertsOnly: typeof parsed.alertsOnly === 'boolean' ? parsed.alertsOnly : false,
    };
  } catch (error) {
    // Any other error - return defaults
    if (process.env.NODE_ENV === 'development') {
      console.warn('[useCalendarState] Error loading preferences, using defaults:', error);
    }
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(prefs: Partial<CalendarPreferences>): void {
  try {
    const current = loadPreferences();
    const updated = { ...current, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Silently fail - localStorage might be full or disabled
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useCalendarState() {
  // Load initial state from localStorage
  const [preferences, setPreferences] = useState<CalendarPreferences>(() => loadPreferences());

  // Navigation state (not persisted)
  const [currentDate, setCurrentDate] = useState(new Date());
  const [unscheduledSearch, setUnscheduledSearch] = useState("");
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const [expandedAllDaySlots, setExpandedAllDaySlots] = useState<Set<string>>(new Set());

  // Persist preferences changes to localStorage
  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // Preference setters
  const setView = useCallback((view: CalendarView) => {
    setPreferences(prev => ({ ...prev, view }));
  }, []);

  const setWeeklyViewMode = useCallback((weeklyViewMode: WeeklyViewMode) => {
    setPreferences(prev => ({ ...prev, weeklyViewMode }));
  }, []);

  // Density is fixed to "expanded" for readability - no setter needed
  const density: CalendarDensity = "expanded";

  const setSidebarCollapsed = useCallback((sidebarCollapsed: boolean) => {
    setPreferences(prev => ({ ...prev, sidebarCollapsed }));
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setPreferences(prev => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  const setShowFullDay = useCallback((showFullDay: boolean) => {
    setPreferences(prev => ({ ...prev, showFullDay }));
  }, []);

  const toggleShowFullDay = useCallback(() => {
    setPreferences(prev => ({ ...prev, showFullDay: !prev.showFullDay }));
  }, []);

  // Day layout toggle (Polish Pass 2026-03-04)
  const setDayLayout = useCallback((dayLayout: DayLayout) => {
    setPreferences(prev => ({ ...prev, dayLayout }));
  }, []);

  const toggleDayLayout = useCallback(() => {
    setPreferences(prev => ({
      ...prev,
      dayLayout: prev.dayLayout === 'columns' ? 'rows' : 'columns',
    }));
  }, []);

  // Risk-first sort + alerts-only filter (Calendar Improvement 2026-03-05)
  const toggleRiskFirstSort = useCallback(() => {
    setPreferences(prev => ({ ...prev, riskFirstSort: !prev.riskFirstSort }));
  }, []);

  const toggleAlertsOnly = useCallback(() => {
    setPreferences(prev => ({ ...prev, alertsOnly: !prev.alertsOnly }));
  }, []);

  // Technician visibility
  const hiddenTechnicianIds = useMemo(
    () => new Set(preferences.hiddenTechnicianIds),
    [preferences.hiddenTechnicianIds]
  );

  const toggleTechnicianVisibility = useCallback((techId: string) => {
    setPreferences(prev => {
      const current = new Set(prev.hiddenTechnicianIds);
      if (current.has(techId)) {
        current.delete(techId);
      } else {
        current.add(techId);
      }
      return { ...prev, hiddenTechnicianIds: Array.from(current) };
    });
  }, []);

  // Computed values
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  // Hours to render based on showFullDay
  const visibleHours = useMemo(() => {
    if (preferences.showFullDay) {
      // Full day: 0-23
      return Array.from({ length: 24 }, (_, i) => i);
    }
    // Business hours only: 6-19 (6 AM to 8 PM)
    return Array.from(
      { length: BUSINESS_HOURS.end - BUSINESS_HOURS.start },
      (_, i) => BUSINESS_HOURS.start + i
    );
  }, [preferences.showFullDay]);

  return {
    // View state
    view: preferences.view,
    setView,
    weeklyViewMode: preferences.weeklyViewMode,
    setWeeklyViewMode,

    // Density - fixed to "expanded" for readability
    density,

    // Sidebar
    sidebarCollapsed: preferences.sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebarCollapsed,

    // Business hours
    showFullDay: preferences.showFullDay,
    setShowFullDay,
    toggleShowFullDay,
    visibleHours,

    // Day layout (columns vs rows)
    dayLayout: preferences.dayLayout,
    setDayLayout,
    toggleDayLayout,

    // Risk-first sort + alerts-only filter (Calendar Improvement 2026-03-05)
    riskFirstSort: preferences.riskFirstSort ?? false,
    toggleRiskFirstSort,
    alertsOnly: preferences.alertsOnly ?? false,
    toggleAlertsOnly,

    // Technician visibility
    hiddenTechnicianIds,
    toggleTechnicianVisibility,

    // Navigation
    currentDate,
    setCurrentDate,
    year,
    month,

    // Search
    unscheduledSearch,
    setUnscheduledSearch,

    // Technician filter
    selectedTechnicianId,
    setSelectedTechnicianId,

    // All-day slots
    expandedAllDaySlots,
    setExpandedAllDaySlots,
  };
}
