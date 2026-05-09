/**
 * EntityListTable canonical architecture guard (2026-05-09).
 *
 * Locks the descriptor-based rendering contract across all 8 core list pages.
 * This test FAILS if:
 *   - A page stops importing or rendering EntityListTable
 *   - A page imports the shadcn Table / ListSurface helpers (PMWorkspacePage
 *     specifically was the last to migrate — extra guard there)
 *   - A page passes the removed cellClassName or headerClassName props
 *   - A page defines a local SortableHeaderCell or SortHeader component
 *     (sorting must go through EntityListTable's sortKey / onSort path)
 *   - The total customRender count changes (new customRender must be added
 *     to the allowlist with an explicit justification)
 *   - A customRender render function re-introduces legacy text-size classes
 *   - Status columns revert from entity-status to ad-hoc customRender without
 *     a documented multi-badge justification
 *
 * To add a new customRender:
 *   1. Add it to CUSTOM_RENDER_ALLOWLIST with a justification string.
 *   2. Increment the page `count` and the total.
 *   3. This file documents the debt — the allowlist IS the audit trail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const PAGE_PATHS = {
  jobs:      "client/src/pages/Jobs.tsx",
  invoices:  "client/src/pages/InvoicesListPage.tsx",
  leads:     "client/src/pages/LeadsPage.tsx",
  quotes:    "client/src/pages/Quotes.tsx",
  clients:   "client/src/pages/Clients.tsx",
  locations: "client/src/pages/Locations.tsx",
  suppliers: "client/src/pages/SuppliersListPage.tsx",
  pm:        "client/src/pages/PMWorkspacePage.tsx",
} as const;

type PageKey = keyof typeof PAGE_PATHS;

const srcs = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([k, p]) => [k, readFileSync(resolve(ROOT, p), "utf-8")])
) as Record<PageKey, string>;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function countMatches(src: string, pattern: string): number {
  return (src.match(new RegExp(pattern, "g")) ?? []).length;
}

// ── 1. All pages import and render EntityListTable ────────────────────────────

describe("All 8 core list pages import EntityListTable", () => {
  const importRe = /import\s*\{[^}]*EntityListTable[^}]*\}\s*from\s*["']@\/components\/lists\/EntityListTable["']/;
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} imports EntityListTable`, () => {
      expect(srcs[key]).toMatch(importRe);
    });
  }
});

describe("All 8 core list pages render <EntityListTable", () => {
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} renders EntityListTable`, () => {
      expect(srcs[key]).toMatch(/<EntityListTable[\s<]/);
    });
  }
});

// ── 2. PMWorkspacePage — no shadcn Table / ListSurface remnants ───────────────

describe("PMWorkspacePage — banned shadcn Table and ListSurface imports removed", () => {
  it("does not import Table from @/components/ui/table", () => {
    expect(srcs.pm).not.toMatch(
      /import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*["']@\/components\/ui\/table["']/,
    );
  });

  it("does not reference ListSurface", () => {
    expect(stripComments(srcs.pm)).not.toMatch(/\bListSurface\b/);
  });

  it("does not reference tableRowClass, listPrimaryClass, or listSecondaryClass", () => {
    const code = stripComments(srcs.pm);
    expect(code).not.toMatch(/\btableRowClass\b/);
    expect(code).not.toMatch(/\blistPrimaryClass\b/);
    expect(code).not.toMatch(/\blistSecondaryClass\b/);
  });
});

// ── 3. No page passes removed escape-hatch props ──────────────────────────────

describe("No page passes cellClassName or headerClassName (removed props)", () => {
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} has no cellClassName or headerClassName`, () => {
      const code = stripComments(srcs[key]);
      expect(code).not.toMatch(/\bcellClassName\b/);
      expect(code).not.toMatch(/\bheaderClassName\b/);
    });
  }
});

// ── 4. No page-owned sort component ──────────────────────────────────────────

describe("No page defines a local SortableHeaderCell or SortHeader component", () => {
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} has no SortableHeaderCell or SortHeader function definition`, () => {
      const code = stripComments(srcs[key]);
      // makeSortHandler (PMWorkspacePage) is NOT a JSX component — it's a
      // factory function that returns an onSort callback. The banned pattern
      // is a React component (renders JSX with a sort icon).
      expect(code).not.toMatch(/function\s+SortableHeaderCell\s*[(<]/);
      expect(code).not.toMatch(/function\s+SortHeader\s*[(<]/);
    });
  }
});

// ── 5. Columns use cell: descriptor (not legacy open render:) ─────────────────

describe("Column definitions use cell: descriptor property", () => {
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} column objects include cell: descriptor`, () => {
      expect(srcs[key]).toMatch(/cell:\s*\{/);
    });
  }

  it("EntityListColumn interface does not expose a top-level render property", () => {
    const tableSrc = readFileSync(
      resolve(ROOT, "client/src/components/lists/EntityListTable.tsx"),
      "utf-8",
    );
    // The interface block must not have `render?:` as a direct property.
    // (customRender's `render:` lives inside the EntityListCell union, not
    // as a column-level property.)
    const interfaceBlock = tableSrc.match(/export interface EntityListColumn[\s\S]+?^}/m)?.[0] ?? "";
    expect(interfaceBlock).not.toMatch(/^\s+render\?:/m);
  });
});

// ── 6. customRender allowlist ─────────────────────────────────────────────────

/**
 * CUSTOMRENDER ALLOWLIST
 *
 * Every `type: "customRender"` cell in every core list page is documented
 * here. Justification codes:
 *
 *   ACTION_BUTTON    — interactive button with mutation state
 *   BADGE_COMPONENT  — single domain-specific badge/icon component
 *   CHECKBOX         — interactive checkbox with selection state machine
 *   COMPUTED_FORMAT  — local helper function or complex formatting branch
 *   CONDITIONAL      — multi-branch render (active/inactive icons, balance color)
 *   DATA_TESTID      — primary line needs a data-testid for E2E assertions
 *   ICON_COMPOSITE   — icon + text / icon + badge composition
 *   MULTI_BADGE      — two or more badge/chip components side by side
 *   TAG_PILLS        — flex-wrap dynamic pill array from tag data
 *
 * 2026-05-09 descriptor refinement: 9 cells migrated off customRender
 * (45 → 36 total). Removed justification codes: CAPITALIZE (Leads
 * source/priority → entity-text). Migrations: Inventory unit_cost /
 * unit_price → entity-money; LowStock minimum / reorder → entity-text;
 * WorkDue:frequency → entity-primary; Plans:nextDue → entity-date;
 * Plans:status → entity-status.
 */
