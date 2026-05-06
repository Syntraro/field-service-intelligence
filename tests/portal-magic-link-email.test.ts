/**
 * Portal magic-link email + URL helpers — regression suite (2026-05-05).
 *
 * Two regressions covered:
 *
 *   1. `appBase()` precedence bug. The pre-2026-05-05 magic-link route
 *      used a local constant whose ternary parsed as
 *      `(BASE_URL || REPLIT_DEV_DOMAIN) ? https://${REPLIT_DEV_DOMAIN}
 *      : localhost`. When `BASE_URL` was set but `REPLIT_DEV_DOMAIN`
 *      was not, the resolved URL became `https://undefined/...`.
 *      Customers received Sign In emails pointing at a non-existent
 *      host. Fixed by routing the magic-link route through the
 *      canonical `appBase()` resolver in `server/lib/portalUrls.ts`.
 *
 *   2. Magic-link email body had a styled <a> button only; no
 *      visible plaintext fallback URL and no Resend `text` field.
 *      Plaintext-only / locked-down clients showed an empty email.
 *      Fixed by emitting a fallback paragraph below the button + a
 *      plaintext `text` field.
 *
 * IMPORTANT: vi.mock calls are hoisted above imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

vi.mock("../server/db", () => ({
  db: {},
}));

vi.mock("../server/storage/invoices", () => ({
  invoiceRepository: { getInvoice: vi.fn() },
}));

vi.mock("../server/services/payments/paymentApplicationService", () => ({
  paymentApplicationService: { createCheckout: vi.fn(), createMultiCheckout: vi.fn() },
}));

vi.mock("../server/services/entitlementService", () => ({
  entitlementService: { getEntitlement: vi.fn() },
}));

vi.mock("../server/services/invoicePdfService", () => ({
  generateInvoicePdf: vi.fn(),
}));

vi.mock("../server/storage/index", () => ({ storage: {} }));

vi.mock("../server/auth/tenantIsolation", () => ({
  rateLimitPerTenant: () => (_req: any, _res: any, next: any) => next(),
}));

// Capture the args the magic-link route hands to Resend so tests can
// inspect the rendered email body without actually sending mail.
const resendSendSpy = vi.fn(async (_args: any) => ({ data: { id: "res_test" }, error: null }));
vi.mock("../server/resendClient", () => ({
  getResendClient: vi.fn(async () => ({
    client: { emails: { send: resendSendSpy } },
    fromEmail: "notifications@mail.syntraro.com",
    defaultFromHeader: "Notifications <notifications@mail.syntraro.com>",
    defaultReplyTo: undefined,
  })),
}));

// We need targeted control over the contact + entitlement + portal-magic-token
// paths. Patch the `db` module's `select` / `insert` chains to return the rows
// the magic-link route expects.
import { db } from "../server/db";
const mockedDb = db as any;

function setupDbMocks(opts: {
  contact: {
    id: string;
    companyId: string;
    customerCompanyId: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  customerPortalEnabled: boolean;
  companyName: string | null;
}) {
  // The route runs three reads in sequence:
  //   1. SELECT … FROM contact_persons WHERE email = ? LIMIT 1
  //   2. (entitlement check via service — mocked elsewhere)
  //   3. SELECT name FROM companies WHERE id = ? LIMIT 1
  // Plus one write:
  //   - INSERT INTO portal_magic_tokens
  //
  // We chain `select().from().where().limit()` and `insert().values()` to
  // return the right shape for each call in order.
  let selectCallIndex = 0;
  mockedDb.select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          const idx = selectCallIndex++;
          if (idx === 0) {
            return opts.contact ? [opts.contact] : [];
          }
          // Company name lookup
          return opts.companyName ? [{ name: opts.companyName }] : [];
        }),
      })),
    })),
  }));
  mockedDb.insert = vi.fn(() => ({
    values: vi.fn(async () => undefined),
  }));
}

// ─── App harness ─────────────────────────────────────────────────────────────

import express from "express";
import request from "supertest";

import portalRouter from "../server/routes/portal";
import { entitlementService } from "../server/services/entitlementService";
import { appBase } from "../server/lib/portalUrls";
import { buildPortalInvoiceUrl } from "../server/lib/portalUrls";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/portal", portalRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.statusCode ?? err.status ?? 500;
    res.status(status).json({ error: err.message ?? "Internal error" });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  resendSendSpy.mockClear();
  resendSendSpy.mockResolvedValue({ data: { id: "res_test" }, error: null });
  (entitlementService.getEntitlement as any).mockResolvedValue({ enabled: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. appBase() env precedence
// ═══════════════════════════════════════════════════════════════════════════

describe("appBase() env-var precedence", () => {
  let originalAppUrl: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalReplitDomain: string | undefined;

  beforeEach(() => {
    originalAppUrl = process.env.APP_URL;
    originalBaseUrl = process.env.BASE_URL;
    originalReplitDomain = process.env.REPLIT_DEV_DOMAIN;
    delete process.env.APP_URL;
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DEV_DOMAIN;
  });

  afterEach(() => {
    if (originalAppUrl !== undefined) process.env.APP_URL = originalAppUrl;
    else delete process.env.APP_URL;
    if (originalBaseUrl !== undefined) process.env.BASE_URL = originalBaseUrl;
    else delete process.env.BASE_URL;
    if (originalReplitDomain !== undefined) process.env.REPLIT_DEV_DOMAIN = originalReplitDomain;
    else delete process.env.REPLIT_DEV_DOMAIN;
  });

  it("uses APP_URL when set", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.BASE_URL = "https://base.example.com";
    expect(appBase()).toBe("https://app.example.com");
  });

  it("uses BASE_URL when APP_URL is not set, REPLIT_DEV_DOMAIN missing", () => {
    process.env.BASE_URL = "https://base.example.com";
    expect(appBase()).toBe("https://base.example.com");
    // Critical regression check: must NOT produce `https://undefined`.
    expect(appBase()).not.toMatch(/undefined/);
  });

  it("uses https://${REPLIT_DEV_DOMAIN} when only that env is set", () => {
    process.env.REPLIT_DEV_DOMAIN = "test-domain.replit.dev";
    expect(appBase()).toBe("https://test-domain.replit.dev");
  });

  it("falls back to http://localhost:5000 when nothing is set", () => {
    expect(appBase()).toBe("http://localhost:5000");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. buildPortalInvoiceUrl threads the access token
// ═══════════════════════════════════════════════════════════════════════════

describe("buildPortalInvoiceUrl token threading", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://app.example.com";
  });
  afterEach(() => {
    delete process.env.APP_URL;
  });

  it("returns a token-less URL when no token is supplied", () => {
    const url = buildPortalInvoiceUrl("inv_123");
    expect(url).toBe("https://app.example.com/portal/invoices/inv_123");
  });

  it("appends ?t=<encoded token> when a token is supplied", () => {
    const url = buildPortalInvoiceUrl("inv_123", "abc%def$+xyz");
    expect(url).toBe(
      "https://app.example.com/portal/invoices/inv_123?t=abc%25def%24%2Bxyz",
    );
  });

  it("returns empty string when invoiceId is empty", () => {
    expect(buildPortalInvoiceUrl("")).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Magic-link email body — request-link route
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/portal/auth/request-link email body", () => {
  let originalAppUrl: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalReplitDomain: string | undefined;

  beforeEach(() => {
    originalAppUrl = process.env.APP_URL;
    originalBaseUrl = process.env.BASE_URL;
    originalReplitDomain = process.env.REPLIT_DEV_DOMAIN;
  });
  afterEach(() => {
    if (originalAppUrl !== undefined) process.env.APP_URL = originalAppUrl;
    else delete process.env.APP_URL;
    if (originalBaseUrl !== undefined) process.env.BASE_URL = originalBaseUrl;
    else delete process.env.BASE_URL;
    if (originalReplitDomain !== undefined) process.env.REPLIT_DEV_DOMAIN = originalReplitDomain;
    else delete process.env.REPLIT_DEV_DOMAIN;
  });

  it("uses APP_URL — never produces 'https://undefined'", async () => {
    process.env.APP_URL = "https://app.example.com";
    delete process.env.BASE_URL;
    delete process.env.REPLIT_DEV_DOMAIN;

    setupDbMocks({
      contact: {
        id: "contact_1",
        companyId: "co_1",
        customerCompanyId: "cust_1",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
      customerPortalEnabled: true,
      companyName: "Acme HVAC",
    });
    (entitlementService.getEntitlement as any).mockResolvedValue({ enabled: true });

    const res = await request(makeApp())
      .post("/api/portal/auth/request-link")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(200);
    expect(resendSendSpy).toHaveBeenCalledTimes(1);
    const args = resendSendSpy.mock.calls[0][0];

    // The HTML body must reference the canonical APP_URL host.
    expect(args.html).toContain("https://app.example.com/portal/verify?token=");
    // Critical regression check: NEVER 'https://undefined'.
    expect(args.html).not.toContain("https://undefined");
    expect(args.text).not.toContain("https://undefined");
  });

  it("uses BASE_URL when APP_URL is unset and REPLIT_DEV_DOMAIN is unset (the BUG case)", async () => {
    delete process.env.APP_URL;
    process.env.BASE_URL = "https://base-only.example.com";
    delete process.env.REPLIT_DEV_DOMAIN;

    setupDbMocks({
      contact: {
        id: "contact_1",
        companyId: "co_1",
        customerCompanyId: "cust_1",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
      customerPortalEnabled: true,
      companyName: "Acme HVAC",
    });

    const res = await request(makeApp())
      .post("/api/portal/auth/request-link")
      .send({ email: "test@example.com" });

    expect(res.status).toBe(200);
    const args = resendSendSpy.mock.calls[0][0];
    expect(args.html).toContain("https://base-only.example.com/portal/verify?token=");
    // The exact regression — the broken constant produced this string:
    expect(args.html).not.toContain("https://undefined");
  });

  it("emits a visible plaintext URL fallback in the HTML body", async () => {
    process.env.APP_URL = "https://app.example.com";

    setupDbMocks({
      contact: {
        id: "contact_1",
        companyId: "co_1",
        customerCompanyId: "cust_1",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
      customerPortalEnabled: true,
      companyName: "Acme HVAC",
    });

    await request(makeApp())
      .post("/api/portal/auth/request-link")
      .send({ email: "test@example.com" });

    const args = resendSendSpy.mock.calls[0][0];
    // Fallback paragraph copy.
    expect(args.html).toMatch(/copy and paste this link/i);
    // The href appears at least twice (the styled button AND the
    // visible plaintext anchor).
    const hrefMatches = args.html.match(/\/portal\/verify\?token=/g) ?? [];
    expect(hrefMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("populates the Resend `text` field for plaintext-only clients", async () => {
    process.env.APP_URL = "https://app.example.com";

    setupDbMocks({
      contact: {
        id: "contact_1",
        companyId: "co_1",
        customerCompanyId: "cust_1",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
      customerPortalEnabled: true,
      companyName: "Acme HVAC",
    });

    await request(makeApp())
      .post("/api/portal/auth/request-link")
      .send({ email: "test@example.com" });

    const args = resendSendSpy.mock.calls[0][0];
    expect(typeof args.text).toBe("string");
    expect(args.text).toContain("https://app.example.com/portal/verify?token=");
    expect(args.text).toMatch(/expires in 15 minutes/i);
  });

  it("returns generic 200 (no enumeration leak) when contact is missing", async () => {
    setupDbMocks({
      contact: null,
      customerPortalEnabled: true,
      companyName: null,
    });

    const res = await request(makeApp())
      .post("/api/portal/auth/request-link")
      .send({ email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent a login link/i);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });
});
