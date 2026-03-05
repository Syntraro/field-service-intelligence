/**
 * SQL Migration Runner — Applies pending migrations from /migrations/
 *
 * Connects via DATABASE_URL, ensures `schema_migrations` tracking table exists,
 * scans migrations/*.sql in lexical order, applies any not yet recorded,
 * and records filename + applied_at. Non-interactive and safe to rerun.
 *
 * Usage:
 *   npm run db:migrate              # Apply all pending migrations
 *   npm run db:migrate:one -- <file> # Apply a single migration file
 *
 * Run directly:
 *   tsx server/scripts/runMigrations.ts              # all pending
 *   tsx server/scripts/runMigrations.ts --file <name> # single file
 *   tsx server/scripts/runMigrations.ts --sanity      # connectivity check only
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

/** Ensure schema_migrations table exists (idempotent). */
async function ensureTrackingTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/** Return set of already-applied filenames. */
async function getApplied(client: pg.Client): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  return new Set(rows.map((r) => r.filename));
}

/** Record a migration as applied. */
async function recordMigration(client: pg.Client, filename: string): Promise<void> {
  await client.query(
    "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
    [filename]
  );
}

/** List all .sql files in /migrations/ sorted lexically. */
function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`ERROR: Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Apply a single migration file. */
async function applyMigration(client: pg.Client, filename: string): Promise<void> {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Migration file not found: ${filepath}`);
  }
  const sql = fs.readFileSync(filepath, "utf-8");

  // Check if file contains CONCURRENTLY — cannot run inside a transaction
  const hasConcurrently = /\bCONCURRENTLY\b/i.test(sql);

  if (hasConcurrently) {
    // Run outside transaction (CREATE INDEX CONCURRENTLY cannot be in a txn)
    console.log(`  [no-txn] Contains CONCURRENTLY, running without transaction wrapper`);
    await client.query(sql);
  } else {
    // Wrap in transaction for atomicity
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
}

/** Sanity check: verify DB connectivity. */
async function sanityCheck(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ now: Date }>("SELECT NOW() AS now");
  console.log(`DB connectivity OK. Server time: ${rows[0].now}`);
  const { rows: tables } = await client.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log(`Public tables: ${tables[0].count}`);
}

// --- Main ---
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isSanity = args.includes("--sanity");
  const fileIdx = args.indexOf("--file");
  const singleFile = fileIdx !== -1 ? args[fileIdx + 1] : undefined;

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    if (isSanity) {
      await sanityCheck(client);
      return;
    }

    await ensureTrackingTable(client);
    const applied = await getApplied(client);

    if (singleFile) {
      // Single-file mode
      const filename = path.basename(singleFile);
      if (applied.has(filename)) {
        console.log(`SKIP: ${filename} (already applied)`);
        return;
      }
      console.log(`Applying: ${filename}`);
      await applyMigration(client, filename);
      await recordMigration(client, filename);
      console.log(`DONE: ${filename}`);
      return;
    }

    // Apply all pending migrations
    const allFiles = listMigrationFiles();
    const pending = allFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("No pending migrations. Database is up to date.");
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):\n`);
    for (const filename of pending) {
      console.log(`Applying: ${filename}`);
      await applyMigration(client, filename);
      await recordMigration(client, filename);
      console.log(`  OK`);
    }
    console.log(`\nAll ${pending.length} migration(s) applied successfully.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err);
  process.exit(1);
});
