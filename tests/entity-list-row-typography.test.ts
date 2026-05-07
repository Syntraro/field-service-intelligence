/**
 * Entity list row typography normalization (2026-05-06 RALPH).
 *
 * Locks the contract that:
 *   • The shared `EntityListTable.kindCellClasses()` resolver maps every
 *     column kind to the canonical typography token (text-row /
 *     text-row-emphasis), not to a raw Tailwind size utility. The
 *     resolver is the single source of truth for row body typography
 *     across Jobs, Invoices, Leads, Quotes, and any future page that
 *     adopts the shared component.
 *   • Per-page render() functions on Jobs, Invoices, Leads, Quotes do
 *     NOT add ad-hoc font-size classes (`text-xs`/`text-sm`/`text-base`
 *     /`text-lg` or arbitrary `text-[...px]`) on the main row body —
 *     they let the canonical `text-row` baseline flow through. Color /
 *     weight overrides via spans inside the cell are still permitted
 *     (the canonical typography only locks size + line-height).
 *   • Status pills and Invoice/Job/Quote number pills keep their own
 *     typography (the brief explicitly preserves these); list-row
 *     wrappers do not constrain them.
 *   • Table column headers stay on `text-label` via `listHeaderRowClass`
 *     — header typography is unchanged by this normalization pass.
 *   • The Invoice description column specifically dropped its prior
 *     `text-caption` override so the column now inherits `text-row` via
 *     the canonical cell wrapper.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const ENTITY_TABLE = resolve(ROOT, "client/src/components/lists/EntityListTable.tsx");
const LIST_SURFACE = resolve(ROOT, "client/src/components/ui/list-surface.tsx");
const JOBS_PAGE = resolve(ROOT, "client/src/pages/Jobs.tsx");
const INVOICES_PAGE = resolve(ROOT, "client/src/pages/InvoicesListPage.tsx");
const LEADS_PAGE = resolve(ROOT, "client/src/pages/LeadsPage.tsx");
const QUOTES_PAGE = resolve(ROOT, "client/src/pages/Quotes.tsx");

const tableSrc = readFileSync(ENTITY_TABLE, "utf-8");
const surfaceSrc = readFileSync(LIST_SURFACE, "utf-8");
const jobsSrc = readFileSync(JOBS_PAGE, "utf-8");
const invoicesSrc = readFileSync(INVOICES_PAGE, "utf-8");
const leadsSrc = readFileSync(LEADS_PAGE, "utf-8");
const quotesSrc = readFileSync(QUOTES_PAGE, "utf-8");

// Strip block + line + JSX comments so doc-block prose that mentions
// the legacy ad-hoc classes for context doesn't false-trip the
// negative pins below.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// Extract a JS function body by name. Anchors on the next top-level
// `function` declaration (the destructured-params close-brace would
// false-stop a naive `^}/m` regex).
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const rest = src.slice(start + `function ${name}(`.length);
  const nextFn = rest.search(/\n(?:export\s+)?function\s+\w+\s*\(/);
  return src.slice(start, start + (nextFn > 0 ? nextFn : rest.length));
}

// Slice the array literal that follows the column-definition anchor
// for a given page. Strip comments FIRST (so the depth walker doesn't
// get tripped by stray brackets in commented-out code), then walk
// forward from the variable declaration counting `[`/`]` while
// ignoring brackets inside string / template literals.
function columnsArrayLiteral(rawSrc: string, varName: string): string {
  const src = stripComments(rawSrc);
  const declIdx = src.indexOf(`${varName} =`);
  expect(declIdx, `declaration for ${varName} must exist`).toBeGreaterThan(-1);
  const after = src.slice(declIdx);
  const openerMatch = after.match(/(=>|=)\s*\[/);
  expect(openerMatch, `array literal opener for ${varName} must exist`).toBeTruthy();
  const openIdx = declIdx + after.indexOf(openerMatch![0]) + openerMatch![0].length - 1;
  let depth = 0;
  let inStr: '"' | "'" | "`" | null = null;
  let templateDepth = 0; // tracks `${ ... }` inside template literals
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inStr === "`") {
      // Inside a template literal — handle ${ ... } interpolation.
      if (ch === "`" && prev !== "\\" && templateDepth === 0) {
        inStr = null;
      } else if (ch === "$" && src[i + 1] === "{") {
        templateDepth++;
        i++; // skip the `{`
      } else if (ch === "}" && templateDepth > 0) {
        templateDepth--;
      } else if (templateDepth > 0) {
        // Inside a ${...} expression — count brackets normally.
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
      }
      continue;
    }
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error(`unterminated array literal for ${varName}`);
}

// ── 1. Shared component bakes canonical tokens into kindCellClasses ──

describe("EntityListTable.kindCellClasses — canonical typography baseline", () => {
  const fn = functionBody(tableSrc, "kindCellClasses");

  it("primary cells apply text-row-emphasis (canonical row token, weight 500)", () => {
    expect(fn).toMatch(/case\s+"primary":[\s\S]+?text-row-emphasis/);
  });

  it("text cells apply the canonical text-row baseline", () => {
    expect(fn).toMatch(/case\s+"text":[\s\S]+?text-row\b/);
  });

  it("date cells apply the canonical text-row baseline", () => {
    expect(fn).toMatch(/case\s+"date":[\s\S]+?text-row\b/);
  });

  it("money cells apply the canonical text-row baseline (right-aligned + tabular)", () => {
    expect(fn).toMatch(/case\s+"money":[\s\S]+?text-row\b/);
    expect(fn).toMatch(/case\s+"money":[\s\S]+?text-right/);
    expect(fn).toMatch(/case\s+"money":[\s\S]+?tabular-nums/);
  });

  it("status cells apply the canonical text-row size baseline (Badge ships its own color)", () => {
    expect(fn).toMatch(/case\s+"status":[\s\S]+?text-row\b/);
  });

  it("badge cells apply the canonical text-row size baseline (pill ships its own typography)", () => {
    expect(fn).toMatch(/case\s+"badge":[\s\S]+?text-row\b/);
  });

  it("does NOT spread ad-hoc Tailwind size utilities across cells", () => {
    // The kind resolver must not silently re-introduce raw text-(xs|sm|
    // base|lg|xl|2xl) on the cell wrappers. Any future re-tuning of the
    // row baseline must happen at the token layer (tailwind.config.ts /
    // index.css), not by spreading ad-hoc classes here.
    const stripped = stripComments(fn);
    expect(stripped).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
    expect(stripped).not.toMatch(/text-\[\d+px\]/);
  });
});

// ── 2. List-surface header typography stays on text-label ──────────

describe("list-surface header typography — unchanged", () => {
  it("listHeaderRowClass keeps text-label (canonical column header token)", () => {
    expect(surfaceSrc).toMatch(
      /export const listHeaderRowClass\s*=[\s\S]+?text-label/,
    );
    // Negative pin: scope to the className string itself so the doc
    // commentary above the export (which mentions the legacy text-xs
    // for context) doesn't false-trip. Pull the value out and check
    // only that.
    const codeOnly = stripComments(surfaceSrc);
    const decl = codeOnly.match(
      /export const listHeaderRowClass\s*=\s*"([^"]+)"/,
    );
    expect(decl, "listHeaderRowClass declaration must exist").toBeTruthy();
    expect(decl![1]).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
  });
});

// ── 3. Per-page render() functions: no ad-hoc size on row body ─────

const FORBIDDEN_SIZE_RE =
  /className=["`][^"`]*\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b[^"`]*["`]/;

describe("Jobs list — column render functions use canonical row typography", () => {
  it("liveJobColumns renderers contain no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("historyJobColumns renderers contain no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(jobsSrc, "historyJobColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Client / Location primary cell relies on the canonical primary baseline (no inline size)", () => {
    // The cell renders `<div className="truncate">{job.locationDisplayName ...}` —
    // truncation only, no font-size. Pin both the live and history mounts.
    const live = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const history = columnsArrayLiteral(jobsSrc, "historyJobColumns");
    const primaryRe = /<div className="truncate">\{job\.locationDisplayName\s*\|\|\s*"Unknown Company"\}<\/div>/;
    expect(live).toMatch(primaryRe);
    expect(history).toMatch(primaryRe);
  });
});

describe("Invoice list — column render functions use canonical row typography", () => {
  it("invoiceColumns renderers contain no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Description column NO LONGER overrides to text-caption — relies on text-row baseline", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    // The description renderer is the `id: "description"` block. Pin the
    // muted color stays, but the size override (text-caption) is gone.
    const descBlock = cols.match(/id:\s*"description",[\s\S]+?(?=\{\s*id:\s*")/);
    expect(descBlock, "description column block must exist").toBeTruthy();
    expect(descBlock![0]).not.toMatch(/text-caption/);
    // Positive pin: muted color + truncate are preserved.
    expect(descBlock![0]).toMatch(
      /<p className="text-slate-500 truncate">\{invoice\.workDescription \|\| "-"\}<\/p>/,
    );
  });

  it("Client primary cell uses no inline font-size on the main line", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    // Primary line is `<p className="truncate" data-testid={`text-invoice-client-...`}>`.
    expect(cols).toMatch(
      /<p className="truncate" data-testid=\{`text-invoice-client-/,
    );
  });
});

describe("Leads list — column render functions use canonical row typography", () => {
  it("LEAD_COLUMNS renderers contain no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(leadsSrc, "LEAD_COLUMNS");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Title primary cell relies on the canonical primary baseline (no inline size)", () => {
    const cols = columnsArrayLiteral(leadsSrc, "LEAD_COLUMNS");
    expect(cols).toMatch(/<div className="truncate">\{lead\.title\}<\/div>/);
  });
});

describe("Quotes list — column render functions use canonical row typography", () => {
  it("quoteColumns renderers contain no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Client primary cell uses no inline font-size on the main line", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).toMatch(
      /<p className="truncate" data-testid=\{`text-quote-client-/,
    );
  });
});

// ── 4. Status pills + number pills keep their own typography ───────

describe("Status pills + EntityNumber pills are NOT constrained by row body typography", () => {
  it("Jobs status cell renders <StatusPill> (its own typography)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).toMatch(/<StatusPill\b/);
  });

  it("Jobs jobNumber cell renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Invoice status cell renders <StatusBadge> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).toMatch(/<StatusBadge\b/);
  });

  it("Invoice invoiceNumber cell renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Quote status cell renders <StatusBadge> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).toMatch(/<StatusBadge\b/);
  });

  it("Quote quoteNumber cell renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Leads status cell renders <StatusBadge> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(leadsSrc, "LEAD_COLUMNS");
    expect(cols).toMatch(/<StatusBadge\b/);
  });
});

// ── 5. Secondary metadata sub-lines stay on text-caption ───────────

describe("Secondary metadata sub-lines stay on text-caption (intentional smaller token)", () => {
  // The brief explicitly preserves "Secondary metadata if already
  // intentionally smaller". Pin the canonical sub-line shape across
  // pages so the normalization pass doesn't accidentally inflate them.

  it("Jobs secondary location underline renders at text-caption", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).toMatch(
      /<div className="text-caption text-slate-500 font-normal truncate">\{secondary\}<\/div>/,
    );
  });

  it("Jobs jobType sub-line under the number pill renders at text-caption", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).toMatch(
      /<div className="text-caption text-slate-500 capitalize mt-0\.5">\{job\.jobType\}<\/div>/,
    );
  });

  it("Invoice secondary location underline renders at text-caption", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).toMatch(
      /<p className="text-caption text-slate-500 font-normal truncate">\{invoice\.locationName\}<\/p>/,
    );
  });

  it("Lead description sub-line renders at text-caption", () => {
    const cols = columnsArrayLiteral(leadsSrc, "LEAD_COLUMNS");
    expect(cols).toMatch(
      /<div className="text-caption text-slate-500 font-normal truncate">\{lead\.description\}<\/div>/,
    );
  });

  it("Quote secondary location underline renders at text-caption", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).toMatch(
      /<p className="text-caption text-slate-500 font-normal truncate">\{quote\.location\.companyName\}<\/p>/,
    );
  });
});
