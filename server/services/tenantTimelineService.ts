/**
 * Tenant Timeline Service — SaaS Admin / Tenant Operations Phase A1.
 *
 * 2026-04-22: canonical READ service that unions the per-tenant event
 * streams already being written across the system into one chronological
 * feed. Pure read path — no new writers, no new tables, no duplicate roots.
 *
 * Sources unified (all keyed on companyId / tenantId / targetCompanyId):
 *   - subscription_events              → subscription.{type}
 *   - audit_logs                       → audit.{action}
 *   - impersonation_sessions           → support.session_{created,started,ended,revoked}
 *                                        OR impersonation.session_{...} based on accessMode
 *   - tenant_feature_overrides         → entitlement.override_{created,updated}
 *   - feedback                         → feedback.submitted
 *   - issue_reports                    → issue.reported
 *
 * Single event shape. Newest first. Filterable by `kinds[]` (group-prefix).
 * Keyset-paged on `(timestamp, id)` via a `before` ISO cursor.
 *
 * Architecture rules:
 *   - read-only; no writes of any kind happen inside this file
 *   - no new indexes needed — all source tables already carry companyId-
 *     indexed or PK-indexed reads appropriate for this query shape
 *   - no duplication of canonical shapes; the Drizzle schema rows are
 *     mapped into TimelineEvent shape at the service boundary and nowhere
 *     else
 */

import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db";
import {
  subscriptionEvents,
  auditLogs,
  impersonationSessions,
  tenantFeatureOverrides,
  subscriptionFeatures,
  feedback,
  issueReports,
} from "@shared/schema";

// ============================================================================
// Canonical event shape
// ============================================================================

export const TIMELINE_GROUPS = [
  "subscription",
  "audit",
  "support",
  "impersonation",
  "entitlement",
  "feedback",
  "issue",
] as const;

export type TimelineKindGroup = typeof TIMELINE_GROUPS[number];

export type TimelineSeverity = "info" | "success" | "warning" | "danger";

export interface TimelineActor {
  id?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface TimelineEvent {
  /** Composite stable id: `<sourceTable>:<rowId>[:<phase>]`. */
  id: string;
  /** ISO timestamp. Newest-first order is by this field. */
  timestamp: string;
  /** Discriminator: `<group>.<action>`, e.g. `subscription.status_changed`. */
  kind: string;
  /** One-line human summary. */
  title: string;
  /** Optional secondary line (from→to, reason, etc.). */
  subtitle: string | null;
  /** Who caused it, when known. May be partial (id only, email only). */
  actor: TimelineActor | null;
  severity: TimelineSeverity;
  /** Raw details for the expand-row UI. */
  metadata: Record<string, unknown>;
  /** Source table name — for debugging + support triage. */
  sourceTable: string;
}

export interface GetTimelineInput {
  companyId: string;
  limit?: number;
  /** Return events strictly older than this timestamp (keyset cursor). */
  before?: Date;
  /** Filter to these groups. Empty / undefined = all groups. */
  kinds?: readonly TimelineKindGroup[];
}

export interface GetTimelineResult {
  tenantId: string;
  events: TimelineEvent[];
  hasMore: boolean;
  nextBefore: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(n?: number): number {
  if (!Number.isFinite(n as number)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(n as number)), MAX_LIMIT);
}

function pickGroups(kinds?: readonly TimelineKindGroup[]): Set<TimelineKindGroup> {
  if (!kinds || kinds.length === 0) return new Set(TIMELINE_GROUPS);
  const valid = kinds.filter((k): k is TimelineKindGroup =>
    (TIMELINE_GROUPS as readonly string[]).includes(k),
  );
  return new Set(valid.length ? valid : TIMELINE_GROUPS);
}

function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Per-source mappers
// ============================================================================

async function readSubscriptionEvents(
  companyId: string,
  limit: number,
  before: Date | undefined,
): Promise<TimelineEvent[]> {
  const conds = [eq(subscriptionEvents.companyId, companyId)];
  if (before) conds.push(lt(subscriptionEvents.createdAt, before));

  const rows = await db
    .select()
    .from(subscriptionEvents)
    .where(and(...conds))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const from = typeof meta.from === "string" ? meta.from : null;
    const to = typeof meta.to === "string" ? meta.to : null;
    const reason = typeof meta.reason === "string" ? meta.reason : null;
    const actorUserId = typeof meta.actorUserId === "string" ? meta.actorUserId : null;

    let title = `Subscription event: ${row.type}`;
    let subtitle: string | null = reason;
    let severity: TimelineSeverity = "info";

    switch (row.type) {
      case "status_changed":
        title = to ? `Subscription state changed to ${to}` : "Subscription state changed";
        subtitle = from && to ? `${from} → ${to}${reason ? ` (${reason})` : ""}` : reason;
        severity =
          to === "cancelled" || to === "past_due" ? "danger"
            : to === "active" ? "success"
            : to === "paused" ? "warning"
            : "info";
        break;
      case "trial_expired":
        title = "Trial expired";
        severity = "warning";
        break;
      case "cancelled":
        title = "Subscription cancelled";
        severity = "danger";
        break;
      case "signup":
        title = "Subscription signup";
        severity = "success";
        break;
      case "annual_renewed":
        title = "Annual subscription renewed";
        severity = "success";
        break;
      case "reverted_to_monthly":
        title = "Reverted to monthly billing";
        break;
      case "renewal_notice_30":
        title = "30-day renewal notice";
        break;
      case "renewal_notice_7":
        title = "7-day renewal notice";
        severity = "warning";
        break;
      case "manual_renewal":
        title = "Manual renewal";
        break;
    }

    return {
      id: `subscription_events:${row.id}`,
      timestamp: row.createdAt.toISOString(),
      kind: `subscription.${row.type}`,
      title,
      subtitle,
      actor: actorUserId ? { id: actorUserId } : null,
      severity,
      metadata: {
        ...meta,
        termEndDate: row.termEndDate ? row.termEndDate.toISOString() : null,
        subscriptionId: row.subscriptionId,
      },
      sourceTable: "subscription_events",
    };
  });
}

