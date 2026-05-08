/**
 * Customize Feed — category-level toggles for the global Activity Feed.
 *
 * One toggle per CATEGORY (e.g. "Visit Updates"). The category mapping
 * lives in `shared/activityFeedRegistry.ts`; toggling a category writes
 * or clears every event_type it owns as a unit.
 *
 * Read projection
 * ---------------
 * If the saved set has ANY of a category's event_types, the category
 * reads as enabled. (Older partial sets normalize to "enabled" on read.)
 * Saves write the full event_type set for every enabled category.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_FEED_CATEGORIES,
  categoriesFromEventTypes,
  eventTypesFromCategories,
  type ActivityFeedCategory,
} from "@shared/activityFeedRegistry";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useActivityPreferences, useUpdateActivityPreferences } from "./useActivityFeed";
import { Loader2 } from "lucide-react";

export function CustomizeActivityFeedView() {
  const { data, isLoading, isError } = useActivityPreferences();
  const update = useUpdateActivityPreferences();

  // Local state mirrors the category projection of the server set.
  // Optimistic updates apply immediately; the mutation persists.
  const [local, setLocal] = useState<Record<ActivityFeedCategory, boolean>>(() => ({
    visit_updates: false,
    technician_updates: false,
    quote_updates: false,
    invoice_updates: false,
    payment_updates: false,
    notes: false,
  }));

  useEffect(() => {
    if (data?.enabledEventTypes) {
      setLocal(categoriesFromEventTypes(data.enabledEventTypes));
    }
  }, [data?.enabledEventTypes]);

  const ordered = useMemo(
    () => [...ACTIVITY_FEED_CATEGORIES].sort((a, b) => a.order - b.order),
    [],
  );

  const toggle = (key: ActivityFeedCategory, next: boolean) => {
    const nextState = { ...local, [key]: next };
    setLocal(nextState);
    // Project back to the canonical event_type list — normalized, in
    // canonical registry order. Server re-validates, but ordering keeps
    // the cached prefs response stable for the next render.
    update.mutate(eventTypesFromCategories(nextState));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading preferences…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-4 py-6 text-helper text-destructive">
        Failed to load preferences.
      </div>
    );
  }

  return (
    <div className="px-3 py-2" data-testid="activity-feed-customize-view">
      <p className="px-1 py-2 text-helper text-muted-foreground">
        Choose which kinds of activity show up in your feed. You can change this anytime.
      </p>
      <div className="rounded-md border border-border/60">
        {ordered.map((cat, idx) => {
          const id = `activity-category-${cat.key}`;
          const checked = !!local[cat.key];
          return (
            <div
              key={cat.key}
              className={
                "flex items-center justify-between gap-3 px-3 py-2.5 " +
                (idx < ordered.length - 1 ? "border-b border-border/60" : "")
              }
              data-testid={`activity-category-row-${cat.key}`}
            >
              <Label htmlFor={id} className="flex-1 cursor-pointer">
                <div className="text-row-emphasis text-foreground">{cat.label}</div>
                <div className="text-helper text-muted-foreground font-normal mt-0.5">
                  {cat.description}
                </div>
              </Label>
              <Switch
                id={id}
                checked={checked}
                onCheckedChange={(v) => toggle(cat.key, v)}
                data-testid={`activity-category-toggle-${cat.key}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
