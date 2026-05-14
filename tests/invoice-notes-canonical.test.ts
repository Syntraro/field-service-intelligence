/**
 * Canonical invoice notes — coverage for the 2026-05-03 rewrite that
 * promotes invoice notes to a first-class per-entity surface
 * (`invoice_notes` + `invoice_note_attachments` + dedicated routes).
 *
 * Two layers of guards:
 *
 *   Layer 1 — execution-level repository round-trip.
 *     Picks the first tenant + invoice from the dev DB, runs the new
 *     repo's create / list / update / delete cycle, asserts the wire
 *     is intact end-to-end. Catches schema-vs-route drift, missing
 *     FK relationships, tenant-scope regressions.
 *
 *   Layer 2 — source-level wiring guards.
 *     Locks the architectural invariants the user's spec enumerated:
 *       - InvoiceDetailPage no longer mounts DraftNotesCard
 *       - InvoiceDetailPage no longer passes `writeEntityId={jobId}`
 *         on the EntityNotesSection
 *       - `/api/invoices/:id/notes` carries POST/PATCH/DELETE on the
 *         server (not just GET)
 *       - The fileUploadService FileEntityType union includes
 *         `invoice_note` and the adapter map registers it
 *       - EntityNoteDialog's endpoint resolver routes invoice writes
 *         through `/api/invoices/...` (NOT `/api/jobs/...`)
 *       - NewInvoicePage shows the "Save the invoice before adding
 *         notes" disabled placeholder instead of a draft notes editor
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq, and } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  invoices,
  invoiceNotes,
  invoiceNoteAttachments,
  jobNotes,
  users,
} from "@shared/schema";
import { invoiceNotesRepository } from "../server/storage/invoiceNotes";

// ---------------------------------------------------------------------------
// Fixture discovery — minimal: pick the first tenant + invoice + user that
// already exist in the dev DB. No row insertion, no data mutation beyond
// the repo round-trip (the test cleans up after itself).
// ---------------------------------------------------------------------------

let tenantId: string | null = null;
let invoiceId: string | null = null;
let userId: string | null = null;

beforeAll(async () => {
  // Pick the first invoice + a user in the same company.
  const invRows = await db
    .select({ id: invoices.id, companyId: invoices.companyId })
    .from(invoices)
    .limit(1);
  if (invRows.length === 0) return;
  invoiceId = invRows[0].id;
  tenantId = invRows[0].companyId;

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.companyId, tenantId))
    .limit(1);
  userId = userRows[0]?.id ?? null;
});

// ---------------------------------------------------------------------------
// Layer 1 — repository round-trip
// ---------------------------------------------------------------------------

describe("Invoice notes — canonical repository round-trip", () => {
  it("create → list → update → delete", async () => {
    if (!tenantId || !invoiceId || !userId) {
      console.warn("[invoice-notes] skip — fixture data unavailable");
      return;
    }

    // 1) CREATE — a tagged note we'll find again in the list result.
    const tag = `__test_invoice_note_${Date.now()}__`;
    const created = await invoiceNotesRepository.createInvoiceNote(
      tenantId,
      invoiceId,
      userId,
      tag,
    );
    expect(created).toBeDefined();
    expect(created!.noteText).toBe(tag);
    expect(created!.invoiceId).toBe(invoiceId);

    // 2) LIST — the new note is in the listing with the tagged text.
    const listed = await invoiceNotesRepository.listInvoiceNotes(tenantId, invoiceId);
    const found = listed.find((n) => n.noteText === tag);
    expect(found, "newly created note should be in list").toBeDefined();
    expect(found!.id).toBe(created!.id);
    // Hydrated user metadata is present.
    expect(found!.userName).toBeDefined();
    // Attachments default to []
    expect(Array.isArray(found!.attachments)).toBe(true);
    expect(found!.attachments.length).toBe(0);

    // 3) UPDATE — text mutates, id stays.
    const newTag = `${tag}_updated`;
    const updated = await invoiceNotesRepository.updateInvoiceNote(
      tenantId,
      created!.id,
      userId,
      newTag,
    );
    expect(updated!.id).toBe(created!.id);
    expect(updated!.noteText).toBe(newTag);

    // 4) DELETE — note disappears from listing.
    await invoiceNotesRepository.deleteInvoiceNote(tenantId, created!.id, userId);
    const afterDelete = await invoiceNotesRepository.listInvoiceNotes(tenantId, invoiceId);
    expect(afterDelete.find((n) => n.id === created!.id)).toBeUndefined();
  });

  it("createInvoiceNote rejects mismatched tenant", async () => {
    if (!tenantId || !invoiceId || !userId) return;
    const bogusTenantId = "00000000-0000-0000-0000-000000000000";
    await expect(
      invoiceNotesRepository.createInvoiceNote(
        bogusTenantId,
        invoiceId, // real invoice in OTHER tenant
        userId,
        "should-not-create",
      ),
    ).rejects.toThrow();
  });

  it("listInvoiceNotes rejects missing invoice", async () => {
    if (!tenantId) return;
    const bogusInvoiceId = "00000000-0000-0000-0000-000000000000";
    await expect(
      invoiceNotesRepository.listInvoiceNotes(tenantId, bogusInvoiceId),
    ).rejects.toThrow();
  });

  it("does NOT write to the jobNotes table when invoice has a linked job", async () => {
    if (!tenantId || !userId) return;
    // Find an invoice with a linked job to verify the new path bypasses jobs.
    const linked = await db
      .select({ id: invoices.id, jobId: invoices.jobId })
      .from(invoices)
      .where(and(eq(invoices.companyId, tenantId)))
      .limit(20);
    const withJob = linked.find((row) => row.jobId);
    if (!withJob || !withJob.jobId) return;

    // Snapshot the linked job's note count BEFORE.
    const beforeJobCount = await db
      .select({ id: jobNotes.id })
      .from(jobNotes)
      .where(and(eq(jobNotes.companyId, tenantId), eq(jobNotes.jobId, withJob.jobId)));

    const tag = `__test_invoice_note_no_job_write_${Date.now()}__`;
    const created = await invoiceNotesRepository.createInvoiceNote(
      tenantId,
      withJob.id,
      userId,
      tag,
    );
    expect(created).toBeDefined();

    // Snapshot AFTER — invoice note is in invoice_notes, NOT in job_notes.
    const afterJobCount = await db
      .select({ id: jobNotes.id })
      .from(jobNotes)
      .where(and(eq(jobNotes.companyId, tenantId), eq(jobNotes.jobId, withJob.jobId)));
    expect(afterJobCount.length).toBe(beforeJobCount.length);

    // Confirm row landed in invoice_notes.
    const inInvoiceNotes = await db
      .select({ id: invoiceNotes.id })
      .from(invoiceNotes)
      .where(and(eq(invoiceNotes.companyId, tenantId), eq(invoiceNotes.id, created!.id)));
    expect(inInvoiceNotes.length).toBe(1);

    // Cleanup.
    await invoiceNotesRepository.deleteInvoiceNote(tenantId, created!.id, userId);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — source-level wiring guards
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, "..");

describe("Invoice notes — InvoiceDetailPage canonical wiring", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "client", "src", "pages", "InvoiceDetailPage.tsx"),
    "utf-8",
  );
  // 2026-05-10: EntityNotesPanel is now hosted inside InvoiceActivityPanel
  // (the Activity rail tab). The page-level guard now checks the activity
  // panel component instead.
  const activityPanelSource = fs.readFileSync(
    path.join(repoRoot, "client", "src", "components", "invoice", "InvoiceActivityPanel.tsx"),
    "utf-8",
  );

  it("no longer imports DraftNotesCard", () => {
    expect(source).not.toMatch(
      /import\s*\{\s*DraftNotesCard\s*\}\s*from\s*"@\/components\/invoice\/DraftNotesCard"/,
    );
  });

  it("does not mount DraftNotesCard for any invoice branch", () => {
    expect(source).not.toMatch(/<DraftNotesCard/);
  });

  it("mounts EntityNotesPanel with entityType='invoice' and NO writeEntityId indirection", () => {
    // 2026-05-08 Tier 4 Notes canonicalization — primitive renamed
    // from `EntityNotesSection` to `EntityNotesPanel`. The
    // `writeEntityId` indirection retired in 2026-05-03 stays
    // forbidden.
    // 2026-05-10: EntityNotesPanel is now in InvoiceActivityPanel (the
    // Activity rail tab) rather than directly in InvoiceDetailPage.
    const block = activityPanelSource.match(
      /<EntityNotesPanel[\s\S]+?\/>/,
    );
    expect(block, "EntityNotesPanel mount must exist in InvoiceActivityPanel").not.toBeNull();
    expect(block![0]).toMatch(/entityType="invoice"/);
    expect(block![0]).toMatch(/entityId=\{invoiceId\}/);
    expect(block![0]).not.toMatch(/writeEntityId=/);
  });
});

describe("Invoice notes — server routes carry full CRUD", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "invoices.ts"),
    "utf-8",
  );

  it("POST /api/invoices/:invoiceId/notes is registered", () => {
    expect(source).toMatch(
      /router\.post\(\s*"\/:invoiceId\/notes",/,
    );
  });

  it("PATCH /api/invoices/:invoiceId/notes/:noteId is registered", () => {
    expect(source).toMatch(
      /router\.patch\(\s*"\/:invoiceId\/notes\/:noteId",/,
    );
  });

  it("DELETE /api/invoices/:invoiceId/notes/:noteId is registered", () => {
    expect(source).toMatch(
      /router\.delete\(\s*"\/:invoiceId\/notes\/:noteId",/,
    );
  });

  it("DELETE /api/invoices/:invoiceId/notes/:noteId/attachments/:attachmentId is registered", () => {
    expect(source).toMatch(
      /router\.delete\(\s*\n?\s*"\/:invoiceId\/notes\/:noteId\/attachments\/:attachmentId",/,
    );
  });

  it("write paths route through invoiceNotesRepository (NOT jobNotesRepository)", () => {
    // POST/PATCH/DELETE blocks should call into invoiceNotesRepository,
    // never the job-notes repo. Find the POST handler block and assert.
    const postBlock = source.match(
      /router\.post\(\s*"\/:invoiceId\/notes",[\s\S]+?\}\)\);/,
    );
    expect(postBlock, "POST handler must exist").not.toBeNull();
    expect(postBlock![0]).toMatch(/invoiceNotesRepository\.createInvoiceNote/);
    expect(postBlock![0]).not.toMatch(/jobNotesRepository\.createJobNote/);
  });

  it("GET path tags entity-owned rows with origin='invoice' (not 'job')", () => {
    const getBlock = source.match(
      /router\.get\(\s*"\/:invoiceId\/notes",[\s\S]+?\}\)\);/,
    );
    expect(getBlock, "GET handler must exist").not.toBeNull();
    expect(getBlock![0]).toMatch(/origin: "invoice"/);
    // 2026-05-03: the prior `origin: "job"` tag for borrowed-job-notes is gone.
    // Inherited client_* origins still flow through (they come from
    // clientNotesRepository.listInheritedForEntity), so we DO NOT
    // forbid every "job" string — only the explicit owned tag.
    expect(getBlock![0]).not.toMatch(/origin: "job"/);
  });
});

describe("Invoice notes — fileUploadService extension", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "server", "services", "fileUploadService.ts"),
    "utf-8",
  );

  it("FileEntityType union includes 'invoice_note'", () => {
    // Match the type-union literal — the | "invoice_note" line.
    expect(source).toMatch(/\|\s*"invoice_note"/);
  });

  it("ENTITY_ADAPTERS registers invoice_note adapter that writes to invoiceNoteAttachments", () => {
    const block = source.match(
      /invoice_note:\s*\{[\s\S]+?\},/,
    );
    expect(block, "invoice_note adapter must exist").not.toBeNull();
    expect(block![0]).toMatch(/resolve:\s*resolveInvoiceNote/);
    expect(block![0]).toMatch(/db\.insert\(invoiceNoteAttachments\)/);
    expect(block![0]).toMatch(/tenants\/\$\{ctx\.tenantId\}\/invoices\//);
  });
});

describe("Invoice notes — EntityNoteDialog routes invoice writes through /api/invoices/...", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "client", "src", "components", "notes", "EntityNoteDialog.tsx"),
    "utf-8",
  );

  it("resolveEndpoints emits /api/invoices basePath for entityType='invoice'", () => {
    expect(source).toMatch(
      /entityType === "invoice"[\s\S]+?basePath:\s*`\/api\/invoices\/\$\{entityId\}\/notes`/,
    );
  });

  it("fileUploadEntityFor returns 'invoice_note' for entityType='invoice'", () => {
    expect(source).toMatch(
      /entityType === "invoice"\s*\)\s*return\s*"invoice_note"/,
    );
  });
});

describe("Invoice notes — NewInvoicePage gates notes pre-save", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "client", "src", "pages", "NewInvoicePage.tsx"),
    "utf-8",
  );

  it("does NOT import DraftNotesCard", () => {
    expect(source).not.toMatch(
      /import\s*\{\s*DraftNotesCard\s*\}\s*from\s*"@\/components\/invoice\/DraftNotesCard"/,
    );
  });

  it("does NOT mount DraftNotesCard", () => {
    expect(source).not.toMatch(/<DraftNotesCard/);
  });

  it("renders the canonical 'Save first' placeholder with stable testId", () => {
    expect(source).toMatch(/data-testid="invoice-notes-save-first"/);
    expect(source).toMatch(/Save the invoice before adding notes\./);
  });

  it("does NOT include notesInternal in the create payload", () => {
    // The create payload-building block previously read
    //   ...(notesInternal.trim() ? { notesInternal: ... } : {})
    // — that's been removed in favor of post-save canonical notes.
    expect(source).not.toMatch(
      /\.\.\.\(notesInternal\.trim\(\)\s*\?\s*\{\s*notesInternal:/,
    );
  });
});

// ── Phase 2: operational path cleanup (2026-05-13) ─────────────────────────

describe("Invoice notes — legacy fields removed from route schemas (Phase 2)", () => {
  const routeSrc = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "invoices.ts"),
    "utf-8",
  );

  it("updateInvoiceSchema no longer declares notesInternal", () => {
    // Grab only the local updateInvoiceSchema block in routes/invoices.ts
    const start = routeSrc.indexOf("const updateInvoiceSchema = z.object({");
    const end   = routeSrc.indexOf("});", start);
    const block = routeSrc.slice(start, end);
    expect(block).not.toMatch(/notesInternal/);
  });

  it("updateInvoiceSchema no longer declares notesCustomer", () => {
    const start = routeSrc.indexOf("const updateInvoiceSchema = z.object({");
    const end   = routeSrc.indexOf("});", start);
    const block = routeSrc.slice(start, end);
    expect(block).not.toMatch(/notesCustomer/);
  });

  it("createAtomicSchema no longer declares notesInternal", () => {
    const start = routeSrc.indexOf("const createAtomicSchema = z.object({");
    const end   = routeSrc.indexOf("});", start);
    const block = routeSrc.slice(start, end);
    expect(block).not.toMatch(/notesInternal/);
  });

  it("createAtomicSchema no longer declares notesCustomer", () => {
    const start = routeSrc.indexOf("const createAtomicSchema = z.object({");
    const end   = routeSrc.indexOf("});", start);
    const block = routeSrc.slice(start, end);
    expect(block).not.toMatch(/notesCustomer/);
  });

  it("atomic handler does not forward notesInternal to the service", () => {
    expect(routeSrc).not.toMatch(/notesInternal:\s*validated\.notesInternal/);
  });

  it("atomic handler does not forward notesCustomer to the service", () => {
    expect(routeSrc).not.toMatch(/notesCustomer:\s*validated\.notesCustomer/);
  });
});

describe("Invoice notes — legacy fields removed from invoiceCreationService (Phase 2)", () => {
  const svcSrc = fs.readFileSync(
    path.join(repoRoot, "server", "services", "invoiceCreationService.ts"),
    "utf-8",
  );

  it("InvoiceCreationParams no longer has notesInternal field", () => {
    expect(svcSrc).not.toMatch(/notesInternal\?:\s*string/);
  });

  it("InvoiceCreationParams no longer has notesCustomer field", () => {
    expect(svcSrc).not.toMatch(/notesCustomer\?:\s*string/);
  });

  it("service does not pass notesInternal to storage", () => {
    expect(svcSrc).not.toMatch(/notesInternal:\s*payload\.notesInternal/);
  });

  it("service does not pass notesCustomer to storage", () => {
    expect(svcSrc).not.toMatch(/notesCustomer:\s*payload\.notesCustomer/);
  });
});

describe("Invoice notes — legacy fields removed from storage createInvoiceAtomic (Phase 2)", () => {
  const storageSrc = fs.readFileSync(
    path.join(repoRoot, "server", "storage", "invoices.ts"),
    "utf-8",
  );

  it("createInvoiceAtomic params interface no longer has notesInternal", () => {
    // Find the createInvoiceAtomic function and check its params block.
    // The import-only createImportedInvoice is allowed to keep it.
    const start = storageSrc.indexOf("createInvoiceAtomic(");
    const end   = storageSrc.indexOf("creationSource: InvoiceCreationSource,", start);
    const block = storageSrc.slice(start, end);
    expect(block).not.toMatch(/notesInternal\?:\s*string/);
  });

  it("createInvoiceAtomic params interface no longer has notesCustomer", () => {
    const start = storageSrc.indexOf("createInvoiceAtomic(");
    const end   = storageSrc.indexOf("creationSource: InvoiceCreationSource,", start);
    const block = storageSrc.slice(start, end);
    expect(block).not.toMatch(/notesCustomer\?:\s*string/);
  });

  it("createInvoiceAtomic header patch no longer writes notesInternal", () => {
    const start = storageSrc.indexOf("createInvoiceAtomic(");
    const nextFn = storageSrc.indexOf("\n  async ", start + 1);
    const block  = storageSrc.slice(start, nextFn);
    expect(block).not.toMatch(/headerPatch\.notesInternal/);
  });

  it("createInvoiceAtomic header patch no longer writes notesCustomer", () => {
    const start = storageSrc.indexOf("createInvoiceAtomic(");
    const nextFn = storageSrc.indexOf("\n  async ", start + 1);
    const block  = storageSrc.slice(start, nextFn);
    expect(block).not.toMatch(/headerPatch\.notesCustomer/);
  });
});

describe("Invoice notes — QBO mapper no longer sends PrivateNote from notesInternal (Phase 2)", () => {
  const mapperSrc = fs.readFileSync(
    path.join(repoRoot, "server", "qbo", "mappers.ts"),
    "utf-8",
  );

  it("does not set payload.PrivateNote from invoice.notesInternal", () => {
    expect(mapperSrc).not.toMatch(/payload\.PrivateNote\s*=\s*invoice\.notesInternal/);
  });

  it("still sends customerMemo from invoice.clientMessage (not notesCustomer)", () => {
    expect(mapperSrc).toMatch(/invoice\.clientMessage/);
    expect(mapperSrc).not.toMatch(/invoice\.notesCustomer/);
  });
});

describe("Invoice notes — shared updateInvoiceSchema no longer includes legacy fields (Phase 2)", () => {
  const schemaSrc = fs.readFileSync(
    path.join(repoRoot, "shared", "schema.ts"),
    "utf-8",
  );

  it("shared updateInvoiceSchema no longer has notesInternal", () => {
    const start = schemaSrc.indexOf("export const updateInvoiceSchema = z.object({");
    const end   = schemaSrc.indexOf("});", start);
    const block = schemaSrc.slice(start, end);
    expect(block).not.toMatch(/notesInternal/);
  });

  it("shared updateInvoiceSchema no longer has notesCustomer", () => {
    const start = schemaSrc.indexOf("export const updateInvoiceSchema = z.object({");
    const end   = schemaSrc.indexOf("});", start);
    const block = schemaSrc.slice(start, end);
    expect(block).not.toMatch(/notesCustomer/);
  });
});

describe("Invoice notes — quote notesCustomer intentionally preserved (Phase 2)", () => {
  const quoteRouteSrc = fs.readFileSync(
    path.join(repoRoot, "server", "routes", "quotes.ts"),
    "utf-8",
  );
  const quotePageSrc = fs.readFileSync(
    path.join(repoRoot, "client", "src", "pages", "QuoteDetailPage.tsx"),
    "utf-8",
  );

  it("quote routes still accept notesCustomer (description field for quotes)", () => {
    expect(quoteRouteSrc).toMatch(/notesCustomer/);
  });

  it("QuoteDetailPage still uses notesCustomer as the description field", () => {
    expect(quotePageSrc).toMatch(/notesCustomer/);
  });
});
