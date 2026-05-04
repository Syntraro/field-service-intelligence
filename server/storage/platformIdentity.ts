/**
 * Platform Identity Repository (Phase 2-A, 2026-05-04).
 *
 * Canonical read/write surface for the dedicated platform-staff
 * identity tables (`platform_users`, `platform_user_identities`,
 * `platform_user_roles`). Replaces the legacy "platform user parked
 * in tenant `users` with a fake `companyId`" model.
 *
 * Boundary contract
 *   • This file NEVER touches the tenant `users` / `user_identities`
 *     tables. Tenant identity lives in `server/storage/identities.ts`
 *     (`identityRepository`).
 *   • Tenant code paths NEVER read these tables. The two surfaces are
 *     deliberately separate identity worlds — same email may exist in
 *     both (Option 1, decided 2026-05-04).
 *
 * Phase 3.5 fallback
 *   Platform login (`server/routes/platformAuth.ts`) and
 *   `requirePlatformSession` may, during the deployment window,
 *   fall back to the legacy `users WHERE role IN PLATFORM_ROLES` path
 *   if a lookup against this repository returns null. That fallback
 *   exists ONLY there — it is not exposed by this file. Step D
 *   (separate PR, post-monitoring) deletes the legacy rows and removes
 *   the fallback.
 */

import { db } from "../db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  platformUsers,
  platformUserIdentities,
  platformUserRoles,
  type PlatformUser,
  type PlatformUserIdentity,
} from "@shared/schema";

export interface PlatformUserWithIdentityAndRoles {
  user: PlatformUser;
  identity: PlatformUserIdentity;
  roles: string[];
}

export interface CreatePlatformUserInput {
  email: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Single-role today; multi-role grants happen via a separate API later. */
  role: string;
  /** Bcrypt hash. Required — platform users are bootstrapped with credentials. */
  passwordHash: string;
  /** Optional id of the platform user issuing the grant. NULL for the
   *  first/bootstrap user (no granter exists yet). */
  grantedByPlatformUserId?: string | null;
}

function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

