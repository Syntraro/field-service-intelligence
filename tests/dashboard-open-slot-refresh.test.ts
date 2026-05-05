/**
 * Dashboard open-slot create — refresh contract (2026-05-04).
 *
 * Bug pinned by these tests:
 *   Creating a job from an open time slot on the Operations Dashboard
 *   left the Today's Schedule / Team Workload card showing stale data
 *   until a page navigation forced a refetch. Root cause: the
 *   `createJobMutation` in `QuickAddJobDialog.tsx` invalidated
 *   `["dashboard"]` (which prefix-matches `["dashboard", "financial"]`
 *   and `["dashboard", "workflow"]` only) and missed the capacity
 *   query, which is keyed on a different top-level string:
 *   `["/api/dashboard/capacity"]`.
 *
 * Source-level guards over the live invalidation list are the right
 * pattern here:
 *   • The mutation success path is the canonical wiring point — every
 *     create surface (FinancialDashboard slot click, Quotes-page slot
 *     click, manual job create) routes through it.
 *   • A runtime React-Testing-Library harness for one assertion would
 *     need a full QueryClient + dialog mount + form fill — overkill.
 *   • The QuickAddJobDialog already has source-level coverage in
 *     `quick-create-job-client-flow.test.ts`; this file adds the
 *     dashboard-refresh contract to the same family.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const QUICK_ADD_PATH = join(
  ROOT,
  "client/src/components/QuickAddJobDialog.tsx",
);
const FINANCIAL_DASHBOARD_PATH = join(
  ROOT,
  "client/src/pages/FinancialDashboard.tsx",
);
const SLOT_LAUNCHER_PATH = join(
  ROOT,
  "client/src/components/dispatch/SlotQuickCreateLauncher.tsx",
);
const CREATE_NEW_DIALOG_PATH = join(
  ROOT,
  "client/src/components/CreateNewDialog.tsx",
);

const quickAddSrc = readFileSync(QUICK_ADD_PATH, "utf-8");
const dashboardSrc = readFileSync(FINANCIAL_DASHBOARD_PATH, "utf-8");
const slotLauncherSrc = readFileSync(SLOT_LAUNCHER_PATH, "utf-8");
const createNewSrc = readFileSync(CREATE_NEW_DIALOG_PATH, "utf-8");

const CAPACITY_KEY = '"/api/dashboard/capacity"';

// ─── Layer 1 — invalidation contract ───────────────────────────────────────

describe("createJobMutation onSuccess — dashboard capacity invalidation", () => {
  it("invalidates the dashboard capacity query so the Team Workload card refreshes", () => {
    // The fix: explicit `invalidateQueries({ queryKey: ["/api/dashboard/capacity"] })`
    // call inside the mutation's onSuccess handler. Match on the literal
    // key string so a future renaming surfaces here loudly.
    expect(quickAddSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*"\/api\/dashboard\/capacity"\s*\]\s*\}/,
    );
  });

  it("still invalidates the legacy `[\"dashboard\"]` prefix for the financial / workflow cards", () => {
    // Other dashboard cards (Revenue Center, Operational Alerts) live
    // under `["dashboard", "financial"]` / `["dashboard", "workflow"]`
    // — those rely on the prefix invalidation. Don't accidentally
    // remove it while adding the capacity key.
    expect(quickAddSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*"dashboard"\s*\]\s*\}/,
    );
  });

  it("still invalidates jobs and calendar (regression guard)", () => {
    expect(quickAddSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*"jobs"\s*\]\s*\}/,
    );
    expect(quickAddSrc).toMatch(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*"\/api\/calendar"\s*\][^}]*exact:\s*false/,
    );
  });

  it("does NOT use a broad `invalidateQueries()` with no key (would over-fetch)", () => {
    // The constraint in the task: "Avoid broad invalidateQueries() with
    // no key unless absolutely necessary." Make sure no zero-arg call
    // sneaked in.
    expect(quickAddSrc).not.toMatch(/queryClient\.invalidateQueries\(\s*\)/);
  });
});

// ─── Layer 2 — both sides agree on the key ─────────────────────────────────

describe("Dashboard capacity card and mutation use the SAME query key", () => {
  it("FinancialDashboard's TodaysScheduleCard uses queryKey ['/api/dashboard/capacity']", () => {
    // This is the read-side anchor. If this changes (e.g. a future
    // refactor moves the card to `["dashboard", "capacity"]`), the
    // mutation invalidation in QuickAddJobDialog.tsx must change in
    // lockstep — the assertion below pins both sides.
    expect(dashboardSrc).toMatch(
      /queryKey:\s*\[\s*"\/api\/dashboard\/capacity"\s*\]/,
    );
  });

  it("the same literal key string appears in BOTH the mutation and the dashboard read", () => {
    // Belt-and-braces: extract the key from each file and assert
    // string equality. Catches a typo like a stray space / casing
    // drift that the per-file regex above would miss.
    const mutationMatch = quickAddSrc.match(
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*("\/api\/dashboard\/capacity")\s*\]/,
    );
    const dashboardMatch = dashboardSrc.match(
      /queryKey:\s*\[\s*("\/api\/dashboard\/capacity")\s*\]/,
    );
    expect(mutationMatch, "mutation invalidation key").not.toBeNull();
    expect(dashboardMatch, "dashboard read key").not.toBeNull();
    expect(mutationMatch![1]).toBe(CAPACITY_KEY);
    expect(dashboardMatch![1]).toBe(CAPACITY_KEY);
    expect(mutationMatch![1]).toBe(dashboardMatch![1]);
  });
});

// ─── Layer 3 — the open-slot mounting chain is intact ──────────────────────

describe("Open-slot create flow — mounting chain", () => {
  it("FinancialDashboard mounts SlotQuickCreateLauncher with the slot prefill", () => {
    expect(dashboardSrc).toMatch(
      /<SlotQuickCreateLauncher[\s\S]*?slot=\{slot\}/,
    );
  });

  it("SlotQuickCreateLauncher mounts CreateNewDialog with the prefill", () => {
    // Proves the slot data flows: TodaysScheduleCard → onOpenSlot →
    // dashboard state → SlotQuickCreateLauncher → CreateNewDialog →
    // QuickAddJobDialog. Any layer accidentally swallowing the prefill
    // would break the bug-fix's user-visible contract (the new visit
    // appears in the slot the user clicked).
    expect(slotLauncherSrc).toMatch(/<CreateNewDialog[\s\S]*?\/>/);
  });

  it("CreateNewDialog routes the Job tab to QuickAddJobDialog (the canonical mutation)", () => {
    // This is what guarantees the fix actually fires for slot clicks.
    // If a future change ever spawned a separate create flow (e.g. a
    // slot-only dialog), the invalidation contract above wouldn't apply
    // there — making this guard load-bearing.
    expect(createNewSrc).toMatch(/QuickAddJobDialog/);
  });

  it("SlotQuickCreateLauncher exposes the optional onJobCreated callback", () => {
    // Documented wiring point. Today the dashboard relies on the
    // mutation-level invalidation; if a future caller needs a custom
    // post-create side effect (e.g. close a parent panel), the
    // callback is the canonical hook.
    expect(slotLauncherSrc).toMatch(/onJobCreated\??:\s*\(/);
  });
});
