/**
 * Payments Settings Page (PR 3, 2026-05-03).
 *
 * Tenant-facing UI for the provider-neutral payments-onboarding flow
 * built in PR 1 (schema) and PR 2 (service + adapter + API).
 *
 * Surface:
 *   - Status card (left)         → lifecycle enum + capability flags.
 *   - Requirements card (left)   → provider remediation list when present.
 *   - Actions card (right)       → "Set up" / "Continue setup" / "View
 *                                   account" + "Refresh status".
 *   - Help card (right)          → minimal placeholder copy. PR 4+ wires
 *                                   payouts / disputes detail.
 *
 * Provider-neutrality: this page never imports the Stripe SDK. The
 * onboarding redirect treats `link.url` as a black-box URL the
 * provider returned. Status copy uses generic terms ("Connect a
 * bank account", not "Stripe payouts").
 *
 * Auth: gated by ProtectedRoute(requireAdmin) at the App.tsx level.
 * Tenant scoping happens server-side; the page reads `req.companyId`
 * out of the authenticated session.
 *
 * Post-onboarding return:
 *   The onboarding-link generator hands the provider a `returnUrl` of
 *   `…/settings/payments?from=stripe`. When the user lands back here
 *   with that flag, the page triggers `refresh()` exactly once and
 *   strips the flag from the URL. No polling — refresh on click only.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusPill, type PillVariant } from "@/components/ui/status-pill";
import { useToast } from "@/hooks/use-toast";
import {
  useOnboardPaymentAccount,
  useRefreshPaymentAccount,
  useTenantPaymentAccount,
  type PaymentAccountStatus,
  type TenantPaymentAccount,
} from "@/hooks/usePaymentAccount";

// ============================================================================
// Country options
// ============================================================================
//
// Stripe Connect Express supports a long list of countries. PR 3 ships
// the two most common for our tenant base; future PRs expand from
// Stripe's published list. The server validates length===2 + uppercases
// — anything beyond visual polish belongs there.

const COUNTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "CA", label: "Canada" },
  { value: "US", label: "United States" },
];

// ============================================================================
// Status presentation
// ============================================================================

interface StatusPresentation {
  variant: PillVariant;
  label: string;
  /** Short description shown alongside the pill. Spec wording. */
  description: string;
  /** Primary action verb for the right-column CTA. */
  ctaLabel: string;
}

const STATUS_PRESENTATION: Record<PaymentAccountStatus, StatusPresentation> = {
  not_started: {
    variant: "neutral",
    label: "Not started",
    description: "Set up payments to start accepting cards.",
    ctaLabel: "Set up payments",
  },
  pending: {
    variant: "warning",
    label: "Setup incomplete",
    description: "Setup incomplete — finish onboarding to enable charges.",
    ctaLabel: "Continue setup",
  },
  restricted: {
    variant: "warning",
    label: "Action required",
    description:
      "Additional verification required before payouts are released.",
    ctaLabel: "Continue setup",
  },
  active: {
    variant: "success",
    label: "Active",
    description: "Payments enabled. You can collect cards and receive payouts.",
    ctaLabel: "View / Update account",
  },
  disabled: {
    variant: "danger",
    label: "Disabled",
    description: "Account disabled. Contact the provider to remediate.",
    ctaLabel: "Open provider dashboard",
  },
};

function presentationFor(
  account: TenantPaymentAccount | null,
): StatusPresentation {
  if (!account) return STATUS_PRESENTATION.not_started;
  return STATUS_PRESENTATION[account.status] ?? STATUS_PRESENTATION.not_started;
}

// ============================================================================
// Requirements extraction
// ============================================================================
//
// The server stores `requirementsDue` verbatim from the provider — for
// Stripe, that's an object with `currently_due`, `eventually_due`,
// `past_due`, `pending_verification` arrays of opaque-ish strings
// (e.g. `external_account`, `business_profile.url`,
// `individual.id_number`).
//
// PR 3 surfaces only `currently_due` (the items the tenant must act on
// right now) and `past_due` (items already overdue). Pretty-printing
// is a single-line `key.replace(/[._]/g, " ")` — we deliberately do
// NOT translate keys to human prose because the underlying enum
// changes whenever the provider tweaks its onboarding flow. The list
// is informational; the actual remediation happens in the
// provider-hosted wizard.

interface RequirementsBlock {
  currentlyDue: string[];
  pastDue: string[];
}

function extractRequirements(raw: unknown): RequirementsBlock {
  if (!raw || typeof raw !== "object") {
    return { currentlyDue: [], pastDue: [] };
  }
  const obj = raw as Record<string, unknown>;
  const toStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    currentlyDue: toStrings(obj.currently_due),
    pastDue: toStrings(obj.past_due),
  };
}

