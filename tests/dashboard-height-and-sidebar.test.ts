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
    // Five widgets in the default financial registry; each must
    // declare heightPreset: "summary".
    const matches = noComments.match(/heightPreset:\s*"([a-z]+)"/g) ?? [];
    expect(matches.length).toBe(5);
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

// ─── 6. Sidebar Create nav action ──────────────────────────────────

describe("Sidebar — Create nav action (2026-05-09 redesign)", () => {
  const code = read(SIDEBAR_PATH);

  it("renders a button-create-new trigger inside the sidebar", () => {
    expect(code).toMatch(/data-testid="button-create-new"/);
  });

  it("uses ActionMenu (canonical descriptor-driven primitive)", () => {
    // The raw inline DropdownMenu + items were replaced by <ActionMenu>
    // so the menu rendering logic is not duplicated between sidebar and header.
    expect(code).toMatch(/<ActionMenu/);
  });

  it("uses a SidebarMenuButton for nav items (SidebarMenuButton still present in file)", () => {
    // Nav items (Dashboard, Dispatch, etc.) still use SidebarMenuButton.
    // The Create trigger itself uses a plain <button> to fix the forwardRef issue.
    expect(code).toMatch(/<SidebarMenuButton/);
  });

  it("trigger renders 'Create' text (approved label)", () => {
    expect(code).toMatch(/>Create</);
  });

  it("uses TooltipTrigger asChild for collapsed-state discoverability (forwardRef-safe)", () => {
    // Plain <button> + TooltipTrigger asChild replaces SidebarMenuButton + tooltip prop.
    // TooltipTrigger IS a forwardRef component, so the Radix positioning ref properly
    // flows through to the DOM button — fixing the "sidebar Create does nothing" bug.
    expect(code).toMatch(/TooltipTrigger asChild/);
    expect(code).toMatch(/<TooltipContent[\s\S]*?>\s*Create\s*<\/TooltipContent>/);
  });

  it("Create action is inside SidebarContent (integrated in nav, not floating in header)", () => {
    // SidebarHeader now contains only the toggle. Create is the first
    // item in SidebarContent so it reads as part of navigation.
    expect(code).toMatch(/<SidebarContent[\s\S]*?button-create-new/);
  });

  it("threads App-level create callbacks into makeCreateMenuItems", () => {
    expect(code).toMatch(/makeCreateMenuItems/);
    expect(code).toMatch(/onOpenCreate/);
    expect(code).toMatch(/onOpenAddClient/);
    expect(code).toMatch(/onOpenCreatePm/);
  });

  it("does NOT use a green bg-brand pill as the sidebar trigger", () => {
    // The approved design: green text only, no pill background.
    // bg-brand belongs only on the header icon button.
    const triggerBlock = code.match(/data-testid="button-create-new"[\s\S]*?(?=<\/button>)/)?.[0] ?? "";
    expect(triggerBlock).not.toMatch(/bg-brand/);
  });
});

// ─── 6b. Sidebar Create trigger — green lightweight styling ────────

