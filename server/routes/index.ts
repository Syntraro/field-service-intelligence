import type { Express } from "express";
import { createServer, type Server } from "http";

import jobsRouter from "./jobs";
import invoicesRouter from "./invoices";
import teamRouter from "./team";
import calendarRouter from "./scheduling";
import clientsRouter from "./clients";
import techniciansRouter from "./technicians";
import jobTemplatesRouter from "./jobTemplates";
import invitationsRouter from "./invitations";
import invitationsResendRouter from "./invitations_resend";
import usersAdminRouter from "./users_admin";
import itemsRouter from "./items";
import clientPartsRouter from "./clientParts";
import companySettingsRouter from "./companySettings";
import businessHoursRouter from "./businessHours";
import maintenanceRouter from "./maintenance";
import subscriptionsRouter from "./subscriptions";
import impersonationRouter from "./impersonation";
import authRouter from "./auth";
import portalRouter from "./portal";

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
import locationNotesRouter from "./location-notes";
import companyNotesRouter from "./company-notes";
import customerCompanyNotesRouter from "./customer-company-notes";
import noteAttachmentsRouter from "./note-attachments";
import uploadsRouter from "./uploads";
import filesRouter from "./files";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import paymentsRouter from "./payments";
import qboRouter from "./qbo";
import quotesRouter from "./quotes";
import quoteTemplatesRouter from "./quoteTemplates";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import { timeRouter as timeTrackingRouter, jobTimeRouter, payrollRouter } from "./timeTracking";
import analyticsRouter from "./analytics";
import timeAlertsRouter from "./timeAlerts";
import timeBillingRulesRouter from "./timeBillingRules";
import rolesRouter, { permissionsRouter } from "./roles";
import recurringJobsRouter from "./recurringJobs";
import taxRouter from "./tax";
import searchRouter from "./search";
import pmPartsRouter from "./pm-parts";
import { tagCrudRouter, customerCompanyTagRouter, locationTagRouter } from "./tags";
import techFieldRouter from "./techField";
import adminTimesheetsRouter from "./adminTimesheets";
import visitsRouter from "./visits";
// Phase 1 Architecture: Event Log + Attention Queue
import activityRouter from "./activity";
import attentionRouter from "./attention";
// Phase 4A: Route optimization (ORS-based)
import routesRouter from "./routes";
// Phase 4B: Technician telemetry (GPS pings)
import telemetryRouter from "./telemetry";
// Real-time dispatch freshness (SSE stream)
import dispatchStreamRouter from "./dispatch-stream";
// Phase 5: Visit intelligence signals
import intelligenceRouter from "./intelligence";
// Equipment catalog item associations (reference-only)
import equipmentCatalogItemsRouter from "./equipmentCatalogItems.routes";
// Dispatch map aggregator
import mapRouter from "./map";

/**
 * Register all API routes in a single place.
 * This is the authoritative route map for the backend.
 */
