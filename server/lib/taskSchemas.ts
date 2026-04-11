/**
 * Canonical task validation schemas.
 *
 * Single source of truth for the Zod schemas used by every route that
 * creates or updates a task. Both the office route (`POST /api/tasks` in
 * `server/routes/tasks.routes.ts`) and the tech route (`POST /api/tech/tasks`
 * in `server/routes/techField.ts`) import from here.
 *
 * 2026-04-10: Extracted from tasks.routes.ts to eliminate schema drift
 * between the office and tech create routes. The tech route DERIVES its
 * validation from `createTaskSchema` via `.pick().extend().strict()` —
 * it never re-declares field definitions.
 *
 * GUARDRAIL: do not copy-paste these schemas into other files. Import them.
 * If a route needs a subset or extension, use Zod composition:
 *   createTaskSchema.pick({...}).extend({...}).strict()
 */

import { z } from "zod";
import { taskStatusEnum } from "@shared/schema";

// ============================================================================
// Canonical create schema — office route (full feature set)
// ============================================================================

/**
 * Canonical task creation schema. All fields that the office `POST /api/tasks`
 * route accepts are defined here. The tech route picks a subset.
 *
 * NOTE: `type` is `z.string().max(50).optional()` intentionally — the office
 * route allows any type string (including QUOTE_ASSESSMENT and future types).
 * The tech route narrows this to `z.enum(TECH_ALLOWED_TASK_TYPES)`.
 */
export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  description: z.string().max(2000).optional(), // Legacy alias for notes
  dueDate: z.string().datetime().optional(),
  assignedToUserId: z.string().uuid().optional(),
  type: z.string().max(50).optional(),
  jobId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  status: z.enum(taskStatusEnum).optional().default("pending"),
  scheduledStartAt: z.preprocess(
    (val) => (typeof val === "string" && val.trim() !== "" ? val : undefined),
    z.string().datetime().optional(),
  ),
  scheduledEndAt: z.preprocess(
    (val) => (typeof val === "string" && val.trim() !== "" ? val : undefined),
    z.string().datetime().optional(),
  ),
  allDay: z.boolean().optional(),
  // 2026-04-10: Task billable flag. Server applies default: jobId → true, no jobId → false.
  isBillable: z.boolean().optional(),
}).strict();

// ============================================================================
// Canonical update schema — office route (partial)
// ============================================================================

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  status: z.enum(taskStatusEnum).optional(),
  type: z.string().max(50).optional(),
  jobId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  scheduledStartAt: z.preprocess(
    (val) => (val === null || (typeof val === "string" && val.trim() === "") ? undefined : val),
    z.string().datetime().optional(),
  ),
  scheduledEndAt: z.preprocess(
    (val) => (val === null || (typeof val === "string" && val.trim() === "") ? undefined : val),
    z.string().datetime().optional(),
  ),
  allDay: z.boolean().optional(),
  isBillable: z.boolean().optional(),
}).strict();

// ============================================================================
// Tech-allowed task types — re-export from shared for server consumers
// ============================================================================
//
// 2026-04-10: The canonical constant now lives in `@shared/taskConstants`
// so both server and client import from the SAME source. This file
// re-exports it so existing server consumers don't need to change their
// import paths.
export { TECH_ALLOWED_TASK_TYPES } from "@shared/taskConstants";
