/**
 * CalendarSyncSection — Phase 1 external calendar subscription UI.
 *
 * Mounted on the Team member detail page. Owner/admin/manager can:
 *   • Create (or view) the technician's private ICS feed URL
 *   • Copy it to clipboard
 *   • Regenerate the token (invalidates any currently-subscribed calendar)
 *   • Disable / re-enable the token
 *
 * The feed itself is read-only — see
 * server/services/technicianCalendarIcsService.ts. This component has no
 * knowledge of what goes into the ICS; it only manages the subscription
 * URL and explains how to use it.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Calendar, Copy, RefreshCcw, CheckCircle2, AlertTriangle } from "lucide-react";
// 2026-05-01 brand pivot — canonical brand strings.
import { BRAND } from "@shared/branding";

interface CalendarTokenResponse {
  token: string | null;
  isActive: boolean;
  feedUrl: string | null;
  lastAccessedAt: string | null;
  createdAt?: string;
  updatedAt?: string | null;
}

interface CalendarSyncSectionProps {
  userId: string;
  memberFirstName?: string | null;
}

export function CalendarSyncSection({ userId, memberFirstName }: CalendarSyncSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const queryKey = ["/api/team", userId, "calendar-token"] as const;
  const { data, isLoading } = useQuery<CalendarTokenResponse>({
    queryKey,
    queryFn: () => apiRequest(`/api/team/${userId}/calendar-token`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: () => apiRequest<CalendarTokenResponse>(
      `/api/team/${userId}/calendar-token`,
      { method: "POST" },
    ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Calendar link created", description: "Copy the URL below and subscribe in your calendar app." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rotateMutation = useMutation({
    mutationFn: () => apiRequest<CalendarTokenResponse>(
      `/api/team/${userId}/calendar-token/rotate`,
      { method: "POST" },
    ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Calendar link regenerated", description: "The old URL is now invalid. Share the new URL with the technician." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const disableMutation = useMutation({
    mutationFn: () => apiRequest<CalendarTokenResponse>(
      `/api/team/${userId}/calendar-token/disable`,
      { method: "POST" },
    ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Calendar link disabled" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const enableMutation = useMutation({
    mutationFn: () => apiRequest<CalendarTokenResponse>(
      `/api/team/${userId}/calendar-token/enable`,
      { method: "POST" },
    ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Calendar link enabled" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const feedUrl = data?.feedUrl ?? null;
  const hasToken = Boolean(data?.token);
  const isActive = Boolean(data?.isActive);

  const copy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Copy the URL manually.", variant: "destructive" });
    }
  };

  const busy =
    isLoading ||
    createMutation.isPending ||
    rotateMutation.isPending ||
    disableMutation.isPending ||
    enableMutation.isPending;

  const firstName = memberFirstName?.trim() || "this technician";

  return (
    <Card data-testid="calendar-sync-section">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-md bg-[#F0F5F0] shrink-0">
            <Calendar className="h-4 w-4 text-[#76B054]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[#111827]">Calendar Sync</h3>
              {hasToken && (
                <Badge variant={isActive ? "default" : "secondary"} className="text-[10px]">
                  {isActive ? "Active" : "Disabled"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-[#4b5563] mt-0.5">
              Give {firstName} a read-only subscription URL so their assigned visits show up in
              Google Calendar, Apple Calendar, or Outlook. Changes always happen in {BRAND.product} —
              external calendars can't write back.
            </p>
          </div>
        </div>

        {!hasToken && !isLoading && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-dashed border-[#e2e8f0]">
            <p className="text-xs text-[#4b5563]">No calendar link yet.</p>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={busy}
              data-testid="calendar-sync-create"
            >
              Create link
            </Button>
          </div>
        )}

        {hasToken && isActive && feedUrl && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={feedUrl}
                className="h-8 text-xs font-mono"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="calendar-sync-feed-url"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copy}
                disabled={busy}
                data-testid="calendar-sync-copy"
              >
                {copied ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" />Copied</>
                ) : (
                  <><Copy className="h-3.5 w-3.5 mr-1" />Copy</>
                )}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => rotateMutation.mutate()}
                disabled={busy}
                data-testid="calendar-sync-rotate"
              >
                <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => disableMutation.mutate()}
                disabled={busy}
                data-testid="calendar-sync-disable"
              >
                Disable link
              </Button>
            </div>
          </div>
        )}

        {hasToken && !isActive && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-md border border-amber-200 bg-amber-50/50">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">
                Calendar link is disabled. Any external calendar subscribed to the previous URL
                will stop receiving updates.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => enableMutation.mutate()}
                disabled={busy}
                data-testid="calendar-sync-enable"
              >
                Re-enable
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => rotateMutation.mutate()}
                disabled={busy}
                data-testid="calendar-sync-rotate-from-disabled"
              >
                <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
            </div>
          </div>
        )}

        {hasToken && isActive && feedUrl && (
          <details className="text-xs text-[#4b5563]">
            <summary className="cursor-pointer font-medium text-[#111827]">
              How to subscribe
            </summary>
            <div className="pt-2 space-y-1.5 leading-relaxed">
              <p>
                <span className="font-semibold text-[#111827]">Google Calendar</span> →
                Settings → Add calendar → From URL → paste the link above.
              </p>
              <p>
                <span className="font-semibold text-[#111827]">Apple Calendar</span> (iPhone
                or Mac) → File → New Calendar Subscription → paste the link.
              </p>
              <p>
                <span className="font-semibold text-[#111827]">Outlook</span> → Add calendar →
                Subscribe from web → paste the link.
              </p>
              <p className="italic">
                This is a read-only subscription. Visit changes still need to be made in
                {" "}{BRAND.product} — external calendars won't sync edits back.
              </p>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
