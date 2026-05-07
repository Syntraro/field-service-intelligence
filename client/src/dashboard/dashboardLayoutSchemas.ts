/**
 * Dashboard layout payload schemas (2026-05-07 RALPH).
 *
 * Pure zod + TypeScript — no React, no DOM. Both client (mutation
 * payload validation) and server (route input validation) consume
 * these. Keeping schemas in one shared module guarantees the wire
 * contract stays in lockstep across the two sides.
 *
 * The schemas validate STRUCTURE only. Per-widget permission
 * enforcement happens AFTER schema validation in the server route —
 * the registry is the source of truth for "is this widget allowed
 * for this user", and the schema cannot encode that.
 */
import { z } from "zod";

/** One layout row in the PUT payload. Maps 1:1 onto a row in
 *  `user_dashboard_widgets` (with user_id + dashboard_key supplied by
 *  the route handler from the request context). */
export const dashboardLayoutEntrySchema = z.object({
  /** Canonical widget key; validated against the shared registry by
   *  the server. Lowercase snake_case matching `DashboardWidgetDefinition.key`. */
  widgetKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "widgetKey must be snake_case"),
  /** Visibility override. */
  visible: z.boolean(),
  /** 0-based ordering index. */
  orderIndex: z.number().int().min(0).max(999),
}).strict();

/** Full PUT body — replaces the user's layout for one dashboard in
 *  one round-trip. The server treats the array as the complete new
 *  layout (delete-then-insert in one transaction); entries omitted
 *  from the array fall back to registry defaults on read. */
export const dashboardLayoutPutSchema = z.object({
  /** Namespacing key (e.g., "financial"). Server validates against
   *  the registry's known dashboard keys; unknown keys → 400. */
  dashboardKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "dashboardKey must be snake_case"),
  /** Layout rows. Empty array is permitted (resets to defaults).
   *  No duplicate widgetKeys allowed — the storage upsert relies on
   *  uniqueness per (user, dashboard, widget). */
  widgets: z
    .array(dashboardLayoutEntrySchema)
    .max(64)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.widgetKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate widgetKey: ${r.widgetKey}`,
            path: ["widgets"],
          });
          return;
        }
        seen.add(r.widgetKey);
      }
    }),
}).strict();

export type DashboardLayoutEntry = z.infer<typeof dashboardLayoutEntrySchema>;
export type DashboardLayoutPut = z.infer<typeof dashboardLayoutPutSchema>;

/** Server response shape for both GET and PUT. Mirrors the shared
 *  registry's `DashboardWidgetDefinition` plus the user override
 *  fields, so the client hook can render the dashboard without
 *  re-importing the registry on every render. */
export interface DashboardLayoutResponseEntry {
  widgetKey: string;
  visible: boolean;
  orderIndex: number;
  /** Server-side derived from the registry; included so the client
   *  can render the customize drawer without reading the shared
   *  registry too. Mirror of `DashboardWidgetDefinition.title`. */
  title: string;
  /** Mirror of `DashboardWidgetDefinition.sizePreset`. */
  sizePreset: "full" | "two-thirds" | "third";
  /** Mirror of `DashboardWidgetDefinition.heightPreset`. */
  heightPreset: "summary" | "large" | "compact" | "auto";
  /** Mirror of `DashboardWidgetDefinition.description`. */
  description: string | null;
  /** True iff the row is permission-allowed for the requesting user.
   *  Always true on GET (server filters); included on the type for
   *  forward compatibility. */
  allowed: boolean;
}

export interface DashboardLayoutResponse {
  dashboardKey: string;
  widgets: DashboardLayoutResponseEntry[];
}
