// UTC-safe scheduling: belt-and-suspenders TZ pin.
// The PRIMARY pin is TZ=UTC in the package.json launch scripts (dev/start),
// which sets the environment variable BEFORE Node.js starts — ensuring the pg
// driver parses timestamp-without-timezone values in UTC from the very first
// import. This in-code assignment is a fallback for non-script launches; in ESM
// it runs AFTER imports due to hoisting, so it cannot be the sole mechanism.
process.env.TZ = "UTC";

import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import helmet from "helmet";
import cors from "cors";
import csrf from "csurf";
import cookieParser from "cookie-parser";
import path from "path";

import { registerRoutes } from "./routes";
import { buildResendWebhookRouter } from "./routes/resendWebhook";
import { buildStripeWebhookRouter } from "./routes/stripeWebhook";
import { setupVite, serveStatic, log } from "./vite";
import passport from "passport";
import "./auth";  // Register passport strategies
import { enforceSchemaOrExit } from "./utils/schemaGuard";
import { validateEmailConfig } from "./resendClient";
import { validateStripeConfig } from "./services/stripeClient";
import { startPmAutoGeneration } from "./services/pmAutoGeneration";
import { startOrphanSweeper } from "./services/fileUploadService";
import { startQueuedEmailSweeper } from "./services/emailDeliveryTrackingService";
import { startSubscriptionWorker, stopSubscriptionWorker } from "./services/subscriptionWorker";
import { startTrialExpireWorker, stopTrialExpireWorker } from "./services/trialExpireWorker";
// 2026-05-04 secure tenant teardown — execute + expire sweep loops.
import {
  startTenantTeardownExecutorWorker,
  stopTenantTeardownExecutorWorker,
} from "./services/tenantTeardownExecutorWorker";
import { startInvoiceReminderWorker, stopInvoiceReminderWorker } from "./services/invoiceReminderWorker";
import { startMidnightRolloverWorker, stopMidnightRolloverWorker } from "./services/midnightRolloverWorker";
import { stopPmAutoGeneration } from "./services/pmAutoGeneration";
import { startFileCleanupWorker } from "./services/fileCleanupService";

/**
 * Production security defaults.
 * Adjust CORS_ORIGIN to your deployed frontend origin.
 */
const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

const app = express();

// If deployed behind a proxy (Render/Fly/Railway/Nginx), this is required for secure cookies + IPs.
app.set("trust proxy", 1);

// 2026-04-14: Resend webhook receiver MUST see the raw request body for
// Svix signature verification, so it's mounted BEFORE the global JSON
// body parser. The router applies `express.raw()` internally for its
// own path only — all other routes still get JSON parsing below.
app.use(buildResendWebhookRouter());

// 2026-04-14 Stripe Phase 1: Stripe webhook receiver has the same
// constraint — signature is computed over raw body bytes, so the
// router must run before `express.json()`.
app.use(buildStripeWebhookRouter());

// Body parsing limits
app.use(express.json({ limit: process.env.JSON_LIMIT ?? "2mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_LIMIT ?? "2mb" }));

// Cookie parsing (required for httpOnly impersonation cookies)
app.use(cookieParser());

// Security headers with CSP enabled.
//
// 2026-05-05: Stripe.js domains added to script-src / frame-src /
// connect-src. The Pay Invoice flow (PortalInvoiceDetail) calls
// `loadStripe(publishableKey)` which fetches `https://js.stripe.com/v3`
// and mounts Elements iframes. Without these allowlist entries the
// browser blocks the script and Stripe surfaces "Failed to load
// Stripe.js" — the bug that brought us here. The allowlist mirrors
// Stripe's documented CSP guidance (https://docs.stripe.com/security/guide):
//   • script-src  → https://js.stripe.com  (Stripe.js loader)
//   • frame-src   → https://js.stripe.com  (Elements iframes)
//                   https://hooks.stripe.com  (3DS / SCA challenge frames)
//   • connect-src → https://api.stripe.com  (PaymentIntent confirmation calls)
// We do NOT add `https://maps.googleapis.com` (only required for
// Stripe's Address Element autocomplete, which we don't use).
app.use(
  helmet({
    frameguard: { action: "deny" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'", // unsafe-eval needed for Vite in dev
          "https://js.stripe.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://*.r2.cloudflarestorage.com",
          "https://api.stripe.com",
        ],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
      },
    },
  })
);

// CORS (lock down in production)
const corsOrigin = process.env.CORS_ORIGIN;
if (IS_PROD && corsOrigin) {
  app.use(
    cors({
      origin: corsOrigin.split(",").map((s) => s.trim()),
      credentials: true,
    })
  );
} else {
  // Dev-friendly default
  app.use(cors({ origin: true, credentials: true }));
}

// Sessions
const PgStore = ConnectPgSimple(session);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IS_PROD) throw new Error("SESSION_SECRET is required in production");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: IS_PROD ? { rejectUnauthorized: false } : undefined,
});

