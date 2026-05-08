/**
 * Canonical chip primitive source-pin tests (2026-05-08).
 *
 * Pins the API + class contracts for the Phase 1 chip canonicalization
 * (`client/src/components/ui/chip.tsx` + `client/src/lib/chipVariants.ts`).
 *
 * Note on file extension: the codebase's vitest config (`environment:
 * "node"`, `include: tests/** /*.test.ts`) does not run JSX-render
 * tests, so this file is `.test.ts` not `.test.tsx`. The drift-
 * prevention contract is achieved by reading the source files and
 * pinning the strings — same pattern as `tests/form-field-canonical.
 * test.ts` and other canonical-primitive tests in this repo.
 *
 * These pins fail if a future edit:
 *   - drops one of the 4 exported primitives (Chip / StatusChip /
 *     EntityChip / FilterChip),
 *   - changes the canonical tone palette in chipVariants.ts,
 *   - introduces a parallel chip primitive elsewhere,
 *   - bakes hardcoded chip classes into a migrated consumer
 *     (status-pill, EntityNumber primary, ClientDetailPage
 *     FilterChips, NotesPanel visibility chips).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CHIP_PATH = resolve(
  __dirname,
  "../client/src/components/ui/chip.tsx",
);
const VARIANTS_PATH = resolve(
  __dirname,
  "../client/src/lib/chipVariants.ts",
);

const chipSrc = readFileSync(CHIP_PATH, "utf-8");
const variantsSrc = readFileSync(VARIANTS_PATH, "utf-8");

// Code-only views — strip block + line comments so doc-comment
// commentary doesn't false-match negative pins below.
const chipCode = chipSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const variantsCode = variantsSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. chipVariants.ts — canonical cva contract ──────────────────

describe("chipVariants — single source of truth for chip visual contract", () => {
  it("uses class-variance-authority (cva)", () => {
    expect(variantsSrc).toMatch(
      /import\s*\{\s*cva,\s*type\s+VariantProps\s*\}\s*from\s*["']class-variance-authority["']/,
    );
  });

  it("exports the canonical `chipVariants` cva", () => {
    expect(variantsSrc).toMatch(/export const chipVariants\s*=\s*cva\(/);
  });

  it("locks `rounded-full` on every chip (capsule shape)", () => {
    expect(variantsSrc).toMatch(/rounded-full/);
  });

  it("locks `text-helper` typography (NOT `text-xs` / size-ramp legacy)", () => {
    // text-helper is the canonical 13px / 500 token per CLAUDE.md
    // "Phase H1: Typography Primitives".
    expect(variantsCode).toMatch(/text-helper\s+font-medium/);
  });

  it("does NOT use the legacy `text-xs` size on the base chip class", () => {
    // The base cva class string locks `text-helper`. A `text-xs` here
    // would be a regression to the legacy size ramp.
    const baseStringMatch = variantsCode.match(
      /export const chipVariants\s*=\s*cva\(\s*\[([\s\S]*?)\]\.join/,
    );
    expect(baseStringMatch).not.toBeNull();
    expect(baseStringMatch![1]).not.toMatch(/text-xs/);
  });

  it("supports keyboard accessibility (focus-visible ring) on the base chip", () => {
    expect(variantsCode).toMatch(/focus-visible:ring-2/);
    expect(variantsCode).toMatch(/focus-visible:ring-ring/);
  });

  it("supports a `disabled` state (opacity + pointer-events) on the base chip", () => {
    expect(variantsCode).toMatch(
      /disabled:opacity-50\s+disabled:pointer-events-none/,
    );
  });
});

describe("chipVariants — tone variant covers the canonical 7-tone vocabulary", () => {
  for (const tone of [
    "neutral",
    "success",
    "warning",
    "danger",
    "info",
    "purple",
    "active",
  ]) {
    it(`declares tone variant: ${tone}`, () => {
      // Tone keys live inside the cva variants block.
      expect(variantsCode).toMatch(new RegExp(`\\b${tone}\\b\\s*:\\s*TONE_`));
    });
  }

  it("exports the canonical `ChipTone` type", () => {
    expect(variantsSrc).toMatch(/export type ChipTone\s*=/);
  });
});

describe("chipVariants — size variant covers default + compact", () => {
  it("declares `default` size as 28px (`h-7 px-3`)", () => {
    expect(variantsCode).toMatch(/default:\s*"h-7 px-3"/);
  });

  it("declares `compact` size as 24px (`h-6 px-2.5`) for StatusPill back-compat", () => {
    expect(variantsCode).toMatch(/compact:\s*"h-6 px-2.5"/);
  });
});

describe("chipVariants — variant covers subtle + outline + solid", () => {
  for (const v of ["subtle", "outline", "solid"]) {
    it(`declares variant: ${v}`, () => {
      expect(variantsCode).toMatch(new RegExp(`\\b${v}\\b\\s*:`));
    });
  }
});

describe("chipVariants — interactive + selected variants", () => {
  it("declares interactive variant with hover/cursor classes", () => {
    expect(variantsCode).toMatch(
      /interactive:\s*\{[\s\S]*?true:\s*"cursor-pointer hover:brightness-95/,
    );
  });

  it("declares selected variant", () => {
    expect(variantsCode).toMatch(/selected:\s*\{[\s\S]*?true:\s*"/);
  });
});

describe("chipVariants — status + entity tone maps", () => {
  it("exports `STATUS_TO_CHIP_TONE` covering job + invoice + quote + lead lifecycles", () => {
    expect(variantsSrc).toMatch(
      /export const STATUS_TO_CHIP_TONE:\s*Record<string,\s*ChipTone>/,
    );
    // Spot-check the canonical lifecycle strings.
    for (const status of [
      "open",
      "draft",
      "completed",
      "invoiced",
      "paid",
      "in_progress",
      "on_hold",
      "overdue",
      "voided",
      "cancelled",
      "approved",
      "declined",
    ]) {
      expect(variantsCode).toMatch(
        new RegExp(`\\b${status}:\\s*"(neutral|success|warning|danger|info|purple|active)"`),
      );
    }
  });

  it("exports `statusToChipTone(status)` with neutral fallback for unknown strings", () => {
    expect(variantsSrc).toMatch(
      /export function statusToChipTone\(status:\s*string\):\s*ChipTone\s*\{[\s\S]*?STATUS_TO_CHIP_TONE\[status\]\s*\?\?\s*"neutral"/,
    );
  });

  it("exports `ENTITY_TO_CHIP_TONE` covering job/invoice/quote/maintenance/default", () => {
    expect(variantsSrc).toMatch(
      /export const ENTITY_TO_CHIP_TONE:\s*Record<ChipEntity,\s*ChipTone>/,
    );
    expect(variantsCode).toMatch(/job:\s*"info"/);
    expect(variantsCode).toMatch(/invoice:\s*"success"/);
    expect(variantsCode).toMatch(/quote:\s*"purple"/);
    expect(variantsCode).toMatch(/maintenance:\s*"warning"/);
    expect(variantsCode).toMatch(/default:\s*"neutral"/);
  });

  it("exports the canonical `ChipEntity` type", () => {
    expect(variantsSrc).toMatch(
      /export type ChipEntity\s*=\s*"job"\s*\|\s*"invoice"\s*\|\s*"quote"\s*\|\s*"maintenance"\s*\|\s*"default"/,
    );
  });
});

// ── 2. chip.tsx — primitive exports + composition ────────────────

describe("chip.tsx — exports the 4 canonical primitives", () => {
  for (const name of ["Chip", "StatusChip", "EntityChip", "FilterChip"]) {
    it(`exports ${name}`, () => {
      expect(chipSrc).toMatch(new RegExp(`export const ${name}`));
    });
    it(`${name} sets a displayName`, () => {
      // forwardRef'd components either set displayName explicitly or
      // use a named function so React DevTools can render the name.
      // The cheapest pin is "either displayName=... or function NAME".
      const hasDisplayName = new RegExp(`${name}\\.displayName\\s*=`).test(chipSrc);
      const hasNamedFunction = new RegExp(`function ${name}\\b`).test(chipSrc);
      expect(hasDisplayName || hasNamedFunction).toBe(true);
    });
  }
});

describe("chip.tsx — every wrapper composes chipVariants (no parallel class strings)", () => {
  it("imports `chipVariants` from `@/lib/chipVariants`", () => {
    expect(chipSrc).toMatch(
      /import\s*\{[\s\S]*?\bchipVariants\b[\s\S]*?\}\s*from\s*["']@\/lib\/chipVariants["']/,
    );
  });

  it("does NOT define a parallel cva or class-string-record outside chipVariants.ts", () => {
    // Negative pin: chip.tsx must not redeclare its own tone palette.
    expect(chipCode).not.toMatch(/cva\(/);
    // Negative pin: no Record<ChipTone, string> tone-class map should
    // exist in chip.tsx — the only one is in chipVariants.ts.
    expect(chipCode).not.toMatch(/Record<ChipTone,\s*string>/);
  });
});

describe("StatusChip — non-interactive, defaults to compact size for back-compat", () => {
  it("defaults size to 'compact' (24px — preserves StatusPill height)", () => {
    expect(chipSrc).toMatch(
      /export const StatusChip[\s\S]*?size\s*=\s*"compact"/,
    );
  });

  it("forces `interactive: false` so status pills are read-only", () => {
    expect(chipSrc).toMatch(
      /export const StatusChip[\s\S]*?interactive=\{false\}/,
    );
  });

  it("resolves a raw `status` string via `statusToChipTone` when no `tone` is passed", () => {
    expect(chipSrc).toMatch(
      /tone\s*\?\?\s*\(status\s*\?\s*statusToChipTone\(status\)\s*:\s*"neutral"\)/,
    );
  });
});

describe("EntityChip — render mode depends on href / onClick", () => {
  it("renders a wouter <Link> when `href` is set", () => {
    expect(chipSrc).toMatch(
      /export const EntityChip[\s\S]*?if\s*\(href\)\s*\{[\s\S]*?<Link\b[\s\S]*?href=\{href\}/,
    );
  });

  it("renders a <button> when `onClick` is set without `href`", () => {
    expect(chipSrc).toMatch(
      /export const EntityChip[\s\S]*?if\s*\(onClick\)\s*\{[\s\S]*?<button\s+ref=\{ref/,
    );
  });

  it("renders a <span> when neither href nor onClick is set (static display)", () => {
    expect(chipSrc).toMatch(
      /export const EntityChip[\s\S]*?return\s*\(\s*<span\s+ref=\{ref/,
    );
  });

  it("flips `interactive: true` automatically when href OR onClick is set", () => {
    expect(chipSrc).toMatch(
      /isInteractive\s*=\s*Boolean\(href\s*\|\|\s*onClick\)/,
    );
  });

  it("imports the wouter Link primitive (canonical client routing)", () => {
    expect(chipSrc).toMatch(/import\s*\{\s*Link\s*\}\s*from\s*["']wouter["']/);
  });
});

describe("FilterChip — keyboard-accessible toggle with selected state", () => {
  it("requires an explicit `selected: boolean` prop (no default)", () => {
    expect(chipSrc).toMatch(/selected:\s*boolean/);
  });

  it("renders a <button type=\"button\"> with `aria-pressed={selected}`", () => {
    expect(chipSrc).toMatch(
      /export const FilterChip[\s\S]*?<button[\s\S]*?type="button"[\s\S]*?aria-pressed=\{selected\}/,
    );
  });

  it("uses `tone: selectedTone` (default \"active\") + `variant: 'solid'` when selected", () => {
    // Phase 3a opened up the selected fill: the literal `"active"` is
    // now `selectedTone` (a prop with default `"active"` — see the
    // dedicated FilterChip selectedTone API tests below).
    expect(chipSrc).toMatch(
      /tone:\s*selected\s*\?\s*selectedTone\s*:\s*unselectedTone/,
    );
    expect(chipSrc).toMatch(
      /variant:\s*selected\s*\?\s*"solid"\s*:\s*"subtle"/,
    );
  });

  it("forces `interactive: true` so hover + cursor + focus ring are always on", () => {
    expect(chipSrc).toMatch(
      /export const FilterChip[\s\S]*?interactive:\s*true/,
    );
  });

  it("supports a `loading` state that disables the button", () => {
    expect(chipSrc).toMatch(/disabled=\{disabled\s*\|\|\s*loading\}/);
  });

  it("supports a `leadingIcon` slot (icons + label rhythm)", () => {
    expect(chipSrc).toMatch(
      /export const FilterChip[\s\S]*?leadingIcon/,
    );
  });
});

// ── 3. Chip base — leading/trailing icons + loading state ──────

describe("Chip (base) — slots for leading/trailing icons + loading", () => {
  it("declares `leadingIcon`, `trailingIcon`, and `loading` props on ChipContentProps", () => {
    expect(chipSrc).toMatch(/leadingIcon\?:\s*React\.ReactNode/);
    expect(chipSrc).toMatch(/trailingIcon\?:\s*React\.ReactNode/);
    expect(chipSrc).toMatch(/loading\?:\s*boolean/);
  });

  it("swaps the leading slot for a Loader2 spinner when loading", () => {
    expect(chipSrc).toMatch(
      /loading\s*\?\s*\(\s*<Loader2\b/,
    );
    expect(chipSrc).toMatch(
      /import\s*\{\s*Loader2\s*\}\s*from\s*["']lucide-react["']/,
    );
  });

  it("hides the trailing icon while loading (avoid double-icon flash)", () => {
    // Pattern: `{!loading && trailingIcon}`
    expect(chipSrc).toMatch(/!loading\s*&&\s*trailingIcon/);
  });
});

// ── 4. Migrated-consumer drift protection ─────────────────────

describe("status-pill.tsx — back-compat re-export of StatusChip (no parallel pill primitive)", () => {
  const STATUS_PILL_PATH = resolve(
    __dirname,
    "../client/src/components/ui/status-pill.tsx",
  );
  const statusPillSrc = readFileSync(STATUS_PILL_PATH, "utf-8");
  const statusPillCode = statusPillSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("status-pill.tsx no longer defines its own variantClasses Record", () => {
    expect(statusPillCode).not.toMatch(/variantClasses:\s*Record<PillVariant/);
  });

  it("status-pill.tsx re-exports StatusChip as StatusPill (or uses it internally)", () => {
    expect(statusPillSrc).toMatch(
      /from\s*["']@\/components\/ui\/chip["']|from\s*["']\.\/chip["']/,
    );
  });

  it("status-pill.tsx no longer hardcodes the rounded-full + h-6 px-2.5 chip class string", () => {
    // The pill class lived inline as
    // `rounded-full border px-2.5 h-6 text-xs font-medium leading-none gap-1`.
    // Post-migration that string moves into the canonical primitive.
    expect(statusPillCode).not.toMatch(
      /rounded-full\s+border\s+px-2\.5\s+h-6\s+text-xs/,
    );
  });
});

describe("EntityNumber primary — composes EntityChip (no parallel job-number pill)", () => {
  const ENTITY_NUMBER_PATH = resolve(
    __dirname,
    "../client/src/components/common/EntityNumber.tsx",
  );
  const src = readFileSync(ENTITY_NUMBER_PATH, "utf-8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("imports EntityChip from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bEntityChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("does NOT keep the legacy hardcoded blue pill class string for the primary variant", () => {
    // Pre-migration: bg-blue-50/70 text-blue-700 border-blue-100.
    // Post-migration that visual is owned by EntityChip's "job" entity.
    expect(code).not.toMatch(/bg-blue-50\/70\s+text-blue-700\s+border-blue-100/);
  });
});

describe("ClientDetailPage — FilterChips local generic replaced by canonical FilterChip", () => {
  const CDP_PATH = resolve(
    __dirname,
    "../client/src/pages/ClientDetailPage.tsx",
  );
  const src = readFileSync(CDP_PATH, "utf-8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("imports FilterChip from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bFilterChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  // Scope the FilterChips-function drift pins to the function body
  // itself — the page also has unrelated location scope pills that
  // share the brand color and are intentionally NOT migrated in
  // Phase 1 (different concern: scope picker with truncation, not a
  // list-page filter). Phase 2 covers those.
  function getFilterChipsBody(): string {
    // Anchor on the function signature; stop at the next top-level
    // type/function declaration that follows it. The post-migration
    // FilterChips function is followed by `type JobFilter = ...`.
    const m = code.match(
      /function FilterChips<T extends string>[\s\S]*?(?=\n(?:type|function|const|export)\s)/,
    );
    expect(m).not.toBeNull();
    return m![0];
  }

  it("FilterChips function body uses <FilterChip> (no inline rounded-full chip JSX)", () => {
    expect(getFilterChipsBody()).toMatch(/<FilterChip\b/);
  });

  it("FilterChips function body does NOT keep the inline `bg-[#76B054]` selected-pill class", () => {
    expect(getFilterChipsBody()).not.toMatch(/bg-\[#76B054\]/);
  });

  it("FilterChips function body does NOT keep the legacy `rounded-full px-2.5 py-0.5 text-xs` chip shell", () => {
    expect(getFilterChipsBody()).not.toMatch(
      /rounded-full\s+px-2\.5\s+py-0\.5\s+text-xs/,
    );
  });
});

describe("EntityNotesPanel — visibility chips use canonical EntityChip", () => {
  // 2026-05-08 Tier 4 Notes canonicalization — `NotesPanel` was
  // absorbed into the canonical `EntityNotesPanel`. The visibility
  // chip contract is preserved verbatim on the new component.
  const NP_PATH = resolve(
    __dirname,
    "../client/src/components/notes/EntityNotesPanel.tsx",
  );
  const src = readFileSync(NP_PATH, "utf-8");

  it("imports EntityChip from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bEntityChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("renders the Jobs/Invoices/Quotes visibility pills as <EntityChip entity=...>", () => {
    expect(src).toMatch(
      /<EntityChip\s+entity="job"[\s\S]*?Jobs\s*<\/EntityChip>/,
    );
    expect(src).toMatch(
      /<EntityChip\s+entity="invoice"[\s\S]*?Invoices\s*<\/EntityChip>/,
    );
    expect(src).toMatch(
      /<EntityChip\s+entity="quote"[\s\S]*?Quotes\s*<\/EntityChip>/,
    );
  });
});

// ── 5. Phase 2 list-page filter migrations ─────────────────────
//
// 2026-05-08 chip Phase 2: Quotes / Jobs / InvoicesListPage / LeadsPage /
// Clients all migrated their `<Button variant={isActive?"default":
// "outline"} size="sm" className="h-7 text-caption rounded-full">`
// status filters onto canonical `<FilterChip selected={...}>`. Pin
// per page so a future revert can't slip a Button-shaped filter back in.
//
// Each test scopes to a small region of the file (the inner-loop JSX
// inside the relevant FilterSection / FilterChips), not the whole
// page — these pages also use `<Button>` in many other places.

interface PageFilterPin {
  file: string;
  /** Region marker — usually a unique label or filter-section keyword. */
  regionAfter: string;
  /** Number of post-migration `<FilterChip` occurrences expected in the
   *  region (one per filter button). */
  expectChipCount: number;
}

