import { Router, Request, Response } from "express";

const router = Router();

/**
 * GET /api/health
 * Basic health check endpoint
 * Returns 200 if server is running
 */
router.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;