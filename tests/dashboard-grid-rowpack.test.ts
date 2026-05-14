/**
 * Dashboard 3-column card system — row-pack + width-units +
 * Today's Schedule dynamic width — contract tests (2026-05-07 RALPH).
 *
 * Pins the canonical 3-column model: every widget is 1, 2, or 3
 * units wide, rows pack <= 3 units, slack rows are rebalanced into
 * clean shares so hiding any single card never leaves orphaned odd
 * spacing. Today's Schedule supports a runtime width override (1 / 2
 * / 3) driven by the visible team count, so the schedule card never
 * stretches wider than the data inside it warrants.
 *
 * The drag-handle visible affordance is exercised here too — same
 * brief, related fix.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  packDashboardRows,
  spanClassFor,
  widthUnitsFor,
  heightPresetFor,
  PRESET_WIDTH_UNITS,
} from "../client/src/dashboard/DashboardWidgetGrid";
import type { DashboardLayoutResponseEntry } from "../client/src/dashboard/dashboardLayoutSchemas";
import { FINANCIAL_DASHBOARD_WIDGETS } from "../shared/dashboardWidgetRegistry";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);
const RENDERER_PATH = path("client/src/dashboard/DashboardWidgetRenderer.tsx");
const GRID_PATH = path("client/src/dashboard/DashboardWidgetGrid.tsx");
const REGISTRY_PATH = path("shared/dashboardWidgetRegistry.ts");
const SCHEMAS_PATH = path("client/src/dashboard/dashboardLayoutSchemas.ts");
const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

/** Helper: build a synthetic widget entry from a sizePreset. */
function w(
  key: string,
  sizePreset: DashboardLayoutResponseEntry["sizePreset"],
  visible = true,
  heightPreset: DashboardLayoutResponseEntry["heightPreset"] = "auto",
): DashboardLayoutResponseEntry {
  return {
    widgetKey: key,
    visible,
    orderIndex: 0,
    title: key,
    sizePreset,
    heightPreset,
    description: null,
    allowed: true,
  };
}

// ─── 1. PRESET_WIDTH_UNITS — canonical preset → unit mapping ────────

describe("PRESET_WIDTH_UNITS — registry preset → 3-column unit mapping", () => {
  it("third → 1 unit", () => {
    expect(PRESET_WIDTH_UNITS.third).toBe(1);
  });
  it("two-thirds → 2 units", () => {
    expect(PRESET_WIDTH_UNITS["two-thirds"]).toBe(2);
  });
  it("full → 3 units", () => {
    expect(PRESET_WIDTH_UNITS.full).toBe(3);
  });
});

// ─── 2. widthUnitsFor — runtime overrides win over preset ──────────

describe("widthUnitsFor — runtime override wins over preset", () => {
  it("returns the preset unit when no override is supplied", () => {
    expect(widthUnitsFor(w("k", "third"))).toBe(1);
    expect(widthUnitsFor(w("k", "two-thirds"))).toBe(2);
    expect(widthUnitsFor(w("k", "full"))).toBe(3);
  });

  it("returns the override when supplied", () => {
    const widget = w("todays_schedule", "two-thirds");
    expect(widthUnitsFor(widget, { todays_schedule: 1 })).toBe(1);
    expect(widthUnitsFor(widget, { todays_schedule: 2 })).toBe(2);
    expect(widthUnitsFor(widget, { todays_schedule: 3 })).toBe(3);
  });

  it("falls back to the preset when the override key does not match this widget", () => {
    const widget = w("operational_alerts", "third");
    expect(widthUnitsFor(widget, { todays_schedule: 3 })).toBe(1);
  });
});

// ─── 2b. heightPresetFor — runtime overrides win over preset ───────

