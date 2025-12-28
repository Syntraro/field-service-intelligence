import type { Express } from "express";
import { createServer, type Server } from "http";

import jobsRouter from "./jobs";
import invoicesRouter from "./invoices";
import teamRouter from "./team";
import calendarRouter from "./calendar";
import clientsRouter from "./clients";
import techniciansRouter from "./technicians";
import jobTemplatesRouter from "./jobTemplates";
import invitationsRouter from "./invitations";
import invitationsResendRouter from "./invitations_resend";
import usersAdminRouter from "./users_admin";
import partsRouter from "./parts";
import clientPartsRouter from "./clientParts";
import companySettingsRouter from "./companySettings";
import maintenanceRouter from "./maintenance";
import subscriptionsRouter from "./subscriptions";
import impersonationRouter from "./impersonation";
import authRouter from "./auth";

import { requireAuth } from "../auth/requireAuth";
import { ensureTenantContext, rateLimitPerTenant } from "../auth/tenantIsolation";
import { impersonationMiddleware, trackActivity } from "../impersonationMiddleware";
import { storage } from "../storage/index";
import tasksRoutes from "./tasks.routes";


/**
 * Register all API routes in a single place.
 * This is the authoritative route map for the backend.
 */
export function registerRoutes(app: Express): Server {
  // ========================================
  // CRITICAL: Auth routes MUST come FIRST
  // ========================================
  app.use("/api/auth", authRouter);

  // ========================================
  // GLOBAL MIDDLEWARE (after auth routes)
  // ========================================

  // 1) Auth guard (API only)
  app.use(requireAuth);

  // 2) Tenant context
  app.use(ensureTenantContext);

  // 3) Rate limiting (API only)
  app.use(rateLimitPerTenant({ scope: "api", windowMs: 60_000, max: 1200 }));

  // 4) Impersonation context & activity tracking (API only)
  app.use(impersonationMiddleware(storage as any));
  app.use(trackActivity);

  // ========================================
  // PROTECTED ROUTES (after middleware)
  // ========================================

  app.use("/api/jobs", jobsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/technicians", techniciansRouter);
  app.use("/api/job-templates", jobTemplatesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/invitations-resend", invitationsResendRouter);
  app.use("/api/users-admin", usersAdminRouter);
  app.use("/api/parts", partsRouter);
  app.use("/api/client-parts", clientPartsRouter);
  app.use("/api/company-settings", companySettingsRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/impersonation", impersonationRouter);
  app.use("/api/tasks", tasksRoutes);
  // Create and return HTTP server
  const httpServer = createServer(app);
  return httpServer;
}