const CUSTOM_RENDER_ALLOWLIST: Record<PageKey, { count: number; entries: string[] }> = {
  jobs: {
    count: 4,
    entries: [
      "liveJobColumns:jobNumber — DATA_TESTID (EntityNumber + data-testid wrapper; jobType sub-line removed 2026-05-09)",
      "liveJobColumns:schedule  — ICON_COMPOSITE (CalendarIcon + formatted date; conditional 'Not scheduled')",
      "historyJobColumns:jobNumber — ICON_COMPOSITE (EntityNumber; no data-testid)",
      "historyJobColumns:schedule  — ICON_COMPOSITE (same as live)",
    ],
  },
  invoices: {
    count: 4,
    entries: [
      "invoiceColumns:select        — CHECKBOX",
      // client migrated to entity-primary with testId prop (2026-05-09 typography drift fix)
      "invoiceColumns:invoiceNumber — DATA_TESTID (EntityNumber with data-testid)",
      "invoiceColumns:status        — MULTI_BADGE (StatusBadge + QboSyncBadge)",
      "invoiceColumns:balance       — CONDITIONAL (paid-in-full muted vs balance with font-medium)",
    ],
  },
  leads: {
    count: 0,
    entries: [],
    // source + priority migrated to entity-text (2026-05-09 descriptor refinement)
  },
  quotes: {
    count: 2,
    entries: [
      // client migrated to entity-primary with testId prop (2026-05-09 typography drift fix)
      "quoteColumns:quoteNumber — DATA_TESTID (EntityNumber with data-testid)",
      "quoteColumns:status      — MULTI_BADGE (StatusBadge + 3 conditional assessment sub-badges)",
    ],
  },
  clients: {
    count: 2,
    entries: [
      "clientColumns:select — CHECKBOX",
      "clientColumns:tags   — TAG_PILLS (flex-wrap color-coded tag pills from dynamic data)",
    ],
  },
  locations: {
    count: 2,
    entries: [
      "locationColumns:select — CHECKBOX",
      "locationColumns:tags   — TAG_PILLS (flex-wrap color-coded tag pills from dynamic data)",
    ],
  },
  suppliers: {
    count: 2,
    entries: [
      "SUPPLIER_COLUMNS:name   — ICON_COMPOSITE (Building2 icon + supplier name)",
      "SUPPLIER_COLUMNS:active — CONDITIONAL (CheckCircle2 or XCircle icon based on status)",
    ],
  },
  pm: {
    count: 7,
    entries: [
      // WorkDue tab (5; frequency migrated to entity-primary 2026-05-09; plan + serviceAddress added 2026-05-09)
      "workDueColumns:plan          — COMPUTED_FORMAT (text-list-body/400 weight — entity-primary bakes 500)",
      "workDueColumns:serviceAddress — COMPUTED_FORMAT (two-line: street text-list-body + city/province/postal text-helper)",
      "workDueColumns:dueDate       — COMPUTED_FORMAT (date range windowStart → windowEnd; two lines)",
      "workDueColumns:status        — BADGE_COMPONENT (WorkDueStatusBadge with compliance-priority logic)",
      "workDueColumns:action        — ACTION_BUTTON (generate button with per-row pending/loading state)",
      // Plans tab (1; nextDue → entity-date, status → entity-status 2026-05-09)
      "plansColumns:plan    — CONDITIONAL (title + 'Recurring' badge only for non-PM job types)",
      // Templates tab (1)
      "templatesColumns:pricing — COMPUTED_FORMAT (price + billingMode multi-branch; 4 states)",
    ],
  },
};