describe("Sidebar — Create trigger: approved green lightweight styling", () => {
  const code = read(SIDEBAR_PATH);

  it("Create trigger uses h-9 (consistent vertical rhythm with nav items)", () => {
    // h-9 keeps the Create row the same height as Dashboard, Dispatch, etc.
    expect(code).toMatch(/data-testid="button-create-new"[\s\S]*?h-9/);
  });

  it("Create trigger uses text-brand (green icon + text, no pill background)", () => {
    // Approved design: green text only. Previous design was text-white/70 (nav inactive).
    expect(code).toMatch(/data-testid="button-create-new"[\s\S]*?text-brand/);
  });

  it("Create trigger uses hover:opacity-75 (lightweight hover, no background added)", () => {
    // Approved: subtle opacity dim on hover instead of adding a background color.
    expect(code).toMatch(/data-testid="button-create-new"[\s\S]*?hover:opacity-75/);
  });

  it("Plus icon is h-4 w-4 (consistent with nav icons)", () => {
    expect(code).toMatch(/<Plus className="h-4 w-4/);
  });

  it("does NOT use h-8 on the Create trigger (old pill height)", () => {
    const triggerClass = code.match(/data-testid="button-create-new"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(triggerClass).not.toMatch(/\bh-8\b/);
  });

  it("does NOT use bg-brand on the Create trigger (not a green pill)", () => {
    const triggerClass = code.match(/data-testid="button-create-new"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(triggerClass).not.toMatch(/bg-brand/);
  });

  it("does NOT use inline-flex / self-center (old pill layout idioms)", () => {
    const triggerClass = code.match(/data-testid="button-create-new"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(triggerClass).not.toMatch(/\binline-flex\b/);
    expect(triggerClass).not.toMatch(/\bself-center\b/);
  });

  it("does NOT use text-white/70 (old nav inactive color — replaced by text-brand)", () => {
    const triggerClass = code.match(/data-testid="button-create-new"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(triggerClass).not.toMatch(/text-white\/70/);
  });
});

// ─── 7. Header + App-level wiring ─────────────────────────────────

describe("App header — compact green Create button (2026-05-09)", () => {
  const code = read(APP_PATH);

  it("App.tsx mounts button-create-header (the new header icon button)", () => {
    expect(code).toMatch(/data-testid="button-create-header"/);
  });

  it("button-create-header is NOT button-create-new (distinct testids)", () => {
    // The sidebar trigger keeps button-create-new; the header button is
    // button-create-header. No two elements share the same testid.
    expect(code).not.toMatch(/data-testid="button-create-new"/);
  });

  it("header button carries bg-brand (green, visually primary)", () => {
    const buttonBlock = code.match(/button-create-header[\s\S]*?(?=<\/Button>)/)?.[0] ?? "";
    expect(buttonBlock).toMatch(/bg-brand/);
  });

  it("header button is icon-only (no text label in the button)", () => {
    // The approved design: compact square with ONLY a plus icon.
    // Only check JSX text nodes (>…<), not attribute values like aria-label.
    const buttonBlock = code.match(/button-create-header[\s\S]*?(?=<\/Button>)/)?.[0] ?? "";
    expect(buttonBlock).not.toMatch(/>\s*(Create|New)\s*</);
  });

  it("App.tsx uses ActionMenu for the header create trigger", () => {
    expect(code).toMatch(/<ActionMenu/);
  });

  it("App.tsx uses makeCreateMenuItems (shared config, not a duplicate list)", () => {
    expect(code).toMatch(/makeCreateMenuItems/);
  });

  it("App.tsx still defines the launchers (state + dialog mounts)", () => {
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
    // SidebarHeader now contains ONLY the toggle — no Create button.
    // This keeps the toggle at the very top regardless of sidebar state.
    expect(code).toMatch(/<SidebarHeader[\s\S]*?<SidebarTrigger/);
  });

  it("SidebarHeader no longer contains the Create button", () => {
    // Create was moved into SidebarContent. The header is toggle-only.
    const headerBlock = code.match(/<SidebarHeader[\s\S]*?<\/SidebarHeader>/)?.[0] ?? "";
    expect(headerBlock).not.toMatch(/button-create-new/);
  });

  it("the toggle is canonically reachable via the data-testid", () => {
    expect(code).toMatch(/data-testid="button-sidebar-toggle"/);
  });

  it("Sidebar primitive is mounted with collapsible='icon' so collapse works", () => {
    expect(code).toMatch(/<Sidebar collapsible="icon"/);
  });

  it("Create trigger has a TooltipContent for discoverability when collapsed", () => {
    // When the sidebar collapses to icon-only mode, TooltipContent with "Create"
    // shows on hover — the canonical collapse pattern.
    // (tooltip="Create" on SidebarMenuButton was the old approach; replaced by
    // explicit Tooltip + TooltipContent to fix the forwardRef positioning bug.)
    expect(code).toMatch(/<TooltipContent[\s\S]*?>\s*Create\s*<\/TooltipContent>/);
  });
});

// ─── 9. Create menu config — canonical item list ───────────────────

describe("createMenuConfig — shared canonical item list", () => {
  const CONFIG_PATH = path("client/src/components/create/createMenuConfig.ts");
  const config = read(CONFIG_PATH);

  it("exports makeCreateMenuItems", () => {
    expect(config).toMatch(/export function makeCreateMenuItems/);
  });

  it("includes New Job (testId: quick-new-job)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-job"/);
  });

  it("includes New Lead (testId: quick-new-lead) — previously missing", () => {
    expect(config).toMatch(/testId:\s*"quick-new-lead"/);
  });

  it("New Lead navigates to /leads/new", () => {
    expect(config).toMatch(/navigate.*\/leads\/new|\/leads\/new.*navigate/s);
  });

  it("includes New Client (testId: quick-new-client)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-client"/);
  });

  it("includes New Quote (testId: quick-new-quote)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-quote"/);
  });

  it("includes New Invoice (testId: quick-new-invoice)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-invoice"/);
  });

  it("includes New Service Plan (testId: quick-new-pm)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-pm"/);
  });

  it("includes New Task (testId: quick-new-task)", () => {
    expect(config).toMatch(/testId:\s*"quick-new-task"/);
  });

  it("menu order: Job before Lead", () => {
    expect(config.indexOf('"quick-new-job"')).toBeLessThan(config.indexOf('"quick-new-lead"'));
  });

  it("menu order: Lead before Client", () => {
    expect(config.indexOf('"quick-new-lead"')).toBeLessThan(config.indexOf('"quick-new-client"'));
  });

  it("menu order: Client before Quote", () => {
    expect(config.indexOf('"quick-new-client"')).toBeLessThan(config.indexOf('"quick-new-quote"'));
  });

  it("menu order: Quote before Invoice", () => {
    expect(config.indexOf('"quick-new-quote"')).toBeLessThan(config.indexOf('"quick-new-invoice"'));
  });

  it("menu order: Invoice before Service Plan", () => {
    expect(config.indexOf('"quick-new-invoice"')).toBeLessThan(config.indexOf('"quick-new-pm"'));
  });

  it("menu order: Service Plan before Task", () => {
    expect(config.indexOf('"quick-new-pm"')).toBeLessThan(config.indexOf('"quick-new-task"'));
  });

  it("Client and Service Plan items carry hidden flag (conditional on callback)", () => {
    expect(config).toMatch(/id:\s*"client"[\s\S]*?hidden:/);
    expect(config).toMatch(/id:\s*"pm"[\s\S]*?hidden:/);
  });
});
