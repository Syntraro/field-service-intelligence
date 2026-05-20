/**
 * MidnightRolloverBanner (2026-04-16).
 *
 * One-shot in-app notice shown inside the tech PWA when the midnight
 * rollover worker has auto-paused one or more of the signed-in tech's
 * time entries. Includes a **Resume Work** CTA that deep-links to the
 * most-recent linked visit (or job fallback) so the tech can start a
 * new timer in one tap.
 *
 * Reads from the canonical `/api/notifications` endpoint, filters to
 * `type === "time_entry_auto_paused"`, and dismisses via the existing
 * `POST /api/notifications/:id/read` endpoint so the banner does not
 * re-appear on the next render.
 *
 * One banner covers N auto-paused entries — the worker inserts one
 * notification per entry but from the tech's perspective they are all
 * the same event ("your timer was paused at midnight"), so we collapse
 * them into a single banner and mark all of them read on dismiss.
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Clock, Play, X } from "lucide-react";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  status: "read" | "unread";
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

/** Query key shared with the office Notifications page so dismiss
 *  mutations invalidate both surfaces without divergence. */
const NOTIFICATIONS_KEY = ["/api/notifications", { unreadOnly: true }] as const;

export function MidnightRolloverBanner() {
  const [, setLocation] = useLocation();
  const { data } = useQuery<{ notifications: NotificationRow[] }>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => {
      const res = await fetch(`/api/notifications?unreadOnly=true`, {
        credentials: "include",
      });
      if (!res.ok) return { notifications: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  const rolloverRows = useMemo(
    () =>
      (data?.notifications ?? []).filter(
        (n) => n.type === "time_entry_auto_paused" && n.status === "unread",
      ),
    [data],
  );

  // Deep-link target: best resume destination from the most recent
  // notification. Visit detail is preferred (tech can start a new
  // timer directly); job fallback is next; /tech/today is last.
  const resumeTarget = useMemo(() => {
    if (rolloverRows.length === 0) return null;
    const newest = rolloverRows[0];
    if (newest.relatedEntityType === "job_visit" && newest.relatedEntityId) {
      return `/tech/visit/${newest.relatedEntityId}`;
    }
    if (newest.linkUrl) return newest.linkUrl;
    return "/tech/today";
  }, [rolloverRows]);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        rolloverRows.map((n) =>
          apiRequest(`/api/notifications/${n.id}/read`, { method: "POST" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  if (rolloverRows.length === 0) return null;

  const handleResume = () => {
    dismissMutation.mutate();
    if (resumeTarget) setLocation(resumeTarget);
  };

  return (
    <div
      className="mx-3 mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900"
      data-testid="midnight-rollover-banner"
      role="status"
    >
      <div className="flex items-start gap-2">
        <Clock className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-snug">
            Timer paused at midnight
          </div>
          <div className="text-xs text-amber-800 mt-0.5">
            Your timer was paused at midnight. Resume to continue today.
          </div>
          {/* One-tap resume deep-link */}
          <button
            type="button"
            onClick={handleResume}
            disabled={dismissMutation.isPending}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 bg-amber-200/60 hover:bg-amber-200 active:bg-amber-300 px-2.5 py-1 rounded-md transition-colors"
            data-testid="midnight-rollover-resume"
          >
            <Play className="h-3 w-3" />
            Resume Work
          </button>
        </div>
        <button
          type="button"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
          className="shrink-0 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-amber-700 hover:text-amber-950 hover:bg-amber-100 disabled:opacity-60"
          aria-label="Dismiss"
          title="Dismiss"
          data-testid="midnight-rollover-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
