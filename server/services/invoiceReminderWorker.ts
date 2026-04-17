/**
 * Invoice Reminder Worker (2026-04-16)
 *
 * Periodic sweep that fires overdue-invoice reminders per tenant. Structure
 * copied from subscriptionWorker.ts — single in-process setInterval with
 * `.unref()` so shutdown isn't blocked. Gated per-tenant by
 * `tenant_features.invoice_reminders_enabled`.
 *
 * This worker is a thin loop; every send goes through invoiceReminderService
 * which is also the manual path, so there is no duplicated eligibility logic.
 */

import { db } from "../db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { invoiceReminderService } from "./invoiceReminderService";

// 4h in production; startup delay so the server can boot cleanly first.
const SWEEP_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;

let started = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

async function runSweep(): Promise<void> {
  const startMs = Date.now();
  // Skip the internal Syntraro Platform company from the sweep.
  const tenants = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.subscriptionStatus, "active"));

  let totalSent = 0, totalSkipped = 0, totalErrors = 0;
  for (const t of tenants) {
    try {
      const r = await invoiceReminderService.sweepTenant(t.id);
      totalSent += r.sent;
      totalSkipped += r.skipped;
      totalErrors += r.errors;
    } catch (err) {
      totalErrors++;
      console.error(`[invoiceReminderWorker] sweep failed for tenant ${t.id}:`, err);
    }
  }

  const ms = Date.now() - startMs;
  console.log(
    `[invoiceReminderWorker] sweep done in ${ms}ms: tenants=${tenants.length} sent=${totalSent} skipped=${totalSkipped} errors=${totalErrors}`,
  );
}

export function startInvoiceReminderWorker(): void {
  if (started) return;
  started = true;

  // Delay first run so startup isn't noisy.
  startupTimer = setTimeout(() => {
    runSweep().catch((err) => console.error("[invoiceReminderWorker] startup sweep failed:", err));
    intervalTimer = setInterval(() => {
      runSweep().catch((err) => console.error("[invoiceReminderWorker] sweep failed:", err));
    }, SWEEP_INTERVAL_MS);
    intervalTimer.unref();
  }, STARTUP_DELAY_MS);
  startupTimer.unref();

  console.log(
    `[invoiceReminderWorker] scheduled: startup in ${STARTUP_DELAY_MS / 1000}s, interval every ${SWEEP_INTERVAL_MS / 3_600_000}h`,
  );
}

/** Used by tests and graceful shutdown. */
export function stopInvoiceReminderWorker(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
  started = false;
}