/** Severity heuristic for audit actions. */
function auditSeverity(action: string): TimelineSeverity {
  if (action.includes("failure") || action.includes("revoke") || action.includes("lockout")) return "danger";
  if (action.includes("stop") || action.includes("end") || action.includes("expire")) return "info";
  if (action.includes("start") || action.includes("create") || action.includes("grant")) return "warning";
  if (action.includes("update") || action.includes("change") || action.includes("patch")) return "info";
  if (action.includes("trial_adjustment") || action.includes("billing")) return "warning";
  return "info";
}

function humanizeAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function readAuditLogs(
  companyId: string,
  limit: number,
  before: Date | undefined,
): Promise<TimelineEvent[]> {
  const conds = [eq(auditLogs.targetCompanyId, companyId)];
  if (before) conds.push(lt(auditLogs.createdAt, before));

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const details = safeJson(row.details);
    return {
      id: `audit_logs:${row.id}`,
      timestamp: row.createdAt.toISOString(),
      kind: `audit.${row.action}`,
      title: humanizeAction(row.action),
      subtitle: row.reason ?? null,
      actor: {
        id: row.platformAdminId,
        email: row.platformAdminEmail,
        role: "platform",
      },
      severity: auditSeverity(row.action),
      metadata: {
        details,
        reason: row.reason,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        targetUserId: row.targetUserId,
      },
      sourceTable: "audit_logs",
    };
  });
}

/**
 * `impersonation_sessions` is a single physical table that stores BOTH
 * impersonation and read-only support sessions (discriminated by
 * `accessMode`). Each row can contribute up to 4 timeline events — one
 * per visible state transition.
 */
