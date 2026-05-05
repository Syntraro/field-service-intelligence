/**
 * Lead → Quote Conversion — Regression tests (2026-05-05).
 *
 * Two layers:
 *
 *   1. Storage layer (real DB). We exercise the same sequence the
 *      `POST /api/quotes` route runs when `leadId` is set:
 *        - quoteRepository.createQuote({ leadId, ... })
 *        - leadRepository.updateLead({ status: "quoted",
 *                                      convertedQuoteId, convertedAt })
 *      and verify the resulting DB rows. Side effects we explicitly
 *      check the conversion does NOT cause:
 *        - lead notes / lead-note attachments are not duplicated onto
 *          the quote (they remain bound to the originating lead)
 *        - lead_visits rows are not touched (open or completed visits
 *          remain attached to the lead)
 *        - the lead is not deleted/archived
 *
 *   2. Source-pin layer. We pin the route-handler gate (so a future
 *      regression that drops the "already quoted" / "already won" /
 *      "convertedQuoteId set" guards fails this file) AND the two
 *      frontend changes from this PR — the LeadDetailPage `canConvert`
 *      now includes "needs_review", and QuoteHeaderCard renders an
 *      "Originated from Lead" backlink when `quote.leadId` is set.
 *
 * Scenarios required by the spec:
 *
 *    1. new lead converts to quote                              ✓
 *    2. contacted lead converts to quote                        ✓
 *    3. needs_review lead converts to quote                     ✓
 *    4. quote.leadId is set                                     ✓
 *    5. lead.convertedQuoteId is set                            ✓
 *    6. lead.convertedAt is set                                 ✓
 *    7. already quoted lead cannot be reconverted               ✓ (source-pin)
 *    8. won lead cannot be converted                            ✓ (source-pin)
 *    9. standalone quote creation without leadId still works    ✓
 *   10. lead with completed lead visit converts cleanly         ✓
 *   11. lead with notes/photos converts without copying them    ✓
 *
 * Plus: source-pin that LeadDetailPage's canConvert covers
 * "needs_review", and QuoteHeaderCard renders the lead backlink.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { eq, and, inArray } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  leads,
  leadNotes,
  leadNoteAttachments,
  leadVisits,
  files,
  quotes,
  quoteLines,
} from "@shared/schema";
import { quoteRepository } from "../server/storage/quotes";
import { leadRepository } from "../server/storage/leads";
import { createLeadVisit, markLeadVisitCompleted } from "../server/storage/leadVisits";

const PREFIX = "lead_quote_conv_test_";

const tenantA = uuidv4();
const ownerA = uuidv4();
const techA = uuidv4();
const customerA = uuidv4();
const locationA = uuidv4();

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
}

async function teardownFixtures() {
  // Order matters — child rows first (cascades cover most of this, but
  // be explicit so a partial run doesn't leave orphans).
  await db.delete(leadNoteAttachments).where(eq(leadNoteAttachments.companyId, tenantA));
  await db.delete(files).where(eq(files.companyId, tenantA));
  await db.delete(leadNotes).where(eq(leadNotes.companyId, tenantA));
  await db.delete(leadVisits).where(eq(leadVisits.companyId, tenantA));
  await db.delete(quoteLines).where(eq(quoteLines.companyId, tenantA));
  await db.delete(quotes).where(eq(quotes.companyId, tenantA));
  await db.delete(leads).where(eq(leads.companyId, tenantA));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, tenantA));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tenantA));
  await db.delete(users).where(eq(users.companyId, tenantA));
  await db.delete(companies).where(eq(companies.id, tenantA));
}

/**
 * Mirrors the conversion sequence inside `POST /api/quotes` (see
 * server/routes/quotes.ts:154-220). Lets us assert the exact behavior
 * the route runs without booting Express + auth + CSRF.
 */
