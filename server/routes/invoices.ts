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