/**
 * Portal Pay inline form + invoice page — UX redesign regression
 * suite (2026-05-05).
 *
 * Asserts the structural contract of the two-column payment page and
 * the Stripe-Connect / readiness gates that prevent the "Loading
 * payment form…" stuck state.
 *
 * Static-source contract tests, mirroring `tests/portal-stripe-csp.test.ts`.
 * Make the page-structure rules explicit so a future PR that
 * accidentally regresses them fails at CI before customers hit a
 * runtime overlay or a stuck Pay button.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PORTAL_INVOICE_DETAIL = resolve(
  __dirname,
  "../client/src/pages/portal/PortalInvoiceDetail.tsx",
);
const PORTAL_PAY_FORM = resolve(
  __dirname,
  "../client/src/pages/portal/PortalPayInvoiceForm.tsx",
);
const PORTAL_UTILS = resolve(
  __dirname,
  "../client/src/pages/portal/portalUtils.ts",
);
const STRIPE_ADAPTER = resolve(
  __dirname,
  "../server/services/payments/providers/stripeAdapter.ts",
);
const PROVIDER_TYPES = resolve(
  __dirname,
  "../server/services/payments/providers/types.ts",
);

// ═══════════════════════════════════════════════════════════════════════════
// PortalPayInvoiceForm — onReady gate + 10s timeout fallback
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalPayInvoiceForm — onReady gate", () => {
  const src = readFileSync(PORTAL_PAY_FORM, "utf8");

  it("PaymentElement attaches an onReady callback that flips isReady state", () => {
    expect(src).toMatch(
      /<PaymentElement[\s\S]*?onReady=\{\(\) => setIsReady\(true\)\}/,
    );
  });

  it("PaymentElement disables Stripe Link via wallets options", () => {
    // Link's per-Stripe identity model conflicts with our per-tenant
    // Saved Cards feature. Apple Pay / Google Pay stay on `auto`.
    expect(src).toMatch(
      /options=\{\{\s*wallets:\s*\{\s*link:\s*"never"/,
    );
    expect(src).toMatch(/applePay:\s*"auto"/);
    expect(src).toMatch(/googlePay:\s*"auto"/);
  });

  it("Pay button is disabled until stripe + elements + isReady are all true", () => {
    expect(src).toMatch(
      /canSubmit\s*=\s*!!stripe && !!elements && isReady && !submitting/,
    );
    expect(src).toMatch(/disabled=\{!canSubmit\}/);
  });

  it("handleSubmit short-circuits when canSubmit is false", () => {
    expect(src).toMatch(/if \(!canSubmit \|\| !stripe \|\| !elements\) return/);
  });

  it("amountLabel renders inside the Pay button when ready", () => {
    expect(src).toMatch(/amountLabel: string/);
    expect(src).toMatch(/\) : \(\s*\n\s*amountLabel\s*\n\s*\)/);
  });

  it("does not accept onCancel (caller no longer in a modal)", () => {
    // Match prop usage / type / call shapes — onCancel may still
    // appear in doc-comments explaining its removal.
    expect(src).not.toMatch(/onCancel:\s*\(\)/);
    expect(src).not.toMatch(/onCancel\s*=\s*\{/);
    expect(src).not.toMatch(/onCancel\s*\(\)/);
  });

  it("wraps confirmPayment in try/catch (no Vite-overlay leakage)", () => {
    expect(src).toMatch(/try \{[\s\S]*?confirmPayment[\s\S]*?\} catch/);
  });
});

describe("PortalPayInvoiceForm — 10s onReady timeout fallback", () => {
  const src = readFileSync(PORTAL_PAY_FORM, "utf8");

  it("declares a 10-second READY_TIMEOUT_MS constant", () => {
    expect(src).toMatch(/const READY_TIMEOUT_MS = 10_000/);
  });

  it("starts a setTimeout when isReady is still false", () => {
    expect(src).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]*?setReadyTimedOut\(true\)/);
  });

  it("renders a portal-pay-ready-timeout panel when timed out and not yet ready", () => {
    expect(src).toMatch(/readyTimedOut && !isReady/);
    expect(src).toMatch(/data-testid="portal-pay-ready-timeout"/);
    expect(src).toMatch(/Payment form could not load/);
  });

  it("exposes an optional onRetry handler the timeout fallback wires to a Try again button", () => {
    expect(src).toMatch(/onRetry\?:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/data-testid="portal-pay-retry"/);
    expect(src).toMatch(/Try again/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PortalInvoiceDetail — two-column layout, no modal
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalInvoiceDetail — two-column layout, no modal", () => {
  const src = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");

  it("does not import Dialog primitives", () => {
    expect(src).not.toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("does not reference modal state (payModalOpen / openPayModal / closePayModal)", () => {
    expect(src).not.toMatch(/payModalOpen/);
    expect(src).not.toMatch(/openPayModal/);
    expect(src).not.toMatch(/closePayModal/);
  });

  it("uses a lg:grid-cols-3 layout with a sticky right-side payment panel", () => {
    expect(src).toMatch(/grid lg:grid-cols-3/);
    expect(src).toMatch(/lg:sticky lg:top-4/);
    expect(src).toMatch(/data-testid="portal-payment-panel"/);
  });

  it("auto-creates the PaymentIntent when the invoice is payable", () => {
    expect(src).toMatch(/isPayableForIntent/);
    expect(src).toMatch(/if \(intent\) return/);
    expect(src).toMatch(/if \(intentError\) return/);
    expect(src).toMatch(/if \(createIntentMutation\.isPending\) return/);
    expect(src).toMatch(/if \(justPaid\) return/);
    expect(src).toMatch(/createIntentMutation\.mutate\(\)/);
  });

  it("preserves the ?t= access token on the checkout POST URL", () => {
    expect(src).toMatch(
      /\/api\/portal\/invoices\/\$\{invoiceId\}\/payments\/checkout\$\{tokenQuery\}/,
    );
  });

  it("preserves the ?t= access token on the PDF download href", () => {
    expect(src).toMatch(/\/api\/portal\/invoices\/\$\{invoice\.id\}\/pdf\$\{tokenQuery\}/);
  });

  it("wires onRetry on PortalPayInvoiceForm so the timeout fallback re-mints the intent", () => {
    expect(src).toMatch(/onRetry=\{\(\)\s*=>\s*\{[\s\S]*?setIntent\(null\)/);
  });

  it("preserves the Stripe-load-failed graceful fallback inside the panel", () => {
    expect(src).toMatch(/data-testid="portal-stripe-load-failed"/);
    expect(src).toMatch(/Online payments are temporarily unavailable/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stripe Connect: providerAccountId threading (root cause of stuck loading)
// ═══════════════════════════════════════════════════════════════════════════

describe("Stripe Connect: providerAccountId on portal checkout", () => {
  const adapterSrc = readFileSync(STRIPE_ADAPTER, "utf8");
  const typesSrc = readFileSync(PROVIDER_TYPES, "utf8");
  const detailSrc = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");

  it("CreateCheckoutResult type carries providerAccountId", () => {
    expect(typesSrc).toMatch(/providerAccountId\?:\s*string/);
  });

  it("Stripe adapter populates providerAccountId on portal source", () => {
    expect(adapterSrc).toMatch(
      /providerAccountId:\s*\n?\s*input\.source === "portal" \? input\.providerAccountId/,
    );
  });

  it("Frontend CheckoutResponse interface includes providerAccountId", () => {
    expect(detailSrc).toMatch(/providerAccountId\?:\s*string/);
  });

  it("getStripePromise loads Stripe.js with { stripeAccount } when supplied", () => {
    // The connected-account fix passes `{ stripeAccount }` as the
    // second arg to loadStripe. Without this, PaymentElement's
    // iframe sits on a 404 trying to fetch a connected-account
    // PaymentIntent on the platform account, and onReady never fires.
    expect(detailSrc).toMatch(
      /loadStripe\(\s*\n?\s*publishableKey,\s*\n?\s*stripeAccount \? \{ stripeAccount \} : undefined,/,
    );
  });

  it("getStripePromise cache key includes the connected-account id", () => {
    // Different tenants land on different connected accounts; reusing
    // the same Stripe.js instance across them mounts intents on the
    // wrong account.
    expect(detailSrc).toMatch(
      /cacheKey = stripeAccount\s*\n?\s*\?\s*`\$\{publishableKey\}\|\$\{stripeAccount\}`\s*\n?\s*:\s*publishableKey/,
    );
  });

  it("Page passes intent.providerAccountId into getStripePromise", () => {
    expect(detailSrc).toMatch(
      /getStripePromise\(intent\.publishableKey, intent\.providerAccountId \?\? null\)/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layout cleanup
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalInvoiceDetail — layout cleanup", () => {
  const src = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");

  it("top card carries Scope of Work (workDescription) when policy allows", () => {
    expect(src).toMatch(/data-testid="portal-scope-of-work"/);
    expect(src).toMatch(
      /invoice\.workDescription && policy\.showJobDescription/,
    );
  });

  it("top card shows a single-line Amount Due (no giant Balance hero)", () => {
    expect(src).toMatch(/data-testid="portal-amount-due"/);
    // The legacy `text-3xl font-bold ... portal-balance-due` block is gone.
    expect(src).not.toMatch(/data-testid="portal-balance-due"/);
  });

  it("top card no longer renders the customer-confusing status badge", () => {
    // The old hero header included `<span ... ${badge.className}>{badge.label}</span>`.
    // The new design surfaces customer-friendly status via the StatusBanner
    // below, NOT a small badge alongside the invoice number.
    expect(src).not.toMatch(/badge\.className/);
    expect(src).not.toMatch(/\{badge\.label\}/);
  });

  it("totals block omits Balance Due when it equals Total (no amount paid yet)", () => {
    expect(src).toMatch(
      /invoice\.showBalance &&\s*\n?\s*hasBalance &&\s*\n?\s*parseFloat\(invoice\.amountPaid \|\| "0"\) > 0/,
    );
  });

  it("Notes/Terms block no longer renders Scope of work (moved to top)", () => {
    // The bottom Notes block must NOT include a "Scope of work" NotesBlock.
    expect(src).not.toMatch(/<NotesBlock label="Scope of work"/);
  });

  it("payment panel uses 'Payment' as title and 'Amount Due' label (no big hero)", () => {
    expect(src).toMatch(/<CardTitle className="text-base">Payment<\/CardTitle>/);
    expect(src).toMatch(/data-testid="portal-payment-panel-amount-due"/);
    // The previous large balance treatment had testid="portal-payment-panel-balance"
    // and class text-3xl font-bold.
    expect(src).not.toMatch(/data-testid="portal-payment-panel-balance"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook-applied polling: don't show "Payment received" until backend
// has actually recorded the payment.
// ═══════════════════════════════════════════════════════════════════════════

describe("PortalInvoiceDetail — post-confirmPayment polling", () => {
  const src = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");

  it("declares awaitingApplication, pendingBalanceCents, applicationTimedOut state", () => {
    expect(src).toMatch(/const \[awaitingApplication, setAwaitingApplication\]/);
    expect(src).toMatch(/const \[pendingBalanceCents, setPendingBalanceCents\]/);
    expect(src).toMatch(/const \[applicationTimedOut, setApplicationTimedOut\]/);
  });

  it("onSucceeded handler captures the balance snapshot and starts awaiting (does NOT immediately set justPaid)", () => {
    // The form's onSucceeded fires after Stripe accepts the payment;
    // the backend hasn't applied it yet. The handler must NOT call
    // setJustPaid(true) directly.
    expect(src).toMatch(/setPendingBalanceCents\(cents\)/);
    expect(src).toMatch(/setAwaitingApplication\(true\)/);
    // Confirm there's no shortcut to justPaid in the same handler.
    const handlerBlock = src.match(
      /onSucceeded=\{\(\) => \{[\s\S]*?\}\}\s*\n\s*onRetry=/,
    );
    expect(handlerBlock).not.toBeNull();
    expect(handlerBlock![0]).not.toMatch(/setJustPaid\(true\)/);
  });

  it("polls invoiceQueryKey every 1.5s while awaiting application", () => {
    expect(src).toMatch(/awaitingApplication[\s\S]*?setInterval/);
    expect(src).toMatch(/POLL_MS = 1500/);
  });

  it("times out polling at 30s and flips applicationTimedOut", () => {
    expect(src).toMatch(/TIMEOUT_MS = 30_000/);
    expect(src).toMatch(/setApplicationTimedOut\(true\)/);
  });

  it("flips justPaid only when balance decreases or status transitions to paid/partial_paid", () => {
    // The watch effect compares currentCents < pendingBalanceCents
    // OR inv.status === paid|partial_paid. Both paths flip justPaid.
    expect(src).toMatch(/currentCents < pendingBalanceCents/);
    expect(src).toMatch(
      /inv\.status === "paid" \|\| inv\.status === "partial_paid"/,
    );
    expect(src).toMatch(/setJustPaid\(true\)/);
  });

  it("renders portal-pay-awaiting branch while polling", () => {
    expect(src).toMatch(/data-testid="portal-pay-awaiting"/);
    expect(src).toMatch(/Processing your payment/);
  });

  it("renders portal-pay-awaiting-timeout branch with honest copy after 30s", () => {
    expect(src).toMatch(/data-testid="portal-pay-awaiting-timeout"/);
    expect(src).toMatch(/Payment is still processing/);
    expect(src).toMatch(/Stripe confirms it/);
  });

  it("success copy says 'A receipt will be emailed to you shortly' (not the prior 'will update once processing completes')", () => {
    // The receipt promise is now made AFTER backend confirms — i.e.,
    // we know the webhook fired, which is what triggers the receipt
    // email. So the message is honest.
    expect(src).toMatch(/A receipt will be emailed to you shortly/);
  });
});

describe("portalStatusBadge — customer-facing label", () => {
  const src = readFileSync(PORTAL_UTILS, "utf8");

  it("default fallback label is 'Awaiting payment', not 'Open'", () => {
    expect(src).toMatch(/label:\s*"Awaiting payment"/);
    // Confirm the legacy "Open" string is gone from the default branch.
    const defaultBlock = src.match(/default:\s*\n[\s\S]*?return\s*\{[\s\S]*?\};/);
    expect(defaultBlock).not.toBeNull();
    expect(defaultBlock![0]).not.toMatch(/label:\s*"Open"/);
  });
});
