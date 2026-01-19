/**
 * Subscription Routes
 *
 * API endpoints for subscription management including:
 * - Usage information (existing)
 * - Billing cycle signup (monthly/annual)
 * - Cancellation
 * - Auto-renewal toggle
 * - Manual renewal
 *
 * All routes are tenant-isolated via companyId.
 */

import { Router, Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { subscriptionRepository } from "../storage/subscriptions";
import { subscriptionBillingRepository } from "../storage/subscriptionBilling";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { billingCycleEnum } from "@shared/schema";

const router = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const signupSchema = z.object({
  planId: z.string().optional(),
  billingCycle: z.enum(billingCycleEnum),
  autoRenewAnnual: z.boolean().optional().default(true),
});

const autoRenewSchema = z.object({
  autoRenewAnnual: z.boolean(),
});

const renewAnnualSchema = z.object({
  autoRenewAnnual: z.boolean().optional().default(true),
});

// ============================================================================
// Existing Routes (Usage)
// ============================================================================

/**
 * GET /api/subscriptions/usage
 * Get subscription usage info for the current company
 */
router.get(
  "/usage",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }
    const usage = await subscriptionRepository.getSubscriptionUsage(companyId);
    res.json(usage);
  })
);

/**
 * GET /api/subscriptions/can-add-location
 * Check if company can add more locations based on plan limits
 */
router.get(
  "/can-add-location",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }
    const result = await subscriptionRepository.canAddLocation(companyId);
    res.json(result);
  })
);

// ============================================================================
// Billing Cycle Routes
// ============================================================================

/**
 * GET /api/subscriptions/me
 * Get current subscription with computed fields
 */
router.get(
  "/me",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const info = await subscriptionBillingRepository.getSubscriptionInfo(companyId);

    if (!info) {
      // No subscription yet - return null with defaults
      res.json({
        subscription: null,
        daysUntilEnd: null,
        isInRenewalWindow: false,
        willAutoRenew: false,
        willRevertToMonthly: false,
      });
      return;
    }

    res.json(info);
  })
);

/**
 * GET /api/subscriptions/events
 * Get subscription event history
 */
router.get(
  "/events",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const events = await subscriptionBillingRepository.getEvents(companyId, limit);

    res.json({ events });
  })
);

/**
 * POST /api/subscriptions/signup
 * Create or update subscription (signup)
 *
 * Body:
 * - planId?: string - optional plan ID
 * - billingCycle: 'monthly' | 'annual'
 * - autoRenewAnnual?: boolean - only for annual (default true)
 *
 * For annual: sets endDate = startDate + 1 year
 * For monthly: endDate = null
 */
router.post(
  "/signup",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const data = validateSchema(signupSchema, req.body);

    const subscription = await subscriptionBillingRepository.signup({
      companyId,
      planId: data.planId,
      billingCycle: data.billingCycle,
      autoRenewAnnual: data.autoRenewAnnual,
    });

    res.status(201).json({
      success: true,
      subscription,
      message: `Successfully signed up for ${data.billingCycle} billing`,
    });
  })
);

/**
 * POST /api/subscriptions/cancel
 * Cancel the subscription
 *
 * - Annual: status='cancelled', access remains until endDate
 * - Monthly: status='cancelled' immediately
 */
router.post(
  "/cancel",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const subscription = await subscriptionBillingRepository.cancel(companyId);

    const message =
      subscription.billingCycle === "annual" && subscription.endDate
        ? `Subscription cancelled. Access continues until ${new Date(subscription.endDate).toLocaleDateString()}`
        : "Subscription cancelled";

    res.json({
      success: true,
      subscription,
      message,
    });
  })
);

/**
 * POST /api/subscriptions/auto-renew
 * Update auto-renew setting (annual only)
 *
 * Body:
 * - autoRenewAnnual: boolean
 */
router.post(
  "/auto-renew",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const data = validateSchema(autoRenewSchema, req.body);

    const subscription = await subscriptionBillingRepository.setAutoRenew(
      companyId,
      data.autoRenewAnnual
    );

    res.json({
      success: true,
      subscription,
      message: data.autoRenewAnnual
        ? "Auto-renewal enabled. Subscription will renew automatically."
        : "Auto-renewal disabled. Subscription will convert to monthly at term end.",
    });
  })
);

/**
 * POST /api/subscriptions/renew-annual
 * Manually renew into annual subscription
 *
 * - If currently annual: extends endDate by 1 year from current endDate
 * - If currently monthly: converts to annual, endDate = now + 1 year
 *
 * Body:
 * - autoRenewAnnual?: boolean (default true)
 */
router.post(
  "/renew-annual",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId;
    if (!companyId) {
      throw createError(401, "Unauthorized");
    }

    const data = validateSchema(renewAnnualSchema, req.body);

    const subscription = await subscriptionBillingRepository.renewAnnual(
      companyId,
      data.autoRenewAnnual
    );

    res.json({
      success: true,
      subscription,
      message: `Annual subscription ${subscription.endDate ? `renewed until ${new Date(subscription.endDate).toLocaleDateString()}` : "activated"}`,
    });
  })
);

export default router;
