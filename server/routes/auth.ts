import { Router } from "express";
import passport from "passport";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { storage } from "../storage/index";
import { asyncHandler, createError } from "../middleware/errorHandler";
import {
  requestPasswordReset,
  confirmPasswordReset,
} from "../services/passwordResetService";

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

        // 2026-04-16 auth-integrity: stamp users.last_login_at on every
        // real successful login. Fire-and-forget so the login response
        // is never blocked by this bookkeeping write. Runs inside the
        // req.logIn success callback so it only fires after Passport
        // has committed the session.
        storage.updateUser(user.id, { lastLoginAt: new Date() } as any)
          .catch((err: unknown) => {
            console.error(`[AUTH] Failed to stamp lastLoginAt for ${user.email}:`, err);
          });

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
 *
 * POLICY: Each email can only belong to one company globally.
 */
router.post("/signup", asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, invitationToken } = req.body;

  if (!email || !password) {
    throw createError(400, "Email and password are required");
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check global email uniqueness via identity table
  const globalCheck = await storage.isEmailGloballyAvailable(normalizedEmail);
  if (!globalCheck.available) {
    throw createError(400,
      "This email is already in use. Each email can only belong to one company."
    );
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
    email: normalizedEmail,
    password: hashedPassword,
    companyId,
    role,
    firstName,
    lastName,
  });

  // Create email identity for the new user
  await storage.createEmailIdentity(
    companyId,
    user.id,
    normalizedEmail,
    hashedPassword,
    true // verified
  );

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

// ============================================================================
// PASSWORD RESET (2026-04-15)
// ============================================================================

/**
 * Per-IP limiter for `POST /api/auth/password-reset-request`.
 *
 * Kept tight because (a) the endpoint always responds success regardless
 * of whether the email exists, so repeated calls must not be a cheap
 * enumeration oracle via timing, and (b) issuing tokens is a write path.
 */
const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please try again later." },
  handler: (req, res) => {
    console.warn(`[SECURITY] Password reset request rate limit hit for IP: ${req.ip}`);
    res.status(429).json({ error: "Too many password reset requests. Please try again later." });
  },
});

/**
 * Per-IP limiter for `POST /api/auth/password-reset/confirm`. Prevents
 * brute forcing a valid token by spraying candidates against the endpoint.
 * 10/15min is a safe upper bound: a legitimate user only hits this once
 * or twice per flow.
 */
const passwordResetConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
  },
});

/** Generic response returned for both "email sent" and "email unknown"
 *  to prevent account enumeration. Must be kept identical. */
const GENERIC_RESET_RESPONSE = {
  message: "If an account exists for that email, a reset link has been sent.",
};

/**
 * POST /api/auth/password-reset-request
 * Public, pre-auth. Always 200 with GENERIC_RESET_RESPONSE.
 */
router.post(
  "/password-reset-request",
  passwordResetRequestLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (typeof email !== "string" || !email.trim()) {
      // Still return the generic response — do not leak that the field
      // was malformed as a signal.
      return res.json(GENERIC_RESET_RESPONSE);
    }

    // Derive origin for the reset link fallback when APP_BASE_URL isn't set.
    const origin = req.get("origin") || null;
    const ip =
      (Array.isArray(req.headers["x-forwarded-for"])
        ? req.headers["x-forwarded-for"][0]
        : req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) ||
      req.ip ||
      null;

    // Fire-and-forget shape — we always resolve to the same response.
    await requestPasswordReset({ email, requestIp: ip, requestOrigin: origin });
    return res.json(GENERIC_RESET_RESPONSE);
  }),
);

/**
 * POST /api/auth/password-reset/confirm
 * Public, pre-auth. Verifies the one-shot token and sets a new password.
 */
router.post(
  "/password-reset/confirm",
  passwordResetConfirmLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = (req.body ?? {}) as {
      token?: string;
      newPassword?: string;
    };

    if (typeof token !== "string" || !token.trim()) {
      throw createError(400, "Reset token is required");
    }
    if (typeof newPassword !== "string") {
      throw createError(400, "New password is required");
    }
    if (newPassword.length < 8) {
      throw createError(400, "Password must be at least 8 characters");
    }

    const result = await confirmPasswordReset({ rawToken: token, newPassword });
    if (!result.ok) {
      if (result.error === "weak_password") {
        throw createError(400, "Password must be at least 8 characters");
      }
      // invalid / expired tokens collapse to the same error — we don't
      // help a probing client distinguish between them.
      throw createError(400, "This reset link is invalid or has expired. Please request a new one.");
    }

    res.json({ success: true });
  }),
);

export default router;
