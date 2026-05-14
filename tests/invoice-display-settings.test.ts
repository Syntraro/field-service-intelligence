/**
 * Invoice Display Settings — tests (2026-05-05)
 *
 * Layers covered:
 *   1. Pure resolver — `resolveInvoiceDisplayPolicy` precedence + the
 *      client-message rendering rule.
 *   2. `resolvePrefillClientMessage` — invoice-creation prefill source.
 *   3. Storage integration — tenant-default client message flowing into
 *      newly created invoices via `createStandaloneInvoice`.
 *   4. Regression guards (added 2026-05-06 tighten pass):
 *        a. PDF generation does not throw when policy.showLineItems = false.
 *        b. Email body never references CLIENT_MESSAGE / INVOICE_SUMMARY.
 *           The canonical INVOICE_TEMPLATE_VARIABLES catalog and the
 *           buildInvoiceTemplateData return shape are pinned.
 *        c. Updating the tenant default client message does NOT re-sync
 *           into existing `invoices.client_message`.
 *
 * The exclusions test below also asserts that internal-only fields
 * (notes_internal) are never modeled in the resolved policy shape, so a
 * future refactor can't accidentally leak them onto a customer surface.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  companySettings,
  customerCompanies,
  clientLocations,
  invoices,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  resolveInvoiceDisplayPolicy,
  resolvePrefillClientMessage,
  invoiceVisibilityDiffersFromTenant,
  DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS,
} from "@shared/invoiceDisplayPolicy";
import { invoiceRepository } from "../server/storage/invoices";
import { generateInvoicePdf } from "../server/services/invoicePdfService";
import { INVOICE_TEMPLATE_VARIABLES } from "../server/constants/templateVariables";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PREFIX = "inv_display_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({
    id: companyId,
    name: `${TEST_PREFIX}company`,
  });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "admin",
    status: "active",
    fullName: `${TEST_PREFIX}Owner`,
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer_co`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    selectedMonths: [],
  });
}

async function cleanup() {
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(companySettings).where(eq(companySettings.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

beforeAll(async () => {
  await createFixtures();
});

afterAll(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// 1. Pure resolver — precedence + client-message rule
// ---------------------------------------------------------------------------

describe("resolveInvoiceDisplayPolicy — precedence", () => {
  it("falls back to schema defaults when neither tenant nor invoice supply a value", () => {
    const policy = resolveInvoiceDisplayPolicy({ tenantSettings: null, invoice: null });
    expect(policy.showLineItems).toBe(true);
    expect(policy.showQuantities).toBe(true);
    expect(policy.showLogo).toBe(false);
    expect(policy.showCompanyAddress).toBe(true);
    expect(policy.showJobNumber).toBe(false);
    expect(policy.showSummary).toBe(false);
  });

  it("uses tenant defaults when invoice has no override", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: {
        invoiceShowLineItems: false,
        invoiceShowQuantities: false,
        // showLogo is intentionally NOT asserted here — it's pinned to
        // false at the resolver level (feature not yet supported); see
        // the "unsupported features" describe block below.
      },
      invoice: {},
    });
    expect(policy.showLineItems).toBe(false);
    expect(policy.showQuantities).toBe(false);
  });

  it("invoice-level override wins over tenant default for line items", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowLineItems: false },
      invoice: { showLineItems: true },
    });
    expect(policy.showLineItems).toBe(true);
  });

  it("tenant-only flags ignore invoice-level (no override path)", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowJobNumber: true },
      // showJobNumber doesn't exist on the per-invoice shape — tenant wins
      invoice: {},
    });
    expect(policy.showJobNumber).toBe(true);
  });
});

describe("resolveInvoiceDisplayPolicy — client message rule", () => {
  it("hides client message entirely when tenant toggle is off, even with invoice content", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowClientMessage: false },
      invoice: { clientMessage: "Thanks for your business!" },
    });
    expect(policy.showClientMessage).toBe(false);
    expect(policy.clientMessage).toBeNull();
  });

  it("renders the per-invoice content when tenant toggle is on", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: {
        invoiceShowClientMessage: true,
        invoiceDefaultClientMessage: "(default)",
      },
      invoice: { clientMessage: "Per-invoice override text" },
    });
    expect(policy.showClientMessage).toBe(true);
    expect(policy.clientMessage).toBe("Per-invoice override text");
  });

  it("does NOT echo the tenant default text at render time when invoice content is empty", () => {
    // The tenant default is a PREFILL, not a render-time fallback.
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: {
        invoiceShowClientMessage: true,
        invoiceDefaultClientMessage: "(default)",
      },
      invoice: { clientMessage: "" },
    });
    expect(policy.showClientMessage).toBe(true);
    expect(policy.clientMessage).toBeNull();
  });

  it("trims whitespace-only invoice content to null", () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowClientMessage: true },
      invoice: { clientMessage: "   \n\t  " },
    });
    expect(policy.clientMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Pure prefill resolver
// ---------------------------------------------------------------------------

describe("resolvePrefillClientMessage", () => {
  it("returns null when tenant has the toggle off", () => {
    expect(
      resolvePrefillClientMessage({
        invoiceShowClientMessage: false,
        invoiceDefaultClientMessage: "Hello!",
      }),
    ).toBeNull();
  });

  it("returns the tenant default text when toggle is on and text is non-empty", () => {
    expect(
      resolvePrefillClientMessage({
        invoiceShowClientMessage: true,
        invoiceDefaultClientMessage: "Hello!",
      }),
    ).toBe("Hello!");
  });

  it("returns null when tenant text is blank/whitespace", () => {
    expect(
      resolvePrefillClientMessage({
        invoiceShowClientMessage: true,
        invoiceDefaultClientMessage: "   ",
      }),
    ).toBeNull();
  });

  it("returns null on a fresh tenant (no row written yet)", () => {
    expect(resolvePrefillClientMessage(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. invoiceVisibilityDiffersFromTenant — UI helper
// ---------------------------------------------------------------------------

describe("invoiceVisibilityDiffersFromTenant", () => {
  it("returns false when invoice flags match tenant defaults", () => {
    const tenant = { invoiceShowLineItems: true, invoiceShowQuantities: true };
    const invoice = { showLineItems: true, showQuantity: true };
    expect(invoiceVisibilityDiffersFromTenant(tenant, invoice)).toBe(false);
  });

  it("returns true when an invoice flag overrides the tenant default", () => {
    const tenant = { invoiceShowLineItems: true };
    const invoice = { showLineItems: false };
    expect(invoiceVisibilityDiffersFromTenant(tenant, invoice)).toBe(true);
  });

  it("returns false when invoice flag is undefined (no override)", () => {
    expect(
      invoiceVisibilityDiffersFromTenant(
        { invoiceShowLineItems: false },
        { /* no override */ },
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Storage integration — prefill flowing into a fresh invoice
// ---------------------------------------------------------------------------