const PAGE_FILTER_PINS: PageFilterPin[] = [
  { file: "client/src/pages/Quotes.tsx",            regionAfter: 'FilterSection label="Status"', expectChipCount: 1 },
  { file: "client/src/pages/Jobs.tsx",              regionAfter: 'FilterSection label="Status"', expectChipCount: 1 },
  { file: "client/src/pages/Jobs.tsx",              regionAfter: 'FilterSection label="Workflow"', expectChipCount: 1 },
  { file: "client/src/pages/InvoicesListPage.tsx",  regionAfter: 'FilterSection label="Status"', expectChipCount: 1 },
  { file: "client/src/pages/LeadsPage.tsx",         regionAfter: 'FilterSection label="Status"', expectChipCount: 1 },
  { file: "client/src/pages/Clients.tsx",           regionAfter: 'FilterSection label="Status"', expectChipCount: 1 },
];

describe("Phase 2 — list-page status filters use canonical <FilterChip>", () => {
  for (const pin of PAGE_FILTER_PINS) {
    const fileLabel = `${pin.file} :: ${pin.regionAfter}`;

    it(`${fileLabel} imports FilterChip from the canonical chip module`, () => {
      const fullSrc = readFileSync(resolve(__dirname, "..", pin.file), "utf-8");
      expect(fullSrc).toMatch(
        /import\s*\{[^}]*\bFilterChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
      );
    });

    /** Returns the inner contents of the FilterSection identified by
     *  `regionAfter`, scoped from the section's open tag to its first
     *  `</FilterSection>` close tag. This excludes sibling
     *  FilterSection blocks (e.g. InvoicesListPage's QBO sync filter
     *  is intentionally Cat B and shouldn't be in the window). */
    function getSectionWindow(fullSrc: string): string {
      const idx = fullSrc.indexOf(pin.regionAfter);
      expect(idx).toBeGreaterThan(-1);
      const tail = fullSrc.slice(idx);
      const closeIdx = tail.indexOf("</FilterSection>");
      expect(closeIdx).toBeGreaterThan(-1);
      return tail.slice(0, closeIdx);
    }

    it(`${fileLabel} renders <FilterChip> inside the named FilterSection`, () => {
      const fullSrc = readFileSync(resolve(__dirname, "..", pin.file), "utf-8");
      const window = getSectionWindow(fullSrc);
      const chips = window.match(/<FilterChip\b/g) ?? [];
      expect(chips.length).toBeGreaterThanOrEqual(pin.expectChipCount);
    });

    it(`${fileLabel} no longer wraps filters in <Button variant="default" / "outline" ... rounded-full>`, () => {
      const fullSrc = readFileSync(resolve(__dirname, "..", pin.file), "utf-8");
      const window = getSectionWindow(fullSrc);
      // Pre-migration shape: <Button variant={...?"default":"outline"}
      // size="sm" className="h-7 text-caption rounded-full">. The
      // post-migration section must contain none of those Button
      // shells. Tight regex so we don't false-match unrelated Button
      // uses (FilterSection itself doesn't render Buttons).
      expect(window).not.toMatch(
        /<Button[\s\S]{0,200}h-7\s+text-caption\s+rounded-full/,
      );
    });
  }
});

