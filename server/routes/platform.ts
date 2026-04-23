/**
 * Platform Ops Portal routes — Phase 1 (Platform Admin Foundation).
 *
 * All routes mounted under /api/platform/* MUST go through
 * requirePlatformRole(). Tenant scoping is deliberately NOT applied here
 * (see ensureTenantContext skip for /api/platform).
 *
 * Phase 1 only ships a health probe so the RBAC wiring can be verified
 * end-to-end. Tenant registry, feedback/issue management, support
 * sessions, etc. land in later phases.
 */

import { Router } from "express";
import { requirePlatformRole } from "../auth/requirePlatformRole";
import platformTenantsRouter from "./platformTenants";
import platformFeedbackRouter from "./platformFeedback";
import platformIssuesRouter from "./platformIssues";
import supportSessionsRouter from "./supportSessions";
import platformEntitlementsRouter from "./platformEntitlements";
// 2026-04-22 Admin Phase A2: trial pipeline dashboard.
import platformTrialsRouter from "./platformTrials";
// 2026-04-22 Admin Phase A3: platform-wide KPI strip.
import platformKpisRouter from "./platformKpis";
// 2026-04-22 Admin Phase A6.3: bulk-run history + retry.
import platformBulkRunsRouter from "./platformBulkRuns";

const platformRouter = Router();

// All platform routes require a platform role by default.
platformRouter.use(requirePlatformRole());

// GET /api/platform/health — verification endpoint.
platformRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Phase 2 (Ops Portal Core): tenant search / detail / feature flags.
platformRouter.use("/tenants", platformTenantsRouter);

// Phase 3 (Ops Portal Feedback + Issue System).
platformRouter.use("/feedback", platformFeedbackRouter);
platformRouter.use("/issues", platformIssuesRouter);

// Phase 4 (Support Sessions).
platformRouter.use("/support-sessions", supportSessionsRouter);

// 2026-04-22 Admin Phase A2 — operator trial pipeline dashboard.
// Mounts GET /trials/pipeline.
platformRouter.use("/trials", platformTrialsRouter);

// 2026-04-22 Admin Phase A3 — platform-wide KPI strip. Mounts GET /kpis.
platformRouter.use("/kpis", platformKpisRouter);

// 2026-04-22 Admin Phase A6.3 — bulk-run history over audit_logs.
// Mounts GET /bulk-runs and GET /bulk-runs/:runId.
platformRouter.use("/bulk-runs", platformBulkRunsRouter);

// 2026-04-19 Entitlement system — plans, features, plan-feature matrix,
// tenant subscription assignment, tenant overrides, entitlements + usage.
// Mounts /plans/*, /features/*, /tenants/:id/{subscription,overrides,entitlements,usage}.
platformRouter.use("/", platformEntitlementsRouter);

export default platformRouter;
