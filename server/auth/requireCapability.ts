/**
 * requireCapability — single platform route gate, capability-based.
 *
 * 2026-04-22 Revised Phase 1 Internal Console Separation:
 *   Replaces scattered `requirePlatformRole([...role,...role])` whitelists
 *   across `/api/platform/*` with one uniform `requireCapability(cap)`
 *   gate. Reads from `req.platformUser.capabilities` (populated by
 *   `requirePlatformSession` from the shared `PLATFORM_ROLE_CAPS` map).
 *
 * MUST run AFTER `requirePlatformSession`. That middleware is responsible
 * for hydrating the user's role(s) + capability set; this middleware only
 * checks membership.
 *
 * On deny:
 *   - 403 with `{ error, code: "PLATFORM_CAPABILITY_DENIED", capability }`.
 *   - Fire-and-forget audit row via `platformAuditService.log` so denials
 *     show up in `/platform/bulk-runs` + any future cross-tenant audit
 *     reader.
 */

import type { Request, Response, NextFunction } from "express";
import type { PlatformCapability } from "@shared/platformCapabilities";
import { platformAuditService } from "../services/platformAuditService";

export function requireCapability(cap: PlatformCapability) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).platformUser as
      | { id?: string; email?: string; capabilities?: readonly string[] }
      | undefined;

    if (!user) {
      // Should never happen — requirePlatformSession runs first. If it
      // does, treat as 401 so the caller re-authenticates instead of
      // silently thinking they lack a capability.
      return res.status(401).json({
        error: "Not authenticated",
        code: "PLATFORM_NOT_AUTHED",
      });
    }

    if (!user.capabilities?.includes(cap)) {
      // Best-effort audit; never block response on audit I/O.
      platformAuditService
        .log({
          platformAdminId: user.id ?? "unknown",
          platformAdminEmail: user.email ?? "unknown",
          action: "platform_capability_denied" as any,
          req,
          details: {
            capability: cap,
            path: req.originalUrl || req.path,
            method: req.method,
          },
        })
        .catch((err) => {
          console.error("[requireCapability] audit write failed:", err);
        });

      return res.status(403).json({
        error: "Forbidden",
        code: "PLATFORM_CAPABILITY_DENIED",
        capability: cap,
      });
    }

    next();
  };
}

/**
 * Convenience — passes if the caller holds ANY of the listed capabilities.
 * Use sparingly; prefer a single precise capability per route.
 */
export function requireAnyCapability(...caps: PlatformCapability[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).platformUser as
      | { capabilities?: readonly string[] }
      | undefined;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const ok = caps.some((c) => user.capabilities?.includes(c));
    if (!ok) {
      return res.status(403).json({
        error: "Forbidden",
        code: "PLATFORM_CAPABILITY_DENIED",
        capability: caps.join("|"),
      });
    }
    next();
  };
}
