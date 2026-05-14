/**
 * Receivables Phase 2A backend audit (2026-05-13)
 *
 * Source-pin tests covering:
 *   - Schema: invoice workflow fields + receivables_notes table
 *   - Storage: ReceivablesNotesRepository invariants
 *   - Routes: all route signatures, validation, and security
 *   - View counts: all view predicates, scoping, and threshold default
 *   - Payment invariant: paid-transition clearing of workflow flags
 *   - InvoiceFeedItem: new fields present in the feed interface
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function src(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const schema            = src("shared/schema.ts");
const paymentsStorage   = src("server/storage/payments.ts");
const receivablesNotes  = src("server/storage/receivablesNotes.ts");
const receivablesRoutes = src("server/routes/receivables.ts");
const routesIndex       = src("server/routes/index.ts");
const invoicesFeed      = src("server/storage/invoicesFeed.ts");
const migrationFields   = src("migrations/2026_05_13_invoice_receivables_fields.sql");
const migrationNotes    = src("migrations/2026_05_13_receivables_notes.sql");

// ── Schema: invoice workflow fields ─────────────────────────────────

describe("schema.ts — invoice workflow fields", () => {
  it("invoices table has followUpAt field", () => {
    expect(schema).toMatch(/followUpAt.*timestamp.*follow_up_at/s);
  });

  it("invoices table has promisedPaymentAt field", () => {
    expect(schema).toMatch(/promisedPaymentAt.*timestamp.*promised_payment_at/s);
  });

  it("invoices table has isDisputed field (boolean, default false)", () => {
    expect(schema).toMatch(/isDisputed.*boolean.*is_disputed.*notNull.*default\(false\)/s);
  });
});

// ── Schema: receivablesNotes table ──────────────────────────────────

describe("schema.ts — receivablesNotes table", () => {
  it("exports receivablesNotes table", () => {
    expect(schema).toMatch(/export const receivablesNotes = pgTable\("receivables_notes"/);
  });

  it("receivablesNotes has company_id (cascade delete)", () => {
    expect(schema).toMatch(/companyId.*company_id.*references.*companies.*cascade/s);
  });

  it("receivablesNotes has customerCompanyId (required)", () => {
    expect(schema).toMatch(/customerCompanyId.*varchar.*customer_company_id.*notNull/s);
  });

  it("receivablesNotes has invoiceId (optional, set null on delete)", () => {
    expect(schema).toMatch(/invoiceId.*varchar.*invoice_id.*references.*invoices.*set null/s);
  });

  it("receivablesNotes has paymentId (optional, set null on delete)", () => {
    expect(schema).toMatch(/paymentId.*varchar.*payment_id.*references.*payments.*set null/s);
  });

  it("receivablesNotes has userId (optional, set null on delete)", () => {
    expect(schema).toMatch(/userId.*varchar.*user_id.*references.*users.*set null/s);
  });

  it("receivablesNotes has noteType and noteText", () => {
    expect(schema).toMatch(/noteType.*text.*note_type/s);
    expect(schema).toMatch(/noteText.*text.*note_text/s);
  });

  it("receivablesNotes has promisedAt (nullable timestamp)", () => {
    expect(schema).toMatch(/promisedAt.*timestamp.*promised_at/s);
  });

  it("receivablesNotes has contactMethod (nullable)", () => {
    expect(schema).toMatch(/contactMethod.*text.*contact_method/s);
  });

  it("receivablesNotes has createdBySystem boolean", () => {
    expect(schema).toMatch(/createdBySystem.*boolean.*created_by_system.*notNull.*default\(false\)/s);
  });

  it("exports receivablesNoteTypeEnum with all six values", () => {
    expect(schema).toMatch(/receivablesNoteTypeEnum/);
    expect(schema).toMatch(/"general"/);
    expect(schema).toMatch(/"reminder"/);
    expect(schema).toMatch(/"promise_to_pay"/);
    expect(schema).toMatch(/"dispute"/);
    expect(schema).toMatch(/"escalation"/);
    expect(schema).toMatch(/"payment_received"/);
  });

  it("exports ReceivablesNote and InsertReceivablesNote types", () => {
    expect(schema).toMatch(/export type ReceivablesNote/);
    expect(schema).toMatch(/export type InsertReceivablesNote/);
  });

  it("exports insertReceivablesNoteSchema and updateReceivablesNoteSchema", () => {
    expect(schema).toMatch(/export const insertReceivablesNoteSchema/);
    expect(schema).toMatch(/export const updateReceivablesNoteSchema/);
  });
});

// ── Migrations ───────────────────────────────────────────────────────

describe("migration: 2026_05_13_invoice_receivables_fields.sql", () => {
  it("file exists", () => {
    expect(existsSync(join(ROOT, "migrations/2026_05_13_invoice_receivables_fields.sql"))).toBe(true);
  });

  it("adds follow_up_at column", () => {
    expect(migrationFields).toMatch(/ADD COLUMN.*follow_up_at/);
  });

  it("adds promised_payment_at column", () => {
    expect(migrationFields).toMatch(/ADD COLUMN.*promised_payment_at/);
  });

  it("adds is_disputed column with default false", () => {
    expect(migrationFields).toMatch(/ADD COLUMN.*is_disputed.*boolean.*DEFAULT false/);
  });

  it("creates partial index on follow_up_at", () => {
    expect(migrationFields).toMatch(/CREATE INDEX.*follow_up_at.*WHERE follow_up_at IS NOT NULL/s);
  });

  it("creates partial index on promised_payment_at", () => {
    expect(migrationFields).toMatch(/CREATE INDEX.*promised_payment_at.*WHERE promised_payment_at IS NOT NULL/s);
  });

  it("creates partial index on is_disputed", () => {
    expect(migrationFields).toMatch(/CREATE INDEX.*is_disputed.*WHERE is_disputed = true/s);
  });

  it("creates supporting view indexes (due_date, last_emailed_at, sent_at, balance)", () => {
    expect(migrationFields).toMatch(/CREATE INDEX.*due_date/);
    expect(migrationFields).toMatch(/CREATE INDEX.*last_emailed_at/);
    expect(migrationFields).toMatch(/CREATE INDEX.*sent_at/);
    expect(migrationFields).toMatch(/CREATE INDEX.*balance/);
  });
});

describe("migration: 2026_05_13_receivables_notes.sql", () => {
  it("file exists", () => {
    expect(existsSync(join(ROOT, "migrations/2026_05_13_receivables_notes.sql"))).toBe(true);
  });

  it("creates receivables_notes table", () => {
    expect(migrationNotes).toMatch(/CREATE TABLE.*receivables_notes/s);
  });

  it("note_type check constraint includes all six types", () => {
    expect(migrationNotes).toMatch(/receivables_notes_note_type_check/);
    expect(migrationNotes).toMatch(/'general'/);
    expect(migrationNotes).toMatch(/'promise_to_pay'/);
    expect(migrationNotes).toMatch(/'dispute'/);
  });

  it("promise_to_pay requires promised_at (DB-level constraint)", () => {
    expect(migrationNotes).toMatch(/receivables_notes_promise_requires_promised_at/);
    expect(migrationNotes).toMatch(/note_type != 'promise_to_pay' OR promised_at IS NOT NULL/);
  });

  it("company_id is tenant FK with cascade delete", () => {
    expect(migrationNotes).toMatch(/company_id.*REFERENCES companies.*ON DELETE CASCADE/s);
  });

  it("customer_company_id is NOT NULL", () => {
    expect(migrationNotes).toMatch(/customer_company_id.*NOT NULL/);
  });

  it("invoice_id is nullable with ON DELETE SET NULL", () => {
    expect(migrationNotes).toMatch(/invoice_id.*REFERENCES invoices.*ON DELETE SET NULL/s);
  });

  it("creates all five indexes", () => {
    expect(migrationNotes).toMatch(/receivables_notes_company_customer_idx/);
    expect(migrationNotes).toMatch(/receivables_notes_company_invoice_idx/);
    expect(migrationNotes).toMatch(/receivables_notes_company_payment_idx/);
    expect(migrationNotes).toMatch(/receivables_notes_company_created_at_idx/);
    expect(migrationNotes).toMatch(/receivables_notes_company_note_type_idx/);
  });
});

// ── Storage: ReceivablesNotesRepository ────────────────────────────

describe("ReceivablesNotesRepository", () => {
  it("file exists", () => {
    expect(existsSync(join(ROOT, "server/storage/receivablesNotes.ts"))).toBe(true);
  });

  it("exports receivablesNotesRepository singleton", () => {
    expect(receivablesNotes).toMatch(/export const receivablesNotesRepository/);
  });

  it("extends BaseRepository (inherits assertCompanyId + validateUUID)", () => {
    expect(receivablesNotes).toMatch(/extends BaseRepository/);
  });

  it("listReceivablesNotes accepts customerCompanyId, invoiceId, paymentId, noteType filters", () => {
    expect(receivablesNotes).toMatch(/listReceivablesNotes/);
    expect(receivablesNotes).toMatch(/customerCompanyId/);
    expect(receivablesNotes).toMatch(/invoiceId/);
    expect(receivablesNotes).toMatch(/paymentId/);
    expect(receivablesNotes).toMatch(/noteType/);
  });

  it("listReceivablesNotes orders by created_at DESC", () => {
    expect(receivablesNotes).toMatch(/orderBy.*desc.*createdAt/s);
  });

  it("createReceivablesNote validates noteType against enum", () => {
    expect(receivablesNotes).toMatch(/receivablesNoteTypeEnum.*includes.*input\.noteType/s);
  });

  it("createReceivablesNote rejects promise_to_pay without promisedAt", () => {
    expect(receivablesNotes).toMatch(/promise_to_pay.*!input\.promisedAt/s);
    expect(receivablesNotes).toMatch(/promisedAt is required for promise_to_pay/);
  });

  it("createReceivablesNote verifies customerCompanyId belongs to companyId (tenant isolation)", () => {
    expect(receivablesNotes).toMatch(/eq\(customerCompanies\.companyId, companyId\)/);
  });

  it("createReceivablesNote verifies invoiceId belongs to companyId (cross-tenant guard)", () => {
    expect(receivablesNotes).toMatch(/eq\(invoices\.companyId, companyId\)/);
  });

  it("createReceivablesNote verifies paymentId belongs to companyId", () => {
    expect(receivablesNotes).toMatch(/eq\(payments\.companyId, companyId\)/);
  });

  it("companyId and userId come from server context, never client body (no req.body.companyId)", () => {
    // The route calls createReceivablesNote(companyId, userId, parsed.data)
    // where companyId and userId are from req.user — not from parsed.data.
    expect(receivablesRoutes).toMatch(/req\.user!\.companyId/);
    expect(receivablesRoutes).toMatch(/req\.user!\.id/);
    // The create schema must NOT include companyId or userId.
    const createSchemaBlock = receivablesRoutes.match(/createNoteSchema[\s\S]*?\.strict\(\)/)?.[0] ?? "";
    expect(createSchemaBlock).not.toMatch(/companyId/);
    expect(createSchemaBlock).not.toMatch(/userId/);
  });

  it("createReceivablesNote wraps note insert + invoice field update in one transaction", () => {
    expect(receivablesNotes).toMatch(/db\.transaction/);
  });

  it("promise_to_pay note creation sets invoices.promised_payment_at atomically", () => {
    expect(receivablesNotes).toMatch(/promise_to_pay.*promisedPaymentAt/s);
  });

  it("dispute note creation sets invoices.is_disputed = true atomically", () => {
    expect(receivablesNotes).toMatch(/dispute.*isDisputed.*true/s);
  });

  it("deleteReceivablesNote does NOT clear invoice workflow flags", () => {
    // The delete method must not reference isDisputed or promisedPaymentAt.
    const deleteMethod = receivablesNotes.match(/deleteReceivablesNote[\s\S]*?^  \}/m)?.[0] ?? "";
    expect(deleteMethod).not.toMatch(/isDisputed/);
    expect(deleteMethod).not.toMatch(/promisedPaymentAt/);
  });

  it("updateReceivablesNote supports manager bypass (isManager option)", () => {
    expect(receivablesNotes).toMatch(/isManager.*boolean/s);
    expect(receivablesNotes).toMatch(/opts.*isManager/s);
  });

  it("setInvoiceFollowUp sets or clears follow_up_at and does not create a note", () => {
    expect(receivablesNotes).toMatch(/setInvoiceFollowUp/);
    expect(receivablesNotes).toMatch(/followUpAt.*followUpAt.*new Date|followUpAt.*null/s);
    // Must NOT insert a receivables note.
    const followUpMethod = receivablesNotes.match(/setInvoiceFollowUp[\s\S]*?^  \}/m)?.[0] ?? "";
    expect(followUpMethod).not.toMatch(/insert.*receivablesNotes/s);
  });

  it("promiseToPay method creates note + sets promised_payment_at atomically", () => {
    expect(receivablesNotes).toMatch(/promiseToPay/);
    expect(receivablesNotes).toMatch(/promisedPaymentAt.*new Date.*input\.promisedAt/s);
  });

  it("markDisputed method creates note + sets is_disputed = true atomically", () => {
    expect(receivablesNotes).toMatch(/markDisputed/);
    expect(receivablesNotes).toMatch(/isDisputed.*true/s);
  });

  it("promiseToPay requires invoice to have a customerCompanyId", () => {
    expect(receivablesNotes).toMatch(/Invoice has no customer company/);
  });
});

// ── Routes ───────────────────────────────────────────────────────────

describe("receivables routes", () => {
  it("GET /views/counts route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.get\s*\(\s*["']\/views\/counts["']/);
  });

  it("GET /invoices route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.get\s*\(\s*["']\/invoices["']/);
  });

  it("GET /notes route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.get\s*\(\s*["']\/notes["']/);
  });

  it("POST /notes route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.post\s*\(\s*["']\/notes["']/);
  });

  it("PATCH /notes/:id route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.patch\s*\(\s*["']\/notes\/:id["']/);
  });

  it("DELETE /notes/:id route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.delete\s*\(\s*["']\/notes\/:id["']/);
  });

  it("PATCH /invoices/:id/follow-up route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.patch\s*\(\s*["']\/invoices\/:id\/follow-up["']/);
  });

  it("PATCH /invoices/:id/promise-to-pay route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.patch\s*\(\s*["']\/invoices\/:id\/promise-to-pay["']/);
  });

  it("PATCH /invoices/:id/mark-disputed route exists", () => {
    expect(receivablesRoutes).toMatch(/router\.patch\s*\(\s*["']\/invoices\/:id\/mark-disputed["']/);
  });

  it("all routes are behind requireRole(MANAGER_ROLES)", () => {
    expect(receivablesRoutes).toMatch(/router\.use\(requireRole\(MANAGER_ROLES\)\)/);
  });

  it("GET /notes requires at least one filter param (customerCompanyId, invoiceId, or paymentId)", () => {
    expect(receivablesRoutes).toMatch(/customerCompanyId.*invoiceId.*paymentId/s);
    expect(receivablesRoutes).toMatch(/Provide at least one of/);
  });

  it("POST /notes validates with createNoteSchema (rejects bad noteType)", () => {
    expect(receivablesRoutes).toMatch(/createNoteSchema\.safeParse/);
  });

  it("PATCH /notes/:id validates with updateNoteSchema", () => {
    expect(receivablesRoutes).toMatch(/updateNoteSchema\.safeParse/);
  });

  it("PATCH /invoices/:id/follow-up validates with followUpSchema (allows null)", () => {
    expect(receivablesRoutes).toMatch(/followUpSchema\.safeParse/);
    expect(receivablesRoutes).toMatch(/followUpAt.*nullable/s);
  });

  it("PATCH /invoices/:id/promise-to-pay validates with promiseToPaySchema", () => {
    expect(receivablesRoutes).toMatch(/promiseToPaySchema\.safeParse/);
  });

  it("PATCH /invoices/:id/mark-disputed validates with markDisputedSchema", () => {
    expect(receivablesRoutes).toMatch(/markDisputedSchema\.safeParse/);
  });

  it("unknown view param rejected with 400", () => {
    expect(receivablesRoutes).toMatch(/Unknown view/);
    expect(receivablesRoutes).toMatch(/createError\(400/);
  });

  it("invalid threshold param rejected with 400", () => {
    expect(receivablesRoutes).toMatch(/threshold must be a non-negative number/);
  });

  it("mounted at /api/receivables in routes/index.ts", () => {
    expect(routesIndex).toMatch(/app\.use\("\/api\/receivables".*receivablesRouter\)/);
  });

  it("receivablesRouter imported in routes/index.ts", () => {
    expect(routesIndex).toMatch(/import receivablesRouter from "\.\/receivables"/);
  });

  it("mount is behind invoices.view permission", () => {
    expect(routesIndex).toMatch(/requirePermission\("invoices\.view"\).*receivablesRouter/s);
  });
});

// ── View counts: all predicates ─────────────────────────────────────

describe("GET /api/receivables/views/counts — view predicates", () => {
  it("all view excludes voided", () => {
    expect(receivablesRoutes).toMatch(/status != 'voided'/);
  });

  it("overdue view: status NOT IN draft/paid/voided + balance > 0 + due_date < CURRENT_DATE", () => {
    expect(receivablesRoutes).toMatch(/due_date < CURRENT_DATE/);
    expect(receivablesRoutes).toMatch(/balance > 0/);
  });

  it("awaitingPayment view: status IN awaiting_payment/sent/partial_paid + balance > 0", () => {
    expect(receivablesRoutes).toMatch(/awaiting_payment.*sent.*partial_paid/s);
  });

  it("drafts view: status = draft", () => {
    expect(receivablesRoutes).toMatch(/status = 'draft'/);
  });

  it("paid view: status = paid", () => {
    expect(receivablesRoutes).toMatch(/status = 'paid'/);
  });

  it("needsFollowUp view: follow_up_at <= NOW()", () => {
    expect(receivablesRoutes).toMatch(/follow_up_at <= NOW\(\)/);
  });

  it("sentThisWeek view uses interval subtraction from NOW()", () => {
    expect(receivablesRoutes).toMatch(/sent_at >= NOW\(\)/);
    expect(receivablesRoutes).toMatch(/SENT_THIS_WEEK_DAYS/);
  });

  it("noRecentContact view: last_emailed_at IS NULL OR older than threshold", () => {
    expect(receivablesRoutes).toMatch(/last_emailed_at IS NULL/);
    expect(receivablesRoutes).toMatch(/NO_RECENT_CONTACT_DAYS/);
  });

  it("highBalance view uses configurable threshold with default 1000", () => {
    expect(receivablesRoutes).toMatch(/HIGH_BALANCE_THRESHOLD_DEFAULT.*1000/);
    expect(receivablesRoutes).toMatch(/balance >= /);
  });

  it("disputed view: is_disputed = true", () => {
    expect(receivablesRoutes).toMatch(/is_disputed = true/);
  });

  it("promisedPayment view: promised_payment_at IS NOT NULL + balance > 0", () => {
    expect(receivablesRoutes).toMatch(/promised_payment_at IS NOT NULL/);
  });

  it("counts query is company-scoped (company_id = companyId)", () => {
    expect(receivablesRoutes).toMatch(/company_id = \$\{companyId\}/);
  });

  it("returns all 11 view keys", () => {
    const requiredKeys = [
      '"all"', '"overdue"', '"awaitingPayment"', '"drafts"', '"paid"',
      '"needsFollowUp"', '"sentThisWeek"', '"noRecentContact"',
      '"highBalance"', '"disputed"', '"promisedPayment"',
    ];
    for (const key of requiredKeys) {
      expect(receivablesRoutes).toContain(key);
    }
  });
});

// ── View list: all 11 views mapped ──────────────────────────────────

describe("GET /api/receivables/invoices — view mapping", () => {
  it("RECEIVABLES_VIEWS array contains all 11 views", () => {
    const views = [
      '"all"', '"overdue"', '"awaiting-payment"', '"drafts"', '"paid"',
      '"needs-follow-up"', '"sent-this-week"', '"no-recent-contact"',
      '"high-balance"', '"disputed"', '"promised-payment"',
    ];
    for (const v of views) {
      expect(receivablesRoutes).toContain(v);
    }
  });

  it("delegates to getInvoicesFeed for base query", () => {
    expect(receivablesRoutes).toMatch(/getInvoicesFeed/);
  });
});

// ── Payment invariant: paid-transition clearing ──────────────────────

describe("payment repository — paid-transition clears workflow flags", () => {
  it("recalculateInvoiceBalance clears promisedPaymentAt when newStatus = 'paid'", () => {
    expect(paymentsStorage).toMatch(/paidClear.*promisedPaymentAt.*null/s);
    expect(paymentsStorage).toMatch(/newStatus.*===.*"paid"[\s\S]*?promisedPaymentAt.*null/s);
  });

  it("recalculateInvoiceBalance clears isDisputed when newStatus = 'paid'", () => {
    expect(paymentsStorage).toMatch(/paidClear.*isDisputed.*false/s);
  });

  it("recalculateInvoiceBalance spreads paidClear into the update SET clause", () => {
    expect(paymentsStorage).toMatch(/\.\.\.paidClear/);
  });

  it("multi-invoice allocation path (applyMultiInvoicePayment) also clears workflow flags on paid", () => {
    // Two occurrences of paidClear: one in each path.
    const occurrences = (paymentsStorage.match(/paidClear/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4); // declaration + spread in each of two paths
  });

  it("followUpAt is NOT cleared in the paid-transition update", () => {
    // The paidClear object must not reference followUpAt.
    const paidClearBlock = paymentsStorage.match(/paidClear = newStatus[\s\S]*?\}/)?.[0] ?? "";
    expect(paidClearBlock).not.toMatch(/followUpAt/);
  });
});

// ── InvoiceFeed: new fields present ─────────────────────────────────

describe("invoicesFeed.ts — Phase 2A fields", () => {
  it("InvoiceFeedItem interface includes followUpAt", () => {
    expect(invoicesFeed).toMatch(/followUpAt.*string.*null/);
  });

  it("InvoiceFeedItem interface includes promisedPaymentAt", () => {
    expect(invoicesFeed).toMatch(/promisedPaymentAt.*string.*null/);
  });

  it("InvoiceFeedItem interface includes isDisputed", () => {
    expect(invoicesFeed).toMatch(/isDisputed.*boolean/);
  });

  it("feedSelectFields includes followUpAt from invoices table", () => {
    expect(invoicesFeed).toMatch(/followUpAt.*invoices\.followUpAt/s);
  });

  it("feedSelectFields includes promisedPaymentAt from invoices table", () => {
    expect(invoicesFeed).toMatch(/promisedPaymentAt.*invoices\.promisedPaymentAt/s);
  });

  it("feedSelectFields includes isDisputed from invoices table", () => {
    expect(invoicesFeed).toMatch(/isDisputed.*invoices\.isDisputed/s);
  });

  it("mapFeedRow maps isDisputed with a false fallback", () => {
    expect(invoicesFeed).toMatch(/isDisputed.*row\.isDisputed.*false/s);
  });

  it("InvoiceFeedItem interface includes lastEmailedAt", () => {
    expect(invoicesFeed).toMatch(/lastEmailedAt.*string.*null/);
  });
});

// ── Part 1: GET /notes noteType validation ───────────────────────────

describe("GET /api/receivables/notes — noteType validation", () => {
  it("noteType query param is validated with Zod (z.enum + safeParse)", () => {
    expect(receivablesRoutes).toMatch(/z\.enum\(receivablesNoteTypeEnum\)\.safeParse/);
  });

  it("invalid noteType returns HTTP 400 via createError", () => {
    expect(receivablesRoutes).toMatch(/createError\(\s*400.*noteType|noteType.*createError\(\s*400/s);
  });

  it("does not pass unvalidated noteType to repository (no 'as any' on noteType)", () => {
    expect(receivablesRoutes).not.toMatch(/noteType.*as any|as any.*noteType/);
  });

  it("valid noteType is passed to listReceivablesNotes without casting", () => {
    // After validation, noteType is typed as (typeof receivablesNoteTypeEnum)[number]
    expect(receivablesRoutes).toMatch(/noteType,/);
    expect(receivablesRoutes).toMatch(/z\.enum\(receivablesNoteTypeEnum\)/);
  });

  it("noteType is undefined (skipped) when not present in query", () => {
    // The validation only runs when noteTypeRaw !== undefined
    expect(receivablesRoutes).toMatch(/noteTypeRaw.*undefined/s);
  });
});

// ── Part 2: Manager/admin edit/delete permission semantics ────────────

describe("receivables notes — manager/admin edit/delete semantics", () => {
  it("PATCH /notes/:id derives isManager from MANAGER_ROLES check on the session role", () => {
    expect(receivablesRoutes).toMatch(/isManager.*MANAGER_ROLES\.includes.*req\.user!\.role/s);
  });

  it("DELETE /notes/:id derives isManager from MANAGER_ROLES check on the session role", () => {
    // Both PATCH and DELETE handlers call the repository with { isManager }
    const patchAndDelete = receivablesRoutes.match(
      /router\.patch[\s\S]*?router\.delete[\s\S]*?res\.json\(result\)/
    )?.[0] ?? "";
    expect(patchAndDelete).toMatch(/isManager.*MANAGER_ROLES\.includes/s);
  });

  it("updateReceivablesNote manager path uses only (noteId, companyId) — no userId predicate", () => {
    const updateMethod = receivablesNotes.match(
      /updateReceivablesNote[\s\S]*?const ownerPredicate[\s\S]*?limit\(1\)/
    )?.[0] ?? "";
    expect(updateMethod).toMatch(/opts\.isManager/);
    // Manager branch: and(eq(id), eq(companyId)) — no eq(userId)
    const managerBranch = updateMethod.match(/opts\.isManager\s*\?([\s\S]*?):/)?.[1] ?? "";
    expect(managerBranch).not.toMatch(/userId/);
  });

  it("deleteReceivablesNote manager path uses only (noteId, companyId) — no userId predicate", () => {
    const deleteMethod = receivablesNotes.match(
      /deleteReceivablesNote[\s\S]*?const ownerPredicate[\s\S]*?limit\(1\)/
    )?.[0] ?? "";
    const managerBranch = deleteMethod.match(/opts\.isManager\s*\?([\s\S]*?):/)?.[1] ?? "";
    expect(managerBranch).not.toMatch(/userId/);
  });

  it("companyId always comes from session context — cross-tenant edit is impossible", () => {
    // Route uses req.user!.companyId, never req.body.companyId
    expect(receivablesRoutes).toMatch(/companyId = req\.user!\.companyId/);
    // Storage WHERE clause always includes eq(receivablesNotes.companyId, companyId)
    expect(receivablesNotes).toMatch(/eq\(receivablesNotes\.companyId, companyId\)/);
  });

  it("userId always comes from session context — client cannot spoof it", () => {
    expect(receivablesRoutes).toMatch(/userId = req\.user!\.id/);
    // createNoteSchema must not include userId or companyId
    const createSchemaBlock = receivablesRoutes.match(/createNoteSchema[\s\S]*?\.strict\(\)/)?.[0] ?? "";
    expect(createSchemaBlock).not.toMatch(/userId/);
    expect(createSchemaBlock).not.toMatch(/companyId/);
  });

  it("updateReceivablesNote never overwrites userId (createdBy attribution preserved)", () => {
    // The setFields object must not contain userId
    const setFieldsBlock = receivablesNotes.match(
      /const setFields[\s\S]*?const \[updated\]/
    )?.[0] ?? "";
    expect(setFieldsBlock).not.toMatch(/userId/);
  });

  it("docstring states manager/admin may edit any same-tenant note", () => {
    expect(receivablesNotes).toMatch(/Manager\/admin.*isManager=true.*may edit any note/s);
  });

  it("docstring states manager/admin may delete any same-tenant note", () => {
    expect(receivablesNotes).toMatch(/Manager\/admin.*isManager=true.*may delete any note/s);
  });
});

// ── Part 3: SQL predicates — no JS post-filter ────────────────────────

describe("GET /api/receivables/invoices — SQL predicates, no JS post-filter", () => {
  it("no postFilter variable in the route (post-filter pattern eliminated)", () => {
    expect(receivablesRoutes).not.toMatch(/postFilter/);
  });

  it("no Math.min over-fetch pattern (no limit * 3 or 600 cap)", () => {
    expect(receivablesRoutes).not.toMatch(/limit \* 3/);
    expect(receivablesRoutes).not.toMatch(/Math\.min\(limit/);
  });

  it("needs-follow-up maps to followUpDue SQL predicate", () => {
    expect(receivablesRoutes).toMatch(/needs-follow-up[\s\S]*?followUpDue.*true/s);
  });

  it("sent-this-week maps to sentSince SQL predicate", () => {
    expect(receivablesRoutes).toMatch(/sent-this-week[\s\S]*?sentSince/s);
  });

  it("no-recent-contact maps to noContactBefore SQL predicate", () => {
    expect(receivablesRoutes).toMatch(/no-recent-contact[\s\S]*?noContactBefore/s);
  });

  it("high-balance maps to minBalance SQL predicate (threshold-parameterized)", () => {
    expect(receivablesRoutes).toMatch(/high-balance[\s\S]*?minBalance/s);
    expect(receivablesRoutes).toMatch(/threshold\.toFixed\(2\)/);
  });

  it("disputed maps to disputedOnly SQL predicate", () => {
    expect(receivablesRoutes).toMatch(/disputed[\s\S]*?disputedOnly.*true/s);
  });

  it("promised-payment maps to promisedPaymentOnly SQL predicate", () => {
    expect(receivablesRoutes).toMatch(/promised-payment[\s\S]*?promisedPaymentOnly.*true/s);
  });

  it("invoicesFeed applies followUpDue as SQL predicate (follow_up_at <= NOW)", () => {
    expect(invoicesFeed).toMatch(/followUpAt.*<= NOW\(\)|follow_up_at.*NOW/s);
    expect(invoicesFeed).toMatch(/followUpDue/);
  });

  it("invoicesFeed applies sentSince as SQL predicate (sent_at >=)", () => {
    expect(invoicesFeed).toMatch(/sentSince/);
    expect(invoicesFeed).toMatch(/sentAt.*>=|sent_at.*>=/s);
  });

  it("invoicesFeed applies noContactBefore as SQL predicate (last_emailed_at <)", () => {
    expect(invoicesFeed).toMatch(/noContactBefore/);
    expect(invoicesFeed).toMatch(/lastEmailedAt.*<|last_emailed_at.*</s);
  });

  it("invoicesFeed applies minBalance as SQL predicate (CAST balance >= ...)", () => {
    expect(invoicesFeed).toMatch(/minBalance/);
    expect(invoicesFeed).toMatch(/CAST.*balance.*numeric.*>=.*minBalance|minBalance.*balance/s);
  });

  it("invoicesFeed applies disputedOnly as SQL predicate (is_disputed = true)", () => {
    expect(invoicesFeed).toMatch(/disputedOnly/);
    expect(invoicesFeed).toMatch(/isDisputed.*true|is_disputed.*true/s);
  });

  it("invoicesFeed applies promisedPaymentOnly as SQL predicate (promised_payment_at IS NOT NULL)", () => {
    expect(invoicesFeed).toMatch(/promisedPaymentOnly/);
    expect(invoicesFeed).toMatch(/isNotNull.*promisedPaymentAt|promised_payment_at.*IS NOT NULL/s);
  });

  it("limit/offset applied after receivables predicates in invoicesFeed source order", () => {
    const followUpIdx = invoicesFeed.indexOf("followUpDue");
    const limitIdx = invoicesFeed.indexOf("query = query.limit(limit)");
    expect(followUpIdx).toBeGreaterThan(0);
    expect(limitIdx).toBeGreaterThan(followUpIdx);
  });

  it("every receivables predicate includes tenant-scoped status exclusions", () => {
    // followUpDue: NOT IN paid/voided
    expect(invoicesFeed).toMatch(/followUpDue[\s\S]*?NOT IN.*paid.*voided/s);
    // noContactBefore: NOT IN draft/paid/voided
    expect(invoicesFeed).toMatch(/noContactBefore[\s\S]*?NOT IN.*draft.*paid.*voided/s);
    // minBalance: NOT IN draft/paid/voided
    expect(invoicesFeed).toMatch(/minBalance[\s\S]*?NOT IN.*draft.*paid.*voided/s);
    // disputedOnly: NOT IN paid/voided
    expect(invoicesFeed).toMatch(/disputedOnly[\s\S]*?NOT IN.*paid.*voided/s);
    // promisedPaymentOnly: NOT IN paid/voided
    expect(invoicesFeed).toMatch(/promisedPaymentOnly[\s\S]*?NOT IN.*paid.*voided/s);
  });

  it("unknown view still returns 400", () => {
    expect(receivablesRoutes).toMatch(/Unknown view/);
    expect(receivablesRoutes).toMatch(/createError\(400/);
  });

  it("high-balance threshold defaults to HIGH_BALANCE_THRESHOLD_DEFAULT", () => {
    expect(receivablesRoutes).toMatch(/HIGH_BALANCE_THRESHOLD_DEFAULT.*1000/);
    expect(receivablesRoutes).toMatch(/threshold.*parseFloat.*HIGH_BALANCE_THRESHOLD_DEFAULT/s);
  });

  it("view count predicates and invoice list predicates are semantically aligned (Phase 2A views)", () => {
    // Both follow_up_at <= NOW() and NOT IN paid/voided appear in the counts query
    expect(receivablesRoutes).toMatch(/follow_up_at <= NOW\(\)/);
    // And the list route uses followUpDue which applies the same SQL in invoicesFeed
    expect(receivablesRoutes).toMatch(/followUpDue.*true/s);
  });
});

// ── Phase 2B wiring consistency ───────────────────────────────────────

describe("Phase 2B — UI wiring consistency", () => {
  it("ReceivablesActionsRail hides action buttons on multi-select (Phase 2B: isMultiSelect branch)", () => {
    const rail = readFileSync(
      join(ROOT, "client/src/pages/receivables/ReceivablesActionsRail.tsx"),
      "utf-8",
    );
    // Phase 2B stabilization: buttons are hidden (not disabled) on multi-select.
    // They live inside the !isMultiSelect else-branch so they're never focusable/tabbable
    // when multiple invoices are selected.
    expect(rail).toMatch(/isMultiSelect/);
    expect(rail).toMatch(/data-testid="multi-select-hint"/);
    expect(rail).not.toMatch(/disabled=\{!singleInvoiceId\}/);
    // Primary action buttons still exist in source for single-select
    expect(rail).toMatch(/data-testid="receivables-action-set-follow-up"/);
    expect(rail).toMatch(/data-testid="receivables-action-promise-to-pay"/);
    expect(rail).toMatch(/data-testid="receivables-action-mark-disputed"/);
  });

  it("InvoiceViewRail lists all Phase 2 views", () => {
    const viewRail = readFileSync(
      join(ROOT, "client/src/pages/receivables/InvoiceViewRail.tsx"),
      "utf-8",
    );
    expect(viewRail).toMatch(/Needs Follow-up/);
    expect(viewRail).toMatch(/Disputed/);
    expect(viewRail).toMatch(/Promised Payment/);
    expect(viewRail).toMatch(/No Recent Contact/);
    expect(viewRail).toMatch(/High Balance/);
  });
});
