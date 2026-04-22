import { Request, Response, NextFunction } from "express";
import { isPlatformRole } from "./roles";
import { entitlementService } from "../services/entitlementService";

/**
 * Feature gate middleware.
 *
 * 2026-04-21 Phase 3 canonical policy architecture:
 *   - Reads through `entitlementService.getEntitlement()` only. No legacy
 *     camelCase translation — every caller passes a canonical snake_case
 *     feature key (`"quotes"`, `"invoices"`, `"scheduling_calendar"`,
 *     `"quickbooks_online"`, `"multi_tech_scheduling"`, etc.).
 *   - FAIL-CLOSED: if the resolver throws, the request is denied with a
 *     structured 500. Silent bypass on transient errors is closed.
 *   - Platform-role bypass is preserved (support / debugging).
 *
 * Usage:
 *   router.use(requireFeature("invoices"));
 *   router.get("/...", requireFeature("multi_tech_scheduling"), handler);
 */

export function requireFeature(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Platform roles bypass feature gates (for support / debugging). Uses the
    // REAL actor during impersonation to match requireRole / requirePlatformRole.
    const effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
    if (isPlatformRole(effectiveUser?.role)) {
      return next();
    }

    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const entitlement = await entitlementService.getEntitlement(companyId, featureKey);

      // Unknown canonical key = programming error (missing from catalog /
      // unseeded migration). Surface as 500 — not a tenant configuration
      // issue, not a silent pass.
      if (!entitlement) {
        console.error(
          `[requireFeature] Unknown feature key: "${featureKey}" company=${companyId}`,
        );
        return res.status(500).json({
          error: "Feature configuration error",
          code: "FEATURE_UNKNOWN",
          feature: featureKey,
          message: "This feature is not configured on the server. Please contact support.",
        });
      }

      if (!entitlement.enabled) {
        return res.status(403).json({
          error: "Feature not available",
          code: "FEATURE_DISABLED",
          feature: featureKey,
          message: `The ${entitlement.displayName} feature is not enabled on your plan.`,
        });
      }

      next();
    } catch (error) {
      console.error(
        `[requireFeature] Resolver error for feature="${featureKey}" company=${companyId}:`,
        error,
      );
      return res.status(500).json({
        error: "Feature check failed",
        code: "FEATURE_CHECK_ERROR",
        feature: featureKey,
        message: "Could not verify feature access. Please try again or contact support.",
      });
    }
  };
}
