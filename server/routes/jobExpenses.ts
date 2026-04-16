/**
 * Job Expenses routes — thin transport layer.
 * Delegates all domain logic to jobExpenseService.
 *
 * Mounted on /api/jobs in server/routes/index.ts.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { jobExpensesRepository } from "../storage/jobExpenses";
import * as jobExpenseService from "../services/jobExpenseService";
import { expenseCategoryEnum } from "@shared/schema";

const router = Router();

// ── Validation schemas ──

// 2026-04-14 Phase 1 cleanup: `receiptFileId` is no longer accepted on
// create/update. It is written by the canonical file upload pipeline
// (job_expense_receipt adapter) on finalize, and cleared by the canonical
// DELETE /api/files/:fileId flow. This keeps receipts on a single write path.
const createExpenseSchema = z.object({
  amount: z.string().or(z.number()),
  category: z.enum(expenseCategoryEnum),
  date: z.string(),
  notes: z.string().nullable().optional(),
  isBillable: z.boolean().optional(),
  reimbursableToUserId: z.string().nullable().optional(),
});

const updateExpenseSchema = z.object({
  amount: z.string().or(z.number()).optional(),
  category: z.enum(expenseCategoryEnum).optional(),
  date: z.string().optional(),
  notes: z.string().nullable().optional(),
  isBillable: z.boolean().optional(),
  reimbursableToUserId: z.string().nullable().optional(),
});

// ── GET /:jobId/expenses — List expenses for a job ──

router.get("/:jobId/expenses", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const expenses = await jobExpensesRepository.getExpensesByJob(companyId, req.params.jobId);
  res.json(expenses);
}));

// ── POST /:jobId/expenses — Create expense ──

router.post("/:jobId/expenses", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const validated = validateSchema(createExpenseSchema, req.body);

  const expense = await jobExpenseService.createExpense({
    companyId,
    jobId: req.params.jobId,
    amount: validated.amount,
    category: validated.category,
    date: validated.date,
    notes: validated.notes,
    createdByUserId: req.user!.id,
    isBillable: validated.isBillable,
    reimbursableToUserId: validated.reimbursableToUserId,
  });

  res.status(201).json(expense);
}));

// ── PATCH /:jobId/expenses/:id — Update expense ──

router.patch("/:jobId/expenses/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const validated = validateSchema(updateExpenseSchema, req.body);

  const expense = await jobExpenseService.updateExpense({
    companyId,
    expenseId: req.params.id,
    ...validated,
  });

  if (!expense) throw createError(404, "Expense not found");
  res.json(expense);
}));

// ── DELETE /:jobId/expenses/:id — Delete expense ──

router.delete("/:jobId/expenses/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  await jobExpenseService.deleteExpense(companyId, req.params.id);
  res.json({ success: true });
}));

export default router;
