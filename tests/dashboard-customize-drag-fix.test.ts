/**
 * Dashboard customize drag-fix — source-pin contract tests
 * (2026-05-07 RALPH).
 *
 * After the framework landed the user reported that drag did not
 * work — the original `PointerSensor` is unreliable on iPad/iOS
 * Safari, the drag handle was a 17 × 17 px hit-target invisible to
 * touch users, and hidden widgets were still mounting their queries.
 *
 * This file pins the post-fix contract so a future refactor can't
 * silently regress it:
 *   1. Sensors include a TouchSensor (iPad reliability).
 *   2. Drag handle is at least h-8 w-8 (32 × 32 px touch target).
 *   3. Drawer copy mentions the drag handle so users know HOW to drag.
 *   4. Persist happens once on drag-end (no per-tick PUT spam).
 *   5. Hidden widgets do NOT mount their data queries — page-level
 *      queries gate on visibility.
 *   6. Orphan persisted rows are silently ignored — the GET resolver
 *      iterates the registry, not override rows.
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

// ─── 1. Sensors include TouchSensor (iPad reliability) ─────────────

describe("Drag fix — sensors", () => {
  const code = read(DRAWER_PATH);
  const codeNoComments = stripComments(code);

  it("DashboardCustomizeDrawer imports MouseSensor", () => {
    expect(codeNoComments).toMatch(/MouseSensor/);
  });

  it("DashboardCustomizeDrawer imports TouchSensor (iOS Safari fix)", () => {
    expect(codeNoComments).toMatch(/TouchSensor/);
  });

  it("DashboardCustomizeDrawer keeps KeyboardSensor for accessibility", () => {
    expect(codeNoComments).toMatch(/KeyboardSensor/);
  });

  it("the touch sensor is wired with a hold + tolerance activation constraint", () => {
    // We don't pin exact numbers, just that activationConstraint exists
    // alongside the TouchSensor so a future refactor can't drop it.
    expect(codeNoComments).toMatch(/useSensor\(\s*TouchSensor[\s\S]*?activationConstraint/);
  });

  it("the mouse sensor uses a distance threshold so toggle clicks don't start drags", () => {
    expect(codeNoComments).toMatch(/useSensor\(\s*MouseSensor[\s\S]*?distance/);
  });

  it("does NOT fall back to the brittle PointerSensor on its own", () => {
    // PointerSensor on iOS Safari is the documented blocker. Allow it
    // only if it's NOT the only sensor (i.e. paired with a Touch path),
    // but the canonical fix replaces it entirely.
    const usesPointerOnly =
      /useSensor\(\s*PointerSensor/.test(codeNoComments) &&
      !/useSensor\(\s*TouchSensor/.test(codeNoComments);
    expect(usesPointerOnly).toBe(false);
  });
});

// ─── 2. Drag handle hit-area is iPad-friendly ──────────────────────

describe("Drag fix — handle hit area", () => {
  const code = read(RENDERER_PATH);
  const codeNoComments = stripComments(code);

  it("renders an explicit drag-handle button with a stable test id", () => {
    expect(codeNoComments).toMatch(/data-testid=\{?`?dashboard-customize-handle/);
  });

  it("the drag handle uses at least a 32×32 px hit area (h-8 w-8)", () => {
    expect(codeNoComments).toMatch(/h-8\s+w-8/);
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
});

// ─── 3. Helper copy in the drawer mentions the handle ──────────────

describe("Drag fix — discoverability copy", () => {
  // 2026-05-07 follow-up: copy was tightened to the brief's exact
  // wording — "Drag widgets to reorder. Toggle widgets to show or
  // hide them." The visible drag-handle button is now the affordance,
  // so the copy doesn't need to spell out "the handle."
  it("DashboardCustomizeDrawer header tells users they can drag widgets to reorder", () => {
    const code = read(DRAWER_PATH);
    expect(code).toMatch(/[Dd]rag widgets to reorder/);
  });

  it("the drawer header explains toggle behaviour too", () => {
    const code = read(DRAWER_PATH);
    expect(code).toMatch(/[Tt]oggle/);
    expect(code).toMatch(/show or hide them/);
  });
});

// ─── 4. Persist on drag-end only (no per-tick PUTs) ────────────────

describe("Drag fix — persist only on drag end", () => {
  const code = read(DRAWER_PATH);
  const codeNoComments = stripComments(code);

  it("the drawer wires onDragEnd, NOT onDragOver / onDragMove", () => {
    expect(codeNoComments).toMatch(/onDragEnd=\{handleDragEnd\}/);
    // No persist hook on drag-over / drag-move that would PUT every tick
    expect(codeNoComments).not.toMatch(/onDragOver=\{[^}]*setOrder/);
    expect(codeNoComments).not.toMatch(/onDragMove=\{[^}]*setOrder/);
  });

  it("handleDragEnd uses arrayMove + setOrder once", () => {
    expect(codeNoComments).toMatch(/arrayMove\(/);
    expect(codeNoComments).toMatch(/layout\.setOrder\(/);
  });
});

// ─── 5. Hidden widgets do NOT mount / fetch ────────────────────────

describe("Drag fix — hidden widgets do not fetch", () => {
  const code = read(DASH_PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("the page reads the resolved layout via useDashboardLayout", () => {
    expect(codeNoComments).toMatch(/useDashboardLayout\(\s*["']financial["']\s*\)/);
  });

  it("the page derives a visibleSet from layout.visibleWidgets", () => {
    expect(codeNoComments).toMatch(/visibleSet/);
    expect(codeNoComments).toMatch(/visibleWidgets/);
  });

  it("expensive queries are gated on widget visibility (enabled: …Enabled)", () => {
    // We don't pin the exact variable name; we pin the contract:
    // at least one useQuery call has an `enabled:` flag wired up.
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

// ─── 6. Orphan persisted rows are silently ignored ─────────────────

describe("Drag fix — orphan widget keys", () => {
  const code = read(ROUTE_PATH);
  const codeNoComments = stripComments(code);

  it("GET resolver iterates the registry-derived `allowed` list, not override rows", () => {
    // The handler builds `allowed` (registry order, permission-filtered)
    // and then maps over it, looking up overrides by key. Orphaned
    // override rows (widget_key absent from the registry) never enter
    // the response.
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

// ─── 7. Registry stability warning is documented ───────────────────

describe("Drag fix — registry stability warning", () => {
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
    // The interface comment for `key` should call out that it's
    // persisted verbatim — separate from the file-level doc-block.
    expect(code).toMatch(/key: string;/);
    expect(code).toMatch(/DO NOT RENAME|do not rename/i);
  });
});

// ─── 8. CLAUDE.md "How to add a widget" section ────────────────────

describe("Drag fix — CLAUDE.md documentation", () => {
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
    // The recipe mentions the registry, the renderer map, and gating.
    expect(code).toMatch(/dashboardWidgetRegistry/);
    expect(code).toMatch(/renderer/i);
    expect(code).toMatch(/enabled:\s*visibleSet/);
  });

  it("the CLAUDE.md section reiterates that hidden widgets must not fetch", () => {
    const code = read(CLAUDE_MD_PATH);
    expect(code).toMatch(/MUST NOT (mount|fetch|mount or fetch)/i);
  });
});

// ─── 9. Hook contract — single PUT per setOrder call ───────────────

describe("Drag fix — hook persists once per setOrder", () => {
  const code = read(HOOK_PATH);
  const codeNoComments = stripComments(code);

  it("setOrder calls replaceMutation.mutate exactly once", () => {
    // Capture the body of setOrder and count `.mutate(` invocations.
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
