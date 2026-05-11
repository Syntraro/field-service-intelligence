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
import itemCategoriesRouter from "./itemCategories";
import pricebookGroupsRouter from "./pricebookGroups";
import companySettingsRouter from "./companySettings";
// 2026-05-05: tenant-level Invoice Display policy. Companion endpoint to
// /api/company-settings — see `server/routes/invoiceDisplaySettings.ts`.
import invoiceDisplaySettingsRouter from "./invoiceDisplaySettings";
// 2026-05-03: tenant tax registration identity (multi-row).
// See `server/routes/companyTaxRegistrations.ts` for the two
// endpoints (GET list + PUT replace-all).
import companyTaxRegistrationsRouter from "./companyTaxRegistrations";
import communicationTemplatesRouter from "./communicationTemplates";
// Phase 15 (2026-04-12): cross-entity delivery-history endpoint.
import communicationsRouter from "./communications";
// 2026-05-08 Phase 5: provider-neutral SMS webhooks. Mounted BEFORE the
// global `app.use("/api", requireAuth)` so provider POSTs reach the route.
// Authentication is via signature verification inside each handler.
import communicationsWebhooksRouter from "./communicationsWebhooks";
import businessHoursRouter from "./businessHours";
import equipmentTypesRouter from "./equipmentTypes";
import maintenanceRouter from "./maintenance";
import subscriptionsRouter from "./subscriptions";
import authRouter from "./auth";
import portalRouter from "./portal";

