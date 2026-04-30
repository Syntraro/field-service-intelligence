/**
 * useGlobalNotices — canonical orchestrator for app-shell notices.
 *
 * 2026-04-29: single canonical hook that drives `<GlobalNotice />`.
 * Calls each registered provider hook (in array order — order is
 * irrelevant since priority is the sort key), filters out `null`
 * results and dismissed notices, sorts by priority desc, and exposes
 * the top notice plus a dismiss callback.
 *
 * Adding a new notice type means: write a provider hook in
 * `client/src/lib/globalNotices/providers/`, append it to
 * `PROVIDERS`. No new banner component, no new mount, no new
 * dismissal infrastructure.
 */

import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useTrialEndingNotice } from "@/lib/globalNotices/providers/trialEnding";
import { useDismissNotice, useIsDismissed } from "@/lib/globalNotices/dismissal";
import type { Notice, NoticeProvider } from "@/lib/globalNotices/types";

// ────────────────────────────────────────────────────────────────────
// Notice provider registry.
//
// Append new providers here. Each provider is a hook that returns a
// `Notice` or `null`. Order in this array is irrelevant — the
// orchestrator sorts by `notice.priority` (descending) before picking
// the top notice. Keep the registry small and explicit; prefer a
// single provider per notice type.
// ────────────────────────────────────────────────────────────────────
const PROVIDERS: NoticeProvider[] = [
  useTrialEndingNotice,
  // Future:
  //   useSubscriptionExpiredNotice,
  //   usePaymentFailedNotice,
  //   useMaintenanceNotice,
  //   useAdminBroadcastNotice,
];

export interface GlobalNoticesState {
  /** Highest-priority active, non-dismissed notice — or `null`. */
  topNotice: Notice | null;
  /** Records a dismissal for the supplied notice. No-op when the user
   *  / company id pair isn't yet available (e.g. mid-auth). */
  dismiss: (notice: Notice) => void;
}

export function useGlobalNotices(): GlobalNoticesState {
  // Providers must be called unconditionally and in stable order to
  // satisfy the rules of hooks. We then filter `null`s after the fact.
  // PROVIDERS is module-level constant so its length is stable across
  // renders.
  const candidates = PROVIDERS.map((provider) => provider());

  const { user } = useAuth();
  const companyId = user?.companyId ?? null;
  const userId = user?.id ?? null;

  // Pick the top non-null candidate by priority. We resolve dismissal
  // state after sorting — `useIsDismissed` is a hook so we can only
  // call it once per render. We pass the candidate to the dismissal
  // hook unconditionally and let it handle the null case.
  const sorted = useMemo(() => {
    return candidates
      .filter((n): n is Notice => n !== null)
      .sort((a, b) => b.priority - a.priority);
    // candidates is a fresh array every render; React-Query memoizes the
    // upstream data so the underlying notices are reference-stable
    // when nothing changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(candidates)]);

  // We can only call `useIsDismissed` once per render in a stable
  // position. Pick the top candidate first, then check its dismissal
  // state. If the top is dismissed, fall through to the next; etc.
  // Limited to a small ceiling (`MAX_DEPTH`) — providers only run
  // when their conditions are met, so multiple simultaneous notices
  // are rare. Iteration via fixed-shape hook calls keeps the rules of
  // hooks intact.
  const MAX_DEPTH = 5;
  const padded: (Notice | null)[] = [
    sorted[0] ?? null,
    sorted[1] ?? null,
    sorted[2] ?? null,
    sorted[3] ?? null,
    sorted[4] ?? null,
  ];
  const dismissed: boolean[] = [
    useIsDismissed(padded[0], companyId, userId),
    useIsDismissed(padded[1], companyId, userId),
    useIsDismissed(padded[2], companyId, userId),
    useIsDismissed(padded[3], companyId, userId),
    useIsDismissed(padded[4], companyId, userId),
  ];

  let topNotice: Notice | null = null;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const candidate = padded[i];
    if (candidate && !dismissed[i]) {
      topNotice = candidate;
      break;
    }
  }

  const dismiss = useDismissNotice(companyId, userId);

  return { topNotice, dismiss };
}