// 7-day idle timeout (rolling). Cookie resets on every request so active
// users stay logged in; inactive users expire after 7 days of inactivity.
// Field service technicians need sessions that survive overnight browser close.
const SESSION_IDLE_MS = Number(process.env.SESSION_MAX_AGE_MS ?? 1000 * 60 * 60 * 24 * 7); // 7 days

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: process.env.SESSION_TABLE ?? "session",
      createTableIfMissing: true,
    }),
    secret: sessionSecret ?? "dev-secret",
    resave: false,
    rolling: true, // Reset maxAge on every response → idle timeout behavior
    saveUninitialized: false, // Only save sessions that are modified (CSRF endpoint initializes session via csurf secret)
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      maxAge: SESSION_IDLE_MS,
    },
    name: process.env.SESSION_COOKIE_NAME ?? "sid",
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// CSRF Protection (after session, before routes)
const csrfProtection = csrf({ 
  cookie: false // Use session storage instead of cookies
});

// CSRF token endpoint - MUST come before the conditional CSRF middleware
// This endpoint needs csrfProtection to run so it can generate the token
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: (req as any).csrfToken() });
});

// Apply CSRF to all /api requests.
// csurf automatically ignores safe methods (GET/HEAD/OPTIONS), and enforces token
// validation on state-changing methods (POST/PUT/PATCH/DELETE).
app.use('/api', csrfProtection);

// Log requests
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    log(`${req.method} ${req.path}`);
  }
  next();
});

// Validate email config at startup (warns if portal emails won't work)
validateEmailConfig();

// 2026-04-14 Stripe Phase 1: validate Stripe config. Warns loudly if
// missing; the server boots regardless. In-app card payments fail
// closed with 503 at request time until the env is set.
validateStripeConfig();

// Register API routes and create server
const server = registerRoutes(app);

// Static/Vite
if (IS_PROD) {
  serveStatic(app);
} else {
  setupVite(app, server);
}

// 404 handler for API
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler (no stack traces in prod)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.statusCode ?? err?.status ?? 500);
  
  // Special handling for CSRF errors
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ 
      error: "Invalid CSRF token",
      code: "EBADCSRFTOKEN"
    });
  }

  if (IS_PROD) {
    // Hide stack traces in production
    res.status(status).json({
      error: status >= 500 ? "Internal server error" : err?.message ?? "Error",
      // Preserve error code so frontend can distinguish 409 subtypes (e.g., VERSION_MISMATCH vs JOB_TERMINAL)
      ...(err?.code && err.code !== 'EBADCSRFTOKEN' && { code: err.code }),
    });
  } else {
    // Show full errors in development
    res.status(status).json({
      error: err?.message ?? "Error",
      // Preserve error code so frontend can distinguish 409 subtypes
      ...(err?.code && err.code !== 'EBADCSRFTOKEN' && { code: err.code }),
      stack: err?.stack,
      ...(err?.details && { details: err.details })
    });
  }
});

// Start listening when run directly (Replit/Node entry)
const port = Number(process.env.PORT ?? 5000);

// Handles to the sweepers that return their NodeJS.Timeout so the
// SIGTERM/SIGINT handler can clear them cleanly. The other workers expose
// explicit stop*() helpers.
let orphanSweeperHandle: NodeJS.Timeout | null = null;
let queuedEmailSweeperHandle: NodeJS.Timeout | null = null;
let fileCleanupWorkerHandle: NodeJS.Timeout | null = null;

