/**
 * Notifications Routes
 *
 * API endpoints for in-app notifications.
 * All routes are tenant-isolated and user-scoped.
 */

import { Router, Response } from "express";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { notificationRepository } from "../storage/notifications";
import type { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/notifications
 * Get notifications for the current user
 *
 * Query params:
 * - limit: Max notifications to return (default 20, max 100)
 * - unreadOnly: If "true", only return unread notifications
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Parse query params manually to avoid TypeScript issues with validateSchema
    const limitParam = parseInt(req.query.limit as string) || 20;
    const limit = Math.min(Math.max(limitParam, 1), 100);
    const unreadOnly = req.query.unreadOnly === "true";
    const userId = req.user.id;
    const companyId = req.companyId;

    const [notifications, unreadCount] = await Promise.all([
      notificationRepository.getNotifications(companyId, userId, { limit, unreadOnly }),
      notificationRepository.getUnreadCount(companyId, userId),
    ]);

    res.json({
      notifications,
      unreadCount,
      total: notifications.length,
    });
  })
);

/**
 * GET /api/notifications/count
 * Get unread notification count for the current user
 */
router.get(
  "/count",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user.id;
    const companyId = req.companyId;

    const unreadCount = await notificationRepository.getUnreadCount(companyId, userId);

    res.json({ unreadCount });
  })
);

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read
 */
router.post(
  "/:id/read",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const userId = req.user.id;
    const companyId = req.companyId;

    const notification = await notificationRepository.markAsRead(companyId, userId, id);

    if (!notification) {
      throw createError(404, "Notification not found");
    }

    res.json({ success: true, notification });
  })
);

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for the current user
 */
router.post(
  "/read-all",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const userId = req.user.id;
    const companyId = req.companyId;

    const count = await notificationRepository.markAllAsRead(companyId, userId);

    res.json({ success: true, markedRead: count });
  })
);

export default router;
