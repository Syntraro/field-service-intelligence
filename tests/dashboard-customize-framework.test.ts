/**
 * Customizable Dashboard Framework — source-pin contract tests
 * (2026-05-07 RALPH).
 *
 * Locks the architectural contracts established by the new
 * `client/src/dashboard/` framework + the `/api/dashboard-layout`
 * route + the `user_dashboard_widgets` schema. Source-pin tests
 * because the framework's behaviour is decided at construction time
 * (registry shape, route signatures, schema contract) rather than
 * inside React reconciliation, so a failing pin always points at the
 * concrete file the brief asked us to honour.
 *
 * Render-time DnD behaviour (drag-end → PUT) and React hook lifecycle
 * are out of scope for source pins — they would require booting JSDOM
 * + @dnd-kit + a mocked fetch layer, which is excessive for the brief
 * in this codebase. The mutation/query path is fully typed against
 * `dashboardLayoutSchemas.ts` so an integration test could be added
 * later if a regression is observed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import {
  DASHBOARD_KEYS,
  DASHBOARD_WIDGETS,
  FINANCIAL_DASHBOARD_WIDGETS,
  getDashboardWidget,
  isKnownDashboard,
  listDashboardWidgets,
  type DashboardWidgetDefinition,
} from "../shared/dashboardWidgetRegistry";
import {
  dashboardLayoutPutSchema,
  dashboardLayoutEntrySchema,
} from "../client/src/dashboard/dashboardLayoutSchemas";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const REGISTRY_PATH = path("shared/dashboardWidgetRegistry.ts");
const SCHEMAS_PATH = path("client/src/dashboard/dashboardLayoutSchemas.ts");
const HOOK_PATH = path("client/src/dashboard/useDashboardLayout.ts");
const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");
const DRAWER_PATH = path("client/src/dashboard/DashboardCustomizeDrawer.tsx");
const RENDERER_PATH = path("client/src/dashboard/DashboardWidgetRenderer.tsx");
const ROUTE_PATH = path("server/routes/dashboardLayout.ts");
const STORAGE_PATH = path("server/storage/userDashboardWidgets.ts");
const SCHEMA_TS_PATH = path("shared/schema.ts");
const MIGRATION_PATH = path("migrations/2026_05_07_user_dashboard_widgets.sql");
const DASH_PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");
const ROUTES_INDEX = path("server/routes/index.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Files exist at the canonical paths ─────────────────────────

describe("Dashboard framework — canonical file layout", () => {
  for (const p of [
    REGISTRY_PATH,
    SCHEMAS_PATH,
    HOOK_PATH,
    GRID_PATH,
    DRAWER_PATH,
    RENDERER_PATH,
    ROUTE_PATH,
    STORAGE_PATH,
    MIGRATION_PATH,
  ]) {
    it(`file exists: ${p.replace(ROOT, "")}`, () => {
      expect(existsSync(p)).toBe(true);
    });
  }
});

// ─── 2. Registry shape + financial widget set ──────────────────────

describe("Shared widget registry — shape + canonical widget set", () => {
  it("exposes the canonical helpers + types", () => {
    expect(typeof getDashboardWidget).toBe("function");
    expect(typeof listDashboardWidgets).toBe("function");
    expect(typeof isKnownDashboard).toBe("function");
    expect(Array.isArray(DASHBOARD_WIDGETS)).toBe(true);
    expect(Array.isArray(DASHBOARD_KEYS)).toBe(true);
  });

  it("recognizes the `financial` dashboard key", () => {
    expect(isKnownDashboard("financial")).toBe(true);
    expect(isKnownDashboard("nonexistent")).toBe(false);
  });

  it("the financial widget set contains all six canonical widgets in the brief's default order", () => {
    // 2026-05-07 RALPH: order matches the brief's expected default
    // layout — row 1 = TS + Pipeline, row 2 = Collections + Scheduled
    // Revenue + Operational Alerts, row 3 = Needs Attention.
    const keys = FINANCIAL_DASHBOARD_WIDGETS.map((w) => w.key);
    expect(keys).toEqual([
      "todays_schedule",
      "pipeline_snapshot",
      "collections_overview",
      "scheduled_revenue",
      "operational_alerts",
      "needs_attention",
    ]);
  });

  it("every widget carries the registry contract fields", () => {
    for (const w of FINANCIAL_DASHBOARD_WIDGETS) {
      expect(typeof w.key).toBe("string");
      expect(w.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(w.dashboardKey).toBe("financial");
      expect(typeof w.title).toBe("string");
      expect(w.title.length).toBeGreaterThan(0);
      expect(typeof w.defaultVisible).toBe("boolean");
      expect(typeof w.defaultOrder).toBe("number");
      expect(["full", "two-thirds", "third"]).toContain(w.sizePreset);
      // requiredPermission is null OR a non-empty string.
      expect(
        w.requiredPermission === null ||
          (typeof w.requiredPermission === "string" && w.requiredPermission.length > 0),
      ).toBe(true);
    }
  });

  it("getDashboardWidget returns null for unknown keys + the row for known keys", () => {
    expect(getDashboardWidget("financial", "nonexistent")).toBeNull();
    expect(getDashboardWidget("nonexistent", "todays_schedule")).toBeNull();
    const w = getDashboardWidget("financial", "todays_schedule");
    expect(w).not.toBeNull();
    expect(w!.title).toBe("Today's Schedule");
  });

  it("listDashboardWidgets returns widgets in defaultOrder ascending", () => {
    const list = listDashboardWidgets("financial");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].defaultOrder).toBeGreaterThan(list[i - 1].defaultOrder);
    }
  });
});

// ─── 3. Registry purity (no React) ─────────────────────────────────

describe("Shared widget registry — purity contract (no React imports)", () => {
  it("does NOT import React or any client-only module", () => {
    const src = read(REGISTRY_PATH);
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toMatch(/from\s+['"]react['"]/);
    expect(codeOnly).not.toMatch(/from\s+['"]@\/components/);
    expect(codeOnly).not.toMatch(/from\s+['"]@dnd-kit/);
  });
});

// ─── 4. Layout schema contracts (zod) ──────────────────────────────

describe("Layout PUT schema — accepts well-formed payloads", () => {
  it("accepts a typical replace payload", () => {
    const ok = dashboardLayoutPutSchema.safeParse({
      dashboardKey: "financial",
      widgets: [
        { widgetKey: "todays_schedule", visible: true, orderIndex: 0 },
        { widgetKey: "needs_attention", visible: false, orderIndex: 1 },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts an empty widgets array (degenerate reset)", () => {
    const ok = dashboardLayoutPutSchema.safeParse({
      dashboardKey: "financial",
      widgets: [],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects non-snake_case widget keys", () => {
    const r = dashboardLayoutEntrySchema.safeParse({
      widgetKey: "TodaysSchedule",
      visible: true,
      orderIndex: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate widgetKey entries", () => {
    const r = dashboardLayoutPutSchema.safeParse({
      dashboardKey: "financial",
      widgets: [
        { widgetKey: "needs_attention", visible: true, orderIndex: 0 },
        { widgetKey: "needs_attention", visible: false, orderIndex: 1 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative or out-of-range orderIndex", () => {
    expect(
      dashboardLayoutEntrySchema.safeParse({
        widgetKey: "ok_widget",
        visible: true,
        orderIndex: -1,
      }).success,
    ).toBe(false);
    expect(
      dashboardLayoutEntrySchema.safeParse({
        widgetKey: "ok_widget",
        visible: true,
        orderIndex: 1000,
      }).success,
    ).toBe(false);
  });
});

// ─── 5. Server route contract ──────────────────────────────────────

describe("dashboardLayoutRouter — handler contract", () => {
  const src = read(ROUTE_PATH);
  const codeOnly = stripComments(src);

  it("registers GET / PUT / POST /reset endpoints", () => {
    expect(src).toMatch(/router\.get\(\s*["']\/["']/);
    expect(src).toMatch(/router\.put\(\s*["']\/["']/);
    expect(src).toMatch(/router\.post\(\s*["']\/reset["']/);
  });

  it("mount-level requires the canonical dashboard.view permission", () => {
    expect(src).toMatch(/router\.use\(requirePermission\(\s*["']dashboard\.view["']/);
  });

  it("PUT validates body via dashboardLayoutPutSchema", () => {
    expect(src).toMatch(/validateSchema\(dashboardLayoutPutSchema/);
  });

  it("PUT validates each widget against the registry + per-widget permission", () => {
    expect(codeOnly).toMatch(/getDashboardWidget\(body\.dashboardKey,\s*entry\.widgetKey\)/);
    expect(codeOnly).toMatch(/userHasPermission\(userId,\s*def\.requiredPermission\)/);
  });

  it("rejects unknown dashboardKey + widget keys at HTTP 400", () => {
    expect(src).toMatch(/Unknown dashboardKey:/);
    expect(src).toMatch(/Unknown widgetKey/);
  });

  it("rejects unauthorized widgets at HTTP 403", () => {
    expect(src).toMatch(/createError\(\s*403,\s*[`'"]Forbidden:/);
  });

  it("router is mounted at /api/dashboard-layout in routes/index.ts", () => {
    const idx = read(ROUTES_INDEX);
    expect(idx).toMatch(/import dashboardLayoutRouter from "\.\/dashboardLayout"/);
    expect(idx).toMatch(
      /app\.use\(\s*["']\/api\/dashboard-layout["']\s*,\s*dashboardLayoutRouter\s*\)/,
    );
  });

  it("uses the canonical storage repository (no inline DB queries)", () => {
    expect(src).toMatch(/userDashboardWidgetsRepository\.listForUser/);
    expect(src).toMatch(/userDashboardWidgetsRepository\.replaceForUser/);
    expect(src).toMatch(/userDashboardWidgetsRepository\.resetForUser/);
  });
});

// ─── 6. Storage layer contract ─────────────────────────────────────

describe("userDashboardWidgetsRepository — storage contract", () => {
  const src = read(STORAGE_PATH);

  it("exposes listForUser / replaceForUser / resetForUser", () => {
    expect(src).toMatch(/async function listForUser\(/);
    expect(src).toMatch(/async function replaceForUser\(/);
    expect(src).toMatch(/async function resetForUser\(/);
    expect(src).toMatch(
      /export const userDashboardWidgetsRepository\s*=\s*\{[\s\S]+?listForUser[\s\S]+?replaceForUser[\s\S]+?resetForUser/,
    );
  });

  it("replaceForUser runs DELETE + INSERT inside a single transaction", () => {
    expect(src).toMatch(/db\.transaction\(/);
    // Drizzle method chains span multiple lines: `await tx\n.delete(...)`.
    // Allow whitespace + newlines between `tx` and `.delete(...)` /
    // `.insert(...)`.
    expect(src).toMatch(/\btx\s*\.\s*delete\(userDashboardWidgets\)/);
    expect(src).toMatch(/\btx\s*\.\s*insert\(userDashboardWidgets\)/);
  });

  it("resetForUser deletes only the (user, dashboard) rows", () => {
    expect(src).toMatch(
      /db\s*\.delete\(userDashboardWidgets\)[\s\S]+?eq\(userDashboardWidgets\.userId,\s*userId\)[\s\S]+?eq\(userDashboardWidgets\.dashboardKey,\s*dashboardKey\)/,
    );
  });
});

// ─── 7. Drizzle schema + migration ─────────────────────────────────

describe("user_dashboard_widgets — schema + migration", () => {
  it("Drizzle schema declares the table with the canonical columns", () => {
    const schema = read(SCHEMA_TS_PATH);
    expect(schema).toMatch(
      /export const userDashboardWidgets\s*=\s*pgTable\(\s*"user_dashboard_widgets"/,
    );
    // Required columns.
    expect(schema).toMatch(/userId:\s*varchar\("user_id"\)/);
    expect(schema).toMatch(/dashboardKey:\s*text\("dashboard_key"\)/);
    expect(schema).toMatch(/widgetKey:\s*text\("widget_key"\)/);
    expect(schema).toMatch(/visible:\s*boolean\("visible"\)/);
    expect(schema).toMatch(/orderIndex:\s*integer\("order_index"\)/);
    // Uniqueness constraint.
    expect(schema).toMatch(/userKeyWidgetUq:\s*uniqueIndex\(/);
    expect(schema).toMatch(/lookupIdx:\s*index\(/);
  });

  it("migration creates the table with the unique constraint + lookup index", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_dashboard_widgets/);
    expect(sql).toMatch(
      /CONSTRAINT user_dashboard_widgets_unique\s+UNIQUE\s*\(\s*user_id,\s*dashboard_key,\s*widget_key/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_user_dashboard_widgets_lookup/,
    );
  });
});

// ─── 8. useDashboardLayout hook contract ───────────────────────────

describe("useDashboardLayout — hook contract", () => {
  const src = read(HOOK_PATH);

  it("uses ['dashboard-layout', dashboardKey] as the canonical query key", () => {
    expect(src).toMatch(
      /\["dashboard-layout",\s*dashboardKey\]\s*as const/,
    );
  });

  it("disables refetchOnWindowFocus to keep the live cache stable while editing", () => {
    expect(src).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it("applies optimistic update on mutation + rolls back on error", () => {
    expect(src).toMatch(/onMutate:[\s\S]+?queryClient\.setQueryData/);
    expect(src).toMatch(/onError:[\s\S]+?ctx\?\.previous[\s\S]+?queryClient\.setQueryData/);
  });

  it("exposes the canonical mutators (setVisibility / setOrder / reset)", () => {
    expect(src).toMatch(/const setVisibility = useCallback\(/);
    expect(src).toMatch(/const setOrder = useCallback\(/);
    expect(src).toMatch(/const reset = useCallback\(/);
  });
});

// ─── 9. Grid + drawer + renderer contracts ─────────────────────────

describe("DashboardWidgetGrid — canonical grid contract", () => {
  const src = read(GRID_PATH);
  it("renders a 12-column responsive grid with dense flow", () => {
    // 2026-05-07 RALPH: `grid-flow-row-dense` lets smaller cards
    // backfill empty slots next to a row-span-2 widget without
    // breaking the existing 12-column layout.
    expect(src).toMatch(/grid grid-cols-12 grid-flow-row-dense gap-3/);
  });
  it("maps every widthUnits value to a Tailwind col-span", () => {
    // Natural-span lookup is keyed by the canonical 3-column width
    // unit (1 | 2 | 3), not by the legacy preset string. The unit
    // model collapses every sizePreset into 1, 2, or 3 columns.
    expect(src).toMatch(/1:\s*"col-span-12 md:col-span-6 xl:col-span-4"/);
    expect(src).toMatch(/2:\s*"col-span-12 xl:col-span-8"/);
    expect(src).toMatch(/3:\s*"col-span-12"/);
  });
  it("exposes the canonical preset → widthUnits mapping", () => {
    expect(src).toMatch(/PRESET_WIDTH_UNITS/);
    expect(src).toMatch(/third:\s*1/);
    expect(src).toMatch(/"two-thirds":\s*2/);
    expect(src).toMatch(/full:\s*3/);
  });
  it("warns (dev only) when a renderer is missing — never throws", () => {
    expect(src).toMatch(/console\.warn\(/);
    expect(src).not.toMatch(/throw new Error\(/);
  });
});

describe("DashboardCustomizeDrawer — canonical sheet contract", () => {
  const src = read(DRAWER_PATH);
  it("uses the canonical Sheet primitives + side='right'", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/sheet["']/);
    expect(src).toMatch(/<SheetContent[\s\S]+?side="right"/);
  });
  it("uses @dnd-kit for sortable + keyboard sensors", () => {
    expect(src).toMatch(/from\s+["']@dnd-kit\/core["']/);
    expect(src).toMatch(/from\s+["']@dnd-kit\/sortable["']/);
    expect(src).toMatch(/PointerSensor/);
    expect(src).toMatch(/KeyboardSensor/);
  });
  it("calls layout.setOrder(arrayMove(...)) on drag end", () => {
    expect(src).toMatch(/arrayMove\(layout\.widgets,\s*oldIndex,\s*newIndex\)/);
    expect(src).toMatch(/layout\.setOrder\(/);
  });
  it("renders the Reset to defaults + Done buttons with canonical testids", () => {
    expect(src).toMatch(/data-testid="dashboard-customize-reset"/);
    expect(src).toMatch(/data-testid="dashboard-customize-done"/);
  });
  it("uses tokenized typography only (no raw text-* font sizes on chrome)", () => {
    const codeOnly = stripComments(src);
    // The drawer must reach for canonical tokens — no inline arbitrary sizes.
    expect(codeOnly).not.toMatch(/className="[^"]*\btext-\[\d+px\]/);
    // The title uses text-section-title; description uses text-caption.
    expect(src).toMatch(/className="text-section-title text-text-primary"/);
    expect(src).toMatch(/className="text-caption text-text-muted"/);
  });
});

describe("DashboardWidgetRenderer — sortable row contract", () => {
  const src = read(RENDERER_PATH);
  it("uses @dnd-kit/sortable's useSortable + CSS.Transform.toString", () => {
    expect(src).toMatch(/useSortable\(\s*\{\s*id:\s*widget\.widgetKey\s*\}/);
    expect(src).toMatch(/CSS\.Transform\.toString\(transform\)/);
  });
  it("uses the canonical Switch primitive", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/switch["']/);
    expect(src).toMatch(/<Switch\b/);
  });
  it("drag handle is a focusable button with aria-label", () => {
    // `<button` opening tag with `type="button"` and a templated
    // `aria-label={`Reorder ${widget.title}`}`. Attributes can be
    // multi-line; the `\s+` allows newlines between them.
    expect(src).toMatch(
      /<button[\s\S]+?type="button"[\s\S]+?aria-label=\{`Reorder \$\{widget\.title\}`\}/,
    );
  });
});

// ─── 10. FinancialDashboard wiring ─────────────────────────────────

describe("FinancialDashboard — wired through the framework", () => {
  const src = read(DASH_PAGE_PATH);
  it("uses the framework's hook + grid", () => {
    expect(src).toMatch(/from\s+["']@\/dashboard\/useDashboardLayout["']/);
    expect(src).toMatch(/from\s+["']@\/dashboard\/DashboardWidgetGrid["']/);
    expect(src).toMatch(/from\s+["']@\/dashboard\/DashboardCustomizeDrawer["']/);
    expect(src).toMatch(/useDashboardLayout\("financial"\)/);
    expect(src).toMatch(/<DashboardWidgetGrid\b[\s\S]+?widgets=\{layout\.visibleWidgets\}/);
  });

  it("renderer map keys match every registered widget on the financial dashboard", () => {
    for (const w of FINANCIAL_DASHBOARD_WIDGETS) {
      const re = new RegExp(`${w.key}:\\s*\\(`);
      expect(src).toMatch(re);
    }
  });

  it("does NOT carry the prior hardcoded grid wrappers", () => {
    expect(src).not.toMatch(/grid grid-cols-1 md:grid-cols-3 gap-3 mb-3/);
    expect(src).not.toMatch(
      /grid grid-cols-1 xl:grid-cols-\[minmax\(0,1fr\)_auto\] gap-3 mb-3/,
    );
  });

  it("mounts the customize button + drawer", () => {
    expect(src).toMatch(/data-testid="dashboard-customize-button"/);
    expect(src).toMatch(/<DashboardCustomizeDrawer\b[\s\S]+?dashboardKey="financial"/);
  });
});

// ─── 11. Reuse-of-canonical-primitives sweep ───────────────────────

describe("Framework — no duplicate primitives, no one-off custom card chrome", () => {
  function collectFrameworkFiles(): string[] {
    const dir = path("client/src/dashboard");
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isFile() && /\.(tsx?|jsx?)$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("does NOT define a parallel CardShell replacement", () => {
    for (const f of collectFrameworkFiles()) {
      const src = read(f);
      const codeOnly = stripComments(src);
      // No new `function CardSomething(` wrapper that mirrors the
      // CardShell API. Drag rows + grid wrappers are bare divs — the
      // widgets themselves provide the card chrome.
      expect(codeOnly).not.toMatch(/function\s+(?:Dashboard)?Card(?:Shell|Wrapper|Container)\b/);
    }
  });

  it("does NOT introduce arbitrary text-[N] sizes anywhere in the framework", () => {
    for (const f of collectFrameworkFiles()) {
      const src = read(f);
      const codeOnly = stripComments(src);
      expect(codeOnly).not.toMatch(/className="[^"]*\btext-\[\d+px\]/);
    }
  });

  it("does NOT redefine the Sheet primitive", () => {
    for (const f of collectFrameworkFiles()) {
      const src = read(f);
      const codeOnly = stripComments(src);
      // Sheet must come from `@/components/ui/sheet` — no parallel
      // dialog/sheet wrapper allowed.
      if (codeOnly.includes("Sheet")) {
        expect(codeOnly).toMatch(/from\s+["']@\/components\/ui\/sheet["']/);
      }
    }
  });
});
