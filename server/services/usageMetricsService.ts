/**
 * Usage metrics service (2026-04-19).
 *
 * Live, canonical per-tenant counts for cap-enforceable features. No
 * snapshot/cache table yet — each call runs a single indexed COUNT. Results
 * are short-TTL cached (1 minute) so enforcement hot paths don't hammer
 * the DB.
 *
 * Returns null for feature keys that have no canonical count. Callers MUST
 * interpret null as "no countable metric" and not conflate with zero.
 */

import { db } from "../db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  clients,
  users,
  recurringJobTemplates,
  locationEquipment,
} from "@shared/schema";
import { cache, CacheTTL } from "./cache";

const CACHE_PREFIX = "usage:";

const OFFICE_ROLES = ["owner", "manager", "dispatcher", "office"] as const;

async function countClients(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(clients)
    .where(and(eq(clients.companyId, companyId), eq(clients.inactive, false)));
  return row?.c ?? 0;
}

async function countOfficeUsers(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      eq(users.status, "active"),
      sql`${users.role} IN ('owner','manager','dispatcher','office')`,
    ));
  return row?.c ?? 0;
}

async function countTechnicianUsers(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(
      eq(users.companyId, companyId),
      eq(users.status, "active"),
      eq(users.role, "technician"),
    ));
  return row?.c ?? 0;
}

async function countTotalUsers(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.status, "active")));
  return row?.c ?? 0;
}

async function countPmContracts(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(recurringJobTemplates)
    .where(eq(recurringJobTemplates.companyId, companyId));
  return row?.c ?? 0;
}

async function countEquipment(companyId: string): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` })
    .from(locationEquipment)
    .where(and(eq(locationEquipment.companyId, companyId), isNull(locationEquipment.deletedAt)));
  return row?.c ?? 0;
}

/**
 * Map feature_key → counter. Returns null if the feature has no canonical
 * countable usage metric.
 */
async function compute(companyId: string, featureKey: string): Promise<number | null> {
  switch (featureKey) {
    case "clients":
    case "locations":
    case "branches":
      return countClients(companyId);
    case "office_users":
      return countOfficeUsers(companyId);
    case "technician_users":
      return countTechnicianUsers(companyId);
    case "total_users":
      return countTotalUsers(companyId);
    case "pm_contracts":
      return countPmContracts(companyId);
    case "equipment_tracking":
      return countEquipment(companyId);
    default:
      return null;
  }
}

export async function getUsage(companyId: string, featureKey: string): Promise<number> {
  const cacheK = `${CACHE_PREFIX}${companyId}:${featureKey}`;
  const cached = cache.get<number>(cacheK);
  if (typeof cached === "number") return cached;
  const value = await compute(companyId, featureKey);
  const coerced = value ?? 0;
  cache.set(cacheK, coerced, CacheTTL.SHORT);
  return coerced;
}

/**
 * Bulk usage for the admin surface. Returns a feature_key → count map for
 * every counter we support. Feature keys not in the switch return 0.
 */
export async function getUsageSummary(companyId: string): Promise<Record<string, number>> {
  const [c, ou, tu, total, pm, eq] = await Promise.all([
    countClients(companyId),
    countOfficeUsers(companyId),
    countTechnicianUsers(companyId),
    countTotalUsers(companyId),
    countPmContracts(companyId),
    countEquipment(companyId),
  ]);
  return {
    clients: c,
    locations: c,
    branches: c,
    office_users: ou,
    technician_users: tu,
    total_users: total,
    pm_contracts: pm,
    equipment_tracking: eq,
  };
}

export const usageMetricsService = { getUsage, getUsageSummary };
