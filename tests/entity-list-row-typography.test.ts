/**
 * Entity list row typography normalization (2026-05-06 RALPH;
 * recalibrated 2026-05-07; updated 2026-05-09 for descriptor API).
 *
 * Locks the contract that:
 *   • The shared `EntityListTable.kindCellClasses()` resolver maps every
 *     column kind to the canonical typography token (`text-list-primary`
 *     for primary names — 15px / 20px LH / 500; `text-list-body` for
 *     text/body/date/money standard-content cells — 15px / 20px / 400;
 *     `text-row` for status/badge wrapper baseline), not to a raw Tailwind
 *     size utility. The resolver is the single source of truth for row body
 *     typography across Jobs, Invoices, Leads, Quotes, Clients, Suppliers,
 *     Locations, Inventory, PMWorkspacePage, and any future page that adopts
 *     the shared component.
 *   • The `renderCellContent` function renders `entity-primary` primary
 *     lines with `text-list-primary` directly on the inner element (not
 *     relying on cell-wrapper inheritance alone). This guards against
 *     tailwind-merge silently dropping the font-size token when it is
 *     co-located with a text-color class (`text-slate-800`) in a cn() call.
 *   • The `renderCellContent` function renders `entity-primary` secondary
 *     lines using `ENTITY_SECONDARY_CLASS` — callers cannot override or
 *     bypass this secondary-line treatment.
 *   • Per-page column definitions do NOT add ad-hoc font-size classes
 *     (`text-xs`/`text-sm`/`text-base`/`text-lg` or arbitrary `text-[...px]`)
 *     on the main row body — they let the canonical cell-wrapper baseline
 *     flow through.  Color / weight overrides via spans inside customRender
 *     cells are still permitted (the canonical typography only locks size +
 *     line-height).
 *   • Status columns use the `entity-status` descriptor wherever a single
 *     canonical chip is appropriate; customRender is the named escape hatch
 *     for multi-badge compositions.
 *   • Invoice / Quote client cells that need a `data-testid` use the
 *     `ENTITY_SECONDARY_CLASS` constant (not the hardcoded string) for their
 *     secondary-line.
 *   • Table column headers use `text-row` via `listHeaderRowClass`
 *     — header typography is controlled by the shared surface constant.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { cn } from "@/lib/utils";

const ROOT = resolve(__dirname, "..");
const ENTITY_TABLE = resolve(ROOT, "client/src/components/lists/EntityListTable.tsx");
const LIST_SURFACE = resolve(ROOT, "client/src/components/ui/list-surface.tsx");
const JOBS_PAGE = resolve(ROOT, "client/src/pages/Jobs.tsx");
const INVOICES_PAGE = resolve(ROOT, "client/src/pages/InvoicesListPage.tsx");
const LEADS_PAGE = resolve(ROOT, "client/src/pages/LeadsPage.tsx");
const QUOTES_PAGE = resolve(ROOT, "client/src/pages/Quotes.tsx");
const TAILWIND_CONFIG = resolve(ROOT, "tailwind.config.ts");
const UTILS_TS = resolve(ROOT, "client/src/lib/utils.ts");

const tableSrc = readFileSync(ENTITY_TABLE, "utf-8");
const surfaceSrc = readFileSync(LIST_SURFACE, "utf-8");
const jobsSrc = readFileSync(JOBS_PAGE, "utf-8");
const invoicesSrc = readFileSync(INVOICES_PAGE, "utf-8");
const leadsSrc = readFileSync(LEADS_PAGE, "utf-8");
const quotesSrc = readFileSync(QUOTES_PAGE, "utf-8");
const tailwindSrc = readFileSync(TAILWIND_CONFIG, "utf-8");
const utilsSrc = readFileSync(UTILS_TS, "utf-8");

// Strip block + line + JSX comments so doc-block prose that mentions
// legacy ad-hoc classes for context doesn't false-trip negative pins.
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
      if (ch === "`" && prev !== "\\" && templateDepth === 0) {
        inStr = null;
      } else if (ch === "$" && src[i + 1] === "{") {
        templateDepth++;
        i++;
      } else if (ch === "}" && templateDepth > 0) {
        templateDepth--;
      } else if (templateDepth > 0) {
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

  it("primary cells apply text-list-primary (15px / 20px / 500 — size experiment 2026-05-09)", () => {
    const primaryBranch = stripComments(
      fn.match(/case\s+"primary":[\s\S]+?(?=case\s+")/)?.[0] ?? ""
    );
    // text-list-primary bakes 15px / 20px LH / 500 — no separate font-medium needed.
    expect(primaryBranch).toMatch(/\btext-list-primary\b/);
    expect(primaryBranch).not.toMatch(/\btext-caption\b/);
    expect(primaryBranch).not.toMatch(/\btext-helper\b/);
    expect(primaryBranch).not.toMatch(/text-row-emphasis/);
  });

  it("text cells apply text-list-body (normalized 2026-05-09: 15px / 20px / 400)", () => {
    expect(fn).toMatch(/case\s+"text":[\s\S]+?text-list-body\b/);
    expect(fn).not.toMatch(/case\s+"text":[\s\S]+?text-helper\b/);
  });

  it("date cells apply text-list-body (normalized 2026-05-09: 15px / 20px / 400)", () => {
    expect(fn).toMatch(/case\s+"date":[\s\S]+?text-list-body\b/);
    expect(fn).not.toMatch(/case\s+"date":[\s\S]+?text-helper\b/);
  });

  it("money cells apply text-list-body, right-aligned + tabular (normalized 2026-05-09)", () => {
    expect(fn).toMatch(/case\s+"money":[\s\S]+?text-list-body\b/);
    expect(fn).not.toMatch(/case\s+"money":[\s\S]+?text-helper\b/);
    expect(fn).toMatch(/case\s+"money":[\s\S]+?text-right/);
    expect(fn).toMatch(/case\s+"money":[\s\S]+?tabular-nums/);
  });

  it("status cells apply the canonical text-row size baseline (StatusChip ships its own color)", () => {
    expect(fn).toMatch(/case\s+"status":[\s\S]+?text-row\b/);
  });

  it("badge cells apply the canonical text-row size baseline (pill ships its own typography)", () => {
    expect(fn).toMatch(/case\s+"badge":[\s\S]+?text-row\b/);
  });

  it("does NOT spread ad-hoc Tailwind size utilities across cells", () => {
    const stripped = stripComments(fn);
    expect(stripped).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
    expect(stripped).not.toMatch(/text-\[\d+px\]/);
  });

  it("all cell kinds use py-1.5 vertical padding (density experiment 2026-05-09)", () => {
    const stripped = stripComments(fn);
    // py-2.5 must be gone — any match here means a case was missed.
    expect(stripped).not.toMatch(/\bpy-2\.5\b/);
    // py-1.5 must appear for every distinct cell kind.
    const hits = (stripped.match(/\bpy-1\.5\b/g) ?? []).length;
    expect(hits).toBeGreaterThanOrEqual(7); // select, primary, body, text, status, date, money, badge
  });

  it("body cells apply text-list-body (15px / 20px / 400 — content kind 2026-05-09)", () => {
    const bodyBranch = stripComments(
      fn.match(/case\s+"body":[\s\S]+?(?=case\s+")/)?.[0] ?? ""
    );
    expect(bodyBranch, "body case must exist").not.toBe("");
    expect(bodyBranch).toMatch(/\btext-list-body\b/);
    expect(bodyBranch).not.toMatch(/\btext-helper\b/);
    expect(bodyBranch).not.toMatch(/\bfont-medium\b/);
  });
});

// ── 2. renderCellContent bakes ENTITY_SECONDARY_CLASS for entity-primary ─────

describe("EntityListTable.renderCellContent — entity-primary secondary-line contract", () => {
  // renderCellContent is a generic function (`function renderCellContent<Row>(...)`),
  // which means the `functionBody` helper's `function ${name}(` anchor does NOT
  // match. Search the raw source for the entity-primary case directly.
  const entityPrimaryCase = tableSrc.match(
    /case\s+"entity-primary":[\s\S]+?(?=case\s+"entity-text")/
  )?.[0] ?? "";

  it("entity-primary case exists in renderCellContent", () => {
    expect(entityPrimaryCase).toBeTruthy();
  });

  it("entity-primary inner line element carries text-list-primary directly (not via cell-wrapper inheritance only)", () => {
    // tailwind-merge strips custom font-size tokens when a text-color class is also
    // present in the same cn() call (text-list-primary + text-slate-800 → only
    // text-slate-800 survives without extendTailwindMerge). Defense-in-depth: the
    // visible primary line element must carry text-list-primary explicitly so it is
    // never lost to merge conflicts.
    expect(entityPrimaryCase).toMatch(/className="text-list-primary truncate"/);
  });

  it("entity-primary case applies ENTITY_SECONDARY_CLASS to secondary line (callers cannot override)", () => {
    // Pages with entity-primary + secondary: prop get ENTITY_SECONDARY_CLASS
    // automatically — no page-level secondary-line typography code needed.
    expect(entityPrimaryCase).toMatch(/ENTITY_SECONDARY_CLASS/);
  });

  it("entity-primary case renders primary value in a truncate wrapper with text-list-primary", () => {
    // Inner element carries the class directly; data-testid may appear alongside it.
    expect(entityPrimaryCase).toMatch(/className="text-list-primary truncate"/);
  });

  it("entity-primary renderer supports optional testId prop on inner element", () => {
    // testId?: (row) => string — enables data-testid on the primary line without customRender.
    expect(entityPrimaryCase).toMatch(/cell\.testId/);
    expect(entityPrimaryCase).toMatch(/data-testid/);
  });

  it("ENTITY_SECONDARY_CLASS contains font-normal (secondary must stay subordinate to 500-weight primary)", () => {
    // text-list-primary bakes font-weight 500; ENTITY_SECONDARY_CLASS must explicitly
    // apply font-normal to keep secondary visually lighter than primary.
    expect(surfaceSrc).toMatch(/ENTITY_SECONDARY_CLASS\s*=\s*["'][^"']*\bfont-normal\b/);
  });
});

// ── 2b. Token registration — tailwind.config.ts + utils.ts ───────────────────

describe("text-list-primary and text-list-body token registration", () => {
  it("tailwind.config.ts defines list-primary at 15px / 20px / 500", () => {
    expect(tailwindSrc).toMatch(/"list-primary":\s*\["15px"/);
    expect(tailwindSrc).toMatch(/"list-primary"[\s\S]{0,80}lineHeight:\s*"20px"/);
    expect(tailwindSrc).toMatch(/"list-primary"[\s\S]{0,80}fontWeight:\s*"500"/);
  });

  it("tailwind.config.ts defines list-body at 15px / 20px with no baked fontWeight (400 default)", () => {
    expect(tailwindSrc).toMatch(/"list-body":\s*\["15px"/);
    expect(tailwindSrc).toMatch(/"list-body"[\s\S]{0,80}lineHeight:\s*"20px"/);
    // No fontWeight baked in — weight defaults to 400 via CSS inheritance.
    expect(tailwindSrc).not.toMatch(/"list-body"[\s\S]{0,80}fontWeight/);
  });

  it("utils.ts registers both list-primary and list-body in extendTailwindMerge font-size group", () => {
    expect(utilsSrc).toMatch(/\blist-primary\b/);
    expect(utilsSrc).toMatch(/\blist-body\b/);
    expect(utilsSrc).toMatch(/extendTailwindMerge/);
  });
});

describe("EntityListTable.renderCellContent — entity-date conditional states", () => {
  // entity-date extended 2026-05-09: isActive + overdueWhen optional callbacks.
  const entityDateCase = tableSrc.match(
    /case\s+"entity-date":[\s\S]+?(?=case\s+"entity-money")/
  )?.[0] ?? "";

  it("entity-date case exists in renderCellContent", () => {
    expect(entityDateCase).toBeTruthy();
  });

  it("entity-date renderer handles isActive=false → renders 'Inactive' muted", () => {
    expect(entityDateCase).toMatch(/cell\.isActive/);
    expect(entityDateCase).toMatch(/Inactive/);
    expect(entityDateCase).toMatch(/text-muted-foreground/);
  });

  it("entity-date renderer handles overdueWhen=true → renders 'Overdue' in red+semibold", () => {
    expect(entityDateCase).toMatch(/overdueWhen/);
    expect(entityDateCase).toMatch(/Overdue/);
    expect(entityDateCase).toMatch(/text-red-700/);
    expect(entityDateCase).toMatch(/font-semibold/);
  });

  it("entity-date type includes isActive? and overdueWhen? in the union", () => {
    expect(tableSrc).toMatch(/isActive\?:\s*\(row:\s*Row\)\s*=>\s*boolean/);
    expect(tableSrc).toMatch(/overdueWhen\?:\s*\(row:\s*Row\)\s*=>\s*boolean/);
  });
});

// ── 3. List-surface header typography uses text-row ──────────────

describe("list-surface header typography — text-row", () => {
  it("listHeaderRowClass uses text-row (entity list header token, 2026-05-09 typography visual test)", () => {
    const codeOnly = stripComments(surfaceSrc);
    // Declaration must contain text-row directly (not via SECTION_LABEL_CLASS interpolation).
    expect(codeOnly).toMatch(/export const listHeaderRowClass\s*=\s*["'][^"']*\btext-row\b/);
    // Must NOT interpolate SECTION_LABEL_CLASS — the token is baked in directly.
    expect(codeOnly).not.toMatch(/\$\{SECTION_LABEL_CLASS\}/);
    // The declaration string must not contain a legacy size ramp.
    const declLine = codeOnly.match(/export const listHeaderRowClass\s*=\s*["'][^"']*/)?.[0] ?? "";
    expect(declLine).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
  });
});

