import { Router } from "express";
import type { Request, Response } from "express";
import { storage } from "../storage/index";

const router = Router();

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

router.post("/:id/lines", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const created = await storage.createInvoiceLine(companyId, req.params.id, req.body);
  res.json(created);
});

router.delete("/:id/lines/:lineId", async (req: Request, res: Response) => {
  const companyId = req.companyId;
  const result = await storage.deleteInvoiceLine(companyId, req.params.id, req.params.lineId);
  res.json(result);
});

router.post("/:id/refresh-from-job", async (req: Request, res: Response) => {
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
    if (req.body.markJobCompleted) {
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
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const companyId = req.companyId;
    const { version, ...patch } = req.body;

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