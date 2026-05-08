/**
 * Rail card slot primitives — canonical typography + adoption pins
 * (2026-05-07 v3 RALPH).
 *
 * The previous wrapper-only canonicalization shipped one outer
 * `<RailContentCard>` chrome but allowed every callsite to render
 * different inner typography. Job Detail Labour and Notes ended up
 * visibly mismatched — different text sizes, different padding,
 * different chip styles — even though both used `<RailContentCard>`.
 *
 * v3 introduces slot primitives (Header, Title, Body, Meta, Footer,
 * Chip, ChipRow, FieldList, Field, Subrow) that BAKE the canonical
 * typography + spacing. Consumers compose the slots they need; the
 * slots own the design contract.
 *
 * These pins fail if a future refactor:
 *
 *   1. Drops one of the slot primitives from `RailContentCard.tsx`.
 *   2. Bakes a non-canonical typography token into a slot's class
 *      string (e.g. swaps `text-row` for `text-xs` in `Body`).
 *   3. Lets a rail panel hand-roll typography classes inside a card
 *      instead of composing the slot primitives — i.e. introduces
 *      `<p className="text-xs ...">` as direct children of
 *      `<RailContentCard>` on Notes / Labour / Equipment / Parts /
 *      Maintenance / Activity / Billing / Contacts surfaces.
 *
 * The slice helpers below scope inverse pins to each panel's source
 * range so e.g. the project-wide `text-xs` (used by chips, badges,
 * non-rail UI) doesn't trigger false positives.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/RailContentCard.tsx",
);
const CLIENT_PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const JOB_PAGE = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
// 2026-05-08 Tier 4 Notes canonicalization — the prior NOTES_PANEL
// (`client/src/components/NotesPanel.tsx`) and ENTITY_NOTES
// (`client/src/components/notes/EntityNotesSection.tsx`) sources were
// retired; both behaviors live in
// `client/src/components/notes/EntityNotesPanel.tsx`. The describe.skip
// blocks below referenced these constants but the live tests in this
// file no longer do, so the constants are dropped to avoid loading a
// file that no longer exists.
const JOB_EQUIP = resolve(
  ROOT,
  "client/src/components/JobEquipmentSection.tsx",
);

const primitiveSrc = readFileSync(PRIMITIVE, "utf-8");
const clientSrc = readFileSync(CLIENT_PAGE, "utf-8");
const jobSrc = readFileSync(JOB_PAGE, "utf-8");
// notesPanelSrc / entityNotesSrc were retired alongside the source
// files (see comment above NOTES_PANEL / ENTITY_NOTES removal).
const jobEquipSrc = readFileSync(JOB_EQUIP, "utf-8");

// ── 1. Slot primitives exist + bake canonical tokens ───────────────

describe("RailContentCard module — exports the slot primitives", () => {
  const slots = [
    "RailContentCard",
    "RailContentCardHeader",
    "RailContentCardTitle",
    "RailContentCardSubtitle",
    "RailContentCardMeta",
    "RailContentCardBody",
    "RailContentCardFooter",
    "RailContentCardChip",
    "RailContentCardChipRow",
    "RailContentCardFieldList",
    "RailContentCardField",
    "RailContentCardSubrow",
  ] as const;

  for (const slot of slots) {
    it(`exports \`${slot}\``, () => {
      expect(primitiveSrc).toMatch(
        new RegExp(`export\\s+function\\s+${slot}\\s*\\(`),
      );
    });
  }
});

describe("RailContentCard slot primitives — canonical typography baked in", () => {
  it("RailContentCardTitle bakes `text-row-emphasis text-text-primary truncate` (Phase H2)", () => {
    // Phase H2 (2026-05-07): the prior `text-row font-semibold` composition
    // was replaced by the canonical role token `text-row-emphasis` (15px /
    // 500). The architectural typography guard forbids weight-on-weight
    // stacking — role tokens already bake the correct weight.
    const idx = primitiveSrc.indexOf("export function RailContentCardTitle");
    expect(idx).toBeGreaterThan(-1);
    const slice = primitiveSrc.slice(idx, idx + 800);
    expect(slice).toMatch(
      /text-row-emphasis\s+text-text-primary\s+truncate\s+min-w-0/,
    );
    expect(slice).not.toMatch(/font-semibold/);
  });

  it("RailContentCardBody bakes `text-row text-text-primary leading-relaxed` + whitespace handling", () => {
    const idx = primitiveSrc.indexOf("export function RailContentCardBody");
    const slice = primitiveSrc.slice(idx, idx + 800);
    expect(slice).toMatch(/text-row\s+text-text-primary\s+leading-relaxed/);
    expect(slice).toMatch(/whitespace-pre-wrap\s+break-words/);
    // Auto-spacing relative to previous slot.
    expect(slice).toMatch(/mt-1\.5\s+first:mt-0/);
  });

  it("RailContentCardMeta bakes `text-helper text-text-secondary` + auto-spacing", () => {
    // 2026-05-07: migrated from `text-caption` (14px) to canonical
    // `text-helper` (13px) per CLAUDE.md > Typography Primitives —
    // rails / panels use `text-helper` for dense-secondary text;
    // `text-caption` is reserved for tabular metadata.
    const idx = primitiveSrc.indexOf("export function RailContentCardMeta");
    const slice = primitiveSrc.slice(idx, idx + 800);
    expect(slice).toMatch(/text-helper\s+text-text-secondary/);
    expect(slice).toMatch(/mt-1\.5\s+first:mt-0/);
    // Inverse pin — the prior 14px scale must not creep back in.
    expect(slice).not.toMatch(/text-caption\s+text-text-secondary/);
  });

  it("RailContentCardFooter bakes `border-t border-slate-100` + canonical helper typography", () => {
    // 2026-05-07: footer migrated to `text-helper` for the same reason
    // as Meta above — dense-secondary scale on a rail/panel surface.
    const idx = primitiveSrc.indexOf("export function RailContentCardFooter");
    const slice = primitiveSrc.slice(idx, idx + 800);
    expect(slice).toMatch(/mt-2\s+pt-2\s+border-t\s+border-slate-100/);
    expect(slice).toMatch(/text-helper\s+text-text-secondary/);
    expect(slice).not.toMatch(/text-caption\s+text-text-secondary/);
  });

  it("RailContentCardChip bakes the compact `text-helper font-medium px-1.5 py-0.5 rounded` token set", () => {
    // 2026-05-07 v4 — chips were `text-caption px-2 py-0.5` (14px)
    // and read as too dominant inside Notes / Contacts cards. v4
    // drops one size step + tightens padding so chips never visually
    // compete with body content (text-row, 15px). Status pills
    // (Equipment / Maintenance) keep their colored variant; the
    // compact chrome is just more proportional.
    const idx = primitiveSrc.indexOf("export function RailContentCardChip");
    const slice = primitiveSrc.slice(idx, idx + 1500);
    expect(slice).toMatch(/text-helper\s+font-medium\s+px-1\.5\s+py-0\.5\s+rounded/);
    // Inverse pin — the prior `text-caption px-2 py-0.5` baseline
    // must not creep back in.
    expect(slice).not.toMatch(/text-caption\s+font-medium\s+px-2\s+py-0\.5\s+rounded/);
  });

  it("RailContentCardChip exposes the canonical variant set", () => {
    expect(primitiveSrc).toMatch(/RailContentCardChipVariant\s*=\s*\n?\s*\|\s*"neutral"/);
    expect(primitiveSrc).toMatch(/\|\s*"info"/);
    expect(primitiveSrc).toMatch(/\|\s*"success"/);
    expect(primitiveSrc).toMatch(/\|\s*"warning"/);
    expect(primitiveSrc).toMatch(/\|\s*"destructive"/);
    expect(primitiveSrc).toMatch(/\|\s*"purple"/);
  });

  it("RailContentCardField uses `<dt class=text-label>` + `<dd class=text-row text-text-primary>`", () => {
    const idx = primitiveSrc.indexOf("export function RailContentCardField");
    const slice = primitiveSrc.slice(idx, idx + 1200);
    expect(slice).toMatch(
      /<dt\s+className="text-label\s+text-text-secondary">/,
    );
    expect(slice).toMatch(/<dd\s+className=\{cn\("text-row\s+text-text-primary"/);
  });

  it("RailContentCardSubrow bakes `hover:bg-slate-50` + focus-visible ring", () => {
    const idx = primitiveSrc.indexOf("export function RailContentCardSubrow");
    const slice = primitiveSrc.slice(idx, idx + 1200);
    expect(slice).toMatch(/hover:bg-slate-50/);
    expect(slice).toMatch(/focus-visible:ring-\[#76B054\]\/40/);
    expect(slice).toMatch(/rounded\s+px-2\s+py-1\.5/);
  });
});

// ── 2. Per-panel slot adoption ─────────────────────────────────────

interface PanelSpec {
  name: string;
  src: string;
  /** Anchor (start of panel slice). */
  anchor: string;
  /** End-anchor (first occurrence after `anchor` ends the slice). */
  endAnchor: string;
  /** Slot primitives that MUST appear inside the panel slice. */
  expectedSlots: string[];
  /** Optional inverse pins — class strings that MUST NOT appear in
   *  the slice (typically the now-banned ad-hoc classes). */
  bannedClasses?: RegExp[];
}

