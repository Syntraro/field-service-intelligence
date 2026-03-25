/**
 * Universal Search Routes
 *
 * GET /api/search - Multi-entity search across jobs, invoices, customers, locations, suppliers
 *
 * Phase 1 of RALPH global search implementation.
 */

import { Router } from "express";
import type { Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { AuthedRequest } from "../auth/tenantIsolation";
import { searchRepository } from "../storage/search";

const router = Router();

/**
 * GET /api/search
 *
 * Query params:
 *   q: string (required, min 2 chars)
 *   limit: number (optional, default 20, max 50)
 *
 * Returns: { results: SearchResult[], query: string }
 */
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    // Explicit auth guard - fail fast before any DB calls
    if (!req.user || !req.companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const companyId = req.companyId;
    const query = (req.query.q as string) ?? "";
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = Math.min(Math.max(limitParam || 30, 1), 60);

    if (query.trim().length < 2) {
      return res.json({ results: [], query });
    }

    const results = await searchRepository.universalSearch({
      query,
      companyId,
      limit,
    });

    res.json({ results, query });
  })
);

export default router;
