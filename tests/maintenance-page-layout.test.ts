/**
 * Maintenance page (`/pm`) layout — compact rebuild (2026-05-06).
 *
 * The previous layout stacked a large H1 + subtitle + a separate
 * tabs-in-card surface + a 3-card KPI grid + a controls header
 * before the table ever rendered, pushing the Work Due data far
 * down the viewport. This pass:
 *
 *   • compact single-row header (title + inline tabs + New Plan)
 *   • horizontal KPI strip (dueNow / thisWeek / overdue)
 *   • single white rounded controls row (filter + search + bulk-gen)
 *   • "Plans Due Now (N)" heading directly above the table
 *
 * Backend, save endpoints, generation behavior, recurrence model,
 * and the inner table styling are intentionally unchanged.
 *
 * This file source-pins the new structure so a future refactor that
 * reverts to the old layout (or adds a stray subtitle / KPI card
 * grid back) trips here first.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const pmSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/PMWorkspacePage.tsx"),
  "utf-8",
);

// ── Header row ───────────────────────────────────────────────────────

describe("PMWorkspacePage — compact header row", () => {
  it("page title is 'Service Plans' (matches the renamed sidebar destination label)", () => {
    // The H1 must read "Service Plans" — matches the 2026-05-07
    // module rename. Both the older "Maintenance Plans" string and
    // the intermediate "Maintenance" H1 are gone from the render.
    expect(pmSrc).toMatch(
      /<h1[^>]*data-testid="pm-page-title"[^>]*>\s*Service Plans\s*<\/h1>/,
    );
    expect(pmSrc).not.toMatch(
      /<h1[^>]*>\s*Maintenance Plans\s*<\/h1>/,
    );
    expect(pmSrc).not.toMatch(
      /<h1[^>]*>\s*Maintenance\s*<\/h1>/,
    );
  });

  it("the long subtitle paragraph is removed from the page header", () => {
    // The brief: "Remove the large subtitle/description from the
    // main page header." The old marketing line is gone; nothing
    // sits between the H1 and the inline tabs.
    expect(pmSrc).not.toMatch(
      /Create service plans, schedule recurring work, and generate jobs\./,
    );
  });

  it("tabs are rendered INLINE inside the header row (not in a separate card)", () => {
    // Pin the data-testid on the inline TabsList AND the absence of
    // the prior outer card wrapper (the "premium white container"
    // around tabs is gone — tabs sit on the header itself).
    expect(pmSrc).toMatch(/data-testid="pm-inline-tabs"/);
    // The old wrapper used `bg-white rounded-xl border border-slate-200
    // shadow-sm overflow-hidden` immediately around the Tabs root.
    // It must not return.
    expect(pmSrc).not.toMatch(
      /bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">\s*\n?\s*<Tabs/,
    );
  });

  it("the three tab triggers (Work Due / Plans / Templates) keep their canonical testids", () => {
    expect(pmSrc).toMatch(/data-testid="tab-work-due"/);
    expect(pmSrc).toMatch(/data-testid="tab-plans"/);
    expect(pmSrc).toMatch(/data-testid="tab-templates"/);
  });

  it("active tab uses an underline accent (not a filled pill)", () => {
    // The brief: "Keep tabs visually connected to the header with a
    // subtle active underline." Pin the data-state=active style
    // applied to the trigger className: a bottom-border accent in
    // the brand lime (`#76B054`).
    expect(pmSrc).toMatch(
      /data-\[state=active\]:border-b-\[#76B054\]/,
    );
  });

  it("the '+ New Plan' header dropdown trigger is preserved", () => {
    expect(pmSrc).toMatch(/data-testid="header-new-plan"/);
    // The two existing dropdown actions (Service plan / Recurring job)
    // remain — the brief explicitly preserves recurrence behavior.
    // 2026-05-07 rename: "Maintenance plan" → "Service plan" inside
    // the dropdown so the verb in the trigger menu matches the
    // module identity.
    expect(pmSrc).toMatch(/Service plan/);
    expect(pmSrc).toMatch(/Recurring job/);
  });
});

// ── KPI strip ────────────────────────────────────────────────────────

describe("PMWorkspacePage — horizontal KPI strip", () => {
  it("renders a single white rounded strip with divided stats (not three full cards)", () => {
    // Pin both the new strip data-testid AND the structural pattern
    // (single white rounded card + `divide-x` separators).
    expect(pmSrc).toMatch(/data-testid="pm-kpi-strip"/);
    expect(pmSrc).toMatch(
      /bg-white rounded-lg border[\s\S]*?divide-x divide-slate-200/,
    );
  });

  it("strip preserves the three labels with their existing icon colors", () => {
    // The brief: "Keep the existing icon/color meaning." Pin the
    // (label, iconBg, iconColor) pairings explicitly.
    expect(pmSrc).toMatch(
      /label="Due Now"[\s\S]+?iconBg="bg-orange-100"[\s\S]+?iconColor="text-orange-600"/,
    );
    expect(pmSrc).toMatch(
      /label="This Week"[\s\S]+?iconBg="bg-slate-100"[\s\S]+?iconColor="text-slate-600"/,
    );
    expect(pmSrc).toMatch(
      /label="Overdue"[\s\S]+?iconBg="bg-red-100"[\s\S]+?iconColor="text-red-600"/,
    );
  });

  it("the prior KpiCard 3-grid layout is gone", () => {
    // The old layout: `<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">`
    // wrapping three `<KpiCard>` mounts. Both must be absent.
    expect(pmSrc).not.toMatch(/grid grid-cols-1 sm:grid-cols-3 gap-3/);
    expect(pmSrc).not.toMatch(/<KpiCard\b/);
    // And the function definition itself is removed (no dead code).
    expect(pmSrc).not.toMatch(/function KpiCard\(/);
  });
});

// ── Controls row + heading + table ordering ──────────────────────────

describe("PMWorkspacePage — controls row + heading sit directly above the table", () => {
  it("filter, search, and bulk-generate live in one compact white rounded row", () => {
    expect(pmSrc).toMatch(/data-testid="work-due-controls-row"/);
    // The three controls' canonical testids are preserved (no
    // test-only renames).
    expect(pmSrc).toMatch(/data-testid="work-due-filter"/);
    expect(pmSrc).toMatch(/data-testid="work-due-search"/);
    expect(pmSrc).toMatch(/data-testid="work-due-generate-all"/);
  });

  it("'Plans Due Now (N)' heading sits BETWEEN the controls row and the table", () => {
    // Source order: controls row → heading → table. This is what
    // pulls the table up the viewport.
    expect(pmSrc).toMatch(/data-testid="plans-due-now-heading"/);
    expect(pmSrc).toMatch(
      /data-testid="work-due-controls-row"[\s\S]+?data-testid="plans-due-now-heading"[\s\S]+?<Table/,
    );
  });

  it("the heading still reflects the filtered count (Plans Due Now (N))", () => {
    // Behavior preserved — only the location moved.
    expect(pmSrc).toMatch(
      /data-testid="plans-due-now-heading"[\s\S]+?Plans Due Now[\s\S]+?\(\{\s*filtered\.length\s*\}\)/,
    );
  });
});

// ── Functionality / data contracts intact ───────────────────────────

describe("PMWorkspacePage — backend + endpoints + generation behavior unchanged", () => {
  it("the existing API endpoints are still consumed (no new routes)", () => {
    expect(pmSrc).toMatch(/\/api\/recurring-templates\/upcoming/);
    expect(pmSrc).toMatch(/\/api\/recurring-templates\/generate-selected/);
    expect(pmSrc).toMatch(/\/api\/pm\/templates/);
  });

  it("recurrence-behavior copy is preserved (Recurring job CTA, Make Recurring flow)", () => {
    // The brief: "Do not rename recurrence-related backend/internal
    // concepts." The header's New Plan dropdown still lists
    // "Recurring job" alongside the renamed "Service plan" item.
    expect(pmSrc).toMatch(/<Repeat[^>]*\/>\s*Recurring job/);
  });
});
