/**
 * Entitlement system QA harness — real DB, no mocks.
 *
 * Exercises the resolver + storage + enforcement layers end-to-end against
 * the live database. Creates a throwaway test plan + test feature + uses
 * a real company for override/usage assertions, then cleans up at the end.
 *
 * Runs independently — no running server required. Imports the service
 * modules directly.
 *
 * Usage: npx tsx scripts/qa-entitlements.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// Dynamic imports: env must be loaded BEFORE server/db.ts evaluates (it
// throws at module init if DATABASE_URL is missing). Plain ESM imports
// would hoist above the env loader and crash.
const pg = (await import("pg")).default;
const { entitlementStorage } = await import("../server/storage/entitlements");
const { entitlementService } = await import("../server/services/entitlementService");
const { assertFeatureAccess, assertFeatureCapacity } = await import("../server/services/entitlementEnforcement");
const { usageMetricsService } = await import("../server/services/usageMetricsService");
const { db } = await import("../server/db");
const { companies, clients, users } = await import("@shared/schema");
const { eq, and, sql } = await import("drizzle-orm");

interface CheckResult { name: string; pass: boolean; detail: string }
const results: CheckResult[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  console.log("\n========== ENTITLEMENT QA SWEEP ==========\n");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // ---------- Pick a real tenant for tests ----------
  const [tenant] = await db.select({ id: companies.id, name: companies.name, plan: companies.subscriptionPlan })
    .from(companies).where(eq(companies.subscriptionStatus, "trial")).limit(1);
  if (!tenant) { console.error("No trial tenant found — abort"); process.exit(1); }
  console.log(`Using tenant: ${tenant.name} (${tenant.id}) plan=${tenant.plan}\n`);

  // Ensure the tenant has a plan assigned (resolver needs it for plan path)
  if (!tenant.plan) {
    await db.update(companies).set({ subscriptionPlan: "trial" }).where(eq(companies.id, tenant.id));
    console.log("  (fixed up: wrote subscriptionPlan='trial')\n");
  }

  // ---------- 1) Catalog baseline ----------
  console.log("[1] Catalog baseline");
  const allFeatures = await entitlementStorage.listFeatures();
  record("feature catalog seeded", allFeatures.length >= 50, `${allFeatures.length} rows`);
  const coreFeatures = allFeatures.filter((f) => f.isCore);
  record("at least 9 core features", coreFeatures.length >= 9, `${coreFeatures.length} core`);
  const dispatchBoard = allFeatures.find((f) => f.featureKey === "dispatch_board");
  record("dispatch_board is core (per spec)", !!dispatchBoard && dispatchBoard.isCore, dispatchBoard ? `isCore=${dispatchBoard.isCore}` : "MISSING");
  record("feature_keys lowercase_snake_case", allFeatures.every((f) => /^[a-z][a-z0-9_]*$/.test(f.featureKey)));
  const plans = await entitlementStorage.listPlans();
  record("plans exist", plans.length >= 1, `${plans.length} plans`);

  // ---------- 2) Create throwaway test feature (non-core, with count limit) ----------
  console.log("\n[2] Feature creation + update + key immutability");
  const testKey = `qa_test_${Date.now()}`;
  const createdFeature = await entitlementStorage.createFeature({
    featureKey: testKey,
    displayName: "QA Test",
    category: "users_team",
    limitType: "count",
    isCore: false,
    active: true,
    sortOrder: 9999,
  });
  record("feature created", !!createdFeature.id);
  const updated = await entitlementStorage.updateFeature(createdFeature.id, { displayName: "QA Test UPDATED" });
  record("feature updated (displayName)", updated?.displayName === "QA Test UPDATED");
  // Immutability: storage.updateFeature does not accept featureKey in patch type.
  // Verify at the DB level that feature_key didn't change:
  const reread = await entitlementStorage.getFeatureById(createdFeature.id);
  record("feature_key immutable after update", reread?.featureKey === testKey);

  // ---------- 3) Plan creation (non-system plan) + plan-feature matrix ----------
  console.log("\n[3] Plan CRUD + plan-feature matrix");
  const testPlanName = `qa_plan_${Date.now()}`;
  const createdPlan = await entitlementStorage.createPlan({
    name: testPlanName,
    displayName: "QA Plan",
    monthlyPriceCents: 0,
    locationLimit: 10,
    active: true,
    sortOrder: 9999,
  });
  record("plan created", !!createdPlan.id);
  // Plan-feature: enable QA test feature with limit=3
  const pf = await entitlementStorage.upsertPlanFeature(createdPlan.id, createdFeature.id, { enabled: true, limitValue: 3 });
  record("plan-feature inserted with limit=3", pf.limitValue === 3 && pf.enabled === true);
  // Upsert again with new limit — idempotent
  const pf2 = await entitlementStorage.upsertPlanFeature(createdPlan.id, createdFeature.id, { enabled: true, limitValue: 5 });
  record("plan-feature upsert updates in place (limit=5)", pf2.limitValue === 5 && pf2.id === pf.id);

  // ---------- 4) Assign test plan to the tenant and resolve ----------
  console.log("\n[4] Resolver precedence");
  await db.update(companies).set({ subscriptionPlan: testPlanName }).where(eq(companies.id, tenant.id));
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const ent1 = await entitlementService.getEntitlement(tenant.id, testKey);
  record("plan-source resolution for QA feature", ent1?.source === "plan" && ent1?.enabled === true && ent1?.limitValue === 5);

  // Core feature resolution
  const coreKey = dispatchBoard?.featureKey ?? "dispatch_board";
  const entCore = await entitlementService.getEntitlement(tenant.id, coreKey);
  record("core feature always enabled, source=core", entCore?.enabled === true && entCore?.source === "core");
  record("core feature isUnlimited when no limit set", entCore?.isUnlimited === true);

  // Default-deny path: a non-core feature with no plan row
  const noPfKey = allFeatures.find((f) => !f.isCore && f.featureKey !== testKey)!.featureKey;
  // Ensure no plan_feature row exists for it on the test plan
  const noPf = await entitlementService.getEntitlement(tenant.id, noPfKey);
  record("default-deny when no plan row exists", noPf?.enabled === false && noPf?.source === "default", `${noPfKey} source=${noPf?.source}`);

  // Override precedence: DISABLE the QA feature via override
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: false, reason: "qa disable" });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const ent2 = await entitlementService.getEntitlement(tenant.id, testKey);
  record("override disables feature (source=override)", ent2?.enabled === false && ent2?.source === "override");

  // Override with limit only (null enabled) — plan's enabled still wins
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: null, limitValue: 99 });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const ent3 = await entitlementService.getEntitlement(tenant.id, testKey);
  record("override with null enabled falls through to plan enabled", ent3?.enabled === true);
  record("override limit wins over plan limit", ent3?.limitValue === 99);

  // Core-feature override disable attempt — resolver must still enable
  await entitlementStorage.upsertOverride(tenant.id, dispatchBoard!.id, { enabled: false, reason: "qa attempt" });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const entCoreDisable = await entitlementService.getEntitlement(tenant.id, coreKey);
  record("core feature stays enabled even with override disable (defense in depth)", entCoreDisable?.enabled === true && entCoreDisable?.source === "core");
  // Cleanup the core override
  await entitlementStorage.deleteOverride(tenant.id, dispatchBoard!.id);

  // ---------- 5) Cache invalidation ----------
  console.log("\n[5] Cache invalidation after writes");
  const before = await entitlementService.getEntitlement(tenant.id, testKey);
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: true, limitValue: 42 });
  // Do NOT invalidate — should still see stale
  const stale = await entitlementService.getEntitlement(tenant.id, testKey);
  record("cache returns stale without explicit invalidation", stale?.limitValue === before?.limitValue);
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const fresh = await entitlementService.getEntitlement(tenant.id, testKey);
  record("cache invalidation picks up new value", fresh?.limitValue === 42);

  // ---------- 6) Enforcement ----------
  console.log("\n[6] Enforcement helpers");
  let accessThrown = false;
  try { await assertFeatureAccess(tenant.id, coreKey); } catch { accessThrown = true; }
  record("assertFeatureAccess allows core", !accessThrown);

  // Disable QA feature via override, then assertFeatureAccess should throw
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: false, reason: "qa" });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  let disabledThrew = false;
  try { await assertFeatureAccess(tenant.id, testKey); } catch (e: any) { disabledThrew = e?.code === "FEATURE_DISABLED"; }
  record("assertFeatureAccess denies disabled with FEATURE_DISABLED", disabledThrew);

  // Re-enable with limit=3, test capacity denial
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: true, limitValue: 3 });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  let capOkThrown = false;
  try { await assertFeatureCapacity(tenant.id, testKey, 2, 1); } catch { capOkThrown = true; }
  record("assertFeatureCapacity allows under cap", !capOkThrown);
  let capDenyThrew = false;
  try { await assertFeatureCapacity(tenant.id, testKey, 3, 1); } catch (e: any) { capDenyThrew = e?.code === "FEATURE_LIMIT_REACHED"; }
  record("assertFeatureCapacity denies at-cap with FEATURE_LIMIT_REACHED", capDenyThrew);

  // 2026-04-20 Bug #1 fix: null limit_value = unlimited via override when
  // limit_overridden is set (caller explicitly provided null limitValue).
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: true, limitValue: null });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const unlimitedEnt = await entitlementService.getEntitlement(tenant.id, testKey);
  record("override explicit null limit → isUnlimited", unlimitedEnt?.isUnlimited === true && unlimitedEnt?.limitValue === null);
  let unlimitedOk = false;
  try { await assertFeatureCapacity(tenant.id, testKey, 9999, 1); unlimitedOk = true; } catch { unlimitedOk = false; }
  record("null limit_value = unlimited (no denial)", unlimitedOk);

  // Inverse: omit limitValue entirely → limit_overridden=false → inherit plan limit
  await entitlementStorage.upsertOverride(tenant.id, createdFeature.id, { enabled: true });
  entitlementService.invalidateEntitlementsCache(tenant.id);
  const inheritEnt = await entitlementService.getEntitlement(tenant.id, testKey);
  record("override without limitValue inherits plan limit (=5)", inheritEnt?.limitValue === 5 && inheritEnt?.isUnlimited === false);

  // ---------- 7) Usage counters ----------
  console.log("\n[7] Usage counter accuracy");
  // Reference-count directly
  const [refLoc] = await db.select({ c: sql<number>`count(*)::int` }).from(clients).where(and(eq(clients.companyId, tenant.id), eq(clients.inactive, false)));
  const [refOffice] = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.companyId, tenant.id), eq(users.status, "active"), sql`${users.role} IN ('owner','manager','dispatcher','office')`));
  const [refTech] = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.companyId, tenant.id), eq(users.status, "active"), eq(users.role, "technician")));
  const [refTotal] = await db.select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.companyId, tenant.id), eq(users.status, "active")));

  const usage = await usageMetricsService.getUsageSummary(tenant.id);
  record("usage.clients matches reference", usage.clients === refLoc.c, `${usage.clients} vs ${refLoc.c}`);
  record("usage.locations === usage.clients", usage.locations === usage.clients);
  record("usage.office_users matches reference", usage.office_users === refOffice.c, `${usage.office_users} vs ${refOffice.c}`);
  record("usage.technician_users matches reference", usage.technician_users === refTech.c, `${usage.technician_users} vs ${refTech.c}`);
  record("usage.total_users matches reference", usage.total_users === refTotal.c, `${usage.total_users} vs ${refTotal.c}`);
  record("usage.total_users >= office+tech (active includes other roles)", usage.total_users >= usage.office_users + usage.technician_users);

  // ---------- 8) Tenant isolation ----------
  console.log("\n[8] Tenant isolation");
  const [otherTenant] = await db.select({ id: companies.id }).from(companies).where(sql`${companies.id} <> ${tenant.id}`).limit(1);
  if (otherTenant) {
    const myOverrides = await entitlementStorage.listOverrides(tenant.id);
    const otherOverrides = await entitlementStorage.listOverrides(otherTenant.id);
    const overlap = myOverrides.filter((o) => otherOverrides.some((x) => x.id === o.id));
    record("listOverrides scoped by company_id (no overlap)", overlap.length === 0);
    // Resolver returns entitlements for its OWN company only
    const mine = await entitlementService.getTenantEntitlements(tenant.id);
    const theirs = await entitlementService.getTenantEntitlements(otherTenant.id);
    record("resolver returns tenant-specific companyId", mine.companyId === tenant.id && theirs.companyId === otherTenant.id);
  } else {
    record("tenant isolation test skipped (only one tenant in DB)", true, "skipped");
  }

  // ---------- 8b) Tenant precheck (P2) ----------
  // Verify that upsertOverride at the STORAGE layer still succeeds with a
  // real tenantId; the 404 precheck lives at the route layer in
  // server/routes/platformEntitlements.ts (assertTenantExists). We exercise
  // the storage-layer FK behavior as a contract assertion.
  console.log("\n[8b] Tenant precheck / FK safety");
  let fkRejected = false;
  try {
    await entitlementStorage.upsertOverride(
      "00000000-0000-0000-0000-000000000000",
      createdFeature.id,
      { enabled: true },
    );
  } catch (e: any) {
    fkRejected = (e?.code === "23503") || /foreign key/i.test(e?.message ?? "");
  }
  record("storage upsert against nonexistent tenant rejected by FK (route returns 404)", fkRejected);

  // ---------- 9) Cleanup ----------
  console.log("\n[9] Cleanup");
  // Remove override on QA feature
  await entitlementStorage.deleteOverride(tenant.id, createdFeature.id);
  // Restore tenant's plan
  await db.update(companies).set({ subscriptionPlan: tenant.plan ?? "trial" }).where(eq(companies.id, tenant.id));
  // Delete test plan_feature row
  await client.query("DELETE FROM subscription_plan_features WHERE plan_id = $1", [createdPlan.id]);
  // Delete test plan
  await client.query("DELETE FROM subscription_plans WHERE id = $1", [createdPlan.id]);
  // Delete test feature
  await client.query("DELETE FROM subscription_features WHERE id = $1", [createdFeature.id]);
  record("cleanup successful", true, "throwaway plan + feature + override removed");

  await client.end();

  // ---------- Summary ----------
  console.log("\n========== SUMMARY ==========");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${results.length}\n`);
  if (fail > 0) {
    console.log("FAILURES:");
    for (const r of results.filter((x) => !x.pass)) console.log(`  - ${r.name}${r.detail ? " (" + r.detail + ")" : ""}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("QA HARNESS ERROR:", e); process.exit(2); });
