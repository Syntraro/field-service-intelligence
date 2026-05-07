/**
 * ActivityFeedDrawer — global right-side slide-over for operational activity.
 *
 * Two views inside one Sheet:
 *   - "feed":      paginated list of canonical operational events.
 *   - "customize": per-user category toggles.
 *
 * Header chrome (both views) — exactly TWO controls on the right:
 *   feed view:      [gear]  [X]
 *   customize view: [back ←]  Customize Feed   [X]
 *
 * The shadcn Sheet primitive renders its own absolute-positioned X as
 * a direct child <button> of SheetContent. We suppress it via the
 * `[&>button]:hidden` selector below so we never render two close
 * affordances. Header buttons are nested inside <div>s so they don't
 * match that direct-child selector.
 */

import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Settings, X } from "lucide-react";
import { useActivityFeed } from "./useActivityFeed";
import { ActivityFeedItem } from "./ActivityFeedItem";
import { CustomizeActivityFeedView } from "./CustomizeActivityFeedView";

type DrawerView = "feed" | "customize";

interface ActivityFeedDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ActivityFeedDrawer({ open, onOpenChange }: ActivityFeedDrawerProps) {
  const [view, setView] = useState<DrawerView>("feed");

  // Fresh open lands on the feed view, never mid-customize.
  const handleOpenChange = (next: boolean) => {
    if (next) setView("feed");
    onOpenChange(next);
  };

  const { data, isLoading, isError, refetch } = useActivityFeed({
    enabled: open && view === "feed",
    limit: 50,
  });

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        // 2026-05-07 visual polish:
        //   • Narrowed to ~340px desktop (Jobber-style right rail) — full
        //     width on mobile via the default `w-full`.
        //   • `p-0` so each section owns its own padding.
        //   • `[&>button]:hidden` suppresses the SheetPrimitive built-in
        //     close X (a direct-child <button>); we render the only X in
        //     our header so there is exactly ONE close affordance.
        className="w-full sm:max-w-[340px] p-0 flex flex-col bg-card border-l border-border [&>button]:hidden"
        data-testid="activity-feed-drawer"
      >
        {view === "feed" ? (
          <div className="flex items-center justify-between gap-2 px-4 h-12 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-foreground truncate">Activity Feed</h2>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Customize feed"
                onClick={() => setView("customize")}
                className="h-7 w-7"
                data-testid="activity-feed-open-customize"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close activity feed"
                onClick={() => handleOpenChange(false)}
                className="h-7 w-7"
                data-testid="activity-feed-close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-2 h-12 border-b border-border shrink-0">
            <div className="flex items-center gap-1 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to feed"
                onClick={() => setView("feed")}
                className="h-7 w-7"
                data-testid="activity-feed-customize-back"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <h2 className="text-sm font-semibold text-foreground truncate">
                Customize Feed
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close activity feed"
              onClick={() => handleOpenChange(false)}
              className="h-7 w-7"
              data-testid="activity-feed-close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {view === "feed" ? (
          <div className="flex-1 overflow-y-auto" data-testid="activity-feed-list">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-xs">Loading…</span>
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center text-xs text-muted-foreground">
                <p className="text-destructive font-medium mb-2">Couldn't load activity</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  className="h-7 text-xs"
                  data-testid="activity-feed-retry"
                >
                  Try again
                </Button>
              </div>
            )}

            {!isLoading && !isError && data && data.items.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-12 px-6 text-center"
                data-testid="activity-feed-empty"
              >
                <p className="text-sm font-medium text-foreground">No matching activity yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Visits, payments, and quote responses will land here.
                </p>
              </div>
            )}

            {!isLoading && !isError && data && data.items.length > 0 && (
              <div className="divide-y divide-border/60">
                {data.items.map((item) => (
                  <ActivityFeedItem
                    key={item.id}
                    item={item}
                    onNavigate={() => handleOpenChange(false)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <CustomizeActivityFeedView />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