describe("createStandaloneInvoice — prefill from tenant defaults", () => {
  async function setTenant(opts: { showClientMessage: boolean; defaultMessage: string | null }) {
    await db
      .insert(companySettings)
      .values({
        companyId,
        userId,
        invoiceShowClientMessage: opts.showClientMessage,
        invoiceDefaultClientMessage: opts.defaultMessage,
      })
      .onConflictDoUpdate({
        target: companySettings.companyId,
        set: {
          invoiceShowClientMessage: opts.showClientMessage,
          invoiceDefaultClientMessage: opts.defaultMessage,
        },
      });
  }

  it("prefills invoice.clientMessage when tenant has Show client message ON and a default text", async () => {
    await setTenant({ showClientMessage: true, defaultMessage: "Thanks for your business." });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    expect(invoice.clientMessage).toBe("Thanks for your business.");
  });

  it("does NOT prefill when Show client message is OFF, even if default text exists", async () => {
    await setTenant({ showClientMessage: false, defaultMessage: "Hello!" });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    expect(invoice.clientMessage).toBeNull();
  });

  it("does NOT prefill when default text is blank", async () => {
    await setTenant({ showClientMessage: true, defaultMessage: "   " });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    expect(invoice.clientMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Exclusion guarantees — the policy shape never models internal-only fields
// ---------------------------------------------------------------------------

describe("InvoiceDisplayPolicy shape — internal exclusions", () => {
  it("does not surface internal notes / payment history / attachments", () => {
    const policy = resolveInvoiceDisplayPolicy({ tenantSettings: null, invoice: null });
    const keys = Object.keys(policy);
    // Internal-only fields must NEVER be modeled by the visibility resolver
    expect(keys).not.toContain("notesInternal");
    expect(keys).not.toContain("showInternalNotes");
    expect(keys).not.toContain("showPaymentHistory");
    expect(keys).not.toContain("showAttachments");
    expect(keys).not.toContain("showLocationContact");
  });

  it("DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS has every spec key", () => {
    const expectedKeys = [
      "invoiceShowLogo",
      "invoiceShowCompanyAddress",
      "invoiceShowCompanyPhone",
      "invoiceShowCompanyEmail",
      "invoiceShowCompanyWebsite",
      "invoiceShowTaxNumber",
      "invoiceShowBillingAddress",
      "invoiceShowServiceAddress",
      "invoiceShowLocationName",
      "invoiceShowJobNumber",
      "invoiceShowSummary",
      "invoiceShowJobDescription",
      "invoiceShowClientMessage",
      "invoiceDefaultClientMessage",
      "invoiceShowLineItems",
      "invoiceShowQuantities",
      "invoiceShowUnitPrices",
      "invoiceShowLineTotals",
    ];
    for (const key of expectedKeys) {
      expect(DEFAULT_TENANT_INVOICE_DISPLAY_SETTINGS).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Regression: PDF rendering does not break when line items are hidden
// ---------------------------------------------------------------------------
//
// Pins the layout contract from the audit pass: when policy.showLineItems
// is false, generateInvoicePdf() must:
//   * not throw,
//   * still produce a non-empty PDF buffer,
//   * still allow the totals block to render (no awkward gap, no missing
//     totals — verified by buffer non-emptiness + the resolver-level
//     guarantee that resolved policy never collapses the totals path).
// We don't extract text from the (compressed) PDF — running the renderer
// to completion is the load-bearing assertion, since the prior bug class
// was a layout reference (rowY) leaking past a hidden table block.

describe("Regression: PDF generation when line items are hidden", () => {
  // Minimal fakes — just enough shape for generateInvoicePdf().
  const company = {
    id: "co-1",
    name: "Acme HVAC",
    address: "1 Main St",
    city: "Toronto",
    provinceState: "ON",
    postalCode: "M1M 1M1",
    email: "ops@acme.test",
    phone: "+1 555 0100",
    taxName: "HST",
  } as any;
  const location = {
    companyName: "Client Site",
    address: "200 Client Rd",
    city: "Toronto",
    provinceState: "ON",
    postalCode: "M2M 2M2",
    phone: "+1 555 0200",
    email: "client@site.test",
  };
  const baseInvoice = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "awaiting_payment",
    invoiceNumber: "9001",
    issueDate: "2026-05-05",
    dueDate: "2026-06-04",
    issuedAt: new Date("2026-05-05T00:00:00Z"),
    subtotal: "100.00",
    taxTotal: "13.00",
    total: "113.00",
    amountPaid: "0.00",
    balance: "113.00",
    clientMessage: null,
    workDescription: null,
    showQuantity: true,
    showUnitPrice: true,
    showLineTotals: true,
    showLineItems: true,
    showBalance: true,
  } as any;
  const lines = [
    {
      id: "line-1",
      lineNumber: 1,
      lineItemType: "service",
      description: "Filter replacement",
      quantity: "1",
      unitPrice: "100.00",
      lineSubtotal: "100.00",
      taxRate: "13.00",
      taxAmount: "13.00",
      lineTotal: "113.00",
    },
  ] as any;

  it("renders without error when line items are hidden", async () => {
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowLineItems: false },
      invoice: { showLineItems: false },
    });
    expect(policy.showLineItems).toBe(false);
    const buf = await generateInvoicePdf({
      invoice: baseInvoice,
      lines,
      company,
      location,
      customerCompany: null,
      taxRegistrations: [],
      policy,
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders without error when line items are hidden AND there are zero lines", async () => {
    // Empty line array used to render a "No line items" cell INSIDE the
    // table block; with the table fully hidden, there is no fallback
    // text to print. Pin that this combination doesn't throw.
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowLineItems: false },
      invoice: { showLineItems: false },
    });
    const buf = await generateInvoicePdf({
      invoice: baseInvoice,
      lines: [],
      company,
      location,
      customerCompany: null,
      taxRegistrations: [],
      policy,
    });
    expect(buf.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Regression: email body never references CLIENT_MESSAGE / INVOICE_SUMMARY
// ---------------------------------------------------------------------------
//
// The canonical invoice email render path is templateRenderer + the
// catalog at server/constants/templateVariables.ts. CLIENT_MESSAGE and
// INVOICE_SUMMARY are NOT in that catalog and are NOT populated by
// templateDataBuilder.buildInvoiceTemplateData. This test pins both:
// any future change that adds them must update this guard, which forces
// a deliberate decision (do they belong in the email body, or do they
// stay PDF-only as the spec requires?).

describe("Regression: email body has no clientMessage / summary tokens", () => {
  it("INVOICE_TEMPLATE_VARIABLES does not include CLIENT_MESSAGE", () => {
    expect(INVOICE_TEMPLATE_VARIABLES).not.toContain("CLIENT_MESSAGE" as any);
  });

  it("INVOICE_TEMPLATE_VARIABLES does not include INVOICE_SUMMARY / SUMMARY", () => {
    expect(INVOICE_TEMPLATE_VARIABLES).not.toContain("INVOICE_SUMMARY" as any);
    expect(INVOICE_TEMPLATE_VARIABLES).not.toContain("SUMMARY" as any);
  });

  it("INVOICE_TEMPLATE_VARIABLES does not include any client_message / summary alias", () => {
    // Defense-in-depth — exact-key checks above cover the canonical
    // names; this regex sweep catches lowercase / underscore variants
    // that a future contributor might add as a "small" addition.
    const blocked = /(client[_-]?message|invoice[_-]?summary|^summary$)/i;
    for (const key of INVOICE_TEMPLATE_VARIABLES) {
      expect(key).not.toMatch(blocked);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Regression: tenant default change does NOT re-sync existing invoices
// ---------------------------------------------------------------------------
//
// The prefill is a CREATE-only seed. Updating the tenant default after an
// invoice has been created must never overwrite that invoice's
// `client_message` — even when the operator manually clears the field.
// The contract is enforced by the absence of any tenant-default read in
// `updateInvoice()`; this test pins it from the integration angle so a
// future refactor that adds a "merge on update" helper would fail loudly.

describe("Regression: tenant default does not re-sync existing invoices", () => {
  async function setTenantDefault(opts: { showClientMessage: boolean; defaultMessage: string | null }) {
    await db
      .insert(companySettings)
      .values({
        companyId,
        userId,
        invoiceShowClientMessage: opts.showClientMessage,
        invoiceDefaultClientMessage: opts.defaultMessage,
      })
      .onConflictDoUpdate({
        target: companySettings.companyId,
        set: {
          invoiceShowClientMessage: opts.showClientMessage,
          invoiceDefaultClientMessage: opts.defaultMessage,
        },
      });
  }

  it("manually-cleared invoice.clientMessage stays cleared after tenant default changes", async () => {
    // 1. Tenant has a default; new invoice picks it up (covered elsewhere
    //    but re-asserted here so the regression scope is explicit).
    await setTenantDefault({ showClientMessage: true, defaultMessage: "Original default" });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    expect(invoice.clientMessage).toBe("Original default");

    // 2. Operator manually clears the per-invoice clientMessage. We hit
    //    `updateInvoice` directly — the same code path the PATCH route
    //    uses — to keep this test storage-only.
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      { clientMessage: null },
    );
    const cleared = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(cleared?.clientMessage).toBeNull();

    // 3. Tenant default text changes. This MUST NOT touch any existing
    //    invoice row.
    await setTenantDefault({ showClientMessage: true, defaultMessage: "Brand new default" });
    const afterTenantChange = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(afterTenantChange?.clientMessage).toBeNull();
  });

  it("operator-edited invoice.clientMessage is not overwritten when tenant default changes", async () => {
    await setTenantDefault({ showClientMessage: true, defaultMessage: "Original default" });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    expect(invoice.clientMessage).toBe("Original default");

    // Operator types their own per-invoice text.
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      { clientMessage: "Hand-edited per invoice" },
    );

    // Tenant default changes; per-invoice text must be untouched.
    await setTenantDefault({ showClientMessage: true, defaultMessage: "Replacement default" });
    const after = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(after?.clientMessage).toBe("Hand-edited per invoice");

    // Toggling Show client message OFF at the tenant level still must
    // not mutate the persisted invoice text — the resolver hides it at
    // RENDER time but the row stays intact.
    await setTenantDefault({ showClientMessage: false, defaultMessage: "Replacement default" });
    const afterToggleOff = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(afterToggleOff?.clientMessage).toBe("Hand-edited per invoice");
  });
});

// ---------------------------------------------------------------------------
// 9. Per-invoice visibility inheritance (2026-05-06)
// ---------------------------------------------------------------------------
//
// Migration `2026_05_06_invoice_visibility_inherit.sql` made the five
// invoice-level visibility columns nullable. NULL means "inherit tenant
// default"; an explicit boolean means "per-invoice override". The
// resolver's `pick()` handles the merge. These tests pin the new
// inheritance contract end-to-end:
//   - new invoice has NULL on all five columns,
//   - resolver inherits tenant defaults when invoice flags are NULL,
//   - explicit override always wins,
//   - PATCH null can clear an override (the "Reset to defaults" affordance),
//   - existing rows with stored booleans behave as before.

describe("Invoice visibility inheritance — null = use tenant default", () => {
  async function setTenantVisibility(opts: {
    showLineItems: boolean;
    showQuantities: boolean;
    showUnitPrices: boolean;
    showLineTotals: boolean;
    showJobDescription: boolean;
  }) {
    await db
      .insert(companySettings)
      .values({
        companyId,
        userId,
        invoiceShowLineItems: opts.showLineItems,
        invoiceShowQuantities: opts.showQuantities,
        invoiceShowUnitPrices: opts.showUnitPrices,
        invoiceShowLineTotals: opts.showLineTotals,
        invoiceShowJobDescription: opts.showJobDescription,
      })
      .onConflictDoUpdate({
        target: companySettings.companyId,
        set: {
          invoiceShowLineItems: opts.showLineItems,
          invoiceShowQuantities: opts.showQuantities,
          invoiceShowUnitPrices: opts.showUnitPrices,
          invoiceShowLineTotals: opts.showLineTotals,
          invoiceShowJobDescription: opts.showJobDescription,
        },
      });
  }

  it("a freshly created invoice has NULL on the five visibility columns", async () => {
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    // Each of the five flags must be NULL (= inherit tenant default).
    expect(invoice.showLineItems).toBeNull();
    expect(invoice.showQuantity).toBeNull();
    expect(invoice.showUnitPrice).toBeNull();
    expect(invoice.showLineTotals).toBeNull();
    expect(invoice.showJobDescription).toBeNull();
  });

  it("resolver returns tenant-default values for an invoice with NULL flags", async () => {
    // Tenant says: hide quantities + unit prices, show everything else.
    await setTenantVisibility({
      showLineItems: true,
      showQuantities: false,
      showUnitPrices: false,
      showLineTotals: true,
      showJobDescription: false,
    });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    const tenantSettings = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings[0] as any,
      invoice: invoice as any,
    });
    // Effective policy mirrors the tenant defaults — invoice has no overrides.
    expect(policy.showLineItems).toBe(true);
    expect(policy.showQuantities).toBe(false);
    expect(policy.showUnitPrices).toBe(false);
    expect(policy.showLineTotals).toBe(true);
    expect(policy.showJobDescription).toBe(false);
  });

  it("an explicit per-invoice override always wins over the tenant default", async () => {
    await setTenantVisibility({
      showLineItems: true,
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showJobDescription: true,
    });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    // Operator hides quantities on this one invoice.
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      { showQuantity: false },
    );
    const updated = await invoiceRepository.getInvoice(companyId, invoice.id);
    const tenantSettings = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings[0] as any,
      invoice: updated as any,
    });
    // Override wins on the one toggled flag; the rest still inherit.
    expect(updated?.showQuantity).toBe(false);
    expect(updated?.showLineItems).toBeNull();
    expect(policy.showQuantities).toBe(false);
    expect(policy.showLineItems).toBe(true);
  });

  it("PATCHing null clears an override and falls back to the tenant default", async () => {
    await setTenantVisibility({
      showLineItems: false,
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showJobDescription: true,
    });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    // Operator overrides showLineItems to true (against tenant default).
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      { showLineItems: true },
    );
    const overridden = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(overridden?.showLineItems).toBe(true);

    // Operator clicks "Reset to defaults" — UI PATCHes null on the five flags.
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      {
        showLineItems: null,
        showQuantity: null,
        showUnitPrice: null,
        showLineTotals: null,
        showJobDescription: null,
      },
    );
    const cleared = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(cleared?.showLineItems).toBeNull();

    // Resolver now returns the tenant default (false for showLineItems).
    const tenantSettings = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings[0] as any,
      invoice: cleared as any,
    });
    expect(policy.showLineItems).toBe(false);
  });

  it("legacy invoices with stored booleans continue to render with their explicit values (no silent migration)", async () => {
    // Simulate a pre-migration row that landed with explicit `false` on
    // showLineItems. After the migration, that boolean must continue
    // winning — the migration intentionally does NOT mass-NULL old data.
    await setTenantVisibility({
      showLineItems: true,
      showQuantities: true,
      showUnitPrices: true,
      showLineTotals: true,
      showJobDescription: true,
    });
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );
    // Stamp an explicit boolean to simulate a legacy row.
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      { showLineItems: false },
    );
    const stamped = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(stamped?.showLineItems).toBe(false);

    const tenantSettings = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.companyId, companyId))
      .limit(1);
    const policy = resolveInvoiceDisplayPolicy({
      tenantSettings: tenantSettings[0] as any,
      invoice: stamped as any,
    });
    expect(policy.showLineItems).toBe(false);
  });

  it("invoiceVisibilityDiffersFromTenant treats a NULL stored value as not-custom", async () => {
    const tenant = {
      invoiceShowLineItems: true,
      invoiceShowQuantities: true,
      invoiceShowUnitPrices: true,
      invoiceShowLineTotals: true,
      invoiceShowJobDescription: true,
    };
    // All five flags null on the invoice → inheriting → never custom.
    expect(
      invoiceVisibilityDiffersFromTenant(tenant, {
        showLineItems: null,
        showQuantity: null,
        showUnitPrice: null,
        showLineTotals: null,
        showJobDescription: null,
      } as any),
    ).toBe(false);
    // One flag carries an explicit boolean that DIFFERS from tenant → custom.
    expect(
      invoiceVisibilityDiffersFromTenant(tenant, {
        showLineItems: false,
        showQuantity: null,
        showUnitPrice: null,
        showLineTotals: null,
        showJobDescription: null,
      } as any),
    ).toBe(true);
    // Stored boolean that MATCHES tenant default → not custom (value-based
    // contract from the spec).
    expect(
      invoiceVisibilityDiffersFromTenant(tenant, {
        showLineItems: true,
        showQuantity: null,
        showUnitPrice: null,
        showLineTotals: null,
        showJobDescription: null,
      } as any),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Unsupported features pinned to false (2026-05-06)
// ---------------------------------------------------------------------------
//
// `showLogo` and `showCompanyWebsite` are part of the policy shape (the
// schema columns + PUT payload still accept them — no data migration
// risk for tenants that previously toggled them ON), but the underlying
// features are not implemented. Until they are, the resolver pins both
// to `false` so PDF / email / portal can never accidentally render an
// empty logo placeholder or a missing-website line. The settings UI
// also intentionally does NOT expose these toggles.

describe("Unsupported features — showLogo / showCompanyWebsite pinned false", () => {
  it("resolver returns false for showLogo regardless of tenant setting", () => {
    const truePolicy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowLogo: true },
      invoice: null,
    });
    expect(truePolicy.showLogo).toBe(false);
    const falsePolicy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowLogo: false },
      invoice: null,
    });
    expect(falsePolicy.showLogo).toBe(false);
  });

  it("resolver returns false for showCompanyWebsite regardless of tenant setting", () => {
    const truePolicy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowCompanyWebsite: true },
      invoice: null,
    });
    expect(truePolicy.showCompanyWebsite).toBe(false);
    const falsePolicy = resolveInvoiceDisplayPolicy({
      tenantSettings: { invoiceShowCompanyWebsite: false },
      invoice: null,
    });
    expect(falsePolicy.showCompanyWebsite).toBe(false);
  });

  it("Settings → Invoice Display UI source does not expose logo or website toggles", async () => {
    // Source-pin guard: the Vitest environment is "node" with no DOM
    // setup, so we can't render the React component. Reading the file
    // string is the smallest safe regression check — if any future
    // contributor re-introduces these toggles, the data-testid /
    // user-facing label will reappear and this test will fail loudly.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../client/src/pages/InvoiceDisplaySettingsPage.tsx"),
      "utf8",
    );
    expect(source).not.toContain('testId="toggle-show-logo"');
    expect(source).not.toContain('testId="toggle-show-company-website"');
    expect(source).not.toMatch(/label="Show company logo"/);
    expect(source).not.toMatch(/label="Show company website"/);
  });
});

