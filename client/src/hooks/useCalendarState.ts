/**
 * useCalendarState - Calendar UI State Management + Persistence
 *
 * Handles:
 * - View mode (monthly/weekly/daily)
 * - Weekly view mode (time/technician)
 * - Density setting
 * - Sidebar collapsed state
 * - Search/filter state
 * - Hidden technician IDs
 * - Show full day toggle for business hours
 * - LocalStorage persistence
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
  density: CalendarDensity;
  sidebarCollapsed: boolean;
  showFullDay: boolean;
  hiddenTechnicianIds: string[];
}

const STORAGE_KEY = "calendar-preferences";

const DEFAULT_PREFERENCES: CalendarPreferences = {
  view: "weekly",
  weeklyViewMode: "time",
  density: "comfortable",
  sidebarCollapsed: false,
  showFullDay: false,
  hiddenTechnicianIds: [],
};

// Business hours defaults
export const BUSINESS_HOURS = {
  start: 6,  // 6 AM
  end: 20,   // 8 PM
};

// ============================================================================
// LocalStorage Helpers
// ============================================================================

function loadPreferences(): CalendarPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(stored);
    // Merge with defaults to handle missing keys from older versions
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      // Ensure hiddenTechnicianIds is always an array
      hiddenTechnicianIds: Array.isArray(parsed.hiddenTechnicianIds)
        ? parsed.hiddenTechnicianIds
        : [],
    };
  } catch {
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

  const setDensity = useCallback((density: CalendarDensity) => {
    setPreferences(prev => ({ ...prev, density }));
  }, []);

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

    // Density
    density: preferences.density,
    setDensity,

    // Sidebar
    sidebarCollapsed: preferences.sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebarCollapsed,

    // Business hours
    showFullDay: preferences.showFullDay,
    setShowFullDay,
    toggleShowFullDay,
    visibleHours,

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
