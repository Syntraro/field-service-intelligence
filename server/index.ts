import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import helmet from "helmet";
import cors from "cors";
import csrf from "csurf";
import path from "path";

import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import passport from "passport";

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

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: process.env.SESSION_TABLE ?? "session",
      createTableIfMissing: true,
    }),
    secret: sessionSecret ?? "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      maxAge: Number(process.env.SESSION_MAX_AGE_MS ?? 1000 * 60 * 60 * 24 * 14), // 14 days
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

// Apply CSRF to state-changing requests
app.use('/api', (req, res, next) => {
  // Skip CSRF for:
  // 1. Safe methods (GET, HEAD, OPTIONS)
  // 2. Public endpoints
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  const publicEndpoints = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/invitations/accept',
    '/api/health',
    '/api/csrf-token'
  ];

  if (safeMethods.includes(req.method) || 
      publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // Apply CSRF protection to all other API requests
  return csrfProtection(req, res, next);
});

// CSRF token endpoint (must be before requireAuth)
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: (req as any).csrfToken() });
});

// Log requests
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    log(`${req.method} ${req.path}`);
  }
  next();
});

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
      error: status >= 500 ? "Internal server error" : err?.message ?? "Error" 
    });
  } else {
    // Show full errors in development
    res.status(status).json({ 
      error: err?.message ?? "Error", 
      stack: err?.stack,
      ...(err?.details && { details: err.details })
    });
  }
});

// Start listening when run directly (Replit/Node entry)
const port = Number(process.env.PORT ?? 5000);
server.listen(port, "0.0.0.0", () => {
  log(`serving on port ${port}`);
});