export const platformIdentityRepository = {
  /**
   * Resolve a platform user by their login email. Returns the user row,
   * the email identity row (carrying `password_hash`), and the user's
   * role(s). Returns `null` if no matching identity exists, the user
   * is soft-deleted, or the user has zero roles assigned.
   */
  async findPlatformUserByEmail(
    email: string,
  ): Promise<PlatformUserWithIdentityAndRoles | null> {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const rows = await db
      .select({
        user: platformUsers,
        identity: platformUserIdentities,
      })
      .from(platformUserIdentities)
      .innerJoin(platformUsers, eq(platformUsers.id, platformUserIdentities.userId))
      .where(
        and(
          eq(platformUserIdentities.provider, "email"),
          // case-insensitive match — schema enforces lower(identifier)
          // uniqueness so this lookup is direct.
          sql`lower(${platformUserIdentities.identifier}) = ${normalized}`,
          isNull(platformUsers.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const roles = await this.listRolesForUser(row.user.id);
    if (roles.length === 0) {
      // A platform user with zero roles is a half-provisioned account
      // — treat as "not found" so the auth surface does not grant a
      // session against an empty capability set.
      return null;
    }

    return { user: row.user, identity: row.identity, roles };
  },

  /**
   * Resolve a platform user by id. Used by `requirePlatformSession`
   * to hydrate `req.platformUser` from the psid session's
   * `platformUserId`.
   */
  async getPlatformUserById(
    id: string,
  ): Promise<{ user: PlatformUser; roles: string[] } | null> {
    const rows = await db
      .select()
      .from(platformUsers)
      .where(and(eq(platformUsers.id, id), isNull(platformUsers.deletedAt)))
      .limit(1);

    const user = rows[0];
    if (!user) return null;

    const roles = await this.listRolesForUser(user.id);
    if (roles.length === 0) return null;

    return { user, roles };
  },

  /**
   * Lookup the role list for a platform user. Returns canonical role
   * strings (`platform_admin`, etc.) — never tenant role strings.
   */
  async listRolesForUser(userId: string): Promise<string[]> {
    const rows = await db
      .select({ role: platformUserRoles.role })
      .from(platformUserRoles)
      .where(eq(platformUserRoles.userId, userId));
    return rows.map((r) => r.role);
  },

  /**
   * Create a new platform user. Inserts into all three tables in a
   * single transaction. Used by `seedPlatformUser.ts` and any future
   * "add platform user" admin flow.
   */
  async createPlatformUser(
    input: CreatePlatformUserInput,
  ): Promise<{ id: string; email: string; role: string }> {
    const email = normalizeEmail(input.email);

    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(platformUsers)
        .values({
          email,
          fullName: input.fullName ?? null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          status: "active",
          disabled: false,
        })
        .returning({ id: platformUsers.id, email: platformUsers.email });

      await tx.insert(platformUserIdentities).values({
        userId: created.id,
        provider: "email",
        identifier: email,
        passwordHash: input.passwordHash,
        verifiedAt: new Date(),
      });

      await tx.insert(platformUserRoles).values({
        userId: created.id,
        role: input.role,
        grantedBy: input.grantedByPlatformUserId ?? null,
      });

      return { id: created.id, email: created.email, role: input.role };
    });
  },

  /**
   * Reconcile an existing platform user — used by the seed script's
   * idempotent path. Activates the user, ensures the supplied role is
   * present in the join table, and ensures an `email` identity row
   * exists. Optionally rotates the password.
   *
   * Does NOT re-create rows that already exist (idempotent). Does NOT
   * remove other roles the user may already hold.
   */
  async reconcilePlatformUser(input: {
    userId: string;
    email: string;
    role: string;
    passwordHash: string;
    forcePassword: boolean;
  }): Promise<void> {
    const email = normalizeEmail(input.email);

    await db.transaction(async (tx) => {
      // 1) Activate / un-disable.
      await tx
        .update(platformUsers)
        .set({
          status: "active",
          disabled: false,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(platformUsers.id, input.userId));

      // 2) Ensure email identity exists (insert if missing); rotate
      //    password only when explicitly forced.
      const existingIdentity = await tx
        .select({ id: platformUserIdentities.id })
        .from(platformUserIdentities)
        .where(
          and(
            eq(platformUserIdentities.userId, input.userId),
            eq(platformUserIdentities.provider, "email"),
          ),
        )
        .limit(1);

      if (!existingIdentity[0]) {
        await tx.insert(platformUserIdentities).values({
          userId: input.userId,
          provider: "email",
          identifier: email,
          passwordHash: input.passwordHash,
          verifiedAt: new Date(),
        });
      } else if (input.forcePassword) {
        await tx
          .update(platformUserIdentities)
          .set({ passwordHash: input.passwordHash, updatedAt: new Date() })
          .where(eq(platformUserIdentities.id, existingIdentity[0].id));
      }

      // 3) Ensure role row exists.
      const existingRole = await tx
        .select({ role: platformUserRoles.role })
        .from(platformUserRoles)
        .where(
          and(
            eq(platformUserRoles.userId, input.userId),
            eq(platformUserRoles.role, input.role),
          ),
        )
        .limit(1);

      if (!existingRole[0]) {
        await tx.insert(platformUserRoles).values({
          userId: input.userId,
          role: input.role,
        });
      }
    });
  },

  /**
   * Set the email-identity password hash for a platform user. Used by
   * `confirmPlatformPasswordReset`.
   */
  async setPlatformPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(platformUserIdentities)
      .set({ passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(platformUserIdentities.userId, userId),
          eq(platformUserIdentities.provider, "email"),
        ),
      );
  },

  /**
   * Bump `token_version` on the platform user row. Same session-
   * invalidation lever the tenant flow uses on `users.token_version`.
   * Every active psid session against this user is invalidated on
   * the next `requirePlatformSession` round-trip.
   */
  async incrementPlatformTokenVersion(userId: string): Promise<void> {
    await db
      .update(platformUsers)
      .set({
        tokenVersion: sql`${platformUsers.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(platformUsers.id, userId));
  },

  /**
   * Touch the user's last_login_at timestamp. Best-effort; failure is
   * not fatal to the login flow.
   */
  async recordPlatformLogin(userId: string): Promise<void> {
    await db
      .update(platformUsers)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(platformUsers.id, userId));
  },

  /**
   * List every platform user with summary metadata. Used by
   * `auditPlatformUsers.ts`. Roles are aggregated per-user.
   */
  async listPlatformUsers(): Promise<
    Array<{
      id: string;
      email: string;
      status: string;
      disabled: boolean;
      tokenVersion: number;
      lastLoginAt: Date | null;
      hasPasswordIdentity: boolean;
      roles: string[];
    }>
  > {
    const usersRows = await db
      .select()
      .from(platformUsers)
      .where(isNull(platformUsers.deletedAt))
      .orderBy(asc(platformUsers.email));

    const out = [];
    for (const u of usersRows) {
      const [identityCount, roles] = await Promise.all([
        db
          .select({ id: platformUserIdentities.id })
          .from(platformUserIdentities)
          .where(
            and(
              eq(platformUserIdentities.userId, u.id),
              eq(platformUserIdentities.provider, "email"),
              sql`${platformUserIdentities.passwordHash} IS NOT NULL`,
            ),
          )
          .limit(1),
        this.listRolesForUser(u.id),
      ]);
      out.push({
        id: u.id,
        email: u.email,
        status: u.status,
        disabled: u.disabled,
        tokenVersion: u.tokenVersion,
        lastLoginAt: u.lastLoginAt ?? null,
        hasPasswordIdentity: identityCount.length > 0,
        roles,
      });
    }
    return out;
  },
};

