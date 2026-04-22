/**
 * Tech app — "Me" page (2026-04-21 Phase 2, v1)
 *
 * Thin self-service surface for the currently authenticated user. v1 hosts
 * only the Notifications section: four category toggles + a push-device
 * status block. Other sections (profile, password, theme) can be added
 * later without redesigning this page.
 *
 * Architecture rules honored:
 *   - No business logic in the component. All eligibility rules live in
 *     the backend service layer (emitVisitAssignmentChange).
 *   - Reads from the canonical backend route; writes via the canonical
 *     PATCH route. No local pretend-persistence.
 *   - Push device status is read-only info sourced from the existing
 *     `usePushRegistration` hook — keeps preference-vs-device separation
 *     clean (preferences are user-level policy; targets are per-device).
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, BellOff, Loader2, Laptop, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { MobileShell } from "../components/MobileShell";
import { apiRequest } from "@/lib/queryClient";
import { usePushRegistration } from "../hooks/usePushRegistration";

// ---------------------------------------------------------------------------
// Types — mirror server ResolvedPreferences
// ---------------------------------------------------------------------------

interface NotificationPreferences {
  visitAssignmentsEnabled: boolean;
  visitScheduleChangesEnabled: boolean;
  visitCancellationsEnabled: boolean;
  visitRemindersEnabled: boolean;
}

const PREFS_QUERY_KEY = ["tech", "me", "notification-preferences"] as const;

// ---------------------------------------------------------------------------
// Devices types + UA-label helper
// ---------------------------------------------------------------------------

interface NotificationDevice {
  id: string;
  platform: string;
  channel: string;
  provider: string;
  userAgent: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

const DEVICES_QUERY_KEY = ["tech", "me", "notification-devices"] as const;

/**
 * Derive a human-readable device label from a user-agent string. Deliberately
 * naive — full UA parsing is a rabbit hole and we only need enough signal to
 * let a user tell their devices apart (e.g. "Chrome on Windows" vs "iPhone").
 * Falls back to a generic channel-based label when the UA is missing.
 */
