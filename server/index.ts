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
import { setupVite, serveStatic, log } from "./vite";
import passport from "passport";
import "./auth";  // Register passport strategies
import { enforceSchemaOrExit } from "./utils/schemaGuard";
import { validateEmailConfig } from "./resendClient";
import { startPmAutoGeneration } from "./services/pmAutoGeneration";

/**
 * Production security defaults.
 * Adjust CORS_ORIGIN to your deployed frontend origin.
 */
const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

const app = express();

// If deployed behind a proxy (Render/Fly/Railway/Nginx), this is required for secure cookies + IPs.
app.set("trust proxy", 1);

// Body parsing limits
app.use(express.json({ limit: process.env.JSON_LIMIT ?? "2mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_LIMIT ?? "2mb" }));

// Cookie parsing (required for httpOnly impersonation cookies)
app.use(cookieParser());

// Security headers with CSP enabled
app.use(
  helmet({
    frameguard: { action: "deny" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for Vite in dev
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
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

// 2-hour idle timeout (rolling). Cookie resets on every request so active
// users stay logged in; inactive users expire after 2 hours.
const SESSION_IDLE_MS = Number(process.env.SESSION_MAX_AGE_MS ?? 1000 * 60 * 60 * 2); // 2 hours

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
    saveUninitialized: true, // ← Create session even before login for CSRF
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
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();