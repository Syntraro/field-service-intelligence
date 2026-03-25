/**
 * Job Expense Service — canonical orchestrator for expense operations.
 *
 * Write Path Law: Route → Service → Storage
 * All domain logic lives here. Storage is persistence only.
 *
 * Expense lifecycle: Create → Edit → Mark billable → Invoice → (or Delete)
 * No approval workflow. Dispatcher/admin reviews directly via edit/delete/billable toggle.
 */
import { jobExpensesRepository } from "../storage/jobExpenses";
import { storage } from "../storage/index";
import type { ExpenseCategory } from "@shared/schema";

// ============================================================================
// Create
// ============================================================================

export async function createExpense(params: {
  companyId: string;
  jobId: string;
  amount: string | number;
  category: ExpenseCategory;
  date: string | Date;
  notes?: string | null;
  createdByUserId: string;
  receiptFileId?: string | null;
  isBillable?: boolean;
  reimbursableToUserId?: string | null;
}) {
  const job = await storage.getJob(params.companyId, params.jobId);
  if (!job) {
    const err = new Error("Job not found");
    (err as any).statusCode = 404;
    throw err;
  }

  return jobExpensesRepository.createExpense(params.companyId, {
    jobId: params.jobId,
    amount: String(params.amount),
    category: params.category,
    date: typeof params.date === "string" ? new Date(params.date) : params.date,
    notes: params.notes,
    createdByUserId: params.createdByUserId,
    receiptFileId: params.receiptFileId,
    isBillable: params.isBillable,
    reimbursableToUserId: params.reimbursableToUserId,
  });
}

// ============================================================================
// Update
// ============================================================================

export async function updateExpense(params: {
  companyId: string;
  expenseId: string;
  amount?: string | number;
  category?: ExpenseCategory;
  date?: string | Date;
  notes?: string | null;
  receiptFileId?: string | null;
  isBillable?: boolean;
  reimbursableToUserId?: string | null;
}) {
  const existing = await jobExpensesRepository.getExpenseById(params.companyId, params.expenseId);
  if (!existing) {
    const err = new Error("Expense not found");
    (err as any).statusCode = 404;
    throw err;
  }

  // Block edits on invoiced expenses — prevents invoice inconsistency
  if (existing.billingStatus === "added_to_invoice") {
    const err = new Error("Cannot edit an expense that has been added to an invoice");
    (err as any).statusCode = 400;
    throw err;
  }

  return jobExpensesRepository.updateExpense(params.companyId, params.expenseId, {
    amount: params.amount !== undefined ? String(params.amount) : undefined,
    category: params.category,
    date: params.date !== undefined
      ? (typeof params.date === "string" ? new Date(params.date) : params.date)
      : undefined,
    notes: params.notes,
    receiptFileId: params.receiptFileId,
    isBillable: params.isBillable,
    reimbursableToUserId: params.reimbursableToUserId,
  });
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteExpense(companyId: string, expenseId: string) {
  const existing = await jobExpensesRepository.getExpenseById(companyId, expenseId);
  if (!existing) {
    const err = new Error("Expense not found");
    (err as any).statusCode = 404;
    throw err;
  }

  // Block delete on invoiced expenses — prevents invoice inconsistency
  if (existing.billingStatus === "added_to_invoice") {
    const err = new Error("Cannot delete an expense that has been added to an invoice");
    (err as any).statusCode = 400;
    throw err;
  }

  return jobExpensesRepository.deleteExpense(companyId, expenseId);
}

// ============================================================================
// Billing integration
// ============================================================================

/**
 * Get billable expenses for a job ready for invoice conversion.
 * Invoice eligibility: isBillable = true AND billingStatus = "pending".
 */
export async function getBillableExpensesForInvoice(companyId: string, jobId: string) {
  return jobExpensesRepository.getBillableExpensesForJob(companyId, jobId);
}

/**
 * Mark expenses as invoiced after they've been added to an invoice.
 */
export async function markExpensesAsInvoiced(companyId: string, expenseIds: string[]) {
  return jobExpensesRepository.markExpensesAsInvoiced(companyId, expenseIds);
}