// ── 4. Per-page column definitions: no ad-hoc size on row body ────────

const FORBIDDEN_SIZE_RE =
  /className=["`][^"`]*\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b[^"`]*["`]/;

describe("Jobs list — column definitions use canonical row typography", () => {
  it("liveJobColumns contains no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("historyJobColumns contains no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(jobsSrc, "historyJobColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Client / Location column uses entity-primary descriptor with secondary: prop", () => {
    // 2026-05-08: migrated from customRender JSX to entity-primary descriptor.
    // The component renders `<div className="truncate">` + ENTITY_SECONDARY_CLASS
    // for the secondary line — no page-level typography JSX needed.
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const locBlock = cols.match(/id:\s*"location",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(locBlock).toMatch(/type:\s*"entity-primary"/);
    expect(locBlock).toMatch(/secondary:\s*\(job\)/);
    // Inverse: no manual truncate-div or hardcoded secondary class in the literal.
    expect(locBlock).not.toMatch(/className="text-caption text-slate-500 font-normal/);
  });

  it("liveJobColumns:jobNumber does not render jobType sub-line (Maintenance label removed 2026-05-09)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    // jobNumber is the last column — no next { id: lookahead available.
    // Assert the columns array contains the jobNumber entry and has no jobType render.
    expect(cols).toMatch(/id:\s*"jobNumber"/);
    expect(cols).not.toMatch(/\bjobType\b/);
    expect(cols).not.toMatch(/\bcapitalize\b/);
  });

  it("liveJobColumns:summary uses kind: \"body\" (15px/20px/400 content kind)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const block = cols.match(/id:\s*"summary",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(block, "summary block must exist").toBeTruthy();
    expect(block).toMatch(/kind:\s*"body"/);
    expect(block).not.toMatch(/kind:\s*"text"/);
  });

  it("liveJobColumns:schedule uses kind: \"body\" (15px/20px/400 content kind)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const block = cols.match(/id:\s*"schedule",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(block, "schedule block must exist").toBeTruthy();
    expect(block).toMatch(/kind:\s*"body"/);
    expect(block).not.toMatch(/kind:\s*"date"/);
  });
});

describe("Invoice list — column definitions use canonical row typography", () => {
  it("invoiceColumns contains no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Description column uses entity-text descriptor (no text-caption inline)", () => {
    // 2026-05-08: description migrated from customRender to entity-text.
    // The component applies text-list-body (via kindCellClasses) — no manual
    // size class in the column definition.
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    const descBlock = cols.match(/id:\s*"description",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(descBlock, "description column block must exist").toBeTruthy();
    expect(descBlock).toMatch(/type:\s*"entity-text"/);
    expect(descBlock).not.toMatch(/text-caption/);
  });

  it("Client column uses entity-primary descriptor with testId (migrated from customRender 2026-05-09)", () => {
    // Migrated off customRender — entity-primary descriptor owns the primary line typography.
    // testId prop wires the data-testid through the shared renderer rather than page JSX.
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    const clientBlock = cols.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).toMatch(/testId:/);
    expect(clientBlock).toMatch(/text-invoice-client-/);
    // No inline <p> with text-* class — typography is owned by the shared renderer.
    expect(clientBlock).not.toMatch(/<p className="truncate"/);
  });
});

describe("Leads list — column definitions use canonical row typography", () => {
  // LEAD_COLUMNS is a type-annotated module-scoped constant
  // (`const LEAD_COLUMNS: EntityListColumn<EnrichedLead>[] = [...]`). The type
  // annotation means `columnsArrayLiteral` cannot locate it via its
  // `${varName} =` search — use direct source search instead.
  it("LEAD_COLUMNS contains no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    expect(leadsSrc).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Client column uses entity-primary descriptor with location secondary (added 2026-05-09)", () => {
    // Client is now the first column: company display name (primary) + site/city (secondary).
    const clientBlock = leadsSrc.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock, "client column block must exist").toBeTruthy();
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).toMatch(/locationDisplayName/);
    expect(clientBlock).toMatch(/secondary:/);
  });

  it("Title column uses entity-text descriptor (flexible column, 2026-05-09 column reorder)", () => {
    // Title is the flexible/truncating column. Demoted from entity-primary to entity-text
    // now that Client owns the entity-identity role. No secondary line.
    const titleBlock = leadsSrc.match(/id:\s*"title",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(titleBlock, "title column block must exist").toBeTruthy();
    expect(titleBlock).toMatch(/type:\s*"entity-text"/);
    expect(titleBlock).toMatch(/value:\s*\(lead\)\s*=>\s*lead\.title/);
    expect(titleBlock).not.toMatch(/type:\s*"entity-primary"/);
    expect(titleBlock).not.toMatch(/secondary:/);
  });

  it("Source column uses entity-text descriptor (migrated from CAPITALIZE customRender 2026-05-09)", () => {
    // 2026-05-09: source migrated from customRender(<span className="capitalize">)
    // to entity-text with JS capitalization in the value callback.
    const sourceBlock = leadsSrc.match(/id:\s*"source",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(sourceBlock, "source column block must exist").toBeTruthy();
    expect(sourceBlock).toMatch(/type:\s*"entity-text"/);
    expect(sourceBlock).not.toMatch(/type:\s*"customRender"/);
    expect(sourceBlock).not.toMatch(/className="capitalize/);
  });

  it("Priority column uses entity-text descriptor (migrated from CAPITALIZE customRender 2026-05-09)", () => {
    // 2026-05-09: priority migrated from customRender(<span className="capitalize">)
    // to entity-text with JS capitalization in the value callback.
    const priorityBlock = leadsSrc.match(/id:\s*"priority",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(priorityBlock, "priority column block must exist").toBeTruthy();
    expect(priorityBlock).toMatch(/type:\s*"entity-text"/);
    expect(priorityBlock).not.toMatch(/type:\s*"customRender"/);
    expect(priorityBlock).not.toMatch(/className="capitalize/);
  });
});

describe("Quotes list — column definitions use canonical row typography", () => {
  it("quoteColumns contains no ad-hoc text-(xs|sm|base|lg|xl|2xl) class", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).not.toMatch(FORBIDDEN_SIZE_RE);
  });

  it("Client column uses entity-primary descriptor with testId (migrated from customRender 2026-05-09)", () => {
    // Migrated off customRender — entity-primary descriptor owns the primary line typography.
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    const clientBlock = cols.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).toMatch(/testId:/);
    expect(clientBlock).toMatch(/text-quote-client-/);
    expect(clientBlock).not.toMatch(/<p className="truncate"/);
  });
});

// ── 5. Status columns — entity-status descriptor or justified customRender ───

describe("Status columns use entity-status descriptor (or justified customRender)", () => {
  it("Jobs liveJobColumns status uses entity-status descriptor (not StatusPill customRender)", () => {
    // 2026-05-08: migrated from customRender(<StatusPill ...>) to entity-status.
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const statusBlock = cols.match(/id:\s*"status",[\s\S]+?$/s)?.[0] ?? "";
    expect(statusBlock).toMatch(/type:\s*"entity-status"/);
    expect(statusBlock).not.toMatch(/<StatusPill\b/);
  });

  it("Leads LEAD_COLUMNS status uses entity-status descriptor (not StatusBadge customRender)", () => {
    // 2026-05-08: migrated from customRender(<StatusBadge ...>) to entity-status.
    const statusBlock = leadsSrc.match(/id:\s*"status",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(statusBlock, "status column block must exist").toBeTruthy();
    expect(statusBlock).toMatch(/type:\s*"entity-status"/);
    expect(statusBlock).not.toMatch(/<StatusBadge\b/);
  });

  it("Invoice status is justified customRender (StatusBadge + QboSyncBadge multi-badge)", () => {
    // Invoice needs multi-badge: StatusBadge + QboSyncBadge. customRender is correct.
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    const statusBlock = cols.match(/id:\s*"status",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(statusBlock).toMatch(/type:\s*"customRender"/);
    expect(statusBlock).toMatch(/StatusBadge/);
    expect(statusBlock).toMatch(/QboSyncBadge/);
  });

  it("Quote status is justified customRender (StatusBadge + assessment sub-badges)", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    const statusBlock = cols.match(/id:\s*"status",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(statusBlock).toMatch(/type:\s*"customRender"/);
    expect(statusBlock).toMatch(/StatusBadge/);
  });
});

// ── 6. Jobs + Leads: EntityNumber pills keep their own typography ────────────

describe("EntityNumber pills are NOT constrained by row body typography", () => {
  it("Jobs jobNumber customRender renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Invoice invoiceNumber customRender renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Quote quoteNumber customRender renders <EntityNumber> (pill typography preserved)", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    expect(cols).toMatch(/<EntityNumber\b/);
  });

  it("Jobs jobNumber no longer renders a jobType sub-line (removed 2026-05-09)", () => {
    // jobType sub-line (<div className="text-slate-500 capitalize mt-0.5">) was
    // removed from the job number cell — job number column shows chip only.
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    expect(cols).not.toMatch(
      /<div className="text-slate-500 capitalize mt-0\.5">/,
    );
  });
});

// ── 7. Secondary metadata sub-lines — ENTITY_SECONDARY_CLASS contract ────────

describe("Secondary metadata sub-lines — ENTITY_SECONDARY_CLASS contract", () => {
  // Two paths to canonical secondary-line styling:
  //   A) entity-primary + secondary: prop → component applies ENTITY_SECONDARY_CLASS internally
  //   B) customRender with explicit secondary line → must use ENTITY_SECONDARY_CLASS constant

  it("Jobs entity-primary location column provides secondary: prop (component applies ENTITY_SECONDARY_CLASS)", () => {
    const cols = columnsArrayLiteral(jobsSrc, "liveJobColumns");
    const locBlock = cols.match(/id:\s*"location",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    // secondary: prop triggers ENTITY_SECONDARY_CLASS inside renderCellContent.
    expect(locBlock).toMatch(/secondary:\s*\(job\)/);
    // Inverse: no hardcoded copy of the canonical secondary class string.
    expect(locBlock).not.toMatch(/className="text-caption text-slate-500 font-normal/);
  });

  it("Leads entity-primary client column provides secondary: prop (component applies ENTITY_SECONDARY_CLASS)", () => {
    // 2026-05-09: Client is now the entity-primary column with location/city secondary.
    // Title was demoted to entity-text (no secondary) in the same reorder.
    const clientBlock = leadsSrc.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock, "client column block must exist").toBeTruthy();
    expect(clientBlock).toMatch(/secondary:\s*\(lead\)/);
    expect(clientBlock).not.toMatch(/className="text-caption text-slate-500 font-normal/);
  });

  it("Invoice client uses entity-primary — secondary applied by shared renderer (not hardcoded in page)", () => {
    // 2026-05-09: migrated from customRender to entity-primary with secondary: callback.
    // ENTITY_SECONDARY_CLASS is now applied by renderCellContent internally — not referenced
    // in the page source. This is the correct architecture: renderer owns the secondary typography.
    const cols = columnsArrayLiteral(invoicesSrc, "invoiceColumns");
    const clientBlock = cols.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).toMatch(/secondary:/);
    expect(clientBlock).not.toMatch(/ENTITY_SECONDARY_CLASS/);
    expect(clientBlock).not.toMatch(/className="text-caption text-slate-500 font-normal/);
  });

  it("Quote client uses entity-primary — secondary applied by shared renderer (not hardcoded in page)", () => {
    const cols = columnsArrayLiteral(quotesSrc, "quoteColumns");
    const clientBlock = cols.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).toMatch(/secondary:/);
    expect(clientBlock).not.toMatch(/ENTITY_SECONDARY_CLASS/);
    expect(clientBlock).not.toMatch(/className="text-caption text-slate-500 font-normal/);
  });
});

// ── 8. text-list-primary regression guardrails ────────────────────────────────
//
// A semantic text token silently fails if ANY of three wiring steps is missing:
//   Step 1 — tailwind.config.ts extend.fontSize: defines the CSS output.
//   Step 2 — extendTailwindMerge classGroups in utils.ts: without this,
//             cn("text-list-primary", "text-slate-800") silently drops
//             text-list-primary (tailwind-merge v2 treats unknown text-*
//             tokens as text-color utilities and evicts them when another
//             text-color class appears in the same call).
//   Step 3 — Applied on the innermost visible element, not only on a container
//             wrapper where it can be silently lost to a descendant cn() call.
//
// When adding a new Tailwind semantic text token:
//   1. Append to tailwind.config.ts extend.fontSize.
//   2. Append the token name to the classGroups text[] array in utils.ts.
//   3. Apply on the innermost visible element (not just a container).
//   4. Copy the "cn() survival" template below and add a survival test here.

describe("text-list-primary — token defined in tailwind.config.ts", () => {
  const decl = tailwindSrc.match(/"list-primary"\s*:\s*\[[\s\S]*?\]/)?.[0] ?? "";

  it("tailwind.config.ts has a fontSize entry named list-primary", () => {
    expect(decl).toBeTruthy();
  });

  it("token font-size is 15px", () => {
    expect(decl).toMatch(/\b15px\b/);
  });

  it("token line-height is 20px", () => {
    expect(decl).toMatch(/lineHeight[\s\S]*?20px/);
  });

  it("token font-weight is 500", () => {
    expect(decl).toMatch(/fontWeight[\s\S]*?500/);
  });
});

describe("text-list-primary — registered in extendTailwindMerge (utils.ts)", () => {
  it("utils.ts includes 'list-primary' in the tailwind-merge font-size classGroups", () => {
    // Without registration, tailwind-merge v2 treats text-list-primary as a
    // text-color utility. Any cn("text-list-primary", "text-slate-800") call
    // silently strips the font-size token and falls back to inherited body
    // typography in the rendered DOM.
    const fontSizeBlock = utilsSrc.match(/["']font-size["'][\s\S]*?\]/)?.[0] ?? "";
    expect(fontSizeBlock).toMatch(/"list-primary"/);
  });
});

describe("text-list-primary — cn() survival (tailwind-merge keeps the token)", () => {
  it("cn('text-base', 'text-list-primary') → text-list-primary present", () => {
    const result = cn("text-base", "text-list-primary");
    expect(result).toMatch(/\btext-list-primary\b/);
  });

  it("cn('text-base', 'text-list-primary') → text-base evicted (later font-size wins)", () => {
    const result = cn("text-base", "text-list-primary");
    expect(result).not.toMatch(/\btext-base\b/);
  });

  it("cn('text-caption', 'text-list-primary') → text-list-primary present", () => {
    const result = cn("text-caption", "text-list-primary");
    expect(result).toMatch(/\btext-list-primary\b/);
  });

  it("cn('text-list-primary', 'text-slate-800') → text-list-primary survives the color class", () => {
    // This was the original failure mode: without extendTailwindMerge,
    // text-list-primary would be treated as text-color and evicted by
    // text-slate-800, making typography experiments misleading.
    const result = cn("text-list-primary", "text-slate-800");
    expect(result).toMatch(/\btext-list-primary\b/);
  });

  it("cn('text-list-primary', 'text-slate-800') → both font-size and color survive", () => {
    const result = cn("text-list-primary", "text-slate-800");
    expect(result).toMatch(/\btext-slate-800\b/);
  });
});

describe("EntityListTable — text-list-primary on the visible element (not via wrapper inheritance only)", () => {
  const entityPrimaryCase = tableSrc.match(
    /case\s+"entity-primary":[\s\S]+?(?=case\s+"entity-text")/
  )?.[0] ?? "";

  it("entity-primary case exists", () => {
    expect(entityPrimaryCase).toBeTruthy();
  });

  it("inner primary line <div> carries text-list-primary directly on the element", () => {
    // kindCellClasses() also applies text-list-primary on the td wrapper (py-1.5
    // density experiment), but container-only inheritance is fragile — a child's
    // cn() call that adds a text-color class would silently evict the font-size
    // token from the wrapper. The inner visible element must carry it explicitly.
    // data-testid (optional testId prop) may appear alongside className.
    expect(entityPrimaryCase).toMatch(/className="text-list-primary truncate"/);
  });

  it("primary line does NOT fall back to text-base (inherited body default)", () => {
    const stripped = stripComments(entityPrimaryCase);
    expect(stripped).not.toMatch(/<div[^>]*\btext-base\b[^>]*>/);
  });

  it("primary line does NOT fall back to text-caption", () => {
    const stripped = stripComments(entityPrimaryCase);
    expect(stripped).not.toMatch(/<div[^>]*\btext-caption\b[^>]*>/);
  });

  it("primary line does NOT use an arbitrary text-[N]px class", () => {
    const stripped = stripComments(entityPrimaryCase);
    expect(stripped).not.toMatch(/<div[^>]*text-\[\d+px\][^>]*>/);
  });
});

// ── 9. Typography normalization — standard kinds use text-list-body ───────────
//
// All standard readable row content (text, body, date, money) must render at
// text-list-body (15px / 20px / 400). Only secondary/subordinate metadata
// (entity-primary secondary: lines → ENTITY_SECONDARY_CLASS → text-helper 13px)
// intentionally remains smaller. Chips (status, badge) keep their own sizing.

describe("kind normalization — text / body / date / money all map to text-list-body", () => {
  const fn = functionBody(tableSrc, "kindCellClasses");
  const stripped = stripComments(fn);

  it("text kind maps to text-list-body (15px/20px/400)", () => {
    expect(stripped).toMatch(/case\s+"text"[\s\S]+?text-list-body\b/);
  });

  it("body kind maps to text-list-body (15px/20px/400)", () => {
    expect(stripped).toMatch(/case\s+"body"[\s\S]+?text-list-body\b/);
  });

  it("date kind maps to text-list-body (15px/20px/400)", () => {
    expect(stripped).toMatch(/case\s+"date"[\s\S]+?text-list-body\b/);
  });

  it("money kind maps to text-list-body (15px/20px/400)", () => {
    expect(stripped).toMatch(/case\s+"money"[\s\S]+?text-list-body\b/);
  });

  it("no standard kind (text / body / date / money) uses text-helper", () => {
    // text-helper (13px) is intentionally reserved for secondary sub-lines only
    // (applied by renderCellContent for entity-primary secondary: props via
    // ENTITY_SECONDARY_CLASS). It must NOT appear in any kindCellClasses case.
    const textBranch  = stripped.match(/case\s+"text":[\s\S]+?(?=case\s+")/)?.[0] ?? "";
    const bodyBranch  = stripped.match(/case\s+"body":[\s\S]+?(?=case\s+")/)?.[0] ?? "";
    const dateBranch  = stripped.match(/case\s+"date":[\s\S]+?(?=case\s+")/)?.[0] ?? "";
    const moneyBranch = stripped.match(/case\s+"money":[\s\S]+?(?=case\s+")/)?.[0] ?? "";
    expect(textBranch).not.toMatch(/\btext-helper\b/);
    expect(bodyBranch).not.toMatch(/\btext-helper\b/);
    expect(dateBranch).not.toMatch(/\btext-helper\b/);
    expect(moneyBranch).not.toMatch(/\btext-helper\b/);
  });

  it("no standard kind uses text-caption", () => {
    expect(stripped).not.toMatch(/case\s+"text"[\s\S]+?text-caption\b/);
    expect(stripped).not.toMatch(/case\s+"body"[\s\S]+?text-caption\b/);
    expect(stripped).not.toMatch(/case\s+"date"[\s\S]+?text-caption\b/);
    expect(stripped).not.toMatch(/case\s+"money"[\s\S]+?text-caption\b/);
  });

  it("primary kind uses text-list-primary (500 weight — heavier than standard body)", () => {
    const primaryBranch = stripped.match(/case\s+"primary":[\s\S]+?(?=case\s+")/)?.[0] ?? "";
    expect(primaryBranch).toMatch(/\btext-list-primary\b/);
    expect(primaryBranch).not.toMatch(/\btext-list-body\b/);
  });

  it("status and badge kinds keep text-row (chips own their own typography)", () => {
    expect(stripped).toMatch(/case\s+"status"[\s\S]+?text-row\b/);
    expect(stripped).toMatch(/case\s+"badge"[\s\S]+?text-row\b/);
  });
});

describe("secondary sub-lines intentionally remain smaller (text-helper 13px preserved)", () => {
  it("ENTITY_SECONDARY_CLASS still contains text-helper (secondary remains subordinate)", () => {
    // The only intentional text-helper path is entity-primary secondary: lines.
    // Changing this would collapse the visual hierarchy between primary names and
    // their subordinate metadata lines.
    expect(surfaceSrc).toMatch(/ENTITY_SECONDARY_CLASS\s*=\s*["'][^"']*\btext-helper\b/);
  });

  it("ENTITY_SECONDARY_CLASS does not use text-list-body (secondary must stay smaller than 15px)", () => {
    const declLine = surfaceSrc.match(/ENTITY_SECONDARY_CLASS\s*=\s*["'][^"']*/)?.[0] ?? "";
    expect(declLine).not.toMatch(/\btext-list-body\b/);
    expect(declLine).not.toMatch(/\btext-list-primary\b/);
  });
});
