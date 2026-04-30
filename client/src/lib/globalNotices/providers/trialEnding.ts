/**
 * Trial-ending notice provider.
 *
 * Replaces `client/src/components/SubscriptionBanner.tsx`. Reads the same
 * canonical entitlement source (`useEntitlements` → `GET /api/me/entitlements`),
 * preserves the same display logic (≤ 7 days remaining = warning;
 * `TRIAL_EXPIRED` or past-due = error), and emits a `Notice` for the
 * canonical `<GlobalNotice />` to render.
 *
 * No new mutation. No new server route. No new query.
 */

import { differenceInDays, format } from "date-fns";
import { useEntitlements } from "@/hooks/useEntitlements";
import type { Notice, NoticeProvider } from "../types";

export const useTrialEndingNotice: NoticeProvider = (): Notice | null => {
  const { data } = useEntitlements();
  if (!data) return null;

  const { entitled, reason, trialEndsAt } = data.accountState;

  // Paid active subscription — never surface a trial notice.
  if (entitled && reason === "PAID_ACTIVE") return null;

  const trialEndDate = trialEndsAt ? new Date(trialEndsAt) : null;
  const daysRemaining = trialEndDate
    ? differenceInDays(trialEndDate, new Date())
    : 999;
  const isExpired = reason === "TRIAL_EXPIRED" || daysRemaining < 0;
  const isExpiringSoon = !isExpired && daysRemaining <= 7;

  if (!isExpired && !isExpiringSoon) return null;

  const dateSuffix = trialEndDate ? ` (${format(trialEndDate, "MMM d, yyyy")})` : "";
  const message = isExpired
    ? `Your trial expired${trialEndDate ? ` on ${format(trialEndDate, "MMM d, yyyy")}` : ""}. Upgrade to continue adding locations.`
    : `Your trial ends in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}${dateSuffix}. Upgrade to continue service.`;

  return {
    id: "trial-ending",
    severity: isExpired ? "error" : "warning",
    message,
    action: { label: "Upgrade", href: "/billing" },
    dismissible: true,
    // Expired trials warrant higher urgency than expiring-soon. Both sit
    // above generic info notices. Final priority floor: critical=100,
    // error=70, warning=40, info=10.
    priority: isExpired ? 70 : 40,
    // Fold the trial end date into the dismissal key — when a customer
    // upgrades and a new trial / billing cycle creates a new
    // `trialEndsAt`, prior dismissal does not suppress the new notice.
    version: trialEndsAt ?? "no-end-date",
    // Permanent dismissal within this version. The notice will only
    // re-appear if `version` changes (i.e. trial end date changes).
    // Set `cooldownHours: 24` here later if product wants the warning
    // to nag once per day instead.
  };
};
