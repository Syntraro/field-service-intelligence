/**
 * Rail card adoption — Notes + Contacts (2026-05-07 RALPH).
 *
 * Pins the final two surfaces that hadn't yet been migrated to the
 * canonical `<RailContentCard>` primitive:
 *
 *   1. `client/src/components/NotesPanel.tsx` — every note row in the
 *      Client Detail Notes rail panel renders inside a `<RailContentCard>`
 *      (was an ad-hoc `<div>` with a left accent-bar border).
 *   2. `client/src/pages/ClientDetailPage.tsx::ContactCard` — both the
 *      clickable (button) and read-only (div) variants render inside a
 *      `<RailContentCard>` (was a hand-rolled `<button>` / `<div>`
 *      with `text-xs px-2 py-1.5 border border-slate-200 rounded-md`).
 *
 * Together with the existing `client-rail-cards.test.ts` pins for the
 * Activity / Equipment / Parts / Maintenance / Billing panels, this
 * means every Client Detail rail panel — and the cross-page Notes
 * surface — now displays one canonical card chrome.
 *
 * Inverse pins are intentionally aggressive — they ban the exact
 * old class strings so a future refactor can't silently regress
 * back to ad-hoc card chrome inside a rail panel.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const NOTES_PANEL = resolve(ROOT, "client/src/components/NotesPanel.tsx");
const CLIENT_PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/RailContentCard.tsx",
);

const notesSrc = readFileSync(NOTES_PANEL, "utf-8");
const clientSrc = readFileSync(CLIENT_PAGE, "utf-8");
const primitiveSrc = readFileSync(PRIMITIVE, "utf-8");

// ── 1. NotesPanel — per-note row uses RailContentCard ──────────────

describe("NotesPanel — per-note row uses RailContentCard", () => {
  it("imports the canonical RailContentCard primitive (and slot primitives)", () => {
    // 2026-05-07 v3 — multi-line import that pulls in slot primitives.
    expect(notesSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCard\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("renders each note inside a `<RailContentCard>` with the per-note testid", () => {
    expect(notesSrc).toMatch(
      /<RailContentCard\s+key=\{note\.id\}\s+testId=\{`note-\$\{note\.id\}`\}/,
    );
  });

  it("does NOT use the old ad-hoc per-note `<div>` chrome (left accent-bar border)", () => {
    // The bug-shaped string from before the migration. If this ever
    // reappears it means a future refactor put per-note styling back
    // into NotesPanel instead of routing through the primitive.
    expect(notesSrc).not.toMatch(
      /className="px-3 py-2\.5 border border-slate-200 border-l-2 border-l-slate-300 rounded-md text-sm overflow-hidden group"/,
    );
    // The accent-bar border classes never appear inside a className
    // attribute (they may still appear in the migration comment that
    // documents what was removed — that's a string in a comment, not
    // styling).
    expect(notesSrc).not.toMatch(/className="[^"]*border-l-2 border-l-slate-300/);
  });

  it("note body uses canonical `<RailContentCardBody>` slot (no inline `text-xs` body class)", () => {
    // 2026-05-07 v3 — body typography is baked into the slot.
    // Anchor on the body slot rendering `note.noteText`.
    expect(notesSrc).toMatch(
      /<RailContentCardBody>\{note\.noteText\}<\/RailContentCardBody>/,
    );
    // Inverse pin — the old hand-rolled body paragraph with raw
    // `text-xs leading-relaxed` is gone.
    expect(notesSrc).not.toMatch(
      /<p[^>]*className="[^"]*\btext-xs leading-relaxed\b/,
    );
  });

  it("note meta + actions live inside `<RailContentCardFooter>` (no raw `text-[11px]` line)", () => {
    expect(notesSrc).toMatch(/<RailContentCardFooter>/);
    // Inverse pin — the old hand-rolled meta footer is gone.
    expect(notesSrc).not.toMatch(/mt-3\s+text-\[11px\]/);
  });

  it("visibility chips use `<RailContentCardChip>` slot (Jobs / Invoices / Quotes variants)", () => {
    expect(notesSrc).toMatch(
      /<RailContentCardChip\s+variant="info">Jobs<\/RailContentCardChip>/,
    );
    expect(notesSrc).toMatch(
      /<RailContentCardChip\s+variant="success">Invoices<\/RailContentCardChip>/,
    );
    expect(notesSrc).toMatch(
      /<RailContentCardChip\s+variant="purple">Quotes<\/RailContentCardChip>/,
    );
    // Inverse pin — old hand-rolled chip strings (`bg-blue-50
    // text-blue-700`, etc.) are gone from the read-view branch.
    expect(notesSrc).not.toMatch(
      /<span\s+className="text-xs px-1\.5 py-0\.5 rounded bg-blue-50 text-blue-700">/,
    );
  });

  it("preserves the inline edit + delete actions inside the card", () => {
    // The migration must not break the per-row action buttons —
    // they still need their data-testids so admin tests can target
    // them.
    expect(notesSrc).toMatch(/data-testid=\{`button-edit-note-\$\{note\.id\}`\}/);
    expect(notesSrc).toMatch(/data-testid=\{`button-delete-note-\$\{note\.id\}`\}/);
  });
});

// ── 2. ClientDetailPage::ContactCard — Phase 6 migration ────────────
//
// 2026-05-07 Phase 6 — ContactCard migrated to the data-driven
// renderer. Inline-slot pins for ContactCard moved to
// `tests/client-rail-contacts-descriptor.test.ts`. The three pins
// retained below enforce the page-level inverse-import contract
// + a sanity check that the descriptor builder + thin body wrapper
// exist in source.

describe("ClientDetailPage::ContactCard — data-driven mount (Phase 6)", () => {
  it("ContactCard mounts via `<RailPanelRenderer>` with a `kind: \"single\"` descriptor", () => {
    expect(clientSrc).toMatch(
      /function ContactCard[\s\S]{0,800}?<RailPanelRenderer/,
    );
    expect(clientSrc).toMatch(
      /function buildClientContactDescriptor\(/,
    );
    expect(clientSrc).toMatch(
      /panel=\{\{[\s\S]{0,200}?kind:\s*"single"/,
    );
  });

  it("page no longer imports any `RailContentCard*` slot primitive (last in-page slot caller retired)", () => {
    expect(clientSrc).not.toMatch(
      /from\s+["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("the descriptor builder forwards the per-edit ariaLabel + the contact onClick callback", () => {
    // The `onClick: () => onEdit(contact)` + `ariaLabel: \`Edit contact ${nc.displayName}\``
    // contract moves into `buildClientContactDescriptor`. Pinned in
    // detail by `tests/client-rail-contacts-descriptor.test.ts`; this
    // sanity pin guards against regression at the page layer.
    expect(clientSrc).toMatch(
      /onClick:\s*onEdit\s*\?\s*\(\)\s*=>\s*onEdit\(contact\)/,
    );
    expect(clientSrc).toMatch(
      /ariaLabel:\s*onEdit\s*\?\s*`Edit contact \$\{nc\.displayName\}`/,
    );
  });
});

// ── 3. Future-proofing — primitive docstring carries the rule ──────

describe("RailContentCard — docstring documents the right-rail rule", () => {
  it("primitive docstring tells future contributors to use it for every right-rail card", () => {
    // The exact phrasing isn't load-bearing — what we pin is that
    // the docstring covers the cross-page reuse contract: Client +
    // Job rails today, Invoice / Quote / Lead rails when they ship.
    expect(primitiveSrc).toMatch(/right-rail/i);
    expect(primitiveSrc).toMatch(/Client Detail/);
    expect(primitiveSrc).toMatch(/Job Detail/);
    // At least one of the future detail-page surfaces is named so
    // the rule is clearly forward-looking.
    expect(primitiveSrc).toMatch(/Invoice|Quote|Lead/);
  });
});