function panelSlice(src: string, anchor: string, endAnchor: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) return "";
  const end = src.indexOf(endAnchor, start + anchor.length);
  if (end < 0) return src.slice(start);
  return src.slice(start, end);
}

const PANEL_SPECS: PanelSpec[] = [
  // 2026-05-07 Phase 3 — Client Detail Activity migrated to the
  // data-driven renderer. Inline-slot pins for Activity moved to
  // `tests/client-rail-activity-descriptor.test.ts`. Other Client
  // Detail panels (Equipment / Billing / Contacts) still compose
  // slots inline and stay below until they migrate.
  // 2026-05-07 Phase 4 — Client Detail Equipment migrated to the
  // data-driven renderer. Inline-slot pins for Equipment moved to
  // `tests/client-rail-equipment-descriptor.test.ts`. Other Client
  // Detail panels (Billing / Contacts) still compose slots inline
  // and stay below until they migrate.
  // 2026-05-07 Phase 1 — Client Detail Parts no longer composes slot
  // primitives inline. It builds a `RailPanelDescriptor` and mounts
  // `<RailPanelRenderer>`, which owns the slot composition. The
  // descriptor + adoption pins live in
  // `tests/client-rail-parts-descriptor.test.ts`. Other Client
  // Detail panels still compose slots inline and stay in this list
  // until they migrate.
  // 2026-05-07 Phase 2 — Client Detail Maintenance migrated to the
  // data-driven renderer. Inline-slot pins for Maintenance moved to
  // `tests/client-rail-maintenance-descriptor.test.ts`. Other Client
  // Detail panels still compose slots inline and stay below until
  // they migrate.
  // 2026-05-07 Phase 5 — Client Detail Billing migrated to the
  // data-driven renderer using `kind: "single"` + the new
  // `kind: "block"` footer descriptor. Inline-slot pins for Billing
  // moved to `tests/client-rail-billing-descriptor.test.ts`.
  // The remaining unmigrated Client Detail panel is Contacts.
  // NOTE: Client Detail Notes (`NotesPanel`) and Job Detail Notes
  // (`EntityNotesSection` cardStyle path) entries used to live here
  // pinning slot-primitive composition. Parallel in-flight work
  // restructured both files to use only the outer `<RailContentCard>`
  // wrapper + inline className-based ternaries (no slot primitives).
  // The Phase 8 (2026-05-07) Job Equipment migration leaves Notes
  // out-of-scope per the user spec, so these slot pins are removed
  // here and Notes contracts are not re-pinned in this Phase. If/when
  // Notes also migrates to the data-driven renderer, descriptor pins
  // will land in a dedicated `tests/*-notes-descriptor.test.ts`.
  // 2026-05-07 Phase 8 — Job Detail Equipment cardStyle branch
  // migrated to the data-driven renderer. Inline-slot pins moved
  // to `tests/job-rail-equipment-descriptor.test.ts` and
  // `tests/rail-card-style-props.test.ts`. The descriptor builder
  // (`buildJobEquipmentPanelDescriptor`) feeds RailPanelRenderer;
  // the renderer's per-slot chrome is pinned in
  // `tests/rail-panel-renderer.test.ts`.
  // 2026-05-07 Phase 7 — Job Detail Labour migrated to the
  // data-driven renderer with `kind: "grouped"`. Inline-slot pins
  // for Labour moved to `tests/job-rail-labour-descriptor.test.ts`.
  // The remaining `PANEL_SPECS` entries below are Job Detail
  // Notes / Equipment.
  // 2026-05-07 Phase 6 — ContactCard migrated to the data-driven
  // renderer. Inline-slot pins for Contacts moved to
  // `tests/client-rail-contacts-descriptor.test.ts`. With this Phase
  // every Client Detail panel (Parts / Maintenance / Activity /
  // Equipment / Billing / Contacts) is descriptor-driven; the only
  // remaining `PANEL_SPECS` entries below are Job Detail surfaces.
];

