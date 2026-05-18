import { z } from "zod";

export const moneyNumber = z.coerce.number().min(0).finite();
export const optionalMoneyNumber = moneyNumber.nullable().optional();

// =============================================================================
// JOB STATUS MODEL (4 lifecycle values + workflow sub-status)
// =============================================================================
//
// LIFECYCLE STATES (stored in jobs.status):
// - "open"      - Active job that can be worked on
// - "completed" - Work finished (may need invoicing)
// - "invoiced"  - Invoice created (locked for billing)
// - "archived"  - Historical archive (includes canceled jobs)
//
// DERIVED STATES (NOT stored in status, computed from fields):
// - "scheduled" is derived from: scheduledStart IS NOT NULL OR isAllDay = true
// - "assigned" is derived from: primaryTechnicianId IS NOT NULL OR assignedTechnicianIds.length > 0
//
// WORKFLOW SUB-STATUS (only valid when status = 'open'):
// - null           - Default, no special workflow state
// - "in_progress"  - Work actively being performed
// - "on_hold"      - Job is blocked (requires holdReason)
// - "on_route"     - Technician traveling to job site
// - (needs_review: removed — migrated to on_hold, data migrated, columns dropped)
//
// INVARIANT: openSubStatus must be NULL when status !== 'open'
//
// =============================================================================

// Lifecycle-only status enum (4 values)
export const jobStatusEnum = z.enum([
  "open",       // Active job that can be worked on
  "completed",  // Work finished (may need invoicing)
  "invoiced",   // Invoice created (locked for billing)
  "archived",   // Historical archive (includes canceled jobs)
]);

// Workflow sub-status (only valid when status = 'open')
// 2026-03-18: needs_review removed — data migrated to on_hold, no live rows remain.
export const openSubStatusEnum = z.enum([
  "in_progress",   // Work actively being performed
  "on_hold",       // Job is blocked (requires holdReason)
  "on_route",      // Technician traveling to job site
]);

// Hold reason enum (when openSubStatus = 'on_hold')
// Note: holdReason is REQUIRED when openSubStatus = 'on_hold'
export const holdReasonEnum = z.enum([
  "parts",      // Waiting for parts
  "customer",   // Waiting for customer response/approval
  "access",     // Cannot access location
  "approval",   // Waiting for internal approval
  "weather",    // Weather-related delay
  "other",      // Other reason (see notes)
]);

// 2026-03-18: legacyJobStatusEnum REMOVED — no longer imported anywhere.
// The jobs status update route now accepts only canonical values + two convenience
// aliases ("in_progress", "on_hold"). See server/routes/jobs.ts statusUpdateSchema.

// Invoice statuses - Canonical lifecycle: draft → awaiting_payment → partial_paid/paid (with void from any non-terminal)
// Note: "sent" is deprecated in favor of "awaiting_payment" but kept for backward compatibility
export const invoiceStatusEnum = z.enum([
  "draft",
  "awaiting_payment", // Invoice has been sent, waiting for payment
  "sent",             // LEGACY: Alias for awaiting_payment, kept for backward compatibility
  "partial_paid",
  "paid",
  "voided"
]);

export type JobStatus = z.infer<typeof jobStatusEnum>;
export type InvoiceStatus = z.infer<typeof invoiceStatusEnum>;
export type OpenSubStatus = z.infer<typeof openSubStatusEnum>;

// =============================================================================
// RUNTIME STATUS GUARD (Fail Fast)
// =============================================================================

const VALID_JOB_STATUSES: readonly JobStatus[] = ["open", "completed", "invoiced", "archived"];

/**
 * Assert that a job status is one of the 4 normalized lifecycle values.
 * Throws an error if a legacy status is detected.
 * Use this in any code path that persists or transforms job status.
 */