describe("heightPresetFor — runtime override wins over preset", () => {
  it("returns the registry preset when no override is supplied", () => {
    expect(heightPresetFor(w("k", "third", true, "summary"))).toBe("summary");
    expect(heightPresetFor(w("k", "two-thirds", true, "large"))).toBe("large");
    expect(heightPresetFor(w("k", "third", true, "auto"))).toBe("auto");
    expect(heightPresetFor(w("k", "third", true, "compact"))).toBe("compact");
  });

  it("returns the override when supplied for the matching widget key", () => {
    const ts = w("todays_schedule", "two-thirds", true, "large");
    expect(heightPresetFor(ts, { todays_schedule: "summary" })).toBe("summary");
    expect(heightPresetFor(ts, { todays_schedule: "compact" })).toBe("compact");
    expect(heightPresetFor(ts, { todays_schedule: "auto" })).toBe("auto");
  });

  it("falls back to the preset when the override key targets a different widget", () => {
    const oa = w("operational_alerts", "third", true, "summary");
    expect(heightPresetFor(oa, { todays_schedule: "compact" })).toBe("summary");
  });

  it("the resolver still HONOURS overrides if a future caller passes one", () => {
    // The page no longer passes a Today's Schedule height override
    // (height is standardized), but the resolver remains a forward-
    // compatibility escape hatch — pin that contract directly.
    const ts = w("todays_schedule", "two-thirds", true, "summary");
    expect(heightPresetFor(ts, { todays_schedule: "compact" })).toBe("compact");
    expect(heightPresetFor(ts, {})).toBe("summary");
  });
});

// ─── 2c. Today's Schedule height is INDEPENDENT of tech count ───────

describe("Today's Schedule — height does NOT depend on tech count", () => {
  it("registry preset is summary regardless of any runtime concept", () => {
    const def = FINANCIAL_DASHBOARD_WIDGETS.find(
      (d) => d.key === "todays_schedule",
    );
    expect(def?.heightPreset).toBe("summary");
  });

  it("the resolver returns summary for TS when no override is passed", () => {
    const ts = w("todays_schedule", "two-thirds", true, "summary");
    expect(heightPresetFor(ts)).toBe("summary");
    // The page does NOT pass an override now; this is the canonical
    // path at every tech count (1, 2, 3+).
    expect(heightPresetFor(ts, {})).toBe("summary");
  });

  it("every default-financial widget resolves to summary", () => {
    // All six widgets land on the same canonical preset, so every
    // dashboard card has the same visual height.
    for (const def of FINANCIAL_DASHBOARD_WIDGETS) {
      const synthetic = w(
        def.key,
        def.sizePreset,
        true,
        def.heightPreset ?? "auto",
      );
      expect(heightPresetFor(synthetic)).toBe("summary");
    }
  });
});

// ─── 3. packDashboardRows — greedy 3-unit packing ──────────────────

