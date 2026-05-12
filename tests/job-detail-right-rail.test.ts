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
    // Collapsed strip: 48px (icon-only strip). Open: 380px.
    expect(jobDetailSrc).toMatch(
      /jobRailTab === null \? 48 : 380/,
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

// ── 2. Tab registry — Summary + Notes + Labour only ────────────────

describe("JobDetailPage — jobRailTabs registry", () => {
  it("declares a `jobRailTabs` array typed `DetailRailTab[]`", () => {
    expect(jobDetailSrc).toMatch(
      /const\s+jobRailTabs:\s*DetailRailTab\[\]\s*=\s*\[/,
    );
  });

  it("has exactly THREE tabs (Summary + Notes + Labour) — Equipment moved to Summary card", () => {
    // Count `id: "<key>"` entries inside the jobRailTabs array.
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = jobDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(3);
    expect(arrSlice).toMatch(/id:\s*"summary"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"labour"/);
    expect(arrSlice).not.toMatch(/id:\s*"equipment"/);
    expect(arrSlice).not.toMatch(/id:\s*"files"/);
    expect(arrSlice).not.toMatch(/id:\s*"history"/);
  });

  it("rail tab order is Summary, Notes, Labour (2026-05-12 spec)", () => {
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    const arrSlice = jobDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["summary", "notes", "labour"]);
  });

  it("the default open tab is Summary", () => {
    expect(jobDetailSrc).toMatch(
      /useState<JobRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
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

// ── 2b. Equipment in Summary tab — compact card + add flow ──────────

describe("JobDetailPage Equipment — relocated to Summary tab compact card", () => {
  it("Equipment card renders inside Summary tab content (data-testid job-summary-equipment-card)", () => {
    const summaryTabIdx = jobDetailSrc.indexOf('id: "summary"');
    const notesTabIdx = jobDetailSrc.indexOf('id: "notes"', summaryTabIdx);
    const summarySlice = jobDetailSrc.slice(summaryTabIdx, notesTabIdx);
    expect(summarySlice).toMatch(/data-testid="job-summary-equipment-card"/);
  });

  it("Equipment card in Summary tab mounts <JobEquipmentSection> with externalAddOpen wiring", () => {
    expect(jobDetailSrc).toMatch(
      /job-summary-equipment-card[\s\S]{0,2000}?<JobEquipmentSection[\s\S]{0,800}?externalAddOpen=\{showAddEquipmentDialog\}[\s\S]{0,400}?onExternalAddOpenChange=\{setShowAddEquipmentDialog\}/,
    );
  });

  it("Equipment card pipes onCountChange to setEquipmentCount", () => {
    expect(jobDetailSrc).toMatch(
      /job-summary-equipment-card[\s\S]{0,2000}?onCountChange=\{setEquipmentCount\}/,
    );
  });

  it("Equipment card has a plus button wired to setShowAddEquipmentDialog (data-testid button-add-equipment-summary)", () => {
    expect(jobDetailSrc).toMatch(
      /data-testid="button-add-equipment-summary"/,
    );
    expect(jobDetailSrc).toMatch(
      /button-add-equipment-summary[\s\S]{0,600}?setShowAddEquipmentDialog\(true\)|setShowAddEquipmentDialog\(true\)[\s\S]{0,600}?button-add-equipment-summary/,
    );
  });

  it("Equipment card has compact empty state text (no large illustration)", () => {
    expect(jobDetailSrc).toMatch(/data-testid="job-summary-equipment-empty"/);
    expect(jobDetailSrc).toMatch(/No equipment added yet\./);
    // Compact empty state: a `<p>` element, not a centered Wrench illustration.
    // Slice 200 chars before the testid to capture the opening tag.
    const emptyIdx = jobDetailSrc.indexOf('"job-summary-equipment-empty"');
    expect(emptyIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(emptyIdx - 200, emptyIdx + 300);
    expect(slice).toMatch(/<p\b/);
    expect(slice).not.toMatch(/<Wrench/);
  });

  it("Equipment tab is NOT present in the rail tabs (no id: 'equipment')", () => {
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    const arrSlice = jobDetailSrc.slice(arrStart, arrEnd);
    expect(arrSlice).not.toMatch(/id:\s*"equipment"/);
  });

  it("the legacy equipment-card-wrapper testid is gone", () => {
    expect(jobDetailSrc).not.toMatch(/data-testid="equipment-card-wrapper"/);
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

// ── 3b. Equipment in Summary — suppresses its inner header ────────

describe("JobDetailPage Equipment (Summary card) — no duplicated inner Equipment header", () => {
  it("JobEquipmentSection in Summary card passes hideHeader=true", () => {
    expect(jobDetailSrc).toMatch(
      /job-summary-equipment-card[\s\S]{0,2000}?hideHeader=\{true\}/,
    );
  });

  it("JobEquipmentSection in Summary card uses cardStyle={true}", () => {
    expect(jobDetailSrc).toMatch(
      /job-summary-equipment-card[\s\S]{0,2000}?cardStyle=\{true\}/,
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
    // 2026-05-07: total summary is now a `panelHeader` in the descriptor
    // (rendered by RailPanelRenderer's RailGroupedPanelHeaderRow).
    // The builder carries testId + label + two formatted values.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    // Descriptor property (not HTML attribute — renderer owns the data-testid).
    expect(builderSlice).toMatch(/testId:\s*"labour-summary-totals"/);
    expect(builderSlice).toMatch(/label:\s*"Total"/);
    // The builder param is `buckets`; the call site passes `labourBuckets`.
    expect(builderSlice).toMatch(/formatMinutes\(buckets\.totalMinutes\)/);
    expect(builderSlice).toMatch(/formatCurrency\(buckets\.totalCost\)/);
    // Call site: labourBuckets is the second arg passed to the builder.
    expect(jobDetailSrc).toMatch(
      /buildJobLabourPanelDescriptor\([\s\S]{0,200}?labourBuckets/,
    );
  });

  it("Labour tab's content keeps the per-entry renderer + click-to-edit (tech → date → entries)", () => {
    // After the 2026-05-07 v2 grouping pass, entries are expressed via
    // the descriptor system (testId fields in descriptor objects, not
    // `data-testid=` JSX attributes — the renderer owns those).
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 4000);
    // Grouped panel testId (rendered as data-testid by RailPanelRenderer).
    expect(builderSlice).toMatch(/testId:\s*"labour-entries-list"/);
    // Per-tech group testId in the descriptor.
    expect(builderSlice).toMatch(
      /testId:\s*`labour-tech-group-\$\{group\.technicianId\}`/,
    );
    // Per-(tech, date) card testId in the descriptor.
    expect(builderSlice).toMatch(
      /testId:\s*`labour-date-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
    // Each individual entry sub-row testId in the descriptor.
    expect(builderSlice).toMatch(
      /testId:\s*`labour-entry-\$\{entry\.id\}`/,
    );
    // Click any entry → TimeEntryModal in edit mode.
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
    // 2026-05-07 descriptor migration: per-date totals now in sectionHeader.value
    // and the heading testId in sectionHeader.testId (descriptor property, not HTML attr).
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    expect(builderSlice).toMatch(
      /testId:\s*`labour-date-heading-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
    // Per-date totals: formatMinutes + formatCurrency in the sectionHeader.value.
    expect(builderSlice).toMatch(/formatMinutes\(dateBlock\.totalMinutes\)/);
    expect(builderSlice).toMatch(/formatCurrency\(dateBlock\.totalCost\)/);
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
    // 2026-05-07 descriptor migration: the global total is now panelHeader in the
    // descriptor (testId: "labour-summary-totals", label: "Total", values: [...]).
    // Call site binds the page's `labourBuckets` aggregate to the builder's `buckets` param.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    // testId drives data-testid in the renderer output.
    expect(builderSlice).toMatch(/testId:\s*"labour-summary-totals"/);
    // Both totals via the `buckets` parameter (call site passes `labourBuckets`).
    expect(builderSlice).toMatch(/formatMinutes\(buckets\.totalMinutes\)/);
    expect(builderSlice).toMatch(/formatCurrency\(buckets\.totalCost\)/);
    // Call site: labourBuckets is the aggregate bound to the second param.
    expect(jobDetailSrc).toMatch(
      /buildJobLabourPanelDescriptor\([\s\S]{0,200}?labourBuckets/,
    );
  });

  it("date appears ONCE per (tech, date) card (the date heading), never repeated per entry row", () => {
    // 2026-05-07 descriptor migration: date heading is sectionHeader.testId +
    // sectionHeader.label in the descriptor (not a JSX {dateBlock.dateLabel} expression).
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    expect(builderSlice).toMatch(
      /testId:\s*`labour-date-heading-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
    // Label expressed as a descriptor property, not inline JSX.
    expect(builderSlice).toMatch(/label:\s*dateBlock\.dateLabel/);
    // The legacy "dateLabel · timeRange" prefix repeated on every entry row is gone.
    expect(jobDetailSrc).not.toMatch(
      /\{dateLabel\}\s*\n?\s*<span[^>]*>\s*·\s*<\/span>\s*\n?\s*\{timeRange\}/,
    );
  });

  it("entries on different dates render in SEPARATE date cards (tech grouping does NOT collapse dates)", () => {
    // 2026-05-07 descriptor migration: group.dates.map(...) returns
    // RailCardDescriptor objects with a stable testId. RailPanelRenderer
    // wraps each in the canonical card chrome — no <RailContentCard> JSX in page.
    expect(jobDetailSrc).toMatch(/group\.dates\.map\(/);
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    expect(builderSlice).toMatch(
      /testId:\s*`labour-date-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
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

  it("the legacy standalone Equipment card wrapper is gone (Equipment relocated to the Summary tab compact card)", () => {
    expect(jobDetailSrc).not.toMatch(/data-testid="equipment-card-wrapper"/);
    // <JobEquipmentSection> still mounts — inside the Summary tab's
    // compact equipment card, not as a separate rail tab.
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
  it("Labour panel delegates all card chrome to RailPanelRenderer (no direct RailContentCard import for Labour)", () => {
    // After 2026-05-07 descriptor migration, Labour delegates all card chrome
    // to RailPanelRenderer which internally owns RailContentCard.
    // The page imports RailPanelRenderer, not RailContentCard directly.
    expect(jobDetailSrc).toMatch(
      /import.*RailPanelRenderer.*from.*detail-rail\/RailPanelRenderer/,
    );
    // No direct RailContentCard import in the page (renderer owns it).
    expect(jobDetailSrc).not.toMatch(
      /import\s*\{[^}]*\bRailContentCard\b[^}]*\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("each (tech, date) labour card is expressed via a descriptor testId — RailPanelRenderer wraps in canonical card chrome", () => {
    // 2026-05-07 descriptor migration: date cards are RailCardDescriptor objects
    // with testId: `labour-date-...`. The renderer wraps each in RailContentCard.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    expect(builderSlice).toMatch(
      /testId:\s*`labour-date-\$\{group\.technicianId\}-\$\{dateBlock\.dateSortKey\}`/,
    );
  });

  it("Equipment (now in Summary card) opts into RailContentCard via cardStyle={true} (Notes always uses RailContentCard via EntityNotesPanel)", () => {
    expect(jobDetailSrc).toMatch(/<EntityNotesPanel\b/);
    expect(jobDetailSrc).toMatch(
      /<JobEquipmentSection[\s\S]{0,2400}?cardStyle=\{true\}/,
    );
  });
});

// ── 7. Canonical typography tokens used across all three panels ────

describe("JobDetailPage rail — canonical typography tokens", () => {
  it("Labour entry rows use the spec'd canonical token set (no raw text-xs / text-sm / text-base / text-[Npx])", () => {
    // 2026-05-07 descriptor migration: entry typography fully delegated to
    // RailPanelRenderer. The builder populates typed descriptor fields —
    // entry.typeLabel / leftText / rightText — with no className strings.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(builderStart).toBeGreaterThan(-1);
    // Scope the slice to the builder body only (ends before const jobRailTabs:).
    const builderEnd = jobDetailSrc.indexOf("const jobRailTabs:", builderStart);
    const builderSlice = jobDetailSrc.slice(builderStart, builderEnd);
    // Descriptor entry fields populated correctly.
    expect(builderSlice).toMatch(/entry\.typeLabel/);
    expect(builderSlice).toMatch(/leftText:\s*timeRange/);
    expect(builderSlice).toMatch(/rightText:\s*formatMinutes\(minutes\)/);
    // Inverse pin: no raw text-size classes or inline className in the builder.
    expect(builderSlice).not.toMatch(/className\s*=\s*"/);
    expect(builderSlice).not.toMatch(/\btext-xs\b/);
    expect(builderSlice).not.toMatch(/\btext-sm\b/);
    expect(builderSlice).not.toMatch(/\btext-base\b/);
    expect(builderSlice).not.toMatch(/\btext-\[\d+px\]/);
  });

  it("Labour total summary uses canonical `text-label text-text-muted` + `text-row-emphasis tabular-nums` (2026-05-08 remap, tokens in RailPanelRenderer)", () => {
    // 2026-05-08 typography remap: `text-label uppercase tracking-wide` consolidated
    // to `text-label text-text-muted` (token bakes uppercase + tracking).
    // Values changed from `text-row font-semibold tabular-nums` to
    // `text-row-emphasis tabular-nums text-text-primary`.
    // All class strings live in RailPanelRenderer — verified there, not in builder.
    const rendererSrc = readFileSync(
      resolve(ROOT, "client/src/components/detail-rail/RailPanelRenderer.tsx"),
      "utf-8",
    );
    // Panel header label token (post-remap).
    expect(rendererSrc).toMatch(/text-label\s+text-text-muted/);
    // Panel header value token (post-remap).
    expect(rendererSrc).toMatch(/text-row-emphasis\s+tabular-nums\s+text-text-primary/);
    // Builder scoped to body only: no inline className strings (delegation proof).
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    const builderEnd = jobDetailSrc.indexOf("const jobRailTabs:", builderStart);
    const builderSlice = jobDetailSrc.slice(builderStart, builderEnd);
    expect(builderSlice).not.toMatch(/className\s*=\s*"/);
  });

  it("Labour technician group header uses canonical `text-section-title text-text-primary` (2026-05-08 remap, renderer-owned)", () => {
    // 2026-05-08 remap: `text-section-title font-semibold` → `text-section-title text-text-primary`.
    // After descriptor migration, heading is `heading: group.name` in the descriptor;
    // the renderer owns the class string.
    const rendererSrc = readFileSync(
      resolve(ROOT, "client/src/components/detail-rail/RailPanelRenderer.tsx"),
      "utf-8",
    );
    expect(rendererSrc).toMatch(/text-section-title\s+text-text-primary/);
    // Builder (scoped to body only) carries `heading: group.name` — no inline class string.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    const builderEnd = jobDetailSrc.indexOf("const jobRailTabs:", builderStart);
    const builderSlice = jobDetailSrc.slice(builderStart, builderEnd);
    expect(builderSlice).toMatch(/heading:\s*group\.name/);
    expect(builderSlice).not.toMatch(/className\s*=\s*"/);
  });

  it("Labour date-card heading uses canonical `text-label text-text-muted` + `text-caption tabular-nums text-text-primary` (2026-05-08 remap, renderer-owned)", () => {
    // 2026-05-08 remap: `text-label uppercase tracking-wide` → `text-label text-text-muted`.
    // `text-caption font-medium tabular-nums` → `text-caption tabular-nums text-text-primary`.
    // Tokens live in RailPanelRenderer. Builder expresses the date via
    // sectionHeader.label = dateBlock.dateLabel (no className string).
    const rendererSrc = readFileSync(
      resolve(ROOT, "client/src/components/detail-rail/RailPanelRenderer.tsx"),
      "utf-8",
    );
    // Section header label token (shared renderer path for panel header + section header).
    expect(rendererSrc).toMatch(/text-label\s+text-text-muted/);
    // Section header value token.
    expect(rendererSrc).toMatch(/text-caption\s+tabular-nums\s+text-text-primary/);
    // Builder: label expressed as descriptor property, not inline JSX.
    const builderStart = jobDetailSrc.indexOf("const buildJobLabourPanelDescriptor");
    const builderSlice = jobDetailSrc.slice(builderStart, builderStart + 5000);
    expect(builderSlice).toMatch(/label:\s*dateBlock\.dateLabel/);
  });

  it("the entire Labour rail body has NO raw text-size classes (text-sm / text-xs / text-base / text-[Npx])", () => {
    // Slice the entire Labour panel content slot — start at the
    // labour summary totals testid (top of the panel body) and end
    // at the closing of the jobRailTabs array.
    const startIdx = jobDetailSrc.indexOf('data-testid="card-labour-summary"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = jobDetailSrc.indexOf("];", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const labourBodySlice = jobDetailSrc.slice(startIdx, endIdx);
    expect(labourBodySlice).not.toMatch(/\btext-xs\b/);
    expect(labourBodySlice).not.toMatch(/\btext-sm\b/);
    expect(labourBodySlice).not.toMatch(/\btext-base\b/);
    expect(labourBodySlice).not.toMatch(/\btext-\[\d+px\]/);
  });
});