export function assertNormalizedJobStatus(status: string, context?: string): asserts status is JobStatus {
  if (!VALID_JOB_STATUSES.includes(status as JobStatus)) {
    const ctx = context ? ` [${context}]` : "";
    throw new Error(
      `INVALID_JOB_STATUS${ctx}: "${status}" is not a valid lifecycle status. ` +
      `Only ${VALID_JOB_STATUSES.join(", ")} are allowed. ` +
      `Legacy statuses must be normalized before persisting.`
    );
  }
}

export const itemBaseSchema = z.object({
  type: z.enum(["product", "service", "filter", "belt", "other"]),
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  cost: moneyNumber,
  markupPercent: optionalMoneyNumber,
  unitPrice: moneyNumber,
  isTaxable: z.coerce.boolean().default(true),
});

export type ItemInput = z.infer<typeof itemBaseSchema>;

export const jobCreateSchema = z.object({
  companyId: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  summary: z.string().min(1, "Summary is required"),
  description: z.string().optional().nullable(),
  accessInstructions: z.string().optional().nullable(),
  jobType: z.enum(["maintenance", "repair", "inspection", "installation", "emergency"]).default("maintenance"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  scheduledStart: z.string().datetime().optional().nullable(),
  scheduledEnd: z.string().datetime().optional().nullable(),
});

export type JobCreateInput = z.infer<typeof jobCreateSchema>;

export const jobUpdateStatusSchema = z.object({
  status: jobStatusEnum,
  // Workflow sub-status (only valid when status = 'open')
  openSubStatus: openSubStatusEnum.nullable().optional(),
  // Hold reason (required when openSubStatus = 'on_hold')
  holdReason: holdReasonEnum.nullable().optional(),
  holdNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // ISO date string (YYYY-MM-DD)
  // 2026-03-18: actionRequired* columns DROPPED from DB
}).refine(
  (data) => {
    // INVARIANT: openSubStatus must be NULL when status !== 'open'
    if (data.status !== 'open' && data.openSubStatus != null) {
      return false;
    }
    // INVARIANT: holdReason is required when openSubStatus = 'on_hold'
    if (data.openSubStatus === 'on_hold' && !data.holdReason) {
      return false;
    }
    return true;
  },
  {
    message: "openSubStatus requires status='open'; on_hold requires holdReason",
  }
);

export type JobUpdateStatusInput = z.infer<typeof jobUpdateStatusSchema>;

export const invoiceUpdateStatusSchema = z.object({
  status: invoiceStatusEnum,
});

export type InvoiceUpdateStatusInput = z.infer<typeof invoiceUpdateStatusSchema>;

export const invoiceLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: moneyNumber.default(1),
  unitPrice: moneyNumber,
  lineSubtotal: moneyNumber.optional(),
  taxCode: z.string().optional().nullable(),
  qboItemRef: z.string().optional().nullable(),
  equipmentId: z.string().uuid().optional().nullable(),
  partId: z.string().uuid().optional().nullable(),
});

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemSchema>;

import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/* =========================================================
   TASK ENUMS
   ========================================================= */

export const taskTypeEnum = pgEnum("task_type", [
  "GENERAL",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "OPEN",
  "CLOSED",
]);

/* =========================================================
   TASKS
   ========================================================= */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    companyId: uuid("company_id").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    assignedToUserId: uuid("assigned_to_user_id"),

    type: taskTypeEnum("type").notNull(),

    title: text("title").notNull(),
    notes: text("notes"),

    status: taskStatusEnum("status")
      .notNull()
      .default("OPEN"),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: uuid("closed_by_user_id"),

    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),

    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),

    jobId: uuid("job_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    companyStatusIdx: index("tasks_company_status_idx").on(
      t.companyId,
      t.status
    ),
    companyAssignedIdx: index("tasks_company_assigned_idx").on(
      t.companyId,
      t.assignedToUserId
    ),
    companyTypeIdx: index("tasks_company_type_idx").on(
      t.companyId,
      t.type
    ),
  })
);

/* =========================================================
   SUPPLIERS
   ========================================================= */

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),

  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

