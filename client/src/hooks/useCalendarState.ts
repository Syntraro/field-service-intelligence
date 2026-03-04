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

export interface CalendarPreferences {
  view: CalendarView;
  weeklyViewMode: WeeklyViewMode;
  sidebarCollapsed: boolean;
  showFullDay: boolean;
  hiddenTechnicianIds: string[];
  /** Whether to show tasks on the calendar (Phase 4 of calendar rewrite) */
  showTasks: boolean;
}

const STORAGE_KEY = "calendar-preferences";

const DEFAULT_PREFERENCES: CalendarPreferences = {
  view: "weekly",
  weeklyViewMode: "technician", // Phase 4: tech-first is now the default layout
  sidebarCollapsed: false,
  showFullDay: false,
  hiddenTechnicianIds: [],
  showTasks: false,
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
      showTasks: typeof parsed.showTasks === 'boolean' ? parsed.showTasks : false,
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

  // Phase 4: Show tasks on calendar toggle
  const toggleShowTasks = useCallback(() => {
    setPreferences(prev => ({ ...prev, showTasks: !prev.showTasks }));
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

    // Tasks on calendar
    showTasks: preferences.showTasks,
    toggleShowTasks,

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
