import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { differenceInDays, format } from "date-fns";

// Entitlement reasons from backend
type EntitlementReason =
  | "PAID_ACTIVE"
  | "TRIAL_ACTIVE"
  | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_INACTIVE"
  | "NO_PLAN";

interface Usage {
  plan: {
    name: string;
    displayName: string;
  } | null;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  entitled: boolean;
  entitlementReason: EntitlementReason;
}

export function SubscriptionBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data: usage } = useQuery<Usage>({
    queryKey: ["/api/subscriptions/usage"]
  });

  if (!usage || dismissed) {
    return null;
  }

  const { entitled, entitlementReason, trialEndsAt } = usage;

  // If entitled (PAID_ACTIVE or TRIAL_ACTIVE with valid trial), don't show expiration banner
  // Only show banner for TRIAL_EXPIRED or TRIAL_ACTIVE with expiring soon
  if (entitled && entitlementReason === "PAID_ACTIVE") {
    // Paid active subscription - never show trial banner
    return null;
  }

  // For trial users, check if expiring soon
  const trialEndDate = trialEndsAt ? new Date(trialEndsAt) : null;
  const now = new Date();
  const daysRemaining = trialEndDate ? differenceInDays(trialEndDate, now) : 999;
  const isExpired = entitlementReason === "TRIAL_EXPIRED" || daysRemaining < 0;
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
