import { Router } from "express";
import passport from "passport";
import type { Request, Response } from "express";

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */
router.post("/login", (req: Request, res: Response, next) => {
  passport.authenticate("local", (err: any, user: any, info: any) => {
    if (err) {
      return res.status(500).json({ error: "Authentication error" });
    }
    if (!user) {
      return res.status(401).json({ error: info?.message || "Invalid email or password" });
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ error: "Login error" });
      }
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