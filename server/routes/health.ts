import { Router, Request, Response } from "express";
import { pool } from "../db";

const router = Router();

/**
 * GET /api/health
 * Basic health check endpoint
 * Returns 200 if server is running
 */
router.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /api/health/db-identity
 *
 * TEMPORARY diagnostic endpoint — confirms which database the running app is
 * actually connected to. Use to verify local vs Render are pointing at the
 * same Neon database during the unification pass.
 *
 * Returns: current_database(), current_user, server_version, server_addr,
 *          migration count + latest applied migration, current timestamp.
 *
 * No secrets exposed. Safe to leave on while diagnosing drift.
 *
 * REMOVE this endpoint once databases are confirmed unified.
 */
router.get("/db-identity", async (_req: Request, res: Response) => {
  try {
    const identity = await pool.query<{
      database: string;
      user: string;
      version: string;
      server_addr: string | null;
      now: Date;
    }>(
      `SELECT current_database() AS database,
              current_user        AS user,
              version()           AS version,
              inet_server_addr()::text AS server_addr,
              NOW()               AS now`
    );

    let migrationInfo: { count: number; latest: string | null } = { count: 0, latest: null };
    try {
      const r = await pool.query<{ count: string; latest: string | null }>(
        `SELECT COUNT(*)::text AS count,
                MAX(filename)   AS latest
         FROM schema_migrations`
      );
      migrationInfo = {
        count: Number(r.rows[0]?.count ?? 0),
        latest: r.rows[0]?.latest ?? null,
      };
    } catch {
      // schema_migrations table not present yet
    }

    res.status(200).json({
      _warning: "TEMPORARY DIAGNOSTIC ENDPOINT — remove once databases are unified",
      database: identity.rows[0].database,
      user: identity.rows[0].user,
      serverAddr: identity.rows[0].server_addr,
      version: identity.rows[0].version,
      migrationsApplied: migrationInfo.count,
      latestMigration: migrationInfo.latest,
      now: identity.rows[0].now,
      nodeEnv: process.env.NODE_ENV ?? "(unset)",
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "db-identity query failed" });
  }
});

export default router;