function describeDevice(device: NotificationDevice): { label: string; icon: "laptop" | "phone" | "tablet" } {
  const ua = (device.userAgent ?? "").trim();

  // Phone/tablet signals first — iOS / Android come through with distinctive
  // tokens and the user usually thinks of them by form factor, not browser.
  if (/iPhone/i.test(ua)) {
    // Standalone PWA installs on iOS carry Safari but lack the standard UA
    // version signature — best effort label.
    if (/AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return { label: "iPhone PWA", icon: "phone" };
    return { label: "iPhone Safari", icon: "phone" };
  }
  if (/iPad/i.test(ua)) return { label: "iPad", icon: "tablet" };
  if (/Android/i.test(ua)) {
    if (/Chrome\//i.test(ua)) return { label: "Android Chrome", icon: "phone" };
    if (/Firefox\//i.test(ua)) return { label: "Android Firefox", icon: "phone" };
    return { label: "Android", icon: "phone" };
  }

  // Desktop. Browser × OS pair.
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /OPR\//i.test(ua) ? "Opera"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Safari\//i.test(ua) ? "Safari"
    : null;
  const os = /Windows/i.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : /CrOS/i.test(ua) ? "ChromeOS"
    : null;

  if (browser && os) return { label: `${browser} on ${os}`, icon: "laptop" };
  if (browser) return { label: browser, icon: "laptop" };
  if (os) return { label: os, icon: "laptop" };

  // Final fallback — use channel/platform so the user still has SOMETHING
  // to distinguish the row by.
  return {
    label: device.channel === "web_push" ? "Web browser" : device.platform || "Unknown device",
    icon: device.platform === "ios" || device.platform === "android" ? "phone" : "laptop",
  };
}

function formatLastActive(iso: string | null): string {
  if (!iso) return "Never used";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "Never used";
  const diffMs = Date.now() - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Toggle row — single responsibility, no business logic
// ---------------------------------------------------------------------------

function ToggleRow({ label, description, checked, onChange, disabled, testId }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onChange(!checked); }}
      disabled={disabled}
      className="w-full flex items-start gap-3 px-3 py-3 text-left active:bg-slate-50 disabled:opacity-60 border-b border-slate-100 last:border-b-0"
      data-testid={testId}
      aria-pressed={checked}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-[12px] text-slate-500 mt-0.5">{description}</div>
      </div>
      <div
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5 ${
          checked ? "bg-[#22c55e]" : "bg-slate-300"
        }`}
      >
        <div
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Devices section — list + self-revoke
// ---------------------------------------------------------------------------

function DeviceIcon({ kind }: { kind: "laptop" | "phone" | "tablet" }) {
  if (kind === "phone") return <Smartphone className="h-4 w-4 text-slate-500 shrink-0" />;
  if (kind === "tablet") return <Tablet className="h-4 w-4 text-slate-500 shrink-0" />;
  return <Laptop className="h-4 w-4 text-slate-500 shrink-0" />;
}

function DevicesSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<NotificationDevice[]>({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: () => apiRequest<NotificationDevice[]>("/api/tech/me/notification-devices"),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/tech/me/notification-devices/${id}`, { method: "DELETE" }),
    onSuccess: (_res, id) => {
      // Optimistic local filter + server-truth refetch. Keeps the row
      // out of the list immediately and protects against stale cache
      // if the mutation succeeded but the query is slow to refetch.
      queryClient.setQueryData<NotificationDevice[] | undefined>(
        DEVICES_QUERY_KEY,
        (prev) => prev?.filter((d) => d.id !== id),
      );
      queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
    },
  });

  return (
    <div className="mt-6">
      <div className="px-3 pb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Devices
        </h2>
        {removeMutation.isPending && (
          <Loader2 className="h-3 w-3 text-slate-400 animate-spin" aria-label="Removing" />
        )}
      </div>

      <div className="mx-3 rounded-md border border-slate-200 bg-white overflow-hidden">
        {isLoading ? (
          <div className="px-3 py-6 flex items-center justify-center">
            <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-red-600" data-testid="devices-load-error">
            Failed to load devices.
          </div>
        ) : !data || data.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-500 italic" data-testid="devices-empty">
            No active notification devices. Enable notifications on any browser you use to add one.
          </div>
        ) : (
          <ul>
            {data.map((device, idx) => {
              const { label, icon } = describeDevice(device);
              const isLast = idx === data.length - 1;
              const isBusy = removeMutation.isPending && removeMutation.variables === device.id;
              return (
                <li
                  key={device.id}
                  className={`flex items-center gap-3 px-3 py-3 ${!isLast ? "border-b border-slate-100" : ""}`}
                  data-testid={`device-row-${device.id}`}
                >
                  <DeviceIcon kind={icon} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{label}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5">
                      Last active {formatLastActive(device.lastSeenAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(device.id)}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-red-600 active:bg-red-50 disabled:opacity-60"
                    data-testid={`button-remove-device-${device.id}`}
                    aria-label={`Remove ${label}`}
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push-device status block (read-only summary)
// ---------------------------------------------------------------------------

function PushDeviceStatus() {
  const push = usePushRegistration();

  if (!push.supported) {
    return (
      <div className="mx-3 mt-2 text-[12px] text-slate-500 italic">
        This browser does not support push notifications.
      </div>
    );
  }

  let label: string;
  let Icon = Bell;
  let tone = "text-slate-600";
  if (push.permission === "denied") {
    label = "Notifications blocked in browser settings.";
    Icon = BellOff;
    tone = "text-red-600";
  } else if (push.permission !== "granted" || !push.subscribed) {
    label = "Notifications are not enabled on this device.";
    Icon = BellOff;
    tone = "text-slate-600";
  } else {
    label = "Notifications enabled on this device.";
    tone = "text-emerald-700";
  }

  return (
    <div className="mx-3 mt-3 flex items-center gap-2 text-[12px]">
      <Icon className={`h-3.5 w-3.5 ${tone} shrink-0`} />
      <span className={tone}>{label}</span>
      {push.permission === "default" && (
        <button
          type="button"
          onClick={() => { void push.requestAndSubscribe(); }}
          disabled={push.busy}
          className="ml-auto px-2.5 py-1 rounded-md bg-[#22c55e] text-white text-[11px] font-semibold disabled:opacity-60"
          data-testid="button-enable-push-on-me-page"
        >
          {push.busy ? "…" : "Enable"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Load preferences. React Query owns the fetch/cache; the component is
  // thin — no persistence logic here.
  const { data, isLoading, error } = useQuery<NotificationPreferences>({
    queryKey: PREFS_QUERY_KEY,
    queryFn: () => apiRequest<NotificationPreferences>("/api/tech/me/notification-preferences"),
  });

  // Local draft mirrors server state, flushed via PATCH mutation. Keeps
  // the toggle UI responsive even when the mutation is in flight.
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      apiRequest<NotificationPreferences>("/api/tech/me/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(PREFS_QUERY_KEY, fresh);
      setDraft(fresh);
    },
  });

  const setToggle = (key: keyof NotificationPreferences, next: boolean) => {
    if (!draft) return;
    // Optimistic update so the switch animates immediately; the mutation
    // result re-syncs on success (server is still source of truth).
    setDraft({ ...draft, [key]: next });
    mutation.mutate({ [key]: next });
  };

  return (
    <MobileShell showNav hideTopBar={false}>
      {/* Page header — matches the sticky pattern TodayPage uses. */}
      <div className="sticky top-0 z-10 bg-slate-50 px-3 py-2 flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setLocation("/tech/today")}
          className="p-1 -ml-1 text-slate-500 active:bg-slate-100 rounded-md"
          aria-label="Back"
          data-testid="button-me-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold text-slate-800">Me</h1>
      </div>

      {/* Notifications section */}
      <div className="mt-3">
        <div className="px-3 pb-1 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Notifications
          </h2>
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 text-slate-400 animate-spin" aria-label="Saving" />
          )}
        </div>

        <div className="mx-3 rounded-md border border-slate-200 bg-white overflow-hidden">
          {isLoading || !draft ? (
            <div className="px-3 py-6 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-xs text-red-600">
              Failed to load preferences. Pull to retry later.
            </div>
          ) : (
            <>
              <ToggleRow
                label="New assignments"
                description="When you're newly assigned to a visit."
                checked={draft.visitAssignmentsEnabled}
                onChange={(next) => setToggle("visitAssignmentsEnabled", next)}
                disabled={mutation.isPending}
                testId="toggle-visit-assignments"
              />
              <ToggleRow
                label="Schedule changes"
                description="When a visit you're on gets rescheduled."
                checked={draft.visitScheduleChangesEnabled}
                onChange={(next) => setToggle("visitScheduleChangesEnabled", next)}
                disabled={mutation.isPending}
                testId="toggle-visit-schedule-changes"
              />
              <ToggleRow
                label="Cancellations"
                description="When a visit you're on is cancelled."
                checked={draft.visitCancellationsEnabled}
                onChange={(next) => setToggle("visitCancellationsEnabled", next)}
                disabled={mutation.isPending}
                testId="toggle-visit-cancellations"
              />
              <ToggleRow
                label="Reminders"
                description="Upcoming-visit reminders."
                checked={draft.visitRemindersEnabled}
                onChange={(next) => setToggle("visitRemindersEnabled", next)}
                disabled={mutation.isPending}
                testId="toggle-visit-reminders"
              />
            </>
          )}
        </div>

        <PushDeviceStatus />

        {mutation.isError && (
          <div className="mx-3 mt-2 text-[11px] text-red-600" data-testid="me-save-error">
            Couldn't save the change. It will retry on next tap.
          </div>
        )}
      </div>

      {/* 2026-04-21 Phase 2 — Devices v1. Lists every active push target
          the user has registered (across browsers/devices), with a
          per-row Remove button. Revoke is canonical via
          DELETE /api/tech/me/notification-devices/:id; this UI does not
          touch the service-worker subscription — the next failed push to
          a revoked target will surface cleanly as a 410 and the browser
          can re-subscribe if the user re-enables on that device. */}
      <DevicesSection />
    </MobileShell>
  );
}
