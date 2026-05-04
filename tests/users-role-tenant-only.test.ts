/**
 * users.role tenant-only DB constraint — schema enforcement tests
 * (2026-05-04 Phase 6).
 *
 * Pins the database-level invariant that `users.role` can ONLY hold
 * one of the canonical tenant roles. The CHECK constraint
 * `users_role_tenant_only_chk` was added by
 * `migrations/2026_05_04_users_role_restrict_to_tenant.sql`; this
 * suite proves the constraint is in force AND that every platform
 * role string is rejected at the database boundary.
 *
 * Why a live-DB test (not just SQL inspection):
 *   • The migration's source-level shape is checked by the
 *     `platform-identity-phase-2a` "Phase 5 cleanup" test pack.
 *   • The constraint's RUNTIME effect — actually rejecting a bad
 *     INSERT — only shows up when we hit the database.
 *   • A future commit that drops the constraint via a missed
 *     `DROP CONSTRAINT` (or forgets to apply the migration in a
 *     fresh environment) would silently let platform rows back into
 *     `users`. This test makes that loud.
 *
 * Boundary contract under test:
 *   - INSERT with a TENANT role  → SUCCESS.
 *   - INSERT with a PLATFORM role → FAILS at the SQL layer
 *     (Postgres `23514 check_violation`), error message names the
 *     constraint.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

// ── Imports under test (real DB) ─────────────────────────────────────
import { db } from "../server/db";
import { users, companies } from "@shared/schema";
import { TENANT_ROLES, PLATFORM_ROLES } from "../server/auth/roles";

// Use a stable test-only company id so we can clean up afterwards.
// Real UUID format so the `companies.id` varchar column accepts it.
const TEST_COMPANY_ID = "00000000-0000-0000-0000-0000000beef0";
const TEST_EMAIL_PREFIX = "phase6-role-constraint";

beforeAll(async () => {
  // Seed a test company. The constraint test only cares that the
  // FK target exists; it does NOT need realistic data.
  await db
    .insert(companies)
    .values({
      id: TEST_COMPANY_ID,
      name: "Phase6 Role Constraint Test Co",
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Clean every row this suite inserted. CASCADE handles user_identities.
  await db.execute(sql`
    DELETE FROM users WHERE company_id = ${TEST_COMPANY_ID};
  `);
  await db.execute(sql`
    DELETE FROM companies WHERE id = ${TEST_COMPANY_ID};
  `);
});

// ============================================================================
// Tenant role inserts succeed
// ============================================================================

describe("users.role accepts every canonical tenant role", () => {
  for (const role of TENANT_ROLES) {
    it(`accepts role='${role}'`, async () => {
      const email = `${TEST_EMAIL_PREFIX}-tenant-${role}-${Date.now()}@example.test`;
      await expect(
        db.insert(users).values({
          companyId: TEST_COMPANY_ID,
          email,
          password: "x", // legacy NOT NULL — test stub
          role,
          status: "active",
        }),
      ).resolves.not.toThrow();
    });
  }
});

// ============================================================================
// Platform role inserts fail with CHECK violation
// ============================================================================

describe("users.role REJECTS every canonical platform role at the DB boundary", () => {
  for (const role of PLATFORM_ROLES) {
    it(`rejects role='${role}' with check_violation`, async () => {
      const email = `${TEST_EMAIL_PREFIX}-platform-${role}-${Date.now()}@example.test`;

      let thrown: any = null;
      try {
        await db.insert(users).values({
          companyId: TEST_COMPANY_ID,
          email,
          password: "x",
          role,
          status: "active",
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown, `expected INSERT with role=${role} to fail`).not.toBeNull();
      // Postgres error code 23514 = check_violation. Drizzle / pg
      // surface the underlying error with `.code` on most drivers.
      const code = (thrown as any)?.code ?? (thrown as any)?.cause?.code;
      const message = (thrown as Error)?.message ?? "";
      // Either the SQLSTATE or the constraint name in the message
      // confirms the rejection came from the right gate.
      expect(
        code === "23514" || /users_role_tenant_only_chk/.test(message),
        `expected check_violation or named constraint in error; got code=${code} message=${message}`,
      ).toBe(true);
    });
  }
});

// ============================================================================
// UPDATE path is also gated
// ============================================================================

describe("users.role REJECTS UPDATE that would set a platform role", () => {
  it("UPDATE existing tenant user → platform_admin fails with check_violation", async () => {
    const email = `${TEST_EMAIL_PREFIX}-update-${Date.now()}@example.test`;
    // Seed a tenant user.
    const [created] = await db
      .insert(users)
      .values({
        companyId: TEST_COMPANY_ID,
        email,
        password: "x",
        role: "technician",
        status: "active",
      })
      .returning({ id: users.id });

    let thrown: any = null;
    try {
      await db.execute(sql`
        UPDATE users SET role = 'platform_admin' WHERE id = ${created.id}
      `);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    const code = (thrown as any)?.code ?? (thrown as any)?.cause?.code;
    const message = (thrown as Error)?.message ?? "";
    expect(
      code === "23514" || /users_role_tenant_only_chk/.test(message),
    ).toBe(true);
  });
});

// ============================================================================
// Constraint metadata
// ============================================================================

describe("Constraint metadata in pg_constraint", () => {
  it("`users_role_tenant_only_chk` exists on `users` and is VALID", async () => {
    const result = await db.execute(sql`
      SELECT
        c.conname AS name,
        c.convalidated AS validated
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'users'
        AND c.conname = 'users_role_tenant_only_chk'
    `);
    const rows = (result as any).rows ?? result;
    expect(rows.length).toBe(1);
    expect(rows[0].validated).toBe(true);
  });
});
