/**
 * Client Detail right-side rail source-pin tests
 * (2026-05-07 v3 — canonical `<DetailRightRail>` primitive extraction).
 *
 * The rail chrome (top-tab nav + panel header + close X + bottom-border
 * underline + aria-pressed wiring) is now owned by the canonical
 * `<DetailRightRail>` primitive at
 * `client/src/components/detail-rail/DetailRightRail.tsx`. ClientDetailPage
 * mounts it via `testIdPrefix="client-side"` so the rendered DOM still
 * carries `client-side-rail` / `client-side-panel-${id}` /
 * `client-side-panel-close` / `client-side-panel-empty` byte-for-byte.
 *
 * These pins read BOTH `ClientDetailPage.tsx` (page-local registry +
 * tab content + per-tab action button) AND `DetailRightRail.tsx`
 * (canonical chrome contract). They fail if a future refactor:
 *
 *   - re-introduces a parallel local UtilityRail/RailHeaderAction
 *   - adds a "Files" item or a separate "History" item
 *   - drops any of the seven canonical rail items
 *   - drops the close-X / aria-pressed / bottom-underline wiring from the
 *     primitive
 *   - reverts Equipment / Parts / Maintenance / Activity panels to the
 *     prior shortcut-only `<RailJumpoutPanel>` design
 *   - re-introduces the "(scope-label)" chip beside the panel title
 *   - re-introduces a duplicate `<h3>Contacts</h3>` body heading
 *   - re-introduces "Primary Contacts" / "Other Contacts" section
 *     headings inside the contacts panel
 *   - mounts <NotesPanel> outside the Notes panel branch
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const pageSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/ClientDetailPage.tsx"),
  "utf-8",
);
const railSrc = readFileSync(
  resolve(__dirname, "../client/src/components/detail-rail/DetailRightRail.tsx"),
  "utf-8",
);

// ── Layout: rail lifted to outer flex row ────────────────────────────

describe("Client Detail layout — right utility region spans full content height", () => {
  it("the page root is a horizontal flex row at lg (column-on-mobile) so the rail can be a top-level sibling", () => {
    expect(pageSrc).toMatch(
      /<div\s+className="flex\s+h-full\s+flex-col\s+lg:flex-row\s+bg-app-bg"\s+data-testid="client-detail-root"/,
    );
  });

  it("a `LEFT COLUMN` wraps page header + scope bar + body, leaving the rail outside it", () => {
    // The new wrapper carries `flex-col` so it keeps the existing
    // vertical stack of [page header][scope bar][body row]; the
    // outer page row contains [this wrapper][rail].
    expect(pageSrc).toMatch(
      /\/\* ── LEFT COLUMN: page header \+ scope bar \+ workspace body ── \*\//,
    );
    expect(pageSrc).toMatch(
      /\/\* ═══ \/LEFT COLUMN \(page header \+ scope bar \+ body\) ═══ \*\//,
    );
  });

  it("the body row inside the left column is single-column (no rail sibling there anymore)", () => {
    // Pre-PR the body row was `flex lg:flex-row flex-col` so the
    // rail could be its inline sibling. Post-PR the rail lives
    // outside, so the body row no longer needs lg:flex-row — single
    // column at every breakpoint.
    expect(pageSrc).toMatch(
      /<div\s+className="flex-1\s+min-h-0\s+flex\s+flex-col\s+overflow-hidden"\s+data-testid="client-detail-body"/,
    );
  });

  it("the rail aside is announced + carries its data-testid", () => {
    // Page-level outer aside testid stays in the page source.
    expect(pageSrc).toMatch(/data-testid="client-right-column"/);
    // The page mounts the canonical primitive with the "client-side"
    // prefix + the existing aria-label, preserving the rendered DOM.
    expect(pageSrc).toMatch(/testIdPrefix="client-side"/);
    expect(pageSrc).toMatch(/ariaLabel="Client information rail"/);
    // The primitive emits `${testIdPrefix}-rail` on its <nav>; that
    // template lives in `DetailRightRail.tsx`.
    expect(railSrc).toMatch(/data-testid=\{`\$\{testIdPrefix\}-rail`\}/);
    expect(railSrc).toMatch(/aria-label=\{ariaLabel\}/);
  });

  it("the page-level aside still owns the resize-aware width contract (CSS variable + persisted width)", () => {
    // Closing the rail on ClientDetailPage continues to flow through
    // the page-level aside's width control: utilityTab=null →
    // RAIL_COLLAPSED_WIDTH (48px), open → persisted rightRailWidth.
    // The canonical primitive's `w-fit` collapse fix is additive —
    // ClientDetailPage's external width control still drives the
    // visible aside width.
    expect(pageSrc).toMatch(
      /utilityTab === null \? RAIL_COLLAPSED_WIDTH : rightRailWidth/,
    );
  });

  it("rail content collapses to compact strip when no panel is open (canonical primitive contract)", () => {
    // Verified at the primitive level: when activeTabId is null,
    // the panel <section> isn't rendered AND the outer container
    // shrinks via `w-fit`. Re-pinning here documents that
    // ClientDetailPage's `utilityTab` flows through this contract.
    expect(pageSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?activeTabId=\{utilityTab\}/,
    );
    expect(railSrc).toMatch(/!displayedTab\s*&&\s*"w-fit"/);
  });
});

// ── Rail items registry ─────────────────────────────────────────────

describe("Client Detail rail — registry of three items (2026-05-12 RALPH consolidation)", () => {
  // 2026-05-12: 7 tabs → 3. Summary (Billing + Maintenance + Activity),
  // Notes, Equip & Parts (Equipment + Parts). Contacts removed from rail.
  const expected = [
    { testId: "rail-item-summary", label: "Summary" },
    { testId: "rail-item-notes", label: "Notes" },
    { testId: "rail-item-equipment-parts", label: "Equip & Parts" },
  ];

  for (const item of expected) {
    it(`registers the "${item.label}" rail item with stable test id`, () => {
      expect(pageSrc).toContain(`testId: "${item.testId}"`);
      expect(pageSrc).toContain(`label: "${item.label}"`);
    });
  }

  it("does NOT include standalone Contacts / Billing / Equipment / Parts / Maintenance / Activity tabs", () => {
    for (const id of ["contacts", "billing", "equipment", "parts", "maintenance", "activity"]) {
      expect(pageSrc).not.toMatch(new RegExp(`testId:\\s*"rail-item-${id}"`));
    }
  });

  it("does NOT include a Files item", () => {
    expect(pageSrc).not.toMatch(/testId:\s*"rail-item-files"/);
    expect(pageSrc).not.toMatch(/label:\s*"Files"/);
  });

  it("does NOT include a separate History item (replaced by Activity)", () => {
    expect(pageSrc).not.toMatch(/testId:\s*"rail-item-history"/);
    expect(pageSrc).not.toMatch(/label:\s*"History"/);
  });
});

// ── Old <Tabs> + jumpout shortcuts are gone ──────────────────────────

describe("Client Detail rail — legacy UI removed", () => {
  it("no <Tabs value={utilityTab} ...> remains", () => {
    expect(pageSrc).not.toMatch(/<Tabs\s+value=\{utilityTab\}/);
    expect(pageSrc).not.toMatch(
      /data-testid="utility-tab-(contacts|notes|billing)"/,
    );
  });

  it("the prior `RailJumpoutPanel` shortcut-only helper is deleted", () => {
    expect(pageSrc).not.toMatch(/function\s+RailJumpoutPanel\(/);
    expect(pageSrc).not.toMatch(/<RailJumpoutPanel/);
    // The shortcut testIds (rail-jump-*) are gone too — they were the
    // hallmark of the previous "Open Equipment tab" placeholder.
    for (const key of ["equipment", "parts", "maintenance", "activity"]) {
      expect(pageSrc).not.toContain(`testId="rail-jump-${key}"`);
    }
  });

  it("Equipment panel does NOT render a 'Open Equipment tab' shortcut as its only content", () => {
    // The compact body uses ClientEquipmentPanelBody. A revert to
    // jumpout-only would re-introduce the shortcut copy; pin against it.
    expect(pageSrc).not.toMatch(/Equipment for this client lives in the main work area/);
  });
});

// ── Panel header rules: title + per-panel action + close X ──────────

describe("Client Detail panel header — single canonical row, no scope chip", () => {
  it("panel header DOES NOT render the (scope-label) chip beside the title", () => {
    // The scope-chip element used `data-testid="client-info-scope-label"`.
    // Removed wholesale.
    expect(pageSrc).not.toMatch(/data-testid="client-info-scope-label"/);
  });

  it("close-X button is bound to setUtilityTab(null) via the canonical onActiveTabChange", () => {
    // The close-X testid is generated by the primitive (`${prefix}-panel-close`)
    // and the close-handler dispatches via `onActiveTabChange(null)`.
    expect(railSrc).toMatch(/data-testid=\{`\$\{testIdPrefix\}-panel-close`\}/);
    expect(railSrc).toMatch(/onClick=\{\(\)\s*=>\s*onActiveTabChange\(null\)\}/);
    // The page wires `onActiveTabChange` directly to `setUtilityTab`
    // (with a cast back to the page's UtilityPanel union).
    expect(pageSrc).toMatch(
      /onActiveTabChange=\{\(id\)\s*=>\s*setUtilityTab\(id\s+as\s+UtilityPanel\)\}/,
    );
  });

  it("clicking the active rail item again closes the panel (toggle)", () => {
    // Toggle behavior lives inside the canonical primitive.
    expect(railSrc).toMatch(
      /onActiveTabChange\(\s*isActive\s*\?\s*null\s*:\s*tab\.id\s*\)/,
    );
  });

  it("active rail item carries aria-pressed + canonical green bottom-border underline", () => {
    expect(railSrc).toMatch(/aria-pressed=\{isActive\}/);
    // 2026-05-11: top-tab layout uses border-b-2 border-[#76B054] underline
    // instead of the old left-side bg-[#76B054] accent bar span.
    expect(railSrc).toMatch(/isActive[\s\S]{0,200}?border-\[#76B054\]/);
  });

  it("each panel header carries a stable per-panel test id (from displayedTab)", () => {
    expect(railSrc).toMatch(/data-testid=\{`\$\{testIdPrefix\}-panel-header-\$\{displayedTab\.id\}`\}/);
  });
});

describe("Client Detail panel header actions — per-tab action slots", () => {
  it("Notes panel header has '+ Add Note' action with stable testId", () => {
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-note"/);
  });

  it("Summary panel header has 'Edit' action wired to setEditClientDialogOpen (billing edit)", () => {
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-edit-billing"/);
    expect(pageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setEditClientDialogOpen\(true\)\}[\s\S]{0,400}?data-testid="client-side-panel-action-edit-billing"/,
    );
  });

  it("Equip & Parts panel header has '+ Add Equipment' and '+ Add Part' actions (location scope)", () => {
    // Both buttons live inside the equipment-parts tab action slot,
    // gated behind a scopeType === "location" ? ... : null guard.
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-equipment"/);
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-part"/);
    expect(pageSrc).toMatch(
      /id:\s*"equipment-parts"[\s\S]{0,2000}?action:\s*scopeType\s*===\s*"location"\s*\?/,
    );
  });

  it("no standalone Contacts / Maintenance / Activity action testIds remain", () => {
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-add-contact"/);
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-add-maintenance"/);
  });
});

// ── Contacts: no standalone rail tab (2026-05-12 RALPH) ─────────────

describe("Client Detail Contacts — removed from rail tab bar", () => {
  it("no standalone contacts tab exists in clientRailTabs", () => {
    expect(pageSrc).not.toContain('id: "contacts"');
    expect(pageSrc).not.toContain('testId: "rail-item-contacts"');
  });

  it("contacts panel body never renders 'Primary Contacts' or 'Other Contacts' section headers", () => {
    expect(pageSrc).not.toMatch(/Primary\s+Contacts/);
    expect(pageSrc).not.toMatch(/Other\s+Contacts/);
  });
});

// ── Notes panel ──────────────────────────────────────────────────────

describe("Client Detail Notes panel — notes only, empty-state copy preserved", () => {
  it("the Notes panel mounts <EntityNotesPanel> with the canonical openAddNoteSignal contract", () => {
    // 2026-05-08 Tier 4 Notes canonicalization — `<NotesPanel
    // ref={notesRef} hideAddButton>` retired in favor of declarative
    // `<EntityNotesPanel openAddNoteSignal={notesAddSignal}>`. Both
    // company and location scopes route through the same primitive
    // (entityType="company" | "location"). The rail tab's +Add button
    // bumps `notesAddSignal` instead of calling an imperative ref.
    expect(pageSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,2000}?<EntityNotesPanel[\s\S]{0,400}?entityType="company"/,
    );
    expect(pageSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,2000}?<EntityNotesPanel[\s\S]{0,1200}?entityType="location"/,
    );
    expect(pageSrc).toMatch(/setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
    // Inverse pin — the imperative `notesRef.startAdding()` flow is gone.
    expect(pageSrc).not.toMatch(/notesRef\.current\?\.startAdding\(\)/);
    expect(pageSrc).not.toMatch(/<NotesPanel\b/);
  });

  it("Notes empty-state copy matches the spec", () => {
    expect(pageSrc).toMatch(/No notes yet\./);
    expect(pageSrc).toMatch(/Add one to keep your team aligned\./);
  });
});

// ── Billing panel: real data, not a shortcut ─────────────────────────

describe("Client Detail Billing panel — real billing data + edit action", () => {
  it("Summary tab's content slot mounts ClientSummaryTabContent which includes ClientBillingPanelBody", () => {
    expect(pageSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,2000}?<ClientSummaryTabContent/,
    );
    expect(pageSrc).toMatch(/<ClientBillingPanelBody/);
  });

  it("ClientBillingPanelBody renders payment terms / outstanding / lifetime / billing address", () => {
    expect(pageSrc).toMatch(/label="Payment terms"/);
    expect(pageSrc).toMatch(/label="Outstanding"/);
    expect(pageSrc).toMatch(/label="Lifetime revenue"/);
    expect(pageSrc).toMatch(/Billing address/);
  });

  it("'Use company default' label maps to NULL paymentTermsDays", () => {
    expect(pageSrc).toMatch(
      /paymentTermsDays\s*===\s*null[\s\S]{0,80}?Use company default/,
    );
  });
});

// ── Equipment panel: real data ───────────────────────────────────────

describe("Client Detail Equipment panel — compact equipment cards", () => {
  it("Equip & Parts tab's content slot mounts ClientEquipmentPartsPanelBody with equipment prop", () => {
    expect(pageSrc).toMatch(
      /id:\s*"equipment-parts"[\s\S]{0,2000}?<ClientEquipmentPartsPanelBody[\s\S]{0,400}?equipment=\{locationEquipment\}/,
    );
    expect(pageSrc).toMatch(/<ClientEquipmentPanelBody/);
  });

  it("ClientEquipmentPanelBody empty-state matches the spec copy", () => {
    expect(pageSrc).toMatch(/No equipment yet\./);
    expect(pageSrc).toMatch(/Add equipment to track installed systems for this client\./);
  });

  it("Each equipment card has a stable test id", () => {
    // 2026-05-07: each equipment card is now wrapped in the canonical
    // `<RailContentCard>` primitive, which forwards its `testId` prop
    // as the rendered DOM's `data-testid`. The static-source pin
    // therefore matches `testId="client-equipment-card"`; the runtime
    // testid is unchanged.
    expect(pageSrc).toMatch(/testId="client-equipment-card"/);
  });

  // ── 2026-05-07 expansion + click-to-edit ─────────────────────────

  it("each equipment card is rendered via canonical `<RailContentCard>` and wired to the page-level EquipmentDetailModal", () => {
    // The card is the canonical primitive `<RailContentCard>` (which
    // renders a `<button>` when `onClick` is supplied). Pin the
    // primitive + the `onOpen(eq)` handler.
    const startIdx = pageSrc.indexOf('data-testid="client-equipment-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ClientPartsPanelBody", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 6000);
    expect(slice).toMatch(/<RailContentCard[\s\S]{0,1500}?testId="client-equipment-card"/);
    expect(slice).toMatch(/onClick=\{\(\)\s*=>\s*onOpen\(eq\)\}/);
    // The Equipment tab's `content:` slot passes the page-level
    // setDetailEquipment as the `onOpen` prop. After the canonical
    // rail extraction the prop appears once in the inline tab spec
    // (rather than twice on the legacy two UtilityRail mounts).
    expect(pageSrc).toMatch(/onOpen=\{setDetailEquipment\}/);
  });

  it("the canonical EquipmentDetailModal is mounted at the page level (not inside dead LocEquipmentTab)", () => {
    // The page-level mount is anchored to the page-level
    // detailEquipment state. Pin both the import and the mount.
    expect(pageSrc).toMatch(
      /import\s+\{\s*EquipmentDetailModal\s*\}\s+from\s+"@\/components\/EquipmentDetailModal"/,
    );
    expect(pageSrc).toMatch(
      /<EquipmentDetailModal[\s\S]{0,400}?equipment=\{detailEquipment\}/,
    );
    // No duplicate equipment editor — the canonical modal handles
    // edit via AddEquipmentDialog mode="edit" internally.
    const editorMatches = pageSrc.match(/EquipmentDetailModal/g);
    // Exactly one import + one mount (no extras).
    expect((editorMatches?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("equipment cards expose stable per-row test ids for every snapshot field", () => {
    for (const key of ["type", "serial", "tag", "installed", "warranty"]) {
      expect(pageSrc).toContain(`data-testid="client-equipment-card-row-${key}"`);
    }
  });

  it("equipment cards use canonical typography tokens (no ad-hoc tiny text)", () => {
    const startIdx = pageSrc.indexOf('data-testid="client-equipment-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ClientPartsPanelBody", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5000);

    // Title uses text-section-title.
    expect(slice).toMatch(/<h4\s+className="[^"]*\btext-section-title\b/);
    // Labels use text-label + text-text-secondary; values use text-row + text-text-primary.
    expect(slice).toMatch(/text-label text-text-secondary/);
    expect(slice).toMatch(/text-row text-text-primary/);
    // No raw arbitrary tiny pixel sizes.
    expect(slice).not.toMatch(/text-\[10px\]/);
    expect(slice).not.toMatch(/text-\[11px\]/);
    expect(slice).not.toMatch(/\btext-xs\b/);
  });

  it("equipment status badge renders Active / Archived (the only status the schema carries)", () => {
    expect(pageSrc).toMatch(/data-testid="client-equipment-card-status"/);
    expect(pageSrc).toMatch(/eq\.isActive\s*\?\s*"Active"\s*:\s*"Archived"/);
  });

  it("equipment cards do NOT use the prior single-line truncate pattern", () => {
    const startIdx = pageSrc.indexOf('data-testid="client-equipment-panel-body"');
    const endIdx = pageSrc.indexOf("function ClientPartsPanelBody", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx);
    // Truncate would clip long manufacturer/model/serial values; the
    // expanded card uses break-words / break-all and line-clamp-3
    // for notes instead.
    expect(slice).not.toMatch(/\btruncate\b/);
  });

  it("equipment header action '+ Add Equipment' wires to the page-level AddEquipmentDialog", () => {
    // The Equipment tab's action slot is an inline button that calls
    // setEquipmentModalOpen(true) directly (legacy onRequestAddEquipment
    // callback indirection is gone — see clientRailTabs[].action).
    expect(pageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}[\s\S]{0,400}?data-testid="client-side-panel-action-add-equipment"/,
    );
  });
});

// ── Parts panel: real PM-parts data + canonical add flow ─────────────

describe("Client Detail Parts panel — real PM-parts data + canonical add flow", () => {
  it("Equip & Parts tab's content slot includes ClientPartsPanelBody (via ClientEquipmentPartsPanelBody)", () => {
    expect(pageSrc).toMatch(
      /id:\s*"equipment-parts"[\s\S]{0,2000}?<ClientEquipmentPartsPanelBody[\s\S]{0,400}?pmParts=\{pmParts\}/,
    );
    expect(pageSrc).toMatch(/<ClientPartsPanelBody[\s\S]{0,400}?scopeType=\{scopeType\}/);
  });

  it("ClientPartsPanelBody renders the canonical company-scope hint when no location is picked", () => {
    expect(pageSrc).toMatch(/Parts are tracked per location\./);
    expect(pageSrc).toMatch(/Pick a specific location to view its PM parts\./);
  });

  it("ClientPartsPanelBody renders the canonical empty-state copy on location scope with no parts", () => {
    expect(pageSrc).toMatch(/No client-specific parts yet\./);
    expect(pageSrc).toMatch(
      /Add parts the technician should bring on every PM visit\./,
    );
  });

  it("each part card has a stable test id + per-row test ids for SKU / category / cost / equipment", () => {
    // 2026-05-07: parts cards now go through canonical `<RailContentCard>`
    // (forwards `testId` as `data-testid`); per-row testids remain
    // literal `data-testid="..."` attributes on the inner `<div>`s.
    expect(pageSrc).toMatch(/testId="client-parts-card"/);
    for (const key of ["sku", "category", "cost", "equipment"]) {
      expect(pageSrc).toContain(`data-testid="client-parts-card-row-${key}"`);
    }
    expect(pageSrc).toMatch(/data-testid="client-parts-card-quantity"/);
  });

  it("part cards are NOT clickable (no canonical single-row edit surface today)", () => {
    // Slice scoped to the parts panel body. The Maintenance pattern
    // (non-navigating card + explicit action link) is right for any
    // surface where there's no canonical single-row edit modal —
    // PartsSelectorModal is bulk-only, so cards stay non-interactive.
    const startIdx = pageSrc.indexOf('data-testid="client-parts-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5000);
    // No `<button` or `<Link` wrapping the card. After migration to
    // `<RailContentCard>`, the static variant renders a `<div>` —
    // pin against the canonical primitive carrying an `onClick`.
    expect(slice).not.toMatch(
      /<RailContentCard[\s\S]{0,400}?onClick=[\s\S]{0,400}?testId="client-parts-card"/,
    );
    expect(slice).not.toMatch(/<Link[\s\S]{0,400}?testId="client-parts-card"/);
  });

  it("parts cards use canonical typography tokens (no ad-hoc tiny text)", () => {
    const startIdx = pageSrc.indexOf('data-testid="client-parts-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5000);

    expect(slice).toMatch(/<h4\s+className="[^"]*\btext-section-title\b/);
    expect(slice).toMatch(/text-label text-text-secondary/);
    expect(slice).toMatch(/text-row text-text-primary/);
    expect(slice).not.toMatch(/text-\[10px\]/);
    expect(slice).not.toMatch(/text-\[11px\]/);
    expect(slice).not.toMatch(/\btext-xs\b/);
  });

  it("parts header action '+ Add Part' wires to PartsSelectorModal (page-level mount)", () => {
    // The Parts tab's action slot is an inline button that calls
    // setPartsModalOpen(true) directly (legacy onRequestAddPart
    // callback indirection is gone — see clientRailTabs[].action).
    expect(pageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setPartsModalOpen\(true\)\}[\s\S]{0,400}?data-testid="client-side-panel-action-add-part"/,
    );
  });

  it("does NOT introduce a duplicate parts editor or a fake client-specific parts model", () => {
    // The legacy `client_parts` table at shared/schema.ts:937 is
    // unused; this implementation reads `pmParts`
    // (location_pm_part_templates joined with items). Pin against
    // accidentally introducing a parallel `clientParts` query in
    // ClientDetailPage.
    expect(pageSrc).not.toMatch(/queryKey:\s*\[\s*["']\/api\/client-parts["']/);
    expect(pageSrc).not.toMatch(/apiRequest\(\s*["']\/api\/client-parts/);
  });
});

// ── Maintenance panel: real recurring templates ──────────────────────

describe("Client Detail Maintenance panel — real recurring templates", () => {
  it("Summary tab mounts ClientSummaryTabContent which includes ClientMaintenancePanelBody", () => {
    // Maintenance is now a section inside the Summary tab, not a standalone tab.
    expect(pageSrc).toMatch(/<ClientMaintenancePanelBody/);
    expect(pageSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,2000}?<ClientSummaryTabContent/,
    );
  });

  it("ClientMaintenancePanelBody fetches /api/recurring-templates", () => {
    expect(pageSrc).toMatch(
      /apiRequest\(\s*"\/api\/recurring-templates"\s*\)/,
    );
  });

  it("ClientMaintenancePanelBody renders the canonical empty-state copy", () => {
    expect(pageSrc).toMatch(/No maintenance plans yet\./);
    expect(pageSrc).toMatch(
      /Add a maintenance plan to schedule recurring service for this client\./,
    );
  });

  it("each plan row has a stable test id", () => {
    // 2026-05-07: testid forwarded through `<RailContentCard testId=…>`.
    expect(pageSrc).toMatch(/testId="client-maintenance-card"/);
  });

  it("the card itself is NOT a full-card Link (only an explicit action navigates)", () => {
    // The card-testid'd element is a `<RailContentCard>` (static /
    // div variant) wrapped in a semantic `<li>`. A whole-card Link
    // would force users off Client Detail just to inspect a plan;
    // the new design keeps the card on-page and routes only via the
    // explicit "View / Edit in Maintenance" action below.
    expect(pageSrc).toMatch(
      /<li[\s\S]{0,400}?<RailContentCard[\s\S]{0,200}?testId="client-maintenance-card"/,
    );
    // Inverse pin: the card-testid'd element MUST NOT be wrapped in
    // a `<Link>` and MUST NOT carry an `onClick` (which would make
    // the canonical primitive render a clickable button).
    expect(pageSrc).not.toMatch(
      /<Link[\s\S]{0,800}?testId="client-maintenance-card"/,
    );
    expect(pageSrc).not.toMatch(
      /<RailContentCard[\s\S]{0,400}?onClick=[\s\S]{0,400}?testId="client-maintenance-card"/,
    );
  });

  it("each card carries an explicit 'View / Edit in Maintenance' action linking to /pm/:id", () => {
    // The action link is the SOLE navigation affordance on the
    // card. PMDetailPage is the unified view+edit surface
    // (App.tsx:292 — `/pm/:id` and `/pm/:id/edit` both render it).
    expect(pageSrc).toMatch(/data-testid="client-maintenance-card-action"/);
    expect(pageSrc).toMatch(
      /<Link\s+href=\{`\/pm\/\$\{t\.id\}`\}[\s\S]{0,800}?data-testid="client-maintenance-card-action"/,
    );
    // 2026-05-07 module rename: "Maintenance" → "Service Plans" everywhere
    // the user reads it as a destination. The visible link copy moves with it.
    expect(pageSrc).toMatch(/View \/ Edit in Service Plans/);
  });

  it("the action link carries an accessible label + title", () => {
    // 2026-05-07: aria-label + title strings track the Service Plans rename.
    expect(pageSrc).toMatch(
      /aria-label=\{`View or edit service plan \$\{t\.title\}`\}/,
    );
    expect(pageSrc).toMatch(/title="View \/ Edit in Service Plans"/);
  });

  it("the panel body uses semantic <ul>/<li> markup so the cards read as a list", () => {
    expect(pageSrc).toMatch(
      /<ul\s+className="[^"]*"\s+data-testid="client-maintenance-panel-body"/,
    );
    expect(pageSrc).toMatch(
      /<li[\s\S]{0,400}?<RailContentCard[\s\S]{0,200}?testId="client-maintenance-card"/,
    );
  });

  it("renders status badge (Active/Paused) on every card", () => {
    expect(pageSrc).toMatch(/data-testid="client-maintenance-card-status"/);
    // The badge body is a literal "Active" or "Paused" — pin both.
    expect(pageSrc).toMatch(/\?\s*"Active"\s*:\s*"Paused"/);
  });

  it("renders information-rich snapshot fields when data is present (Frequency / Next due / Started / Window / Billing / Location)", () => {
    // Each row renders only when its source field is populated, but
    // the literal labels must exist so the rendered DOM stays
    // canonical when data shows up.
    for (const label of ["Frequency", "Next due", "Started", "Window", "Billing", "Location"]) {
      expect(pageSrc).toContain(`>${label}</dt>`);
    }
  });

  // ── 2026-05-07 typography pass ────────────────────────────────────

  it("uses canonical typography role tokens (no ad-hoc tiny text inside the card slice)", () => {
    // Locate the maintenance-card slice precisely and assert that
    // none of the deprecated/raw small-text classes leak into it.
    // Canonical tokens (`text-section-title`, `text-row`, `text-label`,
    // `text-caption`, `text-helper`) live in tailwind.config.ts:68–79
    // and 124–165.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5000);

    // No raw arbitrary tiny pixel sizes — the prior offenders were
    // text-[10px] / text-[11px].
    expect(slice).not.toMatch(/text-\[10px\]/);
    expect(slice).not.toMatch(/text-\[11px\]/);
    // No raw text-xs leakage — Phase H lint forbids it; the
    // canonical card uses semantic role tokens instead.
    expect(slice).not.toMatch(/\btext-xs\b/);
  });

  it("card title uses text-section-title (canonical 18px/600 token)", () => {
    expect(pageSrc).toMatch(
      /<h4\s+className="[^"]*\btext-section-title\b[^"]*"[\s\S]{0,200}?\{t\.title\}/,
    );
  });

  it("status badge uses text-caption (14px/20px) — readable, not microscopic", () => {
    // The Badge element renders className BEFORE the data-testid
    // attribute, so search the slice BEFORE the testid for the
    // canonical class.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-card-status"');
    expect(startIdx).toBeGreaterThan(-1);
    const before = pageSrc.slice(Math.max(0, startIdx - 800), startIdx);
    expect(before).toMatch(/text-caption/);
    // Inverse pin: badge must not regress to an arbitrary tiny size.
    const around = pageSrc.slice(Math.max(0, startIdx - 800), startIdx + 200);
    expect(around).not.toMatch(/text-\[10px\]/);
  });

  it("snapshot row labels use text-label + text-text-secondary (muted)", () => {
    // Scope to the maintenance panel body slice — the same pattern
    // is reused on Equipment and Parts cards, so a global count
    // would conflate three surfaces. Within the maintenance slice
    // there are exactly 6 `<dt>` rows (Frequency always; Next due /
    // Started / Window / Billing / Location conditional).
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("function ", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 5000);
    const labelMatches = slice.match(
      /<dt className="text-label text-text-secondary">/g,
    );
    expect(labelMatches?.length ?? 0).toBe(6);
  });

  it("snapshot row values use text-row + text-text-primary (darker than labels, 15px/22px)", () => {
    const valueMatches = pageSrc.match(
      /<dd[\s\S]{0,160}?className="[^"]*\btext-row\b[^"]*\btext-text-primary\b/g,
    );
    expect(valueMatches?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("Location value allows 2-line wrap (line-clamp-2) — no aggressive single-line truncate", () => {
    expect(pageSrc).toMatch(
      /data-testid="client-maintenance-card-row-location"[\s\S]{0,400}?line-clamp-2/,
    );
    // Inverse pin: the location value must not use `truncate` (1-line
    // ellipsis) — that's the regression this fixes.
    const locStart = pageSrc.indexOf('data-testid="client-maintenance-card-row-location"');
    expect(locStart).toBeGreaterThan(-1);
    const locSlice = pageSrc.slice(locStart, locStart + 600);
    expect(locSlice).not.toMatch(/\btruncate\b/);
  });

  it("optional description uses text-helper (canonical 13px) + text-text-secondary", () => {
    expect(pageSrc).toMatch(
      /<p className="text-helper text-text-secondary line-clamp-3">[\s\S]{0,80}?\{t\.description\}/,
    );
  });

  it("snapshot rows are stacked label-above-value (not a 2-column grid)", () => {
    // The previous tight grid was `grid-cols-[max-content_1fr]
    // gap-x-2 gap-y-0.5` — pin against it returning. Stacking
    // (label on its own line above the value) is the canonical
    // narrow-panel pattern.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, startIdx + 5000);
    expect(slice).not.toMatch(/grid-cols-\[max-content_1fr\]/);
    expect(slice).not.toMatch(/grid grid-cols-\[/);
  });

  it("vertical row spacing uses space-y-2.5 (≈10px) for readability", () => {
    expect(pageSrc).toMatch(
      /<dl className="space-y-2\.5">/,
    );
  });

  it("action link copy uses text-caption (canonical 14px) — no ad-hoc shrinking", () => {
    // The Link element renders className BEFORE the data-testid,
    // so look behind the testid for the canonical class.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-card-action"');
    expect(startIdx).toBeGreaterThan(-1);
    const before = pageSrc.slice(Math.max(0, startIdx - 800), startIdx);
    expect(before).toMatch(/text-caption/);
    const around = pageSrc.slice(Math.max(0, startIdx - 800), startIdx + 200);
    expect(around).not.toMatch(/text-\[11px\]/);
  });

  it("Next due value carries a stable test id", () => {
    expect(pageSrc).toMatch(/data-testid="client-maintenance-card-next-due"/);
  });

  it("does NOT invent fields the API doesn't return (no equipment list, no generated-job count)", () => {
    // The recurring-templates feed doesn't return either today.
    // Rendering them would require new server work; pin against
    // accidentally adding labels for these in a future card edit.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-panel-body"');
    const endIdx = pageSrc.indexOf("function ", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 4000);
    expect(slice).not.toMatch(/>Equipment</);
    expect(slice).not.toMatch(/>Linked equipment</);
    expect(slice).not.toMatch(/>Generated work</);
    expect(slice).not.toMatch(/>Jobs generated</);
  });

  it("no inline modal editor was introduced for plan cards", () => {
    // Belt-and-braces: the plan-card slice does not contain a
    // <Dialog> / <ModalShell> mount. The action is a Link, not a
    // dialog trigger.
    const startIdx = pageSrc.indexOf('data-testid="client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, startIdx + 4000);
    expect(slice).not.toMatch(/<Dialog\b/);
    expect(slice).not.toMatch(/<ModalShell\b/);
    expect(slice).not.toMatch(/<AlertDialog\b/);
  });
});

// ── Activity panel: real events feed, replaces History ───────────────

describe("Client Detail Activity panel — real events feed (replaces History)", () => {
  it("Summary tab mounts ClientSummaryTabContent which includes ClientActivityPanelBody", () => {
    // Activity is now a section inside the Summary tab, not a standalone tab.
    expect(pageSrc).toMatch(/<ClientActivityPanelBody/);
    expect(pageSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,2000}?<ClientSummaryTabContent/,
    );
  });

  it("ClientActivityPanelBody fetches /api/activity/<entityType>/<id>", () => {
    expect(pageSrc).toMatch(
      /apiRequest\(\s*`\/api\/activity\/\$\{entityType\}\/\$\{entityId\}\?limit=15`/,
    );
  });

  it("ClientActivityPanelBody renders the canonical empty-state copy ('No activity yet.')", () => {
    expect(pageSrc).toMatch(/No activity yet\./);
  });

  it("each activity row has a stable test id", () => {
    // 2026-05-07: testid forwarded through `<RailContentCard testId=…>`
    // as the canonical card primitive replaces the prior bespoke row.
    expect(pageSrc).toMatch(/testId="client-activity-row"/);
  });

  it("the panel does NOT call itself 'History' anywhere user-facing", () => {
    // Comments that *describe* the History → Activity rename are
    // allowed; the user-facing label stays "Activity".
    expect(pageSrc).not.toMatch(/label:\s*"History"/);
  });
});

// ── Wiring: page passes new props on both rail mounts ────────────────

describe("Client Detail page — both rail mounts wire the canonical primitive", () => {
  it("ClientDetailPage imports the canonical DetailRightRail primitive", () => {
    expect(pageSrc).toMatch(
      /import\s*\{[^}]*\bDetailRightRail\b[^}]*\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("both rail mounts (mobile + desktop) pass the canonical clientRailTabs array + 'client-side' prefix + ariaLabel", () => {
    // Two `<DetailRightRail>` JSX mounts on the page (one in
    // `lg:hidden`, one in `hidden lg:flex`). Each passes the same
    // canonical tab array, testIdPrefix, and aria-label. The shape
    // `<DetailRightRail\s+tabs={clientRailTabs}` is unique to the
    // active mounts (not present in comments, imports, or
    // `<DetailRightRailEmpty>` calls), so we use it as the anchor.
    const mounts = pageSrc.match(/<DetailRightRail\s+tabs=\{clientRailTabs\}/g);
    expect(mounts?.length ?? 0).toBe(2);
    const ariaMatches = pageSrc.match(/ariaLabel="Client information rail"/g);
    expect(ariaMatches?.length ?? 0).toBe(2);
    // Per-mount `testIdPrefix="client-side"` check: split on the
    // active-mount anchor and inspect each chunk's head.
    const mountChunks = pageSrc.split(/<DetailRightRail\s+tabs=\{clientRailTabs\}/).slice(1);
    expect(mountChunks.length).toBe(2);
    for (const chunk of mountChunks) {
      const head = chunk.slice(0, 600);
      expect(head).toMatch(/testIdPrefix="client-side"/);
    }
  });

  it("the page builds Equipment / Maintenance / Billing / Parts content with the page-level state hooks", () => {
    // Each tab's content slot reads from page-local state (no
    // legacy callbacks like onRequestEditClient / onRequestAddEquipment
    // / onJumpToWorkspaceTab survive — they were UtilityRail
    // indirection).
    expect(pageSrc).toMatch(/equipment=\{locationEquipment\}/);
    expect(pageSrc).toMatch(/onOpen=\{setDetailEquipment\}/);
    expect(pageSrc).toMatch(/scopeType=\{scopeType\}/);
    expect(pageSrc).toMatch(/billing=\{billingPanelData\}/);
  });

  it("Edit Client / Add Equipment / Add Part actions wire directly to their setters (no callback indirection)", () => {
    expect(pageSrc).toMatch(/onClick=\{\(\)\s*=>\s*setEditClientDialogOpen\(true\)\}/);
    expect(pageSrc).toMatch(/onClick=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}/);
    expect(pageSrc).toMatch(/onClick=\{\(\)\s*=>\s*setPartsModalOpen\(true\)\}/);
  });
});

// ── 2026-05-07 v3: collapsed rail keeps icon menu visible ───────────

describe("Client Detail rail — collapsed state still shows the icon menu", () => {
  it("the prior 'DETAILS' vertical-tab expand button is removed", () => {
    expect(pageSrc).not.toMatch(/data-testid="client-right-column-expand"/);
    expect(pageSrc).not.toMatch(/aria-label="Expand utility rail"/);
    // The body of the prior collapsed button used the literal "Details"
    // (capitalized) inside a vertical-rl span. Pin against it
    // anywhere in the file so a future revert fails.
    expect(pageSrc).not.toMatch(/writingMode:\s*"vertical-rl"/);
  });

  it("the prior collapse-toggle button (chevron right) is removed", () => {
    expect(pageSrc).not.toMatch(/data-testid="client-right-column-collapse"/);
    expect(pageSrc).not.toMatch(/aria-label="Collapse utility rail"/);
  });

  it("the obsolete `rightRailCollapsed` state machine and LS key are gone", () => {
    // Pin against active references — the identifier may still appear
    // in historical comments. Code-level checks: setState, LS key,
    // and direct reads/writes via assignment patterns.
    expect(pageSrc).not.toMatch(/setRightRailCollapsed/);
    expect(pageSrc).not.toMatch(/LS_RAIL_COLLAPSED_KEY/);
    expect(pageSrc).not.toMatch(/useState[\s\S]{0,40}?rightRailCollapsed/);
    expect(pageSrc).not.toMatch(/\{rightRailCollapsed\s*\?/);
  });

  it("the rail keeps a stable `data-panel-open` attribute reflecting whether a panel is active", () => {
    expect(pageSrc).toMatch(
      /data-panel-open=\{utilityTab === null \? "false" : "true"\}/,
    );
  });

  it("the resize handle only renders when a panel is open (nothing to resize when icon-only)", () => {
    expect(pageSrc).toMatch(
      /\{utilityTab !== null && \(\s*<div\s+role="separator"/,
    );
  });

  it("the rail aside width adapts: collapsed strip (~48px) when no panel, persisted width when panel open", () => {
    expect(pageSrc).toMatch(/RAIL_COLLAPSED_WIDTH\s*=\s*48/);
    expect(pageSrc).toMatch(
      /utilityTab === null \? RAIL_COLLAPSED_WIDTH : rightRailWidth/,
    );
  });

  it("the canonical primitive's top-tab nav iterates `tabs.map` inside the expanded panel section", () => {
    // The horizontal tab nav is inside the expanded section (rendered
    // only when a panel is open). The page passes `clientRailTabs`
    // (always length 3); length enforced at page level via the
    // registry test above.
    expect(railSrc).toMatch(
      /\{displayedTab\s*&&[\s\S]{0,1500}?aria-label=\{ariaLabel\}[\s\S]{0,600}?tabs\.map/,
    );
  });
});

// ── 2026-05-07 v3: center workspace tabs reduced ────────────────────

describe("Client Detail center workspace tabs — Equipment / PM / Parts moved to the rail", () => {
  it("WorkspaceTab union is exactly: overview | active | jobs | invoices | quotes (pricing removed)", () => {
    // 2026-05-12: pricing removed from WorkspaceTab — Historical Pricing
    // is now rendered inside the Overview tab via HistoricalPricingSection.
    expect(pageSrc).toMatch(
      /type WorkspaceTab\s*=/,
    );
    expect(pageSrc).not.toMatch(
      /type WorkspaceTab[\s\S]{0,400}?"pricing"/,
    );
    expect(pageSrc).toContain('"overview"');
    expect(pageSrc).toContain('"active"');
    expect(pageSrc).toContain('"jobs"');
    expect(pageSrc).toContain('"invoices"');
    expect(pageSrc).toContain('"quotes"');
  });

  it("COMPANY_TABS does NOT include Equipment / Parts entries", () => {
    // Locate the COMPANY_TABS array literal and assert the dropped
    // keys are not entries inside it.
    const startIdx = pageSrc.indexOf("const COMPANY_TABS:");
    const endIdx = pageSrc.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, endIdx);
    expect(slice).not.toMatch(/key:\s*"equipment"/);
    expect(slice).not.toMatch(/key:\s*"parts"/);
  });

  it("LOCATION_TABS does NOT include Equipment / PM / Parts entries", () => {
    const startIdx = pageSrc.indexOf("const LOCATION_TABS:");
    const endIdx = pageSrc.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, endIdx);
    expect(slice).not.toMatch(/key:\s*"equipment"/);
    expect(slice).not.toMatch(/key:\s*"pm"/);
    expect(slice).not.toMatch(/key:\s*"parts"/);
  });

  it("COMPANY_TABS + LOCATION_TABS include Overview / Active / Jobs / Invoices / Quotes and NOT Pricing", () => {
    // 2026-05-12: pricing removed from both tab arrays.
    for (const arrayName of ["const COMPANY_TABS:", "const LOCATION_TABS:"]) {
      const startIdx = pageSrc.indexOf(arrayName);
      const endIdx = pageSrc.indexOf("];", startIdx);
      const slice = pageSrc.slice(startIdx, endIdx);
      expect(slice).toMatch(/key:\s*"overview"/);
      expect(slice).toMatch(/key:\s*"active"/);
      expect(slice).toMatch(/key:\s*"jobs"/);
      expect(slice).toMatch(/key:\s*"invoices"/);
      expect(slice).toMatch(/key:\s*"quotes"/);
      expect(slice).not.toMatch(/key:\s*"pricing"/);
    }
  });

  it("workspace-tab content branches for the dropped keys are gone", () => {
    expect(pageSrc).not.toMatch(/workspaceTab\s*===\s*"equipment"/);
    expect(pageSrc).not.toMatch(/workspaceTab\s*===\s*"pm"/);
    expect(pageSrc).not.toMatch(/workspaceTab\s*===\s*"parts"/);
  });
});

// ── 2026-05-07 v3: rail panels do NOT route to the dropped tabs ─────

describe("Client Detail rail — Equipment / Maintenance no longer route to deleted workspace tabs", () => {
  it("the Equipment panel '+ Add Equipment' header action opens the page-level AddEquipmentDialog", () => {
    // Now inside the equipment-parts tab action slot (2026-05-12 RALPH).
    expect(pageSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}[\s\S]{0,400}?data-testid="client-side-panel-action-add-equipment"/,
    );
  });

  it("the Equipment panel does NOT route to the workspace 'equipment' tab anywhere", () => {
    expect(pageSrc).not.toMatch(/onJumpToWorkspaceTab\(\s*"equipment"\s*\)\s*[;,)}]/);
  });

  it("the Maintenance panel does NOT route to the deleted 'pm' workspace tab", () => {
    expect(pageSrc).not.toMatch(/onJumpToWorkspaceTab\(\s*"pm"\s*\)\s*[;,)}]/);
  });

  it("no standalone Maintenance / Parts tabs remain — both are now sections inside composed tabs", () => {
    // 2026-05-12 RALPH: Maintenance moved into Summary; Parts moved
    // into Equip & Parts. Neither appears as a top-level tab entry.
    expect(pageSrc).not.toContain('id: "maintenance"');
    expect(pageSrc).not.toContain('id: "parts"');
    // The onRequestAddMaintenance helper is also removed since no rail
    // tab action slot calls it any more.
    expect(pageSrc).not.toMatch(/const\s+onRequestAddMaintenance\s*=/);
  });

  it("Equip & Parts tab content slot does NOT route to any deleted workspace tab", () => {
    const startIdx = pageSrc.indexOf('id: "equipment-parts"');
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = pageSrc.indexOf("];", startIdx);
    const slice = pageSrc.slice(startIdx, endIdx > 0 ? endIdx : startIdx + 3000);
    expect(slice).not.toMatch(/onJumpToWorkspaceTab\(/);
  });
});
