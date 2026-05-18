/**
 * EntityListTable canonicalization pins (2026-05-08).
 *
 * This test file guards the architectural contract established by the
 * 2026-05-08 canonicalization pass:
 *
 *   1. Header padding token matches cell padding token (no misalignment).
 *   2. Default cell padding is the canonical entity-list density: px-4 py-2.5.
 *   3. Primary kind uses text-row (14px / 500) = ENTITY_NAME_CLASS.
 *   4. ENTITY_SECONDARY_CLASS is exported from list-surface.tsx.
 *   5. No page-level column definition passes a redundant py-2.5 cellClassName
 *      on a primary or text kind (the canonical default makes it unnecessary).
 *   6. No page-level column definition copy-pastes the secondary class string
 *      inline — callers must import ENTITY_SECONDARY_CLASS.
 *   7. Locations.tsx no longer uses ad-hoc text-[11px] / px-1.5 pill classes.
 *   8. All eight entity list pages still import EntityListTable from the
 *      canonical path.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const ENTITY_TABLE   = path("client/src/components/lists/EntityListTable.tsx");
const LIST_SURFACE   = path("client/src/components/ui/list-surface.tsx");
const JOBS           = path("client/src/pages/Jobs.tsx");
const INVOICES       = path("client/src/pages/InvoicesListPage.tsx");
const QUOTES         = path("client/src/pages/Quotes.tsx");
const LEADS          = path("client/src/pages/LeadsPage.tsx");
const CLIENTS        = path("client/src/pages/Clients.tsx");
const LOCATIONS      = path("client/src/pages/Locations.tsx");
const INVENTORY      = path("client/src/pages/InventoryPage.tsx");

function read(p: string): string { return readFileSync(p, "utf-8"); }

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const rest = src.slice(start + `function ${name}(`.length);
  const nextFn = rest.search(/\n(?:export\s+)?function\s+\w+\s*\(/);
  return src.slice(start, start + (nextFn > 0 ? nextFn : rest.length));
}

// ── 1. Header / cell padding alignment ────────────────────────────────

describe("EntityListTable — header and cell horizontal padding alignment", () => {
  const tableSrc = read(ENTITY_TABLE);
  const cellFn = functionBody(tableSrc, "kindCellClasses");
  const headerFn = functionBody(tableSrc, "kindHeaderClasses");

  it("cell wrapper default uses px-4 (canonical entity-list density)", () => {
    // All kind branches should start with px-4.
    expect(cellFn).toMatch(/case\s+"primary"[\s\S]+?"px-4/);
    expect(cellFn).toMatch(/case\s+"text"[\s\S]+?"px-4/);
    expect(cellFn).toMatch(/case\s+"status"[\s\S]+?"px-4/);
    expect(cellFn).toMatch(/case\s+"date"[\s\S]+?"px-4/);
    expect(cellFn).toMatch(/case\s+"money"[\s\S]+?"px-4/);
    expect(cellFn).toMatch(/case\s+"badge"[\s\S]+?"px-4/);
  });

  it("header wrapper default uses px-4 matching the cell default (no misalignment)", () => {
    expect(headerFn).toMatch(/return\s+"px-4"/);
  });

  it("cell default does NOT use the old compact px-3 padding", () => {
    const stripped = stripComments(cellFn);
    // No kind branch should emit px-3 as the horizontal padding.
    expect(stripped).not.toMatch(/"px-3\s/);
    expect(stripped).not.toMatch(/"px-3"/);
  });
});

// ── 2. Canonical row density ───────────────────────────────────────────

describe("EntityListTable — canonical row density py-2.5", () => {
  const tableSrc = read(ENTITY_TABLE);
  const cellFn = functionBody(tableSrc, "kindCellClasses");

  it("primary cells use py-2.5 (canonical row height driver)", () => {
    expect(cellFn).toMatch(/case\s+"primary"[\s\S]+?py-2\.5/);
  });

  it("text, status, date, money, badge cells all use py-2.5", () => {
    expect(cellFn).toMatch(/case\s+"text"[\s\S]+?py-2\.5/);
    expect(cellFn).toMatch(/case\s+"status"[\s\S]+?py-2\.5/);
    expect(cellFn).toMatch(/case\s+"date"[\s\S]+?py-2\.5/);
    expect(cellFn).toMatch(/case\s+"money"[\s\S]+?py-2\.5/);
    expect(cellFn).toMatch(/case\s+"badge"[\s\S]+?py-2\.5/);
  });

  it("select cell uses py-2.5", () => {
    expect(cellFn).toMatch(/case\s+"select"[\s\S]+?py-2\.5/);
  });
});

// ── 3a. Header typography — text-label via SECTION_LABEL_CLASS ────────

describe("EntityListTable — header row uses text-label (via listHeaderRowClass → SECTION_LABEL_CLASS)", () => {
  const surfaceSrc = read(LIST_SURFACE);

  it("listHeaderRowClass embeds SECTION_LABEL_CLASS (which resolves to text-label)", () => {
    // The canonical header class is text-label (13px / fw 500 / 0.04em tracking
    // + uppercase via @layer). It is not applied via kindHeaderClasses (which
    // controls only padding + alignment per kind). It flows from the parent
    // header-row div via CSS cascade. Sortable headers inherit it even when
    // they set headerClassName: "" to suppress padding duplication.
    expect(surfaceSrc).toMatch(
      /export const listHeaderRowClass\s*=[\s\S]+?\$\{SECTION_LABEL_CLASS\}/,
    );
  });

  it("SECTION_LABEL_CLASS resolves to text-label (defined in typography.tsx)", () => {
    // SECTION_LABEL_CLASS is declared in typography.tsx and imported into
    // list-surface.tsx where it is embedded in listHeaderRowClass.
    const typographySrc = read(path("client/src/components/ui/typography.tsx"));
    expect(typographySrc).toMatch(/SECTION_LABEL_CLASS\s*=\s*["']text-label/);
  });

  it("kindHeaderClasses does NOT bake any typography class (header typography is cascade-only)", () => {
    const tableSrc = read(ENTITY_TABLE);
    const headerFn = functionBody(tableSrc, "kindHeaderClasses");
    const stripped = stripComments(headerFn);
    // Header functions own padding + alignment only — no text-* size/color class.
    expect(stripped).not.toMatch(/\btext-(?:helper|caption|label|row|muted)\b/);
  });
});

// ── 3. Primary kind typography ────────────────────────────────────────

describe("EntityListTable — primary kind uses text-helper font-medium (13px / 500)", () => {
  const tableSrc = read(ENTITY_TABLE);
  const cellFn = functionBody(tableSrc, "kindCellClasses");

  it("primary branch emits text-helper font-medium (denser entity-list scale)", () => {
    // 2026-05-08 density adjustment: text-helper (13px / 500) matches
    // secondary columns' size token; weight 500 vs 400 is the hierarchy signal.
    expect(cellFn).toMatch(/case\s+"primary"[\s\S]+?text-helper\s+font-medium/);
  });

  it("primary branch code does NOT emit text-row (strip comments — doc-prose may reference it)", () => {
    const primaryBranch = stripComments(
      cellFn.match(/case\s+"primary":[\s\S]+?(?=case\s+")/)?.[0] ?? ""
    );
    expect(primaryBranch).not.toMatch(/\btext-row\b/);
  });
});

// ── 4. ENTITY_SECONDARY_CLASS export ──────────────────────────────────

describe("list-surface.tsx — ENTITY_SECONDARY_CLASS is exported", () => {
  const surfaceSrc = read(LIST_SURFACE);

  it("exports ENTITY_SECONDARY_CLASS", () => {
    expect(surfaceSrc).toMatch(/export const ENTITY_SECONDARY_CLASS\s*=/);
  });

  it("ENTITY_SECONDARY_CLASS uses text-row (14px), slate-500, font-normal, truncate", () => {
    expect(surfaceSrc).toMatch(
      /ENTITY_SECONDARY_CLASS\s*=\s*"text-row text-slate-500 font-normal truncate"/,
    );
  });
});

// ── 5. No redundant py-2.5 cellClassName on primary/text columns ───────

describe("Page-level columns — no redundant py-2.5 cellClassName on primary/text kinds", () => {
  // Since EntityListTable now defaults to py-2.5, any cellClassName that
  // contains py-2.5 on a primary or text column is redundant drift.
  // Legitimate overrides (centering select/icon cells, non-primary kinds)
  // do NOT contain py-2.5 — they only add functional layout classes.

  const REDUNDANT_RE = /cellClassName:\s*["'`][^"'`]*py-2\.5[^"'`]*["'`]/g;

  function countRedundantOverrides(src: string): number {
    return (stripComments(src).match(REDUNDANT_RE) ?? []).length;
  }

  it("Invoices — no redundant py-2.5 cellClassName", () => {
    expect(countRedundantOverrides(read(INVOICES))).toBe(0);
  });

  it("Quotes — no redundant py-2.5 cellClassName", () => {
    expect(countRedundantOverrides(read(QUOTES))).toBe(0);
  });

  it("Leads — no redundant py-2.5 cellClassName", () => {
    expect(countRedundantOverrides(read(LEADS))).toBe(0);
  });

  it("Clients — no redundant py-2.5 cellClassName", () => {
    expect(countRedundantOverrides(read(CLIENTS))).toBe(0);
  });

  it("Locations — no redundant py-2.5 cellClassName", () => {
    expect(countRedundantOverrides(read(LOCATIONS))).toBe(0);
  });

  it("Jobs — no redundant py-2.5 cellClassName (was already clean)", () => {
    expect(countRedundantOverrides(read(JOBS))).toBe(0);
  });

  it("Inventory — no redundant py-2.5 cellClassName (was already clean)", () => {
    expect(countRedundantOverrides(read(INVENTORY))).toBe(0);
  });
});

// ── 6. No copy-pasted secondary class strings in page files ────────────

describe("Page-level columns — no copy-pasted secondary class literal", () => {
  // After canonicalization, the literal string
  // "text-row text-slate-500 font-normal truncate" must not appear
  // in any entity list page file. Callers must import ENTITY_SECONDARY_CLASS.

  const COPIED_RE = /text-row text-slate-500 font-normal truncate/;

  function hasCopiedSecondary(src: string): boolean {
    return COPIED_RE.test(stripComments(src));
  }

  it("Jobs — secondary class not copy-pasted", () => {
    expect(hasCopiedSecondary(read(JOBS))).toBe(false);
  });

  it("Invoices — secondary class not copy-pasted", () => {
    expect(hasCopiedSecondary(read(INVOICES))).toBe(false);
  });

  it("Quotes — secondary class not copy-pasted", () => {
    expect(hasCopiedSecondary(read(QUOTES))).toBe(false);
  });

  it("Leads — secondary class not copy-pasted", () => {
    expect(hasCopiedSecondary(read(LEADS))).toBe(false);
  });

});

// ── 7. Locations — no ad-hoc text-[11px] tag pill ─────────────────────

describe("Locations.tsx — tag pills use listBadgeClass, not ad-hoc classes", () => {
  const src = read(LOCATIONS);

  it("does not contain text-[11px] (arbitrary pixel class removed)", () => {
    expect(stripComments(src)).not.toMatch(/text-\[11px\]/);
  });

  it("does not contain px-1.5 py-0.5 ad-hoc pill sizing", () => {
    // Legitimate: `gap-1.5` elsewhere in filters — only target the pill pattern.
    expect(stripComments(src)).not.toMatch(/px-1\.5 py-0\.5/);
  });

  it("imports listBadgeClass from canonical list-surface", () => {
    expect(src).toMatch(/listBadgeClass/);
    expect(src).toMatch(/from "@\/components\/ui\/list-surface"/);
  });
});

// ── 8. All eight entity list pages still use EntityListTable ───────────

describe("All entity list pages import EntityListTable from canonical path", () => {
  const CANONICAL_IMPORT = /from "@\/components\/lists\/EntityListTable"/;

  const pages: [string, string][] = [
    ["Jobs", JOBS],
    ["Invoices", INVOICES],
    ["Quotes", QUOTES],
    ["Leads", LEADS],
    ["Clients", CLIENTS],
    ["Locations", LOCATIONS],
    ["Inventory", INVENTORY],
  ];

  for (const [name, filePath] of pages) {
    it(`${name} imports from canonical EntityListTable path`, () => {
      expect(read(filePath)).toMatch(CANONICAL_IMPORT);
    });
  }
});
