/**
 * ActivityFeedDrawer — Right-side Sheet showing recent activity feed.
 *
 * Replaces the always-visible RecentActivityWidget on Dashboard (2026-03-05).
 * Triggered from AppHeader via a feed icon button.
 * Reuses the same /api/activity endpoint.
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Briefcase, Calendar, DollarSign, FileText, Loader2, Activity } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Server event shape from GET /api/activity */
interface ServerEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  summary: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

const ENTITY_ICONS: Record<string, typeof Briefcase> = {
  job: Briefcase,
  invoice: DollarSign,
  quote: FileText,
  client: Calendar,
};

function entityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "job": return `/jobs/${entityId}`;
    case "invoice": return `/invoices/${entityId}`;
    case "quote": return `/quotes/${entityId}`;
    case "client": return `/clients/${entityId}`;
    default: return null;
  }
}

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface ActivityFeedDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ActivityFeedDrawer({ open, onOpenChange }: ActivityFeedDrawerProps) {
  const [, setLocation] = useLocation();

  const { data: activityData, isLoading } = useQuery<{ items: ServerEvent[] }>({
    queryKey: ["activity", "feed"],
    queryFn: () => apiRequest(`/api/activity?limit=30`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: open,
  });
  const events = activityData?.items || [];

  const handleClick = (item: ServerEvent) => {
    const path = entityPath(item.entityType, item.entityId);
    if (path) {
      setLocation(path);
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-60px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No recent activity</p>
            </div>
          ) : (
            <div>
              {events.map((item, index) => {
                const Icon = ENTITY_ICONS[item.entityType] || Briefcase;
                const path = entityPath(item.entityType, item.entityId);
                const isLast = index === events.length - 1;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleClick(item)}
                    disabled={!path}
                    className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors flex items-start gap-3 ${!isLast ? "border-b border-gray-200 dark:border-gray-800" : ""}`}
                  >
                    <div className="mt-0.5 p-1 rounded bg-primary/10 flex-shrink-0">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.summary}</p>
                      {item.meta?.clientName ? (
                        <p className="text-xs text-muted-foreground truncate">{String(item.meta.clientName)}</p>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
