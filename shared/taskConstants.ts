/**
 * Shared task constants — consumed by both server and client.
 *
 * 2026-04-10: Created as a shared single source of truth for task type
 * subsets used by role-specific flows. The canonical `taskTypeEnum` in
 * `shared/schema.ts` defines ALL types; this file defines SUBSETS that
 * specific UX surfaces and validation schemas use.
 *
 * Do NOT duplicate this array in any file. Import from here.
 */

import type { TaskType } from "./schema";

/**
 * Task types a technician is allowed to create from the field.
 * QUOTE_ASSESSMENT is excluded (auto-created by the quote assessment scheduling flow).
 */
export const TECH_ALLOWED_TASK_TYPES = ["GENERAL"] as const satisfies readonly TaskType[];
