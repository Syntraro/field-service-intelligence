/**
 * Platform User Seed (2026-05-04, Phase 2-A).
 *
 * Idempotent CLI for provisioning platform-role accounts. Bootstraps the
 * SaaS-vendor's internal Ops Portal logins (`/platform/login`).
 *
 * Phase 2-A change: writes EXCLUSIVELY into the dedicated platform
 * tables (`platform_users`, `platform_user_identities`,
 * `platform_user_roles`). The legacy `users` / `user_identities`
 * write paths and the `companyId` "parking FK" kludge are GONE —
 * `seedPlatformUser.ts` no longer has any tenant coupling. The
 * deployment-window fallback in the platform login flow still reads
 * legacy rows for previously-seeded admins; new admins live only in
 * the platform tables.
 *
 * USAGE
 *   npx tsx server/scripts/seedPlatformUser.ts \
 *     --email=ops@example.com \
 *     --password="$PLATFORM_BOOTSTRAP_PASSWORD" \
 *     --role=platform_admin
 *
 *   Optional: --force-password   Overwrites password hash on an existing
 *                                user. Without this flag, an existing
 *                                user keeps its current password and
 *                                only the role / status / identity
 *                                presence is reconciled.
 *
 * IDEMPOTENCY
 *   - Email match (in `platform_users`): existing user → role / status
 *     / identity reconciled in-place via
 *     `platformIdentityRepository.reconcilePlatformUser`.
 *   - First-time email: new user + new identity + new role row inserted
 *     in one transaction via `platformIdentityRepository.createPlatformUser`.
 *
 * SECURITY
 *   - Password is never logged. Only email + role appear on stdout.
 *   - bcrypt(12) hash via `bcryptjs`.
 *   - Platform login independently rejects accounts with zero roles
 *     or `disabled` / `deactivated` status.
 */

// Load .env BEFORE any module that imports `db` so DATABASE_URL is set.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const PLATFORM_ROLES = [
  "platform_admin",
  "platform_support",
  "platform_billing",
  "platform_readonly_audit",
] as const;
type PlatformRole = (typeof PLATFORM_ROLES)[number];

interface ParsedArgs {
  email: string;
  password: string;
  role: PlatformRole;
  forcePassword: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) {
      flags[raw.slice(2)] = true;
    } else {
      flags[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }

  const email = String(flags.email ?? "").trim().toLowerCase();
  const password = String(flags.password ?? "");
  const role = String(flags.role ?? "platform_admin") as PlatformRole;
  const forcePassword =
    flags["force-password"] === true || flags["force-password"] === "true";

  if (!email || !email.includes("@")) {
    throw new Error("--email=<address> is required and must contain '@'");
  }
  if (!password) {
    throw new Error(
      "--password=<value> is required (e.g. --password=\"$PLATFORM_BOOTSTRAP_PASSWORD\")",
    );
  }
  if (!(PLATFORM_ROLES as readonly string[]).includes(role)) {
    throw new Error(
      `--role=<value> must be one of ${PLATFORM_ROLES.join(", ")}; got ${role}`,
    );
  }
  // 2026-05-04: removed `--company-id` flag. The dedicated platform_users
  // table has no companyId column — passing one would have no effect.
  if (flags["company-id"] !== undefined) {
    throw new Error(
      "--company-id is no longer accepted. Phase 2-A platform_users has no tenant FK.",
    );
  }
  return { email, password, role, forcePassword };
}

async function main() {
  // Dynamic imports (post env-load) so the `db` module sees DATABASE_URL.
  const { platformIdentityRepository } = await import("../storage/platformIdentity");
  const bcrypt = (await import("bcryptjs")).default;

  const args = parseArgs(process.argv);
  const passwordHash = await bcrypt.hash(args.password, 12);

  // Audit-friendly start log. Password never appears.
  console.log(
    JSON.stringify({
      action: "seedPlatformUser:start",
      email: args.email,
      role: args.role,
      forcePassword: args.forcePassword,
    }),
  );

  // Idempotent path: lookup by email, reconcile if exists, create if not.
  const existing = await platformIdentityRepository.findPlatformUserByEmail(args.email);

  let userId: string;
  let action: "created" | "reconciled";

  if (existing) {
    action = "reconciled";
    userId = existing.user.id;
    await platformIdentityRepository.reconcilePlatformUser({
      userId,
      email: args.email,
      role: args.role,
      passwordHash,
      forcePassword: args.forcePassword,
    });
  } else {
    action = "created";
    const created = await platformIdentityRepository.createPlatformUser({
      email: args.email,
      role: args.role,
      passwordHash,
      // The very first platform user has no granter (chicken-and-egg).
      // Subsequent admin tooling can pass the acting platform admin id.
      grantedByPlatformUserId: null,
    });
    userId = created.id;
  }

  console.log(
    JSON.stringify({
      action: `seedPlatformUser:${action}`,
      email: args.email,
      role: args.role,
      userId,
    }),
  );

  console.log(
    JSON.stringify({
      action: "seedPlatformUser:done",
      email: args.email,
      role: args.role,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(
      "seedPlatformUser FAILED:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
