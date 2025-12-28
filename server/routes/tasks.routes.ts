import { Router } from "express";
import * as service from "../services/tasks.service.ts";

const router = Router();

/* CREATE */
router.post("/", async (req, res) => {
  try {
    res.json(await service.createTask(req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* LIST (FILTERED) */
router.get("/", async (req, res) => {
  try {
    res.json(
      await service.listTasks({
        companyId: req.query.companyId,
        status: req.query.status,
        assignedToUserId: req.query.assignedToUserId,
        unassigned: req.query.unassigned === "true",
        type: req.query.type,
        jobId: req.query.jobId,
        fromDate: req.query.fromDate ? new Date(req.query.fromDate as string) : undefined,
        toDate: req.query.toDate ? new Date(req.query.toDate as string) : undefined,
      })
    );
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ASSIGN / UNASSIGN */
router.post("/:id/assign", async (req, res) => {
  try {
    res.json(await service.assignTask(req.params.id, req.body.assignedToUserId ?? null));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-IN */
router.post("/:id/check-in", async (req, res) => {
  try {
    res.json(await service.checkInTask(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CHECK-OUT */
router.post("/:id/check-out", async (req, res) => {
  try {
    res.json(await service.checkOutTask(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* CLOSE */
router.post("/:id/close", async (req, res) => {
  try {
    res.json(await service.closeTask(req.params.id, req.body.userId));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ADMIN UPDATE */
router.patch("/:id", async (req, res) => {
  try {
    res.json(await service.updateTask(req.params.id, req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* SUPPLIER VISIT UPDATE (OFFICE) */
router.patch("/:id/supplier-visit", async (req, res) => {
  try {
    res.json(await service.updateSupplierVisit(req.params.id, req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