// ---------------------------------------------------------------------------
// 11. PATCH /api/invoices/:id Zod schema must accept null on the 5 flags
// ---------------------------------------------------------------------------
//
// Regression context: server/routes/invoices.ts declares its OWN
// `updateInvoiceSchema` (separate from the one in shared/schema.ts). On
// 2026-05-06 the shared schema was updated to nullable; the route-local
// copy was missed and continued rejecting `null` with
// "Validation error: Expected boolean, received null". That broke the
// "Reset to defaults" affordance on the invoice detail page (which
// PATCHes null to clear per-invoice overrides). This source-pin guard
// makes sure the route-local schema can never silently regress back to
// boolean-only.

describe("Regression: route-local invoice update schema accepts null on the 5 visibility flags", () => {
  it("server/routes/invoices.ts declares each flag as nullable().optional()", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../server/routes/invoices.ts"),
      "utf8",
    );
    // Crisp guard: the route file may legitimately contain a separate
    // schema (e.g. createAtomicSchema) where these fields are creation-
    // path booleans. Only the `updateInvoiceSchema` in this file is the
    // PATCH validator. Both schemas live in the same file; we slice out
    // the updateInvoiceSchema block by anchoring on its declaration and
    // its `.strict()` terminator, then assert null support on the slice.
    const start = source.indexOf("const updateInvoiceSchema = z.object({");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("}).strict();", start);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    for (const field of [
      "showQuantity",
      "showUnitPrice",
      "showLineTotals",
      "showLineItems",
      "showJobDescription",
    ]) {
      // Each field must declare `.nullable()` somewhere on its line so
      // PATCH null is accepted by the route's strict schema.
      const lineRegex = new RegExp(`${field}\\s*:[^,\\n]*\\.nullable\\(\\)`);
      expect(block).toMatch(lineRegex);
    }
    // Defensive cross-check: the same field names must NOT appear with a
    // bare `z.boolean().optional()` (no nullable) inside the slice.
    for (const field of [
      "showQuantity",
      "showUnitPrice",
      "showLineTotals",
      "showLineItems",
      "showJobDescription",
    ]) {
      const bareLine = new RegExp(`${field}\\s*:\\s*z\\.boolean\\(\\)\\.optional\\(\\)`);
      expect(block).not.toMatch(bareLine);
    }
  });

  it("shared/schema.ts updateInvoiceSchema also declares the 5 flags as nullable().optional()", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../shared/schema.ts"),
      "utf8",
    );
    const start = source.indexOf("export const updateInvoiceSchema = z.object({");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("});", start);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    for (const field of [
      "showQuantity",
      "showUnitPrice",
      "showLineTotals",
      "showLineItems",
      "showJobDescription",
    ]) {
      const lineRegex = new RegExp(`${field}\\s*:[^,\\n]*\\.nullable\\(\\)`);
      expect(block).toMatch(lineRegex);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. End-to-end: storage round-trips null on the 5 flags
// ---------------------------------------------------------------------------
//
// Pins the storage half of the "Reset to defaults" contract. The
// server/routes/invoices.ts PATCH handler hands `patch` to
// `storage.updateInvoice(...)`; that method passes the patch straight to
// Drizzle's `.set({...})`. With the columns nullable post-migration,
// explicit null on these keys must round-trip back as null on read.

describe("Reset to defaults — storage round-trips null", () => {
  it("updateInvoice accepts null on all 5 visibility flags and getInvoice returns null", async () => {
    const { invoice } = await invoiceRepository.createStandaloneInvoice(
      companyId,
      { locationId, customerCompanyId },
      "STANDALONE_ROUTE",
    );

    // Stamp explicit overrides first (simulate legacy invoice).
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      {
        showLineItems: true,
        showQuantity: false,
        showUnitPrice: true,
        showLineTotals: false,
        showJobDescription: true,
      },
    );
    const stamped = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(stamped?.showLineItems).toBe(true);
    expect(stamped?.showQuantity).toBe(false);
    expect(stamped?.showJobDescription).toBe(true);

    // Reset (the exact payload the InvoiceDetailPage sends).
    await invoiceRepository.updateInvoice(
      companyId,
      invoice.id,
      undefined,
      {
        showJobDescription: null,
        showLineItems: null,
        showQuantity: null,
        showUnitPrice: null,
        showLineTotals: null,
      },
    );

    // Refetch must observe the cleared overrides as raw null.
    const cleared = await invoiceRepository.getInvoice(companyId, invoice.id);
    expect(cleared?.showLineItems).toBeNull();
    expect(cleared?.showQuantity).toBeNull();
    expect(cleared?.showUnitPrice).toBeNull();
    expect(cleared?.showLineTotals).toBeNull();
    expect(cleared?.showJobDescription).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. Admin invoice detail page is the truth view (NOT a client-facing preview)
// ---------------------------------------------------------------------------
//
// The Client Visibility settings affect ONLY client-facing surfaces (PDF,
// invoice email render, customer portal). The admin invoice detail page
// must never gate its rendering on the five visibility flags — operators
// need to see the full invoice regardless of what the customer sees. A
// future contributor adding `{policy.showLineItems && <LineItemsTable/>}`
// or similar to the admin page would silently hide internal billing data
// from staff. This guard pins that contract.

describe("Admin InvoiceDetailPage does not gate rendering on client-facing visibility flags", () => {
  it("admin invoice detail page does not conditionally render on the 5 flags", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../client/src/pages/InvoiceDetailPage.tsx"),
      "utf8",
    );
    // Pattern that would gate JSX on a flag — e.g. `policy.showLineItems &&`,
    // `invoice.showLineItems &&`, `serverVisibility.showLineItems &&`.
    // We intentionally do NOT match references inside the
    // ClientVisibilityCardV2 component (which legitimately reads these
    // flags) — that component lives in this same file but uses local
    // `draft.showLineItems` references, never `policy` / `invoice` /
    // `serverVisibility` directly. So matching those three prefixes is
    // a tight check.
    const blockedPatterns = [
      /policy\.showLineItems\s*&&/,
      /policy\.showQuantit(y|ies)\s*&&/,
      /policy\.showUnitPrice(s)?\s*&&/,
      /policy\.showLineTotals\s*&&/,
      /policy\.showJobDescription\s*&&/,
      /invoice\.showLineItems\s*&&/,
      /invoice\.showQuantity\s*&&/,
      /invoice\.showUnitPrice\s*&&/,
      /invoice\.showLineTotals\s*&&/,
      /invoice\.showJobDescription\s*&&/,
      /serverVisibility\.showLineItems\s*&&/,
      /serverVisibility\.showQuantity\s*&&/,
      /serverVisibility\.showUnitPrice\s*&&/,
      /serverVisibility\.showLineTotals\s*&&/,
      /serverVisibility\.showJobDescription\s*&&/,
    ];
    for (const pattern of blockedPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });
});