export function registerRoutes(app: Express): Server {
  // ========================================
  // ROUTE REGISTRATION BANNER (dev diagnostics)
  // ========================================
  console.log("\n" + "=".repeat(60));
  console.log("[ROUTES] Using CANONICAL route map: server/routes/index.ts");
  console.log("[ROUTES] Mounting routers...");
  console.log("=".repeat(60) + "\n");

  // ========================================
  // DEBUG ENDPOINT (dev only) - BEFORE auth middleware
  // ========================================
  app.get("/api/_debug/routes", (req, res) => {
    const routes: Array<{ method: string; path: string }> = [];

    // Helper to extract routes from a layer
    const extractRoutes = (stack: any[], prefix = "") => {
      stack.forEach((layer: any) => {
        if (layer.route) {
          // Direct route
          const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
          methods.forEach(method => {
            routes.push({ method, path: prefix + layer.route.path });
          });
        } else if (layer.name === "router" && layer.handle?.stack) {
          // Nested router
          let routerPath = prefix;
          if (layer.regexp) {
            const match = layer.regexp.toString().match(/\^\\\/([^\\]+)/);
            if (match) routerPath = prefix + "/" + match[1];
          }
          extractRoutes(layer.handle.stack, routerPath);
        }
      });
    };

    if (app._router?.stack) {
      extractRoutes(app._router.stack);
    }

    // Filter to /api routes and sort
    const apiRoutes = routes
      .filter(r => r.path.startsWith("/api"))
      .sort((a, b) => a.path.localeCompare(b.path));

    res.json({
      total: apiRoutes.length,
      routeMapFile: "server/routes/index.ts",
      routes: apiRoutes,
    });
  });

  // ========================================
  // HEALTH CHECK (before auth)
  // ========================================
  app.use("/api/health", healthRouter);  //
  // ========================================
  // CRITICAL: Auth routes MUST come FIRST
  // ========================================
  app.use("/api/auth", authRouter);

  // ========================================
  // CUSTOMER PORTAL (before staff auth guard — portal has its own auth)
  // ========================================
  app.use("/api/portal", portalRouter);

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
  app.use("/api/jobs", jobTimeRouter); // Time tracking: status updates + time summaries
  app.use("/api/invoices", invoicesRouter);
  app.use("/api", paymentsRouter); // Payment routes: /api/invoices/:id/payments, /api/payments/:id
  app.use("/api/team", teamRouter);
  console.log("[ROUTES] ✓ Mounted /api/team (canonical team router)");
  app.use("/api/calendar", calendarRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/equipment", equipmentCatalogItemsRouter);
  app.use("/api/technicians", techniciansRouter);
  app.use("/api/job-templates", jobTemplatesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/invitations-resend", invitationsResendRouter);
  app.use("/api/users-admin", usersAdminRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/client-parts", clientPartsRouter);
  app.use("/api/company-settings", companySettingsRouter);
  app.use("/api/company/business-hours", businessHoursRouter);
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
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/time", timeTrackingRouter); // Time tracking: clock in/out + time entries
  app.use("/api/payroll", payrollRouter); // Payroll: weekly summaries + approval + CSV export
  app.use("/api/analytics", analyticsRouter); // Analytics: time utilization + leakage dashboard
  app.use("/api/time-alerts", timeAlertsRouter); // Time alerts: settings + snoozes + worker triggers
  app.use("/api/time-billing", timeBillingRulesRouter); // Time billing: rules for rounding, minimums, multipliers
  app.use("/api/roles", rolesRouter); // Roles: CRUD for roles and role-permissions
  console.log("[ROUTES] ✓ Mounted /api/roles (canonical roles router)");
  app.use("/api/permissions", permissionsRouter); // Permissions: list all permissions
  console.log("[ROUTES] ✓ Mounted /api/permissions (canonical permissions router)");
  app.use("/api/recurring-templates", recurringJobsRouter); // Recurring jobs: templates + generation
  app.use("/api/tax", taxRouter); // Tax: rates + groups CRUD
  app.use("/api/search", searchRouter); // Universal search: jobs, invoices, customers, locations, suppliers

  // PM parts: location-level part templates for preventive maintenance
  app.use("/api/locations", pmPartsRouter);

  // Client tags: CRUD + bulk assignments
  app.use("/api/tags", tagCrudRouter);

  // ✅ NEW ROUTES (company rollups + notes API)
  // Company/Client (parent) endpoints: /api/customer-companies/:id/overview, /locations, etc.
  app.use("/api/customer-companies", customerCompaniesRouter);
  // Customer-company-scoped notes: /api/customer-companies/:id/notes
  app.use("/api/customer-companies", customerCompanyNotesRouter);
  // Customer-company tag assignments: /api/customer-companies/:id/tags
  app.use("/api/customer-companies", customerCompanyTagRouter);

  // Location tag assignments: /api/locations/:locationId/tags
  app.use("/api/locations", locationTagRouter);

  // Notes endpoints — new canonical routes + legacy back-compat
  app.use("/api/locations", locationNotesRouter);
  app.use("/api/companies", companyNotesRouter);
  app.use("/api/notes", noteAttachmentsRouter);
  // ⚠️ Legacy: /api/clients/:clientId/notes — TODO: remove once frontend migrated
  app.use("/api", clientNotesRouter);

  // File uploads & secure streaming
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/files", filesRouter);

  // Canonical visit feed: GET /api/visits with RBAC + filters (Phase 3)
  app.use("/api/visits", visitsRouter);

  // Technician field app: mobile-first API for assigned visits + time
  app.use("/api/tech", techFieldRouter);

  // Phase 1 Architecture: Event Log + Attention Queue
  app.use("/api/activity", activityRouter);
  app.use("/api/attention", attentionRouter);

  // Phase 4A: Route optimization (ORS-based dispatch routing)
  app.use("/api/routes", routesRouter);

  // Phase 4B: Technician telemetry (GPS pings)
  app.use("/api/telemetry", telemetryRouter);

  // Real-time dispatch freshness (SSE stream)
  app.use("/api/dispatch", dispatchStreamRouter);

  // Phase 5: Visit intelligence signals
  app.use("/api/intelligence", intelligenceRouter);

  // Dispatch map aggregator
  app.use("/api/map", mapRouter);

  // Admin timesheets: day/week views, edit/delete time entries
  app.use("/api/admin/timesheets", adminTimesheetsRouter);

  // ========================================
  // ADMIN ROUTES (owner-only)
  // ========================================
  app.use("/api/admin", adminRouter);

  // Create and return HTTP server
  const httpServer = createServer(app);
  return httpServer;
}