/**
 * Labour Decoupling + Tax-Selector Fix + Canadian Spelling — 2026-05-05.
 *
 * Three fixes pinned by this file:
 *
 *   ISSUE 2 — Tracked labour MUST NEVER auto-create invoice line items.
 *     The previous flow ran `addLaborLinesFromTimeEntries()` during
 *     `refreshInvoiceFromJob()`, which converted billable time entries
 *     into `lineItemType:"service"` lines and locked the entries via
 *     `time_entries.invoiced_at` / `locked_at`. That path is gone.
 *     Tracked labour stays operational data on the Job + Invoice
 *     labour cards. Bills are line items added by hand.
 *
 *   ISSUE 1 — Invoice tax selector now supports standalone rates as
 *     well as user-created groups. Picking a rate routes through a
 *     hidden per-rate "system" group (`__sys_rate__:<rateId>`) so the
 *     canonical batch-tax-application path is unchanged. Empty-state
 *     copy is now branched: "No tax rates configured" instead of
 *     "No tax groups configured" when only standalone rates can be
 *     added.
 *
 *   ISSUE 3 — Canadian spelling "Labour" is used in visible UI strings.
 *     Internal field names (`laborCostPerHour`, `lineItemType`, etc.)
 *     are unchanged.
 *
 * Test layers:
 *   1. Real-DB integration (storage + service): refresh/preview do
 *      NOT touch time entries, do NOT create labour invoice lines, do
 *      NOT lock entries; system-rate tax wrapper is idempotent.
 *   2. Source-pin layer: route schema, frontend popover render rules,
 *      Settings filter, no remaining UI "Labor" strings.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  jobs,
  timeEntries,
  invoices,
  invoiceLines,
  companyTaxRates,
  companyTaxGroups,
  companyTaxGroupRates,
  invoiceTaxLines,
} from "@shared/schema";
import { invoiceRepository } from "../server/storage/invoices";
import { taxRepository, TaxRepository } from "../server/storage/tax";
import { applyTaxGroupToInvoice } from "../server/services/invoiceCreationService";

const PREFIX = "labour_no_auto_test_";

const tenantA = uuidv4();
const ownerA = uuidv4();
const techA = uuidv4();
const customerA = uuidv4();
const locationA = uuidv4();
let jobAId: string;
let invoiceAId: string;
let timeEntryAId: string;
let taxRateAId: string;

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

async function setupFixtures() {
  await db.insert(companies).values({ id: tenantA, name: `${PREFIX}A` });

  await db.insert(users).values([
    {
      id: ownerA,
      companyId: tenantA,
      email: `${PREFIX}owner_${Date.now()}@t`,
      password: "x",
      role: "owner",
      status: "active",
    },
    {
      id: techA,
      companyId: tenantA,
      email: `${PREFIX}tech_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
      fullName: "Alex Tech",
      billableRatePerHour: "85.00",
      laborCostPerHour: "30.00",
    },
  ]);

  await db.insert(customerCompanies).values({
    id: customerA,
    companyId: tenantA,
    name: `${PREFIX}cust`,
  });

  await db.insert(clientLocations).values({
    id: locationA,
    companyId: tenantA,
    parentCompanyId: customerA,
    companyName: `${PREFIX}loc`,
    address: "1 Pine St",
    city: "Toronto",
    province: "ON",
    postalCode: "M1A1A1",
    selectedMonths: [],
  });

  // Completed job — eligible for billable preview.
  const [insertedJob] = await db
    .insert(jobs)
    .values({
      companyId: tenantA,
      locationId: locationA,
      customerCompanyId: customerA,
      jobNumber: 100001,
      status: "completed",
      summary: `${PREFIX}job — completed`,
      jobType: "repair",
    })
    .returning({ id: jobs.id });
  jobAId = insertedJob.id;

  // Two completed billable time entries on the job (different times)
  // so the OLD path would have produced a labour line. After 2026-05-05
  // these entries must remain untouched.
  const startA = new Date(Date.now() - 6 * 60 * 60_000);
  const endA = new Date(Date.now() - 4 * 60 * 60_000);
  const [te1] = await db
    .insert(timeEntries)
    .values({
      companyId: tenantA,
      technicianId: techA,
      jobId: jobAId,
      type: "on_site",
      startAt: startA,
      endAt: endA,
      durationMinutes: 120,
      billable: true,
      billableRateSnapshot: "85.00",
      costRateSnapshot: "30.00",
    })
    .returning({ id: timeEntries.id });
  timeEntryAId = te1.id;
  const startB = new Date(Date.now() - 3 * 60 * 60_000);
  const endB = new Date(Date.now() - 2 * 60 * 60_000);
  await db.insert(timeEntries).values({
    companyId: tenantA,
    technicianId: techA,
    jobId: jobAId,
    type: "travel",
    startAt: startB,
    endAt: endB,
    durationMinutes: 60,
    billable: true,
    billableRateSnapshot: "85.00",
    costRateSnapshot: "30.00",
  });

  // Draft invoice tied to the job — used by the refresh-from-job test.
  const [inv] = await db
    .insert(invoices)
    .values({
      companyId: tenantA,
      locationId: locationA,
      customerCompanyId: customerA,
      jobId: jobAId,
      invoiceNumber: "9001",
      status: "draft",
      issueDate: new Date().toISOString().slice(0, 10),
      currency: "CAD",
      paymentTermsDays: 30,
    })
    .returning({ id: invoices.id });
  invoiceAId = inv.id;

  // Standalone tax rate (HST 13%) — Issue 1 fixture.
  const [rate] = await db
    .insert(companyTaxRates)
    .values({
      companyId: tenantA,
      name: "HST",
      rate: "13.0000",
      description: `${PREFIX}rate`,
    })
    .returning({ id: companyTaxRates.id });
  taxRateAId = rate.id;
}

async function teardownFixtures() {
  // Order: child → parent. Cascades cover most of this; explicit for safety.
  await db.delete(invoiceTaxLines).where(eq(invoiceTaxLines.companyId, tenantA));
  await db.delete(invoiceLines).where(eq(invoiceLines.companyId, tenantA));
  await db.delete(invoices).where(eq(invoices.companyId, tenantA));
  await db.delete(timeEntries).where(eq(timeEntries.companyId, tenantA));
  await db.delete(jobs).where(eq(jobs.companyId, tenantA));
  await db.delete(companyTaxGroupRates);
  await db.delete(companyTaxGroups).where(eq(companyTaxGroups.companyId, tenantA));
  await db.delete(companyTaxRates).where(eq(companyTaxRates.companyId, tenantA));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, tenantA));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tenantA));
  await db.delete(users).where(eq(users.companyId, tenantA));
  await db.delete(companies).where(eq(companies.id, tenantA));
}

// ── Issue 2: real-DB labour decoupling ───────────────────────────────

describe("Tracked labour does NOT auto-create invoice line items (any path)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("refreshInvoiceFromJob creates ZERO labour-derived invoice lines from time entries", async () => {
    // Confirm precondition: there are billable, completed, uninvoiced
    // time entries for this job — the OLD path would have turned them
    // into invoice lines.
    const entriesBefore = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, tenantA), eq(timeEntries.jobId, jobAId)));
    expect(entriesBefore.length).toBeGreaterThanOrEqual(2);
    expect(entriesBefore.every((e) => e.billable === true)).toBe(true);
    expect(entriesBefore.every((e) => e.invoicedAt === null)).toBe(true);

    // Run the refresh — this is what the manual "Refresh from job"
    // button calls on the server.
    await invoiceRepository.refreshInvoiceFromJob(tenantA, invoiceAId);

    // Zero invoice lines must exist (no parts on this job and labour
    // is gone). Specifically, NO `source: "job"` lines that came from
    // time entries.
    const linesAfter = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceAId));
    expect(linesAfter).toHaveLength(0);

    // Time entries are NOT touched — invoicedAt / lockedAt / billed
    // snapshots all remain pristine.
    const entriesAfter = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, tenantA), eq(timeEntries.jobId, jobAId)));
    for (const e of entriesAfter) {
      expect(e.invoicedAt).toBeNull();
      expect(e.invoiceId).toBeNull();
      expect(e.invoiceLineId).toBeNull();
      expect(e.lockedAt).toBeNull();
      expect(e.lockedByInvoiceId).toBeNull();
      expect(e.billedMinutesSnapshot).toBeNull();
    }
  });

  it("refreshInvoiceFromJob preserves existing manual line items (does not delete them)", async () => {
    const manualLineId = uuidv4();
    await db.insert(invoiceLines).values({
      id: manualLineId,
      companyId: tenantA,
      invoiceId: invoiceAId,
      lineNumber: 1,
      lineItemType: "service",
      description: "Manual labour line — bill HVAC tech 2hr @ $100",
      quantity: "2",
      unitPrice: "100.00",
      lineSubtotal: "200.00",
      taxRate: "0",
      taxAmount: "0",
      lineTotal: "200.00",
      source: "manual",
    });

    await invoiceRepository.refreshInvoiceFromJob(tenantA, invoiceAId);

    const linesAfter = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceAId));
    // Exactly one line — the manual one — survives.
    expect(linesAfter).toHaveLength(1);
    expect(linesAfter[0].id).toBe(manualLineId);
    expect(linesAfter[0].source).toBe("manual");

    // Cleanup for following tests.
    await db.delete(invoiceLines).where(eq(invoiceLines.id, manualLineId));
  });

  it("getBillablePreviewForJob returns empty `labor` array even when billable time entries exist", async () => {
    const preview = await invoiceRepository.getBillablePreviewForJob(tenantA, jobAId);
    expect(preview.labor).toEqual([]);
    expect(preview.laborSubtotal).toBe("0.00");
    // Subtotal reflects parts-only (zero in this fixture).
    expect(preview.subtotal).toBe("0.00");
  });
});

// ── Issue 1: real-DB tax wrapper-group + apply path ──────────────────

describe("Standalone tax rate apply via system wrapper group", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("ensureSystemRateGroup creates a hidden per-rate wrapper on first call", async () => {
    const wrapper = await taxRepository.ensureSystemRateGroup(tenantA, taxRateAId);
    expect(wrapper).not.toBeNull();
    expect(wrapper!.name).toBe(`__sys_rate__:${taxRateAId}`);
    expect(TaxRepository.isSystemRateGroup(wrapper!)).toBe(true);
    expect(wrapper!.rates).toHaveLength(1);
    expect(wrapper!.rates[0].id).toBe(taxRateAId);
    expect(wrapper!.isDefault).toBe(false);
  });

  it("ensureSystemRateGroup is idempotent — second call returns the SAME group", async () => {
    const a = await taxRepository.ensureSystemRateGroup(tenantA, taxRateAId);
    const b = await taxRepository.ensureSystemRateGroup(tenantA, taxRateAId);
    expect(a!.id).toBe(b!.id);
    // No duplicate row in the table.
    const all = await db
      .select()
      .from(companyTaxGroups)
      .where(
        and(
          eq(companyTaxGroups.companyId, tenantA),
          eq(companyTaxGroups.name, `__sys_rate__:${taxRateAId}`),
        ),
      );
    expect(all).toHaveLength(1);
  });

  it("ensureSystemRateGroup returns null for a missing rate (tenant scope respected)", async () => {
    const fakeRateId = uuidv4();
    const wrapper = await taxRepository.ensureSystemRateGroup(tenantA, fakeRateId);
    expect(wrapper).toBeNull();
  });

  it("applying tax via the wrapper writes per-line tax via the canonical batch path", async () => {
    // Add one line so there is something to apply tax to.
    await db.insert(invoiceLines).values({
      companyId: tenantA,
      invoiceId: invoiceAId,
      lineNumber: 1,
      lineItemType: "service",
      description: "service line for tax test",
      quantity: "1",
      unitPrice: "100.00",
      lineSubtotal: "100.00",
      taxRate: "0",
      taxAmount: "0",
      lineTotal: "100.00",
      source: "manual",
    });

    const wrapper = await taxRepository.ensureSystemRateGroup(tenantA, taxRateAId);
    await applyTaxGroupToInvoice(tenantA, invoiceAId, wrapper!.id);

    const [updatedInvoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceAId));
    expect(updatedInvoice.taxGroupId).toBe(wrapper!.id);
    expect(parseFloat(updatedInvoice.taxTotal)).toBeCloseTo(13.0, 2);
    expect(parseFloat(updatedInvoice.total)).toBeCloseTo(113.0, 2);

    const [line] = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceAId));
    // taxRate is stored as a decimal (0.13 for 13%).
    expect(parseFloat(line.taxRate)).toBeCloseTo(0.13, 4);
    expect(parseFloat(line.taxAmount)).toBeCloseTo(13.0, 2);

    // The snapshot row in invoice_tax_lines points at the underlying
    // rate, not at any user-named group.
    const snapshot = await db
      .select()
      .from(invoiceTaxLines)
      .where(eq(invoiceTaxLines.invoiceId, invoiceAId));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].taxRateId).toBe(taxRateAId);
    expect(snapshot[0].taxRateName).toBe("HST");

    // Cleanup so the labour test above can re-run cleanly across
    // describe blocks (each describe wraps its own setup/teardown).
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceAId));
    await db.delete(invoiceTaxLines).where(eq(invoiceTaxLines.invoiceId, invoiceAId));
    await db
      .update(invoices)
      .set({ taxGroupId: null, taxTotal: "0", total: "0" })
      .where(eq(invoices.id, invoiceAId));
  });
});

// ── Source-pin layer ─────────────────────────────────────────────────

describe("Source pins — labour decoupling, tax selector, Canadian spelling", () => {
  const invoicesStorage = read("server/storage/invoices.ts");
  const previewService = read("server/services/jobBillablePreviewService.ts");
  const invoicesRoute = read("server/routes/invoices.ts");
  const taxStorage = read("server/storage/tax.ts");
  const taxRoute = read("server/routes/tax.ts");
  const compositionDialog = read("client/src/components/InvoiceCompositionDialog.tsx");
  const invoiceDetailPage = read("client/src/pages/InvoiceDetailPage.tsx");
  const taxBillingRulesPage = read("client/src/pages/TaxBillingRulesPage.tsx");
  const compensationTab = read("client/src/components/team-hub/CompensationTab.tsx");

  // ── Issue 2: labour decoupling ────────────────────────────────────

  it("invoiceRepository no longer calls addLaborLinesFromTimeEntries from refreshInvoiceFromJob", () => {
    // No more `await this.addLaborLinesFromTimeEntries(` invocation
    // anywhere in the storage module.
    expect(invoicesStorage).not.toMatch(/await this\.addLaborLinesFromTimeEntries\(/);
    // The function declaration itself is gone — only the deletion-note
    // comment remains.
    expect(invoicesStorage).not.toMatch(/private async addLaborLinesFromTimeEntries\(/);
    expect(invoicesStorage).toMatch(/DELETED: addLaborLinesFromTimeEntries/);
  });

  it("getBillablePreviewForJob always returns empty labour", () => {
    expect(invoicesStorage).toMatch(/const labor: Array<never> = \[\];/);
    expect(invoicesStorage).toMatch(/const laborSubtotalCents = 0;/);
  });

  it("jobBillablePreviewService no longer aggregates time entries into labour lines", () => {
    // The aggregation pipeline is gone — no more `applyBillingRulesToEntries`
    // call or `timeBillingRulesRepository.getRules` lookup in the
    // executable body. (The string may still appear in the file
    // header comment for historical context — we test for a
    // call/import, not a free mention.)
    expect(previewService).not.toMatch(/applyBillingRulesToEntries\(/);
    expect(previewService).not.toMatch(/timeBillingRulesRepository\./);
    expect(previewService).toMatch(/const laborLines: JobBillablePreviewLine\[\] = \[\];/);
    expect(previewService).toMatch(/Tracked labour never auto-creates invoice/);
  });

  it("InvoiceCompositionDialog no longer renders a Labor selection section", () => {
    // Section markup gone.
    expect(compositionDialog).not.toMatch(/data-testid="section-labor"/);
    expect(compositionDialog).not.toMatch(/data-testid="button-toggle-all-labor"/);
    expect(compositionDialog).not.toMatch(/laborSelected/);
    // The dialog body explains the new contract.
    expect(compositionDialog).toMatch(/Tracked labour is operational only/);
  });

  // ── Issue 1: tax selector + system wrapper ────────────────────────

  it("apply-tax route accepts taxRateId in addition to taxGroupId, mutually exclusive", () => {
    expect(invoicesRoute).toMatch(/taxGroupId: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
    expect(invoicesRoute).toMatch(/taxRateId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(invoicesRoute).toMatch(/Provide either taxGroupId or taxRateId, not both/);
    // Standalone-rate path resolves through ensureSystemRateGroup.
    expect(invoicesRoute).toMatch(/taxRepository\.ensureSystemRateGroup\(/);
  });

  it("tax storage exports the SYSTEM_RATE_GROUP_PREFIX + ensureSystemRateGroup helpers", () => {
    expect(taxStorage).toMatch(/SYSTEM_RATE_GROUP_PREFIX = "__sys_rate__:"/);
    expect(taxStorage).toMatch(/static isSystemRateGroup/);
    expect(taxStorage).toMatch(/async ensureSystemRateGroup\(companyId: string, taxRateId: string\)/);
  });

  it("create-tax-group route rejects user-supplied names with the system prefix", () => {
    expect(taxRoute).toMatch(/__sys_rate__:/);
    expect(taxRoute).toMatch(/Tax group name must not start with __sys_rate__: \(reserved\)/);
  });

  it("InvoiceDetailPage popover queries BOTH /api/tax (rates) and /api/tax/groups", () => {
    expect(invoiceDetailPage).toMatch(/queryKey: \["\/api\/tax"\]/);
    expect(invoiceDetailPage).toMatch(/queryKey: \["\/api\/tax\/groups"\]/);
    // Filters the system wrappers from the visible groups list.
    expect(invoiceDetailPage).toMatch(/SYSTEM_RATE_GROUP_PREFIX = "__sys_rate__:"/);
    expect(invoiceDetailPage).toMatch(/!g\.name\.startsWith\(SYSTEM_RATE_GROUP_PREFIX\)/);
  });

  it("InvoiceDetailPage popover renders both Tax Groups and Tax Rates sections", () => {
    expect(invoiceDetailPage).toMatch(/Tax Groups/);
    expect(invoiceDetailPage).toMatch(/Tax Rates/);
    // Standalone-rate apply uses the new descriptor.
    expect(invoiceDetailPage).toMatch(/applyTaxMutation\.mutate\(\{ kind: "rate", id: rate\.id \}\)/);
    expect(invoiceDetailPage).toMatch(/applyTaxMutation\.mutate\(\{ kind: "group", id: group\.id \}\)/);
    expect(invoiceDetailPage).toMatch(/applyTaxMutation\.mutate\(\{ kind: "none" \}\)/);
  });

  it("InvoiceDetailPage empty-state copy is branched and no longer says 'No tax groups configured'", () => {
    expect(invoiceDetailPage).not.toMatch(/No tax groups configured\. Set up tax rates in Settings\./);
    expect(invoiceDetailPage).toMatch(/No tax rates configured\. Add a tax rate in Settings\./);
  });

  it("Settings tax-groups page filters out system per-rate wrappers", () => {
    expect(taxBillingRulesPage).toMatch(/SYSTEM_RATE_GROUP_PREFIX = "__sys_rate__:"/);
    expect(taxBillingRulesPage).toMatch(/!g\.name\.startsWith\(SYSTEM_RATE_GROUP_PREFIX\)/);
  });

  // ── Issue 3: Canadian spelling ────────────────────────────────────

  it("CompensationTab uses 'Labour' for visible labels + validation errors", () => {
    expect(compensationTab).toMatch(/htmlFor="comp-cost">Labour cost \/ hour</);
    expect(compensationTab).toMatch(/Labour cost must be a number/);
    // No regression — the page has no remaining visible "Labor cost".
    expect(compensationTab).not.toMatch(/"Labor cost must be a number/);
    expect(compensationTab).not.toMatch(/>Labor cost \/ hour</);
  });
});
