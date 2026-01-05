import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { z } from "zod";

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
      const invoice = await storage.getInvoice(req.companyId, req.params.id);

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
  const companyId = req.companyId;
  const rows = await storage.getInvoices(companyId);
  res.json(rows);
});

router.get("/stats", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const rows = await storage.getInvoiceStats(companyId);
  res.json(rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const invoice = await storage.getInvoice(companyId, req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.get("/:id/lines", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const lines = await storage.getInvoiceLines(companyId, req.params.id);
  res.json(lines);
});

router.post("/:id/lines", requireInvoiceEditable(), async (req: Request, res: Response) => {
  try {
    const validation = createInvoiceLineSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    const created = await storage.createInvoiceLine(req.companyId, req.params.id, validation.data);
    res.json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id/lines/:lineId", requireInvoiceEditable(), async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const result = await storage.deleteInvoiceLine(companyId, req.params.id, req.params.lineId);
  res.json(result);
});

router.post("/:id/refresh-from-job", requireInvoiceEditable(), async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const result = await storage.refreshInvoiceFromJob(companyId, req.params.id);
  res.json(result);
});

/**
 * POST /api/invoices/from-job/:jobId
 * Create a new invoice from an existing job
 */
router.post("/from-job/:jobId", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    const jobId = req.params.jobId;

    const validation = createInvoiceFromJobSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }
    
    // Get the job to verify it exists and belongs to company
    const job = await storage.getJob(companyId, jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Check if job already has an invoice
    if (job.invoiceId) {
      return res.status(400).json({ 
        error: "Job already has an invoice",
        invoiceId: job.invoiceId 
      });
    }

    // Get next invoice number
    const { companyCounters } = await import("@shared/schema");
    const [counter] = await storage.db
      .select()
      .from(companyCounters)
      .where(storage.eq(companyCounters.companyId, companyId))
      .limit(1);

    let invoiceNumber = 1001;
    if (counter) {
      invoiceNumber = counter.nextInvoiceNumber;
      await storage.db
        .update(companyCounters)
        .set({ nextInvoiceNumber: invoiceNumber + 1 })
        .where(storage.eq(companyCounters.companyId, companyId));
    }

    // Create invoice
    const { invoices } = await import("@shared/schema");
    const [invoice] = await storage.db
      .insert(invoices)
      .values({
        companyId,
        locationId: job.locationId,
        jobId: jobId,
        invoiceNumber,
        status: "draft",
        issueDate: new Date(),
        subtotal: 0,
        taxTotal: 0,
        total: 0,
        amountPaid: 0,
        balance: 0,
      })
      .returning();

    // Refresh invoice lines from job parts
    await storage.refreshInvoiceFromJob(companyId, invoice.id);

    // Update job with invoice reference
    const { jobs } = await import("@shared/schema");
    await storage.db
      .update(jobs)
      .set({ invoiceId: invoice.id })
      .where(storage.and(
        storage.eq(jobs.id, jobId),
        storage.eq(jobs.companyId, companyId)
      ));

    // Mark job as completed if requested
    if (validation.data.markJobCompleted) {
      await storage.updateJobStatus(companyId, jobId, "completed");
    }

    res.json(invoice);
  } catch (error: any) {
    console.error("Error creating invoice from job:", error);
    res.status(500).json({ error: error.message || "Failed to create invoice" });
  }
});

/**
 * PATCH /api/invoices/:id - Update invoice with optimistic locking
 */
router.patch("/:id", requireInvoiceEditable(), async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    
    // ✅ ADD VALIDATION:
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
      companyId,
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