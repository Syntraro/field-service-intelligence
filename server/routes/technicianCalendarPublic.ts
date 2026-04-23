/**
 * Public technician calendar ICS feed — Phase 1 (2026-04-23).
 *
 * Mount: /calendar/technician
 * Route: GET /:token.ics  →  text/calendar body
 *
 * This router is mounted OUTSIDE the /api prefix so it escapes the global
 * `requireAuth` gate (server/routes/index.ts). The token itself is the
 * auth primitive; there is no session cookie and no CSRF on GETs. Invalid
 * or disabled tokens return a 404 (not 403) so an attacker can't
 * distinguish "disabled" from "never existed".
 *
 * Per the product spec the feed is read-only and contains only safe
 * operational fields — title, start/end, address, basic summary, and an
 * optional app deep link. No pricing, invoice, payment, or internal-only
 * note ever reaches the wire.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { technicianCalendarTokenRepository } from "../storage/technicianCalendarTokens";
import { buildTechnicianIcsFeed } from "../services/technicianCalendarIcsService";

const router = Router();

/** Accept "<token>.ics". Reject anything that doesn't look like our
 *  base64url tokens (±: 32–128 URL-safe chars). The route param check is
 *  defensive only — the real gate is a DB lookup on the token column. */
const TOKEN_PATTERN = /^[A-Za-z0-9_\-]{32,128}$/;

router.get(
  "/:tokenWithExt",
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.params.tokenWithExt ?? "";
    if (!raw.endsWith(".ics")) {
      res.status(404).end();
      return;
    }
    const token = raw.slice(0, -4);
    if (!TOKEN_PATTERN.test(token)) {
      res.status(404).end();
      return;
    }

    const resolved = await technicianCalendarTokenRepository.resolveByToken(token);
    if (!resolved) {
      res.status(404).end();
      return;
    }

    // Fire-and-forget last-accessed update. Never awaited — subscription
    // feeds poll frequently and an update error must not break the feed.
    void technicianCalendarTokenRepository.touchLastAccessed(token);

    // Build the feed. Use the request origin for deep links so
    // production/staging subscriptions get correct URLs without
    // environment wiring.
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
    const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
    const appBaseUrl = host ? `${proto}://${host}` : null;

    const ics = await buildTechnicianIcsFeed(resolved.companyId, resolved.userId, {
      appBaseUrl,
    });

    res.setHeader("Content-Type", 'text/calendar; charset=utf-8; method=PUBLISH');
    res.setHeader("Content-Disposition", 'inline; filename="syntraro-schedule.ics"');
    // Conservative cache — subscribers typically refresh on their own
    // schedule anyway (Google: ~12h, Apple: 15m–1d, Outlook: 3h). A short
    // cache smooths bursty polls without making invalidation noticeable.
    res.setHeader("Cache-Control", "private, max-age=300, must-revalidate");
    res.status(200).send(ics);
  }),
);

export default router;