// Validate schema before accepting requests
(async () => {
  try {
    await enforceSchemaOrExit();
    server.listen(port, "0.0.0.0", () => {
      log(`serving on port ${port}`);
      // Temporary diagnostic — remove after confirming QBO write access
      console.log(`[QBO] READ_ONLY_MODE = ${JSON.stringify(process.env.QBO_READ_ONLY_MODE)} (writes ${process.env.QBO_READ_ONLY_MODE === "false" ? "ALLOWED" : "BLOCKED"})`);
      // PM Phase 2: Start automatic PM job generation (30s delay + 6h interval)
      startPmAutoGeneration();
      // R2 file uploads: reap stale pending_upload rows on an interval so
      // failed / abandoned client uploads do not linger in the DB or R2.
      orphanSweeperHandle = startOrphanSweeper();
      // Phase C email hardening: reap stale `queued` email deliveries so
      // dispatches whose process was killed mid-send don't block the
      // per-entity UNIQUE index and never surface to the user.
      queuedEmailSweeperHandle = startQueuedEmailSweeper();
      // Phase 1 next-frontier (2026-04-14): daily subscription worker —
      // renewal notices (30/7 day), auto-renew, revert-to-monthly. All
      // operations are idempotent via subscriptionEvents unique key.
      startSubscriptionWorker();
      // 2026-04-21 Phase 1 canonical policy architecture: daily scan for
      // tenants whose trialEndsAt just passed. Writes a one-shot
      // `trial_expired` audit event on subscriptionEvents. Does NOT change
      // companies.subscriptionStatus — expiration stays compute-on-read at
      // the entitlement gate. See trialExpireWorker.ts.
      startTrialExpireWorker();
      // 2026-04-16: overdue invoice reminder sweep. Per-tenant gated via
      // tenant_features.invoice_reminders_enabled. Sweep runs every 4h
      // with a 1-minute startup delay. See invoiceReminderWorker.ts.
      startInvoiceReminderWorker();
      // 2026-04-16: midnight rollover auto-pause. Closes any time entry
      // still open past tenant-local midnight, stamps auto_paused_at for
      // reporting, and notifies the technician. Idempotent via dedupeKey
      // and the end_at IS NULL write-guard. See midnightRolloverWorker.ts.
      startMidnightRolloverWorker();
      // 2026-05-04 secure tenant teardown: drives Phase 4 of the deletion
      // workflow. Execute loop runs every 60s for approved rows past
      // execution_scheduled_at; expire loop runs every 5m for pending
      // rows past expires_at. Both transitions go through conditional
      // UPDATEs in the repo so duplicate workers can't double-act.
      startTenantTeardownExecutorWorker();
      // 2026-05-15: durable R2 cleanup after client/location permanent delete.
      // Processes file_cleanup_queue rows on a 5-minute interval, batching
      // R2 DeleteObjects calls by bucket. See fileCleanupService.ts.
      fileCleanupWorkerHandle = startFileCleanupWorker();
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();

// 2026-04-14 Phase 2 hygiene: graceful shutdown for background intervals.
// Runs alongside the existing db.ts / cache.ts handlers — Node invokes
// every registered listener for SIGTERM/SIGINT. Idempotent via the handle
// null-checks inside each stop helper.
let workerShutdownRan = false;
function shutdownBackgroundWorkers() {
  if (workerShutdownRan) return;
  workerShutdownRan = true;
  try { stopPmAutoGeneration(); } catch (err) { console.error("[shutdown] stopPmAutoGeneration failed:", err); }
  try { stopSubscriptionWorker(); } catch (err) { console.error("[shutdown] stopSubscriptionWorker failed:", err); }
  try { stopInvoiceReminderWorker(); } catch (err) { console.error("[shutdown] stopInvoiceReminderWorker failed:", err); }
  try { stopMidnightRolloverWorker(); } catch (err) { console.error("[shutdown] stopMidnightRolloverWorker failed:", err); }
  try { stopTenantTeardownExecutorWorker(); } catch (err) { console.error("[shutdown] stopTenantTeardownExecutorWorker failed:", err); }
  if (orphanSweeperHandle) {
    clearInterval(orphanSweeperHandle);
    orphanSweeperHandle = null;
  }
  if (queuedEmailSweeperHandle) {
    clearInterval(queuedEmailSweeperHandle);
    queuedEmailSweeperHandle = null;
  }
  if (fileCleanupWorkerHandle) {
    clearInterval(fileCleanupWorkerHandle);
    fileCleanupWorkerHandle = null;
  }
}
process.on("SIGTERM", shutdownBackgroundWorkers);
process.on("SIGINT", shutdownBackgroundWorkers);