/**
 * Platform Identity Phase 2-A — boundary + cutover tests (2026-05-04).
 *
 * Pins the contract that platform identity is now stored in the
 * dedicated `platform_users` / `platform_user_identities` /
 * `platform_user_roles` tables, with a Phase 3.5 fallback to the
 * legacy `users` row during the deployment window.
 *
 * Tests are source-level + repository-shape (no DB round-trip) so
 * the suite runs fast and isolated. Real-DB integration coverage
 * is provided by the audit script run + the existing
 * `platform-tenant-containment` tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const platformAuthSrc = readFileSync(
  resolve(__dirname, "../server/routes/platformAuth.ts"),
  "utf-8",
);
const platformSessionSrc = readFileSync(
  resolve(__dirname, "../server/auth/platformSession.ts"),
  "utf-8",
);
const platformResetSrc = readFileSync(
  resolve(__dirname, "../server/services/platformPasswordResetService.ts"),
  "utf-8",
);
const seedSrc = readFileSync(
  resolve(__dirname, "../server/scripts/seedPlatformUser.ts"),
  "utf-8",
);
const auditSrc = readFileSync(
  resolve(__dirname, "../server/scripts/auditPlatformUsers.ts"),
  "utf-8",
);
const repoSrc = readFileSync(
  resolve(__dirname, "../server/storage/platformIdentity.ts"),
  "utf-8",
);
const schemaSrc = readFileSync(
  resolve(__dirname, "../shared/schema.ts"),
  "utf-8",
);

// ============================================================================
// 1. Platform login uses platform_users first, legacy fallback second
// ============================================================================

describe("Platform login resolves identity via platform_users (Phase 5: no fallback)", () => {
  it("imports platformIdentityRepository", () => {
    expect(platformAuthSrc).toMatch(
      /from\s+["']\.\.\/storage\/platformIdentity["']/,
    );
  });

  it("login route calls findPlatformUserByEmail (canonical and only path)", () => {
    expect(platformAuthSrc).toContain(
      "platformIdentityRepository.findPlatformUserByEmail(normalizedEmail)",
    );
  });

  it("legacy users fallback is GONE — no findUserByEmailGlobal in the login route", () => {
    // Phase 5 removed the deployment-window fallback. A regression
    // that re-introduces it (or imports `storage` to do a tenant-side
    // lookup at login) must fail this test.
    expect(platformAuthSrc).not.toContain("findUserByEmailGlobal");
    expect(platformAuthSrc).not.toContain('from "../storage/index"');
  });

  it("audit no longer emits identitySource in payloads (single canonical surface)", () => {
    // The Phase 2-A `identitySource: "platform_users" | "legacy_users"`
    // field is removed from the audit details payload in Phase 5 —
    // there is only one source now. We pin the absence of any
    // emitting expression (the literal `identitySource:` shape used
    // when constructing the details object). The retired field name
    // may still appear in explanatory comments — those are fine.
    expect(platformAuthSrc).not.toMatch(/identitySource\s*:/);
  });

  it("rejects accounts with zero roles (defense-in-depth)", () => {
    expect(platformAuthSrc).toContain('details: { reason: "no_roles" }');
  });
});

// ============================================================================
// 2. Tenant login cannot access platform users
// ============================================================================

describe("Tenant login surface is independent of platform_users", () => {
  it("server/routes/auth.ts does not import platformIdentityRepository", () => {
    const tenantAuthSrc = readFileSync(
      resolve(__dirname, "../server/routes/auth.ts"),
      "utf-8",
    );
    // Cross-table contamination guard: tenant login must NEVER reach
    // into the platform identity repository. If a future commit adds
    // such an import, this test fails.
    expect(tenantAuthSrc).not.toContain("platformIdentityRepository");
    expect(tenantAuthSrc).not.toContain('from "../storage/platformIdentity"');
  });
});

// ============================================================================
// 3. requirePlatformSession reads the new repo
// ============================================================================

describe("requirePlatformSession resolves via platform_users (Phase 5: no fallback)", () => {
  it("imports platformIdentityRepository", () => {
    expect(platformSessionSrc).toMatch(
      /from\s+["']\.\.\/storage\/platformIdentity["']/,
    );
  });

  it("legacy storage.getUser fallback is GONE", () => {
    expect(platformSessionSrc).not.toContain("storage.getUser(ps.platformUserId)");
    // The whole `storage` import should also be gone since the only
    // consumer was the fallback branch.
    expect(platformSessionSrc).not.toMatch(
      /^import\s*\{\s*storage\s*\}\s+from\s+["']\.\.\/storage\/index["']/m,
    );
  });

  it("preserves token-version invalidation contract", () => {
    expect(platformSessionSrc).toContain(
      'res.status(401).json({ error: "Session expired", code: "PLATFORM_TOKEN_VERSION_STALE" })',
    );
  });

  it("returns 401 PLATFORM_USER_MISSING when platform_users has no matching row", () => {
    // After Phase 5 removed the fallback, an unresolvable session is
    // a hard 401 — no second-chance lookup against tenant `users`.
    expect(platformSessionSrc).toContain('"PLATFORM_USER_MISSING"');
  });
});

// ============================================================================
// 4. Reset tokens FK now points at platform_users
// ============================================================================

describe("platform_password_reset_tokens FK retargeting migration", () => {
  it("repoint migration exists and references platform_users(id)", () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        "../migrations/2026_05_04_platform_password_reset_tokens_repoint.sql",
      ),
      "utf-8",
    );
    expect(migration).toContain('REFERENCES "platform_users"("id")');
    // Must drop the old FK first (inside the DO $$ block) before
    // adding the new one.
    expect(migration).toContain("DROP CONSTRAINT");
    expect(migration).toMatch(/ALTER TABLE\s+"platform_password_reset_tokens"\s+ADD CONSTRAINT/);
  });
});

// ============================================================================
// 5. Reset confirm writes to platform_user_identities (not legacy users)
// ============================================================================

describe("Platform reset confirm targets the new identity table", () => {
  it("imports platformIdentityRepository", () => {
    expect(platformResetSrc).toMatch(
      /from\s+["']\.\.\/storage\/platformIdentity["']/,
    );
  });

  it("calls setPlatformPasswordHash on the canonical write surface", () => {
    expect(platformResetSrc).toContain(
      "platformIdentityRepository.setPlatformPasswordHash(resolvedUserId, passwordHash)",
    );
  });

  it("legacy user_identities write surface is GONE entirely (Phase 5)", () => {
    // The lazy import of `user_identities` and the `writeSurface ===
    // "legacy"` branch are removed in Phase 5. The reset confirm now
    // writes EXCLUSIVELY through `setPlatformPasswordHash`.
    expect(platformResetSrc).not.toMatch(/^import\s*\{[^}]*userIdentities[^}]*\}\s+from\s+["']@shared\/schema["']/m);
    expect(platformResetSrc).not.toContain('await import("@shared/schema")');
    expect(platformResetSrc).not.toContain('writeSurface');
  });

  it("dropped the legacy users.password mirror write entirely", () => {
    // The 2026-05-03 confirmPlatformPasswordReset mirrored the new
    // hash into `users.password`. Phase 2-A removes that — no caller
    // reads users.password for platform login, and the new
    // platform_users table has no such column.
    expect(platformResetSrc).not.toMatch(/db\s*\.\s*update\s*\(\s*users\s*\)/);
  });

  it("tokenVersion bump uses platformIdentity helper on the new surface", () => {
    expect(platformResetSrc).toContain(
      "platformIdentityRepository.incrementPlatformTokenVersion(resolvedUserId)",
    );
  });
});

// ============================================================================
// 6. Seed script writes ONLY to platform tables (no users / user_identities)
// ============================================================================

describe("seedPlatformUser writes only to platform tables", () => {
  it("imports platformIdentityRepository (and uses it)", () => {
    expect(seedSrc).toContain('await import("../storage/platformIdentity")');
    expect(seedSrc).toContain(
      "platformIdentityRepository.findPlatformUserByEmail",
    );
    expect(seedSrc).toContain("platformIdentityRepository.createPlatformUser");
    expect(seedSrc).toContain(
      "platformIdentityRepository.reconcilePlatformUser",
    );
  });

  it("does NOT import the tenant users / user_identities tables", () => {
    // Functional contract — comments may reference companyId historically
    // ("we removed it"), but no IMPORT or DB call should pull in the
    // tenant schema or tenant-side FK columns.
    expect(seedSrc).not.toMatch(/await import\(["']@shared\/schema["']\)/);
    expect(seedSrc).not.toMatch(/db\.(insert|update|select)\([^)]*\b(users|userIdentities|companies)\b\)/);
    // No `pickCompanyId` helper — was the "parking FK" kludge.
    expect(seedSrc).not.toContain("pickCompanyId");
    // The flag rejection is now an error, not an option.
    expect(seedSrc).not.toMatch(/flags\["company-id"\]\s*as\s+string/);
  });

  it("rejects --company-id flag with an explicit error", () => {
    expect(seedSrc).toContain("--company-id is no longer accepted");
  });
});

// ============================================================================
// 7. Audit script reads from platform_users
// ============================================================================

describe("auditPlatformUsers script reads from platform_users", () => {
  it("calls platformIdentityRepository.listPlatformUsers", () => {
    expect(auditSrc).toContain("platformIdentityRepository.listPlatformUsers()");
  });

  it("emits a labelled section for legacy rows so backfill parity is verifiable", () => {
    expect(auditSrc).toContain("[users (legacy)]");
    expect(auditSrc).toContain("[platform_users]");
  });
});

// ============================================================================
// 8. platformIdentityRepository contract
// ============================================================================

describe("platformIdentityRepository exposes the canonical surface", () => {
  it("declares every method the auth + reset + seed flows depend on", () => {
    for (const method of [
      "findPlatformUserByEmail",
      "getPlatformUserById",
      "listRolesForUser",
      "createPlatformUser",
      "reconcilePlatformUser",
      "setPlatformPasswordHash",
      "incrementPlatformTokenVersion",
      "recordPlatformLogin",
      "listPlatformUsers",
    ]) {
      expect(repoSrc).toContain(`async ${method}`);
    }
  });

  it("never imports the tenant users / user_identities tables", () => {
    // Phase 2-A boundary contract: this file is the platform identity
    // surface — tenant tables must not be referenced here.
    expect(repoSrc).not.toMatch(/import[\s\S]*?\busers\b[^,}]*from\s+["']@shared\/schema["']/);
    expect(repoSrc).not.toMatch(/userIdentities/);
  });
});

// ============================================================================
// 9. Schema declares the three new tables (Option 1: same email allowed)
// ============================================================================

describe("Drizzle schema declares the three Phase 2-A tables", () => {
  it("platformUsers table has email + status + tokenVersion + soft-delete", () => {
    expect(schemaSrc).toContain('export const platformUsers = pgTable("platform_users"');
    expect(schemaSrc).toMatch(/email:\s*text\("email"\)\.notNull\(\)/);
    expect(schemaSrc).toMatch(/tokenVersion:\s*integer\("token_version"\)/);
    expect(schemaSrc).toMatch(/deletedAt:\s*timestamp\("deleted_at"\)/);
    // No companyId column on platform_users — that's the entire point.
    const tableBlock = schemaSrc.match(
      /export const platformUsers = pgTable[\s\S]+?\}\);/,
    );
    expect(tableBlock).toBeTruthy();
    expect(tableBlock![0]).not.toContain("company_id");
    expect(tableBlock![0]).not.toContain("companyId");
  });

  it("platformUserIdentities references platformUsers.id (NOT users.id)", () => {
    const idBlock = schemaSrc.match(
      /export const platformUserIdentities = pgTable[\s\S]+?\}\);/,
    );
    expect(idBlock).toBeTruthy();
    expect(idBlock![0]).toContain("=> platformUsers.id");
    expect(idBlock![0]).not.toContain("=> users.id");
  });

  it("platformUserRoles references platformUsers.id and is multi-role-ready", () => {
    const rolesBlock = schemaSrc.match(
      /export const platformUserRoles = pgTable[\s\S]+?\}\);/,
    );
    expect(rolesBlock).toBeTruthy();
    expect(rolesBlock![0]).toContain("=> platformUsers.id");
    expect(rolesBlock![0]).toContain('role: text("role")');
  });
});

// ============================================================================
// 10. Containment predicate stays in place (defense-in-depth)
// ============================================================================

describe("Phase 2-A keeps the 2026-05-04 containment predicate as defense-in-depth", () => {
  it("nonPlatformUserPredicate file still exists and is exported", () => {
    const predicateSrc = readFileSync(
      resolve(__dirname, "../server/storage/tenantUserPredicate.ts"),
      "utf-8",
    );
    expect(predicateSrc).toContain("export function nonPlatformUserPredicate");
    expect(predicateSrc).toContain("notInArray(users.role, PLATFORM_ROLES_ARRAY)");
  });

  it("team storage still composes the predicate (does not regress on Phase 2-A)", () => {
    const teamSrc = readFileSync(
      resolve(__dirname, "../server/storage/team.ts"),
      "utf-8",
    );
    expect(teamSrc).toContain("nonPlatformUserPredicate");
  });
});
