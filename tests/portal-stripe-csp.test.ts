/**
 * Portal Stripe.js CSP allowlist — regression suite (2026-05-05).
 *
 * Covers the "Failed to load Stripe.js" runtime overlay that hit
 * customers clicking Pay Now on `PortalInvoiceDetail`. Two angles:
 *
 *   1. The helmet CSP defined in `server/index.ts` MUST allow the
 *      Stripe.js loader script (`https://js.stripe.com`) and the
 *      Elements iframe origins (`https://js.stripe.com`,
 *      `https://hooks.stripe.com`) plus the API origin
 *      (`https://api.stripe.com`) for `connect-src`. Without these
 *      entries the browser blocks `<script src="js.stripe.com/v3">`
 *      and Stripe.js surfaces the runtime-overlay error.
 *
 *   2. The portal checkout response shape is unchanged — the
 *      backend still returns the publishable key on the portal
 *      source so the client's `loadStripe(publishableKey)` call has
 *      a real value. We assert the shape via a static read of the
 *      Stripe adapter source (no live Stripe API call needed).
 *
 * The tests live in vitest's node environment; they don't boot the
 * full Express app. They read the configured CSP directly off the
 * source to assert intent — equivalent to a contract test on the
 * security-headers configuration. If a future PR removes the Stripe
 * allowlist entries, these tests fail at CI before customers see the
 * Pay button regress.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SERVER_INDEX = resolve(__dirname, "../server/index.ts");
const STRIPE_ADAPTER = resolve(
  __dirname,
  "../server/services/payments/providers/stripeAdapter.ts",
);

describe("CSP allows Stripe.js domains", () => {
  const src = readFileSync(SERVER_INDEX, "utf8");

  it("scriptSrc includes https://js.stripe.com (Stripe.js loader)", () => {
    expect(src).toMatch(/scriptSrc[\s\S]*?"https:\/\/js\.stripe\.com"/);
  });

  it("frameSrc includes https://js.stripe.com (Elements iframes)", () => {
    expect(src).toMatch(/frameSrc[\s\S]*?"https:\/\/js\.stripe\.com"/);
  });

  it("frameSrc includes https://hooks.stripe.com (3DS / SCA challenge frames)", () => {
    expect(src).toMatch(/frameSrc[\s\S]*?"https:\/\/hooks\.stripe\.com"/);
  });

  it("connectSrc includes https://api.stripe.com (PaymentIntent confirm)", () => {
    expect(src).toMatch(/connectSrc[\s\S]*?"https:\/\/api\.stripe\.com"/);
  });

  it("frameSrc no longer locks to 'none' (would block Stripe iframes)", () => {
    // The pre-2026-05-05 config had `frameSrc: ["'none'"]`. Confirm
    // we've moved off that and at minimum allow Stripe iframes.
    const frameSrcLine = src.match(/frameSrc:\s*\[(.*?)\]/s);
    expect(frameSrcLine).not.toBeNull();
    const inside = frameSrcLine![1];
    expect(inside).toMatch(/js\.stripe\.com/);
    // Defensive: should NOT keep 'none' alongside Stripe (helmet
    // semantics combine list entries; 'none' only takes effect when it
    // is the SOLE value, but it's clearer to keep it absent).
    expect(inside).not.toMatch(/'none'/);
  });
});

describe("Stripe adapter still exposes publishableKey on portal checkout", () => {
  const src = readFileSync(STRIPE_ADAPTER, "utf8");

  it("createCheckout returns publishableKey when source === 'portal'", () => {
    // Static read on the adapter ensures the response shape the
    // frontend depends on (CheckoutResponse.publishableKey) hasn't
    // been silently removed.
    expect(src).toMatch(
      /publishableKey:\s*\n?\s*input\.source === "portal" \? process\.env\.STRIPE_PUBLISHABLE_KEY/,
    );
  });

  it("checkout 503s when STRIPE_PUBLISHABLE_KEY is missing on portal source", () => {
    // The 503 path is what surfaces a clean "Stripe publishable key is
    // not configured" error to the client mutation, instead of letting
    // an undefined key flow into loadStripe() and produce the runtime
    // overlay. Confirms the env-config gate is still in place.
    expect(src).toMatch(
      /input\.source === "portal" && !process\.env\.STRIPE_PUBLISHABLE_KEY/,
    );
    expect(src).toMatch(/Stripe publishable key is not configured/);
  });
});

describe("Frontend Stripe load failures resolve to null (no Vite overlay)", () => {
  const PORTAL_INVOICE_DETAIL = resolve(
    __dirname,
    "../client/src/pages/portal/PortalInvoiceDetail.tsx",
  );
  const PORTAL_PAYMENT_METHODS = resolve(
    __dirname,
    "../client/src/pages/portal/PortalPaymentMethods.tsx",
  );

  it("PortalInvoiceDetail.getStripePromise catches loadStripe rejections", () => {
    const src = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");
    // 2026-05-05 Connect fix: signature is now
    //   loadStripe(publishableKey, stripeAccount ? { stripeAccount } : undefined)
    //     .catch(...)
    // The regex matches the multi-line invocation regardless of whitespace.
    expect(src).toMatch(/loadStripe\([\s\S]*?publishableKey,[\s\S]*?\)\.catch\(/);
  });

  it("PortalInvoiceDetail renders a stripeLoadFailed branch in the Pay modal", () => {
    const src = readFileSync(PORTAL_INVOICE_DETAIL, "utf8");
    expect(src).toMatch(/stripeLoadFailed/);
    expect(src).toMatch(/Online payments are temporarily unavailable/);
    expect(src).toMatch(/portal-stripe-load-failed/);
  });

  it("PortalPaymentMethods.getStripePromise catches loadStripe rejections", () => {
    const src = readFileSync(PORTAL_PAYMENT_METHODS, "utf8");
    expect(src).toMatch(/loadStripe\(publishableKey\)\.catch\(/);
  });
});
