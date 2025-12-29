import { Router } from "express";
import passport from "passport";
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

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
      retryAfter: Math.ceil(req.rateLimit.resetTime! / 1000)
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
  message: { error: "Account temporarily locked due to too many failed login attempts. Please try again in 1 hour." },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    // Rate limit by email if provided, otherwise by IP
    const email = req.body?.email?.toLowerCase();
    return email ? `email:${email}` : `ip:${req.ip}`;
  },
  handler: (req, res) => {
    const email = req.body?.email;
    console.error(`[SECURITY] Account lockout triggered for: ${email || req.ip}`);
    res.status(429).json({ 
      error: "Account temporarily locked due to too many failed login attempts. Please try again later.",
      retryAfter: Math.ceil(req.rateLimit.resetTime! / 1000)
    });
  },
});

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 * Protected by rate limiting to prevent brute force attacks
 */
router.post("/login", loginLimiter, strictLoginLimiter, (req: Request, res: Response, next) => {
  // Log login attempt (without password!)
  console.log(`[AUTH] Login attempt for: ${req.body?.email || 'unknown'} from IP: ${req.ip}`);
  
  passport.authenticate("local", (err: any, user: any, info: any) => {
    if (err) {
      console.error(`[AUTH] Authentication error:`, err);
      return res.status(500).json({ error: "Authentication error" });
    }
    if (!user) {
      // Don't reveal whether email exists - generic error message
      console.warn(`[AUTH] Failed login for: ${req.body?.email || 'unknown'}`);
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
});

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

export default router;