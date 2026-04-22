/**
 * SubscriptionBanner — trial-expiry / expired banner.
 *
 * 2026-04-21 Phase 2 canonical policy architecture: reads account state
 * from the canonical `GET /api/me/entitlements` resolver via
 * `useEntitlements`, replacing the legacy `/api/subscriptions/usage` query.
 * The entitlement response exposes the same `entitled` + `reason` +
 * `trialEndsAt` fields (see `EntitlementAccountState` in
 * `client/src/hooks/useEntitlements.ts`), so the banner rendering logic
 * is unchanged.
 */
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { differenceInDays, format } from "date-fns";
import { useEntitlements } from "@/hooks/useEntitlements";

export function SubscriptionBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useEntitlements();

  if (!data || dismissed) {
    return null;
  }

  const { entitled, reason, trialEndsAt } = data.accountState;

  // Paid active subscription — never show trial banner.
  if (entitled && reason === "PAID_ACTIVE") {
    return null;
  }

  const trialEndDate = trialEndsAt ? new Date(trialEndsAt) : null;
  const now = new Date();
  const daysRemaining = trialEndDate ? differenceInDays(trialEndDate, now) : 999;
  const isExpired = reason === "TRIAL_EXPIRED" || daysRemaining < 0;
  const isExpiringSoon = !isExpired && daysRemaining <= 7;

  // Only show if expired or expiring soon (for trial users)
  if (!isExpired && !isExpiringSoon) {
    return null;
  }

  return (
    <Alert
      variant={isExpired ? "destructive" : "default"}
      className="rounded-none border-x-0 border-t-0"
      data-testid="banner-trial-expiration"
    >
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          {isExpired ? (
            <>Your trial expired{trialEndDate ? ` on ${format(trialEndDate, "MMM d, yyyy")}` : ""}. Upgrade to continue adding locations.</>
          ) : (
            <>Your trial ends in {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}{trialEndDate ? ` (${format(trialEndDate, "MMM d, yyyy")})` : ""}. Upgrade to continue service.</>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setDismissed(true)}
          data-testid="button-dismiss-banner"
        >
          <X className="h-4 w-4" />
        </Button>
      </AlertDescription>
    </Alert>
  );
}
