/**
 * NotificationsPage
 *
 * Full-page notifications inbox with All/Unread tabs.
 * Allows managers to view and manage all in-app notifications.
 * Phase 7: Added snooze controls for time tracking alerts.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  CheckCheck,
  Loader2,
  Clock,
  AlertTriangle,
  ExternalLink,
  BellOff,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface ActiveSnooze {
  type: string;
  snoozeUntil: string;
  remainingHours: number;
}

// Time tracking notification types that can be snoozed
const TIME_ALERT_TYPES = [
  "unassigned_time",
  "untracked_time",
  "long_running_entry",
  "missing_clock_out",
  "weekly_time_digest",
];

// ============================================================================
// Helpers
// ============================================================================

function getTypeColor(type: string): string {
  switch (type) {
    case "quote_approved":
    case "subscription_renewed":
      return "text-green-600";
    case "quote_declined":
    case "qbo_failure":
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
    case "long_running_entry":
    case "missing_clock_out":
      return "text-red-600";
    case "weekly_time_digest":
      return "text-blue-600";
    default:
      return "text-muted-foreground";
  }
}

function getTypeBadge(type: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  switch (type) {
    case "quote_approved":
      return { label: "Quote Approved", variant: "default" };
    case "quote_declined":
      return { label: "Quote Declined", variant: "destructive" };
    case "job_scheduled":
      return { label: "Job Scheduled", variant: "secondary" };
    case "job_rescheduled":
      return { label: "Job Rescheduled", variant: "secondary" };
    case "sla_breach":
      return { label: "SLA Breach", variant: "destructive" };
    case "qbo_failure":
      return { label: "QBO Error", variant: "destructive" };
    case "subscription_renewal_30":
    case "subscription_renewal_7":
      return { label: "Renewal Notice", variant: "outline" };
    case "subscription_renewed":
      return { label: "Renewed", variant: "default" };
    case "subscription_reverted":
      return { label: "Billing Changed", variant: "outline" };
    case "subscription_cancelled":
      return { label: "Cancelled", variant: "destructive" };
    case "unassigned_time":
      return { label: "Unassigned Time", variant: "outline" };
    case "untracked_time":
      return { label: "Untracked Time", variant: "outline" };
    case "long_running_entry":
      return { label: "Long Entry", variant: "destructive" };
    case "missing_clock_out":
      return { label: "Missing Clock-Out", variant: "destructive" };
    case "weekly_time_digest":
      return { label: "Weekly Digest", variant: "secondary" };
    default:
      return { label: "System", variant: "secondary" };
  }
}

function getSnoozeDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// ============================================================================
// Components
// ============================================================================

function NotificationItem({
  notification,
  onMarkRead,
  onNavigate,
  onSnooze,
  isSnoozable,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onNavigate: (url: string) => void;
  onSnooze: (type: string, days: number) => void;
  isSnoozable: boolean;
}) {
  const typeBadge = getTypeBadge(notification.type);
  const isUnread = notification.status === "unread";

  const handleClick = () => {
    if (isUnread) {
      onMarkRead(notification.id);
    }
    if (notification.linkUrl) {
      onNavigate(notification.linkUrl);
    }
  };

  return (
    <div
      className={cn(
        "border rounded-md p-4 transition-colors",
        isUnread && "bg-muted/30 border-primary/20"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div
          className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer hover:opacity-80"
          onClick={handleClick}
        >
          <div
            className={cn(
              "mt-1.5 h-2 w-2 rounded-full shrink-0",
              isUnread ? "bg-primary" : "bg-transparent"
            )}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className={cn(
                  "font-medium",
                  getTypeColor(notification.type)
                )}
              >
                {notification.title}
              </h3>
              <Badge variant={typeBadge.variant} className="text-[11px] h-5">
                {typeBadge.label}
              </Badge>
            </div>

            {notification.body && (
              <p className="text-sm text-muted-foreground mt-1">
                {notification.body}
              </p>
            )}

            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {notification.timeAgo}
              </span>
              {notification.linkUrl && (
                <span className="flex items-center gap-1 text-primary">
                  <ExternalLink className="h-3 w-3" />
                  View details
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Snooze dropdown for time alerts */}
        {isSnoozable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onSnooze(notification.type, 1)}
                className="gap-2"
              >
                <BellOff className="h-4 w-4" />
                Snooze 1 day
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSnooze(notification.type, 3)}
                className="gap-2"
              >
                <BellOff className="h-4 w-4" />
                Snooze 3 days
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSnooze(notification.type, 7)}
                className="gap-2"
              >
                <BellOff className="h-4 w-4" />
                Snooze 1 week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function EmptyState({ isFiltered }: { isFiltered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Bell className="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 className="text-lg font-medium text-muted-foreground">
        {isFiltered ? "No unread notifications" : "No notifications yet"}
      </h3>
      <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
        {isFiltered
          ? "All caught up! Switch to 'All' to see your notification history."
          : "When you receive notifications, they'll appear here."}
      </p>
    </div>
  );
}

