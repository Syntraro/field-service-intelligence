// Run this with: node run-migration.js
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

async function runMigration() {
  try {
    console.log('Running migration: Add clients deterministic ordering index...');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_deterministic_order 
      ON clients(company_id, company_name, is_primary DESC, created_at)
    `);

    console.log('✅ Migration completed successfully!');
    console.log('Index created: idx_clients_deterministic_order');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();