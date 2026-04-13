/**
 * Attention Rules — Deterministic rule evaluator for the attention_items queue.
 *
 * Phase 1 Architecture: Event Log + Attention Queue.
 *
 * Each rule has:
 *   - ruleType: matches AttentionRuleType enum
 *   - severity: high | medium | low
 *   - detect(tenantId): returns matches {entityType, entityId, meta}
 *
 * Evaluation triggers:
 *   A) On-write: recomputeAttentionForEntity() after mutations
 *   B) Admin: recomputeAllAttention() full tenant-wide recompute
 */

import { db } from "../db";
import { jobs, invoices, attentionItems, clientLocations as clients, customerCompanies } from "@shared/schema";
import { eq, and, sql, ne, isNull, isNotNull } from "drizzle-orm";
import type { AttentionRuleType, AttentionSeverity } from "@shared/schema";
import { activeJobFilter } from "../storage/jobFilters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttentionMatch {
  entityType: string;
  entityId: string;
  meta: Record<string, unknown>;
}

interface AttentionRule {
  ruleType: AttentionRuleType;
  severity: AttentionSeverity;
  detect: (tenantId: string) => Promise<AttentionMatch[]>;
  /** Detect for a single entity (for incremental updates) */
  detectForEntity?: (tenantId: string, entityId: string) => Promise<AttentionMatch | null>;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RULES: AttentionRule[] = [
  {
    ruleType: "job.requires_invoicing",
    severity: "high",
    async detect(tenantId) {
      const rows = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.status, "completed"),
          activeJobFilter(),
        ));
      return rows.map(r => ({
        entityType: "job" as const,
        entityId: r.id,
        meta: { jobNumber: r.jobNumber, clientName: r.companyName },
      }));
    },
    async detectForEntity(tenantId, entityId) {
      const [row] = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          status: jobs.status,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.id, entityId),
          activeJobFilter(),
        ))
        .limit(1);
      if (!row || row.status !== "completed") return null;
      return {
        entityType: "job" as const,
        entityId: row.id,
        meta: { jobNumber: row.jobNumber, clientName: row.companyName },
      };
    },
  },

  {
    ruleType: "job.unassigned",
    severity: "medium",
    // 2026-04-12 (Option A): "unassigned" is now defined as "scheduled job
    // with no active visit carrying a crew" — jobs no longer own assignment.
    async detect(tenantId) {
      const rows = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.status, "open"),
          isNotNull(jobs.scheduledStart),
          activeJobFilter(),
          // No active visit on this job carries a non-empty crew.
          sql`NOT EXISTS (
            SELECT 1 FROM job_visits jv_u
            WHERE jv_u.job_id = ${jobs.id}
              AND jv_u.company_id = ${jobs.companyId}
              AND jv_u.is_active = true
              AND COALESCE(array_length(jv_u.assigned_technician_ids, 1), 0) > 0
          )`,
        ));
      return rows.map(r => ({
        entityType: "job" as const,
        entityId: r.id,
        meta: { jobNumber: r.jobNumber, clientName: r.companyName },
      }));
    },
    async detectForEntity(tenantId, entityId) {
      const [row] = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          status: jobs.status,
          scheduledStart: jobs.scheduledStart,
          hasCrewVisit: sql<boolean>`EXISTS (
            SELECT 1 FROM job_visits jv_u2
            WHERE jv_u2.job_id = ${jobs.id}
              AND jv_u2.company_id = ${jobs.companyId}
              AND jv_u2.is_active = true
              AND COALESCE(array_length(jv_u2.assigned_technician_ids, 1), 0) > 0
          )`,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.id, entityId),
          activeJobFilter(),
        ))
        .limit(1);
      if (!row || row.status !== "open" || !row.scheduledStart || row.hasCrewVisit) return null;
      return {
        entityType: "job" as const,
        entityId: row.id,
        meta: { jobNumber: row.jobNumber, clientName: row.companyName },
      };
    },
  },

  {
    ruleType: "job.unscheduled",
    severity: "medium",
    async detect(tenantId) {
      // Active open jobs with no schedule
      // 2026-03-17: Exclude on_hold jobs — they are deliberately parked, not unscheduled backlog
      const rows = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.status, "open"),
          isNull(jobs.scheduledStart),
          sql`(${jobs.openSubStatus} IS NULL OR ${jobs.openSubStatus} != 'on_hold')`,
          activeJobFilter(),
        ));
      return rows.map(r => ({
        entityType: "job" as const,
        entityId: r.id,
        meta: { jobNumber: r.jobNumber, clientName: r.companyName },
      }));
    },
    async detectForEntity(tenantId, entityId) {
      const [row] = await db
        .select({
          id: jobs.id,
          jobNumber: jobs.jobNumber,
          status: jobs.status,
          openSubStatus: jobs.openSubStatus,
          scheduledStart: jobs.scheduledStart,
          companyName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
        })
        .from(jobs)
        .leftJoin(clients, eq(jobs.locationId, clients.id))
        .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
        .where(and(
          eq(jobs.companyId, tenantId),
          eq(jobs.id, entityId),
          activeJobFilter(),
        ))
        .limit(1);
      // 2026-03-17: Exclude on_hold jobs from unscheduled attention
      if (!row || row.status !== "open" || row.scheduledStart) return null;
      if (row.openSubStatus === "on_hold") return null;
      return {
        entityType: "job" as const,
        entityId: row.id,
        meta: { jobNumber: row.jobNumber, clientName: row.companyName },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Upsert / Resolve logic
// ---------------------------------------------------------------------------

/**
 * Upsert an attention item (ON CONFLICT DO UPDATE on dedupeKey).
 * If the item already exists and is open, just bump lastDetectedAt and meta.
 * If it was resolved, reopen it.
 */
// Phase 5: Exported so visitIntelligence.ts uses the canonical upsert
// instead of owning a duplicate INSERT ON CONFLICT implementation.
export async function upsertAttentionItem(
  tenantId: string,
  ruleType: AttentionRuleType,
  severity: AttentionSeverity,
  match: AttentionMatch,
) {
  const dedupeKey = `${match.entityType}:${match.entityId}:${ruleType}`;
  await db.execute(sql`
    INSERT INTO attention_items (
      id, tenant_id, entity_type, entity_id, rule_type, severity, status,
      first_detected_at, last_detected_at, meta, dedupe_key
    ) VALUES (
      gen_random_uuid(), ${tenantId}, ${match.entityType}, ${match.entityId},
      ${ruleType}, ${severity}, 'open',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${JSON.stringify(match.meta)}::jsonb, ${dedupeKey}
    )
    ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET
      last_detected_at = CURRENT_TIMESTAMP,
      meta = ${JSON.stringify(match.meta)}::jsonb,
      status = 'open',
      resolved_at = NULL,
      severity = ${severity}
  `);
}

/**
 * Resolve an attention item (mark as resolved).
 */
async function resolveAttentionItem(tenantId: string, entityType: string, entityId: string, ruleType: string) {
  const dedupeKey = `${entityType}:${entityId}:${ruleType}`;
  await db.execute(sql`
    UPDATE attention_items
    SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND dedupe_key = ${dedupeKey} AND status = 'open'
  `);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Job-specific rule types for incremental recompute */
const JOB_RULES = RULES.filter(r => r.ruleType.startsWith("job."));

/**
 * Recompute attention items for a single entity (incremental, on-write).
 * Evaluates all rules applicable to this entity type and upserts/resolves accordingly.
 */
export async function recomputeAttentionForEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
) {
  try {
    const rulesToEval = entityType === "job" ? JOB_RULES : [];
    for (const rule of rulesToEval) {
      if (!rule.detectForEntity) continue;
      const match = await rule.detectForEntity(tenantId, entityId);
      if (match) {
        await upsertAttentionItem(tenantId, rule.ruleType, rule.severity, match);
      } else {
        await resolveAttentionItem(tenantId, entityType, entityId, rule.ruleType);
      }
    }
  } catch (error) {
    console.error("[attentionRules] recomputeAttentionForEntity failed:", error);
  }
}

/**
 * Full tenant-wide recompute (admin safety valve).
 * Evaluates all rules and upserts/resolves attention items.
 */
export async function recomputeAllAttention(tenantId: string): Promise<{ created: number; resolved: number }> {
  let created = 0;
  let resolved = 0;

  for (const rule of RULES) {
    // Detect all matching entities
    const matches = await rule.detect(tenantId);
    const matchedIds = new Set(matches.map(m => m.entityId));

    // Upsert all detected matches
    for (const match of matches) {
      await upsertAttentionItem(tenantId, rule.ruleType, rule.severity, match);
      created++;
    }

    // Resolve any open items that are no longer detected
    const openItems = await db.execute(sql`
      SELECT entity_id FROM attention_items
      WHERE tenant_id = ${tenantId} AND rule_type = ${rule.ruleType} AND status = 'open'
    `);
    for (const item of openItems.rows as any[]) {
      if (!matchedIds.has(item.entity_id)) {
        await resolveAttentionItem(tenantId, "job", item.entity_id, rule.ruleType);
        resolved++;
      }
    }
  }

  return { created, resolved };
}
