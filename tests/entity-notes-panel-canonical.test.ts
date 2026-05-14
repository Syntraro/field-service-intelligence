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

const PAGES: ReadonlyArray<{
  label: string;
  path: string;
  /** When EntityNotesPanel is mounted inside a wrapper component rather
   *  than directly on the page, point this at the wrapper file so the
   *  mount and signal assertions read the right source. */
  panelPath?: string;
  entityType: string;
  entityIdRef: string;
}> = [
  {
    label: "JobDetailPage",
    path: resolve(ROOT, "client/src/pages/JobDetailPage.tsx"),
    entityType: "job",
    entityIdRef: "job\\.id",
  },
  {
    label: "InvoiceDetailPage",
    path: resolve(ROOT, "client/src/pages/InvoiceDetailPage.tsx"),
    // EntityNotesPanel is mounted inside InvoiceActivityPanel, not
    // directly on InvoiceDetailPage. The signal is threaded:
    //   InvoiceDetailPage → InvoiceActivityPanel → EntityNotesPanel
    panelPath: resolve(
      ROOT,
      "client/src/components/invoice/InvoiceActivityPanel.tsx",
    ),
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
    ({ path, panelPath, entityType, entityIdRef }) => {
      // When a wrapper component owns the mount (e.g. InvoiceActivityPanel),
      // check the wrapper source rather than the page source.
      const src = readFileSync(panelPath ?? path, "utf-8");
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

  it('ClientScopedNotesPanel does not fire a "Note added" success toast on inline create', () => {
    // Location / company note inline form: note appears immediately in the
    // list; the success toast is redundant noise, same as the modal path.
    expect(panelSrc).not.toMatch(/title:\s*["']Note added["']/);
  });
});

// ── 8. Page-level rail tab descriptors own title / count / +Add ─────

describe("Notes rail tab descriptors own title + count + +Add (panel never owns chrome)", () => {
  it.each(PAGES)(
    "$label feeds notesAddSignal into EntityNotesPanel.openAddNoteSignal",
    ({ path, panelPath }) => {
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/setNotesAddSignal\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
      if (panelPath) {
        // Signal is threaded through a wrapper: verify the page passes
        // it to the wrapper, and the wrapper wires it to EntityNotesPanel.
        expect(src).toMatch(/notesAddSignal=\{notesAddSignal\}/);
        const wrapperSrc = readFileSync(panelPath, "utf-8");
        expect(wrapperSrc).toMatch(
          /<EntityNotesPanel[\s\S]{0,800}?openAddNoteSignal=\{notesAddSignal\}/,
        );
      } else {
        expect(src).toMatch(
          /<EntityNotesPanel[\s\S]{0,800}?openAddNoteSignal=\{notesAddSignal\}/,
        );
      }
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

// ── 9. openAddNoteSignal consumed exactly once (reopen-regression) ───
//
// Root cause (2026-05-13): every detail page renders two DetailRightRail
// instances for responsive layout (lg:hidden mobile + hidden lg:flex
// desktop). Both mount EntityOwnedNotesPanel simultaneously. Without a
// guard, both fire the signal effect and open dialogs via portals. The
// hidden-rail portal escapes its display:none ancestor and stays visible
// after the user closes the visible-rail dialog — appearing as an
// immediate reopen.
//
// Fix: two guards in EntityOwnedNotesPanel's signal useEffect:
//   1. lastConsumedSignalRef (initialized to current prop) — prevents a
//      fresh mount (tab switch away + back) from re-triggering a stale
//      non-zero signal.
//   2. offsetParent === null check on containerRef — skips the hidden
//      breakpoint-rail instance; offsetParent is null when any ancestor
//      has display:none.

describe("EntityOwnedNotesPanel — openAddNoteSignal consumed exactly once (reopen-regression)", () => {
  const panelCode = stripComments(panelSrc);

  it("tracks last-consumed signal in a ref so the same signal value never opens dialog twice", () => {
    // The ref must be declared and compared against openAddNoteSignal
    // before setDialogOpen(true) is called.
    expect(panelSrc).toMatch(/lastConsumedSignalRef/);
    expect(panelSrc).toMatch(/lastConsumedSignalRef\.current\s*=\s*openAddNoteSignal/);
  });

  it("initialises lastConsumedSignalRef to the current prop value so remounts do not re-trigger stale signals", () => {
    // useRef(openAddNoteSignal ?? 0) seeds the ref with whatever the prop
    // value is at mount time, preventing a tab-switch remount from firing.
    expect(panelSrc).toMatch(/useRef\(\s*openAddNoteSignal\s*\?\?\s*0\s*\)/);
  });

  it("guards against the hidden-rail instance opening a dialog via offsetParent check", () => {
    // offsetParent === null when an ancestor has display:none — used to
    // block the lg:hidden / hidden:lg:flex counterpart rail instance.
    expect(panelSrc).toMatch(/offsetParent/);
    expect(panelCode).toMatch(/containerRef\.current[\s\S]{0,80}?offsetParent/);
  });

  it("attaches containerRef to the root panel div so the visibility check is accurate", () => {
    expect(panelSrc).toMatch(/ref=\{containerRef\}/);
  });

  it("old unconditional > 0 open pattern is replaced by the guarded effect", () => {
    // The original effect body was `if (openAddNoteSignal > 0) { setDialogOpen(true) }`
    // with no consumed-signal guard. That pattern must not survive.
    expect(panelCode).not.toMatch(
      /openAddNoteSignal\s*>\s*0\s*\)\s*\{[\s\S]{0,40}?setDialogOpen\(true\)/,
    );
  });
});

// ── 10. ClientScopedNotesPanel — openAddNoteSignal consumed exactly once ──
//
// Root cause (2026-05-13): ClientDetailPage renders two DetailRightRail
// instances simultaneously (lg:hidden mobile + hidden lg:flex desktop).
// Both mount ClientScopedNotesPanel. Without the guard, both instances
// responded to openAddNoteSignal and opened their inline create form.
// The hidden rail's form state persists across breakpoint transitions —
// resizing to mobile would show the form already open.
//
// Fix mirrors EntityOwnedNotesPanel: containerRef + offsetParent check +
// lastConsumedSignalRef so the signal is consumed exactly once by the
// visible instance only.

describe("ClientScopedNotesPanel — openAddNoteSignal consumed exactly once (hidden-rail regression)", () => {
  it("guards against the hidden-rail instance via offsetParent check before setIsAdding", () => {
    // offsetParent is null when an ancestor has display:none. The check must
    // appear before setIsAdding(true) so the hidden counterpart rail never
    // opens its inline create form.
    expect(panelCode).toMatch(
      /offsetParent[\s\S]{0,300}?setIsAdding\(true\)/,
    );
  });

  it("attaches containerRef to ClientScopedNotesPanel root div (two ref= occurrences in total)", () => {
    // EntityOwnedNotesPanel already has one ref={containerRef}. Adding one for
    // ClientScopedNotesPanel brings the total to two — verify both exist.
    const occurrences = (panelSrc.match(/ref=\{containerRef\}/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("initialises lastConsumedSignalRef in ClientScopedNotesPanel so remounts do not re-trigger stale signals", () => {
    // useRef(openAddNoteSignal ?? 0) must appear at least twice in the file —
    // once per panel variant.
    const occurrences = (
      panelSrc.match(/useRef\(\s*openAddNoteSignal\s*\?\?\s*0\s*\)/g) ?? []
    ).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("old unconditional openAddNoteSignal !== undefined && > 0 pattern is replaced by the guarded effect", () => {
    // The original ClientScopedNotesPanel effect body:
    //   if (openAddNoteSignal !== undefined && openAddNoteSignal > 0) { setIsAdding(true) }
    // That pattern must not survive.
    expect(panelCode).not.toMatch(
      /openAddNoteSignal\s*!==\s*undefined\s*&&\s*openAddNoteSignal\s*>\s*0/,
    );
  });
});
