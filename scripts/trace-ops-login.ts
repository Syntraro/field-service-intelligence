/**
 * Replay the LocalStrategy logic against the LIVE DB for ops@syntraro.com.
 * No HTTP — direct storage/service calls so we see exactly which gate fails.
 */
import bcrypt from "bcryptjs";
import { storage } from "../server/storage/index";

async function main() {
  const email = "ops@syntraro.com";
  const password = process.argv[2];
  if (!password) { console.error("Usage: trace-ops-login <password>"); process.exit(1); }

  const normalized = email.trim().toLowerCase();
  console.log(`Normalized email: '${normalized}' (length ${normalized.length})`);

  const result = await storage.findUserByEmailGlobal(normalized);
  if (!result) {
    console.log("findUserByEmailGlobal → NULL");
    console.log("This is what your UI sees as 'Invalid email or password'.");
    process.exit(2);
  }

  const { user, identity } = result;
  console.log("\nfindUserByEmailGlobal → MATCH");
  console.table([{
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    disabled: user.disabled,
    companyId: user.companyId,
    tokenVersion: user.tokenVersion,
  }]);
  console.table([{
    identityId: identity.id,
    provider: identity.provider,
    identifier: identity.identifier,
    hasPasswordHash: !!identity.passwordHash,
    hashPrefix: identity.passwordHash ? identity.passwordHash.slice(0, 7) : null,
  }]);

  if (!identity.passwordHash) { console.log("GATE FAIL: no passwordHash"); process.exit(3); }
  if (user.disabled) { console.log("GATE FAIL: user.disabled"); process.exit(4); }
  if (user.status === "deactivated") { console.log("GATE FAIL: user.status=deactivated"); process.exit(5); }

  const ok = await bcrypt.compare(password, identity.passwordHash);
  console.log(`\nbcrypt.compare('${password}', <stored hash>) → ${ok}`);
  if (!ok) {
    console.log("GATE FAIL: hash mismatch");
    process.exit(6);
  }

  console.log("\nALL GATES PASS. Passport would call done(null, user) here.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(99); });