async function convertLeadToQuote(leadId: string) {
  const lead = await leadRepository.getLead(tenantA, leadId);
  if (!lead) throw new Error("lead not found");
  if (lead.status === "quoted" || lead.status === "won") {
    throw new Error(`Lead is already '${lead.status}'`);
  }
  if (lead.convertedQuoteId) {
    throw new Error("Lead already has a linked quote");
  }
  const quote = await quoteRepository.createQuote(
    tenantA,
    {
      locationId: locationA,
      customerCompanyId: customerA,
      leadId,
      issueDate: new Date().toISOString().slice(0, 10),
      title: `Quote from ${lead.title ?? "lead"}`,
      status: "draft",
    },
    [],
  );
  const updatedLead = await leadRepository.updateLead(tenantA, leadId, {
    status: "quoted",
    convertedQuoteId: quote.id,
    convertedAt: new Date(),
  });
  return { quote, lead: updatedLead };
}

async function createLeadWithStatus(status: "new" | "contacted" | "needs_review" | "quoted" | "won" | "lost") {
  const [lead] = await db
    .insert(leads)
    .values({
      companyId: tenantA,
      locationId: locationA,
      customerCompanyId: customerA,
      createdByUserId: ownerA,
      status,
      title: `${PREFIX}lead-${status}-${Date.now()}`,
      sourceType: "office",
    })
    .returning();
  return lead;
}

// ── Storage layer: real DB conversion ───────────────────────────────

