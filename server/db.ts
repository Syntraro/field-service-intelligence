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
// CONNECTION POOL SETTINGS FOR NEON
// ========================================
// Neon uses connection pooling differently than standard PostgreSQL
// Neon automatically pools at the proxy level, so we use smaller pool sizes

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  
  // For Neon Serverless, keep pool size smaller (5-10)
  // Neon handles pooling at the proxy level
  max: Number(process.env.DB_POOL_MAX ?? (IS_PROD ? 10 : 5)),
  
  // Minimum connections
  min: Number(process.env.DB_POOL_MIN ?? 0), // Neon can scale to zero
  
  // Connection timeouts
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT ?? 10000), // 10s for Neon
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT ?? 30000), // 30s
  
  // Neon-specific: Allow idle connections to close (scales to zero)
  allowExitOnIdle: true,
});

// ========================================
// POOL EVENT HANDLERS
// ========================================

pool.on('error', (err, client) => {
  console.error('[Neon Pool] Unexpected error on idle client:', err);
  
  // Check if it's a Neon-specific error
  if (err.message?.includes('connection closed') || err.message?.includes('ECONNRESET')) {
    console.warn('[Neon Pool] Connection dropped - Neon may have scaled down. This is normal.');
  }
});

pool.on('connect', (client) => {
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