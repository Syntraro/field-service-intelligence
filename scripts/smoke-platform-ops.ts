/**
 * Real-world smoke audit of Platform Ops — runs the same service methods
 * each screen uses, against the live DB, and prints what would render.
 */
import { platformTenantsService } from "../server/services/platformTenantsService";
import { platformFeedbackService } from "../server/services/platformFeedbackService";
import { platformIssuesService } from "../server/services/platformIssuesService";
import { supportSessionService } from "../server/services/supportSessionService";
import { db } from "../server/db";
import { companies, users, feedback, issueReports } from "../shared/schema";
import { eq, sql } from "drizzle-orm";

async function section(title: string, fn: () => Promise<void>) {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("  " + title);
  console.log("────────────────────────────────────────────────────────────────");
  try { await fn(); } catch (e: any) { console.error("FAILED:", e.message); }
}

async function main() {
  await section("TENANT LIST (GET /api/platform/tenants)", async () => {
    const r = await platformTenantsService.searchTenants({});
    console.log(`total=${r.total}, rows=${r.rows.length}, limit=${r.limit}, offset=${r.offset}`);
    console.table(r.rows);
  });

  await section("TENANT LIST — internal company hidden by default", async () => {
    const r = await platformTenantsService.searchTenants({});
    const hasInternal = r.rows.find((x) => x.name?.toLowerCase().includes("internal"));
    console.log(hasInternal ? "LEAK: internal company appears in default list" : "OK: internal company excluded from default list");
  });

  await section("TENANT LIST — ?status=internal escape hatch", async () => {
    const r = await platformTenantsService.searchTenants({ status: "internal" });
    console.log(`status=internal → ${r.rows.length} rows:`);
    console.table(r.rows);
  });

  await section("TENANT DETAIL (GET /api/platform/tenants/:id)", async () => {
    const [anyReal] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(sql`${companies.subscriptionStatus} != 'internal'`)
      .limit(1);
    if (!anyReal) { console.log("no real tenants"); return; }

    const d = await platformTenantsService.getTenantDetail(anyReal.id);
    if (!d) { console.log("null"); return; }

    console.log("company block:");
    console.table([d.tenant.company]);
    console.log("owner block:");
    console.table([d.tenant.owner]);
    console.log("users block:");
    console.table([d.tenant.users]);
    console.log("qbo block:");
    console.table([d.tenant.qbo]);
    console.log("recentSupportAt:", d.recentSupportAt);
    console.log("features keys:", Object.keys(d.features));

    // UI display hierarchy check
    const displayName = d.tenant.company.displayName || d.tenant.company.name || "—";
    const o = d.tenant.owner;
    const contactName = o?.fullName?.trim()
      || [o?.firstName, o?.lastName].filter(Boolean).join(" ").trim()
      || o?.email
      || "—";
    console.log(`\nWhat the ops page would render:`);
    console.log(`  Tenant name:     ${displayName}`);
    console.log(`  Primary contact: ${contactName}`);
    console.log(`  Contact email:   ${o?.email ?? "—"}`);
    console.log(`  Created:         ${d.tenant.company.createdAt?.toISOString() ?? "INVALID"}`);
    console.log(`  Subscription:    ${d.tenant.company.subscriptionStatus}`);
    console.log(`  Plan:            ${d.tenant.company.subscriptionPlan ?? "—"}`);
  });

  await section("FEEDBACK LIST (GET /api/platform/feedback)", async () => {
    const r = await platformFeedbackService.list({});
    console.log(`total=${r.total}, rows shown=${r.rows.length}`);
    const firstFew = r.rows.slice(0, 5).map((x) => ({
      id: x.id.slice(0, 8),
      tenant: x.companyId.slice(0, 8),
      email: x.userEmail,
      category: x.category,
      status: x.status,
      assignedTo: x.assignedTo,
      msgPreview: x.message?.slice(0, 40),
    }));
    console.table(firstFew);
  });

  await section("ISSUES LIST (GET /api/platform/issues)", async () => {
    const r = await platformIssuesService.list({});
    console.log(`total=${r.total}, rows shown=${r.rows.length}`);
    const firstFew = r.rows.slice(0, 5).map((x) => ({
      id: x.id.slice(0, 8),
      tenantId: x.tenantId?.slice(0, 8) ?? null,
      title: x.title,
      severity: x.severity,
      status: x.status,
      assignedTo: x.assignedTo,
    }));
    console.table(firstFew);
  });

  await section("SUPPORT SESSIONS LIST (GET /api/platform/support-sessions)", async () => {
    const r = await supportSessionService.list({});
    console.log(`total=${r.total}, rows shown=${r.rows.length}`);
    const firstFew = r.rows.slice(0, 5).map((x) => ({
      id: x.id.slice(0, 8),
      tenant: x.companyId.slice(0, 8),
      mode: x.accessMode,
      status: x.status,
      owner: x.ownerUserId.slice(0, 8),
      target: x.targetUserId?.slice(0, 8) ?? null,
      expiresAt: x.expiresAt?.toISOString(),
      endedReason: x.endedReason,
    }));
    console.table(firstFew);
  });

  await section("FRICTION: assigned_to fields reference user ids we don't surface", async () => {
    // Collect all assigned_to ids across feedback + issues and confirm we can resolve them.
    const fbAssigned = (await db.select({ a: feedback.assignedTo }).from(feedback))
      .map((r) => r.a).filter(Boolean) as string[];
    const isAssigned = (await db.select({ a: issueReports.assignedTo }).from(issueReports))
      .map((r) => r.a).filter(Boolean) as string[];
    const ids = Array.from(new Set([...fbAssigned, ...isAssigned]));
    console.log(`Unique assignedTo user ids across feedback + issues: ${ids.length}`);
    if (ids.length > 0) {
      const rows = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
        .where(sql`${users.id} IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
      console.table(rows);
      console.log("UI only exposes these as raw user-id text fields. Operators won't know who that is.");
    } else {
      console.log("No current assignments — but the same UX concern applies on first use.");
    }
  });

  await section("FRICTION: tenantId is requested as raw string on Issue create", async () => {
    // The CreateIssueDialog asks operators to paste a tenant UUID manually.
    console.log("Operators have to copy/paste a 36-char UUID to link an issue to a tenant.");
    console.log("We have a tenant list + search endpoint — could drive a selector here, but don't today.");
  });

  await section("FRICTION: feedback row does not show which tenant it came from", async () => {
    const r = await platformFeedbackService.list({});
    const sample = r.rows[0];
    if (sample) {
      console.log(`Row includes companyId (${sample.companyId}) but UI only shows userEmail.`);
      console.log("An ops user looking at the inbox cannot tell which tenant the feedback came from without clicking in.");
    } else {
      console.log("No feedback rows — concern remains for when there are.");
    }
  });

  await section("FRICTION: support session list is identifier-only", async () => {
    // Tenant is shown as "abc12345…", mode + owner same. No human-readable tenant name.
    console.log("Platform support sessions table shows tenant + owner + target as truncated UUIDs.");
    console.log("Ops has to cross-reference /platform/tenants manually to know which tenant they are looking at.");
  });

  await section("CORRECTNESS: recentSupportAt is always null", async () => {
    const r = await platformTenantsService.searchTenants({});
    const populated = r.rows.find((x) => x.recentSupportAt != null);
    console.log(populated ? "populated for at least one tenant" : "always null — column exists in the API but no query backs it");
    console.log("Tenant list has a placeholder column that never shows anything.");
  });

  await section("CORRECTNESS: no-feedback / no-issues / no-sessions empty states", async () => {
    const fb = await platformFeedbackService.list({});
    const is = await platformIssuesService.list({});
    const ss = await supportSessionService.list({});
    console.log(`feedback rows: ${fb.rows.length}`);
    console.log(`issues rows:   ${is.rows.length}`);
    console.log(`sessions rows: ${ss.rows.length}`);
    if (fb.rows.length === 0) console.log("Feedback page currently shows just 'No feedback.' — no CTA to submit one via tenant app.");
    if (is.rows.length === 0) console.log("Issues page shows 'No issues.' — at least has a 'New issue' button.");
    if (ss.rows.length === 0) console.log("Support-sessions page needs operators to go through /platform/tenants/:id → New support session. No shortcut on this screen.");
  });

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(99); });
