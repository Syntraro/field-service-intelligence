/**
 * Test-only `.env` bootstrapper (2026-04-29).
 *
 * `npm test` runs `vitest run`, which does NOT inherit `--env-file=.env`
 * the way `npm run dev` does (the `tsx` launcher loads it there). The
 * test DB-invariants check in `setup.ts` imports `server/db.ts`, which
 * throws fast when `DATABASE_URL` is unset. This shim reads the
 * project's `.env` synchronously so the test runner has the same env
 * vars the dev server gets, without adding `dotenv` as a dependency.
 *
 * Behavior:
 *   - Only assigns keys that are NOT already set on `process.env`, so
 *     CI / shell exports continue to win over `.env`.
 *   - Silent no-op if `.env` is missing.
 *   - Limited to simple `KEY=VALUE` lines; quotes are stripped, blank
 *     lines and `#` comments are skipped. Sufficient for DATABASE_URL
 *     and the Stripe env vars; we are not building a generic dotenv
 *     replacement.
 *
 * MUST be the very first import in `tests/setup.ts` so it runs before
 * any module that reads `process.env.DATABASE_URL` at import time.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding single or double quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
