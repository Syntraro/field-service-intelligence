/**
 * NotificationBell Component
 *
 * Bell icon with unread count badge and dropdown panel
 * for viewing and managing in-app notifications.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, Check, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface Notification {
  id: string;
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  status: "unread" | "read";
  dedupeKey: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  readAt: string | null;
  timeAgo: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

// ============================================================================
// Component
// ============================================================================

export default function NotificationBell() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  // Fetch notifications
  const { data, isLoading, refetch } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const response = await fetch("/api/notifications?limit=20", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return response.json();
    },
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 15000, // Consider data stale after 15 seconds
  });

  // Mark single notification as read
  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      return apiRequest(`/api/notifications/${notificationId}/read`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  // Mark all notifications as read
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications/read-all", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  // Handle notification click
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (notification.status === "unread") {
      markReadMutation.mutate(notification.id);
    }

    // Navigate to link if provided
    if (notification.linkUrl) {
      setLocation(notification.linkUrl);
      setOpen(false);
    }
  };

  // Get icon color based on notification type
  const getTypeColor = (type: string): string => {
    switch (type) {
      case "quote_approved":
      case "subscription_renewed":
        return "text-green-600";
      case "quote_declined":
      case "qbo_failure":
      case "long_running_entry":
      case "missing_clock_out":
        return "text-red-600";
      case "job_scheduled":
      case "job_rescheduled":
        return "text-blue-600";
      case "sla_breach":
      case "subscription_renewal_30":
      case "subscription_renewal_7":
        return "text-amber-600";
      case "unassigned_time":
      case "untracked_time":
        return "text-orange-600";
      default:
        return "text-muted-foreground";
    }
  };

  const unreadCount = data?.unreadCount || 0;
  const notifications = data?.notifications || [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 relative"
          data-testid="notification-bell"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1.5 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              {markAllReadMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification List */}
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bell className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No notifications</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                You're all caught up!
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                    notification.status === "unread" && "bg-muted/30"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 h-2 w-2 rounded-full shrink-0",
                        notification.status === "unread"
                          ? "bg-primary"
                          : "bg-transparent"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            "text-sm font-medium truncate",
                            getTypeColor(notification.type)
                          )}
                        >
                          {notification.title}
                        </p>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {notification.timeAgo}
                        </span>
                      </div>
                      {notification.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.body}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              setLocation("/notifications");
              setOpen(false);
            }}
          >
            {notifications.length > 0
              ? `View all notifications (${notifications.length})`
              : "View all notifications"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