// ✅ NEW (long-term client/company detail fix)
import customerCompaniesRouter from "./customer-companies";
import healthRouter from "./health";
// 2026-04-23: public technician calendar ICS feed. Mounted at /calendar/*
// (no /api prefix) so the global `app.use("/api", requireAuth)` gate does
// not apply — the ICS token itself is the auth primitive. See
// server/routes/technicianCalendarPublic.ts for the full rationale.
import technicianCalendarPublicRouter from "./technicianCalendarPublic";
import { requireAuth } from "../auth/requireAuth";
// 2026-05-04 Phase 1: dashboard authz fix. requirePermission gates the
// office reads at the mount level so the API surface is authoritative;
// requireRole(MANAGER_ROLES) gates `/api/leads` GETs so the tech-app
// POST flow stays open.
import { requirePermission } from "../permissions";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
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
import dashboardLayoutRouter from "./dashboardLayout";
import technicianTimeOffRouter from "./technicianTimeOff";
import reportsRouter from "./reports";
import { timesheetReportsRouter } from "./timesheetReports";
import paymentsRouter from "./payments";
import stripePaymentsRouter from "./stripePayments";
// 2026-05-03 PR2 — tenant payments onboarding API surface
// (GET /api/payments/account, POST /api/payments/account/onboard,
// POST /api/payments/account/refresh). Mounted alongside paymentsRouter
// so the legacy invoice-payment paths and the new account-onboarding
// paths share the same `/api` prefix.
import paymentAccountRouter from "./paymentAccount";
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
// 2026-05-04 Phase 2 PR 1: tech-safe location/equipment/jobs read endpoints.
// Sibling to techField so we don't keep growing that 2k-line file.
import techLocationsRouter from "./techLocations";
// 2026-05-05 Lead Visits — pre-sales scheduling. Office router mounts
// at /api/leads (nested paths: /:leadId/visits/...). Tech router
// mounts at /api/tech/lead-visits with its own requireSchedulable +
// per-visit scoping.
import leadVisitsRouter from "./leadVisits";
import leadVisitsTechRouter from "./leadVisitsTech";
import adminTimesheetsRouter from "./adminTimesheets";
import referenceFieldsRouter from "./referenceFields";
import visitsRouter from "./visits";
// Phase 1 Architecture: Event Log + Attention Queue
import activityRouter from "./activity";
import attentionRouter from "./attention";
// 2026-05-07: Global Activity Feed drawer — filtered + per-user-customizable
// surface over the canonical events table.
import activityFeedRouter from "./activityFeed";
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
// 2026-04-22 Phase 1 platform auth separation: dedicated login endpoints +
// session middleware for the internal /platform admin console.
import platformAuthRouter from "./platformAuth";
import {
  platformSessionMiddleware,
  requirePlatformSession,
} from "../auth/platformSession";
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
  // PUBLIC TECHNICIAN CALENDAR FEED (before auth)
  // ========================================
  //
  // /calendar/technician/:token.ics resolves technicians by private token
  // and returns a read-only ICS feed. Mounted BEFORE the /api auth gate
  // so external calendar apps (Google / Apple / Outlook) can subscribe
  // without a session. The token is the auth primitive.
  app.use("/calendar/technician", technicianCalendarPublicRouter);
  // ========================================
  // CRITICAL: Auth routes MUST come FIRST
  // ========================================
  app.use("/api/auth", authRouter);

  // ========================================
  // CUSTOMER PORTAL (before staff auth guard — portal has its own auth)
  // ========================================
  app.use("/api/portal", portalRouter);

  // ========================================
  // PLATFORM ADMIN CONSOLE (2026-04-22 Phase 1 auth separation)
  // ========================================
  //
  // /api/platform/* is a separate auth boundary from the tenant app:
  //   - Its own session cookie (`psid`, signed with PLATFORM_SESSION_SECRET).
  //   - Its own login endpoint (`POST /api/platform/auth/login`).
  //   - Its own identity surface (`req.platformUser`, NOT req.user).
  //
  // Mounted BEFORE the global `app.use("/api", requireAuth)` so a tenant
  // session is NOT required to reach platform routes. The login endpoint
  // is mounted as a sibling (no requirePlatformSession — it's the bootstrap
  // step); everything else under /api/platform is gated by
  // requirePlatformSession.
  app.use("/api/platform", platformSessionMiddleware);
  app.use("/api/platform/auth", platformAuthRouter);
  app.use("/api/platform", requirePlatformSession, platformRouter);

  // 2026-05-08 Phase 5: provider-neutral SMS webhooks. Mounted BEFORE
  // the global `app.use("/api", requireAuth)` so provider POSTs (no
  // tenant session) reach the handler. Authentication is performed via
  // HMAC signature against the tenant's per-provider webhook secret —
  // see server/routes/communicationsWebhooks.ts.
  app.use("/api/communications/webhooks", communicationsWebhooksRouter);

  // ========================================
  // GLOBAL MIDDLEWARE (after auth routes)
  // ========================================

  // 2026-04-22 Phase 2-lite Platform Auth Separation:
  //   impersonationMiddleware now runs BEFORE requireAuth so a platform
  //   admin with only a psid session + imp_session cookie can reach tenant
  //   routes while impersonating. The middleware bootstraps req.user from
  //   the imp_session's target tenant user; requireAuth then passes because
  //   req.user is populated. Without imp_session the middleware is a no-op
  //   and requireAuth behaves as before.
  app.use(impersonationMiddleware(storage as any));

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

  // 4) Activity tracking (requires an authenticated req.user — runs AFTER
  //    requireAuth so platform-only requests don't spuriously touch it).
  app.use(trackActivity);

  // 5) Phase 4: Read-only support session enforcement.
  //    Runs AFTER impersonation middleware so req.isReadOnlySupport is set;
  //    blocks all mutating HTTP methods on /api except /api/platform/*.
  app.use(enforceReadOnlySupport);

  // ========================================
  // PROTECTED ROUTES (after middleware)
  // ========================================

  // 2026-05-04 Phase 1 dashboard authz: mount-level fine-permission
  // gate, declared BEFORE any /api/jobs sub-router so every read on
  // the namespace flows through it. Express middleware runs in
  // declaration order, so subsequent `app.use("/api/jobs", ...)` mounts
  // inherit this gate.
  //
  // 2026-05-04 Phase 2 PR 4: coarse role gate added BEFORE the fine
  // permission gate. Two-layer model per CLAUDE.md: requireRole runs
  // first (cheap, no DB read), requirePermission second (DB-backed,
  // honors per-user overrides). Technicians retain `jobs.view` in
  // their fine permission set so the office API surface continues to
  // protect against a granular permission revoke, but they no longer
  // pass the role gate. Tech-PWA reads route through `/api/tech/*`.
  app.use("/api/jobs", requireRole(MANAGER_ROLES));
  app.use("/api/jobs", requirePermission("jobs.view"));
  app.use("/api/jobs", jobsRouter);
  app.use("/api/jobs", jobVisitsRoutes);
  app.use("/api/jobs", jobTimeRouter); // Time tracking: status updates + time summaries
  app.use("/api/jobs", jobExpensesRouter); // Job expenses: CRUD + approval
  app.use("/api/invoices", requirePermission("invoices.view"), invoicesRouter);
  // 2026-05-04 PR8.5 — mount order fix. paymentAccountRouter MUST be
  // mounted BEFORE paymentsRouter because paymentsRouter declares a
  // greedy single-segment matcher `GET /api/payments/:id` (used for
  // legitimate per-payment lookups by UUID). Express dispatches in
  // mount order, first-match-wins; if paymentsRouter were mounted
  // first, the `:id` matcher would capture the literal string
  // segments `account` / `payouts` / `disputes` / `transactions` /
  // `anomalies` and route every Payments-dashboard read to the
  // generic `Get single payment not implemented` 501 handler. Putting
  // paymentAccountRouter first lets its literal-string routes match
  // before the `:id` fallback ever runs. The `:id` matcher still
  // resolves correctly for UUID payment lookups because none of the
  // literal-string sub-paths above are valid UUIDs.
  //
  //   paymentAccountRouter exposes (PR2 / PR5 / PR6 / PR7 / PR8):
  //     GET  /api/payments/account
  //     POST /api/payments/account/onboard
  //     POST /api/payments/account/refresh
  //     GET  /api/payments/payouts(/summary)
  //     GET  /api/payments/disputes(/summary)
  //     GET  /api/payments/transactions
  //     GET  /api/payments/anomalies/summary
  app.use("/api", paymentAccountRouter);
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
  // 2026-05-04 Phase 2 PR 4: coarse role gate runs first. Technicians
  // retain `clients.view.basic` in their fine permission set; the
  // mount-level role gate is what closes the office surface to them.
  // Tech-PWA reads route through `/api/tech/locations/*`.
  app.use("/api/clients", requireRole(MANAGER_ROLES));
  app.use("/api/clients", requirePermission("clients.view.basic"), clientsRouter);
  // 2026-05-04 Phase 2 PR 4: equipment GETs (timeline, notes, parts,
  // history, catalog-items) had no mount-level gate; writes already
  // require MANAGER_ROLES per route. Adding a coarse role gate here
  // closes the read surface to technicians. Tech-PWA reads route
  // through `/api/tech/equipment/*`.
  app.use("/api/equipment", requireRole(MANAGER_ROLES));
  app.use("/api/equipment", equipmentRouter);
  app.use("/api/technicians", techniciansRouter);
  app.use("/api/job-templates", jobTemplatesRouter);
  app.use("/api/invitations", invitationsRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/users-admin", usersAdminRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/item-categories", itemCategoriesRouter);
  app.use("/api/pricebook-groups", pricebookGroupsRouter);
  app.use("/api/company-settings", companySettingsRouter);
  app.use("/api/invoice-display-settings", invoiceDisplaySettingsRouter);
  app.use("/api/company-tax-registrations", companyTaxRegistrationsRouter);
  app.use("/api/communication-templates", communicationTemplatesRouter);
  app.use("/api/communications", communicationsRouter);
  app.use("/api/company/business-hours", businessHoursRouter);
  app.use("/api/equipment-types", equipmentTypesRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/tasks", tasksRoutes);
  app.use("/api/feedback", feedbackRouter);
  // 2026-05-04 Phase 2 PR 4: supplier GETs (list, detail, contacts,
  // visits) had no mount-level gate; writes already require
  // MANAGER_ROLES per route. Closing the read surface to technicians.
  app.use("/api/suppliers", requireRole(MANAGER_ROLES));
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/dashboard", requirePermission("dashboard.view"), dashboardRouter);
  // 2026-05-07 RALPH: per-user dashboard layout persistence (visibility
  // + ordering). Mounted at a sibling path so the data-aggregation
  // route whitelist test in tests/dashboard-layout.test.ts stays
  // intact. The mount-level permission gate lives inside the router
  // itself (matches `dashboard.view`).
  app.use("/api/dashboard-layout", dashboardLayoutRouter);
  // Technician time off (2026-05-07 RALPH) — admin/dispatcher CRUD
  // for blocking technician availability. Permission gate lives
  // inside the router (requireAuth + requireRole(MANAGER_ROLES)).
  app.use("/api/technician-time-off", technicianTimeOffRouter);
  app.use("/api/reports", reportsRouter);
  // Timesheet Report (2026-04-12): mounts /api/reports/timesheets + payroll-settings.
  app.use("/api/reports", timesheetReportsRouter);
  app.use("/api/qbo", qboRouter);
  app.use("/api/quotes", requirePermission("quotes.view"), quotesRouter);
  app.use("/api/quote-templates", quoteTemplatesRouter);
  // 2026-05-04 Phase 1 dashboard authz: method-scoped gate. The
  // tech-app lead-create flow needs anonymous-tenant POST/PATCH/DELETE
  // access, so we only enforce MANAGER_ROLES on GET reads. Non-GET
  // methods fall through to the leadsRouter unchanged.
  app.use("/api/leads", (req, res, next) => {
    if (req.method === "GET") return requireRole(MANAGER_ROLES)(req, res, next);
    next();
  });
  app.use("/api/leads", leadsRouter);
  // 2026-05-05 Lead Visits — office sub-router for /api/leads/:leadId/visits.
  // Mounted AFTER leadsRouter; Express tries each in order, so the
  // visit-scoped paths resolve here while bare /api/leads/:id stays on
  // the leadsRouter.
  app.use("/api/leads", leadVisitsRouter);
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
  // Phase 2 PR 1 (2026-05-04): tech-safe location reads.
  app.use("/api/tech", techLocationsRouter);
  // 2026-05-05 Lead Visits — tech sub-router with its own
  // requireSchedulable + assertCanAccessLeadVisit gating.
  app.use("/api/tech/lead-visits", leadVisitsTechRouter);

  // Phase 1 Architecture: Event Log + Attention Queue
  app.use("/api/activity", activityRouter);
  app.use("/api/attention", attentionRouter);
  // 2026-05-07: Global Activity Feed drawer endpoints (feed + per-user prefs).
  app.use("/api/activity-feed", activityFeedRouter);

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
  // PLATFORM OPS PORTAL mount moved UP to the platform-auth block above
  // (2026-04-22 Phase 1 auth separation). The `/api/platform/*` mount
  // now precedes the global tenant `requireAuth` so platform routes
  // authenticate exclusively via the psid session.
  // ========================================

  // ========================================
  // CUSTOMER-SIDE SUPPORT ACCESS (tenant admin/owner only)
  // ========================================
  app.use("/api/support-access", supportAccessRouter);

  // Create and return HTTP server
  const httpServer = createServer(app);
  return httpServer;
}