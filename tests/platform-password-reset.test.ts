/**
 * Platform Password Reset — service-level tests (2026-05-03).
 *
 * Covers the new `/api/platform/auth/{request-reset,reset-password}`
 * surface backed by `server/services/platformPasswordResetService.ts`
 * and the dedicated `platform_password_reset_tokens` table.
 *
 * Key invariants under test:
 *   1. `requestPlatformPasswordReset` is a silent no-op for unknown
 *      emails AND for tenant-role emails. Only platform-role users
 *      get a token row inserted. Response shape never reveals which
 *      branch was taken.
 *   2. `confirmPlatformPasswordReset` rejects unknown / used /
 *      expired tokens with the same `invalid_token` error (no
 *      enumeration distinction).
 *   3. `confirmPlatformPasswordReset` rejects passwords < 8 chars
 *      as `weak_password`.
 *   4. A user demoted from a platform role between request and
 *      confirm is refused at confirm time with `non_platform_role`.
 *   5. Successful confirm bumps `users.token_version` so every
 *      existing platform session is invalidated.
 *
 * Implementation note: Resend (`getResendClient`) is mocked so no
 * real network calls fire. The DB layer is mocked module-by-module
 * because the service hits Drizzle directly — we don't want a real
 * DB round-trip in these tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ─────────────────────────────────────

// Capture inserted/updated rows so the assertions can read them back.
const insertedTokens: any[] = [];
const updatedTokens: any[] = [];
const updatedIdentities: any[] = [];
const updatedUsers: any[] = [];
let stubTokenRow: any = null;

vi.mock("../server/db", () => {
  // The service uses fluent Drizzle calls. We model the minimum
  // surface needed:
  //   db.insert(table).values(rows)
  //   db.update(table).set(values).where(cond)
  //   db.select({...}).from(table).where(cond).limit(n) → array
  // The "where" clauses are opaque here — we don't need to inspect
  // them; the service's correctness on which row to update is
  // covered by the integration tests that hit a real DB. These
  // unit tests verify the BEHAVIOR (which paths run, what they
  // emit) on top of a stubbed backend.
  const db = {
    insert: (table: any) => ({
      values: async (rows: any) => {
        insertedTokens.push({ table, rows });
        return [];
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          // Route to the right capture bucket by table identity.
          // The service module has imported the table refs by name
          // so we discriminate via the table object reference.
          const name = table?.[Symbol.for("drizzle:Name")] || "unknown";
          if (name === "platform_password_reset_tokens") {
            updatedTokens.push({ values });
          } else if (name === "user_identities") {
            updatedIdentities.push({ values });
          } else if (name === "users") {
            updatedUsers.push({ values });
          }
          return [];
        },
      }),
    }),
    select: (_cols: any) => ({
      from: (_table: any) => ({
        where: (_cond: any) => ({
          limit: async (_n: number) => (stubTokenRow ? [stubTokenRow] : []),
        }),
      }),
    }),
  };
  return { db };
});

vi.mock("../server/storage/index", () => ({
  storage: {
    findUserByEmailGlobal: vi.fn(),
    getUser: vi.fn(),
    incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

// 2026-05-04 Phase 2-A: platform reset reads identity from the new
// `platformIdentityRepository` first, falling back to the legacy
// `storage` lookup (Phase 3.5). Mock both surfaces so tests can drive
// either code path explicitly.
vi.mock("../server/storage/platformIdentity", () => ({
  platformIdentityRepository: {
    findPlatformUserByEmail: vi.fn(),
    getPlatformUserById: vi.fn(),
    setPlatformPasswordHash: vi.fn().mockResolvedValue(undefined),
    incrementPlatformTokenVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/resendClient", () => ({
  getResendClient: vi.fn().mockResolvedValue({
    client: { emails: { send: vi.fn().mockResolvedValue({ data: { id: "test-msg" } }) } },
    fromEmail: "ops@example.com",
  }),
}));

// ── Imports under test (after mocks) ──────────────────────────────
import {
  requestPlatformPasswordReset,
  confirmPlatformPasswordReset,
} from "../server/services/platformPasswordResetService";
import { storage } from "../server/storage/index";
import { platformIdentityRepository } from "../server/storage/platformIdentity";
import { hashResetToken } from "../server/auth/passwordUtils";

beforeEach(() => {
  vi.clearAllMocks();
  insertedTokens.length = 0;
  updatedTokens.length = 0;
  updatedIdentities.length = 0;
  updatedUsers.length = 0;
  stubTokenRow = null;
  process.env.APP_BASE_URL = "https://app.example.test";
});

// ============================================================================
// requestPlatformPasswordReset
// ============================================================================

describe("requestPlatformPasswordReset", () => {
  it("returns silent noop for unknown email — no token inserted", async () => {
    // Phase 2-A: BOTH the new repo and the legacy fallback return null.
    (platformIdentityRepository.findPlatformUserByEmail as any).mockResolvedValueOnce(null);
    (storage.findUserByEmailGlobal as any).mockResolvedValueOnce(null);

    const result = await requestPlatformPasswordReset({
      email: "ghost@example.com",
      requestIp: "1.2.3.4",
      requestOrigin: "https://app.example.test",
    });

    expect(result.delivered).toBe(false);
    expect(result.userId).toBeNull();
    expect(insertedTokens).toHaveLength(0);
  });

  it("returns silent noop for tenant-role email — no token inserted", async () => {
    // New repo doesn't know this user; legacy fallback finds them but
    // their role is tenant-only. Same silent-noop response shape.
    (platformIdentityRepository.findPlatformUserByEmail as any).mockResolvedValueOnce(null);
    (storage.findUserByEmailGlobal as any).mockResolvedValueOnce({
      user: {
        id: "tenant-user-1",
        email: "tenant@example.com",
        role: "owner", // tenant role
        firstName: "Sam",
      },
      identity: {},
    });

    const result = await requestPlatformPasswordReset({
      email: "tenant@example.com",
      requestIp: null,
      requestOrigin: null,
    });

    expect(result.delivered).toBe(false);
    expect(result.userId).toBeNull();
    expect(insertedTokens).toHaveLength(0);
  });

  it("inserts a token for a platform-role email (canonical Phase 2-A path)", async () => {
    // Phase 2-A canonical path: new repo finds the platform user;
    // legacy fallback is never consulted.
    (platformIdentityRepository.findPlatformUserByEmail as any).mockResolvedValueOnce({
      user: {
        id: "platform-user-1",
        email: "ops@example.com",
        firstName: "Ops",
      },
      identity: { passwordHash: "x" },
      roles: ["platform_admin"],
    });

    const result = await requestPlatformPasswordReset({
      email: "ops@example.com",
      requestIp: "1.2.3.4",
      requestOrigin: "https://app.example.test",
    });

    expect(result.userId).toBe("platform-user-1");
    expect(insertedTokens).toHaveLength(1);
    const inserted = insertedTokens[0].rows;
    expect(typeof inserted.tokenHash).toBe("string");
    expect(inserted.tokenHash.length).toBeGreaterThan(20);
    expect(inserted.userId).toBe("platform-user-1");
    // Legacy fallback was NOT consulted on the canonical path.
    expect(storage.findUserByEmailGlobal).not.toHaveBeenCalled();
  });

  it("falls back to legacy users table when new repo returns null (Phase 3.5)", async () => {
    // Mirrors a deployment-window scenario where a previously-seeded
    // platform admin still lives in `users` and has not yet been
    // backfilled into `platform_users`. The reset flow must still
    // function — emit a token, send an email — until cleanup runs.
    (platformIdentityRepository.findPlatformUserByEmail as any).mockResolvedValueOnce(null);
    (storage.findUserByEmailGlobal as any).mockResolvedValueOnce({
      user: {
        id: "legacy-platform-user",
        email: "legacy@example.com",
        role: "platform_admin",
        firstName: "Legacy",
      },
      identity: {},
    });

    const result = await requestPlatformPasswordReset({
      email: "legacy@example.com",
      requestIp: null,
      requestOrigin: null,
    });

    expect(result.userId).toBe("legacy-platform-user");
    expect(insertedTokens).toHaveLength(1);
  });
});

// ============================================================================
// confirmPlatformPasswordReset
// ============================================================================

describe("confirmPlatformPasswordReset", () => {
  it("rejects empty token with invalid_token", async () => {
    const result = await confirmPlatformPasswordReset({
      rawToken: "",
      newPassword: "longenoughpw",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_token");
  });

  it("rejects short password with weak_password", async () => {
    const result = await confirmPlatformPasswordReset({
      rawToken: "something",
      newPassword: "short",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("weak_password");
  });

  it("rejects unknown token (no row matching the hash)", async () => {
    stubTokenRow = null;
    const result = await confirmPlatformPasswordReset({
      rawToken: "doesnotexist",
      newPassword: "longenoughpw",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_token");
  });

  it("rejects already-used token", async () => {
    stubTokenRow = {
      id: "tok-1",
      userId: "platform-user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(Date.now() - 1000), // already used
    };
    const result = await confirmPlatformPasswordReset({
      rawToken: "anyvalue",
      newPassword: "longenoughpw",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_token");
  });

  it("rejects expired token", async () => {
    stubTokenRow = {
      id: "tok-1",
      userId: "platform-user-1",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
    };
    const result = await confirmPlatformPasswordReset({
      rawToken: "anyvalue",
      newPassword: "longenoughpw",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_token");
  });

  it("rejects when user has been demoted to a non-platform role", async () => {
    // Phase 2-A: new repo doesn't find them (platform_users row was
    // never created OR was deleted post-demotion); legacy fallback
    // finds a tenant-role user. Same `non_platform_role` rejection.
    stubTokenRow = {
      id: "tok-1",
      userId: "demoted-user",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    (platformIdentityRepository.getPlatformUserById as any).mockResolvedValueOnce(null);
    (storage.getUser as any).mockResolvedValueOnce({
      id: "demoted-user",
      role: "owner", // tenant role — was platform_admin at request time
    });

    const result = await confirmPlatformPasswordReset({
      rawToken: "anyvalue",
      newPassword: "longenoughpw",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("non_platform_role");
  });

  it("succeeds for a valid platform-role token (Phase 2-A canonical path)", async () => {
    stubTokenRow = {
      id: "tok-1",
      userId: "platform-user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    // Canonical Phase 2-A path: platform_users row exists.
    (platformIdentityRepository.getPlatformUserById as any).mockResolvedValueOnce({
      user: { id: "platform-user-1", email: "ops@example.com" },
      roles: ["platform_admin"],
    });

    const result = await confirmPlatformPasswordReset({
      rawToken: "anyvalue",
      newPassword: "longenoughpw",
    });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe("platform-user-1");
    // Canonical write surface: setPlatformPasswordHash on the new repo.
    expect(platformIdentityRepository.setPlatformPasswordHash).toHaveBeenCalledWith(
      "platform-user-1",
      expect.any(String),
    );
    // The legacy `users.password` mirror is GONE in Phase 2-A — the
    // tenant write bucket should be empty.
    expect(updatedUsers.length).toBe(0);
    // Token marked used (the service does two updates — the matched
    // row + a sweep against any other active rows for the user).
    expect(updatedTokens.length).toBeGreaterThanOrEqual(1);
    // Sessions invalidated via the platform tokenVersion bump (NOT
    // the legacy storage.incrementTokenVersion).
    expect(
      platformIdentityRepository.incrementPlatformTokenVersion,
    ).toHaveBeenCalledWith("platform-user-1");
    expect(storage.incrementTokenVersion).not.toHaveBeenCalled();
  });

  it("succeeds via legacy fallback when no platform_users row exists yet (Phase 3.5)", async () => {
    stubTokenRow = {
      id: "tok-2",
      userId: "legacy-platform-user",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    // New repo returns null → legacy fallback runs.
    (platformIdentityRepository.getPlatformUserById as any).mockResolvedValueOnce(null);
    (storage.getUser as any).mockResolvedValueOnce({
      id: "legacy-platform-user",
      role: "platform_admin",
    });

    const result = await confirmPlatformPasswordReset({
      rawToken: "anyvalue",
      newPassword: "longenoughpw",
    });

    expect(result.ok).toBe(true);
    expect(result.userId).toBe("legacy-platform-user");
    // Legacy fallback wrote to user_identities (captured by the db mock).
    expect(updatedIdentities.length).toBeGreaterThan(0);
    // Legacy tokenVersion bump.
    expect(storage.incrementTokenVersion).toHaveBeenCalledWith(
      "legacy-platform-user",
    );
  });
});

// ============================================================================
// Tenant↔Platform token isolation contract
// ============================================================================

describe("tenant ↔ platform token table isolation", () => {
  it("hashResetToken is deterministic — same raw token always produces the same hash", () => {
    // The two flows hash with the same primitive but persist into
    // DIFFERENT TABLES. A token issued by the platform flow lives only
    // in `platform_password_reset_tokens`; the tenant confirm endpoint
    // queries `password_reset_tokens` and finds nothing. The reverse
    // is also true. This is the data-layer enforcement of the
    // separate-purpose contract documented in the migration.
    const hash1 = hashResetToken("abc123");
    const hash2 = hashResetToken("abc123");
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBeGreaterThan(20);
  });
});
