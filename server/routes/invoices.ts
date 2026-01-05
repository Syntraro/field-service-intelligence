import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { parsePagination } from "../utils/pagination";
import { paginated } from "../utils/paginatedResponse";

const router = Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createInvoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("1"),
  unitPrice: z.number().min(0).max(999999.99),
  lineSubtotal: z.number().min(0).max(999999.99),
  taxRate: z.number().min(0).max(1).optional().default(0),
  taxAmount: z.number().min(0).max(999999.99).optional().default(0),
  lineTotal: z.number().min(0).max(999999.99),
  lineNumber: z.number().int().positive().optional(),
  source: z.enum(["manual", "job"]).optional().default("manual"),
});

const createInvoiceFromJobSchema = z.object({
  markJobCompleted: z.boolean().optional().default(false),
});

const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "void", "overdue"]).optional(),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  notesInternal: z.string().max(2000).optional(),
  notesCustomer: z.string().max(2000).optional(),
  workDescription: z.string().max(2000).optional(),
  clientMessage: z.string().max(2000).optional(),
  showQuantity: z.boolean().optional(),
  showUnitPrice: z.boolean().optional(),
  showLineTotals: z.boolean().optional(),
  showLineItems: z.boolean().optional(),
  showBalance: z.boolean().optional(),
  amountPaid: z.number().min(0).max(999999.99).optional(),
  version: z.number().int().nonnegative().optional(),
}).strict();

function requireInvoiceEditable() {
  return async (req: Request, res: Response, next: any) => {
    try {
      const invoice = await storage.getInvoice(req.companyId!, req.params.id);

      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      if ((invoice as any).status === "Sent") {
        return res.status(409).json({ error: "Invoice is locked after being sent" });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

router.get("/list", async (req: Request, res: Response) => {
  try {
    // TODO: Temporary backward compatibility - default to offset=0 if no pagination provided
    // Remove once UI is updated to include pagination params
    const queryWithDefaults = {
      ...req.query,
      ...(req.query.cursor === undefined && req.query.offset === undefined ? { offset: "0" } : {})
    };
    
    const pagination = parsePagination(queryWithDefaults);
    const result = await storage.getInvoices(req.companyId!, pagination);
    res.json(paginated(result.items, result.meta));
  } catch (error: any) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Get invoices error:", error);
    res.status(500).json({ error: error.message || "Failed to get invoices" });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  const rows = await storage.getInvoiceStats(req.companyId!);
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const invoice = await storage.getInvoice(req.companyId!, req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.get("/:id/lines", async (req: Request, res: Response) => {
  const lines = await storage.getInvoiceLines(req.companyId!, req.params.id);
  res.json(lines);
});

router.post("/:id/lines", requireRole(MANAGER_ROLES), requireInvoiceEditable(), async (req: Request, res: Response) => {
  try {
    const validation = createInvoiceLineSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    const created = await storage.createInvoiceLine(req.companyId!, req.params.id, validation.data);
    res.json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id/lines/:lineId", requireRole(MANAGER_ROLES), requireInvoiceEditable(), async (req: Request, res: Response) => {
  const result = await storage.deleteInvoiceLine(req.companyId!, req.params.id, req.params.lineId);
  res.json(result);
});

router.post("/:id/refresh-from-job", requireRole(MANAGER_ROLES), requireInvoiceEditable(), async (req: Request, res: Response) => {
  const result = await storage.refreshInvoiceFromJob(req.companyId!, req.params.id);
  res.json(result);
});

/**
 * POST /api/invoices/from-job/:jobId
 * Create a new invoice from an existing job
 */
router.post("/from-job/:jobId", requireRole(MANAGER_ROLES), async (req: Request, res: Response) => {
  try {
    const validation = createInvoiceFromJobSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const invoice = await storage.createInvoiceFromJob(
      req.companyId!,
      req.params.jobId,
      { markJobCompleted: validation.data.markJobCompleted }
    );

    // Refresh invoice lines from job parts
    await storage.refreshInvoiceFromJob(req.companyId!, invoice.id);

    res.json(invoice);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message?.includes("already has an invoice")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error creating invoice from job:", error);
    res.status(500).json({ error: error.message || "Failed to create invoice" });
  }
});

/**
 * PATCH /api/invoices/:id - Update invoice with optimistic locking
 */
router.patch("/:id", requireRole(MANAGER_ROLES), requireInvoiceEditable(), async (req: Request, res: Response) => {
  try {
    const validation = updateInvoiceSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    const { version, ...patch } = validation.data;

    // Version is optional for backward compatibility
    const updated = await storage.updateInvoice(
      req.companyId!,
      req.params.id,
      version, // Can be undefined
      patch
    );

    if (!updated) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json(updated);
  } catch (error: any) {
    // Check for version mismatch error
    if (error.message?.includes('modified by another user')) {
      return res.status(409).json({ 
        error: error.message,
        code: 'VERSION_MISMATCH'
      });
    }
    
    console.error("Update invoice error:", error);
    res.status(500).json({ error: error.message || "Failed to update invoice" });
  }
});

export default router;