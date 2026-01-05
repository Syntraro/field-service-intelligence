import express from "express";
import { createTechnician } from "../services/technicians";
import { z } from "zod";

const router = express.Router();

// ========================================
// VALIDATION SCHEMAS
// ========================================

const createTechnicianSchema = z.object({
  name: z.string().min(1).max(200),
  userId: z.string().uuid().optional(),
});

router.post("/", async (req, res) => {
  const validation = createTechnicianSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ 
      error: "Validation failed", 
      details: validation.error.errors 
    });
  }

  const { name, userId } = validation.data;
  const companyId = req.companyId!;
  const tech = await createTechnician(companyId, name, userId);
  res.json(tech);
});

export default router;