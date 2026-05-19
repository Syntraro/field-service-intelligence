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
const railDescriptorsSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/clients/railDescriptors.tsx"),
  "utf-8",
);
const rendererSrc = readFileSync(
  resolve(__dirname, "../client/src/components/detail-rail/RailPanelRenderer.tsx"),
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

describe("Client Detail rail — registry of three items (2026-05-18: Equipment/Parts moved to center tabs)", () => {
  // 2026-05-18: Equipment and Parts removed from the rail. They are now
  // center workspace tabs (location-scope only). Rail is: Summary, Notes, Contacts.
  const expected = [
    { testId: "rail-item-summary", label: "Summary" },
    { testId: "rail-item-notes", label: "Notes" },
    { testId: "rail-item-contacts", label: "Contacts" },
  ];

  for (const item of expected) {
    it(`registers the "${item.label}" rail item with stable test id`, () => {
      expect(pageSrc).toContain(`testId: "${item.testId}"`);
      expect(pageSrc).toContain(`label: "${item.label}"`);
    });
  }

  it("does NOT include Equip & Parts as a rail tab (moved to center tabs)", () => {
    expect(pageSrc).not.toMatch(/testId:\s*"rail-item-equipment-parts"/);
    expect(pageSrc).not.toContain('label: "Equip & Parts"');
  });

  it("does NOT include standalone Billing / Equipment / Parts / Maintenance / Activity tabs", () => {
    for (const id of ["billing", "equipment", "parts", "maintenance", "activity"]) {
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

  it("active rail item carries aria-pressed + canonical green accent", () => {
    expect(railSrc).toMatch(/aria-pressed=\{isActive\}/);
    // Active item uses bg-[#76B054]/10 highlight (top-tab layout).
    expect(railSrc).toMatch(/isActive[\s\S]{0,200}?bg-\[#76B054\]/);
  });

  it("each panel header carries a stable per-panel test id (from displayedTab)", () => {
    expect(railSrc).toMatch(/data-testid=\{`\$\{testIdPrefix\}-panel-header-\$\{displayedTab\.id\}`\}/);
  });
});

describe("Client Detail panel header actions — per-tab action slots", () => {
  it("Notes panel header has '+ Add Note' action with stable testId", () => {
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-note"/);
  });

  it("Summary panel header has no action slot (billing is read-only in the rail)", () => {
    // Summary is purely informational — no edit-billing action button in the
    // rail header. Edit Client is in the page overflow menu, not a rail action.
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-edit-billing"/);
  });

  it("Contacts panel header has '+ Add Contact' action", () => {
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-contact"/);
  });

  it("no Equip & Parts rail action testIds remain (add triggers now live in center tabs)", () => {
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-add-equipment"/);
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-add-part"/);
    expect(pageSrc).not.toContain('id: "equipment-parts"');
  });

  it("no standalone Maintenance / Activity action testIds remain", () => {
    expect(pageSrc).not.toMatch(/data-testid="client-side-panel-action-add-maintenance"/);
  });
});

// ── Contacts: standalone rail tab (re-added 2026-05-14) ─────────────

describe("Client Detail Contacts — standalone rail tab", () => {
  it("contacts tab exists in clientRailTabs with stable ids", () => {
    expect(pageSrc).toContain('id: "contacts"');
    expect(pageSrc).toContain('testId: "rail-item-contacts"');
  });

  it("contacts panel body never renders 'Primary Contacts' or 'Other Contacts' section headers", () => {
    expect(pageSrc).not.toMatch(/Primary\s+Contacts/);
    expect(pageSrc).not.toMatch(/Other\s+Contacts/);
  });

  it("Contacts panel header has '+ Add Contact' action with stable testId", () => {
    expect(pageSrc).toMatch(/data-testid="client-side-panel-action-add-contact"/);
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
    expect(railDescriptorsSrc).toMatch(/label:\s*"Payment terms"/);
    expect(railDescriptorsSrc).toMatch(/label:\s*"Outstanding"/);
    expect(railDescriptorsSrc).toMatch(/label:\s*"Lifetime revenue"/);
    expect(railDescriptorsSrc).toMatch(/Billing address/);
  });

  it("'Use company default' label maps to NULL paymentTermsDays", () => {
    expect(railDescriptorsSrc).toMatch(
      /paymentTermsDays\s*===\s*null[\s\S]{0,80}?Use company default/,
    );
  });
});

// ── Equipment center tab: real data ─────────────────────────────────

describe("Client Detail Equipment center tab — moved from rail to center workspace", () => {
  it("Equipment is a location-scope center workspace tab (not a rail panel)", () => {
    expect(pageSrc).toMatch(/workspaceTab\s*===\s*"equipment"/);
    expect(pageSrc).toMatch(/<ClientEquipmentTab/);
    expect(pageSrc).not.toMatch(/id:\s*"equipment-parts"/);
  });

  it("the canonical EquipmentDetailModal is mounted at the page level", () => {
    expect(pageSrc).toMatch(
      /import\s+\{\s*EquipmentDetailModal\s*\}\s+from\s+"@\/components\/EquipmentDetailModal"/,
    );
    expect(pageSrc).toMatch(
      /<EquipmentDetailModal[\s\S]{0,400}?equipment=\{detailEquipment\}/,
    );
  });

  it("Add Equipment wires directly to the page-level AddEquipmentDialog via center tab onAdd prop", () => {
    expect(pageSrc).toMatch(/onAdd=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}/);
  });

  it("does NOT introduce rail-style equipment panel body or descriptor functions", () => {
    expect(pageSrc).not.toMatch(/function\s+buildClientEquipmentPanelDescriptor/);
    expect(pageSrc).not.toMatch(/function\s+ClientEquipmentPanelBody/);
    expect(pageSrc).not.toMatch(/function\s+ClientEquipmentPartsPanelBody/);
  });
});

// ── Parts center tab: real data ─────────────────────────────────────

describe("Client Detail Parts center tab — moved from rail to center workspace", () => {
  it("Parts is a location-scope center workspace tab (not a rail panel)", () => {
    expect(pageSrc).toMatch(/workspaceTab\s*===\s*"parts"/);
    expect(pageSrc).toMatch(/<ClientPartsTab/);
  });

  it("Parts tab receives onManage prop wired to PartsSelectorModal", () => {
    expect(pageSrc).toMatch(/onManage=\{\(\)\s*=>\s*setPartsModalOpen\(true\)\}/);
    expect(pageSrc).toMatch(/<PartsSelectorModal/);
  });

  it("does NOT introduce a duplicate parts editor or a fake client-specific parts model", () => {
    expect(pageSrc).not.toMatch(/queryKey:\s*\[\s*["']\/api\/client-parts["']/);
    expect(pageSrc).not.toMatch(/apiRequest\(\s*["']\/api\/client-parts/);
    expect(pageSrc).not.toMatch(/function\s+buildClientPartsPanelDescriptor/);
    expect(pageSrc).not.toMatch(/function\s+ClientPartsPanelBody/);
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

  it("descriptor builder renders the canonical empty-state copy", () => {
    // buildClientMaintenancePanelDescriptor lives in railDescriptors.tsx.
    expect(railDescriptorsSrc).toMatch(/No maintenance plans yet\./);
    expect(railDescriptorsSrc).toMatch(
      /Add a maintenance plan to schedule recurring service for this client\./,
    );
  });

  it("each plan row has a stable test id", () => {
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-card"/);
  });

  it("the card descriptor is NOT clickable (no onClick — only an explicit footer link navigates)", () => {
    // Descriptor cards without onClick render as static divs in RailPanelRenderer.
    // The footer link is the sole navigation affordance.
    const startIdx = railDescriptorsSrc.indexOf('"client-maintenance-card"');
    expect(startIdx).toBeGreaterThan(-1);
    // No onClick on the card itself
    const cardSlice = railDescriptorsSrc.slice(startIdx, startIdx + 1500);
    expect(cardSlice).not.toMatch(/onClick:[\s\S]{0,200}?testId:\s*"client-maintenance-card"/);
  });

  it("each card carries an explicit 'View / Edit in Maintenance' footer link to /pm/:id", () => {
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-card-action"/);
    expect(railDescriptorsSrc).toMatch(/href:\s*`\/pm\/\$\{t\.id\}`/);
    expect(railDescriptorsSrc).toMatch(/View \/ Edit in Maintenance/);
  });

  it("the footer link carries an accessible ariaLabel + title", () => {
    expect(railDescriptorsSrc).toMatch(
      /ariaLabel:\s*`View or edit maintenance plan \$\{t\.title\}`/,
    );
    expect(railDescriptorsSrc).toMatch(/title:\s*"View \/ Edit in Maintenance"/);
  });

  it("the panel body uses semantic ul/li markup via RailPanelRenderer", () => {
    // HTML structure lives in RailPanelRenderer; descriptor supplies the testId.
    expect(rendererSrc).toMatch(/<ul[\s\S]{0,100}?data-testid=\{panel\.testId\}/);
    expect(rendererSrc).toMatch(/<li\s+key=\{card\.key\}/);
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-panel-body"/);
  });

  it("renders status chip (Active/Paused) on every card via descriptor chip field", () => {
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-card-status"/);
    expect(railDescriptorsSrc).toMatch(/\?\s*"Active"\s*:\s*"Paused"/);
  });

  it("renders information-rich snapshot fields when data is present (Frequency / Next due / Started / Window / Billing / Location)", () => {
    for (const label of ["Frequency", "Next due", "Started", "Window", "Billing", "Location"]) {
      expect(railDescriptorsSrc).toContain(`label: "${label}"`);
    }
  });

  // ── Typography: rendering lives in RailPanelRenderer ─────────────

  it("uses canonical typography role tokens — RailPanelRenderer owns the card chrome", () => {
    // Canonical tokens (text-header, text-row, text-label) are in the renderer;
    // the descriptor supplies data only. Verify no raw tiny-text classes in renderer.
    expect(rendererSrc).not.toMatch(/text-\[10px\]/);
    expect(rendererSrc).not.toMatch(/text-\[11px\]/);
    // Renderer uses canonical size tokens, not raw text-xs
    expect(rendererSrc).toMatch(/text-header|text-row|text-label/);
  });

  it("card title is rendered with text-header token by RailPanelRenderer", () => {
    expect(rendererSrc).toMatch(/text-header/);
  });

  it("status chip uses canonical chip variant field from the descriptor", () => {
    // variant "success" → green chip; variant "neutral" → grey chip.
    expect(railDescriptorsSrc).toMatch(/variant:\s*t\.isActive\s*\?\s*"success"\s*:\s*"neutral"/);
  });

  it("snapshot row labels use text-label via RailPanelRenderer", () => {
    expect(rendererSrc).toMatch(/text-label/);
  });

  it("snapshot row values use text-row via RailPanelRenderer", () => {
    expect(rendererSrc).toMatch(/text-row/);
  });

  it("Location value allows 2-line wrap (line-clamp-2) in the descriptor valueClassName", () => {
    // valueClassName comes before testId in the field object
    expect(railDescriptorsSrc).toMatch(
      /line-clamp-2[\s\S]{0,100}?testId:\s*"client-maintenance-card-row-location"/,
    );
    const locStart = railDescriptorsSrc.indexOf('"client-maintenance-card-row-location"');
    expect(locStart).toBeGreaterThan(-1);
    const locSlice = railDescriptorsSrc.slice(Math.max(0, locStart - 200), locStart + 200);
    expect(locSlice).not.toMatch(/\btruncate\b/);
  });

  it("optional description body is passed in the descriptor's body field", () => {
    expect(railDescriptorsSrc).toMatch(/body:\s*description\s*\?\?\s*undefined/);
    expect(railDescriptorsSrc).toMatch(/bodyClamp:\s*description\s*\?\s*3\s*:\s*undefined/);
  });

  it("snapshot rows are stacked label-above-value (no 2-column grid in descriptor or renderer)", () => {
    expect(railDescriptorsSrc).not.toMatch(/grid-cols-\[max-content_1fr\]/);
    expect(railDescriptorsSrc).not.toMatch(/grid grid-cols-\[/);
    expect(rendererSrc).not.toMatch(/grid-cols-\[max-content_1fr\]/);
  });

  it("renderer does not use ad-hoc fixed row spacing overrides on the maintenance card", () => {
    // RailPanelRenderer uses `space-y-2` (compact) or `space-y-3` (normal)
    // — not a custom space-y-2.5 per-card override.
    expect(rendererSrc).toMatch(/space-y-2|space-y-3/);
  });

  it("footer link is rendered via the descriptor's footer kind=link field", () => {
    expect(railDescriptorsSrc).toMatch(/kind:\s*"link"/);
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-card-action"/);
    // Link footer and action testId both exist in the same card descriptor
    const cardStart = railDescriptorsSrc.indexOf('"client-maintenance-card"');
    expect(cardStart).toBeGreaterThan(-1);
    const cardSlice = railDescriptorsSrc.slice(cardStart, cardStart + 1000);
    expect(cardSlice).toMatch(/kind:\s*"link"/);
    expect(cardSlice).toMatch(/testId:\s*"client-maintenance-card-action"/);
  });

  it("Next due value carries a stable test id in the descriptor", () => {
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-maintenance-card-row-next-due"/);
  });

  it("does NOT invent fields the API doesn't return (no equipment list, no generated-job count)", () => {
    const startIdx = railDescriptorsSrc.indexOf('"client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const slice = railDescriptorsSrc.slice(startIdx, startIdx + 4000);
    expect(slice).not.toMatch(/label:\s*"Equipment"/);
    expect(slice).not.toMatch(/Linked equipment/);
    expect(slice).not.toMatch(/Generated work/);
    expect(slice).not.toMatch(/Jobs generated/);
  });

  it("no inline modal editor was introduced for plan cards", () => {
    const startIdx = railDescriptorsSrc.indexOf('"client-maintenance-panel-body"');
    expect(startIdx).toBeGreaterThan(-1);
    const slice = railDescriptorsSrc.slice(startIdx, startIdx + 4000);
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

  it("descriptor builder renders the canonical empty-state copy ('No activity yet.')", () => {
    // buildClientActivityPanelDescriptor lives in railDescriptors.tsx.
    expect(railDescriptorsSrc).toMatch(/No activity yet\./);
  });

  it("each activity row has a stable test id in the descriptor", () => {
    expect(railDescriptorsSrc).toMatch(/testId:\s*"client-activity-row"/);
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
    expect(pageSrc).toMatch(/onOpen=\{\(eq\)\s*=>\s*setDetailEquipment\(eq\)\}/);
    expect(pageSrc).toMatch(/scopeType=\{scopeType\}/);
    expect(pageSrc).toMatch(/billing=\{billingPanelData\}/);
  });

  it("Add Equipment / Add Part actions wire directly to their setters via center tab props", () => {
    expect(pageSrc).toMatch(/onAdd=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}/);
    expect(pageSrc).toMatch(/onManage=\{\(\)\s*=>\s*setPartsModalOpen\(true\)\}/);
    // Edit Client is in the overflow ActionMenu (onSelect), not a dedicated onClick button
    expect(pageSrc).toMatch(/setEditClientDialogOpen\(true\)/);
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

// ── 2026-05-18: center workspace tabs — Equipment & Parts in LOCATION_TABS ──

describe("Client Detail center workspace tabs — Equipment & Parts are location-scope center tabs", () => {
  it("WorkspaceTab union includes equipment and parts", () => {
    expect(pageSrc).toMatch(/type WorkspaceTab\s*=/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"equipment"/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"parts"/);
    expect(pageSrc).not.toMatch(/type WorkspaceTab[\s\S]{0,400}?"pricing"/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"overview"/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"jobs"/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"invoices"/);
    expect(pageSrc).toMatch(/type WorkspaceTab[\s\S]{0,400}?"quotes"/);
  });

  it("COMPANY_TABS does NOT include Equipment / Parts entries", () => {
    const startIdx = pageSrc.indexOf("const COMPANY_TABS:");
    const endIdx = pageSrc.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, endIdx);
    expect(slice).not.toMatch(/key:\s*"equipment"/);
    expect(slice).not.toMatch(/key:\s*"parts"/);
  });

  it("LOCATION_TABS includes Equipment and Parts entries", () => {
    const startIdx = pageSrc.indexOf("const LOCATION_TABS:");
    const endIdx = pageSrc.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = pageSrc.slice(startIdx, endIdx);
    expect(slice).toMatch(/key:\s*"equipment"/);
    expect(slice).toMatch(/key:\s*"parts"/);
    expect(slice).not.toMatch(/key:\s*"pm"/);
  });

  it("COMPANY_TABS + LOCATION_TABS include Overview / Jobs / Invoices / Quotes / Payments and NOT Pricing", () => {
    for (const arrayName of ["const COMPANY_TABS:", "const LOCATION_TABS:"]) {
      const startIdx = pageSrc.indexOf(arrayName);
      const endIdx = pageSrc.indexOf("];", startIdx);
      const slice = pageSrc.slice(startIdx, endIdx);
      expect(slice).toMatch(/key:\s*"overview"/);
      expect(slice).toMatch(/key:\s*"jobs"/);
      expect(slice).toMatch(/key:\s*"invoices"/);
      expect(slice).toMatch(/key:\s*"quotes"/);
      expect(slice).toMatch(/key:\s*"payments"/);
      expect(slice).not.toMatch(/key:\s*"pricing"/);
    }
  });

  it("workspace-tab content branches exist for equipment and parts", () => {
    expect(pageSrc).toMatch(/workspaceTab\s*===\s*"equipment"/);
    expect(pageSrc).toMatch(/workspaceTab\s*===\s*"parts"/);
    expect(pageSrc).not.toMatch(/workspaceTab\s*===\s*"pm"/);
  });
});

// ── 2026-05-18: Equipment & Parts center tab wiring ─────────────────

describe("Client Detail center tabs — Equipment & Parts action wiring", () => {
  it("Add Equipment action wires to setEquipmentModalOpen from the center tab", () => {
    expect(pageSrc).toMatch(/onAdd=\{\(\)\s*=>\s*setEquipmentModalOpen\(true\)\}/);
  });

  it("Parts tab receives onManage prop wired to setPartsModalOpen", () => {
    expect(pageSrc).toMatch(/onManage=\{\(\)\s*=>\s*setPartsModalOpen\(true\)\}/);
  });

  it("equipment-parts is NOT a rail tab id", () => {
    expect(pageSrc).not.toContain('id: "equipment-parts"');
  });

  it("no standalone Maintenance / PM tab remains", () => {
    expect(pageSrc).not.toContain('id: "maintenance"');
    expect(pageSrc).not.toMatch(/const\s+onRequestAddMaintenance\s*=/);
  });

  it("no onJumpToWorkspaceTab calls remain (routing via tab bar, not rail)", () => {
    expect(pageSrc).not.toMatch(/onJumpToWorkspaceTab\(/);
  });
});
