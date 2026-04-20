import pg from "pg";

const tables = [
  "users",
  "companies",
  "user_identities",
  "session",
  "invitations",
  "company_settings",
  "company_business_hours",
  "jobs",
  "invoices",
  "quotes",
  "client_locations",
  "customer_companies",
  "audit_events",
  "audit_logs",
  "roles",
  "permissions",
  "role_permissions",
  "subscription_plans",
  "schema_migrations",
];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (const t of tables) {
    const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(t.padEnd(26), r.rows[0].n);
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
