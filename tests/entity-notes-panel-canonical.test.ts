/**
 * Canonical Notes orchestration — adoption + architectural pins
 * (2026-05-08 Tier 4).
 *
 * `EntityNotesPanel` (`client/src/components/notes/EntityNotesPanel.tsx`)
 * is the canonical orchestration component for every notes UI in the
 * app. It absorbs the prior `EntityNotesSection` (entity-owned notes:
 * job / invoice / quote / lead) and `NotesPanel` (client-scoped notes:
 * customer-company / location). This file pins:
 *
 *   1. Every page that renders notes mounts `<EntityNotesPanel>` —
 *      no consumer falls back to a per-page custom card.
 *   2. The retired `EntityNotesSection` and `NotesPanel` source files
 *      are gone (no leftover JSX usage anywhere in `client/src/`).
 *   3. EntityNotesPanel does NOT route notes through the data-driven
 *      `RailPanelRenderer` descriptor model — Notes is the documented
 *      exception (slot composition only).
 *   4. The canonical attachment lifecycle (`useFileUpload`) and the
 *      shared dialog (`EntityNoteDialog`) stay reused — no per-
 *      surface upload or modal logic.
 *   5. Each canonical mount carries the right entity-type contract
 *      (the six discriminants `job` / `invoice` / `quote` / `lead` /
 *      `location` / `company`).
 *   6. Per-row rendering routes through `<RailContentCard>` slot
 *      primitives — visibility chips through `<EntityChip>`.
 *
 * Inverse pins are aggressive — a future refactor that reintroduces
 * legacy chrome, the imperative `notesRef` handle, or the descriptor
 * model for notes will fail here.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const PANEL_PATH = resolve(
  ROOT,
  "client/src/components/notes/EntityNotesPanel.tsx",
);
const DIALOG_PATH = resolve(
  ROOT,
  "client/src/components/notes/EntityNoteDialog.tsx",
);

const panelSrc = readFileSync(PANEL_PATH, "utf-8");
const dialogSrc = readFileSync(DIALOG_PATH, "utf-8");

/**
 * Strip line + block comments from a source string so inverse pins
 * (e.g. "no `<EntityNotesSection>` JSX usage") can target real code
 * without being defeated by JSX-like snippets in migration comments.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const panelCode = stripComments(panelSrc);

const PAGES: ReadonlyArray<{ label: string; path: string; entityType: string; entityIdRef: string }> = [
  {
    label: "JobDetailPage",
    path: resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
    entityType: "job",
    entityIdRef: "job\\.id",
  },
  {
    label: "InvoiceDetailPage",
    path: resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
    entityType: "invoice",
    entityIdRef: "invoiceId",
  },
  {
    label: "QuoteDetailPage",
    path: resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx"),
    entityType: "quote",
    entityIdRef: "quote\\.id",
  },
  {
    label: "LeadDetailPage",
    path: resolve(ROOT, "client/src/pages/LeadDetailPage.tsx"),
    entityType: "lead",
    entityIdRef: "lead\\.id",
  },
];

// ── 1. Adoption: every consumer mounts EntityNotesPanel ─────────────

describe("EntityNotesPanel — adoption across all detail pages", () => {
  it.each(PAGES)(
    "$label imports EntityNotesPanel from the canonical module",
    ({ path }) => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(
        /import\s*\{\s*EntityNotesPanel\s*\}\s*from\s*["']@\/components\/notes\/EntityNotesPanel["']/,
      );
    },
  );

  it.each(PAGES)(
    "$label mounts <EntityNotesPanel entityType=\"$entityType\" entityId={...}>",
    ({ path, entityType, entityIdRef }) => {
      const src = readFileSync(path, "utf-8");
      const re = new RegExp(
        `<EntityNotesPanel[\\s\\S]{0,400}?entityType="${entityType}"[\\s\\S]{0,400}?entityId=\\{${entityIdRef}\\}`,
      );
      expect(src).toMatch(re);
    },
  );

  it("ClientDetailPage mounts EntityNotesPanel for BOTH `company` and `location` scopes", () => {
    const src = readFileSync(
      resolve(ROOT, "client/src/pages/ClientDetailPage.tsx"),
      "utf-8",
    );
    expect(src).toMatch(
      /import\s*\{\s*EntityNotesPanel\s*\}\s*from\s*["']@\/components\/notes\/EntityNotesPanel["']/,
    );
    expect(src).toMatch(/<EntityNotesPanel[\s\S]{0,400}?entityType="company"/);
    expect(src).toMatch(/<EntityNotesPanel[\s\S]{0,400}?entityType="location"/);
  });
});

// ── 2. Retired files + retired primitive names are gone ─────────────

describe("Retired notes primitives — no surviving JSX usage", () => {
  it("the retired source files no longer exist", () => {
    expect(
      existsSync(
        resolve(ROOT, "client/src/components/notes/EntityNotesSection.tsx"),
      ),
    ).toBe(false);
    expect(
      existsSync(resolve(ROOT, "client/src/components/NotesPanel.tsx")),
    ).toBe(false);
  });

  it.each([...PAGES, {
    label: "ClientDetailPage",
    path: resolve(ROOT, "client/src/pages/ClientDetailPage.tsx"),
    entityType: "(unused)",
    entityIdRef: "(unused)",
  }])(
    "$label has no `<EntityNotesSection>` or `<NotesPanel>` JSX usage in code (comments allowed for migration history)",
    ({ path }) => {
      const code = stripComments(readFileSync(path, "utf-8"));
      expect(code).not.toMatch(/<EntityNotesSection\b/);
      expect(code).not.toMatch(/<NotesPanel\b/);
    },
  );
});

// ── 3. Notes does NOT use the descriptor-driven renderer ────────────

describe("EntityNotesPanel — slot composition only (Notes exception to descriptor model)", () => {
  it("does NOT import or mount RailPanelRenderer (Notes is the documented descriptor exception)", () => {
    // The renderer-comment in RailPanelRenderer.tsx explicitly carves
    // out Notes; comments here in EntityNotesPanel may reference the
    // primitive by name (panelCode strips them). What's forbidden is
    // an actual import or JSX mount in code.
    expect(panelCode).not.toMatch(/from\s+["'][^"']*RailPanelRenderer["']/);
    expect(panelCode).not.toMatch(/<RailPanelRenderer\b/);
  });

  it("does NOT import any descriptor types from railTypes", () => {
    expect(panelCode).not.toMatch(/from\s+["'][^"']*railTypes["']/);
    expect(panelCode).not.toMatch(
      /RailPanelDescriptor|RailCardDescriptor/,
    );
  });

  it("renders rows via direct `<RailContentCard>` slot composition", () => {
    expect(panelSrc).toMatch(/<RailContentCard\b/);
    expect(panelSrc).toMatch(/<RailContentCardBody\b/);
    expect(panelSrc).toMatch(/<RailContentCardFooter\b/);
  });
});

// ── 4. Existing dialog + upload reused (no per-surface forks) ───────

describe("EntityNotesPanel — preserves canonical attachment + dialog systems", () => {
  it("delegates entity-owned create/edit to the existing EntityNoteDialog", () => {
    expect(panelSrc).toMatch(
      /import\s*\{[\s\S]*?\bEntityNoteDialog\b[\s\S]*?\}\s*from\s*["']\.\/EntityNoteDialog["']/,
    );
    expect(panelSrc).toMatch(/<EntityNoteDialog\b/);
  });

  it("uploads attachments through the canonical useFileUpload hook (no bespoke upload code)", () => {
    expect(panelSrc).toMatch(
      /import\s*\{[\s\S]*?\buseFileUpload\b[\s\S]*?\}\s*from\s*["']@\/hooks\/useFileUpload["']/,
    );
    expect(panelSrc).toMatch(/uploadAttachment\(/);
    // Inverse pin — no hand-rolled fetch to /api/notes/.../attachments
    // outside of the documented detach call (DELETE only).
    expect(panelSrc).not.toMatch(
      /apiRequest\(`\/api\/notes\/[^`]+\/attachments`,\s*\{\s*method:\s*"POST"/,
    );
  });

  it("EntityNoteDialog still routes invoice writes through /api/invoices/...", () => {
    // Sanity check that the prior invoice-notes-canonical contract
    // survives the orchestration migration.
    expect(dialogSrc).toMatch(
      /entityType === "invoice"[\s\S]+?basePath:\s*`\/api\/invoices\/\$\{entityId\}\/notes`/,
    );
  });
});

// ── 5. EntityNotesType discriminant covers all six surfaces ─────────

describe("EntityNotesPanel — entity-type discriminant covers every consumer", () => {
  it("declares the canonical EntityNotesType union with all six entity types", () => {
    for (const t of [
      "job",
      "invoice",
      "quote",
      "lead",
      "location",
      "company",
    ]) {
      const re = new RegExp(`"${t}"`);
      expect(panelSrc).toMatch(re);
    }
  });

  it("dispatches client-scoped types to the inline-editor render path", () => {
    expect(panelSrc).toMatch(
      /CLIENT_SCOPED_TYPES[\s\S]{0,200}?"location"[\s\S]{0,200}?"company"/,
    );
  });

  it("resolves entity-owned read endpoints for every owned type", () => {
    expect(panelSrc).toMatch(/\/api\/jobs\/\$\{entityId\}\/notes/);
    expect(panelSrc).toMatch(/\/api\/invoices\/\$\{entityId\}\/notes/);
    expect(panelSrc).toMatch(/\/api\/quotes\/\$\{entityId\}\/notes/);
    expect(panelSrc).toMatch(/\/api\/leads\/\$\{entityId\}\/notes/);
  });

  it("resolves client-scoped endpoints for location/company", () => {
    expect(panelSrc).toMatch(/\/api\/locations\/\$\{entityId\}\/notes/);
    expect(panelSrc).toMatch(
      /\/api\/customer-companies\/\$\{entityId\}\/notes/,
    );
  });
});

// ── 6. Visibility chips render via canonical EntityChip ─────────────

describe("EntityNotesPanel — visibility chips use canonical EntityChip", () => {
  it("imports EntityChip from the canonical chip module", () => {
    expect(panelSrc).toMatch(
      /import\s*\{[^}]*\bEntityChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("renders the three visibility pills via <EntityChip> with semantic entity tones", () => {
    expect(panelSrc).toMatch(
      /<EntityChip\s+entity="job"[\s\S]*?Jobs\s*<\/EntityChip>/,
    );
    expect(panelSrc).toMatch(
      /<EntityChip\s+entity="invoice"[\s\S]*?Invoices\s*<\/EntityChip>/,
    );
    expect(panelSrc).toMatch(
      /<EntityChip\s+entity="quote"[\s\S]*?Quotes\s*<\/EntityChip>/,
    );
  });
});

// ── 7. Create-success UX: no redundant toast, modal closes ──────────

describe("EntityNoteDialog — create-success UX (no redundant toast)", () => {
  it('does not fire a "Note added" success toast on create', () => {
    // Note appears in the rail immediately; a toast is redundant noise.
    expect(dialogSrc).not.toMatch(/title:\s*["']Note added["']/);
  });

  it("calls onOpenChange(false) in the success path so the modal closes automatically", () => {
    expect(dialogSrc).toMatch(/onOpenChange\(false\)/);
  });

  it("still fires a toast for edit-mode saves", () => {
    // Silent edits are hard to confirm; keep the "Note updated" toast.
    expect(dialogSrc).toMatch(/title:\s*["']Note updated["']/);
  });
});

// ── 8. Page-level rail tab descriptors own title / count / +Add ─────

describe("Notes rail tab descriptors own title + count + +Add (panel never owns chrome)", () => {
  it.each(PAGES)(
    "$label feeds notesAddSignal into EntityNotesPanel.openAddNoteSignal",
    ({ path }) => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
      expect(src).toMatch(
        /<EntityNotesPanel[\s\S]{0,800}?openAddNoteSignal=\{notesAddSignal\}/,
      );
    },
  );

  it.each(PAGES)(
    "$label uses the canonical RAIL_HEADER_ACTION_CLASS on the Notes +Add button",
    ({ path }) => {
      const src = readFileSync(path, "utf-8");
      // The +Add button must reference the canonical structural
      // class string — keeps the action affordance identical across
      // every detail page.
      expect(src).toMatch(/RAIL_HEADER_ACTION_CLASS/);
    },
  );

  it("ClientDetailPage feeds notesAddSignal into EntityNotesPanel for both scopes", () => {
    const src = readFileSync(
      resolve(ROOT, "client/src/pages/ClientDetailPage.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
    // The imperative ref handle is gone.
    expect(src).not.toMatch(/notesRef\.current\?\.startAdding\(\)/);
  });
});