const ALLOWLIST_TOTAL = Object.values(CUSTOM_RENDER_ALLOWLIST).reduce(
  (sum, { count }) => sum + count,
  0,
);

describe("customRender allowlist — exact counts", () => {
  for (const key of Object.keys(CUSTOM_RENDER_ALLOWLIST) as PageKey[]) {
    const { count } = CUSTOM_RENDER_ALLOWLIST[key];
    it(`${key} has exactly ${count} customRender cell(s)`, () => {
      const actual = countMatches(srcs[key], 'type:\\s*"customRender"');
      expect(actual).toBe(count);
    });
  }

  it(`total across all 8 pages is ${ALLOWLIST_TOTAL}`, () => {
    const total = Object.values(srcs).reduce(
      (sum, src) => sum + countMatches(src, 'type:\\s*"customRender"'),
      0,
    );
    expect(total).toBe(ALLOWLIST_TOTAL);
  });
});

// ── 6b. customRender guardrail — every cell must declare a reason ────────────

describe("customRender guardrail — every cell must declare a non-empty reason field", () => {
  for (const key of Object.keys(PAGE_PATHS) as PageKey[]) {
    it(`${key} — every customRender cell has a reason: field`, () => {
      const code = stripComments(srcs[key]);
      // Find each customRender block (up to ~400 chars after the type marker)
      const blocks = code.match(/type:\s*"customRender"[\s\S]{0,400}/g) ?? [];
      const missing = blocks.filter((b) => !/reason:\s*"[^"]+/.test(b));
      expect(
        missing,
        `${key}: ${missing.length} customRender(s) missing a non-empty reason string`,
      ).toHaveLength(0);
    });
  }
});

// ── 6c. descriptor-first — primary cells must use typed descriptors ───────────

describe("descriptor-first — entity-primary used for primary cells (not customRender)", () => {
  it("invoices client column uses entity-primary, not customRender", () => {
    const code = stripComments(srcs.invoices);
    const clientBlock = code.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).not.toMatch(/type:\s*"customRender"/);
  });

  it("quotes client column uses entity-primary, not customRender", () => {
    const code = stripComments(srcs.quotes);
    const clientBlock = code.match(/id:\s*"client",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(clientBlock).toMatch(/type:\s*"entity-primary"/);
    expect(clientBlock).not.toMatch(/type:\s*"customRender"/);
  });
});

// ── 7. No legacy text-size ramp inside any page ───────────────────────────────

describe("No legacy text-size ramp classes in core list page column arrays", () => {
  // Column arrays that can be isolated — checked individually to scope
  // false-positives from toolbar / filter UI that legitimately uses text-xs.
  const FORBIDDEN_SIZE_RE =
    /className=["`][^"`]*\btext-(?:xs|sm|base|lg|xl|2xl|3xl)\b[^"`]*["`]/;

  // Pages whose column arrays are module-scoped constants or easily extractable.
  it("pm — no legacy size ramp anywhere in file", () => {
    const code = stripComments(srcs.pm);
    expect(code).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|2xl)\b/);
  });

  it("suppliers SUPPLIER_COLUMNS — no legacy size ramp in column array", () => {
    // Suppliers is module-scoped (no toolbar UI that might add text-xs).
    const start = srcs.suppliers.indexOf("const SUPPLIER_COLUMNS");
    const snippet = srcs.suppliers.slice(start, start + 3000);
    expect(snippet).not.toMatch(FORBIDDEN_SIZE_RE);
  });
});

