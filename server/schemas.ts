import { z } from "zod";

export const moneyNumber = z.coerce.number().min(0).finite();
export const optionalMoneyNumber = moneyNumber.nullable().optional();

export const jobStatusEnum = z.enum([
  "draft",
  "scheduled", 
  "dispatched",
  "en_route",
  "on_site",
  "in_progress",
  "needs_parts",
  "on_hold",
  "completed",
  "invoiced",
  "closed",
  "archived",
  "cancelled"
]);

export const invoiceStatusEnum = z.enum([
  "draft",
  "pending",
  "sent",
  "paid",
  "partial_paid",
  "voided",
  "cancelled"
]);

export type JobStatus = z.infer<typeof jobStatusEnum>;
export type InvoiceStatus = z.infer<typeof invoiceStatusEnum>;

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
  assignedTechnicianId: z.string().uuid().optional().nullable(),
  calendarAssignmentId: z.string().uuid().optional().nullable(),
});

export type JobCreateInput = z.infer<typeof jobCreateSchema>;

export const jobUpdateStatusSchema = z.object({
  status: jobStatusEnum,
});

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
  "SUPPLIER_VISIT",
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

/* =========================================================
   SUPPLIER VISIT DETAILS (1:1 WITH TASK)
   ========================================================= */

export const supplierVisitDetails = pgTable("supplier_visit_details", {
  taskId: uuid("task_id").primaryKey(),

  supplierId: uuid("supplier_id"),
  supplierNameOther: text("supplier_name_other"),
  poNumber: text("po_number"),

  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  reconciledByUserId: uuid("reconciled_by_user_id"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
