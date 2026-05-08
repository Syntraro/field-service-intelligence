/**
 * Rail card adoption — Notes + Contacts.
 *
 * Originally (2026-05-07 RALPH) this file pinned per-note rendering
 * through `<RailContentCard>` inside the now-retired
 * `client/src/components/NotesPanel.tsx`. The 2026-05-08 Tier 4 Notes
 * canonicalization absorbed `NotesPanel` into the canonical
 * `<EntityNotesPanel>` (`client/src/components/notes/EntityNotesPanel.tsx`).
 * The pins below now target the canonical panel; the
 * ContactCard descriptor pin retains its prior shape because the
 * Phase 6 migration is unaffected.
 *
 * Inverse pins are intentionally aggressive — they ban the exact
 * old class strings so a future refactor can't silently regress
 * back to ad-hoc card chrome inside a rail panel.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const ENTITY_NOTES_PANEL = resolve(
  ROOT,
  "client/src/components/notes/EntityNotesPanel.tsx",
);
const CLIENT_PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const PRIMITIVE = resolve(
  ROOT,
  "client/src/components/detail-rail/RailContentCard.tsx",
);

const notesSrc = readFileSync(ENTITY_NOTES_PANEL, "utf-8");
const clientSrc = readFileSync(CLIENT_PAGE, "utf-8");
const primitiveSrc = readFileSync(PRIMITIVE, "utf-8");

// ── 1. EntityNotesPanel — per-note row uses RailContentCard ────────

describe("EntityNotesPanel — per-note row uses RailContentCard", () => {
  it("imports the canonical RailContentCard primitive (and slot primitives)", () => {
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
    expect(notesSrc).not.toMatch(
      /className="px-3 py-2\.5 border border-slate-200 border-l-2 border-l-slate-300 rounded-md text-sm overflow-hidden group"/,
    );
    expect(notesSrc).not.toMatch(/className="[^"]*border-l-2 border-l-slate-300/);
  });

  it("note body uses canonical `<RailContentCardBody>` slot (no inline `text-xs` body class)", () => {
    expect(notesSrc).toMatch(
      /<RailContentCardBody>\{note\.noteText\}<\/RailContentCardBody>/,
    );
    expect(notesSrc).not.toMatch(
      /<p[^>]*className="[^"]*\btext-xs leading-relaxed\b/,
    );
  });

  it("note meta + actions live inside `<RailContentCardFooter>` (no raw `text-[11px]` line)", () => {
    expect(notesSrc).toMatch(/<RailContentCardFooter>/);
    expect(notesSrc).not.toMatch(/mt-3\s+text-\[11px\]/);
  });

  it("visibility chips render via the canonical `<EntityChip>` (Jobs / Invoices / Quotes)", () => {
    // 2026-05-08 chip canonicalization preserved — the visibility
    // pills are `<EntityChip entity="job|invoice|quote" size="compact">`,
    // not the prior `<RailContentCardChip>` slot. Inverse pin still
    // forbids the legacy inline span chrome.
    expect(notesSrc).toMatch(
      /<EntityChip\s+entity="job"\s+size="compact">Jobs<\/EntityChip>/,
    );
    expect(notesSrc).toMatch(
      /<EntityChip\s+entity="invoice"\s+size="compact">Invoices<\/EntityChip>/,
    );
    expect(notesSrc).toMatch(
      /<EntityChip\s+entity="quote"\s+size="compact">Quotes<\/EntityChip>/,
    );
    expect(notesSrc).not.toMatch(
      /<span\s+className="text-xs px-1\.5 py-0\.5 rounded bg-blue-50 text-blue-700">/,
    );
  });

  it("preserves the inline edit + delete actions inside the card", () => {
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
