/**
 * Read-only audit: list contact_persons rows whose email doesn't pass the
 * canonical shape. Does NOT mutate data. Run with:
 *   npx tsx server/scripts/auditContactEmails.ts
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EMAIL_SHAPE_REGEX } from "@shared/lib/emailValidation";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const res = await client.query<{
    id: string;
    company_id: string;
    customer_company_id: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  }>(
    `SELECT id, company_id, customer_company_id, first_name, last_name, email
       FROM contact_persons
      WHERE email IS NOT NULL AND length(trim(email)) > 0`,
  );

  const invalid = res.rows.filter((r) => !EMAIL_SHAPE_REGEX.test((r.email ?? "").trim()));
  console.log(`Scanned ${res.rows.length} contact_persons rows with a populated email.`);
  console.log(`Invalid-shape emails: ${invalid.length}`);
  for (const r of invalid) {
    console.log(
      `  ${r.id} | tenant=${r.company_id} | ${[r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)"} | ${r.email}`,
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
