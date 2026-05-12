/**
 * TasksOverviewCard — dashboard widget canonical contract tests.
 *
 * Source-pin assertions covering:
 *   1.  Registry pin (key, contract fields, order).
 *   2.  Card chrome — canonical CardShell / CardShellHeader / CardShellTitle / CardShellAction.
 *   3.  Row density — py-1.5 / border-card-border / hover:bg-primary/5.
 *   4.  Typography tokens — text-helper only; no text-xs, no arbitrary text-[Npx].
 *   5.  Loading / empty / error states — canonical tokens; tab-specific empty messages.
 *   6.  Completion action — POST /api/tasks/:id/close; invalidates /api/tasks.
 *   7.  Reopen action — POST /api/tasks/:id/reopen; invalidates /api/tasks.
 *   8.  Create + edit interactions — CreateNewDialog + TaskDialog.
 *   9.  Assigned-user avatar — canonical testid pattern.
 *  10.  Count badge removed from header entirely.
 *  11.  Filter band — technician Select + status tabs (Open/Done) rendering.
 *  11b. Server-side technician filter — assignedToUserId passed in URL.
 *  11c. Assignee display in All team mode — assignedUser rendered on rows.
 *  12.  Filter select and status tab styling — bg-primary/10 active; hover:bg-primary/5 idle.
 *  13.  Completed row styling — line-through; CheckSquare icon.
 *  14.  Responsive layout — min-w-0 / shrink-0 / flex justify-between.
 *  15.  FinancialDashboard wiring.
 *  16.  Header Tasks text cleanup (App.tsx).
 *  17.  Backend assignedUser hydration — leftJoin + mapping in listTasks().
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  FINANCIAL_DASHBOARD_WIDGETS,
  getDashboardWidget,
} from "../shared/dashboardWidgetRegistry";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const CARD_PATH = "client/src/components/dashboard/TasksOverviewCard.tsx";
const DASH_PAGE_PATH = "client/src/pages/FinancialDashboard.tsx";
const APP_PATH = "client/src/App.tsx";

// ─── 1. Registry pin ────────────────────────────────────────────────

describe("tasks_overview — registry pin", () => {
  it("is present in FINANCIAL_DASHBOARD_WIDGETS", () => {
    const keys = FINANCIAL_DASHBOARD_WIDGETS.map((w) => w.key);
    expect(keys).toContain("tasks_overview");
  });

  it("carries the expected registry contract", () => {
    const def = getDashboardWidget("financial", "tasks_overview");
    expect(def).not.toBeNull();
    expect(def!.title).toBe("Tasks");
    expect(def!.sizePreset).toBe("third");
    expect(def!.defaultVisible).toBe(true);
    expect(def!.requiredPermission).toBeNull();
    expect(def!.defaultOrder).toBeGreaterThan(50);
  });

  it("sits after operational_alerts in default order", () => {
    const list = FINANCIAL_DASHBOARD_WIDGETS;
    const opIdx = list.findIndex((w) => w.key === "operational_alerts");
    const taskIdx = list.findIndex((w) => w.key === "tasks_overview");
    expect(taskIdx).toBeGreaterThan(opIdx);
  });
});

// ─── 2. Card chrome — canonical CardShell primitives ────────────────

describe("TasksOverviewCard — card chrome primitives", () => {
  const src = read(CARD_PATH);

  it("imports CardShell / CardShellHeader / CardShellTitle / CardShellAction from @/components/ui/card", () => {
    expect(src).toMatch(/CardShell[\s\S]+?from\s+["']@\/components\/ui\/card["']/);
    expect(src).toMatch(/CardShellHeader/);
    expect(src).toMatch(/CardShellTitle/);
    expect(src).toMatch(/CardShellAction/);
  });

  it("renders <CardShell> as the outer wrapper", () => {
    expect(src).toMatch(/<CardShell\b/);
  });

  it("renders <CardShellHeader> as the header band", () => {
    expect(src).toMatch(/<CardShellHeader\b/);
  });

  it("renders <CardShellTitle> with icon prop", () => {
    expect(src).toMatch(/<CardShellTitle[\s\S]+?icon=\{ClipboardList\}/);
  });

  it("does NOT define a local card wrapper function (no parallel CardShell)", () => {
    expect(src).not.toMatch(/function\s+(?:Dashboard)?Card(?:Shell|Wrapper|Container)\b/);
  });
});

// ─── 3. Row density + border tokens ────────────────────────────────

describe("TasksOverviewCard — row density and border tokens", () => {
  const src = read(CARD_PATH);

  it("uses py-1.5 for row padding", () => {
    expect(src).toMatch(/py-1\.5/);
  });

  it("uses border-card-border for row dividers (not hex)", () => {
    expect(src).toMatch(/border-card-border/);
  });

  it("uses hover:bg-primary/5 for row hover (not hex background)", () => {
    expect(src).toMatch(/hover:bg-primary\/5/);
  });
});

// ─── 4. Typography tokens ───────────────────────────────────────────

describe("TasksOverviewCard — typography tokens", () => {
  const src = read(CARD_PATH);

  it("uses text-helper for row labels (not text-xs)", () => {
    expect(src).toMatch(/text-helper/);
    expect(src).not.toMatch(/\btext-xs\b/);
  });

  it("does NOT use arbitrary text-[Npx] sizes", () => {
    expect(src).not.toMatch(/\btext-\[\d+px\]/);
  });

  it("uses text-muted-foreground for secondary content (not text-slate-*/hex)", () => {
    expect(src).toMatch(/text-muted-foreground/);
    expect(src).not.toMatch(/text-slate-[0-9]/);
  });

  it("does NOT use hex color literals", () => {
    expect(src).not.toMatch(/"[^"]*#[0-9a-fA-F]{3,6}[^"]*"/);
  });
});

