import { Request, Response, NextFunction } from "express";
import { tenantFeaturesRepository } from "../storage/tenantFeatures";
import type { FeatureKey } from "@shared/schema";

/**
 * Feature gate middleware.
 *
 * Checks if the requested feature is enabled for the authenticated user's company.
 * Returns 403 Forbidden if the feature is disabled.
 *
 * Must be used after requireAuth middleware (needs req.user and req.companyId).
 *
 * Usage:
 *   router.get("/quotes", requireAuth, requireFeature("quotesEnabled"), handler);
 */
export function requireFeature(featureKey: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Platform admins bypass feature gates (for support/debugging)
    const effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
    if (effectiveUser?.role === "platform_admin") {
      return next();
    }

    // Get company ID from request (set by ensureTenantContext)
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const isEnabled = await tenantFeaturesRepository.isFeatureEnabled(companyId, featureKey);

      if (!isEnabled) {
        return res.status(403).json({
          error: "Feature not available",
          code: "FEATURE_DISABLED",
          feature: featureKey,
          message: `The ${featureKeyToName(featureKey)} feature is not enabled for your account. Please contact support or upgrade your plan.`,
        });
      }

      next();
    } catch (error) {
      console.error(`Error checking feature ${featureKey} for company ${companyId}:`, error);
      // Fail open for now - if feature check fails, allow access
      // Could be changed to fail closed for stricter security
      next();
    }
  };
}

/**
 * Convert feature key to human-readable name
 */
function featureKeyToName(key: FeatureKey): string {
  const names: Record<FeatureKey, string> = {
    quotesEnabled: "Quotes",
    invoicesEnabled: "Invoices",
    calendarEnabled: "Calendar",
    qboEnabled: "QuickBooks Integration",
    routeOptimizationEnabled: "Route Optimization",
    multiTechEnabled: "Multi-Technician Scheduling",
    liveMapEnabled: "Live Map",
    customerPortalEnabled: "Customer Portal",
    customerPortalPaymentsEnabled: "Customer Portal Payments",
  };
  return names[key] || key;
}
