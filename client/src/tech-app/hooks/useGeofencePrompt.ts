/**
 * useGeofencePrompt — technician PWA geofence prompt (2026-04-26).
 *
 * Foreground-only geolocation watcher for the tech app. When the device
 * enters a configurable radius of an eligible scheduled-visit location,
 * the hook surfaces a single prompt the tech must explicitly tap through.
 *
 *   "Looks like you're on site. Start this visit?"
 *
 * The hook NEVER auto-starts a visit. It only signals state; the
 * `GeofenceStartPrompt` component drives the canonical
 * `POST /api/tech/visits/:visitId/start` mutation when the tech taps
 * "Start visit." All status writes flow through `jobLifecycleOrchestrator`
 * on the server — there is no parallel start path.
 *
 * Dismiss is permanent for the session: tapping "Not now" adds the visit
 * id to `dismissedRef` and the hook never prompts for it again until the
 * tab is reloaded. The tech can still start the visit manually from the
 * visit detail page. The prior cooldown-timestamp scheme was removed
 * 2026-04-26 — single-tap permanent suppress is simpler and matches the
 * "ask once, get out of the way" UX intent.
 *
 * Eligibility — the prompt fires ONLY when ALL are true:
 *   1. Tenant has the `geofence_auto_start` entitlement enabled.
 *   2. Tenant has `geofenceAutoStartEnabled = true` on companySettings.
 *   3. Browser geolocation permission is granted (or can be prompted).
 *   4. Tech has at least one visit assigned today.
 *   5. That visit has lat/lng on its location (address is geocoded).
 *   6. The visit is in a state the orchestrator accepts as a start
 *      source: `scheduled` or `en_route`. Already-started/paused/
 *      completed/cancelled visits are skipped.
 *   7. The tech has no other visit currently `in_progress` or `on_site`
 *      (single-active-visit is server-enforced; the hook pre-filters so
 *      we don't prompt just to have the server reject).
 *   8. Distance from device to location ≤ tenant radius.
 *   9. The visit was not previously dismissed in this session.
 *
 * The hook fails CLOSED on every error path: permission denied, position
 * unavailable, config disabled, fetch error → status reflects it but no
 * prompt is shown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TodayVisit } from "./useTodayVisits";

// ── Public types ───────────────────────────────────────────────────────────

export interface GeofenceConfig {
  enabled: boolean;
  radiusMeters: number;
}

export interface GeofencePromptState {
  /** The visit the tech has entered radius for. */
  visit: TodayVisit;
  /** Rounded distance in meters at the moment the prompt opened. */
  distanceMeters: number;
}

/** Kinds of reasons the hook sits idle. Useful for a small debug/status UI. */
export type GeofenceStatus =
  | "disabled"             // feature or tenant setting off
  | "permission_denied"    // tech denied browser geolocation
  | "permission_prompt"    // we will ask on first position read
  | "awaiting_fix"         // permission granted but no coordinate yet
  | "active"               // actively watching
  | "no_eligible_visits";  // watching, but no candidates meet eligibility

// ── Constants ──────────────────────────────────────────────────────────────

const GEOFENCE_CONFIG_QUERY_KEY = ["/api/tech/geofence-config"] as const;

/** Visit statuses from which the server allows a tech-facing `/start`. */
const STARTABLE_STATUSES = new Set<string>(["scheduled", "en_route"]);

/** Visit statuses the hook treats as "already running" — skip entirely. */
const ACTIVE_STATUSES = new Set<string>([
  "in_progress",
  "on_site",
  "on-site",
  "paused",
]);

