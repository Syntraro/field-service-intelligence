import { Router } from "express";
import passport from "passport";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { asyncHandler, createError } from "../middleware/errorHandler";

declare module "express-serve-static-core" {
  interface Request {
    rateLimit?: {
      limit: number;
      current: number;
      remaining: number;
      resetTime: Date;
    };
  }
}

const router = Router();

/**
 * Rate limiter for login attempts
 * Protects against brute force attacks
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
  handler: (req, res) => {
    console.warn(`[SECURITY] Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many login attempts. Please try again in 15 minutes.",
      retryAfter: req.rateLimit?.resetTime
        ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000)
        : 900,
    });
  },
});

/**
 * Strict rate limiter for repeated failures
 * Additional protection layer
 */
const strictLoginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour max
  message: {
    error:
      "Account temporarily locked due to too many failed login attempts. Please try again in 1 hour.",
  },
  skipSuccessfulRequests: true,
  validate: false, // Disable all validation to prevent IPv6 warning
  keyGenerator: (req) => {
    // Rate limit by email if provided, otherwise by IP
    const email = req.body?.email?.toLowerCase();
    if (email) return `email:${email}`;
    // Use x-forwarded-for header or fallback to IP for proper proxy handling
    const forwardedFor = req.headers["x-forwarded-for"];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim() || req.ip || "unknown";
    return `ip:${ip}`;
  },
  handler: (req, res) => {
    const email = req.body?.email;
    console.error(`[SECURITY] Account lockout triggered for: ${email || req.ip}`);
    res.status(429).json({
      error:
        "Account temporarily locked due to too many failed login attempts. Please try again later.",
      retryAfter: req.rateLimit?.resetTime
        ? Math.ceil(req.rateLimit.resetTime.getTime() / 1000)
        : 3600,
    });
  },
});

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 * Protected by rate limiting to prevent brute force attacks
 */
router.post(
  "/login",
  loginLimiter,
  strictLoginLimiter,
  (req: Request, res: Response, next) => {
    // Log login attempt (without password!)
    console.log(
      `[AUTH] Login attempt for: ${req.body?.email || "unknown"} from IP: ${req.ip}`,
    );

    passport.authenticate("local", (err: any, user: any) => {
      if (err) {
        console.error(`[AUTH] Authentication error:`, err);
        return res.status(500).json({ error: "Authentication error" });
      }
      if (!user) {
        // Don't reveal whether email exists - generic error message
        console.warn(`[AUTH] Failed login for: ${req.body?.email || "unknown"}`);
        return res.status(401).json({ error: "Invalid email or password" });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error(`[AUTH] Login error:`, loginErr);
          return res.status(500).json({ error: "Login error" });
        }

        // Successful login
        console.log(`[AUTH] Successful login: ${user.email}`);

        res.json({
          id: user.id,
          email: user.email,
          role: user.role,
          companyId: user.companyId,
        });
      });
    })(req, res, next);
  },
);

/**
 * POST /api/auth/logout
 * End user session
 */
router.post("/logout", (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get("/me", (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    companyId: req.user.companyId,
  });
});

/**
 * POST /api/auth/signup
 * Create new user account
 */
router.post("/signup", asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, invitationToken } = req.body;

  if (!email || !password) {
    throw createError(400, "Email and password are required");
  }

  const existingUser = await storage.getUserByEmail(email);
  if (existingUser) {
    throw createError(400, "User already exists");
  }

  // ✅ Production safety: require invitation for signup
  if (!invitationToken) {
    throw createError(403, "Signup requires an invitation. Contact support to get started.");
  }

  const invitation = await storage.getInvitationByToken(invitationToken);
  if (!invitation || invitation.status !== "pending") {
    throw createError(400, "Invalid or expired invitation");
  }

  const companyId = invitation.companyId;
  const role = invitation.role || "technician";
  await storage.updateInvitation(invitation.id, { status: "accepted" });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await storage.createUser({
    email,
    password: hashedPassword,
    companyId,
    role,
    firstName,
    lastName,
  });

  req.logIn(user, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Account created but login failed" });
    }
    res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    });
  });
}));

export default router;