function prettifyRequirementKey(key: string): string {
  // Stripe keys use dots + underscores. "external_account" →
  // "External account"; "individual.id_number" → "Individual id number".
  // The provider sometimes prefixes with `tos_acceptance.` etc — that
  // also formats fine.
  const flattened = key.replace(/[._]/g, " ");
  return flattened.charAt(0).toUpperCase() + flattened.slice(1);
}

// ============================================================================
// Page
// ============================================================================

const RETURN_URL_PARAM = "from";
const RETURN_URL_VALUE = "stripe";

export default function PaymentsSettingsPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [country, setCountry] = useState<string>(COUNTRY_OPTIONS[0]!.value);

  const accountQuery = useTenantPaymentAccount();
  const onboardMutation = useOnboardPaymentAccount();
  const refreshMutation = useRefreshPaymentAccount();

  const account = accountQuery.data?.account ?? null;
  const presentation = presentationFor(account);
  const requirements = extractRequirements(account?.requirementsDue ?? null);
  const hasRequirements =
    requirements.currentlyDue.length > 0 || requirements.pastDue.length > 0;

  // Hydrate the country picker from the persisted row when present —
  // tenants don't see the picker again after onboarding starts. The
  // server treats country as immutable post-onboarding (Stripe's own
  // rule); we mirror that by hiding the picker when the row exists.
  useEffect(() => {
    if (account?.country) setCountry(account.country.toUpperCase());
  }, [account?.country]);

  // ─── Post-onboarding return effect ────────────────────────────────
  // When the user comes back from the provider's hosted wizard, the
  // URL carries `?from=stripe`. Trigger refresh once + strip the flag.
  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    if (!search) return;
    const params = new URLSearchParams(search);
    if (params.get(RETURN_URL_PARAM) !== RETURN_URL_VALUE) return;

    refreshMutation.mutate(undefined, {
      onError: (err) => {
        toast({
          title: "Couldn't refresh account status",
          description: err.message,
          variant: "destructive",
        });
      },
    });
    // Strip the flag so a back-nav / re-mount doesn't re-trigger.
    params.delete(RETURN_URL_PARAM);
    const next = params.toString();
    setLocation(next ? `/settings/payments?${next}` : "/settings/payments", {
      replace: true,
    });
    // Intentionally run once on mount — we never want to fire twice
    // for the same return. The setLocation strip above guarantees
    // re-renders see no flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ─────────────────────────────────────────────────────

  const buildReturnUrl = () => {
    // Provider redirects here on success. The query flag drives the
    // post-return effect above.
    if (typeof window === "undefined") {
      return `/settings/payments?${RETURN_URL_PARAM}=${RETURN_URL_VALUE}`;
    }
    const origin = window.location.origin;
    return `${origin}/settings/payments?${RETURN_URL_PARAM}=${RETURN_URL_VALUE}`;
  };

  const buildRefreshUrl = () => {
    // Provider redirects here when the link expires mid-flow. We hand
    // the SAME page back; clicking the CTA again mints a fresh link.
    if (typeof window === "undefined") return "/settings/payments";
    return `${window.location.origin}/settings/payments`;
  };

  const handleStartOnboarding = () => {
    onboardMutation.mutate(
      {
        country,
        refreshUrl: buildRefreshUrl(),
        returnUrl: buildReturnUrl(),
      },
      {
        onSuccess: (result) => {
          // Replace the current tab — Stripe's hosted onboarding is
          // a full-page wizard, not a popup-friendly surface.
          if (typeof window !== "undefined" && result.link?.url) {
            window.location.assign(result.link.url);
          }
        },
        onError: (err) => {
          toast({
            title: "Couldn't start onboarding",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Status refreshed" });
      },
      onError: (err) => {
        toast({
          title: "Couldn't refresh status",
          description: err.message,
          variant: "destructive",
        });
      },
    });
  };

  // ─── Loading + top-level error states ─────────────────────────────

  if (accountQuery.isLoading) {
    return (
      <div className="p-4 space-y-4">
        <PageHeader />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-body">Loading payment account…</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accountQuery.isError) {
    return (
      <div className="p-4 space-y-4">
        <PageHeader />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load account</AlertTitle>
          <AlertDescription>
            {accountQuery.error instanceof Error
              ? accountQuery.error.message
              : "Please try again or contact support if this persists."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ─── Empty state — no account row at all ──────────────────────────

  if (!account) {
    return (
      <div className="p-4 space-y-4">
        <PageHeader />
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle data-testid="text-payments-empty-title">
                  Accept online payments
                </CardTitle>
                <CardDescription>
                  Set up payments to accept credit cards and get paid directly
                  to your bank account.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="payments-country">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger
                  id="payments-country"
                  data-testid="select-payments-country"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-helper text-muted-foreground">
                Country can't be changed after onboarding starts.
              </p>
            </div>
            <Button
              onClick={handleStartOnboarding}
              disabled={onboardMutation.isPending}
              data-testid="button-start-payments-onboarding"
            >
              {onboardMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Set up payments
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Configured — two-column layout ───────────────────────────────

  return (
    <div className="p-4 space-y-4">
      <PageHeader />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Status + Requirements */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle data-testid="text-payments-status-title">
                  Account status
                </CardTitle>
                <StatusPill
                  variant={presentation.variant}
                  data-testid="badge-payments-status"
                >
                  {presentation.label}
                </StatusPill>
              </div>
              <CardDescription data-testid="text-payments-status-description">
                {presentation.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CapabilityRow
                label="Charges enabled"
                enabled={account.chargesEnabled}
                testId="row-charges-enabled"
              />
              <CapabilityRow
                label="Payouts enabled"
                enabled={account.payoutsEnabled}
                testId="row-payouts-enabled"
              />
              <CapabilityRow
                label="Details submitted"
                enabled={account.detailsSubmitted}
                testId="row-details-submitted"
              />
              {account.disabledReason ? (
                <div className="text-caption text-destructive">
                  <span className="font-medium">Reason:</span>{" "}
                  <span data-testid="text-disabled-reason">
                    {account.disabledReason}
                  </span>
                </div>
              ) : null}
              <div className="text-helper text-muted-foreground pt-2 border-t">
                Provider:{" "}
                <span className="capitalize">{account.provider}</span>
                {account.country ? <> · Country: {account.country}</> : null}
                {account.defaultCurrency ? (
                  <> · Currency: {account.defaultCurrency.toUpperCase()}</>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {hasRequirements ? (
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-payments-requirements-title">
                  Requirements
                </CardTitle>
                <CardDescription>
                  The payment provider needs the following information.
                  Click "Continue setup" below to provide it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {requirements.pastDue.length > 0 ? (
                  <RequirementList
                    title="Past due"
                    items={requirements.pastDue}
                    tone="danger"
                    testIdPrefix="req-past-due"
                  />
                ) : null}
                {requirements.currentlyDue.length > 0 ? (
                  <RequirementList
                    title="Currently due"
                    items={requirements.currentlyDue}
                    tone="warning"
                    testIdPrefix="req-currently-due"
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* RIGHT: Actions + Help */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                Manage your payment account at the provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                onClick={handleStartOnboarding}
                disabled={onboardMutation.isPending}
                data-testid="button-payments-onboarding-cta"
              >
                {onboardMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {presentation.ctaLabel}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleRefresh}
                disabled={refreshMutation.isPending}
                data-testid="button-payments-refresh"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh status
              </Button>
              {refreshMutation.isError ? (
                <p
                  className="text-helper text-destructive pt-1"
                  data-testid="text-refresh-warning"
                >
                  Refresh failed:{" "}
                  {refreshMutation.error instanceof Error
                    ? refreshMutation.error.message
                    : "unknown error"}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How this works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Onboarding is hosted by the payment provider. We redirect
                you there to complete identity verification and connect a
                bank account.
              </p>
              <p>
                Once active, online invoice payments are routed through
                your account and paid out to your bank.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components — kept inline because they're page-specific.
// ============================================================================

function PageHeader() {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1
            className="text-title"
            data-testid="text-payments-settings-title"
          >
            Payments
          </h1>
          <p className="text-caption text-muted-foreground">
            Set up online card payments and bank-account payouts.
          </p>
        </div>
      </div>
      {/* 2026-05-04 PR7 — back-link from settings to the lifecycle
          dashboard. Operators flip between the two surfaces all the
          time once they're past initial onboarding. */}
      <Link href="/payments">
        <Button
          variant="outline"
          size="sm"
          data-testid="button-go-to-payments-dashboard"
        >
          View payments dashboard →
        </Button>
      </Link>
    </div>
  );
}

function CapabilityRow({
  label,
  enabled,
  testId,
}: {
  label: string;
  enabled: boolean;
  testId: string;
}) {
  return (
    <div
      className="flex items-center justify-between text-sm"
      data-testid={testId}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        {enabled ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="font-medium text-green-700 dark:text-green-400">
              Yes
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">No</span>
          </>
        )}
      </span>
    </div>
  );
}

function RequirementList({
  title,
  items,
  tone,
  testIdPrefix,
}: {
  title: string;
  items: string[];
  tone: "warning" | "danger";
  testIdPrefix: string;
}) {
  const titleClass =
    tone === "danger"
      ? "text-destructive"
      : "text-amber-600 dark:text-amber-400";
  return (
    <div className="space-y-1.5">
      <h3 className={`text-sm font-medium ${titleClass}`}>{title}</h3>
      <ul className="space-y-1 text-sm pl-1">
        {items.map((item, idx) => (
          <li
            key={item}
            className="flex items-start gap-2"
            data-testid={`${testIdPrefix}-${idx}`}
          >
            <span
              className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                tone === "danger" ? "bg-destructive" : "bg-amber-500"
              }`}
            />
            <span>{prettifyRequirementKey(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
