/**
 * Shared task constants — consumed by both server and client.
 *
 * 2026-04-10: Created as a shared single source of truth for task type
 * subsets used by role-specific flows. The canonical `taskTypeEnum` in
 * `shared/schema.ts` defines ALL types; this file defines SUBSETS that
 * specific UX surfaces and validation schemas use.
 *
 * GUARDRAIL: if a new tech-allowed task type is added, add it to
 * `TECH_ALLOWED_TASK_TYPES` below. Both the server validation schema
 * (`server/lib/taskSchemas.ts`) and the client type chooser UI
 * (`client/src/tech-app/pages/CreateTaskPage.tsx`) import this constant
 * — a single change propagates to both.
 *
 * Do NOT duplicate this array in any file. Import from here.
 */

import type { TaskType } from "./schema";

/**
 * Task types a technician is allowed to create from the field.
 *
 * QUOTE_ASSESSMENT is excluded because those tasks are auto-created by the
 * quote assessment scheduling flow, not by technicians.
 *
 * Typed as `readonly TaskType[]` so TypeScript catches any value that isn't
 * in the canonical `taskTypeEnum`. If `taskTypeEnum` renames or removes a
 * value, this constant breaks at compile time — no silent drift.
 */
export const TECH_ALLOWED_TASK_TYPES = ["GENERAL", "SUPPLIER_VISIT"] as const satisfies readonly TaskType[];
