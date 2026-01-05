import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { impersonationService } from "../impersonationService";

const router = Router();

// Note: This file only has GET routes, no POST/PUT/PATCH
// No validation needed for GET routes

/**
 * GET /api/impersonation/status
 * Returns whether an impersonation session is active for the current request.
 *
 * NOTE:
 * - This is session/context state, not storage state.
 * - Do NOT call storage.getImpersonationStatus (it doesn't exist and shouldn't).
 */
router.get("/status", requireAuth, (req, res) => {
  try {
    const session = impersonationService.getActiveSession(req);
    res.json({ active: !!session, session: session || null });
  } catch (err: any) {
    // Fail-soft: status endpoint should never crash the app
    res.status(200).json({ active: false, session: null });
  }
});

export default router;