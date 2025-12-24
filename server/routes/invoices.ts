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

export default router;