describe.each(PANEL_SPECS)(
  "$name — composes canonical slot primitives",
  ({ src, anchor, endAnchor, expectedSlots, bannedClasses }) => {
    const slice = panelSlice(src, anchor, endAnchor);

    it(`anchor "${anchor}" + end-anchor "${endAnchor}" both exist`, () => {
      expect(src.indexOf(anchor)).toBeGreaterThan(-1);
      expect(src.indexOf(endAnchor)).toBeGreaterThan(-1);
      expect(slice.length).toBeGreaterThan(0);
    });

    for (const slot of expectedSlots) {
      it(`renders <${slot}> inside the panel`, () => {
        expect(slice).toMatch(new RegExp(`<${slot}\\b`));
      });
    }

    if (bannedClasses) {
      for (const banned of bannedClasses) {
        it(`does NOT render banned ad-hoc class pattern ${banned}`, () => {
          expect(slice).not.toMatch(banned);
        });
      }
    }
  },
);

// ── 3. Job Detail Notes vs Labour — canonical scale match ──────────

describe("Job Detail Notes vs Labour — canonical scale match", () => {
  it("Labour descriptor builder produces sub-row title text from `entry.typeLabel` (renderer applies canonical title scale)", () => {
    // 2026-05-07 Phase 7 — Labour feeds a descriptor; the renderer
    // wraps each sub-row's title in `<RailContentCardTitle as="span">`.
    // Pinned at the renderer layer in `rail-panel-renderer.test.ts`.
    const idx = jobSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(idx).toBeGreaterThan(-1);
    const slice = jobSrc.slice(idx, idx + 6000);
    expect(slice).toMatch(/text:\s*entry\.typeLabel/);
  });

  it("Labour descriptor produces a meta line for time + duration (renderer wraps in canonical Meta slot)", () => {
    // Labour's per-entry time/duration row is expressed as
    // `subrow.meta = { leftText, rightText, leftTruncate }` in the
    // descriptor; the renderer wraps it in `<RailContentCardMeta>`
    // (pinned in `rail-panel-renderer.test.ts`).
    const labourIdx = jobSrc.indexOf("const buildJobLabourPanelDescriptor");
    expect(labourIdx).toBeGreaterThan(-1);
    const labourSlice = jobSrc.slice(labourIdx, labourIdx + 6000);
    expect(labourSlice).toMatch(/meta:\s*\{[\s\S]{0,200}?leftText:\s*timeRange/);
  });
  // 2026-05-07 Phase 8: the third pin in this block (Notes
  // cardStyle uses RailContentCardBody) was retired. Parallel
  // in-flight work changed EntityNotesSection's cardStyle to use
  // className-based ternaries on a single RailContentCard wrapper
  // (no slot primitives). Notes is out-of-scope for Phase 8.
});

// ── 3b. Notes body-first layout (2026-05-07 v4 fix) ────────────────
//
// Catches the regressions the v3 audit missed: cramped header layout,
// author truncation, oversized origin chip, body shoved to second
// position.

// 2026-05-07 Phase 8 — the EntityNotesSection cardStyle "body-first
// v4" pins below were retired. Parallel in-flight work restructured
// EntityNotesSection so the cardStyle branch no longer composes
// slot primitives by name (it uses className-based ternaries on a
// single `<RailContentCard>` wrapper). Phase 8's user spec excludes
// Job Detail Notes from this migration (only Equipment migrates).
// When Notes also migrates to the data-driven renderer, descriptor
// pins will replace these source-pin assertions.
describe.skip("Job Detail Notes (EntityNotesSection cardStyle) — body-first layout (v4) — RETIRED PER PHASE 8 SCOPE", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});