async function readSessionEvents(
  companyId: string,
  limit: number,
  before: Date | undefined,
  wantSupport: boolean,
  wantImpersonation: boolean,
): Promise<TimelineEvent[]> {
  if (!wantSupport && !wantImpersonation) return [];

  // Overfetch — each row can produce multiple events. Apply `before` after
  // fan-out to avoid missing late-transition events from older rows.
  const rows = await db
    .select()
    .from(impersonationSessions)
    .where(eq(impersonationSessions.companyId, companyId))
    .orderBy(desc(impersonationSessions.createdAt))
    .limit(limit * 2);

  const events: TimelineEvent[] = [];

  for (const row of rows) {
    const isImp = row.accessMode === "impersonation";
    const group: "support" | "impersonation" = isImp ? "impersonation" : "support";
    if (isImp && !wantImpersonation) continue;
    if (!isImp && !wantSupport) continue;

    const baseMeta = {
      sessionId: row.id,
      accessMode: row.accessMode,
      status: row.status,
      reason: row.reason,
      ownerUserId: row.ownerUserId,
      targetUserId: row.targetUserId,
      requestedDurationMinutes: row.requestedDurationMinutes,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };

    const label = isImp ? "Impersonation" : "Support";

    // Created
    const createdIso = row.createdAt.toISOString();
    events.push({
      id: `impersonation_sessions:${row.id}:created`,
      timestamp: createdIso,
      kind: `${group}.session_created`,
      title: `${label} session created`,
      subtitle: row.reason ?? null,
      actor: { id: row.ownerUserId, role: "platform" },
      severity: isImp ? "warning" : "info",
      metadata: baseMeta,
      sourceTable: "impersonation_sessions",
    });

    // Started (only if distinct from created, to avoid duplicate-row noise for
    // auto-active sessions where startedAt == createdAt)
    if (row.startedAt && row.startedAt.getTime() !== row.createdAt.getTime()) {
      events.push({
        id: `impersonation_sessions:${row.id}:started`,
        timestamp: row.startedAt.toISOString(),
        kind: `${group}.session_started`,
        title: `${label} session activated`,
        subtitle: null,
        actor: { id: row.ownerUserId, role: "platform" },
        severity: isImp ? "warning" : "info",
        metadata: baseMeta,
        sourceTable: "impersonation_sessions",
      });
    }

    // Revoked takes priority over ended (revoked = explicit cancel)
    if (row.revokedAt) {
      events.push({
        id: `impersonation_sessions:${row.id}:revoked`,
        timestamp: row.revokedAt.toISOString(),
        kind: `${group}.session_revoked`,
        title: `${label} session revoked`,
        subtitle: null,
        actor: null,
        severity: "danger",
        metadata: baseMeta,
        sourceTable: "impersonation_sessions",
      });
    } else if (row.endedAt) {
      events.push({
        id: `impersonation_sessions:${row.id}:ended`,
        timestamp: row.endedAt.toISOString(),
        kind: `${group}.session_ended`,
        title: `${label} session ended`,
        subtitle: row.endedReason ?? null,
        actor: null,
        severity: "info",
        metadata: { ...baseMeta, endedReason: row.endedReason },
        sourceTable: "impersonation_sessions",
      });
    }
  }

  // Apply `before` cursor after fan-out.
  if (before) {
    const cutoff = before.getTime();
    return events.filter((e) => new Date(e.timestamp).getTime() < cutoff);
  }
  return events;
}

async function readOverrideEvents(
  companyId: string,
  limit: number,
  before: Date | undefined,
): Promise<TimelineEvent[]> {
  const rows = await db
    .select({
      id: tenantFeatureOverrides.id,
      enabled: tenantFeatureOverrides.enabled,
      limitValue: tenantFeatureOverrides.limitValue,
      limitOverridden: tenantFeatureOverrides.limitOverridden,
      reason: tenantFeatureOverrides.reason,
      createdAt: tenantFeatureOverrides.createdAt,
      updatedAt: tenantFeatureOverrides.updatedAt,
      featureKey: subscriptionFeatures.featureKey,
      displayName: subscriptionFeatures.displayName,
    })
    .from(tenantFeatureOverrides)
    .innerJoin(
      subscriptionFeatures,
      eq(tenantFeatureOverrides.featureId, subscriptionFeatures.id),
    )
    .where(eq(tenantFeatureOverrides.companyId, companyId))
    .orderBy(desc(tenantFeatureOverrides.updatedAt))
    .limit(limit * 2);

  const events: TimelineEvent[] = [];

  for (const row of rows) {
    const enabledStr =
      row.enabled === true ? "enabled" : row.enabled === false ? "disabled" : null;
    const limitStr =
      row.limitOverridden ? `limit=${row.limitValue === null ? "unlimited" : row.limitValue}` : null;
    const parts = [enabledStr, limitStr].filter(Boolean);
    const effect = parts.length > 0 ? parts.join(", ") : "no effect";
    const featureLabel = row.displayName || row.featureKey;

    const baseMeta = {
      overrideId: row.id,
      featureKey: row.featureKey,
      enabled: row.enabled,
      limitValue: row.limitValue,
      limitOverridden: row.limitOverridden,
      reason: row.reason,
    };

    const isUpdate =
      row.updatedAt.getTime() - row.createdAt.getTime() > 1000; // >1s drift = updated

    events.push({
      id: `tenant_feature_overrides:${row.id}:${isUpdate ? "updated" : "created"}`,
      timestamp: (isUpdate ? row.updatedAt : row.createdAt).toISOString(),
      kind: `entitlement.override_${isUpdate ? "updated" : "created"}`,
      title: `Feature override ${isUpdate ? "updated" : "set"}: ${featureLabel}`,
      subtitle: `${effect}${row.reason ? ` — ${row.reason}` : ""}`,
      actor: null,
      severity: row.enabled === false ? "warning" : "info",
      metadata: baseMeta,
      sourceTable: "tenant_feature_overrides",
    });

    // If the row was updated AFTER creation, the "created" event is also
    // historically meaningful. Emit it as a second event so the history reads
    // chronologically.
    if (isUpdate) {
      events.push({
        id: `tenant_feature_overrides:${row.id}:created`,
        timestamp: row.createdAt.toISOString(),
        kind: "entitlement.override_created",
        title: `Feature override set: ${featureLabel}`,
        subtitle: `initial state${row.reason ? ` — ${row.reason}` : ""}`,
        actor: null,
        severity: "info",
        metadata: baseMeta,
        sourceTable: "tenant_feature_overrides",
      });
    }
  }

  if (before) {
    const cutoff = before.getTime();
    return events.filter((e) => new Date(e.timestamp).getTime() < cutoff);
  }
  return events;
}

