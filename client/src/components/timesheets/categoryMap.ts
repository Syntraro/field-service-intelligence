/**
 * Day View category mapping (2026-05-04).
 *
 * The Day View redesign collapses the 9-value `timeEntryTypeEnum` (in
 * `shared/schema.ts`) into 3 user-visible categories: on-site / drive /
 * general. The DB schema is unchanged — this file is a pure UI helper.
 *
 *   on-site → on_site, task_work
 *   drive   → travel_to_job, travel_to_supplier, travel_between_jobs, supplier_run
 *   general → admin, break, other
 *
 * Existing entries with finer-grained drive types (e.g. travel_to_supplier)
 * display under "Drive" but their stored type is preserved on edit. The
 * inline editor's 3-way radio commits a default enum on save:
 *
 *   On-site → on_site
 *   Drive   → travel_to_job
 *   General → other
 */

export type EntryCategory = "onsite" | "drive" | "general";

const CATEGORY_BY_TYPE: Record<string, EntryCategory> = {
  on_site: "onsite",
  task_work: "onsite",
  travel_to_job: "drive",
  travel_to_supplier: "drive",
  travel_between_jobs: "drive",
  supplier_run: "drive",
  admin: "general",
  break: "general",
  other: "general",
};

const DEFAULT_TYPE_BY_CATEGORY: Record<EntryCategory, string> = {
  onsite: "on_site",
  drive: "travel_to_job",
  general: "other",
};

/** Bucket an enum value into a UI category. Unknown enum values fall to `general`. */
export function categoryForType(type: string | null | undefined): EntryCategory {
  if (!type) return "general";
  return CATEGORY_BY_TYPE[type] ?? "general";
}

/** Default enum value to commit when the user selects a UI category in the editor. */
export function defaultTypeForCategory(category: EntryCategory): string {
  return DEFAULT_TYPE_BY_CATEGORY[category];
}

/**
 * When the user changes the category in the editor, prefer to keep the
 * existing enum value if it already maps to the new category (so a row
 * stored as `travel_to_supplier` doesn't silently flatten to `travel_to_job`
 * on a no-op category re-select). Otherwise commit the new category default.
 */
export function commitTypeForCategoryChange(
  currentType: string | null | undefined,
  newCategory: EntryCategory,
): string {
  if (currentType && categoryForType(currentType) === newCategory) {
    return currentType;
  }
  return defaultTypeForCategory(newCategory);
}

export interface CategoryStyle {
  label: string;
  /** Tailwind dot color (used in timeline + category strip). */
  dot: string;
  /** Tailwind chip background + text classes. */
  chip: string;
}

export const CATEGORY_STYLE: Record<EntryCategory, CategoryStyle> = {
  onsite: {
    label: "On-site",
    dot: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  drive: {
    label: "Drive",
    dot: "bg-blue-500",
    chip: "bg-blue-100 text-blue-700 border-blue-200",
  },
  general: {
    label: "General",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

/** Default `billable` value when the user selects a category from scratch. */
export function defaultBillableForCategory(category: EntryCategory): boolean {
  return category !== "general";
}