// ─── 5. Loading / empty / error states ─────────────────────────────

describe("TasksOverviewCard — loading / empty / error states", () => {
  const src = read(CARD_PATH);

  it("renders a skeleton loading state", () => {
    expect(src).toMatch(/<Skeleton\b/);
    expect(src).toMatch(/data-testid="tasks-overview-body"/);
  });

  it("renders tab-specific empty messages with canonical tokens", () => {
    expect(src).toMatch(/data-testid="tasks-overview-empty"/);
    expect(src).toMatch(/No open tasks/);
    expect(src).toMatch(/No completed tasks/);
    expect(src).toMatch(/text-helper text-muted-foreground/);
  });

  it("renders an error state with canonical tokens", () => {
    expect(src).toMatch(/data-testid="tasks-overview-error"/);
    expect(src).toMatch(/text-helper text-muted-foreground/);
  });
});

// ─── 6. Completion action ───────────────────────────────────────────

describe("TasksOverviewCard — completion mutation (close)", () => {
  const src = read(CARD_PATH);

  it("POSTs to /api/tasks/:id/close to complete a task", () => {
    expect(src).toMatch(/\/api\/tasks\/\$\{.*\}\/close/);
    expect(src).toMatch(/method:\s*["']POST["']/);
  });

  it("invalidates /api/tasks queries on success", () => {
    expect(src).toMatch(/onSuccess:\s*invalidateAllTaskQueries/);
    expect(src).toMatch(/startsWith\(\s*["']\/api\/tasks["']\s*\)/);
  });
});

// ─── 7. Reopen action ───────────────────────────────────────────────

describe("TasksOverviewCard — reopen mutation", () => {
  const src = read(CARD_PATH);

  it("POSTs to /api/tasks/:id/reopen to reopen a completed task", () => {
    expect(src).toMatch(/\/api\/tasks\/\$\{.*\}\/reopen/);
  });

  it("reopen mutation also uses onSuccess: invalidateAllTaskQueries", () => {
    // Both close and reopen share the same predicate-based invalidation.
    const matches = src.match(/onSuccess:\s*invalidateAllTaskQueries/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 8. Create + edit interactions ─────────────────────────────────

describe("TasksOverviewCard — create and edit interactions", () => {
  const src = read(CARD_PATH);

  it("renders a + button to open CreateNewDialog", () => {
    expect(src).toMatch(/data-testid="button-tasks-overview-new"/);
    expect(src).toMatch(/<CreateNewDialog\b/);
    expect(src).toMatch(/defaultTab="task"/);
  });

  it("opens TaskDialog in edit mode on row click", () => {
    expect(src).toMatch(/<TaskDialog\b/);
    expect(src).toMatch(/taskId=\{selectedTaskId\}/);
  });

  it("threads onChanged={invalidateAllTaskQueries} into TaskDialog", () => {
    expect(src).toMatch(/onChanged=\{invalidateAllTaskQueries\}/);
  });
});

// ─── 9. Assigned-user avatar ────────────────────────────────────────

describe("TasksOverviewCard — assigned-user avatar", () => {
  const src = read(CARD_PATH);

  it("renders an avatar element with the canonical testid pattern", () => {
    expect(src).toMatch(/data-testid=\{`avatar-task-\$\{t\.id\}`\}/);
  });
});

// ─── 10. Count badge removed ────────────────────────────────────────

describe("TasksOverviewCard — count badge removed from header", () => {
  const src = read(CARD_PATH);

  it("does NOT render a tasks-overview-count testid", () => {
    expect(src).not.toMatch(/data-testid="tasks-overview-count"/);
  });

  it("does NOT import StatusChip (no count badge)", () => {
    expect(src).not.toMatch(/StatusChip/);
  });
});

// ─── 11. Filter band rendering ──────────────────────────────────────

describe("TasksOverviewCard — filter band rendering", () => {
  const src = read(CARD_PATH);

  it("renders the filter band container with canonical testid", () => {
    expect(src).toMatch(/data-testid="tasks-overview-filters"/);
  });

  it("renders a technician Select with canonical testid", () => {
    expect(src).toMatch(/data-testid="tasks-overview-tech-select"/);
  });

  it("Select includes a Mine/me option (value='me')", () => {
    expect(src).toMatch(/value="me"/);
  });

  it("Select includes an All team option", () => {
    expect(src).toMatch(/value="all"/);
    expect(src).toMatch(/All team/);
  });

  it("Select renders individual technicians from useTechniciansDirectory", () => {
    expect(src).toMatch(/useTechniciansDirectory/);
    expect(src).toMatch(/teamMembers/);
  });

  it("renders Open status tab", () => {
    // Tabs use a dynamic testid template: data-testid={`tasks-tab-${tab}`}
    expect(src).toMatch(/data-testid=\{`tasks-tab-\$\{tab\}`\}/);
  });

  it("renders Done status tab", () => {
    // Verified by the dynamic template covering both "open" and "done".
    expect(src).toMatch(/tasks-tab-/);
    expect(src).toMatch(/"done"/);
  });

  it("filter band is separated from content by border-b border-card-border", () => {
    // className precedes data-testid in the JSX attribute order.
    expect(src).toMatch(/border-b border-card-border[\s\S]{0,200}tasks-overview-filters/);
  });

  it("filter band uses flex items-center justify-between (no wrap on narrow cells)", () => {
    expect(src).toMatch(/flex items-center justify-between[\s\S]{0,200}tasks-overview-filters/);
  });
});

// ─── 11b. Server-side technician filter ─────────────────────────────

describe("TasksOverviewCard — server-side technician filter", () => {
  const src = read(CARD_PATH);

  it("passes assignedToUserId in the query URL for scoped filters", () => {
    expect(src).toMatch(/assignedToUserId/);
  });

  it("builds the tasks URL dynamically via buildTasksUrl helper", () => {
    expect(src).toMatch(/buildTasksUrl/);
    expect(src).toMatch(/tasksUrl/);
  });

  it("uses queryKey derived from the dynamic URL (not a static constant)", () => {
    // queryKey must reference tasksUrl so different filters produce separate cache entries.
    expect(src).toMatch(/queryKey:\s*\[tasksUrl\]/);
  });

  it("uses the localStorage key shared with TasksPanel", () => {
    expect(src).toMatch(/tasks:selectedTeamFilter/);
  });
});

// ─── 11c. Assignee display in All team mode ──────────────────────────

describe("TasksOverviewCard — assignee display in All team mode", () => {
  const src = read(CARD_PATH);

  it("reads assignedUser from task row", () => {
    expect(src).toMatch(/t\.assignedUser/);
  });

  it("gates avatar rendering on techFilter === 'all'", () => {
    expect(src).toMatch(/techFilter\s*===\s*["']all["']/);
  });

  it("renders avatar with canonical testid pattern", () => {
    expect(src).toMatch(/data-testid=\{`avatar-task-\$\{t\.id\}`\}/);
  });
});

// ─── 12. Filter select and status tab styling ────────────────────────

describe("TasksOverviewCard — filter select and status tab styling", () => {
  const src = read(CARD_PATH);

  it("status tab active state uses bg-primary/10 text-primary (not hard-coded color)", () => {
    expect(src).toMatch(/bg-primary\/10/);
    expect(src).toMatch(/text-primary/);
  });

  it("status tab idle state uses hover:bg-primary/5", () => {
    expect(src).toMatch(/hover:bg-primary\/5/);
  });

  it("Select trigger height is h-6 (compact, not oversized h-8/h-9 default)", () => {
    expect(src).toMatch(/\bh-6\b/);
  });

  it("filter controls use text-helper density (no text-xs)", () => {
    expect(src).not.toMatch(/\btext-xs\b/);
  });

  it("uses cn() for conditional class composition (no ad-hoc hex ternary)", () => {
    expect(src).toMatch(/cn\(/);
    expect(src).not.toMatch(/"[^"]*#[0-9a-fA-F]{3,6}[^"]*"/);
  });
});

// ─── 13. Completed row styling ──────────────────────────────────────

describe("TasksOverviewCard — completed row styling", () => {
  const src = read(CARD_PATH);

  it("applies line-through to done row titles", () => {
    expect(src).toMatch(/line-through/);
  });

  it("done rows show CheckSquare icon (not Square)", () => {
    expect(src).toMatch(/CheckSquare/);
  });

  it("done row title uses text-muted-foreground (subtle, not heavy opacity reduction)", () => {
    // The cn() call switches between text-foreground and text-muted-foreground.
    expect(src).toMatch(/isDone.*line-through text-muted-foreground/);
  });
});

// ─── 14. Responsive layout ──────────────────────────────────────────

describe("TasksOverviewCard — responsive layout", () => {
  const src = read(CARD_PATH);

  it("title span has flex-1 truncate min-w-0 for safe truncation in flex row", () => {
    expect(src).toMatch(/flex-1 truncate min-w-0/);
  });

  it("trailing metadata spans are shrink-0 (date label + avatar never squeeze the title)", () => {
    // Multiple shrink-0 instances are expected (date span, avatar span, checkbox button).
    expect(src).toMatch(/shrink-0/);
  });
});

// ─── 15. FinancialDashboard wiring ──────────────────────────────────

describe("FinancialDashboard — tasks_overview renderer wired", () => {
  const src = read(DASH_PAGE_PATH);

  it("imports TasksOverviewCard from the canonical dashboard path", () => {
    expect(src).toMatch(
      /import\s+\{\s*TasksOverviewCard\s*\}\s+from\s+["']@\/components\/dashboard\/TasksOverviewCard["']/,
    );
  });

  it("includes tasks_overview in the renderers map", () => {
    expect(src).toMatch(/tasks_overview:\s*\(/);
  });
});

// ─── 16. Header Tasks text removed ──────────────────────────────────

describe("App.tsx — header Tasks text cleanup", () => {
  const src = read(APP_PATH);

  it("no longer renders a visible 'Tasks' text label in the header button", () => {
    expect(src).not.toMatch(/<span className="hidden 2xl:inline">Tasks<\/span>/);
  });

  it("retains the Tasks header button (icon + badge) for global access", () => {
    expect(src).toMatch(/data-testid="button-tasks-header"/);
    expect(src).toMatch(/ClipboardList/);
  });
});

// ─── 17. Backend assignedUser hydration ─────────────────────────────

describe("tasks storage — assignedUser hydration in listTasks", () => {
  const src = read("server/storage/tasks.ts");

  it("imports users from @shared/schema", () => {
    expect(src).toMatch(/\busers\b[\s\S]{0,50}from\s+["']@shared\/schema["']/);
  });

  it("calls .leftJoin(users, ...) as a query builder method in listTasks", () => {
    // leftJoin is a Drizzle builder method, not a named import from drizzle-orm.
    expect(src).toMatch(/\.leftJoin\(users/);
  });

  it("selects assignedUser fields in listTasks", () => {
    expect(src).toMatch(/assignedUser:\s*\{/);
  });

  it("maps assignedUser null-guard onto each result item", () => {
    // Ensures null is returned instead of a sparse object when no user is joined.
    expect(src).toMatch(/au\.id/);
  });
});
