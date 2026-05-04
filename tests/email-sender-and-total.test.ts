/**
 * Invoice email — total + sender header regression tests (2026-05-03).
 *
 * Covers the two fixes shipped this PR:
 *
 *   (1) `templateDataBuilder.buildInvoiceTemplateData` reads
 *       `invoice.total` (not `(invoice as any).totalAmount`) so the
 *       `{{INVOICE_TOTAL}}` template variable renders the actual
 *       money value, not an empty string.
 *
 *   (2) `buildSenderHeaders(tenantId)` derives the outbound `from`
 *       display name from `companies.name` and the `replyTo` from
 *       `companies.email`, while keeping the verified Resend sender
 *       email address fixed at `RESEND_FROM_EMAIL`. Falls back
 *       gracefully when the company row is absent or the email is
 *       malformed.
 *
 * IMPORTANT: vi.mock calls are hoisted above imports by the vitest
 * transformer. The mock factories must be self-contained.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Storage mock — getInvoice + getCompanyById + the rest are stubbed
//    here so the builder runs without a real DB. Each test sets the
//    invoice row + company row via `setInvoice` / `setCompany`.
vi.mock("../server/storage/index", () => ({
  storage: {
    getInvoice: vi.fn(),
    getClient: vi.fn(),
    getCompanyById: vi.fn(),
    getCustomerCompany: vi.fn(),
  },
}));

// `entitlementService` — pay-link path is gated on this. Tests don't
// exercise the URL itself; we just stub `getEntitlement` so it
// returns disabled (which is the production reality for trial plans
// per the audit).
vi.mock("../server/services/entitlementService", () => ({
  entitlementService: {
    getEntitlement: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

// The Resend client itself. We don't issue real network calls; just
// confirm `buildSenderHeaders` reads the env-configured platform
// sender and composes the right `from` string.
vi.mock("../server/resendClient", async () => {
  const actual: any = await vi.importActual("../server/resendClient");
  return {
    ...actual,
    getResendClient: vi.fn().mockResolvedValue({
      client: { emails: { send: vi.fn() } },
      fromEmail: "notifications@mail.syntraro.com",
      defaultFromHeader: "Notifications <notifications@mail.syntraro.com>",
      defaultReplyTo: undefined,
    }),
  };
});

// ── Imports under test (after mocks) ─────────────────────────────────
import { templateDataBuilder } from "../server/services/templateDataBuilder";
import { buildSenderHeaders, bodyToHtml } from "../server/services/emailDispatchService";
import { formatFromHeader, isPlausibleEmail } from "../server/resendClient";
import { storage } from "../server/storage/index";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_INVOICE_ID = "00000000-0000-0000-0000-000000000002";
const TEST_LOCATION_ID = "00000000-0000-0000-0000-000000000003";

function makeInvoice(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: TEST_INVOICE_ID,
    companyId: TEST_TENANT_ID,
    invoiceNumber: 1181,
    status: "awaiting_payment",
    locationId: TEST_LOCATION_ID,
    total: "475.00",
    balance: "475.00",
    issuedAt: new Date("2026-04-01"),
    dueDate: new Date("2026-05-01"),
    ...overrides,
  };
}

function makeCompany(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: TEST_TENANT_ID,
    name: "Samcor Mechanical Inc.",
    email: "ops@samcor.ca",
    address: null,
    city: null,
    provinceState: null,
    postalCode: null,
    phone: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("templateDataBuilder.buildInvoiceTemplateData — INVOICE_TOTAL field-name fix", () => {
  it("renders INVOICE_TOTAL as $475.00 when invoice.total = '475.00'", async () => {
    (storage.getInvoice as any).mockResolvedValueOnce(makeInvoice());
    (storage.getClient as any).mockResolvedValueOnce({ id: TEST_LOCATION_ID, parentCompanyId: null, companyName: "Acme" });
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany());

    const data = await templateDataBuilder.buildInvoiceTemplateData(TEST_TENANT_ID, TEST_INVOICE_ID);

    expect(data.INVOICE_TOTAL).toBe("$475.00");
  });

  it("regression: would FAIL if code reverted to `(invoice as any).totalAmount`", async () => {
    // The schema column is `total`. A row that lacks `totalAmount`
    // should still produce a non-empty INVOICE_TOTAL. This test
    // tightens the contract — if anyone reintroduces the old
    // `totalAmount` lookup, INVOICE_TOTAL goes empty and this fails.
    const invoice = makeInvoice({ total: "1234.56" });
    // Explicitly remove any `totalAmount` shape to make the contract
    // unambiguous: the row has `total` only.
    delete (invoice as any).totalAmount;
    (storage.getInvoice as any).mockResolvedValueOnce(invoice);
    (storage.getClient as any).mockResolvedValueOnce({ id: TEST_LOCATION_ID, parentCompanyId: null, companyName: "Acme" });
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany());

    const data = await templateDataBuilder.buildInvoiceTemplateData(TEST_TENANT_ID, TEST_INVOICE_ID);

    expect(data.INVOICE_TOTAL).not.toBe("");
    expect(data.INVOICE_TOTAL).toBe("$1234.56");
  });

  it("renders empty INVOICE_TOTAL only when invoice.total is null/undefined (legitimate empty)", async () => {
    (storage.getInvoice as any).mockResolvedValueOnce(makeInvoice({ total: null }));
    (storage.getClient as any).mockResolvedValueOnce({ id: TEST_LOCATION_ID, parentCompanyId: null, companyName: "Acme" });
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany());

    const data = await templateDataBuilder.buildInvoiceTemplateData(TEST_TENANT_ID, TEST_INVOICE_ID);

    expect(data.INVOICE_TOTAL).toBe("");
  });

  it("INVOICE_BALANCE falls back to invoice.total when balance is null (no longer to phantom totalAmount)", async () => {
    (storage.getInvoice as any).mockResolvedValueOnce(makeInvoice({ balance: null, total: "200.00" }));
    (storage.getClient as any).mockResolvedValueOnce({ id: TEST_LOCATION_ID, parentCompanyId: null, companyName: "Acme" });
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany());

    const data = await templateDataBuilder.buildInvoiceTemplateData(TEST_TENANT_ID, TEST_INVOICE_ID);

    expect(data.INVOICE_BALANCE).toBe("$200.00");
  });
});

describe("buildSenderHeaders — per-tenant From + Reply-To", () => {
  it("composes `${companies.name} <${RESEND_FROM_EMAIL}>` and uses companies.email as replyTo", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany());

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    expect(headers.from).toBe("Samcor Mechanical Inc. <notifications@mail.syntraro.com>");
    expect(headers.replyTo).toBe("ops@samcor.ca");
  });

  it("preserves the verified platform domain regardless of tenant identity", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(
      makeCompany({ name: "Other Tenant", email: "owner@example.com" }),
    );

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    // The display name varies with tenant; the email-address portion
    // (after the angle brackets) MUST always be the verified Resend
    // domain. This is the load-bearing security/deliverability
    // contract — never let a tenant inject a different from email.
    expect(headers.from).toMatch(/<notifications@mail\.syntraro\.com>$/);
  });

  it("falls back to platform default when company.name is empty", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany({ name: "" }));

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    expect(headers.from).toBe("Notifications <notifications@mail.syntraro.com>");
  });

  it("omits replyTo when company.email is missing", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany({ email: null }));

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    expect(headers.replyTo).toBeUndefined();
  });

  it("omits replyTo when company.email is malformed (does not crash, does not set bad header)", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(makeCompany({ email: "not-an-email" }));

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    expect(headers.replyTo).toBeUndefined();
    expect(headers.from).toContain("Samcor Mechanical Inc.");
  });

  it("falls back to platform default when storage.getCompanyById throws", async () => {
    (storage.getCompanyById as any).mockRejectedValueOnce(new Error("DB unavailable"));

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    // Branding lookup must never block outbound email.
    expect(headers.from).toBe("Notifications <notifications@mail.syntraro.com>");
    expect(headers.replyTo).toBeUndefined();
  });

  it("strips display-name characters that would break RFC 5322 header parsing", async () => {
    (storage.getCompanyById as any).mockResolvedValueOnce(
      makeCompany({ name: 'Samcor "Mech" <evil>\r\nInjected: header' }),
    );

    const headers = await buildSenderHeaders(TEST_TENANT_ID);

    // No < > " \r \n in the rendered display name — these would
    // either malform the header or open a header-injection vector.
    expect(headers.from).not.toMatch(/[<>"\r\n].*</);
    expect(headers.from).toMatch(/<notifications@mail\.syntraro\.com>$/);
  });
});

describe("formatFromHeader / isPlausibleEmail (resendClient.ts pure helpers)", () => {
  it("formatFromHeader uses default name when input is null/empty/whitespace", () => {
    expect(formatFromHeader(null, "x@y.com")).toBe("Notifications <x@y.com>");
    expect(formatFromHeader("", "x@y.com")).toBe("Notifications <x@y.com>");
    expect(formatFromHeader("   ", "x@y.com")).toBe("Notifications <x@y.com>");
  });

  it("formatFromHeader strips header-injection characters", () => {
    expect(formatFromHeader('A"B<C>D\rE\nF', "x@y.com")).toBe("ABCDEF <x@y.com>");
  });

  it("isPlausibleEmail accepts well-formed addresses", () => {
    expect(isPlausibleEmail("user@example.com")).toBe(true);
    expect(isPlausibleEmail("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("isPlausibleEmail rejects obvious bad shapes", () => {
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail(undefined)).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("no-at-sign")).toBe(false);
    expect(isPlausibleEmail("@no-local-part.com")).toBe(false);
    expect(isPlausibleEmail("trailing-at@")).toBe(false);
    expect(isPlausibleEmail("has space@example.com")).toBe(false);
    expect(isPlausibleEmail("has<bracket@example.com")).toBe(false);
    expect(isPlausibleEmail("has\rCR@example.com")).toBe(false);
  });
});

describe("bodyToHtml — Pay Invoice button rendering (2026-05-03)", () => {
  // The default invoice / invoice_reminder templates emit the
  // sentinel `__PAY_INVOICE_BUTTON__` (literal, not a `{{VAR}}`).
  // `bodyToHtml` swaps it for a styled button block when paymentUrl
  // is non-empty, strips it otherwise. Templates that don't contain
  // the sentinel are unaffected.
  const SAMPLE_BODY_WITH_SENTINEL =
    "Total amount: $475.00\nDue date: June 2, 2026\n\n" +
    "__PAY_INVOICE_BUTTON__" +
    "If you have any questions, please contact us.";
  const PORTAL_URL = "http://localhost:5000/portal/invoices/abc-123";

  it("emits a styled <a>Pay Invoice</a> when paymentUrl is non-empty", () => {
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: PORTAL_URL });

    // The button anchor must be present, link to the portal URL,
    // carry inline-styled background-color (Outlook needs this on
    // the <a> itself, not just an outer element), and read
    // "Pay Invoice".
    expect(html).toContain('<a href="http://localhost:5000/portal/invoices/abc-123"');
    expect(html).toContain("Pay Invoice</a>");
    // 2026-05-03 polish (round 2): button recolored from navy
    // (#111827) to the Syntraro brand green (#76B054, matches the
    // `--brand` / `--primary` token used by primary app actions).
    expect(html).toMatch(/background-color:\s*#76B054/i);
    expect(html).toMatch(/border-radius:\s*6px/i);

    // Wrapping <table role="presentation"> for Outlook click-area sizing.
    expect(html).toContain('role="presentation"');

    // Sentinel itself must be gone after substitution.
    expect(html).not.toContain("__PAY_INVOICE_BUTTON__");
  });

  it("renders a fallback paragraph with a plain link beneath the button", () => {
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: PORTAL_URL });

    expect(html).toContain("If the button doesn't work, copy and paste");
    // The fallback link uses the same URL; it appears AFTER the
    // button anchor (the button is the first occurrence).
    const buttonIdx = html.indexOf("Pay Invoice</a>");
    const fallbackIdx = html.indexOf("If the button doesn't work");
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(buttonIdx);
  });

  it("strips the sentinel and emits NO button when paymentUrl is empty", () => {
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: "" });

    expect(html).not.toContain("__PAY_INVOICE_BUTTON__");
    expect(html).not.toContain("Pay Invoice");
    expect(html).not.toContain("If the button doesn't work");
    // Surrounding content is preserved verbatim.
    expect(html).toContain("Total amount: $475.00");
    expect(html).toContain("If you have any questions, please contact us.");
  });

  it("strips the sentinel when opts is omitted entirely (legacy callers)", () => {
    // sendQuoteEmail / sendJobEmail / sendPaymentReceiptEmail call
    // bodyToHtml(body) without opts. Their templates don't include
    // the sentinel, but the safety net here is: even if a template
    // accidentally did include it, the button doesn't render.
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL);

    expect(html).not.toContain("__PAY_INVOICE_BUTTON__");
    expect(html).not.toContain("Pay Invoice");
  });

  it("strips the sentinel when paymentUrl is whitespace-only", () => {
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: "   " });

    expect(html).not.toContain("Pay Invoice");
  });

  it("does not render any duplicate raw URL above the button (no auto-linkify of sentinel position)", () => {
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: PORTAL_URL });

    // The URL appears exactly twice — once in the button <a href>,
    // once in the fallback paragraph's <a href> + text. There must
    // be NO bare `http://…` on its own line above (which would be
    // the legacy "Pay securely online: <url>" plain-text format).
    const occurrences = (html.match(/http:\/\/localhost:5000\/portal\/invoices\/abc-123/g) ?? []).length;
    // 1) anchor href on button, 2) anchor href on fallback, 3) fallback display text
    expect(occurrences).toBe(3);
    // Specifically check the legacy plain-text marker is absent.
    expect(html).not.toContain("Pay securely online:");
  });

  it("HTML-escapes the URL inside attribute values (defence in depth)", () => {
    // The portal URL is server-generated and trusted, but if anything
    // ever slipped a quote/angle-bracket through, the encoder must
    // catch it. NOT a real attack vector — defence in depth.
    const dangerousUrl = 'http://localhost:5000/portal?x="><script>alert(1)</script>';
    const html = bodyToHtml(SAMPLE_BODY_WITH_SENTINEL, { paymentUrl: dangerousUrl });

    // No raw <script>; the escaped form should appear instead.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves bodies that don't contain the sentinel (quote / job / receipt parity)", () => {
    const quoteBody =
      "Hello Acme,\n\nQuoted amount: $1,500.00\n\nPlease contact us if you would like to proceed.";
    const html = bodyToHtml(quoteBody);

    expect(html).not.toContain("Pay Invoice");
    expect(html).not.toContain("__PAY_INVOICE_BUTTON__");
    expect(html).toContain("Quoted amount: $1,500.00");
    expect(html).toContain("Please contact us if you would like to proceed.");
  });
});

describe("bodyToHtml — **bold** marker rendering (2026-05-03 polish round 3)", () => {
  // The system default invoice + reminder templates use `**X**` to
  // mark the headline total / outstanding balance line for bolding.
  // `bodyToHtml` substitutes those markers with `<strong>…</strong>`.
  // Tenants editing a saved template can use the same syntax;
  // bodies without `**` markers are unaffected.

  it("renders **X** as <strong>X</strong>", () => {
    const html = bodyToHtml("Total: **$475.00**");
    expect(html).toContain("<strong>$475.00</strong>");
    // The asterisks themselves should be gone after substitution.
    expect(html).not.toContain("**$475.00**");
  });

  it("renders multiple bold runs on the same line independently (non-greedy)", () => {
    const html = bodyToHtml("**Total: $475.00** and **Balance: $200.00**");
    expect(html).toContain("<strong>Total: $475.00</strong>");
    expect(html).toContain("<strong>Balance: $200.00</strong>");
    // Non-greedy must NOT bold the entire span between the first
    // `**` and the last `**` — verify that the literal " and " is
    // outside any <strong> wrapper by checking it appears between
    // the two closing/opening tags.
    expect(html).toContain("</strong> and <strong>");
  });

  it("does not let bold markers span newlines (regression guard)", () => {
    // If a stray `**` appears in user copy, it must NOT bold the
    // rest of the email. The opening `**` here has no matching
    // closer on its own line, so nothing should be bolded.
    const body = "Total: **$475.00\n\nIf you have any questions, please reply.";
    const html = bodyToHtml(body);
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("</strong>");
    // The literal asterisks remain in the output — the regex
    // simply didn't match, which is the intended fail-safe.
    expect(html).toContain("**$475.00");
  });

  it("leaves bodies without ** markers entirely unchanged", () => {
    const body = "Hello Acme,\n\nYour invoice is ready.\n\nThank you.";
    const html = bodyToHtml(body);
    expect(html).not.toContain("<strong>");
    expect(html).toContain("Hello Acme,");
    expect(html).toContain("Your invoice is ready.");
    expect(html).toContain("Thank you.");
  });

  it("ignores empty `****` tokens (no inner content)", () => {
    const html = bodyToHtml("Empty: ****");
    expect(html).not.toContain("<strong></strong>");
    // The literal `****` should remain unmodified.
    expect(html).toContain("****");
  });

  it("plays correctly with the Pay-Invoice button sentinel in the same body", () => {
    // This mirrors the actual default-template shape: bold totals
    // line + sentinel together. Both substitutions must fire.
    const body =
      "**Total: $475.00**\nDue June 2, 2026\n\n" +
      "Thank you,\nSamcor Mechanical Inc.\n" +
      "__PAY_INVOICE_BUTTON__";
    const html = bodyToHtml(body, { paymentUrl: "http://localhost:5000/portal/invoices/abc-123" });
    expect(html).toContain("<strong>Total: $475.00</strong>");
    expect(html).toContain("Pay Invoice</a>");
    expect(html).not.toContain("**Total");
    expect(html).not.toContain("__PAY_INVOICE_BUTTON__");
  });

  it("HTML-escapes content inside the bold markers (defence in depth)", () => {
    // Bold markers are applied AFTER htmlEscape, so user content
    // inside `**…**` must already be entity-safe. Verify nothing
    // about the wrapping reintroduces a raw tag.
    const html = bodyToHtml("**<script>alert(1)</script>**");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>");
  });
});
