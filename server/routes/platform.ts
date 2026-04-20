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

// 2026-04-19 Entitlement system — plans, features, plan-feature matrix,
// tenant subscription assignment, tenant overrides, entitlements + usage.
// Mounts /plans/*, /features/*, /tenants/:id/{subscription,overrides,entitlements,usage}.
platformRouter.use("/", platformEntitlementsRouter);

export default platformRouter;
