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
import itemsRouter from "./items";
import clientPartsRouter from "./clientParts";
import companySettingsRouter from "./companySettings";
import maintenanceRouter from "./maintenance";
import subscriptionsRouter from "./subscriptions";
import impersonationRouter from "./impersonation";
import authRouter from "./auth";

// ✅ NEW (long-term client/company detail fix)
import customerCompaniesRouter from "./customer-companies";
import healthRouter from "./health";
import { requireAuth } from "../auth/requireAuth";
import { ensureTenantContext, rateLimitPerTenant } from "../auth/tenantIsolation";
import { impersonationMiddleware, trackActivity } from "../impersonationMiddleware";
import { storage } from "../storage/index";
import tasksRoutes from "./tasks.routes";
import suppliersRouter from "./suppliers";
import jobVisitsRoutes from "./jobVisits.routes";
import clientNotesRouter from "./client-notes";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import paymentsRouter from "./payments";
import qboRouter from "./qbo";
import quotesRouter from "./quotes";
import quoteTemplatesRouter from "./quoteTemplates";

/**
 * Register all API routes in a single place.
 * This is the authoritative route map for the backend.
 */
export function registerRoutes(app: Express): Server {
  // ========================================
  // HEALTH CHECK (before auth)
  // ========================================
  app.use("/api/health", healthRouter);  //
  // ========================================
  // CRITICAL: Auth routes MUST come FIRST
  // ========================================
  app.use("/api/auth", authRouter);

  // ========================================
  // GLOBAL MIDDLEWARE (after auth routes)
  // ========================================

  // 1) Auth guard (API only)
  app.use("/api", requireAuth);

  // 2) Tenant context
  app.use(ensureTenantContext);

  // 3) Rate limiting (API only)
  app.use(rateLimitPerTenant({ scope: "api", windowMs: 60_000, max: 1200 }));

  // 3b) ✅ Mutation-only rate limiting (tighter)
  const mutationLimiter = rateLimitPerTenant({
    scope: "mutations",
    windowMs: 60_000,
    max: 200,
  });
  app.use("/api", (req, res, next) => {
    const method = req.method?.toUpperCase();
    if (method && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return mutationLimiter(req, res, next);
    }
    return next();
  });
  
  // 4) Impersonation context & activity tracking (API only)
  app.use(impersonationMiddleware(storage as any));
  app.use(trackActivity);

  // ========================================
  // PROTECTED ROUTES (after middleware)
  // ========================================

  app.use("/api/jobs", jobsRouter);
  app.use("/api/jobs", jobVisitsRoutes);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api", paymentsRouter); // Payment routes: /api/invoices/:id/payments, /api/payments/:id
  app.use("/api/team", teamRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/technicians", techniciansRouter);
  app.use("/api/job-templates", jobTemplatesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/invitations-resend", invitationsResendRouter);
  app.use("/api/users-admin", usersAdminRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/client-parts", clientPartsRouter);
  app.use("/api/company-settings", companySettingsRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/impersonation", impersonationRouter);
  app.use("/api/tasks", tasksRoutes);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/qbo", qboRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/quote-templates", quoteTemplatesRouter);

  // ✅ NEW ROUTES (company rollups + notes API)
  // Company/Client (parent) endpoints: /api/customer-companies/:id/overview, /locations, etc.
  app.use("/api/customer-companies", customerCompaniesRouter);

  // Notes endpoints
  // ✅ Preferred canonical API: /api/clients/:id/notes
  // ⚠️ Legacy alias (/api/client-notes) may still exist for backward compatibility.
  // Mounted at /api so the router can expose multiple paths.
  app.use("/api", clientNotesRouter);

  // Create and return HTTP server
  const httpServer = createServer(app);
  return httpServer;
}