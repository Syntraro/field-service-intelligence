/**
 * Job Expenses repository — handles all job expense database operations.
 * Ensures tenant isolation via companyId scoping.
 *
 * NO business logic. Persistence only.
 */
import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";
import { jobExpenses, jobs, users } from "@shared/schema";
import { BaseRepository } from "./base";
import { activeJobFilter } from "./jobFilters";

export class JobExpensesRepository extends BaseRepository {
  /**
   * List expenses for a job, ordered by date descending.
   */
  async getExpensesByJob(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId), activeJobFilter()));

    if (!job) throw this.notFoundError("Job");

    return db
      .select({
        id: jobExpenses.id,
        jobId: jobExpenses.jobId,
        amount: jobExpenses.amount,
        category: jobExpenses.category,
        date: jobExpenses.date,
        notes: jobExpenses.notes,
        createdByUserId: jobExpenses.createdByUserId,
        receiptFileId: jobExpenses.receiptFileId,
        isBillable: jobExpenses.isBillable,
        billingStatus: jobExpenses.billingStatus,
        reimbursableToUserId: jobExpenses.reimbursableToUserId,
        createdAt: jobExpenses.createdAt,
        updatedAt: jobExpenses.updatedAt,
        createdByName: users.fullName,
      })
      .from(jobExpenses)
      .leftJoin(users, eq(jobExpenses.createdByUserId, users.id))
      .where(and(eq(jobExpenses.companyId, companyId), eq(jobExpenses.jobId, jobId)))
      .orderBy(desc(jobExpenses.date));
  }

  /**
   * Get a single expense by ID (tenant-scoped).
   */
  async getExpenseById(companyId: string, expenseId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(expenseId, "expenseId");

    const [expense] = await db
      .select()
      .from(jobExpenses)
      .where(this.whereIdAndCompany(jobExpenses, expenseId, companyId));

    return expense ?? null;
  }

  /**
   * Create a new expense.
   */
  async createExpense(companyId: string, data: {
    jobId: string;
    amount: string;
    category: string;
    date: Date;
    notes?: string | null;
    createdByUserId: string;
    isBillable?: boolean;
    reimbursableToUserId?: string | null;
  }) {
    // receiptFileId is intentionally NOT accepted here — the canonical
    // file upload pipeline owns writing that column via the
    // `job_expense_receipt` EntityAdapter. Expenses are always created
    // without a receipt; the receipt is attached post-create.
    this.assertCompanyId(companyId);
    this.validateUUID(data.jobId, "jobId");
    this.validateUUID(data.createdByUserId, "createdByUserId");

    const [expense] = await db
      .insert(jobExpenses)
      .values({
        companyId,
        jobId: data.jobId,
        amount: data.amount,
        category: data.category,
        date: data.date,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId,
        isBillable: data.isBillable ?? false,
        reimbursableToUserId: data.reimbursableToUserId ?? null,
      })
      .returning();

    return expense;
  }

  /**
   * Update an existing expense.
   */
  async updateExpense(companyId: string, expenseId: string, data: {
    amount?: string;
    category?: string;
    date?: Date;
    notes?: string | null;
    isBillable?: boolean;
    billingStatus?: string;
    reimbursableToUserId?: string | null;
  }) {
    // receiptFileId intentionally absent — see createExpense note. The
    // canonical file pipeline writes/clears that column exclusively.
    this.assertCompanyId(companyId);
    this.validateUUID(expenseId, "expenseId");

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (data.amount !== undefined) setValues.amount = data.amount;
    if (data.category !== undefined) setValues.category = data.category;
    if (data.date !== undefined) setValues.date = data.date;
    if (data.notes !== undefined) setValues.notes = data.notes;
    if (data.isBillable !== undefined) setValues.isBillable = data.isBillable;
    if (data.billingStatus !== undefined) setValues.billingStatus = data.billingStatus;
    if (data.reimbursableToUserId !== undefined) setValues.reimbursableToUserId = data.reimbursableToUserId;

    const [updated] = await db
      .update(jobExpenses)
      .set(setValues)
      .where(this.whereIdAndCompany(jobExpenses, expenseId, companyId))
      .returning();

    return updated ?? null;
  }

  /**
   * Delete an expense (hard delete).
   */
  async deleteExpense(companyId: string, expenseId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(expenseId, "expenseId");

    const [deleted] = await db
      .delete(jobExpenses)
      .where(this.whereIdAndCompany(jobExpenses, expenseId, companyId))
      .returning();

    return deleted ?? null;
  }

  /**
   * Get all billable expenses for a job that haven't been added to an invoice yet.
   * Invoice eligibility: isBillable = true AND billingStatus = "pending".
   * Used by invoice creation pipeline.
   */
  async getBillableExpensesForJob(companyId: string, jobId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(jobId, "jobId");

    return db
      .select()
      .from(jobExpenses)
      .where(and(
        eq(jobExpenses.companyId, companyId),
        eq(jobExpenses.jobId, jobId),
        eq(jobExpenses.isBillable, true),
        eq(jobExpenses.billingStatus, "pending"),
      ))
      .orderBy(desc(jobExpenses.date));
  }

  /**
   * Mark expenses as added to an invoice (batch update).
   */
  async markExpensesAsInvoiced(companyId: string, expenseIds: string[]) {
    this.assertCompanyId(companyId);
    if (expenseIds.length === 0) return;

    for (const id of expenseIds) {
      await db
        .update(jobExpenses)
        .set({ billingStatus: "added_to_invoice", updatedAt: new Date() })
        .where(this.whereIdAndCompany(jobExpenses, id, companyId));
    }
  }
}

export const jobExpensesRepository = new JobExpensesRepository();
