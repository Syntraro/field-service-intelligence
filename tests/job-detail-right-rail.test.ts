/**
 * Job Detail right rail — source pin tests (2026-05-07).
 *
 * Verifies the JobDetailPage right column uses the canonical
 * `<DetailRightRail>` primitive instead of the prior stacked Notes +
 * Labour cards. The canonical primitive is shared with
 * ClientDetailPage and (in upcoming work) InvoiceDetailPage /
 * QuoteDetailPage.
 *
 * What stays the same:
 *   - Equipment card above the rail (preserved as a standalone card —
 *     its conditionally-hidden behavior + page-header `+` wiring don't
 *     fit the rail tab pattern today).
 *   - EntityNotesSection mounted in the Notes tab body (its internal
 *     "+ Add Note" button + dialog wiring — Notes logic untouched).
 *   - Labour body content (per-(tech, day) grouped renderer + empty
 *     state copy + click-to-edit-via-TimeEntryModal) — preserved
 *     verbatim.
 *
 * These pins fail if a future refactor:
 *   - re-introduces the legacy `<CardShell data-testid="card-labour-summary">`
 *     + `<div data-testid="card-notes">` stacked cards
 *   - drops the canonical `<DetailRightRail>` mount
 *   - adds a third "Equipment" rail tab without explicit spec change
 *   - couples the rail page wiring to ClientDetailPage's testid prefix
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const codeOnly = stripComments(jobDetailSrc);

// ── 1. Page imports + mounts the canonical primitive ───────────────

describe("JobDetailPage — canonical right rail", () => {
  it("imports the DetailRightRail primitive + DetailRailTab type from the canonical module", () => {
    expect(jobDetailSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("mounts <DetailRightRail tabs={jobRailTabs} ...> with the 'job-side' testid prefix", () => {
    expect(jobDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?tabs=\{jobRailTabs\}[\s\S]{0,400}?testIdPrefix="job-side"/,
    );
  });

  it("carries the aria-label='Job information rail'", () => {
    expect(jobDetailSrc).toMatch(/ariaLabel="Job information rail"/);
  });

  it("the rail mount lives inside the page-level `data-testid=\"job-detail-rail-column\"` aside (not the body grid)", () => {
    // 2026-05-07 layout v4: the rail moved out of the body grid's
    // 35% right column into a page-level <aside> sibling so the
    // collapsed strip pins to the FAR RIGHT edge of the page (mirrors
    // ClientDetailPage). The aside testid `job-detail-rail-column`
    // anchors the new structure.
    const idx = jobDetailSrc.indexOf('data-testid="job-detail-rail-column"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 4000);
    expect(slice).toMatch(/<DetailRightRail/);
    // Pin against regression: the body-grid right column must NOT
    // contain a rail mount any more (the prior bug).
    expect(jobDetailSrc).not.toMatch(/data-testid="job-detail-right-column"/);
  });

  it("the rail aside is a page-level sibling of the left-column shell (mirrors ClientDetailPage)", () => {
    // The outer page wrapper is now `flex flex-col lg:flex-row` so
    // the aside can be a sibling pinned to the right edge.
    expect(jobDetailSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-app-bg"\s+data-testid="job-detail-page"/,
    );
    expect(jobDetailSrc).toMatch(/data-testid="job-detail-left-column-shell"/);
    // The aside has the canonical width-via-CSS-variable contract.
    expect(jobDetailSrc).toMatch(
      /jobRailTab === null \? 80 : 380/,
    );
    expect(jobDetailSrc).toMatch(
      /data-panel-open=\{jobRailTab === null \? "false" : "true"\}/,
    );
  });

  it("the page declares page-local `jobRailTab` state for active-tab tracking", () => {
    expect(jobDetailSrc).toMatch(
      /const\s*\[\s*jobRailTab\s*,\s*setJobRailTab\s*\]\s*=\s*useState/,
    );
  });
});

// ── 2. Tab registry — Equipment + Notes + Labour (per spec) ────────

describe("JobDetailPage — jobRailTabs registry", () => {
  it("declares a `jobRailTabs` array typed `DetailRailTab[]`", () => {
    expect(jobDetailSrc).toMatch(
      /const\s+jobRailTabs:\s*DetailRailTab\[\]\s*=\s*\[/,
    );
  });

  it("has exactly FOUR tabs (Summary + Notes + Labour + Equipment) — no Files / History", () => {
    // Count `id: "<key>"` entries inside the jobRailTabs array.
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = jobDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(4);
    expect(arrSlice).toMatch(/id:\s*"summary"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"labour"/);
    expect(arrSlice).toMatch(/id:\s*"equipment"/);
    expect(arrSlice).not.toMatch(/id:\s*"files"/);
    expect(arrSlice).not.toMatch(/id:\s*"history"/);
  });

  it("rail tab order is Summary, Notes, Labour, Equipment (2026-05-09 spec)", () => {
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    const arrSlice = jobDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["summary", "notes", "labour", "equipment"]);
  });

  it("the default open tab is Summary (2026-05-09)", () => {
    expect(jobDetailSrc).toMatch(
      /useState<JobRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
    );
  });

  it("Equipment tab carries `label: \"Equipment\"` + Wrench icon + stable testId", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,400}?label:\s*"Equipment"[\s\S]{0,400}?icon:\s*Wrench[\s\S]{0,400}?testId:\s*"job-rail-tab-equipment"/,
    );
  });

  it("Notes tab carries `label: \"Notes\"` + StickyNote icon + stable testId", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,400}?label:\s*"Notes"[\s\S]{0,400}?icon:\s*StickyNote[\s\S]{0,400}?testId:\s*"job-rail-tab-notes"/,
    );
  });

  it("Labour tab carries `label: \"Labour\"` + Clock icon + stable testId", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"labour"[\s\S]{0,400}?label:\s*"Labour"[\s\S]{0,400}?icon:\s*Clock[\s\S]{0,400}?testId:\s*"job-rail-tab-labour"/,
    );
  });
});

// ── 2b. Equipment tab — always present + AddEquipmentDialog wiring ─

describe("JobDetailPage Equipment tab — always present + canonical add flow", () => {
  it("Equipment tab's content slot mounts <JobEquipmentSection> with the existing externalAddOpen wiring", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?<JobEquipmentSection[\s\S]{0,800}?externalAddOpen=\{showAddEquipmentDialog\}[\s\S]{0,400}?onExternalAddOpenChange=\{setShowAddEquipmentDialog\}/,
    );
  });

  it("Equipment tab pipes onCountChange through to setEquipmentCount (count rendered as the rail badge)", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?onCountChange=\{setEquipmentCount\}/,
    );
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?count:\s*equipmentCount/,
    );
  });

  it("Equipment tab's `action` slot is the terse `+ Add` button", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?action:\s*\([\s\S]{0,800}?data-testid="button-add-equipment-rail"/,
    );
    // Wires to the same setShowAddEquipmentDialog state the canonical
    // AddEquipmentDialog (mounted at the page level) listens to.
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?onClick=\{\(\)\s*=>\s*setShowAddEquipmentDialog\(true\)\}/,
    );
  });

  it("the Equipment tab is NOT conditionally hidden when count is zero (always present)", () => {
    // The legacy `equipment-card-wrapper` div toggled `hidden` when
    // count was 0. The rail tab must always be visible so the user
    // can always reach the `+ Add Equipment` action even on empty
    // jobs. Pin against the legacy wrapper testid.
    expect(jobDetailSrc).not.toMatch(/data-testid="equipment-card-wrapper"/);
    expect(jobDetailSrc).not.toMatch(
      /equipmentCount === 0\s*\?\s*"hidden"/,
    );
  });
});

// ── 2c. Rail panel header actions — terse labels per spec ─────────

describe("JobDetailPage rail — terse panel-header action labels", () => {
  it("Notes tab action label is `+ Add` (not `+ Add Note`)", () => {
    // The button JSX renders `<Plus /> Add` after the testid attr.
    // Slice forward from the testid to capture the body.
    const idx = jobDetailSrc.indexOf('data-testid="button-add-note-rail"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 400);
    expect(slice).toMatch(/<Plus[\s\S]{0,100}?\/>\s*Add\s*</);
    expect(slice).not.toMatch(/Add\s+Note/);
  });

  it("Labour tab action label is `+ Time` (not `+ Time Entry`)", () => {
    const idx = jobDetailSrc.indexOf('data-testid="button-add-labour"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 400);
    expect(slice).toMatch(/<Plus[\s\S]{0,100}?\/>\s*Time\s*</);
    expect(slice).not.toMatch(/Time\s+Entry/);
  });

  it("Equipment tab action label is `+ Add` (not `+ Add Equipment`)", () => {
    const idx = jobDetailSrc.indexOf('data-testid="button-add-equipment-rail"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 400);
    expect(slice).toMatch(/<Plus[\s\S]{0,100}?\/>\s*Add\s*</);
    expect(slice).not.toMatch(/Add\s+Equipment/);
  });
});

// ── 3. Notes tab — suppress duplicated inner Notes header ──────────

describe("JobDetailPage Notes tab — canonical EntityNotesPanel mount", () => {
  // 2026-05-08 Tier 4 Notes canonicalization. The rail Notes tab now
  // mounts `<EntityNotesPanel entityType="job" entityId={job.id}>`. The
  // legacy `embedded`, `hideHeader`, `hideAddButton`, and `cardStyle`
  // prop pins are retired — EntityNotesPanel never renders its own
  // header (the rail tab descriptor owns title + count + action) and
  // always renders rows via `<RailContentCard>` (the prior `cardStyle`
  // opt-in is now the single render path).

  it("Notes tab's content slot mounts <EntityNotesPanel entityType=\"job\" entityId={job.id}>", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,3000}?<EntityNotesPanel[\s\S]{0,400}?entityType="job"[\s\S]{0,400}?entityId=\{job\.id\}/,
    );
  });

  it("Notes tab feeds `notesAddSignal` into EntityNotesPanel's `openAddNoteSignal` controlled prop", () => {
    expect(jobDetailSrc).toMatch(/setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,3000}?openAddNoteSignal=\{notesAddSignal\}/,
    );
  });

  it("Notes tab pipes onCountChange through to setNotesCount (count rendered as the rail badge)", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,3000}?onCountChange=\{setNotesCount\}/,
    );
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,3000}?count:\s*notesCount/,
    );
  });

  it("Notes tab carries the canonical +Add action button (button-add-note-rail testId)", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,3000}?action:\s*\([\s\S]{0,800}?data-testid="button-add-note-rail"/,
    );
  });

  it("the Notes wrapper still carries `data-testid=\"card-notes\"` for downstream selectors", () => {
    expect(jobDetailSrc).toMatch(/data-testid="card-notes"/);
  });

  it("does NOT pass any retired chrome props (embedded / hideHeader / hideAddButton / cardStyle) to EntityNotesPanel", () => {
    // Inverse pin — these props belonged to EntityNotesSection. Anchor
    // ONLY on the JSX self-closing block so surrounding migration
    // comments (which legitimately reference the prior prop names)
    // don't trip the inverse match.
    const notesJsx = jobDetailSrc.match(/<EntityNotesPanel\b[\s\S]+?\/>/);
    expect(notesJsx, "Notes tab must contain a self-closing <EntityNotesPanel ... /> JSX").not.toBeNull();
    expect(notesJsx![0]).not.toMatch(/\bembedded\b/);
    expect(notesJsx![0]).not.toMatch(/\bhideHeader\b/);
    expect(notesJsx![0]).not.toMatch(/\bhideAddButton\b/);
    expect(notesJsx![0]).not.toMatch(/\bcardStyle\b/);
  });
});

// ── 3b. Equipment tab — suppress duplicated inner Equipment header ──

describe("JobDetailPage Equipment tab — no duplicated inner Equipment header", () => {
  it("Equipment tab passes `hideHeader=true` to JobEquipmentSection", () => {
    // The rail panel header provides the title + action; the section's
    // own Collapsible trigger header (icon + "Equipment" + chevron +
    // add) would visually duplicate it.
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?hideHeader=\{true\}/,
    );
  });

  it("Equipment tab opts into the canonical rail card styling via `cardStyle={true}`", () => {
    // Each equipment row now renders inside `<RailContentCard>` with
    // canonical typography tokens — visually matches the Notes +
    // Labour rail cards.
    expect(jobDetailSrc).toMatch(
      /id:\s*"equipment"[\s\S]{0,3000}?cardStyle=\{true\}/,
    );
  });
});

// ── 4. Labour tab — preserves + Time, totals, per-tech grouping ────

describe("JobDetailPage Labour tab — preserves content + Time action", () => {
  it("Labour tab's `action` slot is the `+ Time` button (button-add-labour testid)", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"labour"[\s\S]{0,4000}?action:\s*\([\s\S]{0,800}?data-testid="button-add-labour"/,
    );
  });

  it("the + Time action opens the canonical TimeEntryModal in create mode", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"labour"[\s\S]{0,4000}?setTimeEntryModal\(\{\s*open:\s*true,\s*mode:\s*"create",\s*entry:\s*null\s*\}\)/,
    );
  });

  it("the + Time button is disabled when the job is not open / not active (server-guard mirror)", () => {
    expect(jobDetailSrc).toMatch(
      /const\s+canAddTimeEntry\s*=\s*job\.status\s*===\s*"open"\s*&&\s*job\.isActive\s*!==\s*false/,
    );
    expect(jobDetailSrc).toMatch(
      /id:\s*"labour"[\s\S]{0,4000}?disabled=\{!canAddTimeEntry\}/,
    );
  });

  it("Labour tab's content preserves the empty-state copy", () => {
    expect(jobDetailSrc).toMatch(/title="No time logged yet\."/);
    expect(jobDetailSrc).toMatch(
      /Track time against this job to roll travel and on-site hours into the labour total\./,
    );
  });

  it("Labour panel renders a TOTAL summary at the top (total hours + total amount)", () => {
    // 2026-05-07: total summary moved above the per-entry list, with
    // a Total label + total minutes + total cost. Pin the testid +
    // bindings.
    expect(jobDetailSrc).toMatch(/data-testid="labour-summary-totals"/);
    const totalsIdx = jobDetailSrc.indexOf('data-testid="labour-summary-totals"');
    expect(totalsIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(Math.max(0, totalsIdx - 600), totalsIdx + 800);
    expect(slice).toMatch(/Total/);
    expect(slice).toMatch(/formatMinutes\(labourBuckets\.totalMinutes\)/);
    expect(slice).toMatch(/formatCurrency\(labourBuckets\.totalCost\)/);
  });

  it("Labour tab's content keeps the per-entry renderer + click-to-edit (tech → date → entries)", () => {
    // The `labour-entries-list` testid wraps the renderer. After the
    // 2026-05-07 v2 grouping pass, entries are nested:
    //   tech group → date card → individual entries (still listed,
    //   never merged).
    expect(jobDetailSrc).toMatch(/data-testid="labour-entries-list"/);
    // Per-tech wrapper.
    expect(jobDetailSrc).toMatch(
      /data-testid=\{`labour-tech-group-\$\{group\.technicianId\}`\}/,
    );
    // Per-(tech, date) card wrapper — one per calendar date.
    expect(jobDetailSrc).toMatch(
      /testId=\{`labour-date-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`\}/,
    );
    // Each individual entry inside a date card has its own clickable
    // testid + click handler (the entry button is rendered directly
    // inside the date card, not wrapped in another RailContentCard).
    expect(jobDetailSrc).toMatch(
      /data-testid=\{`labour-entry-\$\{entry\.id\}`\}/,
    );
    // Click any entry → TimeEntryModal in edit mode keyed on that
    // specific entry.
    expect(jobDetailSrc).toMatch(
      /setTimeEntryModal\(\{\s*open:\s*true,\s*mode:\s*"edit",\s*entry,?\s*\}\)/,
    );
  });

  it("Labour body groups by TECHNICIAN, then by CALENDAR DATE — entries listed individually inside each date card", () => {
    // Pin the new shape: top-level `LabourTechGroup` with a `dates`
    // array, and `LabourDateGroup` with an `entries` array.
    expect(jobDetailSrc).toMatch(/type\s+LabourTechGroup\s*=\s*\{/);
    expect(jobDetailSrc).toMatch(/type\s+LabourDateGroup\s*=\s*\{/);
    expect(jobDetailSrc).toMatch(
      /labourTechGroups:\s*LabourTechGroup\[\]/,
    );
    expect(jobDetailSrc).toMatch(
      /dates:\s*LabourDateGroup\[\];/,
    );
    expect(jobDetailSrc).toMatch(
      /entries:\s*LabourEntryDisplay\[\];/,
    );
    // The legacy single-level (tech-only) shape is gone.
    expect(jobDetailSrc).not.toMatch(/\blabourByTechDay\b/);
  });

  it("each (tech, date) card heading shows per-date totals (duration + cost) on the right", () => {
    // 2026-05-07 date-card visibility pass: the date-heading row now
    // renders the per-(tech, date) totals next to the date label.
    // The totals span carries a stable testid for layout regression
    // pins.
    expect(jobDetailSrc).toMatch(
      /data-testid=\{`labour-date-totals-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`\}/,
    );
    // Bindings: per-date `totalMinutes` + `totalCost` formatted via
    // the existing `formatMinutes` / `formatCurrency` helpers.
    expect(jobDetailSrc).toMatch(/formatMinutes\(dateBlock\.totalMinutes\)/);
    expect(jobDetailSrc).toMatch(/formatCurrency\(dateBlock\.totalCost\)/);
  });

  it("`LabourDateGroup` carries `totalMinutes` + `totalCost` accumulators per (tech, date)", () => {
    // Pin the type extension so a future refactor can't drop the
    // accumulators silently.
    expect(jobDetailSrc).toMatch(/totalMinutes:\s*number;/);
    expect(jobDetailSrc).toMatch(/totalCost:\s*number;/);
    // The grouping loop accumulates into both fields as entries are
    // pushed — same `entryCostDollars` helper the global summary
    // uses, so per-date and global totals agree.
    expect(jobDetailSrc).toMatch(/dateGroup\.totalMinutes\s*\+=/);
    expect(jobDetailSrc).toMatch(/dateGroup\.totalCost\s*\+=\s*entryCostDollars\(e\)/);
  });

  it("the GLOBAL Total summary at the top of the panel remains intact (cross-tech, cross-date)", () => {
    // The panel still shows the unchanged top-of-panel total summary
    // bound to `labourBuckets.totalMinutes` / `.totalCost`. This is
    // the all-techs all-dates aggregate; the new per-date totals are
    // additive and per-card, not replacing the global row.
    expect(jobDetailSrc).toMatch(/data-testid="labour-summary-totals"/);
    const globalIdx = jobDetailSrc.indexOf('data-testid="labour-summary-totals"');
    expect(globalIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(globalIdx, globalIdx + 1200);
    expect(slice).toMatch(/formatMinutes\(labourBuckets\.totalMinutes\)/);
    expect(slice).toMatch(/formatCurrency\(labourBuckets\.totalCost\)/);
  });

  it("date appears ONCE per (tech, date) card (the date heading), never repeated per entry row", () => {
    // The old prefix `<dateLabel> · <timeRange>` on every entry row
    // is gone. Pin the date heading inside the date card + the
    // ABSENCE of a per-entry date prefix anywhere in the entry-row
    // markup.
    expect(jobDetailSrc).toMatch(
      /data-testid=\{`labour-date-heading-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`\}/,
    );
    expect(jobDetailSrc).toMatch(
      /\{dateBlock\.dateLabel\}/,
    );
    // The legacy "dateLabel · timeRange" prefix that repeated the
    // date on every entry must not exist anymore.
    expect(jobDetailSrc).not.toMatch(
      /\{dateLabel\}\s*\n?\s*<span[^>]*>\s*·\s*<\/span>\s*\n?\s*\{timeRange\}/,
    );
  });

  it("entries on different dates render in SEPARATE date cards (tech grouping does NOT collapse dates)", () => {
    // The dates array is built per-tech and rendered with a
    // `group.dates.map(...)` that wraps each date in its own
    // `<RailContentCard>`. Pin both.
    expect(jobDetailSrc).toMatch(/group\.dates\.map\(/);
    expect(jobDetailSrc).toMatch(
      /<RailContentCard[\s\S]{0,400}?testId=\{`labour-date-/,
    );
  });

  it("entries inside a date card are NOT merged into a combined first-start / last-end range", () => {
    // The legacy bug rendered ONE row per (tech, day) with a span
    // computed from `firstEntry.startAt`–`lastEntry.endAt`. Pin the
    // absence of those expressions.
    expect(jobDetailSrc).not.toMatch(/firstEntry\?\.startAt/);
    expect(jobDetailSrc).not.toMatch(/lastEntry\?\.endAt/);
    // Each entry computes its OWN start/end labels from the
    // individual entry, not a block-level first/last.
    expect(jobDetailSrc).toMatch(/format\(start,\s*"h:mm a"\)/);
    expect(jobDetailSrc).toMatch(/format\(end,\s*"h:mm a"\)/);
  });

  it("Labour body does NOT collapse Travel + On-site into shared buckets with merged spans", () => {
    // Pin against the legacy bucket testids and the merged time-span
    // expression `firstEntry.startAt`–`lastEntry.endAt`.
    expect(jobDetailSrc).not.toMatch(/data-testid=\{`labour-bucket-travel-/);
    expect(jobDetailSrc).not.toMatch(/data-testid=\{`labour-bucket-onsite-/);
    expect(jobDetailSrc).not.toMatch(/firstEntry\?\.startAt/);
    expect(jobDetailSrc).not.toMatch(/lastEntry\?\.endAt/);
    // The "· N entries" suffix that masked individual entries is gone.
    expect(jobDetailSrc).not.toMatch(/·\s*\$\{[^}]+\}\s+entries/);
  });

  it("each individual labour entry shows its own start/end time, type, duration, and amount", () => {
    // Per-entry rendering uses `format(start, "h:mm a")` /
    // `format(end, "h:mm a")` and `formatMinutes(minutes)` /
    // `formatCurrency(cost)`. Pin the structural source markers.
    expect(jobDetailSrc).toMatch(/format\(start,\s*"h:mm a"\)/);
    expect(jobDetailSrc).toMatch(/format\(end,\s*"h:mm a"\)/);
    expect(jobDetailSrc).toMatch(/`\$\{startLabel\}–\$\{endLabel\}`/);
    expect(jobDetailSrc).toMatch(/entry\.typeLabel/);
    expect(jobDetailSrc).toMatch(/formatMinutes\(minutes\)/);
    expect(jobDetailSrc).toMatch(/formatCurrency\(cost\)/);
  });

  it("Labour tab pipes the entry count into the rail badge", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"labour"[\s\S]{0,4000}?count:\s*jobTimeEntries\.length\s*\|\|\s*undefined/,
    );
  });
});

// ── 4b. Collapsed-state — JobDetailPage uses nullable rail state ────

describe("JobDetailPage — closed-rail behavior delegates to the canonical primitive", () => {
  it("`jobRailTab` state is typed nullable (`JobRailTab | null`) — the closed marker", () => {
    expect(jobDetailSrc).toMatch(
      /useState<JobRailTab\s*\|\s*null>\(/,
    );
  });

  it("the rail mount feeds `jobRailTab` (not a non-null fallback) to `activeTabId`", () => {
    // Forwarding the page's nullable state directly is what lets the
    // primitive collapse to icon-only. Casting to a non-null default
    // would defeat the close behavior.
    expect(jobDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?activeTabId=\{jobRailTab\}/,
    );
  });

  it("`onActiveTabChange` accepts null + writes the page state directly (no clamping)", () => {
    expect(jobDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,800}?onActiveTabChange=\{\(id\)\s*=>\s*setJobRailTab\(id\s+as\s+JobRailTab\s*\|\s*null\)\}/,
    );
  });

  it("the page does NOT render its own panel-area placeholder when the rail is closed", () => {
    // The closed-state visual (icon-only) must be owned by the
    // canonical primitive — no per-page hack that re-renders an
    // empty card / placeholder div / "select a tab" stub.
    // Anchored at the page-level rail aside; mobile + desktop variants
    // each mount one canonical primitive (= 2 mounts total inside
    // the aside).
    const idx = jobDetailSrc.indexOf('data-testid="job-detail-rail-column"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 3000);
    const railMounts = slice.match(/<DetailRightRail\b/g) ?? [];
    expect(railMounts.length).toBe(2);
    // No inline fallback expression renders panel-area JSX outside
    // the canonical primitive.
    expect(slice).not.toMatch(/jobRailTab\s*===\s*null\s*\?\s*</);
    expect(slice).not.toMatch(/!jobRailTab\s*&&\s*</);
  });
});

// ── 5. Legacy stacked cards are gone ───────────────────────────────

describe("JobDetailPage — legacy stacked Notes + Labour cards removed", () => {
  it("no legacy `<CardShell data-testid=\"card-labour-summary\">` chrome remains", () => {
    // The card-labour-summary testid still appears INSIDE the Labour
    // tab body, but only as `<div data-testid="card-labour-summary">`
    // — never wrapped by `<CardShell ...>`.
    expect(codeOnly).not.toMatch(
      /<CardShell\s+data-testid="card-labour-summary"/,
    );
  });

  it("no legacy `<div ...>{<EntityNotesSection .../>}</div>` border-md card-notes wrapper remains", () => {
    // The prior wrapper was
    //   <div className="overflow-hidden rounded-md border border-border-default bg-white" data-testid="card-notes">
    //     <EntityNotesSection ... />
    //   </div>
    // Pin against the exact className string so the regression is
    // unambiguous if a future refactor reintroduces it.
    expect(codeOnly).not.toMatch(
      /<div\s+className="overflow-hidden rounded-md border border-border-default bg-white"\s+data-testid="card-notes"/,
    );
    // 2026-05-08 Tier 4 Notes canonicalization — the EntityNotesSection
    // primitive itself is retired; Notes flow through EntityNotesPanel.
    // Use `codeOnly` (comment-stripped) so legitimate migration prose
    // referencing the prior name doesn't trip the inverse match.
    expect(codeOnly).not.toMatch(/<EntityNotesSection\b/);
  });

  it("the legacy `data-testid=\"trigger-labour\"` header strip is gone (subsumed by the rail panel header + summary line)", () => {
    expect(codeOnly).not.toMatch(/data-testid="trigger-labour"/);
  });

  it("the legacy standalone Equipment card wrapper is gone (Equipment moved into the rail Equipment tab)", () => {
    // The 2026-05-07 layout-v4 change moves Equipment from a separate
    // card above the rail into the canonical rail's Equipment tab
    // (always present, with the AddEquipmentDialog wired through the
    // tab's `action:` slot). Pin against the legacy wrapper testid.
    expect(jobDetailSrc).not.toMatch(/data-testid="equipment-card-wrapper"/);
    // <JobEquipmentSection> still mounts — but inside the Equipment
    // tab's content slot, not as a sibling card.
    expect(jobDetailSrc).toMatch(/<JobEquipmentSection/);
  });

  it("the legacy 35%/65% body grid right column is gone (rail moved out of the body grid)", () => {
    // Pin against the legacy `job-detail-right-column` wrapper that
    // hosted the Equipment card + rail mount. Both moved out: the
    // rail to a page-level <aside>, Equipment into the rail.
    expect(jobDetailSrc).not.toMatch(/data-testid="job-detail-right-column"/);
    expect(jobDetailSrc).not.toMatch(
      /lg:grid-cols-\[minmax\(0,65%\)_minmax\(0,35%\)\]/,
    );
  });
});

// ── 6. Canonical card styling — shared across all three rail panels ─

describe("JobDetailPage rail — Notes / Labour / Equipment share the canonical RailContentCard", () => {
  it("imports the canonical `<RailContentCard>` primitive", () => {
    expect(jobDetailSrc).toMatch(
      /import\s*\{[^}]*\bRailContentCard\b[^}]*\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("each (tech, date) labour card is wrapped in `<RailContentCard>` (canonical card chrome)", () => {
    // The OUTER (tech, date) card is the `<RailContentCard>` —
    // entries inside that card are bare clickable buttons (a
    // `<button>` nested inside another `<button>` would be invalid
    // HTML). Pin the canonical card wraps the date.
    expect(jobDetailSrc).toMatch(
      /<RailContentCard[\s\S]{0,400}?testId=\{`labour-date-/,
    );
  });

  it("Equipment opts into RailContentCard via `cardStyle={true}` (Notes always uses RailContentCard via EntityNotesPanel)", () => {
    // 2026-05-08 Tier 4 Notes canonicalization: the prior
    // `cardStyle={true}` opt-in on EntityNotesSection collapsed into
    // the single render path of EntityNotesPanel — every notes row now
    // uses `<RailContentCard>` unconditionally. Equipment's parallel
    // opt-in is preserved (its migration is a separate phase).
    expect(jobDetailSrc).toMatch(/<EntityNotesPanel\b/);
    expect(jobDetailSrc).toMatch(
      /<JobEquipmentSection[\s\S]{0,2400}?cardStyle=\{true\}/,
    );
  });
});

// ── 7. Canonical typography tokens used across all three panels ────

describe("JobDetailPage rail — canonical typography tokens", () => {
  it("Labour entry rows use the spec'd canonical token set (no raw text-xs / text-sm / text-base / text-[Npx])", () => {
    // 2026-05-07 typography normalization. Per-element spec:
    //   - Entry type    → text-row font-semibold
    //   - Entry amount  → text-row font-semibold tabular-nums
    //   - Entry time    → text-caption tabular-nums text-muted-foreground
    //   - Entry duration → same as time
    const labourIdx = jobDetailSrc.indexOf("dateBlock.entries.map");
    expect(labourIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(labourIdx, labourIdx + 6000);
    // Type label: text-row + font-semibold.
    expect(slice).toMatch(
      /text-row\s+font-semibold\s+text-text-primary[\s\S]{0,400}?entry\.typeLabel/,
    );
    // Amount: text-row + font-semibold + tabular-nums.
    expect(slice).toMatch(/text-row\s+font-semibold\s+tabular-nums/);
    // Time range + duration: text-caption + tabular-nums + text-muted-foreground.
    expect(slice).toMatch(
      /text-caption\s+tabular-nums\s+text-muted-foreground[\s\S]{0,300}?\{timeRange\}/,
    );
    expect(slice).toMatch(
      /text-caption\s+tabular-nums\s+text-muted-foreground[\s\S]{0,300}?formatMinutes\(minutes\)/,
    );
    // Inverse pin: no raw text-size classes inside the entry slice.
    expect(slice).not.toMatch(/\btext-xs\b/);
    expect(slice).not.toMatch(/\btext-sm\b/);
    expect(slice).not.toMatch(/\btext-base\b/);
    expect(slice).not.toMatch(/\btext-\[\d+px\]/);
  });

  it("Labour total summary uses canonical `text-label uppercase tracking-wide` + `text-row font-semibold tabular-nums`", () => {
    const totalsIdx = jobDetailSrc.indexOf('data-testid="labour-summary-totals"');
    expect(totalsIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(totalsIdx, totalsIdx + 1200);
    // Label: text-label uppercase tracking-wide.
    expect(slice).toMatch(/text-label\s+uppercase\s+tracking-wide/);
    // Both totals values: text-row font-semibold tabular-nums.
    const valueMatches = slice.match(
      /text-row\s+font-semibold\s+tabular-nums\s+text-text-primary/g,
    ) ?? [];
    expect(valueMatches.length).toBeGreaterThanOrEqual(2);
    // Inverse pin: no raw text-size classes in the total summary slice.
    expect(slice).not.toMatch(/\btext-xs\b/);
    expect(slice).not.toMatch(/\btext-sm\b/);
    expect(slice).not.toMatch(/\btext-base\b/);
    expect(slice).not.toMatch(/\btext-\[\d+px\]/);
  });

  it("Labour technician group header uses canonical `text-section-title font-semibold`", () => {
    // Bumped from `text-row-emphasis` (15px / 500) to
    // `text-section-title` (18px / 600) per the typography
    // normalization spec — technician name reads as a clear h2-level
    // grouping above the date-card heading.
    expect(jobDetailSrc).toMatch(
      /text-section-title\s+font-semibold\s+text-text-primary[\s\S]{0,400}?\{group\.name\}/,
    );
    // Inverse pin: the prior emphasis token is gone from the tech
    // group header markup.
    expect(jobDetailSrc).not.toMatch(
      /text-row-emphasis[\s\S]{0,400}?\{group\.name\}/,
    );
  });

  it("Labour date-card heading uses canonical `text-label uppercase tracking-wide` + `text-caption font-medium tabular-nums`", () => {
    // The date-card heading switched to the spec'd canonical token
    // set. Date label: text-label uppercase tracking-wide. Date
    // totals: text-caption font-medium tabular-nums.
    expect(jobDetailSrc).toMatch(
      /text-label\s+uppercase\s+tracking-wide[\s\S]{0,400}?\{dateBlock\.dateLabel\}/,
    );
    expect(jobDetailSrc).toMatch(
      /text-caption\s+font-medium\s+tabular-nums[\s\S]{0,400}?formatMinutes\(dateBlock\.totalMinutes\)/,
    );
  });

  it("the entire Labour rail body has NO raw text-size classes (text-sm / text-xs / text-base / text-[Npx])", () => {
    // Slice the entire Labour panel content slot — start at the
    // labour summary totals testid (top of the panel body) and end
    // at the Equipment tab declaration to scope to Labour only.
    const startIdx = jobDetailSrc.indexOf('data-testid="card-labour-summary"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = jobDetailSrc.indexOf('id: "equipment"', startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const labourBodySlice = jobDetailSrc.slice(startIdx, endIdx);
    expect(labourBodySlice).not.toMatch(/\btext-xs\b/);
    expect(labourBodySlice).not.toMatch(/\btext-sm\b/);
    expect(labourBodySlice).not.toMatch(/\btext-base\b/);
    expect(labourBodySlice).not.toMatch(/\btext-\[\d+px\]/);
  });
});
