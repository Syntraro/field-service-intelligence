/**
 * PM Billing Routes — API endpoints for PM contract billing oversight
 *
 * PM Billing Phase 2: Exposes billing events, manual triggers, and
 * oversight data for the PM Billing tab.
 *
 * Routes:
 *   GET  /api/pm/billing/events          — All billing events for company
 *   GET  /api/pm/billing/events/:contractId — Events for a specific contract
 *   POST /api/pm/billing/run             — Trigger billing run for company
 *   POST /api/pm/billing/events/:id/skip — Skip a pending billing event
 *   GET  /api/pm/billing/summary         — Billing oversight summary
 */

import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { asyncHandler } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import type { Response } from "express";
import {
  getBillingEventsForCompany,
  getBillingEventsForContract,
  runBillingForCompany,
  skipBillingEvent,
} from "../services/pmBillingService";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { pmBillingEvents, recurringJobTemplates } from "@shared/schema";

const router = Router();

/** GET /events — All billing events for company (PM Billing oversight tab) */
router.get("/events", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const events = await getBillingEventsForCompany(companyId);
  res.json(events);
}));

/** GET /events/:contractId — Billing events for a specific PM contract */
router.get("/events/:contractId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const { contractId } = req.params;
  const events = await getBillingEventsForContract(companyId, contractId);
  res.json(events);
}));

/** POST /run — Trigger billing run for company (manual trigger) */
router.post("/run", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const result = await runBillingForCompany(companyId);
  res.json({
    message: "PM billing run complete",
    eventsCreated: result.eventsCreated,
    invoicesCreated: result.invoicesCreated,
    errors: result.errors,
  });
}));

/** POST /events/:id/skip — Skip a pending billing event */
router.post("/events/:id/skip", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;
  const { id } = req.params;
  const { reason } = req.body ?? {};
  await skipBillingEvent(id, companyId, reason);
  res.json({ message: "Billing event skipped" });
}));

/** GET /summary — Billing oversight summary for the PM Billing tab */
router.get("/summary", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { companyId } = req.user!;

  // Count events by status
  const statusCounts = await db
    .select({
      status: pmBillingEvents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pmBillingEvents)
    .where(eq(pmBillingEvents.companyId, companyId))
    .groupBy(pmBillingEvents.status);

  // Count active contracts by billing model
  const contractCounts = await db
    .select({
      model: recurringJobTemplates.pmBillingModel,
      count: sql<number>`count(*)::int`,
    })
    .from(recurringJobTemplates)
    .where(and(
      eq(recurringJobTemplates.companyId, companyId),
      eq(recurringJobTemplates.isActive, true),
      sql`${recurringJobTemplates.pmBillingModel} IS NOT NULL`,
    ))
    .groupBy(recurringJobTemplates.pmBillingModel);

  // Current month events needing attention
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const pendingThisMonth = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pmBillingEvents)
    .where(and(
      eq(pmBillingEvents.companyId, companyId),
      eq(pmBillingEvents.status, "pending"),
      sql`${pmBillingEvents.periodStart} >= ${monthStart}`,
    ));

  res.json({
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
    contractCounts: Object.fromEntries(contractCounts.map((r) => [r.model, r.count])),
    pendingThisMonth: pendingThisMonth[0]?.count ?? 0,
  });
}));

export default router;