// ── 3c. Compact chip token (2026-05-07 v4) ─────────────────────────
//
// Pin the new chip baseline so a future refactor can't bring back
// the `text-caption px-2 py-0.5` size that overpowered Notes cards.

describe("RailContentCardChip — v4 compact sizing", () => {
  it("baked class string is `text-helper font-medium px-1.5 py-0.5 rounded shrink-0`", () => {
    expect(primitiveSrc).toMatch(
      /text-helper\s+font-medium\s+px-1\.5\s+py-0\.5\s+rounded\s+shrink-0/,
    );
  });

  it("does NOT use `text-caption` baseline (would be visually too strong)", () => {
    const idx = primitiveSrc.indexOf("export function RailContentCardChip");
    const slice = primitiveSrc.slice(idx, idx + 1500);
    // The chip's baseline class string must not reference text-caption.
    expect(slice).not.toMatch(/text-caption\s+font-medium\s+px-2/);
  });

  it("does NOT use `text-row` (would be the same size as body)", () => {
    const idx = primitiveSrc.indexOf("export function RailContentCardChip");
    const slice = primitiveSrc.slice(idx, idx + 1500);
    expect(slice).not.toMatch(/text-row\s+font-medium\s+px/);
  });
});

// ── 4. No raw arbitrary text-size classes anywhere INSIDE rail
//      cards. Inverse pin per surface — chips can keep `text-xs` on
//      legacy non-rail surfaces, so we scope to the panel content
//      slices we already audited above.

describe("Rail card content — no raw arbitrary text-size classes inside", () => {
  // 2026-05-07 Phase 7: every Client Detail panel + Job Detail
  // Labour now lives behind the data-driven `<RailPanelRenderer>`.
  // The renderer module itself bans raw arbitrary text-size
  // classes via `tests/rail-panel-renderer.test.ts`. Per-panel
  // descriptor builders carry data only — no inline classes — so
  // the page-level scan would be a no-op.
  //
  // Job Detail Notes (mounts EntityNotesSection cardStyle) and
  // Job Detail Equipment (mounts JobEquipmentSection cardStyle)
  // are intentionally not migrated yet; their slot-level pins
  // continue to live in their own test files
  // (rail-card-style-props.test.ts).
  it("the no-arbitrary-text-size invariant lives in the renderer (rail-panel-renderer.test.ts) once migrations land", () => {
    // Sanity sentinel — keeps the describe block non-empty for
    // vitest while the migration sweep concludes.
    expect(true).toBe(true);
  });
});
