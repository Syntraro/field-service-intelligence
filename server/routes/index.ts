import type { Express } from "express";
import { createServer, type Server } from "http";

import jobsRouter from "./jobs";
import invoicesRouter from "./invoices";
import teamRouter from "./team";
import meRouter from "./me";
import calendarRouter from "./scheduling";
import clientsRouter from "./clients";
import techniciansRouter from "./technicians";
import jobTemplatesRouter from "./jobTemplates";
import invitationsRouter from "./invitations";
import onboardingRouter from "./onboarding";
import usersAdminRouter from "./users_admin";
import itemsRouter from "./items";
import companySettingsRouter from "./companySettings";
import communicationTemplatesRouter from "./communicationTemplates";
// Phase 15 (2026-04-12): cross-entity delivery-history endpoint.
import communicationsRouter from "./communications";
import businessHoursRouter from "./businessHours";
import equipmentTypesRouter from "./equipmentTypes";
import maintenanceRouter from "./maintenance";
import subscriptionsRouter from "./subscriptions";
import authRouter from "./auth";
import portalRouter from "./portal";

// ✅ NEW (long-term client/company detail fix)
import customerCompaniesRouter from "./customer-companies";
import healthRouter from "./health";
import { requireAuth } from "../auth/requireAuth";
import { ensureTenantContext, rateLimitPerTenant } from "../auth/tenantIsolation";
import { impersonationMiddleware, trackActivity } from "../impersonationMiddleware";
import { enforceReadOnlySupport } from "../middleware/enforceReadOnlySupport";
import { storage } from "../storage/index";
import tasksRoutes from "./tasks.routes";
import suppliersRouter from "./suppliers";
import jobVisitsRoutes from "./jobVisits.routes";
import jobExpensesRouter from "./jobExpenses";
import locationNotesRouter from "./location-notes";
import customerCompanyNotesRouter from "./customer-company-notes";
import noteAttachmentsRouter from "./note-attachments";
import filesRouter from "./files";
import { fileUploadsRouter, jobNoteFilesRouter } from "./fileUploads";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import { timesheetReportsRouter } from "./timesheetReports";
import paymentsRouter from "./payments";
import stripePaymentsRouter from "./stripePayments";
import qboRouter from "./qbo";
import quotesRouter from "./quotes";
import quoteTemplatesRouter from "./quoteTemplates";
import leadsRouter from "./leads";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import { timeRouter as timeTrackingRouter, jobTimeRouter, payrollRouter } from "./timeTracking";
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
import referenceFieldsRouter from "./referenceFields";
import visitsRouter from "./visits";
// Phase 1 Architecture: Event Log + Attention Queue
import activityRouter from "./activity";
import attentionRouter from "./attention";
// Real-time dispatch freshness (SSE stream)
import dispatchStreamRouter from "./dispatch-stream";
// Phase 5: Visit intelligence signals
import intelligenceRouter from "./intelligence";
// Equipment: catalog items, timeline, notes history, parts history
import equipmentRouter from "./equipment.routes";
// 2026-04-21 — Canonical unified import pipeline (client / job / product).
// Replaces the retired per-entity routes/services/types (see CHANGELOG).
import importsRouter from "./imports";
// Feedback tracking (internal, no email)
import feedbackRouter from "./feedback";
// PM Templates: reusable job content templates for maintenance plans
import pmTemplatesRouter from "./pmTemplates";
import pmBillingRouter from "./pmBilling";
// Phase 1 (Platform Admin Foundation): Ops Portal API surface.
import platformRouter from "./platform";
// Phase 6 (Customer Approval): tenant-side approval endpoints.
import supportAccessRouter from "./supportAccess";

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

  // 5) Phase 4: Read-only support session enforcement.
  //    Runs AFTER impersonation middleware so req.isReadOnlySupport is set;
  //    blocks all mutating HTTP methods on /api except /api/platform/*.
  app.use(enforceReadOnlySupport);

  // ========================================
  // PROTECTED ROUTES (after middleware)
  // ========================================

  app.use("/api/jobs", jobsRouter);
  app.use("/api/jobs", jobVisitsRoutes);
  app.use("/api/jobs", jobTimeRouter); // Time tracking: status updates + time summaries
  app.use("/api/jobs", jobExpensesRouter); // Job expenses: CRUD + approval
  app.use("/api/invoices", invoicesRouter);
  app.use("/api", paymentsRouter); // Payment routes: /api/invoices/:id/payments, /api/payments/:id
  // 2026-04-14 Stripe Phase 1: in-app Stripe PaymentIntent creation.
  // Staff-only. Webhook lives in server/routes/stripeWebhook.ts mounted
  // BEFORE express.json() at the app level.
  app.use("/api", stripePaymentsRouter);
  app.use("/api/team", teamRouter);
  // 2026-04-21 Phase 1: canonical per-user entitlement + permission reads.
  app.use("/api/me", meRouter);
  console.log("[ROUTES] ✓ Mounted /api/team (canonical team router)");
  app.use("/api/calendar", calendarRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/equipment", equipmentRouter);
  app.use("/api/technicians", techniciansRouter);
  app.use("/api/job-templates", jobTemplatesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/users-admin", usersAdminRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/company-settings", companySettingsRouter);
  app.use("/api/communication-templates", communicationTemplatesRouter);
  app.use("/api/communications", communicationsRouter);
  app.use("/api/company/business-hours", businessHoursRouter);
  app.use("/api/equipment-types", equipmentTypesRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/tasks", tasksRoutes);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);
  // Timesheet Report (2026-04-12): mounts /api/reports/timesheets + payroll-settings.
  app.use("/api/reports", timesheetReportsRouter);
  app.use("/api/qbo", qboRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/quote-templates", quoteTemplatesRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/time", timeTrackingRouter); // Time tracking: clock in/out + time entries
  app.use("/api/payroll", payrollRouter); // Payroll: weekly summaries + approval + CSV export
  app.use("/api/time-alerts", timeAlertsRouter); // Time alerts: settings + snoozes + worker triggers
  app.use("/api/time-billing", timeBillingRulesRouter); // Time billing: rules for rounding, minimums, multipliers
  app.use("/api/roles", rolesRouter); // Roles: CRUD for roles and role-permissions
  console.log("[ROUTES] ✓ Mounted /api/roles (canonical roles router)");
  app.use("/api/permissions", permissionsRouter); // Permissions: list all permissions
  console.log("[ROUTES] ✓ Mounted /api/permissions (canonical permissions router)");
  app.use("/api/recurring-templates", recurringJobsRouter); // Recurring jobs: templates + generation
  app.use("/api/pm/templates", pmTemplatesRouter); // PM Templates: reusable job content for maintenance plans
  app.use("/api/pm/billing", pmBillingRouter); // PM Billing Phase 2: contract billing events + oversight
  app.use("/api/tax", taxRouter); // Tax: rates + groups CRUD
  app.use("/api/search", searchRouter); // Universal search: jobs, invoices, customers, locations, suppliers
  app.use("/api/reference-fields", referenceFieldsRouter); // Reference fields: definitions + per-entity values

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

  // Notes endpoints
  app.use("/api/locations", locationNotesRouter);
  app.use("/api/notes", noteAttachmentsRouter);
  // Canonical R2-backed file pipeline (upload-request / finalize /
  // access-url / delete). Mounted BEFORE the disk streamer so
  // /api/files/:fileId/access-url resolves to the canonical handler.
  app.use("/api", fileUploadsRouter);
  app.use("/api", jobNoteFilesRouter);
  // GET /api/files/:fileId — read path for legacy `storageProvider='local'`
  // rows written before R2 cutover. Canonical `getFileAccessUrl` routes new
  // rows through R2 and returns this URL only for legacy rows.
  app.use("/api/files", filesRouter);

  // Canonical visit feed: GET /api/visits with RBAC + filters (Phase 3)
  app.use("/api/visits", visitsRouter);

  // Technician field app: mobile-first API for assigned visits + time
  app.use("/api/tech", techFieldRouter);

  // Phase 1 Architecture: Event Log + Attention Queue
  app.use("/api/activity", activityRouter);
  app.use("/api/attention", attentionRouter);

  // Real-time dispatch freshness (SSE stream)
  app.use("/api/dispatch", dispatchStreamRouter);

  // Phase 5: Visit intelligence signals
  app.use("/api/intelligence", intelligenceRouter);


  // 2026-04-21 — Canonical import pipeline (preview + commit), one route
  // file for every entity. `/api/imports/:entity/{preview,commit}`.
  app.use("/api/imports", importsRouter);

  // Admin timesheets: day/week views, edit/delete time entries
  app.use("/api/admin/timesheets", adminTimesheetsRouter);

  // ========================================
  // ADMIN ROUTES (owner-only)
  // ========================================
  app.use("/api/admin", adminRouter);

  // ========================================
  // PLATFORM OPS PORTAL (platform-role only)
  //
  // Phase 1 (Platform Admin Foundation): /api/platform/* is gated by
  // requirePlatformRole at the router level. ensureTenantContext skips
  // this prefix so platform staff operate outside any tenant scope until
  // a support session is explicitly started (future phase).
  // ========================================
  app.use("/api/platform", platformRouter);

  // ========================================
  // CUSTOMER-SIDE SUPPORT ACCESS (tenant admin/owner only)
  // ========================================
  app.use("/api/support-access", supportAccessRouter);

  // Create and return HTTP server
  const httpServer = createServer(app);
  return httpServer;
}