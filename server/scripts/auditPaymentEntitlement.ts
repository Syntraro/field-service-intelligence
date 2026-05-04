// Read-only diagnostic — 2026-05-03
// Confirms whether the `customer_portal_payments` entitlement is
// enabled for each tenant, and surfaces the safe data path to flip
// it on. Mirrors the existing `verifyItemDedup.ts` pattern.
// Does NOT modify any rows. Safe to delete after the audit.
import pg from "pg";
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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    console.log("\n══════ Tenants in DB ══════\n");
    const tenants = await client.query<{ id: string; name: string; subscription_status: string | null; subscription_plan: string | null }>(`
      SELECT id, name, subscription_status, subscription_plan
        FROM companies
       ORDER BY created_at;
    `);
    for (const t of tenants.rows) {
      console.log(`  ${t.id}  ${t.name}  status=${t.subscription_status ?? "-"}  plan=${t.subscription_plan ?? "-"}`);
    }

    console.log("\n══════ subscription_features (catalog) — customer_portal* ══════\n");
    const features = await client.query<{ id: string; feature_key: string; display_name: string; is_core: boolean }>(`
      SELECT id, feature_key, display_name, is_core
        FROM subscription_features
       WHERE feature_key IN ('customer_portal_payments', 'customer_portal')
       ORDER BY feature_key;
    `);
    for (const f of features.rows) {
      console.log(`  ${f.id}  ${f.feature_key}  display="${f.display_name}"  is_core=${f.is_core}`);
    }

    console.log("\n══════ subscription_plan_features rows for customer_portal* ══════\n");
    const spf = await client.query<{ plan_id: string; feature_id: string; enabled: boolean | null; feature_key: string }>(`
      SELECT spf.plan_id, spf.feature_id, spf.enabled, sf.feature_key
        FROM subscription_plan_features spf
        JOIN subscription_features sf ON sf.id = spf.feature_id
       WHERE sf.feature_key IN ('customer_portal_payments', 'customer_portal')
       ORDER BY spf.plan_id, sf.feature_key;
    `);
    if (spf.rows.length === 0) {
      console.log("  (no subscription_plan_features rows for these keys)");
    } else {
      for (const r of spf.rows) {
        console.log(`  plan=${r.plan_id}  ${r.feature_key}=${r.enabled}`);
      }
    }

    console.log("\n══════ tenant_feature_overrides rows for customer_portal* ══════\n");
    const tfo = await client.query<{ company_id: string; feature_id: string; enabled: boolean | null; reason: string | null; feature_key: string }>(`
      SELECT tfo.company_id, tfo.feature_id, tfo.enabled, tfo.reason, sf.feature_key
        FROM tenant_feature_overrides tfo
        JOIN subscription_features sf ON sf.id = tfo.feature_id
       WHERE sf.feature_key IN ('customer_portal_payments', 'customer_portal')
       ORDER BY tfo.company_id, sf.feature_key;
    `);
    if (tfo.rows.length === 0) {
      console.log("  (no tenant_feature_overrides rows for these keys)");
    } else {
      for (const r of tfo.rows) {
        console.log(`  ${r.company_id}  ${r.feature_key}=${r.enabled}  reason=${r.reason ?? "-"}`);
      }
    }

    console.log("\n══════ subscription_plans inventory ══════\n");
    const plans = await client.query<{ id: string; name: string }>(`
      SELECT id, name FROM subscription_plans ORDER BY id;
    `);
    for (const p of plans.rows) {
      console.log(`  ${p.id}  ${p.name}`);
    }

    console.log("\n══════ Resolver simulation per tenant ══════");
    console.log("(Mirrors entitlementService precedence: is_core → tenant_override → plan_feature → deny)\n");
    const cppFeature = features.rows.find((f) => f.feature_key === "customer_portal_payments");
    for (const t of tenants.rows) {
      let resolvedEnabled = false;
      let source = "deny (default)";

      if (cppFeature) {
        if (cppFeature.is_core) {
          resolvedEnabled = true;
          source = "is_core (always enabled)";
        } else {
          // Plan lookup
          const planRow = t.subscription_plan
            ? plans.rows.find((p) => p.name === t.subscription_plan)
            : undefined;
          const planId = planRow?.id ?? null;

          // Override
          const ovr = await client.query<{ enabled: boolean | null; reason: string | null }>(`
            SELECT enabled, reason
              FROM tenant_feature_overrides
             WHERE company_id = $1 AND feature_id = $2
             LIMIT 1;
          `, [t.id, cppFeature.id]);
          if (ovr.rows.length > 0 && ovr.rows[0].enabled !== null) {
            resolvedEnabled = !!ovr.rows[0].enabled;
            source = `tenant_override (reason=${ovr.rows[0].reason ?? "-"})`;
          } else if (planId) {
            const planFeat = await client.query<{ enabled: boolean | null }>(`
              SELECT enabled
                FROM subscription_plan_features
               WHERE plan_id = $1 AND feature_id = $2
               LIMIT 1;
            `, [planId, cppFeature.id]);
            if (planFeat.rows.length > 0 && planFeat.rows[0].enabled !== null) {
              resolvedEnabled = !!planFeat.rows[0].enabled;
              source = `plan_feature (plan=${t.subscription_plan})`;
            }
          }
        }
      } else {
        source = "feature not in catalog";
      }
      console.log(`  ${t.id}  ${t.name}`);
      console.log(`    customer_portal_payments → enabled=${resolvedEnabled}  source=${source}`);
    }

    console.log("\n══════ How to enable for a specific tenant (advisory SQL — DO NOT run blindly) ══════\n");
    if (cppFeature) {
      console.log("  -- Per-tenant override (preferred for one-off / test tenants):");
      console.log("  INSERT INTO tenant_feature_overrides (company_id, feature_id, enabled, reason)");
      console.log(`  VALUES ('<tenant-uuid>', '${cppFeature.id}', true, 'enable Stripe sandbox testing')`);
      console.log("  ON CONFLICT (company_id, feature_id)");
      console.log("    DO UPDATE SET enabled = true, reason = excluded.reason;");
      console.log("");
      console.log("  -- Or, enable on a subscription plan (affects every tenant on that plan):");
      console.log("  INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)");
      console.log(`  VALUES ('<plan-id>', '${cppFeature.id}', true)`);
      console.log("  ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true;");
    } else {
      console.log("  customer_portal_payments is NOT in the subscription_features catalog yet.");
      console.log("  This feature key would need to be inserted into subscription_features first;");
      console.log("  this is a platform-admin operation, not a per-tenant one.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("auditPaymentEntitlement failed:", err);
  process.exit(1);
});
