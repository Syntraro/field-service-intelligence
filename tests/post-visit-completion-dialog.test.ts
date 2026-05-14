/**
 * Post-visit completion dialog — source-pin + lifecycle tests (2026-05-13)
 *
 * Covers the revised 5-option workflow:
 *   1. Close job & invoice now
 *   2. Close job & invoice later
 *   3. Schedule follow-up
 *   4. Leave job unscheduled
 *   5. Archive without invoice
 *
 * Source-pin tests confirm the component renders the expected options and
 * that removed options ("Decide later", "Leave job open") are gone.
 *
 * Lifecycle tests confirm the archive-without-invoice path: job reaches
 * `archived` status, is inactive, and cannot be invoiced.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  invoices,
  jobStatusEvents,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as lifecycle from "../server/services/jobLifecycleOrchestrator";
import { jobRepository } from "../server/storage/jobs";
import { invoiceRepository } from "../server/storage/invoices";
import { v4 as uuidv4 } from "uuid";

const ROOT = resolve(__dirname, "..");
const DIALOG_SRC = resolve(ROOT, "client/src/components/PostVisitCompletionDialog.tsx");
const LAUNCHER_SRC = resolve(ROOT, "client/src/components/dispatch/VisitEditorLauncher.tsx");
const JOB_DETAIL_SRC = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");

const dialogCode = readFileSync(DIALOG_SRC, "utf-8");
const launcherCode = readFileSync(LAUNCHER_SRC, "utf-8");
const jobDetailCode = readFileSync(JOB_DETAIL_SRC, "utf-8");

// ── 1. Removed options ─────────────────────────────────────────────────────

describe("PostVisitCompletionDialog — removed options", () => {
  it('does not render "Decide later"', () => {
    expect(dialogCode).not.toMatch(/Decide later/);
  });

  it('does not render "Leave job open"', () => {
    expect(dialogCode).not.toMatch(/Leave job open/);
  });

  it('does not include option-leave-open testId', () => {
    expect(dialogCode).not.toMatch(/option-leave-open/);
  });
});

// ── 2. New and renamed options ─────────────────────────────────────────────

describe("PostVisitCompletionDialog — required options", () => {
  it('renders "Leave job unscheduled" with correct label', () => {
    expect(dialogCode).toMatch(/Leave job unscheduled/);
  });

  it('"Leave job unscheduled" has the correct helper text', () => {
    expect(dialogCode).toMatch(
      /Visit is completed\. Job remains open without a scheduled follow-up\./,
    );
  });

  it('has data-testid="option-leave-unscheduled"', () => {
    expect(dialogCode).toMatch(/option-leave-unscheduled/);
  });

  it('renders "Schedule follow-up" with correct label', () => {
    expect(dialogCode).toMatch(/Schedule follow-up/);
  });

  it('"Schedule follow-up" has the correct helper text', () => {
    expect(dialogCode).toMatch(
      /Keep the job open and schedule another visit\./,
    );
  });

  it('has data-testid="option-schedule-followup"', () => {
    expect(dialogCode).toMatch(/option-schedule-followup/);
  });

  it('renders "Archive without invoice" with correct label', () => {
    expect(dialogCode).toMatch(/Archive without invoice/);
  });

  it('"Archive without invoice" has the correct helper text', () => {
    expect(dialogCode).toMatch(/Archives the job without billing\./);
  });

  it('has data-testid="option-archive-no-invoice"', () => {
    expect(dialogCode).toMatch(/option-archive-no-invoice/);
  });
});

// ── 3. Invoice options preserved ───────────────────────────────────────────

describe("PostVisitCompletionDialog — invoice options preserved", () => {
  it('renders "Close job & invoice now" base label', () => {
    expect(dialogCode).toMatch(/Close job & invoice now/);
  });

  it('"Close job & invoice now" has the correct base helper text', () => {
    expect(dialogCode).toMatch(
      /Completes the job and creates an invoice immediately\./,
    );
  });

  it('has data-testid="option-invoice-now"', () => {
    expect(dialogCode).toMatch(/option-invoice-now/);
  });

  it('renders "Close job & invoice later" base label', () => {
    expect(dialogCode).toMatch(/Close job & invoice later/);
  });

  it('"Close job & invoice later" has the correct base helper text', () => {
    expect(dialogCode).toMatch(
      /Completes the job\. Invoice can be created later\./,
    );
  });

  it('has data-testid="option-invoice-later"', () => {
    expect(dialogCode).toMatch(/option-invoice-later/);
  });
});

// ── 4. Option order locked ─────────────────────────────────────────────────

describe("PostVisitCompletionDialog — option order", () => {
  it("invoice-now appears before invoice-later", () => {
    expect(dialogCode.indexOf("option-invoice-now")).toBeLessThan(
      dialogCode.indexOf("option-invoice-later"),
    );
  });

  it("invoice-later appears before schedule-followup", () => {
    expect(dialogCode.indexOf("option-invoice-later")).toBeLessThan(
      dialogCode.indexOf("option-schedule-followup"),
    );
  });

  it("schedule-followup appears before leave-unscheduled", () => {
    expect(dialogCode.indexOf("option-schedule-followup")).toBeLessThan(
      dialogCode.indexOf("option-leave-unscheduled"),
    );
  });

  it("leave-unscheduled appears before archive-no-invoice", () => {
    expect(dialogCode.indexOf("option-leave-unscheduled")).toBeLessThan(
      dialogCode.indexOf("option-archive-no-invoice"),
    );
  });
});

// ── 5. VisitEditorLauncher wires AddVisitDialog for follow-up ──────────────

describe("VisitEditorLauncher — Schedule follow-up support", () => {
  it("imports AddVisitDialog", () => {
    expect(launcherCode).toMatch(/import.*AddVisitDialog.*from/);
  });

  it("renders <AddVisitDialog when followUpJobId is set", () => {
    expect(launcherCode).toMatch(/<AddVisitDialog/);
  });

  it("passes onScheduleFollowUp to PostVisitCompletionDialog", () => {
    expect(launcherCode).toMatch(/onScheduleFollowUp/);
  });
});

// ── 6. Pre-confirmation modal removed from JobDetailPage ───────────────────

describe("JobDetailPage — pre-confirmation modal removed", () => {
  it('does not render the "Complete Job / Continue" AlertDialog', () => {
    expect(jobDetailCode).not.toMatch(/dialog-complete-job-confirm/);
  });

  it('does not contain "button-confirm-complete-job" testId', () => {
    expect(jobDetailCode).not.toMatch(/button-confirm-complete-job/);
  });

  it('does not contain showCompleteJobConfirm state', () => {
    expect(jobDetailCode).not.toMatch(/showCompleteJobConfirm/);
  });

  it('"Complete Job" overflow item calls openCloseJobDialog directly', () => {
    // Confirm the item calls openCloseJobDialog() directly, not via setShowCompleteJobConfirm
    expect(jobDetailCode).toMatch(
      /complete-job[\s\S]{0,200}openCloseJobDialog\(\)/,
    );
  });
});

// ── 7. Archive-without-invoice lifecycle test ──────────────────────────────

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
const createdVisitIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "pvcd_archive_test_company" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `pvcd_archive_${Date.now()}@test.com`,
    password: "hash",
    role: "dispatcher",
    firstName: "Test",
    lastName: "Tech",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: "pvcd_archive_customer",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: "pvcd_archive_location",
    address: "1 Archive Way",
    selectedMonths: [],
  });
}

async function createSingleVisitJob(): Promise<{
  jobId: string;
  visitId: string;
  jobVersion: number;
}> {
  const now = new Date();
  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    jobType: "PM",
    summary: "pvcd_archive_test_job",
    status: "open",
    assignedTechnicianIds: [userId],
    scheduledStart: new Date(now.getTime() - 3600000),
    scheduledEnd: new Date(now.getTime() - 1800000),
    isAllDay: false,
  });
  createdJobIds.push(job.id);

  const [autoVisit] = await db
    .select({ id: jobVisits.id })
    .from(jobVisits)
    .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

  if (!autoVisit) throw new Error("createJob did not auto-create visit");

  await db
    .update(jobVisits)
    .set({
      status: "in_progress",
      checkedInAt: new Date(now.getTime() - 2400000),
      assignedTechnicianIds: [userId],
    })
    .where(eq(jobVisits.id, autoVisit.id));

  createdVisitIds.push(autoVisit.id);
  return { jobId: job.id, visitId: autoVisit.id, jobVersion: job.version };
}

async function cleanupFixtures() {
  for (const id of createdVisitIds) {
    await db.delete(jobVisits).where(eq(jobVisits.id, id)).catch(() => {});
  }
  for (const id of createdJobIds) {
    await db.delete(jobStatusEvents).where(eq(jobStatusEvents.jobId, id)).catch(() => {});
    await db.delete(invoices).where(eq(invoices.jobId, id)).catch(() => {});
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

describe("Archive without invoice — lifecycle (2026-05-13)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("archive mode: visit completed then forceCloseJob(archive) → job is archived, inactive, and blocks invoice creation", async () => {
    const { jobId, visitId, jobVersion } = await createSingleVisitJob();

    // Step 1: complete the visit, leave job open (the canonical office flow).
    const completeResult = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
      autoCloseJobOnLastVisit: false,
    });

    expect(completeResult.reconciliation.jobUpdated).toBe(false);

    let job = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    expect(job?.status).toBe("open");

    // Step 2: archive via forceCloseJob (the "Archive without invoice" path).
    await lifecycle.forceCloseJob({
      type: "FORCE_CLOSE_JOB",
      companyId,
      jobId,
      version: job!.version,
      mode: "archive",
      actor: { userId, role: "dispatcher" },
      autoCompleteOpenVisits: false,
    });

    job = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)))
      .then((rows) => rows[0] ?? null);

    // Job must be archived and removed from active billing / unscheduled queues.
    expect(job?.status).toBe("archived");
    expect(job?.isActive).toBe(false);
    expect(job?.closedAt).not.toBeNull();

    // No invoice was created.
    const invoiceRows = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.jobId, jobId));
    expect(invoiceRows).toHaveLength(0);

    // Invoice creation on an archived (inactive) job must fail — the
    // activeJobFilter in createInvoiceFromJob blocks it.
    let createError: Error | null = null;
    try {
      await invoiceRepository.createInvoiceFromJob(
        companyId,
        jobId,
        { markJobCompleted: false, skipValidation: true },
        "INVOICE_ROUTE",
      );
    } catch (err) {
      createError = err as Error;
    }
    expect(createError).toBeInstanceOf(Error);
  });
});
