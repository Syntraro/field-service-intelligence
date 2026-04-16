/**
 * Support Session Context — Phase 5 hardening.
 *
 * Request-scoped async context exposing the active support session (if any)
 * to code paths that do not receive `req` as a parameter. Services can call
 * `assertWritableSupportContext()` at the top of a mutation entry point and
 * the call will throw a 403 `READ_ONLY_SUPPORT_SESSION` error when the
 * ambient context is a read-only session. Non-support requests and
 * impersonation-mode requests are no-ops.
 *
 * This is defense-in-depth behind `enforceReadOnlySupport` (HTTP method
 * block). Every mutation reaches the service layer inside the same
 * AsyncLocalStorage context, so a write that somehow slipped past the HTTP
 * guard (a GET handler calling a write service, a worker invoked via the
 * request pipeline, etc.) is still blocked.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import type { ImpersonationSession } from "@shared/schema";
import { platformAuditService } from "../services/platformAuditService";

export interface SupportContext {
  session: ImpersonationSession;
  actor: { id: string; email: string };
  /** True when session.accessMode === 'read_only'. */
  isReadOnly: boolean;
  /** Optional — available when context was established by HTTP middleware. */
  req?: Request;
}

const supportStore = new AsyncLocalStorage<SupportContext>();

export class ReadOnlySupportSessionError extends Error {
  readonly status = 403;
  readonly code = "READ_ONLY_SUPPORT_SESSION";
  readonly sessionId: string;
  constructor(sessionId: string, scope?: string) {
    super(
      scope
        ? `This support session is read-only. Mutation '${scope}' is not permitted.`
        : "This support session is read-only. Mutations are not permitted.",
    );
    this.name = "ReadOnlySupportSessionError";
    this.sessionId = sessionId;
  }
}

/** Run the supplied function inside a support-session context. */
export function runWithSupportContext<T>(ctx: SupportContext, fn: () => T): T {
  return supportStore.run(ctx, fn);
}

/** Ambient support-session context, if any. */
export function getSupportContext(): SupportContext | undefined {
  return supportStore.getStore();
}

/** True when the ambient context is a read-only support session. */
export function isReadOnlySupport(): boolean {
  return !!supportStore.getStore()?.isReadOnly;
}

/**
 * Throw `ReadOnlySupportSessionError` when the current async context is a
 * read-only support session. No-op for:
 *   - plain tenant users (no ambient support context)
 *   - impersonation-mode sessions (ambient context exists but isReadOnly=false)
 *   - out-of-request call sites (schedulers, workers — no ambient context)
 *
 * `scope` is a free-form label logged in the audit record and embedded in the
 * error message (e.g. "invoice.create", "job.update").
 */
export function assertWritableSupportContext(scope?: string): void {
  const ctx = supportStore.getStore();
  if (!ctx || !ctx.isReadOnly) return;

  // Fire-and-forget audit. Never block the error throw on audit I/O.
  platformAuditService
    .logReadOnlyMutationBlocked(
      ctx.actor.id,
      ctx.actor.email,
      ctx.session.id,
      ctx.session.companyId,
      "service",
      scope ?? "unknown",
      ctx.req,
    )
    .catch((err) => {
      console.error("[support-context] audit write failed:", err);
    });

  throw new ReadOnlySupportSessionError(ctx.session.id, scope);
}
