import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import * as schema from '../shared/schema';

// ========================================
// NEON SERVERLESS CONFIGURATION
// ========================================

neonConfig.webSocketConstructor = ws;

const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PROD = NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set. Did you forget to provision a database?');
}

// ========================================
// NEON CONNECTION POOLER OPTIMIZATION
// ========================================
// Convert direct Neon URL to pooler URL for better performance
// The pooler maintains warm connections, eliminating ~200-300ms cold start latency
// Example: ep-xxx.us-east-2.aws.neon.tech -> ep-xxx-pooler.us-east-2.aws.neon.tech

function getPoolerUrl(databaseUrl: string): string {
  // Match Neon URL pattern and insert -pooler before the region
  // Pattern: ep-something.region.aws.neon.tech
  const poolerUrl = databaseUrl.replace(
    /(@ep-[^.]+)(\.)/,  // Match @ep-xxx followed by first dot
    '$1-pooler$2'       // Insert -pooler before the dot
  );
  
  // Debug: show URL structure without exposing credentials
  const urlPattern = databaseUrl.replace(/\/\/[^@]+@/, '//***:***@');
  const isNeonUrl = urlPattern.includes('neon.tech');
  const wasTransformed = poolerUrl !== databaseUrl;
  
  console.log(`[Neon] Database URL pattern: ${urlPattern.substring(0, 60)}...`);
  console.log(`[Neon] Is Neon URL: ${isNeonUrl}, Pooler applied: ${wasTransformed}`);
  
  if (wasTransformed) {
    // Show transformed URL pattern for verification
    const transformedPattern = poolerUrl.replace(/\/\/[^@]+@/, '//***:***@');
    console.log('[Neon] Using connection pooler for improved performance');
    console.log(`[Neon] Transformed URL: ${transformedPattern.substring(0, 70)}...`);
  } else if (isNeonUrl) {
    console.log('[Neon] Warning: Neon URL detected but pooler transformation did not match');
  } else {
    console.log('[Neon] Non-Neon database detected, pooler not applicable');
  }
  
  return poolerUrl;
}

// Use pooler URL unless explicitly disabled
const USE_POOLER = process.env.NEON_DISABLE_POOLER !== 'true';
const connectionString = USE_POOLER 
  ? getPoolerUrl(process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

// ========================================
// CONNECTION POOL SETTINGS FOR NEON
// ========================================
// Neon uses connection pooling differently than standard PostgreSQL
// With pooler enabled, Neon handles pooling at the proxy level

// ── DB connection identity banner (safe — no credentials logged) ──
// Prints prominently at startup so local vs Render drift is immediately visible
// in dev console and Render deploy logs.
try {
  const u = new URL(connectionString);
  const sslMode = new URLSearchParams(u.search).get("sslmode") ?? "(default)";
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  DATABASE IDENTITY (app runtime)");
  console.log("────────────────────────────────────────────────────────────────");
  console.log(`  Host:       ${u.hostname}`);
  console.log(`  Database:   ${u.pathname.replace("/", "")}`);
  console.log(`  User:       ${u.username}`);
  console.log(`  SSL mode:   ${sslMode}`);
  console.log(`  Pooler:     ${USE_POOLER ? "enabled" : "disabled"}`);
  console.log(`  NODE_ENV:   ${NODE_ENV}`);
  console.log("════════════════════════════════════════════════════════════════");
} catch {
  console.log("[DB] Could not parse connection URL for diagnostics");
}

const pool = new Pool({
  connectionString,

  // For Neon Serverless, keep pool size smaller (5-10)
  // Neon handles pooling at the proxy level
  max: Number(process.env.DB_POOL_MAX ?? (IS_PROD ? 10 : 5)),

  // OPTIMIZED: 2026-01-30 - Keep minimum connections warm to avoid cold starts
  // Cold connections add ~100-200ms latency on first query
  min: Number(process.env.DB_POOL_MIN ?? (IS_PROD ? 2 : 1)),

  // Connection timeouts
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT ?? 10000), // 10s for Neon
  // OPTIMIZED: Longer idle timeout in production to keep connections warm
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT ?? (IS_PROD ? 60000 : 30000)),

  // OPTIMIZED: Don't allow exit on idle - keep pool warm
  allowExitOnIdle: false,
});

// ========================================
// POOL EVENT HANDLERS
// ========================================

