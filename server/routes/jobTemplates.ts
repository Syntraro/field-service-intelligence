import { Router } from "express";
import { storage } from "../storage/index";
import { insertJobTemplateSchema, insertJobTemplateLineItemSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

/**
 * Tenant context helper.
 * Prefer req.companyId (set by tenantIsolation middleware) and fall back to req.user.companyId.
 */
function getCompanyId(req: any): string | null {
  return req.companyId || req.user?.companyId || null;
}

/**
 * Lightweight validators (non-breaking).
 * We keep your existing behavior, but validate obvious required fields.
 */
const idSchema = z.string().min(1);
const jobTypeSchema = z.string().min(1);

router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { jobType, activeOnly } = req.query;

    // Preserve original semantics:
    // activeOnly defaults true unless explicitly "false"
    const filter = {
      jobType: typeof jobType === "string" ? jobType : undefined,
      activeOnly: activeOnly === "false" ? false : true,
    };

    const templates = await storage.getJobTemplates(companyId, filter);
    return res.json(templates);
  } catch (error: any) {
    console.error("Error fetching job templates:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch job templates" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "Invalid template id" });
    }

    const template = await storage.getJobTemplate(companyId, idParsed.data);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    const lines = await storage.getJobTemplateLineItems(template.id);
    return res.json({ ...template, lines });
  } catch (error: any) {
    console.error("Error fetching job template:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch job template" });
  }
});

const createTemplateSchema = insertJobTemplateSchema.extend({
  lines: z.array(insertJobTemplateLineItemSchema.omit({ templateId: true })).optional().default([]),
});

router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.errors });
    }

    const { lines, ...templateData } = parsed.data;

    const template = await storage.createJobTemplate(companyId, templateData, lines);

    const createdLines = await storage.getJobTemplateLineItems(template.id);
    return res.status(201).json({ ...template, lines: createdLines });
  } catch (error: any) {
    console.error("Error creating job template:", error);
    return res.status(500).json({ error: error.message || "Failed to create job template" });
  }
});

const updateTemplateSchema = insertJobTemplateSchema.partial().extend({
  lines: z.array(insertJobTemplateLineItemSchema.omit({ templateId: true })).optional(),
});

router.patch("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "Invalid template id" });
    }

    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.errors });
    }

    const { lines, ...templateData } = parsed.data;

    const template = await storage.updateJobTemplate(companyId, idParsed.data, templateData, lines);

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    const updatedLines = await storage.getJobTemplateLineItems(template.id);
    return res.json({ ...template, lines: updatedLines });
  } catch (error: any) {
    console.error("Error updating job template:", error);
    return res.status(500).json({ error: error.message || "Failed to update job template" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "Invalid template id" });
    }

    const deleted = await storage.deleteJobTemplate(companyId, idParsed.data);
    if (!deleted) {
      return res.status(404).json({ error: "Template not found" });
    }

    // Preserve original behavior: 204 no content
    return res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting job template:", error);
    return res.status(500).json({ error: error.message || "Failed to delete job template" });
  }
});

router.post("/:id/set-default", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "Invalid template id" });
    }

    const { jobType } = req.body;
    const jobTypeParsed = jobTypeSchema.safeParse(jobType);
    if (!jobTypeParsed.success) {
      return res.status(400).json({ error: "jobType is required" });
    }

    const template = await storage.setJobTemplateAsDefault(companyId, idParsed.data, jobTypeParsed.data);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    return res.json(template);
  } catch (error: any) {
    console.error("Error setting default template:", error);
    return res.status(500).json({ error: error.message || "Failed to set default template" });
  }
});

const applyToJobSchema = z.object({
  jobId: z.string().min(1),
  templateId: z.string().min(1),
});

router.post("/apply-to-job", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const parsed = applyToJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "jobId and templateId are required", details: parsed.error.errors });
    }

    const { jobId, templateId } = parsed.data;

    const createdParts = await storage.applyJobTemplateToJob(companyId, jobId, templateId);
    return res.status(201).json(createdParts);
  } catch (error: any) {
    console.error("Error applying template to job:", error);
    return res.status(500).json({ error: error.message || "Failed to apply template to job" });
  }
});

router.get("/default/:jobType", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const jobTypeParsed = jobTypeSchema.safeParse(req.params.jobType);
    if (!jobTypeParsed.success) {
      return res.status(400).json({ error: "Invalid jobType" });
    }

    const template = await storage.getDefaultJobTemplateForJobType(companyId, jobTypeParsed.data);
    if (!template) {
      return res.status(404).json({ error: "No default template for this job type" });
    }

    const lines = await storage.getJobTemplateLineItems(template.id);
    return res.json({ ...template, lines });
  } catch (error: any) {
    console.error("Error fetching default template:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch default template" });
  }
});

router.post("/:id/clone", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "Invalid template id" });
    }

    const clonedTemplate = await storage.cloneJobTemplate(companyId, idParsed.data);
    if (!clonedTemplate) {
      return res.status(404).json({ error: "Template not found" });
    }

    const lines = await storage.getJobTemplateLineItems(clonedTemplate.id);
    return res.status(201).json({ ...clonedTemplate, lines });
  } catch (error: any) {
    console.error("Error cloning job template:", error);
    return res.status(500).json({ error: error.message || "Failed to clone job template" });
  }
});

export default router;
