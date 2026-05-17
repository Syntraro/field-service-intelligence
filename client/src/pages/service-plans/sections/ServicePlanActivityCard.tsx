import { formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  eventType: string;
  severity: "info" | "warning" | "important";
  summary: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityFeedResult {
  items: ActivityEvent[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ── ServicePlanActivityCard ───────────────────────────────────────────────────

interface ServicePlanActivityCardProps {
  plan: RecurringPlanDetail | undefined;
  loading: boolean;
}

export function ServicePlanActivityCard({ plan, loading }: ServicePlanActivityCardProps) {
  const { data, isLoading: activityLoading } = useQuery<ActivityFeedResult>({
    queryKey: ["/api/activity/other", plan?.id],
    queryFn: async () => {
      const res = await fetch(`/api/activity/other/${plan!.id}?limit=10`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    enabled: !!plan?.id,
    staleTime: 15_000,
    refetchIntervalInBackground: false,
  });

  const events = data?.items ?? [];
  const cardLoading = loading || activityLoading;

  return (
    <WorkspaceSectionCard
      title="Recent Activity"
      loading={cardLoading}
      empty={!plan && !loading}
      emptyText="No plan selected."
      collapsible
      data-testid="service-plan-activity-card"
    >
      {plan && (
        events.length === 0 ? (
          <p className="text-helper text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="rounded-md border border-border bg-inset-surface overflow-hidden">
            {events.map((event, i) => (
              <div
                key={event.id}
                className={`px-3 py-2${i < events.length - 1 ? " border-b border-border" : ""}`}
              >
                <p className="text-helper text-foreground leading-snug">{event.summary}</p>
                <p className="text-helper text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </WorkspaceSectionCard>
  );
}