// ── 6. OperationalAlertsCard count badge ────────────────────

describe("OperationalAlertsCard — severity-tinted count badge uses canonical StatusChip", () => {
  const PATH = resolve(
    __dirname,
    "../client/src/components/dashboard/OperationalAlertsCard.tsx",
  );
  const src = readFileSync(PATH, "utf-8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("imports StatusChip + ChipTone from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{\s*StatusChip\s*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
    expect(src).toMatch(
      /import\s+type\s*\{\s*ChipTone\s*\}\s*from\s*["']@\/lib\/chipVariants["']/,
    );
  });

  it("count badge renders <StatusChip tone={badgeTone}> with the operational-alerts-count-badge testid", () => {
    expect(src).toMatch(
      /<StatusChip[\s\S]*?tone=\{badgeTone\}[\s\S]*?data-testid="operational-alerts-count-badge"/,
    );
  });

  it("does NOT keep the legacy `bg-red-100 text-red-700` / `bg-orange-100 text-orange-700` class strings", () => {
    expect(code).not.toMatch(/bg-red-100\s+text-red-700/);
    expect(code).not.toMatch(/bg-orange-100\s+text-orange-700/);
  });

  it("badge severity → tone map covers requires-attention=danger / past-due=warning / else=neutral", () => {
    expect(src).toMatch(
      /requiresAttentionCount\s*>\s*0\s*\?\s*"danger"\s*:\s*pastDueCount\s*>\s*0\s*\?\s*"warning"\s*:\s*"neutral"/,
    );
  });
});

// ── 7. DeliveryStatusCard local StatusBadge ───────────────────

describe("DeliveryStatusCard — local StatusBadge uses canonical StatusChip", () => {
  const PATH = resolve(
    __dirname,
    "../client/src/components/communication/DeliveryStatusCard.tsx",
  );
  const src = readFileSync(PATH, "utf-8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("imports StatusChip + ChipTone from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{\s*StatusChip\s*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
    expect(src).toMatch(
      /import\s+type\s*\{\s*ChipTone\s*\}\s*from\s*["']@\/lib\/chipVariants["']/,
    );
  });

  it("STATUS_META rows now carry a canonical `tone: ChipTone` (no className strings)", () => {
    expect(src).toMatch(
      /STATUS_META:\s*Record<[\s\S]*?\{\s*label:\s*string;\s*icon:[\s\S]*?tone:\s*ChipTone\s*\}/,
    );
    // Spot-check each lifecycle row maps to a canonical tone literal.
    expect(code).toMatch(/queued:\s*\{[\s\S]*?tone:\s*"neutral"/);
    expect(code).toMatch(/sent:\s*\{[\s\S]*?tone:\s*"success"/);
    expect(code).toMatch(/delivered:\s*\{[\s\S]*?tone:\s*"success"/);
    expect(code).toMatch(/failed:\s*\{[\s\S]*?tone:\s*"danger"/);
    expect(code).toMatch(/bounced:\s*\{[\s\S]*?tone:\s*"warning"/);
    expect(code).toMatch(/complained:\s*\{[\s\S]*?tone:\s*"danger"/);
  });

  it("StatusBadge renders <StatusChip leadingIcon={<Icon ... />} tone={meta.tone}>", () => {
    expect(src).toMatch(
      /<StatusChip[\s\S]*?tone=\{meta\.tone\}[\s\S]*?leadingIcon=\{<Icon\s+className="h-3 w-3"\s*\/>\}/,
    );
  });

  it("does NOT keep the legacy ad-hoc `bg-emerald-50` / `bg-red-50` / `bg-amber-50` / `bg-rose-50` className strings", () => {
    expect(code).not.toMatch(/bg-emerald-50\s+text-emerald-700/);
    expect(code).not.toMatch(/bg-red-50\s+text-red-700/);
    expect(code).not.toMatch(/bg-amber-50\s+text-amber-700/);
    expect(code).not.toMatch(/bg-rose-50\s+text-rose-700/);
  });
});

// ─────────────────────────────────────────────────────────────────
// PHASE 3a (2026-05-08) — selectedTone API + JobStatusTimeline
// migration + InvoicesListPage QBO sync filter migration.
// ─────────────────────────────────────────────────────────────────

// ── 8. JobStatusTimeline — local StatusBadge → StatusChip ────

describe("JobStatusTimeline — local StatusBadge migrated to canonical StatusChip", () => {
  const PATH = resolve(
    __dirname,
    "../client/src/components/job/JobStatusTimeline.tsx",
  );
  const src = readFileSync(PATH, "utf-8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("imports StatusChip + ChipTone from the canonical chip module", () => {
    expect(src).toMatch(
      /import\s*\{\s*StatusChip\s*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
    expect(src).toMatch(
      /import\s+type\s*\{\s*ChipTone\s*\}\s*from\s*["']@\/lib\/chipVariants["']/,
    );
  });

  it("does NOT define a local `variantClasses` Record (replaced by variantToTone + StatusChip)", () => {
    expect(code).not.toMatch(/variantClasses:\s*Record</);
  });

  it("does NOT keep the legacy ad-hoc bg-yellow-100 / bg-green-100 strings (now sourced from chip palette)", () => {
    expect(code).not.toMatch(/bg-yellow-100\s+text-yellow-800/);
    expect(code).not.toMatch(/bg-green-100\s+text-green-800/);
  });

  it("StatusBadge renders <StatusChip size=\"compact\" tone={variantToTone(variant)}>", () => {
    expect(src).toMatch(
      /<StatusChip\s+size="compact"\s+tone=\{variantToTone\(variant\)\}/,
    );
  });

  it("variantToTone maps destructive→danger, warning→warning, success→success, others→neutral", () => {
    // The function lives in code (not in a comment), so check the
    // codeOnly view to avoid false-matching the doc-comment that
    // also lists the mapping.
    expect(code).toMatch(/case\s+"destructive":\s*return\s+"danger"/);
    expect(code).toMatch(/case\s+"warning":\s*return\s+"warning"/);
    expect(code).toMatch(/case\s+"success":\s*return\s+"success"/);
    // The default arm collapses default/secondary/outline/unknown to
    // "neutral". Pin the literal so the function can't drift.
    expect(code).toMatch(/default:\s*return\s+"neutral"/);
  });

  it("the h-2 w-2 timeline dot is preserved (decoration, not a chip)", () => {
    // Sanity pin so a future "migrate everything" pass doesn't
    // accidentally swap the bullet dot for a StatusChip.
    expect(src).toMatch(/h-2\s+w-2\s+rounded-full/);
  });
});

// ── 9. FilterChip — selectedTone API ─────────────────────────

describe("FilterChip — selectedTone prop drives the solid selected fill", () => {
  it("declares an optional `selectedTone?: ChipTone` prop on FilterChipProps", () => {
    expect(chipSrc).toMatch(/selectedTone\?:\s*ChipTone/);
  });

  it("selectedTone defaults to \"active\" (preserves brand-fill back-compat)", () => {
    expect(chipSrc).toMatch(/selectedTone\s*=\s*"active"/);
  });

  it("selected state composes tone={selectedTone} + variant=\"solid\"; unselected uses unselectedTone + variant=\"subtle\"", () => {
    expect(chipSrc).toMatch(
      /tone:\s*selected\s*\?\s*selectedTone\s*:\s*unselectedTone/,
    );
    expect(chipSrc).toMatch(
      /variant:\s*selected\s*\?\s*"solid"\s*:\s*"subtle"/,
    );
  });

  it("does NOT remove the legacy unselectedTone prop (back-compat)", () => {
    expect(chipSrc).toMatch(/unselectedTone\?:\s*ChipTone/);
  });
});

// ── 10. chipVariants — solid-tone compound variants ──────────

describe("chipVariants — solid compound variants compose with EXISTING tokens only", () => {
  it("declares a `compoundVariants` block on the cva config", () => {
    expect(variantsSrc).toMatch(/compoundVariants:\s*\[/);
  });

  it("danger + solid intentionally aliases to `bg-destructive text-destructive-foreground border-transparent`", () => {
    expect(variantsCode).toMatch(
      /tone:\s*"danger"[\s\S]*?variant:\s*"solid"[\s\S]*?className:\s*"bg-destructive\s+text-destructive-foreground\s+border-transparent"/,
    );
  });

  it("info + solid uses `bg-info text-white border-transparent` (mirrors brand-active solid)", () => {
    expect(variantsCode).toMatch(
      /tone:\s*"info"[\s\S]*?variant:\s*"solid"[\s\S]*?className:\s*"bg-info\s+text-white\s+border-transparent"/,
    );
  });

  it("success + solid uses `bg-success text-white border-transparent`", () => {
    expect(variantsCode).toMatch(
      /tone:\s*"success"[\s\S]*?variant:\s*"solid"[\s\S]*?className:\s*"bg-success\s+text-white\s+border-transparent"/,
    );
  });

  it("warning + solid uses `bg-warning text-foreground border-transparent` (NOT text-white — amber/white contrast)", () => {
    expect(variantsCode).toMatch(
      /tone:\s*"warning"[\s\S]*?variant:\s*"solid"[\s\S]*?className:\s*"bg-warning\s+text-foreground\s+border-transparent"/,
    );
  });

  // Negative pins — token-gap protection. The four flat semantic
  // tones (`success` / `warning` / `info` / `danger`) do NOT have
  // paired `-foreground` companions in tailwind.config.ts. Phase 3a
  // intentionally composes with existing tokens only. A future revert
  // that "fixes" the warning solid by inventing `--warning-foreground`
  // (or any of the other three) must be blocked at PR time.
  it("does NOT invent `success-foreground`", () => {
    expect(variantsCode).not.toMatch(/text-success-foreground/);
    expect(variantsCode).not.toMatch(/--success-foreground/);
  });

  it("does NOT invent `warning-foreground`", () => {
    expect(variantsCode).not.toMatch(/text-warning-foreground/);
    expect(variantsCode).not.toMatch(/--warning-foreground/);
  });

  it("does NOT invent `info-foreground`", () => {
    expect(variantsCode).not.toMatch(/text-info-foreground/);
    expect(variantsCode).not.toMatch(/--info-foreground/);
  });

  it("does NOT invent `danger-foreground` (danger solid aliases destructive instead)", () => {
    expect(variantsCode).not.toMatch(/text-danger-foreground/);
    expect(variantsCode).not.toMatch(/--danger-foreground/);
  });

  // tailwind.config.ts gap pins. Cross-check the audit so a future
  // contributor adding a `success-foreground` Tailwind color will
  // also have to update this test (which forces them through the
  // PR review for the token addition).
  describe("tailwind.config.ts — semantic tone tokens stay flat (no `-foreground` companions)", () => {
    const TW_PATH = resolve(__dirname, "../tailwind.config.ts");
    const twSrc = readFileSync(TW_PATH, "utf-8");

    it("success token is flat (no nested `foreground` key)", () => {
      // The flat shape is: `success: "hsl(var(--success) / <alpha-value>)"`
      expect(twSrc).toMatch(
        /success:\s*"hsl\(var\(--success\)\s*\/\s*<alpha-value>\)"/,
      );
      // And no `success: { ... foreground: ... }` block exists.
      expect(twSrc).not.toMatch(
        /success:\s*\{[^}]*foreground/,
      );
    });

    it("warning / danger / info tokens are also flat", () => {
      expect(twSrc).not.toMatch(/warning:\s*\{[^}]*foreground/);
      expect(twSrc).not.toMatch(/danger:\s*\{[^}]*foreground/);
      expect(twSrc).not.toMatch(/info:\s*\{[^}]*foreground/);
    });

    it("destructive remains the only paired tone (sanity check)", () => {
      // The aliased `danger + solid` rule depends on this pair.
      expect(twSrc).toMatch(
        /destructive:\s*\{\s*DEFAULT:[^,]+,\s*foreground:[^,]+,/,
      );
    });
  });
});

// ── 11. InvoicesListPage QBO sync filter migration ───────────

describe("InvoicesListPage — QBO sync filter migrated to canonical FilterChip", () => {
  const PATH = resolve(
    __dirname,
    "../client/src/pages/InvoicesListPage.tsx",
  );
  const src = readFileSync(PATH, "utf-8");

  /** Returns the QBO sync FilterSection's contents — the window from
   *  the section's open tag to its first `</FilterSection>`. */
  function getQboSection(): string {
    const idx = src.indexOf('FilterSection label="QuickBooks Sync"');
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx);
    const closeIdx = tail.indexOf("</FilterSection>");
    expect(closeIdx).toBeGreaterThan(-1);
    return tail.slice(0, closeIdx);
  }

  it("imports FilterChip from the canonical chip module (already in scope from prior Phase 2 migration)", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bFilterChip\b[^}]*\}\s*from\s*["']@\/components\/ui\/chip["']/,
    );
  });

  it("renders <FilterChip> for both `qbo_synced` and `qbo_out_of_sync` filters", () => {
    const window = getQboSection();
    const chips = window.match(/<FilterChip\b/g) ?? [];
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  it("the `Out of Sync` chip carries `selectedTone=\"danger\"` (severity affordance)", () => {
    const window = getQboSection();
    expect(window).toMatch(/selectedTone="danger"/);
    // Sanity: that selectedTone is on the qbo_out_of_sync filter, not
    // the qbo_synced filter. The qbo_synced chip should NOT carry a
    // selectedTone (it relies on the default "active").
    expect(window).toMatch(
      /<FilterChip\s+selected=\{activeFilter === "qbo_out_of_sync"\}\s+selectedTone="danger"/,
    );
  });

  it("preserves the leading icons on both filters (RefreshCw + AlertTriangle)", () => {
    const window = getQboSection();
    expect(window).toMatch(/leadingIcon=\{<RefreshCw\s+className="h-3 w-3"\s*\/>\}/);
    expect(window).toMatch(/leadingIcon=\{<AlertTriangle\s+className="h-3 w-3"\s*\/>\}/);
  });

  it("does NOT keep the legacy `<Button variant=\"destructive\" ... rounded-full>` Out-of-Sync shell", () => {
    const window = getQboSection();
    expect(window).not.toMatch(
      /<Button[\s\S]*?variant=\{[^}]*"destructive"[^}]*\}[\s\S]*?rounded-full/,
    );
  });

  it("does NOT keep ANY <Button ... rounded-full> shells in the QBO sync section", () => {
    const window = getQboSection();
    expect(window).not.toMatch(
      /<Button[\s\S]{0,300}rounded-full/,
    );
  });
});
