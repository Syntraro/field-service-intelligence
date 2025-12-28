import { Router } from "express";
import {
  createTask,
  checkInTask,
  checkOutTask,
  closeTask,
  updateSupplierVisit,
} from "../services/tasks.service";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const task = await createTask(req.body);
    res.json(task);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/check-in", async (req, res) => {
  try {
    const task = await checkInTask(req.params.id);
    res.json(task);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/check-out", async (req, res) => {
  try {
    const task = await checkOutTask(req.params.id);
    res.json(task);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/close", async (req, res) => {
  try {
    const task = await closeTask(req.params.id, req.body.userId);
    res.json(task);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id/supplier-visit", async (req, res) => {
  try {
    const result = await updateSupplierVisit(req.params.id, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
