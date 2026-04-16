/**
 * Dispatch Stream — SSE endpoint for real-time dispatch freshness.
 *
 * GET /api/dispatch/stream
 *
 * Sends tiny invalidation signals to connected dispatch board clients.
 * Clients use these to invalidate specific TanStack Query keys and refetch.
 * Auth is handled by the global requireAuth middleware in routes/index.ts.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { subscribeDispatch, type DispatchSignal } from "../lib/dispatchBus";

const router = Router();

/** Heartbeat interval (30s) to keep connection alive through proxies */
const HEARTBEAT_MS = 30_000;

let connectionIdCounter = 0;

router.get("/stream", (req: Request, res: Response) => {
  const tenantId = (req as any).companyId as string | undefined;
  if (!tenantId) {
    res.status(401).end();
    return;
  }

  const connId = ++connectionIdCounter;

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Initial connection confirmation
  res.write(`id:${connId}\nevent:connected\ndata:${JSON.stringify({ connId })}\n\n`);

  // Subscribe to dispatch signals for this tenant
  const onSignal = (signal: DispatchSignal) => {
    try {
      res.write(`event:dispatch\ndata:${JSON.stringify(signal)}\n\n`);
    } catch {
      // Connection may have closed — cleanup handled below
    }
  };
  const unsubscribe = subscribeDispatch(tenantId, onSignal);

  // Heartbeat to prevent proxy timeouts. 2026-04-14 Phase 2 hygiene:
  // `.unref()` so N open SSE connections don't collectively block SIGTERM.
  // The `close` / `error` handlers below clear the interval normally;
  // unref is a safety net for abrupt shutdowns.
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      // Connection closed
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // Cleanup on disconnect (idempotent guard prevents double-cleanup)
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;
