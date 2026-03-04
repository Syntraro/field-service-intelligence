/**
 * ActivityStore — In-memory session activity feed.
 *
 * Stores the last MAX_ITEMS user actions for the dashboard Recent Activity panel.
 * First iteration: client-only, no backend persistence.
 * Each action is logged via logActivity() after successful mutations.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

// Activity entity types that map to detail pages
export type ActivityEntityType = "job" | "invoice" | "quote" | "client";

export interface ActivityItem {
  id: string;
  type: string;          // e.g. "created", "completed", "updated"
  entityType: ActivityEntityType;
  entityId: string;
  label: string;         // e.g. "Created Job #10045"
  meta?: string;         // e.g. "Acme HVAC — PM Visit"
  timestamp: number;     // Date.now()
}

const MAX_ITEMS = 20;

interface ActivityContextValue {
  activities: ActivityItem[];
  logActivity: (item: Omit<ActivityItem, "id" | "timestamp">) => void;
}

const ActivityContext = createContext<ActivityContextValue>({
  activities: [],
  logActivity: () => {},
});

let nextId = 1;

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  const logActivity = useCallback((item: Omit<ActivityItem, "id" | "timestamp">) => {
    const entry: ActivityItem = {
      ...item,
      id: `act-${nextId++}`,
      timestamp: Date.now(),
    };
    setActivities(prev => [entry, ...prev].slice(0, MAX_ITEMS));
  }, []);

  const value = useMemo(() => ({ activities, logActivity }), [activities, logActivity]);

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

/** Hook to read activities and log new ones */
export function useActivityStore() {
  return useContext(ActivityContext);
}