describe("packDashboardRows — greedy 3-unit packing", () => {
  it("returns an empty array for no widgets", () => {
    expect(packDashboardRows([])).toEqual([]);
  });

  it("packs three 1-column widgets into a single row of 3", () => {
    const rows = packDashboardRows([
      w("a", "third"),
      w("b", "third"),
      w("c", "third"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(3);
  });

  it("packs a 2-column + 1-column into a single row", () => {
    const rows = packDashboardRows([
      w("schedule", "two-thirds"),
      w("alerts", "third"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].map((x) => x.widgetKey)).toEqual(["schedule", "alerts"]);
  });

  it("a 3-column widget always occupies its own row", () => {
    const rows = packDashboardRows([
      w("a", "third"),
      w("b", "third"),
      w("na", "full"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toEqual([
      expect.objectContaining({ widgetKey: "na" }),
    ]);
  });

  it("preserves user-specified order across rows", () => {
    const order = ["a", "b", "c", "d", "e", "f"];
    const rows = packDashboardRows(order.map((k) => w(k, "third")));
    expect(rows).toHaveLength(2);
    const flattened = rows.flat().map((x) => x.widgetKey);
    expect(flattened).toEqual(order);
  });

  it("starts a new row when adding the next widget would exceed 3 units", () => {
    const rows = packDashboardRows([
      w("ts", "two-thirds"),
      w("oa", "third"),
      w("p", "third"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(1);
  });

  it("packs the canonical financial layout into 3 clean rows", () => {
    // 2026-05-07: NA retired; 2026-05-12: tasks_overview added (third).
    // Default layout:
    //   row 1: TS(2) + Pipeline(1) = 3 units
    //   row 2: Collections(1) + Scheduled Revenue(1) + Operational Alerts(1) = 3 units
    //   row 3: Tasks(1) = 1 unit
    const widgets = FINANCIAL_DASHBOARD_WIDGETS.map((d) =>
      w(d.key, d.sizePreset),
    );
    const rows = packDashboardRows(widgets);
    expect(rows).toHaveLength(3);
    expect(rows[0].map((x) => x.widgetKey)).toEqual([
      "todays_schedule",
      "pipeline_snapshot",
    ]);
    expect(rows[1].map((x) => x.widgetKey)).toEqual([
      "collections_overview",
      "scheduled_revenue",
      "operational_alerts",
    ]);
    expect(rows[2].map((x) => x.widgetKey)).toEqual(["tasks_overview"]);
    // Inverse pin: the retired widget MUST NOT reappear in the packed rows.
    const flatKeys = rows.flat().map((r) => r.widgetKey);
    expect(flatKeys).not.toContain("needs_attention");
  });

  it("respects width overrides during packing (TS at 1 unit)", () => {
    // Today's Schedule shrunk to 1 unit (only 1 visible team member).
    // The six canonical widgets (TS + 5 thirds) pack into:
    //   row 1: TS(1) + Pipeline(1) + Collections(1) = 3 units
    //   row 2: Scheduled(1) + OA(1) + Tasks(1) = 3 units
    const widgets = FINANCIAL_DASHBOARD_WIDGETS.map((d) =>
      w(d.key, d.sizePreset),
    );
    const rows = packDashboardRows(widgets, { todays_schedule: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].map((x) => x.widgetKey)).toEqual([
      "todays_schedule",
      "pipeline_snapshot",
      "collections_overview",
    ]);
    expect(rows[1].map((x) => x.widgetKey)).toEqual([
      "scheduled_revenue",
      "operational_alerts",
      "tasks_overview",
    ]);
  });
});

// ─── 4. spanClassFor — STRICT widths, never stretch ────────────────

describe("spanClassFor — every widget always renders at its natural width", () => {
  it("uses the natural class when a row of 2+1 sums to 3 (mixed presets)", () => {
    const ts = w("ts", "two-thirds");
    const oa = w("oa", "third");
    const row = [ts, oa];
    expect(spanClassFor(ts, row)).toBe("col-span-12 xl:col-span-8");
    expect(spanClassFor(oa, row)).toBe("col-span-12 md:col-span-6 xl:col-span-4");
  });

  it("uses the natural class when a row of 3 ones sums to 3 units", () => {
    const a = w("a", "third");
    const b = w("b", "third");
    const c = w("c", "third");
    const row = [a, b, c];
    expect(spanClassFor(a, row)).toBe("col-span-12 md:col-span-6 xl:col-span-4");
  });

  it("a single 1-unit widget alone in a row stays at xl:col-span-4 (no stretch)", () => {
    // Strict 3-card system — leftover 2/3 of the row remains EMPTY.
    const a = w("a", "third");
    const row = [a];
    expect(spanClassFor(a, row)).toBe("col-span-12 md:col-span-6 xl:col-span-4");
  });

  it("two 1-unit widgets in a row stay at xl:col-span-4 each (no stretch)", () => {
    // Strict 3-card system — final 1/3 of the row remains EMPTY,
    // NOT promoted to halves.
    const a = w("a", "third");
    const b = w("b", "third");
    const row = [a, b];
    expect(spanClassFor(a, row)).toBe("col-span-12 md:col-span-6 xl:col-span-4");
    expect(spanClassFor(b, row)).toBe("col-span-12 md:col-span-6 xl:col-span-4");
  });

  it("a 2-unit widget alone in a row stays at xl:col-span-8 (no stretch to full)", () => {
    const ts = w("ts", "two-thirds");
    const row = [ts];
    expect(spanClassFor(ts, row)).toBe("col-span-12 xl:col-span-8");
  });

  it("when Today's Schedule is hidden, surviving 1-cols stay 1-col on desktop", () => {
    // 2026-05-07: NA gone. Default order minus TS: [Pipeline,
    // Collections, Scheduled, OA] — four 1-unit widgets, greedy 3-unit
    // packing →
    //   row 1: Pipeline + Collections + Scheduled (3 units, intact)
    //   row 2: OA (1 unit) — stays at xl:col-span-4, NOT promoted to
    //          full width. Empty trailing 2/3 is acceptable.
    const visible = FINANCIAL_DASHBOARD_WIDGETS
      .filter((d) => d.key !== "todays_schedule")
      .map((d) => w(d.key, d.sizePreset));
    const rows = packDashboardRows(visible);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((x) => x.widgetKey)).toEqual([
      "pipeline_snapshot",
      "collections_overview",
      "scheduled_revenue",
    ]);
    for (const widget of rows[0]) {
      expect(spanClassFor(widget, rows[0])).toBe(
        "col-span-12 md:col-span-6 xl:col-span-4",
      );
    }
    expect(rows[1].map((x) => x.widgetKey)).toEqual([
      "operational_alerts",
      "tasks_overview",
    ]);
    for (const widget of rows[1]) {
      expect(spanClassFor(widget, rows[1])).toBe(
        "col-span-12 md:col-span-6 xl:col-span-4",
      );
    }
  });

  it("hiding Operational Alerts keeps Collections + Scheduled at 1/3 each (no stretch)", () => {
    // 2026-05-07: NA gone. Default order minus OA: [TS, Pipeline,
    // Collections, Scheduled]. Greedy 3-unit packing →
    //   row 1: TS(2) + Pipeline(1) = 3 units, intact
    //   row 2: Collections(1) + Scheduled(1) = 2 units, slack 1/3.
    const visible = FINANCIAL_DASHBOARD_WIDGETS
      .filter((d) => d.key !== "operational_alerts")
      .map((d) => w(d.key, d.sizePreset));
    const rows = packDashboardRows(visible);
    expect(rows).toHaveLength(2);
    expect(rows[1].map((x) => x.widgetKey)).toEqual([
      "collections_overview",
      "scheduled_revenue",
      "tasks_overview",
    ]);
    for (const widget of rows[1]) {
      expect(spanClassFor(widget, rows[1])).toBe(
        "col-span-12 md:col-span-6 xl:col-span-4",
      );
    }
  });

  it("Pipeline / Collections / Scheduled / OA all share the same 1-unit span class", () => {
    const oneCols = ["pipeline_snapshot", "collections_overview", "scheduled_revenue", "operational_alerts"];
    const expected = "col-span-12 md:col-span-6 xl:col-span-4";
    for (const key of oneCols) {
      const def = FINANCIAL_DASHBOARD_WIDGETS.find((d) => d.key === key);
      expect(def?.sizePreset).toBe("third");
      const row = [w(key, "third")];
      expect(spanClassFor(row[0], row)).toBe(expected);
    }
  });

  it("a full-preset widget always renders at full width regardless of neighbours", () => {
    // 2026-05-07: the canonical full-width consumer (Needs Attention)
    // was retired; this property test now exercises the spanClassFor
    // contract for any future full-preset widget without referencing
    // a registry key that no longer exists.
    const fullWidget = w("synthetic_full", "full");
    expect(spanClassFor(fullWidget, [fullWidget])).toBe("col-span-12");
  });
});

// ─── 5. Today's Schedule dynamic width ─────────────────────────────

describe("Today's Schedule — dynamic width via runtime override", () => {
  const baseWidgets = () =>
    FINANCIAL_DASHBOARD_WIDGETS.map((d) => w(d.key, d.sizePreset));

  it("at 1 visible team member, schedule is 1-column", () => {
    const widgets = baseWidgets();
    const ts = widgets.find((x) => x.widgetKey === "todays_schedule")!;
    expect(widthUnitsFor(ts, { todays_schedule: 1 })).toBe(1);
  });

  it("at 2 visible team members, schedule is 2-column", () => {
    const widgets = baseWidgets();
    const ts = widgets.find((x) => x.widgetKey === "todays_schedule")!;
    expect(widthUnitsFor(ts, { todays_schedule: 2 })).toBe(2);
  });

  it("at 3 visible team members, schedule is 3-column", () => {
    const widgets = baseWidgets();
    const ts = widgets.find((x) => x.widgetKey === "todays_schedule")!;
    expect(widthUnitsFor(ts, { todays_schedule: 3 })).toBe(3);
  });

  it("more than 3 visible team members still maps to 3 (the page clamps)", () => {
    // The override value itself is a 1|2|3 union — the page clamps
    // any tech count > 3 down to 3 before passing it in. We pin that
    // contract on the page source below.
    const widgets = baseWidgets();
    const ts = widgets.find((x) => x.widgetKey === "todays_schedule")!;
    expect(widthUnitsFor(ts, { todays_schedule: 3 })).toBe(3);
  });

  it("schedule at width 1 leaves room for two 1-col peers in the same row", () => {
    // With the new default order: TS(1) + Pipeline(1) + Collections(1)
    // = 3 units → row is intact, natural classes throughout.
    const widgets = baseWidgets();
    const rows = packDashboardRows(widgets, { todays_schedule: 1 });
    expect(rows[0].map((x) => x.widgetKey)).toEqual([
      "todays_schedule",
      "pipeline_snapshot",
      "collections_overview",
    ]);
    for (const widget of rows[0]) {
      expect(spanClassFor(widget, rows[0], { todays_schedule: 1 })).toBe(
        "col-span-12 md:col-span-6 xl:col-span-4",
      );
    }
  });

  it("schedule at width 3 occupies its own row, leaving the metric trio intact", () => {
    const widgets = baseWidgets();
    const rows = packDashboardRows(widgets, { todays_schedule: 3 });
    expect(rows[0].map((x) => x.widgetKey)).toEqual(["todays_schedule"]);
    expect(spanClassFor(rows[0][0], rows[0], { todays_schedule: 3 })).toBe(
      "col-span-12",
    );
    // Pipeline + Collections + Scheduled still pack as a clean 3-unit row.
    expect(rows[1].map((x) => x.widgetKey)).toEqual([
      "pipeline_snapshot",
      "collections_overview",
      "scheduled_revenue",
    ]);
  });
});

// ─── 6. Page wires the schedule width override ─────────────────────

describe("FinancialDashboard — wires todaysScheduleWidthUnits into the grid", () => {
  const code = read(PAGE_PATH);

  it("computes scheduleVisibleTechCount from the lifted scope state", () => {
    expect(code).toMatch(/scheduleScopeIds/);
    expect(code).toMatch(/scheduleVisibleTechCount/);
  });

  it("clamps the visible tech count to the 1/2/3 unit union", () => {
    expect(code).toMatch(/todaysScheduleWidthUnits:\s*1\s*\|\s*2\s*\|\s*3/);
  });

  it("passes widgetWidthOverrides to <DashboardWidgetGrid>", () => {
    expect(code).toMatch(/widgetWidthOverrides/);
    expect(code).toMatch(/widthOverrides=\{widgetWidthOverrides\}/);
  });

  it("the schedule capacity query is gated on todays_schedule visibility", () => {
    // Hidden widget rule: the page-level capacity query must not fire
    // when Today's Schedule is hidden.
    expect(code).toMatch(
      /enabled:\s*visibleSet\.has\("todays_schedule"\)/,
    );
  });

  it("threads scopeIds + onScopeIdsChange to TodaysScheduleCard (controlled)", () => {
    expect(code).toMatch(/scopeIds=\{scheduleScopeIds\}/);
    expect(code).toMatch(/onScopeIdsChange=\{setScheduleScopeIds\}/);
  });

  it("does NOT compute or pass a dynamic height preset for Today's Schedule", () => {
    // 2026-05-07 RALPH: card height is fixed via the canonical
    // `summary` preset for every widget. Tech-count-driven height
    // logic was removed.
    expect(code).not.toMatch(/todaysScheduleHeightPreset/);
    expect(code).not.toMatch(/widgetHeightOverrides/);
    expect(code).not.toMatch(/heightOverrides=\{/);
  });

  it("threads compact={todaysScheduleCompact} to TodaysScheduleCard", () => {
    expect(code).toMatch(/todaysScheduleCompact/);
    expect(code).toMatch(/compact=\{todaysScheduleCompact\}/);
  });

  it("no longer renders an in-card '+ Create' button or its launcher", () => {
    // 2026-05-07 RALPH: schedule's "+ Create" button removed. The
    // CreateNewDialog mount + createOpen state are gone too.
    expect(code).not.toMatch(/data-testid="schedule-create"/);
    expect(code).not.toMatch(/setCreateOpen/);
    // The previous onCreate prop must NOT be threaded into the card.
    expect(code).not.toMatch(/onCreate=\{\(\)\s*=>\s*setCreateOpen/);
  });
});

// ─── 6b. Today's Schedule compact-mode header ──────────────────────

describe("TodaysScheduleCard — compact-mode header (1-column)", () => {
  const code = read(PAGE_PATH);

  it("accepts a `compact?: boolean` prop", () => {
    expect(code).toMatch(/compact\?:\s*boolean/);
  });

  it("renders the title as 'Today' (not 'Today's Schedule')", () => {
    // The h3 lives between an apostrophe-stripped 'Today' literal and
    // the trailing scope-suffix block; pin the literal directly.
    expect(code).toMatch(/<h3[^>]*>\s*Today/);
    expect(code).not.toMatch(/Today&apos;s Schedule/);
  });

  it("suppresses the / scope suffix when compact", () => {
    expect(code).toMatch(/!compact\s*&&\s*scopeHeaderSuffix/);
  });

  it("suppresses the Unscheduled chip when compact", () => {
    // Booked% was removed; only Unscheduled remains.
    expect(code).toMatch(
      /!compact\s*&&\s*unscheduledJobsCount\s*>\s*0/,
    );
  });

  it("the in-card Create button JSX is gone", () => {
    expect(code).not.toMatch(/<Plus\s+className="h-3\.5 w-3\.5"\s*\/>\s*\n?\s*Create/);
    expect(code).not.toMatch(/data-testid="schedule-create"/);
  });

  it("open-slot click handler still routes through onOpenSlot", () => {
    // Open-slot creation is preserved — only the standalone "+ Create"
    // affordance was removed.
    expect(code).toMatch(/onOpenSlot\(/);
    expect(code).toMatch(/handleBlockClick/);
  });

  it("the schedule body scrolls internally when content overflows", () => {
    // 2026-05-07 RALPH: card height is fixed (`summary` preset) so
    // the body must scroll its own surplus rather than growing the
    // card. The body wrapper carries `overflow-y-auto` + `min-h-0`
    // (the latter lets the flex child shrink under the parent's
    // fixed-height constraint).
    expect(code).toMatch(
      /flex-1 flex flex-col min-h-0 overflow-y-auto/,
    );
    expect(code).toMatch(/data-testid="schedule-body-scroll"/);
  });
});

// ─── 7. Registry size + height preset contracts ────────────────────

describe("Registry — size + height presets", () => {
  const code = read(REGISTRY_PATH);

  it("exposes the three canonical sizePreset values in the type union", () => {
    expect(code).toMatch(/"full"\s*\|\s*"two-thirds"\s*\|\s*"third"/);
  });

  it("does NOT include a half preset (3-column system only)", () => {
    expect(code).not.toMatch(/"half"/);
  });

  it("exposes the four canonical heightPreset values in the type union", () => {
    expect(code).toMatch(/"summary"\s*\|\s*"large"\s*\|\s*"compact"\s*\|\s*"auto"/);
  });

  it("Today's Schedule is sized as two-thirds (width) + heightPreset summary", () => {
    // 2026-05-07 RALPH: card height standardized to `summary` for
    // every widget. Width is still dynamic via runtime override.
    const def = FINANCIAL_DASHBOARD_WIDGETS.find(
      (d) => d.key === "todays_schedule",
    );
    expect(def?.sizePreset).toBe("two-thirds");
    expect(def?.heightPreset).toBe("summary");
  });

  it("Needs Attention is no longer in the registry (retired 2026-05-07)", () => {
    // 2026-05-07: the standalone Needs Attention card was retired and
    // its single row ("Invoices not sent") absorbed into Operational
    // Alerts. Inverse pin so a future PR can't silently re-introduce
    // the widget — the page-level renderer map would have no matching
    // entry and the resolver would surface a console warn at mount.
    const def = FINANCIAL_DASHBOARD_WIDGETS.find(
      (d) => d.key === "needs_attention",
    );
    expect(def).toBeUndefined();
  });

  it("every default-financial widget shares heightPreset summary", () => {
    for (const def of FINANCIAL_DASHBOARD_WIDGETS) {
      expect(def.heightPreset).toBe("summary");
    }
  });

  it("every default-financial widget except Today's Schedule is sized third", () => {
    // Brief rule: default widget width is 1-column. Only TS deviates
    // (and it's runtime-overridden by visible team count anyway).
    for (const def of FINANCIAL_DASHBOARD_WIDGETS) {
      if (def.key === "todays_schedule") continue;
      expect(def.sizePreset).toBe("third");
    }
  });

  it("the four metric thirds share heightPreset summary so they align in their row", () => {
    const summaryKeys = [
      "operational_alerts",
      "pipeline_snapshot",
      "collections_overview",
      "scheduled_revenue",
    ];
    for (const key of summaryKeys) {
      const def = FINANCIAL_DASHBOARD_WIDGETS.find((d) => d.key === key);
      expect(def?.sizePreset).toBe("third");
      expect(def?.heightPreset).toBe("summary");
    }
  });
});

// ─── 8. Wire schema mirrors registry types ─────────────────────────

describe("Wire schema — DashboardLayoutResponseEntry mirrors registry", () => {
  const code = read(SCHEMAS_PATH);

  it("response shape includes the three sizePreset values", () => {
    expect(code).toMatch(
      /sizePreset:\s*"full"\s*\|\s*"two-thirds"\s*\|\s*"third"/,
    );
  });

  it("response shape includes the four heightPreset values", () => {
    expect(code).toMatch(
      /heightPreset:\s*"summary"\s*\|\s*"large"\s*\|\s*"compact"\s*\|\s*"auto"/,
    );
  });
});

// ─── 9. Grid surface — exports + height + structure ────────────────

describe("DashboardWidgetGrid — height + structure", () => {
  const code = read(GRID_PATH);

  it("exposes packDashboardRows + spanClassFor + widthUnitsFor + heightPresetFor + PRESET_WIDTH_UNITS", () => {
    expect(code).toMatch(/export function packDashboardRows/);
    expect(code).toMatch(/export function spanClassFor/);
    expect(code).toMatch(/export function widthUnitsFor/);
    expect(code).toMatch(/export function heightPresetFor/);
    expect(code).toMatch(/export const PRESET_WIDTH_UNITS/);
  });

  it("maps heightPreset summary to a FIXED height class (no growth with content)", () => {
    // 2026-05-07 RALPH: card height is fixed at the canonical
    // `summary` preset across the dashboard. Today's Schedule body
    // scrolls internally if it overflows.
    expect(code).toMatch(/summary:\s*"h-\[/);
  });

  it("maps heightPreset large to a fixed height class (kept as escape hatch)", () => {
    // `large` is no longer used by any default widget but stays in
    // the type union for forward compatibility.
    expect(code).toMatch(/large:\s*"h-\[/);
  });

  it("compact and auto heightPresets do NOT impose a min-h", () => {
    expect(code).toMatch(/compact:\s*""/);
    expect(code).toMatch(/auto:\s*""/);
  });

  it("annotates each cell with row + width data attributes", () => {
    expect(code).toMatch(/data-dashboard-row=/);
    expect(code).toMatch(/data-dashboard-row-size=/);
    expect(code).toMatch(/data-dashboard-row-units=/);
    expect(code).toMatch(/data-dashboard-width-units=/);
  });

  it("does NOT carry an equal-split lookup or row-balanced annotation", () => {
    // Strict 3-card system — leftover row space stays empty, never
    // rebalanced. The grid should expose the natural-span lookup only.
    expect(code).not.toMatch(/EQUAL_SPLIT_CLASSES/);
    expect(code).not.toMatch(/data-dashboard-row-balanced/);
  });

  it("accepts widthOverrides as a prop on <DashboardWidgetGrid>", () => {
    expect(code).toMatch(/widthOverrides\?:/);
  });

  it("accepts heightOverrides as a prop on <DashboardWidgetGrid>", () => {
    expect(code).toMatch(/heightOverrides\?:/);
  });

  it("accepts rowSpanOverrides as a prop on <DashboardWidgetGrid>", () => {
    expect(code).toMatch(/rowSpanOverrides\?:/);
  });

  it("exposes rowSpanFor for callers + tests", () => {
    expect(code).toMatch(/export function rowSpanFor/);
  });

  it("annotates each cell with the resolved height-preset + row-span attributes", () => {
    expect(code).toMatch(/data-dashboard-height-preset=/);
    expect(code).toMatch(/data-dashboard-row-span=/);
  });

  it("row-span 2 cells emit row-span-2 className AND drop the fixed h-[…] class", () => {
    // The cell uses a ternary: row-span 2 → empty string for height
    // (so the cell stretches to fill 2 row tracks), row-span 1 →
    // the canonical fixed height.
    expect(code).toMatch(/resolvedRowSpan === 2\s*\?\s*""\s*:\s*HEIGHT_CLASSES\[resolvedHeight\]/);
    expect(code).toMatch(/resolvedRowSpan === 2\s*\?\s*"row-span-2"\s*:\s*""/);
  });
});

// ─── 10. Drag handle visible affordance (lives on the GRID now) ────
//
// 2026-05-07 RALPH (drag relocation): drag/reorder was originally
// placed in the customize drawer rows. It is now on the live
// dashboard grid — every grid cell carries a small handle button in
// the top-right corner. The drawer is a pure toggle list.

describe("DashboardWidgetGrid — drag handle is visibly a button", () => {
  const code = read(GRID_PATH);

  it("the handle is positioned absolutely in the cell corner", () => {
    expect(code).toMatch(/absolute[\s\S]*?top-1\.5[\s\S]*?right-1\.5/);
  });

  it("the handle has a default surface (with backdrop-blur for legibility over content)", () => {
    expect(code).toMatch(/backdrop-blur-sm/);
  });

  it("the handle has a border so the button frame reads at a glance", () => {
    expect(code).toMatch(/border\s+border-card-border/);
  });

  it("the GripVertical icon itself is sized for the 28×28 cell handle (h-3.5 w-3.5)", () => {
    expect(code).toMatch(/<GripVertical[\s\S]*?h-3\.5\s+w-3\.5/);
  });

  it("the handle is the dnd-kit activator (carries attributes + listeners)", () => {
    const buttonMatch = code.match(/<button[\s\S]*?<\/button>/);
    expect(buttonMatch).not.toBeNull();
    if (buttonMatch) {
      expect(buttonMatch[0]).toMatch(/\.\.\.attributes/);
      expect(buttonMatch[0]).toMatch(/\.\.\.listeners/);
    }
  });
});

describe("DashboardWidgetRenderer — toggle row carries no drag wiring", () => {
  const code = read(RENDERER_PATH);

  it("renderer does NOT spread dnd-kit listeners (drag is on the grid)", () => {
    expect(code).not.toMatch(/\.\.\.listeners/);
    expect(code).not.toMatch(/\.\.\.attributes/);
  });

  it("renderer does NOT call useSortable (drag is on the grid)", () => {
    expect(code).not.toMatch(/useSortable\(/);
  });

  it("the visibility Switch is independently clickable", () => {
    const switchMatch = code.match(/<Switch[\s\S]*?\/>/);
    expect(switchMatch).not.toBeNull();
    if (switchMatch) {
      expect(switchMatch[0]).toMatch(/onCheckedChange/);
    }
  });
});

// ─── 11. Drawer helper text reflects the new split ─────────────────

describe("DashboardCustomizeDrawer — relocated-drag helper copy", () => {
  const drawerPath = path("client/src/dashboard/DashboardCustomizeDrawer.tsx");
  const code = read(drawerPath);

  it("the drawer copy points users to the dashboard grid for reorder", () => {
    expect(code).toMatch(/[Dd]rag widgets directly on the dashboard to reorder/);
  });

  it("the drawer copy still explains toggle behaviour", () => {
    expect(code).toMatch(/Toggle widgets to show or hide them/);
  });

  it("renders the helper copy with the canonical text-row + text-text-muted tokens", () => {
    expect(code).toMatch(/SheetDescription[^>]*className="text-row text-text-muted"/);
  });
});
