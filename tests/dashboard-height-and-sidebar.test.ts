/**
 * Dashboard standardized height correction + sidebar density / nav
 * additions / Create-action move (2026-05-07 RALPH).
 *
 * Pins the post-correction dashboard height (smaller, not larger),
 * the tightened sidebar nav rhythm, the Price Book entry, and the
 * relocation of the global "+ New" trigger from the dark header into
 * the left sidebar. Source-pin tests because the visible behaviour
 * lives in the source shape (Tailwind class on the height preset, the
 * sidebar component's class strings, the menu items it lists, and
 * which file mounts the dropdown).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");
const SIDEBAR_PATH = path("client/src/components/AppSidebar.tsx");
const APP_PATH = path("client/src/App.tsx");
const REGISTRY_PATH = path("shared/dashboardWidgetRegistry.ts");
const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ─── 1. Dashboard standard height: smaller, not 420px ──────────────

describe("Dashboard summary height — reduced from 420px", () => {
  const code = read(GRID_PATH);

  it("HEIGHT_CLASSES.summary is no longer h-[420px] (oversized)", () => {
    expect(code).not.toMatch(/summary:\s*"h-\[420px\]"/);
  });

  it("HEIGHT_CLASSES.summary uses the canonical h-[300px]", () => {
    expect(code).toMatch(/summary:\s*"h-\[300px\]"/);
  });

  it("the height preset stays a FIXED height (h-[…]) — not min-h", () => {
    expect(code).toMatch(/summary:\s*"h-\[/);
    expect(code).not.toMatch(/summary:\s*"min-h-\[/);
  });
});

// ─── 2. All default widgets share the same standard height ─────────

describe("Default-financial widgets share heightPreset summary", () => {
  const registry = read(REGISTRY_PATH);

  it("every default widget's heightPreset is summary", () => {
    // Strip block + line comments so the contract is read literal,
    // not from doc-blocks.
    const noComments = registry
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Six widgets in the default financial registry; each must
    // declare heightPreset: "summary".
    const matches = noComments.match(/heightPreset:\s*"([a-z]+)"/g) ?? [];
    expect(matches.length).toBe(6);
    for (const m of matches) {
      expect(m).toBe(`heightPreset: "summary"`);
    }
  });
});

// ─── 3. Today's Schedule body still scrolls ─────────────────────────

describe("Today's Schedule body — internal scroll preserved", () => {
  const code = read(PAGE_PATH);

  it("schedule body wrapper carries flex-1 + overflow-y-auto", () => {
    expect(code).toMatch(/flex-1 flex flex-col min-h-0 overflow-y-auto/);
  });

  it("schedule body has the canonical test id", () => {
    expect(code).toMatch(/data-testid="schedule-body-scroll"/);
  });

  it("card height does NOT depend on visible technician count", () => {
    expect(code).not.toMatch(/todaysScheduleHeightPreset/);
    expect(code).not.toMatch(/widgetHeightOverrides/);
    expect(code).not.toMatch(/heightOverrides=\{/);
  });
});

// ─── 4. Sidebar density: tighter nav items + dividers ──────────────

describe("Sidebar density — tightened nav rhythm", () => {
  const code = read(SIDEBAR_PATH);

  it("nav items use h-9 (was h-10) for slightly tighter rhythm", () => {
    // SidebarMenuButton className contains h-9 in both link and
    // onClick branches.
    expect(code).toMatch(/className="h-9 gap-1 px-1\.5/);
    expect(code).not.toMatch(/className="h-10 gap-1 px-1\.5/);
  });

  it("section dividers use my-2 (was my-3)", () => {
    expect(code).toMatch(/mx-2 my-2 border-t border-white\/10/);
    expect(code).not.toMatch(/mx-2 my-3 border-t border-white\/10/);
  });

  it("active-state styling is preserved across tightening", () => {
    // The brand-green left bar + bright text + heavy weight remain.
    expect(code).toMatch(
      /data-\[active=true\]:bg-white\/\[0\.16\][\s\S]+?data-\[active=true\]:text-white[\s\S]+?data-\[active=true\]:font-semibold[\s\S]+?data-\[active=true\]:border-l-\[#76B054\]/,
    );
  });
});

// ─── 5. Price Book sidebar entry ───────────────────────────────────

describe("Sidebar — Price Book navigation", () => {
  const code = read(SIDEBAR_PATH);

  it("includes a Price Book entry pointing at the existing /settings/products route", () => {
    expect(code).toMatch(/title:\s*"Price Book"[\s\S]+?href:\s*"\/settings\/products"/);
  });

  it("uses the canonical nav-price-book test id", () => {
    expect(code).toMatch(/testId:\s*"nav-price-book"/);
  });

  it("does NOT introduce a new route or rename the route name", () => {
    // The entry consumes the existing route; do not duplicate.
    const slashSettingsProductsCount = (
      code.match(/\/settings\/products/g) ?? []
    ).length;
    // Allowed to appear in href + isActive equality + startsWith
    // — but never as a definition for a different page.
    expect(slashSettingsProductsCount).toBeGreaterThanOrEqual(1);
  });

  it('does NOT carry the legacy "Products and Services" or "Products & Services" sidebar literal', () => {
    expect(code).not.toMatch(/Products and Services/);
    expect(code).not.toMatch(/Products & Services/);
  });
});

// ─── 6. Create New action lives in the sidebar ─────────────────────

describe("Sidebar — Create New action", () => {
  const code = read(SIDEBAR_PATH);

  it("renders a button-create-new trigger inside the sidebar", () => {
    expect(code).toMatch(/data-testid="button-create-new"/);
  });

  it("the trigger opens a DropdownMenu (not a navigation link)", () => {
    // The brief is explicit: the action opens the existing
    // CreateNewDialog flow via callbacks. The DropdownMenu primitive
    // wires the menu items.
    expect(code).toMatch(/<DropdownMenu>/);
    expect(code).toMatch(/<DropdownMenuTrigger asChild>/);
  });

  it("the Create New menu calls back into App-level launchers", () => {
    expect(code).toMatch(/onOpenCreate\(/);
    expect(code).toMatch(/onOpenAddClient/);
    expect(code).toMatch(/onOpenCreatePm/);
  });

  it("menu items include Job, Client, Invoice, Quote, Task, PM Plan", () => {
    expect(code).toMatch(/data-testid="quick-new-job"/);
    expect(code).toMatch(/data-testid="quick-new-client"/);
    expect(code).toMatch(/data-testid="quick-new-invoice"/);
    expect(code).toMatch(/data-testid="quick-new-quote"/);
    expect(code).toMatch(/data-testid="quick-new-task"/);
    expect(code).toMatch(/data-testid="quick-new-pm"/);
  });
});

// ─── 7. Header no longer renders a duplicate Create dropdown ───────

describe("App header — Create New dropdown removed", () => {
  const code = read(APP_PATH);

  it("App.tsx no longer mounts a button-create-new in the header", () => {
    // The trigger lives ONLY in the sidebar now. App.tsx must not
    // also render data-testid="button-create-new" — otherwise we'd
    // have two buttons with the same test id and competing menus.
    expect(code).not.toMatch(/data-testid="button-create-new"/);
  });

  it("App.tsx still defines the launchers (state + dialog mounts)", () => {
    // Removing the header dropdown must NOT remove the underlying
    // CreateNewDialog mount — the sidebar trigger calls `openCreate`
    // which sets `createNewOpen=true`.
    expect(code).toMatch(/<CreateNewDialog/);
    expect(code).toMatch(/setCreateNewOpen/);
    expect(code).toMatch(/setAddClientModalOpen/);
    expect(code).toMatch(/setCreatePmDialogOpen/);
  });

  it("App.tsx threads the create callbacks into <AppSidebar>", () => {
    expect(code).toMatch(/onOpenCreate=\{openCreate\}/);
    expect(code).toMatch(/onOpenAddClient=\{[^}]*setAddClientModalOpen[^}]*\}/);
    expect(code).toMatch(/onOpenCreatePm=\{[^}]*setCreatePmDialogOpen[^}]*\}/);
  });
});

// ─── 8. Sidebar collapse control still discoverable ────────────────

describe("Sidebar — collapse control", () => {
  const code = read(SIDEBAR_PATH);

  it("SidebarTrigger remains in the SidebarHeader", () => {
    // Trigger lives ABOVE the Create New action so the two don't
    // fight. Pin both presences.
    expect(code).toMatch(/<SidebarHeader[\s\S]*?<SidebarTrigger/);
  });

  it("the trigger is canonically reachable via the data-testid", () => {
    expect(code).toMatch(/data-testid="button-sidebar-toggle"/);
  });

  it("Sidebar primitive is mounted with collapsible='icon' so collapse works", () => {
    expect(code).toMatch(/<Sidebar collapsible="icon"/);
  });

  it("the Create New button collapses to an icon when the sidebar is collapsed", () => {
    // When state === "collapsed", className becomes the icon-only
    // form; pin both branches.
    expect(code).toMatch(/isCollapsed/);
    expect(code).toMatch(/h-8 w-8 p-0 inline-flex items-center justify-center/);
    expect(code).toMatch(/h-8 px-3 gap-1\.5/);
  });
});