function ActiveSnoozesCard({ snoozes }: { snoozes: ActiveSnooze[] }) {
  if (snoozes.length === 0) return null;

  return (
    <Card className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-sm">
          <BellOff className="h-4 w-4 text-amber-600" />
          <span className="text-amber-800 dark:text-amber-200">
            Active snoozes:{" "}
            {snoozes.map((s, i) => (
              <span key={s.type}>
                {getTypeBadge(s.type).label} ({s.remainingHours}h)
                {i < snoozes.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<"all" | "unread">("unread");
  const { toast } = useToast();

  // Fetch notifications
  const { data, isLoading, isFetching } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications", { unreadOnly: activeTab === "unread" }],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: "50",
        ...(activeTab === "unread" && { unreadOnly: "true" }),
      });
      const response = await fetch(`/api/notifications?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return response.json();
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 15000,
  });

  // Fetch active snoozes
  const { data: snoozesData } = useQuery<{ snoozes: ActiveSnooze[] }>({
    queryKey: ["/api/time-alerts/snoozes"],
    queryFn: async () => {
      const response = await fetch("/api/time-alerts/snoozes", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch snoozes");
      return response.json();
    },
  });

  // Mark read mutation
  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      return apiRequest(`/api/notifications/${notificationId}/read`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to mark as read",
        description: error?.message || "Could not mark notification as read",
        variant: "destructive",
      });
    },
  });

  // Mark all read mutation
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications/read-all", {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to mark all as read",
        description: error?.message || "Could not mark all notifications as read",
        variant: "destructive",
      });
    },
  });

  // Snooze mutation
  const snoozeMutation = useMutation({
    mutationFn: async ({ type, days }: { type: string; days: number }) => {
      return apiRequest("/api/time-alerts/snooze", {
        method: "POST",
        body: JSON.stringify({
          type,
          snoozeUntil: getSnoozeDate(days),
        }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-alerts/snoozes"] });
      toast({
        title: "Notifications snoozed",
        description: `${getTypeBadge(variables.type).label} alerts snoozed for ${variables.days} day(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to snooze",
        description: error.message || "Could not snooze notifications",
        variant: "destructive",
      });
    },
  });

  const handleSnooze = (type: string, days: number) => {
    snoozeMutation.mutate({ type, days });
  };

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;
  const activeSnoozes = snoozesData?.snoozes || [];

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notifications
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {unreadCount} unread
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                View and manage your notifications
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                >
                  {markAllReadMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  Mark all as read
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Active snoozes banner */}
          <ActiveSnoozesCard snoozes={activeSnoozes} />

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "all" | "unread")}
          >
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="unread" className="gap-2">
                  Unread
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                      {unreadCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>

              {isFetching && !isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refreshing...
                </div>
              )}
            </div>

            <TabsContent value="all" className="mt-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length === 0 ? (
                <EmptyState isFiltered={false} />
              ) : (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={(id) => markReadMutation.mutate(id)}
                      onNavigate={setLocation}
                      onSnooze={handleSnooze}
                      isSnoozable={TIME_ALERT_TYPES.includes(notification.type)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="unread" className="mt-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length === 0 ? (
                <EmptyState isFiltered={true} />
              ) : (
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onMarkRead={(id) => markReadMutation.mutate(id)}
                      onNavigate={setLocation}
                      onSnooze={handleSnooze}
                      isSnoozable={TIME_ALERT_TYPES.includes(notification.type)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Time tracking alerts info box */}
          {activeTab === "unread" &&
            notifications.some((n) =>
              TIME_ALERT_TYPES.slice(0, 4).includes(n.type)
            ) && (
              <div className="mt-6 p-4 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800 dark:text-amber-200">
                      Time Tracking Alerts
                    </h4>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      You have time tracking issues that need attention. Use the menu
                      on each notification to snooze a specific alert type.
                    </p>
                  </div>
                </div>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
