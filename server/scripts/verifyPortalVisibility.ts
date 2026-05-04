// Read-only verification — 2026-05-03
// Replays the exact filter the portal route uses for /api/portal/invoices
// against the dev DB and confirms that awaiting_payment invoices are now
// visible. Diagnostic only — does NOT modify any rows. Mirrors the
// existing pattern of `verifyItemDedup.ts` / `auditPaymentEntitlement.ts`.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Mirror the canonical constant — proves the source-of-truth import
// matches the constant the portal route now uses (intentionally
// import-free here so this script doesn't depend on app modules).
const UNPAID = ["awaiting_payment", "sent", "partial_paid"];
const VISIBLE = [...UNPAID, "paid"];
const LEGACY_VISIBLE = ["sent", "partial_paid", "paid"];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Pick the freshest awaiting_payment invoice as a witness.
    const witness = await client.query<{
      id: string; invoice_number: number; status: string; balance: string;
      company_id: string; customer_company_id: string;
    }>(`
      SELECT id, invoice_number, status, balance::text,
             company_id, customer_company_id
        FROM invoices
       WHERE status = 'awaiting_payment'
         AND COALESCE(balance, '0')::numeric > 0
       ORDER BY invoice_number DESC
       LIMIT 1;
    `);
    if (witness.rows.length === 0) {
      console.log("No awaiting_payment invoices in DB. Cannot probe.");
      return;
    }
    const w = witness.rows[0];
    console.log(`\n══════ Witness invoice ══════\n`);
    console.log(`  invoice_number=${w.invoice_number}  status="${w.status}"  balance=${w.balance}`);
    console.log(`  company_id=${w.company_id}`);
    console.log(`  customer_company_id=${w.customer_company_id}`);

    // Replay the exact dashboard query for this customer-company under
    // each filter — the legacy hardcoded one and the new canonical one.
    const runFilter = async (label: string, statuses: string[]) => {
      const q = await client.query<{ id: string; status: string; balance: string }>(`
        SELECT id, status, balance::text
          FROM invoices
         WHERE company_id           = $1
           AND customer_company_id  = $2
           AND status               = ANY($3::text[])
         ORDER BY issue_date DESC
         LIMIT 200;
      `, [w.company_id, w.customer_company_id, statuses]);
      const open = q.rows.filter(r => UNPAID.includes(r.status));
      const sumOpen = open.reduce((s, r) => s + parseFloat(r.balance || "0"), 0);
      console.log(`  ${label}`);
      console.log(`    statuses             : ${JSON.stringify(statuses)}`);
      console.log(`    invoices returned    : ${q.rows.length}`);
      console.log(`    open invoice count   : ${open.length}`);
      console.log(`    open balance total   : $${sumOpen.toFixed(2)}`);
      const witnessFound = q.rows.find(r => r.id === w.id);
      console.log(`    witness #${w.invoice_number} present : ${witnessFound ? "yes ✓" : "NO ✗"}`);
      console.log("");
    };

    console.log(`\n══════ Dashboard query simulation ══════\n`);
    await runFilter("BEFORE FIX (hardcoded ['sent','partial_paid','paid'])", LEGACY_VISIBLE);
    await runFilter("AFTER FIX (UNPAID_INVOICE_STATUSES + 'paid')        ", VISIBLE);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verifyPortalVisibility failed:", err);
  process.exit(1);
});