// ── 8. entity-status canonical path ──────────────────────────────────────────

describe("Status columns use entity-status descriptor where a single chip is correct", () => {
  it("Jobs liveJobColumns status → entity-status (not customRender)", () => {
    expect(srcs.jobs).toMatch(/id:\s*"status"[\s\S]{0,200}?type:\s*"entity-status"/);
  });

  it("Jobs has at least 2 entity-status cells (live + history)", () => {
    const hits = srcs.jobs.match(/type:\s*"entity-status"/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("Leads LEAD_COLUMNS status → entity-status (not customRender)", () => {
    expect(srcs.leads).toMatch(/id:\s*"status"[\s\S]{0,200}?type:\s*"entity-status"/);
  });

  it("Clients locationColumns status → entity-status", () => {
    expect(srcs.clients).toMatch(/id:\s*"status"[\s\S]{0,200}?type:\s*"entity-status"/);
  });

  it("Locations locationColumns status → entity-status", () => {
    expect(srcs.locations).toMatch(/id:\s*"status"[\s\S]{0,200}?type:\s*"entity-status"/);
  });

  it("Invoices status is customRender — justified (multi-badge: StatusBadge + QboSyncBadge)", () => {
    // Pin as customRender so the test breaks if someone migrates it to
    // entity-status without also removing QboSyncBadge.
    const invoiceStatusBlock =
      srcs.invoices.match(/id:\s*"status",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(invoiceStatusBlock).toMatch(/type:\s*"customRender"/);
    expect(invoiceStatusBlock).toMatch(/QboSyncBadge/);
  });

  it("Quotes status is customRender — justified (multi-badge: StatusBadge + assessment badges)", () => {
    const quotesStatusBlock =
      srcs.quotes.match(/id:\s*"status",[\s\S]+?(?=\{\s*id:\s*")/)?.[0] ?? "";
    expect(quotesStatusBlock).toMatch(/type:\s*"customRender"/);
    expect(quotesStatusBlock).toMatch(/StatusBadge/);
  });
});

// ── 9. text-list-primary three-layer wiring contract ─────────────────────────
//
// A semantic text token silently fails if any one of three layers is broken:
//   Layer 1 — tailwind.config.ts: defines the CSS output (font-size / line-height / weight).
//   Layer 2 — utils.ts extendTailwindMerge: prevents cn() from treating text-{token}
//              as a text-color class and stripping it when co-located with text-slate-800.
//   Layer 3 — innermost visible element: the token must appear on the rendered element,
//              not just on a container wrapper that could be bypassed by a child cn() call.
//
// Detailed runtime cn() survival tests live in entity-list-row-typography.test.ts § 8.

describe("text-list-primary — three-layer wiring contract", () => {
  const tableSrc = readFileSync(
    resolve(ROOT, "client/src/components/lists/EntityListTable.tsx"),
    "utf-8",
  );
  const utilsSrc = readFileSync(resolve(ROOT, "client/src/lib/utils.ts"), "utf-8");
  const tailwindSrc = readFileSync(resolve(ROOT, "tailwind.config.ts"), "utf-8");

  it("Layer 1: tailwind.config.ts defines the list-primary fontSize token", () => {
    expect(tailwindSrc).toMatch(/"list-primary"\s*:/);
  });

  it("Layer 2: utils.ts extendTailwindMerge registers list-primary in font-size classGroups", () => {
    // Without this, cn("text-list-primary", "text-slate-800") silently strips
    // the font-size and the token never reaches the rendered DOM.
    const fontSizeBlock = utilsSrc.match(/["']font-size["'][\s\S]*?\]/)?.[0] ?? "";
    expect(fontSizeBlock).toMatch(/"list-primary"/);
  });

  it("Layer 3a: EntityListTable kindCellClasses applies text-list-primary on the primary td wrapper", () => {
    expect(tableSrc).toMatch(/case\s+"primary":[\s\S]{0,150}?\btext-list-primary\b/);
  });

  it("Layer 3b: EntityListTable entity-primary inner line carries text-list-primary directly on the element", () => {
    // Defense-in-depth: the innermost visible div must carry the token so it
    // cannot be lost via a descendant cn() merge that introduces a text-color class.
    // data-testid may appear alongside className on the same element.
    expect(tableSrc).toMatch(/className="text-list-primary truncate"/);
  });
});