/** Haversine distance in meters between two lat/lng points. */
function distanceMeters(
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Hook ────────────────────────────────────────────────────────────────────

interface UseGeofencePromptOptions {
  /** Today's visits assigned to the technician (self-scope rows). */
  visits: TodayVisit[];
  /** Whether the tech is actively clocked in. Skips watching when false. */
  isClockedIn: boolean;
  /** Gate hook off entirely on non-self views (manager cross-tech mode). */
  enabled?: boolean;
}

export function useGeofencePrompt({
  visits,
  isClockedIn,
  enabled = true,
}: UseGeofencePromptOptions) {
  // 1) Fetch tenant-level config (fail-closed to disabled on error).
  const { data: config } = useQuery<GeofenceConfig>({
    queryKey: GEOFENCE_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/tech/geofence-config", { credentials: "include" });
      if (!res.ok) return { enabled: false, radiusMeters: 100 };
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const [status, setStatus] = useState<GeofenceStatus>("disabled");
  const [prompt, setPrompt] = useState<GeofencePromptState | null>(null);

  // Per-visit permanent dismiss for the session. Cleared on hook unmount;
  // a fresh tab/session gives every visit a fresh chance to prompt. Both
  // explicit "Not now" dismisses and successful starts add the visit id
  // here — once dismissed or started, the visit never re-prompts in this
  // session.
  const dismissedRef = useRef<Set<string>>(new Set());

  // Pre-compute eligible visits so the watch loop is cheap.
  const candidateVisits = useMemo(() => {
    if (!config?.enabled) return [];
    return visits.filter((v) => {
      if (v.locationLat == null || v.locationLng == null) return false;
      if (!STARTABLE_STATUSES.has(v.status)) return false;
      if (dismissedRef.current.has(v.id)) return false;
      return true;
    });
  }, [visits, config?.enabled]);

  // Active-visit pre-check mirrors the server's single-active-visit guard.
  const hasOtherActive = useMemo(
    () => visits.some((v) => ACTIVE_STATUSES.has(v.status)),
    [visits],
  );

  const dismissPrompt = useCallback(() => {
    if (prompt) dismissedRef.current.add(prompt.visit.id);
    setPrompt(null);
  }, [prompt]);

  const ackStarted = useCallback((visitId: string) => {
    dismissedRef.current.add(visitId);
    setPrompt(null);
  }, []);

  // 2) Only watch when genuinely useful. This short-circuit is what keeps
  //    battery drain contained.
  const shouldWatch =
    enabled &&
    !!config?.enabled &&
    isClockedIn &&
    !hasOtherActive &&
    candidateVisits.length > 0 &&
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator;

  useEffect(() => {
    if (!config?.enabled) {
      setStatus("disabled");
      return;
    }
    if (!shouldWatch) {
      setStatus(candidateVisits.length === 0 ? "no_eligible_visits" : "disabled");
      return;
    }

    setStatus("awaiting_fix");

    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        setStatus("active");

        const { latitude, longitude, accuracy } = pos.coords;
        if (latitude == null || longitude == null) return;

        // Defensive: if accuracy is ridiculous (>500m), skip this tick.
        // Low-signal positions cause false positives at the radius boundary.
        if (typeof accuracy === "number" && accuracy > 500) return;

        // Pick the closest eligible visit within radius. Only one prompt
        // at a time; closest wins when two locations share a building.
        let best: { visit: TodayVisit; distance: number } | null = null;
        for (const v of candidateVisits) {
          if (v.locationLat == null || v.locationLng == null) continue;
          const d = distanceMeters(latitude, longitude, v.locationLat, v.locationLng);
          if (d <= (config?.radiusMeters ?? 100)) {
            if (!best || d < best.distance) best = { visit: v, distance: d };
          }
        }

        if (!best) return;

        // Debounce: if a prompt is already open for a different visit, let
        // the user dismiss it first. Same-visit re-entry is a no-op.
        setPrompt((current) => {
          if (current && current.visit.id === best!.visit.id) return current;
          if (current) return current;
          return { visit: best!.visit, distanceMeters: Math.round(best!.distance) };
        });
      },
      (err) => {
        if (cancelled) return;
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("permission_denied");
        } else {
          // POSITION_UNAVAILABLE / TIMEOUT — stay in awaiting_fix; user can
          // retry via the browser or walk outside to regain signal.
          setStatus("awaiting_fix");
        }
      },
      {
        enableHighAccuracy: true,
        // Accept cached positions up to 15s old — reduces battery without
        // letting fixes go stale at walking pace.
        maximumAge: 15_000,
        // 20s single-fix timeout; watchPosition calls the error handler
        // once per timed-out attempt then continues.
        timeout: 20_000,
      },
    );

    return () => {
      cancelled = true;
      try { navigator.geolocation.clearWatch(watchId); } catch { /* noop */ }
    };
  }, [shouldWatch, candidateVisits, config?.enabled, config?.radiusMeters]);

  return {
    status,
    config: config ?? null,
    prompt,
    dismissPrompt,
    ackStarted,
  };
}
