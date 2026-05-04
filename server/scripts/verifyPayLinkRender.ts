// Read-only verification — 2026-05-03
// Confirms that templateDataBuilder.buildInvoiceTemplateData now
// populates PAYMENT_URL and PAY_NOW_CTA after the
// customer_portal_payments entitlement migration. Does NOT send mail
// or modify state.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load .env BEFORE importing anything that reads process.env at
// module-init time (server/db.ts throws on import if DATABASE_URL is
// missing). The dynamic imports below honour the env we set here.
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

async function main() {
  const pg = (await import("pg")).default;
  const { entitlementService } = await import("../services/entitlementService");
  const { templateDataBuilder } = await import("../services/templateDataBuilder");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const candidates = await client.query<{
      id: string; invoice_number: number; status: string; total: string; balance: string; company_id: string; tenant_name: string;
    }>(`
      SELECT i.id, i.invoice_number, i.status, i.total::text, i.balance::text,
             i.company_id, c.name AS tenant_name
        FROM invoices i
        JOIN companies c ON c.id = i.company_id
       WHERE i.status IN ('awaiting_payment','sent','partial_paid')
         AND COALESCE(i.balance, '0')::numeric > 0
       ORDER BY i.invoice_number DESC
       LIMIT 5;
    `);

    if (candidates.rows.length === 0) {
      console.log("No candidate invoices found (no awaiting/sent/partial_paid invoices with balance > 0).");
      return;
    }

    console.log("\n══════ Verifying PAYMENT_URL + PAY_NOW_CTA per invoice ══════\n");
    for (const inv of candidates.rows) {
      console.log(`Invoice #${inv.invoice_number} (${inv.id})`);
      console.log(`  tenant=${inv.tenant_name}  status=${inv.status}  total=${inv.total}  balance=${inv.balance}`);

      const ent = await entitlementService.getEntitlement(inv.company_id, "customer_portal_payments");
      console.log(`  entitlement.customer_portal_payments → enabled=${ent?.enabled}  source=${ent?.source}`);

      const data = await templateDataBuilder.buildInvoiceTemplateData(inv.company_id, inv.id);
      console.log(`  INVOICE_TOTAL    = "${data.INVOICE_TOTAL}"`);
      console.log(`  INVOICE_DUE_DATE = "${data.INVOICE_DUE_DATE}"`);
      console.log(`  PAYMENT_URL      = "${data.PAYMENT_URL}"`);
      console.log(`  PAY_NOW_CTA      = "${data.PAY_NOW_CTA.replace(/\n+/g, " ⏎ ")}"`);
      console.log("");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verifyPayLinkRender failed:", err);
  process.exit(1);
});
