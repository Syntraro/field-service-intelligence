import { Router } from "express";
import passport from "passport";
import type { Request, Response } from "express";

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate user with email and password
 */
router.post("/login", passport.authenticate("local"), (req: Request, res: Response) => {
  // If we get here, authentication succeeded
  // req.user is set by passport
  res.json({
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    companyId: req.user!.companyId,
  });
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