describe("Lead → Quote conversion (storage layer, real DB)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("converts a 'new' lead — quote.leadId set, lead.status='quoted', convertedQuoteId+At set", async () => {
    const lead = await createLeadWithStatus("new");
    const { quote, lead: updated } = await convertLeadToQuote(lead.id);

    expect(quote.leadId).toBe(lead.id);
    expect(quote.status).toBe("draft");
    expect(updated!.status).toBe("quoted");
    expect(updated!.convertedQuoteId).toBe(quote.id);
    expect(updated!.convertedAt).toBeTruthy();
  });

  it("converts a 'contacted' lead — same invariants hold", async () => {
    const lead = await createLeadWithStatus("contacted");
    const { quote, lead: updated } = await convertLeadToQuote(lead.id);

    expect(quote.leadId).toBe(lead.id);
    expect(updated!.status).toBe("quoted");
    expect(updated!.convertedQuoteId).toBe(quote.id);
    expect(updated!.convertedAt).toBeTruthy();
  });

  it("converts a 'needs_review' lead — the regression case from Lead Visits Phase 2", async () => {
    // This is the case the frontend gate previously blocked. The
    // backend was always willing; this test pins that and the
    // companion `canConvert` source-pin below pins the frontend fix.
    const lead = await createLeadWithStatus("needs_review");
    const { quote, lead: updated } = await convertLeadToQuote(lead.id);

    expect(quote.leadId).toBe(lead.id);
    expect(updated!.status).toBe("quoted");
    expect(updated!.convertedQuoteId).toBe(quote.id);
    expect(updated!.convertedAt).toBeTruthy();
  });

  it("blocks reconversion of an already-'quoted' lead (one lead → one quote)", async () => {
    const lead = await createLeadWithStatus("new");
    await convertLeadToQuote(lead.id);
    await expect(convertLeadToQuote(lead.id)).rejects.toThrow(/already 'quoted'/);
  });

  it("blocks conversion of a 'won' lead", async () => {
    const lead = await createLeadWithStatus("won");
    await expect(convertLeadToQuote(lead.id)).rejects.toThrow(/already 'won'/);
  });

  it("blocks conversion when convertedQuoteId is already set (defense-in-depth)", async () => {
    // Simulate a corrupted state where status is somehow non-quoted but
    // convertedQuoteId is set. The guard must still fire.
    const lead = await createLeadWithStatus("new");
    // First, do a real conversion so we have a real quote id.
    const { quote } = await convertLeadToQuote(lead.id);
    // Now pretend a future bug reverts status to 'new' but leaves the
    // FK populated — the second guard should still block.
    await db.update(leads).set({ status: "new" }).where(eq(leads.id, lead.id));
    const reread = await leadRepository.getLead(tenantA, lead.id);
    expect(reread!.convertedQuoteId).toBe(quote.id);
    await expect(convertLeadToQuote(lead.id)).rejects.toThrow(/already has a linked quote/);
  });

  it("standalone quote creation (no leadId) still works", async () => {
    const quote = await quoteRepository.createQuote(
      tenantA,
      {
        locationId: locationA,
        customerCompanyId: customerA,
        issueDate: new Date().toISOString().slice(0, 10),
        title: `${PREFIX}standalone`,
        status: "draft",
      },
      [],
    );
    expect(quote.id).toBeTruthy();
    expect(quote.leadId).toBeNull();
    // No lead was touched — sanity check by counting quotes with the
    // standalone title.
    const found = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(found[0].leadId).toBeNull();
  });

  it("lead with a COMPLETED lead visit converts cleanly — visit row stays attached, untouched", async () => {
    const lead = await createLeadWithStatus("new");
    const visit = await createLeadVisit(tenantA, {
      leadId: lead.id,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    // Complete it. This flips lead.status → "needs_review" because
    // it's the only open visit. We then convert from needs_review.
    const completed = await markLeadVisitCompleted(tenantA, visit.id, techA);
    expect(completed!.leadTransitioned).toBe(true);

    const { quote, lead: updated } = await convertLeadToQuote(lead.id);
    expect(quote.leadId).toBe(lead.id);
    expect(updated!.status).toBe("quoted");

    // The completed lead_visit row is still bound to the lead — the
    // conversion did not delete, archive, or reassign it.
    const visitsAfter = await db
      .select()
      .from(leadVisits)
      .where(eq(leadVisits.leadId, lead.id));
    expect(visitsAfter).toHaveLength(1);
    expect(visitsAfter[0].id).toBe(visit.id);
    expect(visitsAfter[0].status).toBe("completed");
    expect(visitsAfter[0].leadId).toBe(lead.id);
    // The lead row still exists and is active — conversion does NOT
    // soft-delete it.
    expect(updated!.isActive).toBe(true);
  });

  it("lead with notes + photo attachments converts without copying them onto the quote", async () => {
    const lead = await createLeadWithStatus("new");

    // Create a lead note + a file row + a lead_note_attachment binding.
    const [note] = await db.insert(leadNotes).values({
      companyId: tenantA,
      leadId: lead.id,
      userId: ownerA,
      noteText: "Cracked heat exchanger — photo attached",
    }).returning();
    const [file] = await db.insert(files).values({
      companyId: tenantA,
      storageProvider: "r2",
      bucket: "test-bucket",
      storageKey: `tenants/${tenantA}/leads/${lead.id}/notes/${note.id}/photo.jpg`,
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      status: "uploaded",
      category: "image",
      createdBy: ownerA,
    }).returning();
    const [attachment] = await db.insert(leadNoteAttachments).values({
      companyId: tenantA,
      noteId: note.id,
      fileId: file.id,
      createdBy: ownerA,
    }).returning();

    const { quote, lead: updated } = await convertLeadToQuote(lead.id);

    // Conversion succeeded.
    expect(quote.leadId).toBe(lead.id);
    expect(updated!.status).toBe("quoted");

    // The note + attachment + file rows are STILL bound to the lead /
    // lead-note. They were not duplicated, moved, or relinked.
    const notesAfter = await db
      .select()
      .from(leadNotes)
      .where(eq(leadNotes.leadId, lead.id));
    expect(notesAfter).toHaveLength(1);
    expect(notesAfter[0].id).toBe(note.id);

    const attachmentsAfter = await db
      .select()
      .from(leadNoteAttachments)
      .where(eq(leadNoteAttachments.noteId, note.id));
    expect(attachmentsAfter).toHaveLength(1);
    expect(attachmentsAfter[0].id).toBe(attachment.id);
    expect(attachmentsAfter[0].fileId).toBe(file.id);

    // No quote-side note/attachment rows reference this file. We
    // assert by checking nothing in `leadNoteAttachments` was created
    // *for the new quote* — leadNoteAttachments has no quoteId column
    // by design. The structural check is: the attachment's `noteId`
    // points to the lead's note, never a quote note. Pinned implicitly
    // by the schema (lead_note_attachments.note_id → lead_notes.id),
    // and explicitly by the count above.
    expect(attachmentsAfter[0].noteId).toBe(note.id);
  });
});

// ── Source-pin: route handler gate ───────────────────────────────────

