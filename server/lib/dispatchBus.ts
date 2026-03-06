/**
 * Dispatch Bus — In-process pub/sub for real-time dispatch freshness signals.
 *
 * Phase 1: Single-instance EventEmitter keyed by tenantId.
 * Phase 2: Replace with Redis pub/sub for horizontal scaling.
 *
 * Signals are tiny invalidation hints (not full DTOs). Clients use them
 * to know which TanStack Query keys to refetch via existing REST endpoints.
 */

import { EventEmitter } from "events";

export interface DispatchSignal {
  /** What changed: "calendar", "backlog", "activity", "task" */
  scope: string;
  /** Entity type that was mutated */
  entityType: "job" | "visit" | "task";
  /** Entity ID that was mutated */
  entityId: string;
  /** ISO timestamp of the mutation */
  ts: string;
}

const bus = new EventEmitter();
// Avoid MaxListenersExceededWarning — each SSE connection is one listener per tenant
bus.setMaxListeners(200);

/**
 * Emit a dispatch freshness signal to all subscribers for a tenant.
 * Fire-and-forget — never throws.
 */
export function emitDispatch(tenantId: string, signal: DispatchSignal): void {
  try {
    bus.emit(`tenant:${tenantId}`, signal);
  } catch {
    // Bus emission must never break mutation paths
  }
}

/**
 * Subscribe to dispatch signals for a tenant.
 * Returns an unsubscribe function.
 */
export function subscribeDispatch(
  tenantId: string,
  callback: (signal: DispatchSignal) => void,
): () => void {
  const channel = `tenant:${tenantId}`;
  bus.on(channel, callback);
  return () => {
    bus.off(channel, callback);
  };
}