pool.on('error', (err, _client) => {
  console.error('[Neon Pool] Unexpected error on idle client:', err);

  // Recognize benign Neon disconnect cases. These are expected when Neon
  // scales the compute to zero and force-terminates idle connections.
  // 2026-04-08: Added "administrator command" + "terminating connection"
  // after a long-uptime dev session crashed on Neon idle terminate.
  const msg = err?.message ?? "";
  if (
    msg.includes("connection closed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("administrator command") ||
    msg.includes("terminating connection")
  ) {
    console.warn('[Neon Pool] Connection dropped — Neon may have scaled down. Pool will reconnect on next query.');
  }
});

pool.on('connect', (client) => {
  // UTC-safe scheduling fix: Pin every connection's session timezone to UTC.
  // This ensures the pg driver's timestamp serialization/parsing is
  // deterministic regardless of server host timezone. Belt-and-suspenders
  // alongside process.env.TZ = 'UTC' in server/index.ts.
  client.query("SET timezone = 'UTC'").catch((err: Error) => {
    console.error('[Neon Pool] Failed to set session timezone:', err);
  });

  // 2026-04-08: Per-client error listener.
  // The Neon serverless driver wraps WebSockets; when a WebSocket dies
  // (admin terminate, idle scale-down, ETIMEDOUT), the underlying pg Client
  // emits an `error` event directly. Without a client-level listener, Node's
  // EventEmitter rules treat unhandled `error` events as uncaught exceptions
  // and exit the process. `pool.on('error')` only catches errors that bubble
  // through the pool's idle-client path, not events emitted directly on a
  // checked-out / connecting client. This listener is the missing piece that
  // prevents Node from crashing on Neon disconnects.
  client.on('error', (err: Error) => {
    console.error('[Neon Pool] Client-level error (non-fatal):', err.message);
    // Do NOT rethrow. Letting the event return normally lets the pool
    // discard the dead client and re-acquire on the next query.
  });

  const poolSize = pool.totalCount;
  const idleCount = pool.idleCount;

  if (!IS_PROD) {
    console.log(`[Neon Pool] Connected. Total: ${poolSize}, Idle: ${idleCount}`);
  }
});

pool.on('remove', (client) => {
  if (!IS_PROD) {
    console.log(`[Neon Pool] Connection removed. Total: ${pool.totalCount}`);
  }
});

// ========================================
// DRIZZLE ORM SETUP
// ========================================

// Query logging configuration
const logger = IS_PROD ? undefined : {
  logQuery(query: string, params: unknown[]) {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      
      // Log slow queries (Neon is usually fast, so 50ms is a good threshold)
      if (duration > 50) {
        console.warn(`[SLOW QUERY] ${duration}ms: ${query.substring(0, 100)}...`);
      } else if (!IS_PROD && duration > 10) {
        // In dev, log queries over 10ms
        console.log(`[Query] ${duration}ms: ${query.substring(0, 80)}...`);
      }
    };
  },
};

export const db = drizzle(pool, {
  schema,
  logger,
});

// ========================================
// HEALTH CHECK
// ========================================

export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latency?: number;
  region?: string;
  error?: string;
}> {
  const start = Date.now();
  try {
    const result = await pool.query('SELECT 1 as health');
    const latency = Date.now() - start;
    
    const regionInfo = process.env.DATABASE_URL?.match(/\.([a-z-]+)\.neon\.tech/);
    const region = regionInfo ? regionInfo[1] : 'unknown';
    
    return {
      healthy: true,
      latency,
      region,
    };
  } catch (error: any) {
    console.error('[Neon Health Check] Failed:', error);
    return {
      healthy: false,
      error: error.message,
    };
  }
}

export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    utilization: pool.totalCount > 0 
      ? (pool.totalCount / Number(process.env.DB_POOL_MAX ?? 10) * 100).toFixed(1) + '%'
      : '0%',
  };
}

export async function closeDatabasePool(): Promise<void> {
  console.log('[Neon Pool] Closing connection pool...');
  try {
    await pool.end();
    console.log('[Neon Pool] Connection pool closed successfully');
  } catch (error) {
    console.error('[Neon Pool] Error closing pool:', error);
  }
}

// Handle process termination
process.on('SIGTERM', async () => {
  await closeDatabasePool();
});

process.on('SIGINT', async () => {
  await closeDatabasePool();
});

export { pool };
export default db;