/**
 * Timesheet Report routes.
 *
 * Thin controllers — all policy and query logic lives in
 * server/services/timesheetReportService.ts. Mounted at /api/reports.
 *
 *   GET   /api/reports/timesheets                     — the report itself
 *   GET   /api/reports/timesheets/payroll-settings    — current settings
 *   PATCH /api/reports/timesheets/payroll-settings    — upsert settings
 *
 * Access: requireAuth is applied globally by the app. Manager-only gating
 * is deferred until we have product clarity on who may view payroll; for
 * now the tenant scope plus the auth guard are enforced.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { validateSchema } from "../utils/validationHelpers";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { payrollFrequencyEnum } from "@shared/schema";
import {
  TIMESHEET_PRESETS,
  getPayrollSettings,
  getTimesheetReport,
  upsertPayrollSettings,
} from "../services/timesheetReportService";

export const timesheetReportsRouter = Router();

const reportQuerySchema = z.object({
  preset: z.enum(TIMESHEET_PRESETS).default("this_week"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  technicianId: z.string().uuid().optional(),
});

timesheetReportsRouter.get(
  "/timesheets",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const parsed = validateSchema(reportQuerySchema, req.query);
    const result = await getTimesheetReport({
      companyId: req.companyId!,
      preset: parsed.preset ?? "this_week",
      customStart: parsed.start,
      customEnd: parsed.end,
      technicianId: parsed.technicianId,
    });
    res.json(result);
  }),
);

timesheetReportsRouter.get(
  "/timesheets/payroll-settings",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await getPayrollSettings(req.companyId!);
    res.json(
      row ?? {
        companyId: req.companyId,
        payFrequency: null,
        payAnchorDate: null,
      },
    );
  }),
);

const patchSettingsSchema = z.object({
  payFrequency: z.enum(payrollFrequencyEnum),
  payAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

timesheetReportsRouter.patch(
  "/timesheets/payroll-settings",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = validateSchema(patchSettingsSchema, req.body);
    const row = await upsertPayrollSettings(req.companyId!, body);
    res.json(row);
  }),
);
