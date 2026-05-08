/**
 * Dashboard drag-and-drop — source-pin contract tests.
 *
 * 2026-05-07 RALPH (drag relocation): drag/reorder was originally
 * placed inside the Customize Dashboard drawer — wrong interaction
 * surface. Drag now lives on the dashboard grid itself; the drawer
 * is a pure toggle list.
 *
 * This file pins the new contract:
 *   1. The grid mounts the @dnd-kit context with mouse + touch +
 *      keyboard sensors (iPad reliability + a11y).
 *   2. Each grid cell becomes a `useSortable` item with a small
 *      drag-handle button positioned in the cell corner. The handle
 *      is touch-friendly (touch-none, cursor-grab).
 *   3. The Customize drawer carries NO drag wiring (no DndContext,
 *      no SortableContext, no useSortable, no GripVertical).
 *   4. The page wires `layout.setOrder` into the grid via
 *      `onReorder` — single PUT per drag-end via the existing hook.
 *   5. Hidden widgets do NOT mount their data queries (preserved
 *      from the prior contract — page-level queries gate on
 *      visibility).
 *   6. Orphan persisted rows are silently ignored (server contract,
 *      preserved).
 *   7. Registry doc-block carries a stability warning that widget
 *      keys are persisted user data + must not be renamed casually.
 *
 * Source-pin tests because the visible behaviour lives in the source
 * shape (sensor wiring, Tailwind class on the button, page-level
 * `enabled` gating). Booting JSDOM + @dnd-kit + a mocked fetch is
 * excessive for what the brief asks us to lock down.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const REGISTRY_PATH = path("shared/dashboardWidgetRegistry.ts");
const DRAWER_PATH = path("client/src/dashboard/DashboardCustomizeDrawer.tsx");
const RENDERER_PATH = path("client/src/dashboard/DashboardWidgetRenderer.tsx");
const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");
const HOOK_PATH = path("client/src/dashboard/useDashboardLayout.ts");
const ROUTE_PATH = path("server/routes/dashboardLayout.ts");
const DASH_PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");
const CLAUDE_MD_PATH = path("CLAUDE.md");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Grid mounts the DnD context with mouse + touch + keyboard ──

describe("Drag — grid sensors (iPad + desktop + keyboard)", () => {
  const code = read(GRID_PATH);
  const codeNoComments = stripComments(code);

  it("DashboardWidgetGrid imports MouseSensor", () => {
    expect(codeNoComments).toMatch(/MouseSensor/);
  });

  it("DashboardWidgetGrid imports TouchSensor (iOS Safari fix)", () => {
    expect(codeNoComments).toMatch(/TouchSensor/);
  });

  it("DashboardWidgetGrid imports KeyboardSensor for accessibility", () => {
    expect(codeNoComments).toMatch(/KeyboardSensor/);
  });

  it("the touch sensor is wired with a hold + tolerance activation constraint", () => {
    expect(codeNoComments).toMatch(
      /useSensor\(\s*TouchSensor[\s\S]*?activationConstraint/,
    );
  });

  it("the mouse sensor uses a distance threshold so handle clicks don't start drags", () => {
    expect(codeNoComments).toMatch(
      /useSensor\(\s*MouseSensor[\s\S]*?distance/,
    );
  });

  it("does NOT fall back to the brittle PointerSensor on its own", () => {
    const usesPointerOnly =
      /useSensor\(\s*PointerSensor/.test(codeNoComments) &&
      !/useSensor\(\s*TouchSensor/.test(codeNoComments);
    expect(usesPointerOnly).toBe(false);
  });

  it("mounts DndContext + SortableContext around the grid", () => {
    expect(codeNoComments).toMatch(/<DndContext\b/);
    expect(codeNoComments).toMatch(/<SortableContext\b/);
  });

  it("uses rectSortingStrategy (2D grid), not the vertical-list strategy", () => {
    expect(codeNoComments).toMatch(/rectSortingStrategy/);
    expect(codeNoComments).not.toMatch(/verticalListSortingStrategy/);
  });
});

// ─── 2. Drag handle hit-area is touch-friendly ─────────────────────

describe("Drag — handle hit area on grid cells", () => {
  const code = read(GRID_PATH);
  const codeNoComments = stripComments(code);

  it("renders a per-cell drag-handle button with a stable test id", () => {
    expect(codeNoComments).toMatch(
      /data-testid=\{?`?dashboard-widget-drag-handle/,
    );
  });

  it("the drag handle disables touch-action so iPad scroll doesn't hijack the drag", () => {
    expect(codeNoComments).toMatch(/touch-none/);
  });

  it("the drag handle uses cursor-grab / cursor-grabbing to be discoverable", () => {
    expect(codeNoComments).toMatch(/cursor-grab/);
    expect(codeNoComments).toMatch(/active:cursor-grabbing/);
  });

  it("the drag handle has an aria-label so screen readers announce it", () => {
    expect(codeNoComments).toMatch(/aria-label=\{?`?Reorder /);
  });

  it("the cell wrapper is `relative` so the handle can be positioned absolutely", () => {
    expect(codeNoComments).toMatch(/cn\([\s\S]*?cellClass[\s\S]*?"relative"/);
  });

  it("the handle is positioned absolute in the cell corner", () => {
    expect(codeNoComments).toMatch(/absolute[\s\S]*?top-1\.5[\s\S]*?right-1\.5/);
  });

  it("the handle, NOT the cell wrapper, carries the @dnd-kit listeners (clicks on widget body never start a drag)", () => {
    // attributes/listeners are spread onto the <button>, not the cell <div>.
    expect(codeNoComments).toMatch(
      /<button[\s\S]+?\.\.\.attributes[\s\S]+?\.\.\.listeners/,
    );
  });
});

// ─── 3. The Customize drawer is no longer the drag surface ─────────

describe("Drag — drawer is a pure toggle list (no DnD)", () => {
  const drawer = read(DRAWER_PATH);
  const drawerNoComments = stripComments(drawer);
  const renderer = read(RENDERER_PATH);
  const rendererNoComments = stripComments(renderer);

  it("drawer does NOT import @dnd-kit anymore", () => {
    expect(drawerNoComments).not.toMatch(/from\s+["']@dnd-kit\/core["']/);
    expect(drawerNoComments).not.toMatch(/from\s+["']@dnd-kit\/sortable["']/);
  });

  it("drawer does NOT mount DndContext / SortableContext", () => {
    expect(drawerNoComments).not.toMatch(/<DndContext\b/);
    expect(drawerNoComments).not.toMatch(/<SortableContext\b/);
  });

  it("drawer does NOT call layout.setOrder (drag is no longer here)", () => {
    expect(drawerNoComments).not.toMatch(/layout\.setOrder\(/);
  });

  it("drawer copy directs users to drag widgets ON the dashboard", () => {
    expect(drawer).toMatch(
      /[Dd]rag widgets directly on the dashboard to reorder/,
    );
  });

  it("drawer copy still explains toggle behaviour", () => {
    expect(drawer).toMatch(/[Tt]oggle/);
    expect(drawer).toMatch(/show or hide them/);
  });

  it("renderer does NOT call useSortable (it's a static toggle row)", () => {
    expect(rendererNoComments).not.toMatch(/useSortable\(/);
  });

  it("renderer does NOT render a GripVertical drag handle", () => {
    expect(rendererNoComments).not.toMatch(/GripVertical/);
    expect(rendererNoComments).not.toMatch(/dashboard-customize-handle/);
  });
});

// ─── 4. Persist on drag-end only (no per-tick PUTs) ────────────────

describe("Drag — grid persists once on drag end", () => {
  const code = read(GRID_PATH);
  const codeNoComments = stripComments(code);

  it("the grid wires onDragEnd, NOT onDragOver / onDragMove", () => {
    expect(codeNoComments).toMatch(/onDragEnd=\{handleDragEnd\}/);
    expect(codeNoComments).not.toMatch(/onDragOver=\{[^}]*onReorder/);
    expect(codeNoComments).not.toMatch(/onDragMove=\{[^}]*onReorder/);
  });

  it("handleDragEnd uses arrayMove + onReorder once", () => {
    expect(codeNoComments).toMatch(/arrayMove\(/);
    expect(codeNoComments).toMatch(/onReorder\(/);
  });
});

// ─── 5. Page wires layout.setOrder into the grid via onReorder ─────

describe("Drag — page wires layout.setOrder via onReorder", () => {
  const code = read(DASH_PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("the page passes onReorder={layout.setOrder} to <DashboardWidgetGrid>", () => {
    expect(codeNoComments).toMatch(/onReorder=\{layout\.setOrder\}/);
  });
});

// ─── 6. Hidden widgets do NOT mount / fetch ────────────────────────

describe("Drag — hidden widgets do not fetch (preserved)", () => {
  const code = read(DASH_PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("the page reads the resolved layout via useDashboardLayout", () => {
    expect(codeNoComments).toMatch(
      /useDashboardLayout\(\s*["']financial["']\s*\)/,
    );
  });

  it("the page derives a visibleSet from layout.visibleWidgets", () => {
    expect(codeNoComments).toMatch(/visibleSet/);
    expect(codeNoComments).toMatch(/visibleWidgets/);
  });

  it("expensive queries are gated on widget visibility (enabled: …Enabled)", () => {
    expect(codeNoComments).toMatch(/enabled:\s*\w*[Ee]nabled/);
  });

  it("the financial query is gated on at least one financial widget being visible", () => {
    expect(codeNoComments).toMatch(/FINANCIAL_QUERY_WIDGETS/);
    expect(codeNoComments).toMatch(/financialQueryEnabled/);
  });

  it("the workflow query is gated on at least one workflow widget being visible", () => {
    expect(codeNoComments).toMatch(/WORKFLOW_QUERY_WIDGETS/);
    expect(codeNoComments).toMatch(/workflowQueryEnabled/);
  });
});

// ─── 7. Hidden widget order preservation across reorder ────────────

describe("Drag — hidden widget order preservation (hook contract)", () => {
  const code = read(HOOK_PATH);
  const codeNoComments = stripComments(code);

  it("setOrder appends widgets the caller did NOT include in the orderedKeys", () => {
    // The hook accepts a partial visible-only key list and appends
    // the unmentioned widgets behind in their existing order. This
    // is what lets the page pass `layout.setOrder` straight into
    // the grid's onReorder callback (which only sees visible keys)
    // without enabling hidden widgets.
    expect(codeNoComments).toMatch(
      /for\s*\(\s*const\s+w\s+of\s+widgets\s*\)\s*\{[\s\S]+?if\s*\(\s*!orderedKeys\.includes\(\s*w\.widgetKey\s*\)\s*\)/,
    );
  });
});

// ─── 8. Orphan persisted rows are silently ignored ─────────────────

describe("Drag — orphan widget keys", () => {
  const code = read(ROUTE_PATH);
  const codeNoComments = stripComments(code);

  it("GET resolver iterates the registry-derived `allowed` list, not override rows", () => {
    expect(codeNoComments).toMatch(/allowed\s*\.map\(/);
    expect(codeNoComments).toMatch(/overrides\.get\(\s*w\.key\s*\)/);
  });

  it("PUT rejects unknown widgetKey values at HTTP 400", () => {
    expect(codeNoComments).toMatch(/Unknown widgetKey/);
    expect(codeNoComments).toMatch(/createError\(\s*400/);
  });

  it("PUT rejects widgets the user is not authorized to see at HTTP 403", () => {
    expect(codeNoComments).toMatch(/createError\(\s*403/);
    expect(codeNoComments).toMatch(/lacks/);
  });
});

// ─── 9. Registry stability warning is documented ───────────────────

describe("Drag — registry stability warning", () => {
  const code = read(REGISTRY_PATH);

  it("the registry doc-block warns that widget keys are persisted user data", () => {
    expect(code).toMatch(/STABILITY WARNING/);
    expect(code).toMatch(/PERSISTED USER DATA|persisted user data/);
  });

  it("the registry tells future maintainers how to safely rename a key", () => {
    expect(code).toMatch(/migration/);
    expect(code).toMatch(/compatibility alias|alias/);
  });

  it("the registry documents that orphan rows are safe at runtime", () => {
    expect(code).toMatch(/orphan|ORPHAN|Orphan/);
  });

  it("the registry inlines the per-field stability warning on `key`", () => {
    expect(code).toMatch(/key: string;/);
    expect(code).toMatch(/DO NOT RENAME|do not rename/i);
  });
});

// ─── 10. CLAUDE.md "How to add a widget" section ───────────────────

describe("Drag — CLAUDE.md documentation", () => {
  it("CLAUDE.md exists at the project root", () => {
    expect(existsSync(CLAUDE_MD_PATH)).toBe(true);
  });

  it("CLAUDE.md has a Customizable Dashboard Widgets section", () => {
    const code = read(CLAUDE_MD_PATH);
    expect(code).toMatch(/Customizable Dashboard Widgets/);
  });

  it("the CLAUDE.md section gives a step-by-step add-a-widget recipe", () => {
    const code = read(CLAUDE_MD_PATH);
    expect(code).toMatch(/How to add a widget/);
    expect(code).toMatch(/dashboardWidgetRegistry/);
    expect(code).toMatch(/renderer/i);
    expect(code).toMatch(/enabled:\s*visibleSet/);
  });

  it("the CLAUDE.md section reiterates that hidden widgets must not fetch", () => {
    const code = read(CLAUDE_MD_PATH);
    expect(code).toMatch(/MUST NOT (mount|fetch|mount or fetch)/i);
  });
});

// ─── 11. Hook contract — single PUT per setOrder call ──────────────

describe("Drag — hook persists once per setOrder", () => {
  const code = read(HOOK_PATH);
  const codeNoComments = stripComments(code);

  it("setOrder calls replaceMutation.mutate exactly once", () => {
    const match = codeNoComments.match(
      /const setOrder = useCallback\([\s\S]*?\[widgets, replaceMutation\][\s\S]*?\);/,
    );
    expect(match).not.toBeNull();
    if (match) {
      const body = match[0];
      const calls = body.match(/replaceMutation\.mutate\(/g) ?? [];
      expect(calls.length).toBe(1);
    }
  });

  it("the read query disables refetchOnWindowFocus to avoid mid-edit snap-back", () => {
    expect(codeNoComments).toMatch(/refetchOnWindowFocus:\s*false/);
  });
});