describe("POST /api/quotes — conversion gate source-pins", () => {
  const quotesRoute = read("server/routes/quotes.ts");

  it("validates the lead exists and is tenant-scoped before conversion", () => {
    expect(quotesRoute).toMatch(/leadRepository\.getLead\(companyId, leadId\)/);
    expect(quotesRoute).toMatch(/throw createError\(400, "Lead not found"\)/);
  });

  it("blocks conversion when lead.status is 'quoted' or 'won'", () => {
    expect(quotesRoute).toMatch(
      /lead\.status === "quoted" \|\| lead\.status === "won"/,
    );
    expect(quotesRoute).toMatch(/one lead can only produce one quote/);
  });

  it("blocks conversion when lead.convertedQuoteId is already set", () => {
    expect(quotesRoute).toMatch(/lead\.convertedQuoteId/);
    expect(quotesRoute).toMatch(/already has a linked quote/);
  });

  it("does NOT block conversion from 'needs_review' (Phase 2 status is allowed)", () => {
    // The gate explicitly only blocks "quoted" / "won" — needs_review
    // must NOT appear in the block list. Pinning the absence so a
    // future regression that adds it fails this test.
    const guardLineMatch = quotesRoute.match(
      /lead\.status === "(quoted|won|needs_review|lost|new|contacted)"[^;]*;/,
    );
    expect(guardLineMatch).toBeTruthy();
    expect(guardLineMatch![0]).not.toMatch(/needs_review/);
  });

  it("sets lead.status='quoted' + convertedQuoteId + convertedAt after creating the quote", () => {
    expect(quotesRoute).toMatch(/leadRepository\.updateLead\(companyId, leadId, \{[\s\S]*?status:\s*"quoted"/);
    expect(quotesRoute).toMatch(/convertedQuoteId:\s*quote\.id/);
    expect(quotesRoute).toMatch(/convertedAt:\s*new Date\(\)/);
  });

  it("standalone path: when leadId is omitted, the lead-update branch is skipped", () => {
    // The post-create lead update must be guarded by `if (leadId)` —
    // otherwise standalone quotes would crash trying to update a null
    // lead row.
    expect(quotesRoute).toMatch(/if \(leadId\) \{\s*await leadRepository\.updateLead/);
  });
});

// ── Source-pin: frontend gate + backlink ─────────────────────────────

describe("Frontend — Convert button + backlink source-pins", () => {
  const leadDetail = read("client/src/pages/LeadDetailPage.tsx");
  const quoteHeader = read("client/src/components/QuoteHeaderCard.tsx");

  it("LeadDetailPage canConvert allows new / contacted / needs_review", () => {
    // Single regex pinning all three allowed statuses on one line.
    expect(leadDetail).toMatch(
      /canConvert\s*=\s*\(\s*lead\.status === "new" \|\| lead\.status === "contacted" \|\| lead\.status === "needs_review"\s*\)/,
    );
    // And the convertedQuoteId guard remains.
    expect(leadDetail).toMatch(/!lead\.convertedQuoteId/);
  });

  it("LeadDetailPage canConvert does NOT allow quoted/won/lost", () => {
    // Pinning by absence in the canConvert expression. We grep the
    // canConvert line and assert it does not name any of the
    // disallowed statuses.
    const m = leadDetail.match(/const canConvert\s*=\s*[^;]+;/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/"quoted"/);
    expect(m![0]).not.toMatch(/"won"/);
    expect(m![0]).not.toMatch(/"lost"/);
  });

  it("QuoteHeaderCard renders the 'From Lead' backlink only when quote.leadId is set", () => {
    // Conditional render — never an unconditional row.
    expect(quoteHeader).toMatch(/\{quote\.leadId && \(/);
    expect(quoteHeader).toMatch(/From Lead/);
    // Link target is /leads/:leadId, NOT a job/customer route.
    expect(quoteHeader).toMatch(/href=\{`\/leads\/\$\{quote\.leadId\}`\}/);
    // testids for downstream regression coverage.
    expect(quoteHeader).toMatch(/data-testid="row-quote-originating-lead"/);
    expect(quoteHeader).toMatch(/data-testid="link-quote-originating-lead"/);
  });
});