async function readFeedbackEvents(
  companyId: string,
  limit: number,
  before: Date | undefined,
): Promise<TimelineEvent[]> {
  const conds = [eq(feedback.companyId, companyId)];
  if (before) conds.push(lt(feedback.createdAt, before));

  const rows = await db
    .select()
    .from(feedback)
    .where(and(...conds))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: `feedback:${row.id}`,
    timestamp: row.createdAt.toISOString(),
    kind: "feedback.submitted",
    title: row.title || `Feedback: ${row.category}`,
    subtitle: row.message.length > 140 ? `${row.message.slice(0, 137)}…` : row.message,
    actor: { id: row.userId, email: row.userEmail },
    severity:
      row.priority === "high" || row.priority === "urgent" ? "warning" : "info",
    metadata: {
      feedbackId: row.id,
      category: row.category,
      status: row.status,
      priority: row.priority,
      featureArea: row.featureArea,
      route: row.route,
      message: row.message,
      assignedTo: row.assignedTo,
    },
    sourceTable: "feedback",
  }));
}

async function readIssueEvents(
  companyId: string,
  limit: number,
  before: Date | undefined,
): Promise<TimelineEvent[]> {
  const conds = [eq(issueReports.tenantId, companyId)];
  if (before) conds.push(lt(issueReports.createdAt, before));

  const rows = await db
    .select()
    .from(issueReports)
    .where(and(...conds))
    .orderBy(desc(issueReports.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: `issue_reports:${row.id}`,
    timestamp: row.createdAt.toISOString(),
    kind: "issue.reported",
    title: row.title,
    subtitle: row.description
      ? row.description.length > 140 ? `${row.description.slice(0, 137)}…` : row.description
      : null,
    actor: row.userId ? { id: row.userId } : null,
    severity:
      row.severity === "critical" || row.severity === "high" ? "danger"
        : row.severity === "medium" ? "warning"
        : "info",
    metadata: {
      issueId: row.id,
      source: row.source,
      severity: row.severity,
      priority: row.priority,
      status: row.status,
      route: row.route,
      featureArea: row.featureArea,
      reproSteps: row.reproSteps,
      assignedTo: row.assignedTo,
      description: row.description,
    },
    sourceTable: "issue_reports",
  }));
}

// ============================================================================
// Public: getTimeline
// ============================================================================

export async function getTimeline(input: GetTimelineInput): Promise<GetTimelineResult> {
  const limit = clampLimit(input.limit);
  const groups = pickGroups(input.kinds);
  const perSource = limit; // each source returns up to `limit` candidates

  const [subEvs, auditEvs, sessionEvs, overrideEvs, fbEvs, issueEvs] = await Promise.all([
    groups.has("subscription")
      ? readSubscriptionEvents(input.companyId, perSource, input.before)
      : Promise.resolve([] as TimelineEvent[]),
    groups.has("audit")
      ? readAuditLogs(input.companyId, perSource, input.before)
      : Promise.resolve([] as TimelineEvent[]),
    groups.has("support") || groups.has("impersonation")
      ? readSessionEvents(
          input.companyId,
          perSource,
          input.before,
          groups.has("support"),
          groups.has("impersonation"),
        )
      : Promise.resolve([] as TimelineEvent[]),
    groups.has("entitlement")
      ? readOverrideEvents(input.companyId, perSource, input.before)
      : Promise.resolve([] as TimelineEvent[]),
    groups.has("feedback")
      ? readFeedbackEvents(input.companyId, perSource, input.before)
      : Promise.resolve([] as TimelineEvent[]),
    groups.has("issue")
      ? readIssueEvents(input.companyId, perSource, input.before)
      : Promise.resolve([] as TimelineEvent[]),
  ]);

  const merged = [
    ...subEvs, ...auditEvs, ...sessionEvs, ...overrideEvs, ...fbEvs, ...issueEvs,
  ];

  // Sort by timestamp desc, tiebreak on id for determinism.
  merged.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    if (tb !== ta) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;
  const nextBefore = hasMore && page.length > 0 ? page[page.length - 1].timestamp : null;

  return {
    tenantId: input.companyId,
    events: page,
    hasMore,
    nextBefore,
  };
}

export const tenantTimelineService = {
  getTimeline,
  TIMELINE_GROUPS,
};
