/**
 * Tenant User Predicate (2026-05-04 — platform/tenant identity containment).
 *
 * Single source of truth for "this users-table query is asking about
 * TENANT users only — exclude any row whose role is a platform role".
 *
 * Why this exists
 *   Platform admin / support / billing / readonly-audit accounts live in
 *   the same `users` table as tenant users (see SECURITY.md "Platform
 *   Admin Identity — Architectural Debt"). Their `companyId` is a
 *   "parking" FK pointing at whichever tenant happened to be picked when
 *   the platform user was seeded. Tenant queries that filtered only by
 *   `companyId` were therefore returning platform users alongside real
 *   tenant rows — surfacing them inside Team Management, technician
 *   selectors, payroll, etc.
 *
 *   This helper is the containment fix. Every tenant-facing user query
 *   composes it into its `.where(and(...))` so platform rows are
 *   filtered out at the SQL layer. Frontend has a defensive filter
 *   layered on top, but the authoritative gate is here.
 *
 * What this is NOT
 *   - It is NOT applied to identity lookups (`user_identities` joins
 *     for login flows). Platform login MUST be able to find platform
 *     users by email — that's how `/api/platform/auth/login` works.
 *   - It is NOT applied to bare `getUser(id)` lookups. Those are
 *     identity-by-id reads used by both auth surfaces; tenant
 *     authorization is enforced separately by `requireRole` /
 *     `requirePlatformSession` on the route layer.
 *   - It is NOT applied to platform-side reads under `/api/platform/*`.
 *     The platform console reads its own surface; it does not need
 *     tenant exclusion.
 *
 * Cleanup target
 *   When the planned `platform_users` + `platform_user_roles` tables
 *   land (see CHANGELOG / SECURITY.md / docs/REFACTORING_LOG.md), this
 *   predicate becomes a no-op — there will be no platform rows in
 *   `users` to filter out. The helper itself should remain as a
 *   defensive guarantee, but every callsite can drop it.
 */
import { notInArray, type SQL } from "drizzle-orm";
import { users } from "@shared/schema";
import { PLATFORM_ROLES } from "../auth/roles";

// Materialize the canonical readonly tuple as a mutable string[] once,
// at module load. Drizzle's `notInArray` typings require `string[]`,
// not `readonly string[]`. Materializing here avoids a per-call
// allocation at every tenant-user query site.
const PLATFORM_ROLES_ARRAY: string[] = [...PLATFORM_ROLES];

/**
 * Drizzle SQL predicate: row's `users.role` is NOT one of the canonical
 * platform roles. Compose into existing `.where(and(...))` clauses:
 *
 *   .where(and(
 *     eq(users.companyId, companyId),
 *     isNull(users.deletedAt),
 *     nonPlatformUserPredicate(),
 *   ))
 *
 * The platform-role list comes from `server/auth/roles.ts::PLATFORM_ROLES`
 * — the same canonical list the auth-layer middleware (`isPlatformRole`,
 * `requirePlatformRole`) uses. There is no second list anywhere; if a
 * new platform role is added there, every callsite of this predicate
 * picks it up automatically.
 */
export function nonPlatformUserPredicate(): SQL {
  return notInArray(users.role, PLATFORM_ROLES_ARRAY);
}
