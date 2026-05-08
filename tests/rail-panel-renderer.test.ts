/**
 * RailPanelRenderer + railTypes — Phase 1 source pins (2026-05-07).
 *
 * The data-driven right-rail renderer consumes typed descriptors from
 * the page and emits the canonical `<RailContentCard>` slot
 * composition. These pins fail if a future refactor:
 *
 *   - Drops one of the descriptor types or panel kinds.
 *   - Lets a panel kind branch render outside the canonical slot
 *     primitives (would re-introduce hand-rolled card chrome).
 *   - Bakes a non-canonical typography token directly inside the
 *     renderer.
 *   - Forgets a slot (Header / Title / Chip / Meta / FieldList /
 *     Field / Body) for one of its codepaths.
 *   - Stops forwarding the empty-state's `testIdPrefix` (would break
 *     the `client-side-panel-empty` selector).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const TYPES_PATH = resolve(
  ROOT,
  "client/src/components/detail-rail/railTypes.ts",
);
const RENDERER_PATH = resolve(
  ROOT,
  "client/src/components/detail-rail/RailPanelRenderer.tsx",
);
const typesSrc = readFileSync(TYPES_PATH, "utf-8");
const rendererSrc = readFileSync(RENDERER_PATH, "utf-8");

// 2026-05-08 Labour typography remap helper — strip block + line +
// JSX comments so inverse pins don't false-match against doc text
// that names the old token (e.g. a comment that says "was
// text-row-emphasis font-mono"). Anchored slice tests use this to
// scan code only.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const rendererCode = stripComments(rendererSrc);

// ── 1. Descriptor types: every type the renderer dispatches on ─────

describe("railTypes — descriptor surface", () => {
  const requiredExports = [
    "RailChipVariant",
    "RailChipDescriptor",
    "RailFieldDescriptor",
    "RailCardTitleDescriptor",
    "RailCardDescriptor",
    "RailEmptyDescriptor",
    "RailPanelDescriptor",
  ] as const;

  for (const name of requiredExports) {
    it(`exports \`${name}\``, () => {
      // Type aliases use `export type`, interfaces use `export interface`.
      expect(typesSrc).toMatch(
        new RegExp(`export\\s+(type|interface)\\s+${name}\\b`),
      );
    });
  }

  it("RailChipVariant covers the canonical variant set", () => {
    for (const v of [
      "neutral",
      "info",
      "success",
      "warning",
      "destructive",
      "purple",
    ]) {
      expect(typesSrc).toMatch(new RegExp(`"${v}"`));
    }
  });

  it("RailPanelDescriptor union has at least the `list`, `single`, and `loading` kinds", () => {
    expect(typesSrc).toMatch(/kind:\s*"list"/);
    expect(typesSrc).toMatch(/kind:\s*"single"/);
    expect(typesSrc).toMatch(/kind:\s*"loading"/);
  });

  it("RailCardDescriptor allows `bodyClamp: 2 | 3`", () => {
    expect(typesSrc).toMatch(/bodyClamp\?:\s*2\s*\|\s*3/);
  });
});

// ── 2. Renderer dispatches on `panel.kind` ─────────────────────────

describe("RailPanelRenderer — panel kind dispatch", () => {
  it("imports the canonical slot primitives from `./RailContentCard`", () => {
    expect(rendererSrc).toMatch(
      /from\s+["']\.\/RailContentCard["']/,
    );
    for (const slot of [
      "RailContentCard",
      "RailContentCardHeader",
      "RailContentCardTitle",
      "RailContentCardBody",
      "RailContentCardMeta",
      "RailContentCardChip",
      "RailContentCardFieldList",
      "RailContentCardField",
    ]) {
      expect(rendererSrc).toMatch(new RegExp(`\\b${slot}\\b`));
    }
  });

  it("imports `DetailRightRailEmpty` for the list empty-state path", () => {
    expect(rendererSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRailEmpty\b[\s\S]*?\}\s*from\s*["']\.\/DetailRightRail["']/,
    );
  });

  it("loading branch renders a `<Loader2>` spinner with the canonical wrapper", () => {
    expect(rendererSrc).toMatch(/panel\.kind\s*===\s*"loading"/);
    expect(rendererSrc).toMatch(
      /py-6\s+flex\s+justify-center[\s\S]{0,500}?<Loader2/,
    );
  });

  it("single branch renders a single card via `RailCardFromDescriptor`", () => {
    expect(rendererSrc).toMatch(/panel\.kind\s*===\s*"single"/);
    expect(rendererSrc).toMatch(
      /<RailCardFromDescriptor\s+card=\{panel\.card\}/,
    );
  });

  it("list branch renders an empty state when `cards.length === 0`", () => {
    expect(rendererSrc).toMatch(/panel\.cards\.length\s*===\s*0/);
    expect(rendererSrc).toMatch(/<DetailRightRailEmpty\b/);
  });

  it("list branch wraps cards in a `<ul>` whose className composes the resolved spacingClass + canonical list utilities", () => {
    // 2026-05-07 Phase 3: the `<ul>` className is now interpolated
    // from `spacingClass` (mapped from `panel.spacing`) so the gap
    // can be tightened (`space-y-2`) for feed-shaped panels like
    // Activity. The forwarded testId from the descriptor still sits
    // on the same element.
    expect(rendererSrc).toMatch(
      /<ul\s+className=\{`\$\{spacingClass\}\s+list-none\s+p-0\s+m-0`\}[\s\S]{0,200}?data-testid=\{panel\.testId\}/,
    );
  });

  it("each card lives inside a `<li key={card.key}>`", () => {
    expect(rendererSrc).toMatch(
      /<li\s+key=\{card\.key\}>[\s\S]{0,200}?<RailCardFromDescriptor/,
    );
  });
});

// ── 3. Card descriptor → slot composition ──────────────────────────

describe("RailCardFromDescriptor — slot composition contract", () => {
  it("forwards `onClick`, `ariaLabel`, and `testId` to <RailContentCard>", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCard[\s\S]{0,300}?onClick=\{card\.onClick\}[\s\S]{0,300}?ariaLabel=\{card\.ariaLabel\}[\s\S]{0,300}?testId=\{card\.testId\}/,
    );
  });

  it("renders <RailContentCardHeader> + <RailContentCardTitle> when `card.title` is set (and `sectionHeader` is not)", () => {
    // 2026-05-07 Phase 7: `card.sectionHeader` takes precedence over
    // `card.title` via a ternary. Phase 8: title is wrapped in a
    // left-cluster `<div>` so titleIcon (Wrench) + inlineChip can sit
    // adjacent to the title text. Pin the title path through the
    // wrapping div.
    expect(rendererSrc).toMatch(
      /:\s*card\.title\s*\?\s*\(\s*\n?\s*<RailContentCardHeader>[\s\S]{0,1500}?<RailContentCardTitle/,
    );
  });

  it("renders chip via `RailChipFromDescriptor` when `title.chip` is set (single-chip path)", () => {
    // 2026-05-07 Phase 7 — chip rendering centralised in the
    // `RailChipFromDescriptor` helper so icon support is consistent
    // across trailing-chip / chipRow / subrow.title.chip. The
    // single-chip path inside RailTitleTrailingArea now delegates
    // to the helper.
    expect(rendererSrc).toMatch(
      /if\s*\(\s*title\.chip\s*\)\s*\{\s*\n?\s*return\s+<RailChipFromDescriptor\s+chip=\{title\.chip\}/,
    );
  });

  it("RailChipFromDescriptor forwards variant / className / testId to <RailContentCardChip>", () => {
    expect(rendererSrc).toMatch(/variant=\{chip\.variant\}/);
    expect(rendererSrc).toMatch(/className=\{chip\.className\}/);
    expect(rendererSrc).toMatch(/data-testid=\{chip\.testId\}/);
  });

  it("renders <RailContentCardMeta> only when `card.meta` is set + forwards the metaTestId (string-meta fallback)", () => {
    // 2026-05-07 Phase 3: meta carries the descriptor's
    // `metaTestId` (e.g. `client-activity-row-meta`) so the slot
    // contract preserves prior DOM selectors.
    // 2026-05-07 Phase 6: the renderer now prefers `card.metaRows`
    // (multi-row icon-prefixed) when set, and falls back to the
    // string `card.meta` path. This pin checks the fallback branch
    // — the single-string case behaves identically to the prior
    // contract.
    expect(rendererSrc).toMatch(
      /:\s*card\.meta\s*&&\s*\(\s*\n?\s*<RailContentCardMeta\s+data-testid=\{card\.metaTestId\}>\s*\n?\s*\{card\.meta\}\s*\n?\s*<\/RailContentCardMeta>/,
    );
  });

  it("renders <RailContentCardFieldList> + per-field <RailContentCardField> only when `card.fields` is non-empty", () => {
    expect(rendererSrc).toMatch(
      /\{card\.fields\s*&&\s*card\.fields\.length\s*>\s*0\s*&&\s*\(/,
    );
    expect(rendererSrc).toMatch(/<RailContentCardFieldList>/);
    expect(rendererSrc).toMatch(
      /<RailContentCardField[\s\S]{0,300}?key=\{f\.label\}[\s\S]{0,200}?label=\{f\.label\}[\s\S]{0,200}?valueClassName=\{f\.valueClassName\}[\s\S]{0,200}?testId=\{f\.testId\}/,
    );
  });

  it("renders <RailContentCardBody> only when `card.body` is set + applies `line-clamp-N` for `bodyClamp`", () => {
    expect(rendererSrc).toMatch(
      /\{card\.body\s*&&\s*\(\s*<RailContentCardBody/,
    );
    // `line-clamp-2` and `line-clamp-3` must appear as literal class
    // strings so Tailwind's JIT picks them up.
    expect(rendererSrc).toMatch(/"line-clamp-2"/);
    expect(rendererSrc).toMatch(/"line-clamp-3"/);
    // The clamp value is gated on `card.bodyClamp` being 2 or 3.
    expect(rendererSrc).toMatch(/card\.bodyClamp\s*===\s*2/);
    expect(rendererSrc).toMatch(/card\.bodyClamp\s*===\s*3/);
  });
});

// ── 4. Footer support (Phase 2) ────────────────────────────────────

describe("railTypes — RailFooterDescriptor (Phase 2)", () => {
  it("exports `RailFooterDescriptor`", () => {
    expect(typesSrc).toMatch(
      /export\s+(type|interface)\s+RailFooterDescriptor\b/,
    );
  });

  it("supports the `link` kind with href / label / optional icon / ariaLabel / title / testId", () => {
    expect(typesSrc).toMatch(/kind:\s*"link"/);
    expect(typesSrc).toMatch(/^\s*href:\s*string;/m);
    expect(typesSrc).toMatch(/^\s*label:\s*string;/m);
    expect(typesSrc).toMatch(/icon\?:\s*ComponentType/);
    expect(typesSrc).toMatch(/ariaLabel\?:\s*string;/);
    expect(typesSrc).toMatch(/title\?:\s*string;/);
    expect(typesSrc).toMatch(/^\s*testId\?:\s*string;/m);
  });

  it("RailCardDescriptor adds an optional `footer: RailFooterDescriptor` field", () => {
    expect(typesSrc).toMatch(/footer\?:\s*RailFooterDescriptor;/);
  });

  it("loading panel kind allows an optional `testId` override", () => {
    expect(typesSrc).toMatch(
      /kind:\s*"loading";[\s\S]{0,400}?testId\?:\s*string;/,
    );
  });
});

describe("RailPanelRenderer — footer rendering (Phase 2)", () => {
  it("imports the wouter `Link` primitive (for footer links)", () => {
    expect(rendererSrc).toMatch(/import\s+\{\s*Link\s*\}\s+from\s+["']wouter["']/);
  });

  it("imports `RailContentCardFooter` from the slot module", () => {
    expect(rendererSrc).toMatch(/\bRailContentCardFooter\b/);
  });

  it("composes the canonical brand-green link primitive (Phase H2 — replaces FOOTER_LINK_CLASS)", () => {
    // Phase H2 (2026-05-07): the file-local FOOTER_LINK_CLASS constant
    // was removed. Footer links now compose `ENTITY_LINK_CLASS` (imported
    // from `@/components/ui/typography`) with per-callsite layout via
    // `cn(...)`. The architectural guard forbids re-deriving typography
    // strings in file-local constants.
    expect(rendererSrc).not.toMatch(/FOOTER_LINK_CLASS\s*=/);
    expect(rendererSrc).toMatch(
      /import\s*\{\s*ENTITY_LINK_CLASS\s*\}\s*from\s+"@\/components\/ui\/typography"/,
    );
    // The hover hex (`text-[#5e9043]`) is no longer needed — the primitive
    // ships canonical `text-brand` + `hover:underline`.
    expect(rendererSrc).not.toMatch(/hover:text-\[#5e9043\]/);
  });

  it("RailCardFromDescriptor renders the footer slot when `card.footer` is set", () => {
    expect(rendererSrc).toMatch(
      /\{card\.footer\s*&&\s*<RailFooterFromDescriptor\s+footer=\{card\.footer\}\s*\/>\}/,
    );
  });

  it("RailFooterFromDescriptor link kind composes ENTITY_LINK_CLASS with per-callsite layout (Phase H2)", () => {
    // A wouter <Link> wrapped in <RailContentCardFooter className="justify-end">.
    // 2026-05-07: widened the inter-element bounds to accommodate the
    // expanded inline doc comment that records the typography migration
    // (text-caption font-medium → text-helper). Test intent unchanged.
    expect(rendererSrc).toMatch(
      /<RailContentCardFooter\s+className="justify-end">[\s\S]{0,800}?<Link[\s\S]{0,1500}?className=\{cn\([\s\S]{0,400}?ENTITY_LINK_CLASS/,
    );
    // Forwarded fields: href / aria-label / title / testId / icon.
    expect(rendererSrc).toMatch(/href=\{footer\.href\}/);
    expect(rendererSrc).toMatch(/aria-label=\{footer\.ariaLabel\}/);
    expect(rendererSrc).toMatch(/title=\{footer\.title\}/);
    expect(rendererSrc).toMatch(/data-testid=\{footer\.testId\}/);
    // Icon renders only when supplied, at the canonical size.
    expect(rendererSrc).toMatch(
      /\{Icon\s*&&\s*<Icon\s+className="h-3\.5\s+w-3\.5"\s*\/>\}/,
    );
  });

  it("union is exhaustive — TS exhaustiveness check on the footer descriptor", () => {
    // Phase 5 added the `block` kind. With both `link` and `block`
    // handled inside `if (footer.kind === "link") { return … }
    // if (footer.kind === "block") { return … }`, the trailing
    // exhaustiveness assertion narrows to the entire union (now
    // `never`). The check still fires at compile time when a future
    // kind is added without a matching branch.
    expect(rendererSrc).toMatch(/const\s+_exhaustive:\s*never\s*=\s*footer\b/);
  });
});

describe("RailPanelRenderer — loading testId override (Phase 2)", () => {
  it("loading branch falls back to `${testIdPrefix}-panel-loading` when descriptor has no testId", () => {
    expect(rendererSrc).toMatch(
      /panel\.testId\s*\?\?\s*\(\s*testIdPrefix\s*\?\s*`\$\{testIdPrefix\}-panel-loading`\s*:\s*undefined\s*\)/,
    );
  });
});

// ── 4b. Phase 3 — title.as, title.testId, metaTestId, bodyTestId, spacing ──

describe("railTypes — Phase 3 descriptor extensions", () => {
  it("RailCardTitleDescriptor exposes `as` for non-heading title elements", () => {
    expect(typesSrc).toMatch(
      /as\?:\s*"h3"\s*\|\s*"h4"\s*\|\s*"h5"\s*\|\s*"span"/,
    );
  });

  it("RailCardTitleDescriptor exposes `testId` so the title element carries a forwarded data-testid", () => {
    // Anchor in the title-descriptor block. Phase 6 added `secondary`
    // and `trailing` fields, so the block is longer; slice up to the
    // next interface declaration to be safe.
    const start = typesSrc.indexOf("interface RailCardTitleDescriptor");
    expect(start).toBeGreaterThan(-1);
    const nextInterface = typesSrc.indexOf("interface ", start + 1);
    expect(nextInterface).toBeGreaterThan(start);
    const slice = typesSrc.slice(start, nextInterface);
    expect(slice).toMatch(/^\s*testId\?:\s*string;/m);
  });

  it("RailCardDescriptor exposes `metaTestId` and `bodyTestId`", () => {
    expect(typesSrc).toMatch(/metaTestId\?:\s*string;/);
    expect(typesSrc).toMatch(/bodyTestId\?:\s*string;/);
  });

  it("list panel kind exposes a `spacing: \"default\" | \"compact\"` field", () => {
    expect(typesSrc).toMatch(
      /spacing\?:\s*"default"\s*\|\s*"compact"/,
    );
  });
});

describe("RailPanelRenderer — Phase 3 slot wiring", () => {
  it("RailContentCardTitle receives `as`, `className`, and `testId` from the descriptor", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCardTitle[\s\S]{0,200}?as=\{card\.title\.as\}[\s\S]{0,200}?className=\{card\.title\.className\}[\s\S]{0,200}?data-testid=\{card\.title\.testId\}/,
    );
  });

  it("RailContentCardMeta receives `data-testid` from `card.metaTestId`", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCardMeta\s+data-testid=\{card\.metaTestId\}>\s*\{card\.meta\}\s*<\/RailContentCardMeta>/,
    );
  });

  it("RailContentCardBody receives `data-testid` from `card.bodyTestId`", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCardBody[\s\S]{0,200}?className=\{bodyClampClass\}[\s\S]{0,200}?data-testid=\{card\.bodyTestId\}/,
    );
  });

  it("list spacing maps `compact` → `space-y-2` and `default` → `space-y-3` (Tailwind JIT-friendly literals)", () => {
    expect(rendererSrc).toMatch(
      /panel\.spacing\s*===\s*"compact"\s*\?\s*"space-y-2"\s*:\s*"space-y-3"/,
    );
  });

  it("the list `<ul>` uses the resolved spacingClass", () => {
    expect(rendererSrc).toMatch(
      /<ul\s+className=\{`\$\{spacingClass\}\s+list-none\s+p-0\s+m-0`\}/,
    );
  });
});

// ── 4d. Phase 5 — block footer kind + single panel exercise ────────

describe("railTypes — Phase 5 footer block descriptor", () => {
  it("RailFooterDescriptor union now includes `kind: \"block\"`", () => {
    expect(typesSrc).toMatch(/kind:\s*"block"/);
  });

  it("block kind exposes optional `label`, `lines`, and `fallback` fields", () => {
    // Anchor inside the block branch.
    const start = typesSrc.indexOf('kind: "block"');
    expect(start).toBeGreaterThan(-1);
    const slice = typesSrc.slice(start, start + 1500);
    expect(slice).toMatch(/^\s*label\?:\s*string;/m);
    expect(slice).toMatch(/^\s*lines\?:\s*string\[\];/m);
    expect(slice).toMatch(/^\s*fallback\?:\s*string;/m);
  });
});

describe("RailPanelRenderer — block footer rendering (Phase 5)", () => {
  it("RailFooterFromDescriptor handles the `block` kind with the canonical flex-col layout", () => {
    expect(rendererSrc).toMatch(/footer\.kind\s*===\s*"block"/);
    expect(rendererSrc).toMatch(
      /<RailContentCardFooter\s+className="flex-col\s+items-start\s+gap-1">/,
    );
  });

  it("renders the optional label in `text-label text-text-secondary` chrome", () => {
    expect(rendererSrc).toMatch(
      /\{footer\.label\s*&&\s*\(\s*\n?\s*<span\s+className="text-label\s+text-text-secondary">\{footer\.label\}<\/span>/,
    );
  });

  it("renders multi-line `lines` content in `text-row text-text-primary`", () => {
    expect(rendererSrc).toMatch(
      /<div\s+className="text-row\s+text-text-primary">[\s\S]{0,400}?footer\.lines!?\.map\(/,
    );
  });

  it("derives `hasLines` from `footer.lines !== undefined && footer.lines.length > 0`", () => {
    expect(rendererSrc).toMatch(
      /const\s+hasLines\s*=\s*footer\.lines\s*!==\s*undefined\s*&&\s*footer\.lines\.length\s*>\s*0/,
    );
  });

  it("renders italic `fallback` only when `hasLines` is false", () => {
    // Anchor on `: footer.fallback ?` — the second branch of the
    // ternary that selects between lines and the italic fallback.
    expect(rendererSrc).toMatch(
      /:\s*footer\.fallback\s*\?\s*\(\s*\n?\s*<span\s+className="italic">\{footer\.fallback\}<\/span>/,
    );
  });

  it("exhaustiveness check now references the entire footer (after both kinds handled)", () => {
    // Phase 2 used `footer.kind` — with two kinds covered the never
    // assertion should narrow to the union itself.
    expect(rendererSrc).toMatch(/const\s+_exhaustive:\s*never\s*=\s*footer/);
  });
});

describe("RailPanelRenderer — kind: \"single\" panel exercise (Phase 5)", () => {
  it("`single` branch renders a single card via `RailCardFromDescriptor` (already pinned in §2 — sanity)", () => {
    expect(rendererSrc).toMatch(/panel\.kind\s*===\s*"single"/);
    expect(rendererSrc).toMatch(
      /<RailCardFromDescriptor\s+card=\{panel\.card\}/,
    );
  });
});

// ── 4c. Phase 4 — list overflow indicator ──────────────────────────

describe("railTypes — Phase 4 list overflow", () => {
  it("list panel kind exposes an `overflow: { count, testId? }` field", () => {
    expect(typesSrc).toMatch(
      /overflow\?:\s*\{\s*\n?\s*count:\s*number;[\s\S]{0,200}?testId\?:\s*string;\s*\n?\s*\}/,
    );
  });
});

describe("RailPanelRenderer — list overflow indicator (Phase 4)", () => {
  it("derives `overflowCount` from the descriptor (defaults to 0)", () => {
    expect(rendererSrc).toMatch(
      /const\s+overflowCount\s*=\s*panel\.overflow\?\.count\s*\?\?\s*0/,
    );
  });

  it("emits the indicator `<li>` only when `overflowCount > 0`", () => {
    expect(rendererSrc).toMatch(
      /\{overflowCount\s*>\s*0\s*&&\s*\(\s*\n?\s*<li[\s\S]{0,200}?text-helper\s+text-text-secondary\s+px-1\s+py-1/,
    );
  });

  it("indicator forwards the descriptor's testId", () => {
    expect(rendererSrc).toMatch(
      /<li[\s\S]{0,400}?data-testid=\{panel\.overflow\?\.testId\}/,
    );
  });

  it("indicator pluralises automatically (`item` vs `items`)", () => {
    expect(rendererSrc).toMatch(
      /\{overflowCount\}\s+more\s+\{overflowCount\s*===\s*1\s*\?\s*"item"\s*:\s*"items"\}\s+not shown\./,
    );
  });
});

// ── 4e. Phase 6 — title.secondary, title.trailing[], metaRows, chipRow ──

describe("railTypes — Phase 6 Contacts-shaped descriptor extensions", () => {
  it("RailTitleTrailing union exports `icon` and `chip` kinds", () => {
    expect(typesSrc).toMatch(/export\s+type\s+RailTitleTrailing\b/);
    expect(typesSrc).toMatch(/kind:\s*"icon";[\s\S]{0,400}?icon:\s*ComponentType/);
    expect(typesSrc).toMatch(/kind:\s*"chip";[\s\S]{0,400}?chip:\s*RailChipDescriptor/);
  });

  it("RailCardTitleDescriptor exposes `secondary` and `trailing` fields", () => {
    expect(typesSrc).toMatch(/^\s*secondary\?:\s*string;/m);
    expect(typesSrc).toMatch(/^\s*trailing\?:\s*ReadonlyArray<RailTitleTrailing>;/m);
  });

  it("RailMetaItem exposes `icon`, `text`, and `truncate`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailMetaItem\b/);
    expect(typesSrc).toMatch(/^\s*icon\?:\s*ComponentType/m);
    expect(typesSrc).toMatch(/^\s*text:\s*string;/m);
    expect(typesSrc).toMatch(/^\s*truncate\?:\s*boolean;/m);
  });

  it("RailMetaRowDescriptor exposes `items` and `testId`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailMetaRowDescriptor\b/);
    expect(typesSrc).toMatch(/^\s*items:\s*ReadonlyArray<RailMetaItem>;/m);
  });

  it("RailCardDescriptor exposes `metaRows` and `chipRow`", () => {
    expect(typesSrc).toMatch(/^\s*metaRows\?:\s*ReadonlyArray<RailMetaRowDescriptor>;/m);
    expect(typesSrc).toMatch(/^\s*chipRow\?:\s*ReadonlyArray<RailChipDescriptor>;/m);
  });
});

describe("RailPanelRenderer — Phase 6 wiring", () => {
  it("title secondary text renders inside the title element with subdued weight", () => {
    expect(rendererSrc).toMatch(
      /\{card\.title\.secondary\s*&&\s*\(\s*\n?\s*<span\s+className="font-normal\s+text-text-secondary">/,
    );
  });

  it("title trailing area dispatches via `RailTitleTrailingArea`", () => {
    expect(rendererSrc).toMatch(/<RailTitleTrailingArea\s+title=\{card\.title\}/);
  });

  it("trailing area renders a `flex items-center gap-1.5 shrink-0` container when trailing has items", () => {
    expect(rendererSrc).toMatch(
      /trailing\s*&&\s*trailing\.length\s*>\s*0[\s\S]{0,400}?<div\s+className="flex\s+items-center\s+gap-1\.5\s+shrink-0">/,
    );
  });

  it("trailing area falls back to the single-chip path (now via `RailChipFromDescriptor`) when only `title.chip` is set", () => {
    // After the trailing branch returns, the function checks
    // `title.chip` to render a single chip — preserves the existing
    // single-chip API for migrated panels (Equipment / Parts /
    // Maintenance) without requiring them to switch to `trailing`.
    // 2026-05-07 Phase 7: chip rendering centralised in
    // `RailChipFromDescriptor` so the icon-on-chip support
    // (Job Detail Labour's Running indicator) flows through one
    // helper.
    expect(rendererSrc).toMatch(
      /if\s*\(\s*title\.chip\s*\)\s*\{\s*\n?\s*return\s+<RailChipFromDescriptor\s+chip=\{title\.chip\}/,
    );
  });

  it("trailing-item renderer dispatches `kind: \"icon\"` with a default amber-star className override", () => {
    expect(rendererSrc).toMatch(/item\.kind\s*===\s*"icon"/);
    expect(rendererSrc).toMatch(
      /h-2\.5\s+w-2\.5\s+text-amber-500\s+fill-amber-500/,
    );
  });

  it("trailing-item renderer dispatches `kind: \"chip\"` to <RailContentCardChip>", () => {
    expect(rendererSrc).toMatch(/item\.kind\s*===\s*"chip"/);
  });

  it("metaRows render via `<RailMetaRowFromDescriptor>` (one slot per row)", () => {
    expect(rendererSrc).toMatch(
      /card\.metaRows\s*&&\s*card\.metaRows\.length\s*>\s*0[\s\S]{0,300}?card\.metaRows\.map[\s\S]{0,200}?<RailMetaRowFromDescriptor/,
    );
  });

  it("metaRows take precedence over the simple `meta` string", () => {
    // Ternary: `card.metaRows && card.metaRows.length > 0 ? ... : card.meta && ...`.
    expect(rendererSrc).toMatch(
      /card\.metaRows\s*&&\s*card\.metaRows\.length\s*>\s*0[\s\S]{0,500}?:\s*card\.meta\s*&&/,
    );
  });

  it("meta row gap is `gap-1` for single-item rows and `gap-3` for multi-item rows", () => {
    expect(rendererSrc).toMatch(
      /row\.items\.length\s*===\s*1\s*\?\s*"gap-1"\s*:\s*"gap-3"/,
    );
  });

  it("meta items render a Lucide icon at `h-2.5 w-2.5 text-slate-400 flex-shrink-0` when supplied", () => {
    expect(rendererSrc).toMatch(
      /<Icon\s+className="h-2\.5\s+w-2\.5\s+text-slate-400\s+flex-shrink-0"/,
    );
  });

  it("meta items optionally apply `truncate`", () => {
    expect(rendererSrc).toMatch(/item\.truncate\s*&&\s*"truncate"/);
  });

  it("chipRow renders `<RailContentCardChipRow>` with per-chip `<RailContentCardChip>` mappings", () => {
    expect(rendererSrc).toMatch(
      /card\.chipRow\s*&&\s*card\.chipRow\.length\s*>\s*0[\s\S]{0,300}?<RailContentCardChipRow>[\s\S]{0,300}?card\.chipRow\.map/,
    );
  });
});

// ── 4f. Phase 7 — grouped panel + section headers + subrows + chip icon ──

describe("railTypes — Phase 7 grouped descriptor extensions", () => {
  it("exports `RailGroupDescriptor`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailGroupDescriptor\b/);
  });

  it("exports `RailGroupedPanelHeader`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailGroupedPanelHeader\b/);
  });

  it("exports `RailCardSectionHeader`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailCardSectionHeader\b/);
  });

  it("exports `RailSubrowDescriptor`", () => {
    expect(typesSrc).toMatch(/export\s+interface\s+RailSubrowDescriptor\b/);
  });

  it("RailPanelDescriptor union now includes `kind: \"grouped\"`", () => {
    expect(typesSrc).toMatch(/kind:\s*"grouped"/);
  });

  it("RailCardDescriptor exposes `sectionHeader` + `subrows`", () => {
    expect(typesSrc).toMatch(/sectionHeader\?:\s*RailCardSectionHeader;/);
    expect(typesSrc).toMatch(
      /subrows\?:\s*ReadonlyArray<RailSubrowDescriptor>;/,
    );
  });

  it("RailChipDescriptor exposes `icon` + `iconClassName`", () => {
    expect(typesSrc).toMatch(/^\s*icon\?:\s*ComponentType/m);
    expect(typesSrc).toMatch(/^\s*iconClassName\?:\s*string;/m);
  });

  it("RailSubrowDescriptor exposes title.text/chip/value + meta.leftText/rightText/leftTruncate", () => {
    const start = typesSrc.indexOf("interface RailSubrowDescriptor");
    expect(start).toBeGreaterThan(-1);
    const nextInterface = typesSrc.indexOf("interface ", start + 1);
    const slice = typesSrc.slice(start, nextInterface > 0 ? nextInterface : start + 4000);
    expect(slice).toMatch(/title:\s*\{[\s\S]{0,400}?text:\s*string;/);
    expect(slice).toMatch(/chip\?:\s*RailChipDescriptor;/);
    expect(slice).toMatch(/^\s*value\?:\s*string;/m);
    expect(slice).toMatch(/meta\?:\s*\{[\s\S]{0,400}?leftText:\s*string;/);
    expect(slice).toMatch(/^\s*rightText:\s*string;/m);
    expect(slice).toMatch(/leftTruncate\?:\s*boolean;/);
  });
});

describe("RailPanelRenderer — grouped panel dispatch (Phase 7)", () => {
  it("dispatches `panel.kind === \"grouped\"`", () => {
    expect(rendererSrc).toMatch(/panel\.kind\s*===\s*"grouped"/);
  });

  it("renders the optional `panelHeader` via `RailGroupedPanelHeaderRow`", () => {
    expect(rendererSrc).toMatch(
      /\{panel\.panelHeader\s*&&\s*\(\s*\n?\s*<RailGroupedPanelHeaderRow\s+header=\{panel\.panelHeader\}/,
    );
  });

  it("RailGroupedPanelHeaderRow uses canonical `text-label` + tabular-nums values without `font-mono` (2026-05-08 Labour remap)", () => {
    // 2026-05-08 Labour typography remap — `text-label` already bakes
    // uppercase + 0.04em tracking via the @layer rule. The prior
    // renderer layered `uppercase tracking-wide` on top, which made
    // tracking 0.025em (overrode the canonical 0.04em). Pin the
    // bare-token form.
    expect(rendererSrc).toMatch(
      /text-label\s+text-text-muted[\s\S]{0,300}?\{header\.label\}/,
    );
    // Inverse pin — the redundant modifiers are gone from the panel-
    // header label expression. Scan code only (`rendererCode`) so doc
    // text that names the prior token doesn't false-match.
    const headerFnIdx = rendererCode.indexOf("function RailGroupedPanelHeaderRow");
    expect(headerFnIdx).toBeGreaterThan(-1);
    const slice = rendererCode.slice(headerFnIdx, headerFnIdx + 1500);
    expect(slice).not.toMatch(/text-label\s+uppercase\s+tracking-wide/);
    // Panel-header value still uses `text-row-emphasis tabular-nums
    // text-text-primary` — the panel's headline aggregate stays at the
    // emphasized scale.
    expect(rendererSrc).toMatch(
      /text-row-emphasis\s+tabular-nums\s+text-text-primary[\s\S]{0,200}?\{v\}/,
    );
    // 2026-05-08 Labour typography remap — parent values wrapper no
    // longer applies `font-mono`. Each value's `tabular-nums` keeps
    // column alignment without a family swap.
    expect(slice).toMatch(
      /<span\s+className="flex\s+items-baseline\s+gap-2">/,
    );
    expect(slice).not.toMatch(/font-mono/);
  });

  it("groups render with `space-y-4` outer + `space-y-2` inner spacing", () => {
    // Anchor inside the grouped branch.
    const start = rendererSrc.indexOf('panel.kind === "grouped"');
    const end = rendererSrc.indexOf("// kind === \"list\"", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const slice = rendererSrc.slice(start, end);
    expect(slice).toMatch(/className="space-y-4"/);
    expect(slice).toMatch(/className="space-y-2"/);
  });

  it("group heading renders in canonical `text-section-title text-text-primary` (Phase H2)", () => {
    // Phase H2: `text-section-title` already bakes weight 600. The prior
    // explicit `font-semibold` overlay is dropped — the architectural
    // guard forbids font-bold/font-semibold layered on canonical role
    // tokens.
    expect(rendererSrc).toMatch(
      /text-section-title\s+text-text-primary[\s\S]{0,300}?\{group\.heading\}/,
    );
    const groupBranchStart = rendererSrc.indexOf('panel.kind === "grouped"');
    const groupBranchEnd = rendererSrc.indexOf('// kind === "list"', groupBranchStart);
    const groupBranch = rendererSrc.slice(groupBranchStart, groupBranchEnd);
    expect(groupBranch).not.toMatch(/font-semibold/);
  });

  it("each group exposes the descriptor's `testId` on the group wrapper", () => {
    expect(rendererSrc).toMatch(/data-testid=\{group\.testId\}/);
  });
});

describe("RailPanelRenderer — section header rendering (Phase 7)", () => {
  it("`sectionHeader` takes precedence over `title` (ternary)", () => {
    expect(rendererSrc).toMatch(
      /\{card\.sectionHeader\s*\?\s*\(\s*\n?\s*<RailContentCardHeader/,
    );
  });

  it("section header uses `items-baseline pb-2 border-b border-slate-100` chrome", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCardHeader[\s\S]{0,400}?className="items-baseline\s+pb-2\s+border-b\s+border-slate-100"/,
    );
  });

  it("section header label uses canonical `text-label text-text-muted` without redundant `uppercase tracking-wide` (2026-05-08 Labour remap)", () => {
    // 2026-05-08 Labour typography remap — `text-label` already bakes
    // uppercase + 0.04em tracking via the `@layer components` rule
    // in `client/src/index.css`. Layering `uppercase tracking-wide`
    // re-applied uppercase (no-op) and overrode tracking with 0.025em.
    expect(rendererSrc).toMatch(
      /text-label\s+text-text-muted[\s\S]{0,300}?\{card\.sectionHeader\.label\}/,
    );
    // Inverse pin: the section header label expression must not carry
    // the redundant modifiers any more. Scan code only (`rendererCode`)
    // so doc text that names the prior token doesn't false-match.
    const sectionLabelIdx = rendererCode.indexOf("card.sectionHeader.label");
    expect(sectionLabelIdx).toBeGreaterThan(-1);
    const slice = rendererCode.slice(
      Math.max(0, sectionLabelIdx - 400),
      sectionLabelIdx,
    );
    expect(slice).not.toMatch(/text-label\s+uppercase\s+tracking-wide/);
  });

  it("section header value uses `text-caption tabular-nums text-text-primary` without `font-mono` (2026-05-08 Labour remap)", () => {
    // 2026-05-08 Labour typography remap — per-date totals drop
    // `font-mono`. `tabular-nums` keeps the value column-aligned;
    // sans-serif now matches Equipment / Notes meta lines.
    expect(rendererSrc).toMatch(
      /text-caption\s+tabular-nums\s+text-text-primary\s+shrink-0[\s\S]{0,300}?\{card\.sectionHeader\.value\}/,
    );
    const sectionValueIdx = rendererCode.indexOf("card.sectionHeader.value");
    expect(sectionValueIdx).toBeGreaterThan(-1);
    const slice = rendererCode.slice(
      Math.max(0, sectionValueIdx - 400),
      sectionValueIdx,
    );
    expect(slice).not.toMatch(/font-mono/);
  });
});

describe("RailPanelRenderer — subrow rendering (Phase 7)", () => {
  it("renders `<RailSubrowFromDescriptor>` for each entry in `card.subrows`", () => {
    expect(rendererSrc).toMatch(
      /\{card\.subrows\s*&&\s*card\.subrows\.length\s*>\s*0\s*&&\s*\(/,
    );
    expect(rendererSrc).toMatch(
      /card\.subrows\.map\(\(subrow,\s*idx\)\s*=>\s*\(\s*\n?\s*<RailSubrowFromDescriptor/,
    );
  });

  it("RailSubrowFromDescriptor adds inter-row dividers automatically (no page-supplied className)", () => {
    expect(rendererSrc).toMatch(
      /isFirst\s*&&\s*"mt-1\s+pt-2\s+border-t\s+border-slate-100"/,
    );
  });

  it("subrow top row uses `flex items-baseline justify-between gap-2` and renders title at row-level typography (2026-05-08 Labour remap)", () => {
    expect(rendererSrc).toMatch(
      /<RailContentCardSubrow[\s\S]{0,800}?<div\s+className="flex\s+items-baseline\s+justify-between\s+gap-2">/,
    );
    // 2026-05-08 Labour typography remap — subrow title prints at
    // row-level (text-row), NOT card-title-level. The prior
    // `<RailContentCardTitle as="span">` baked text-row-emphasis
    // (17/600) so each entry rendered at the same scale as the
    // technician group heading. Truncation + min-width preserved.
    expect(rendererSrc).toMatch(
      /<span\s+className="text-row\s+text-text-primary\s+truncate\s+min-w-0">\s*\n?\s*\{subrow\.title\.text\}/,
    );
    // Inverse pin — the subrow no longer routes title text through
    // RailContentCardTitle. Scan code only (`rendererCode`) so doc
    // text that names the primitive doesn't false-match.
    const subrowFnIdx = rendererCode.indexOf(
      "function RailSubrowFromDescriptor",
    );
    expect(subrowFnIdx).toBeGreaterThan(-1);
    const slice = rendererCode.slice(subrowFnIdx, subrowFnIdx + 3000);
    expect(slice).not.toMatch(/<RailContentCardTitle\b/);
  });

  it("subrow optional title chip routes through `RailChipFromDescriptor` (icon + text)", () => {
    expect(rendererSrc).toMatch(
      /\{subrow\.title\.chip\s*&&\s*<RailChipFromDescriptor\s+chip=\{subrow\.title\.chip\}/,
    );
  });

  it("subrow optional title value renders with `text-row tabular-nums text-text-primary` and no `font-mono` (2026-05-08 Labour remap)", () => {
    // 2026-05-08 Labour typography remap — trailing value moves from
    // `text-row-emphasis font-mono` (17/600 mono) to `text-row` sans.
    // Tabular-nums keeps the value column-aligned; family swap
    // removed so cost values read in the same font as Equipment /
    // Notes meta.
    expect(rendererSrc).toMatch(
      /text-row\s+tabular-nums\s+text-text-primary\s+shrink-0[\s\S]{0,200}?\{subrow\.title\.value\}/,
    );
    const subrowFnIdx = rendererCode.indexOf(
      "function RailSubrowFromDescriptor",
    );
    expect(subrowFnIdx).toBeGreaterThan(-1);
    const subrowSlice = rendererCode.slice(subrowFnIdx, subrowFnIdx + 3000);
    // The trailing-value span must NOT include text-row-emphasis or
    // font-mono any more. Scan code only so doc text that names the
    // prior token doesn't false-match.
    expect(subrowSlice).not.toMatch(/text-row-emphasis/);
    expect(subrowSlice).not.toMatch(/font-mono/);
  });

  it("subrow meta row drops `font-mono`; `tabular-nums` stays per-side (2026-05-08 Labour remap)", () => {
    // 2026-05-08 Labour typography remap — meta wrapper drops
    // `font-mono` from its className. Inner spans keep
    // `tabular-nums` so duration / time-range columns stay aligned;
    // the family swap (which made Labour visually distinct from
    // Equipment) is gone.
    expect(rendererSrc).toMatch(
      /<RailContentCardMeta\s+className="flex\s+items-baseline\s+justify-between\s+gap-2">/,
    );
    expect(rendererSrc).toMatch(/\{subrow\.meta\.leftText\}/);
    expect(rendererSrc).toMatch(/\{subrow\.meta\.rightText\}/);
    expect(rendererSrc).toMatch(/subrow\.meta\.leftTruncate\s*&&\s*"truncate\s+min-w-0"/);
    // Inverse pin: the meta wrapper className must NOT include
    // `font-mono` any more. Scan code only so doc text doesn't
    // false-match.
    const subrowFnIdx = rendererCode.indexOf(
      "function RailSubrowFromDescriptor",
    );
    const subrowSlice = rendererCode.slice(subrowFnIdx, subrowFnIdx + 3000);
    expect(subrowSlice).not.toMatch(
      /<RailContentCardMeta\s+className="[^"]*font-mono[^"]*"/,
    );
  });
});

describe("RailPanelRenderer — chip icon support (Phase 7)", () => {
  it("centralises chip rendering in `RailChipFromDescriptor`", () => {
    expect(rendererSrc).toMatch(
      /function\s+RailChipFromDescriptor\(\{\s*chip\s*\}:\s*\{\s*chip:\s*RailChipDescriptor\s*\}\)/,
    );
  });

  it("chip helper renders the optional icon at `h-3 w-3 mr-1` + caller `iconClassName`", () => {
    expect(rendererSrc).toMatch(
      /\{Icon\s*&&\s*<Icon\s+className=\{cn\("h-3\s+w-3\s+mr-1",\s*chip\.iconClassName\)\}/,
    );
  });

  it("chipRow now routes through `RailChipFromDescriptor`", () => {
    expect(rendererSrc).toMatch(
      /card\.chipRow\.map\(\(chip,\s*idx\)\s*=>\s*\(\s*\n?\s*<RailChipFromDescriptor/,
    );
  });
});

// ── 4g. Phase 8 — title cluster + iconButton trailing + extraContent ──

describe("railTypes — Phase 8 descriptor extensions", () => {
  it("RailCardTitleDescriptor exposes `titleIcon` (leading decorative icon) + `inlineChip`", () => {
    expect(typesSrc).toMatch(/^\s*titleIcon\?:\s*ComponentType/m);
    expect(typesSrc).toMatch(/^\s*inlineChip\?:\s*RailChipDescriptor;/m);
  });

  it("RailTitleTrailing union now includes `kind: \"iconButton\"`", () => {
    expect(typesSrc).toMatch(/kind:\s*"iconButton"/);
    // Anchor inside the iconButton variant.
    const idx = typesSrc.indexOf('kind: "iconButton"');
    expect(idx).toBeGreaterThan(-1);
    const slice = typesSrc.slice(idx, idx + 1500);
    expect(slice).toMatch(/^\s*onClick:\s*\(\)\s*=>\s*void;/m);
    expect(slice).toMatch(/^\s*ariaLabel:\s*string;/m);
    expect(slice).toMatch(/^\s*disabled\?:\s*boolean;/m);
  });

  it("RailCardDescriptor exposes `extraContent: ReactNode` (bounded escape hatch)", () => {
    expect(typesSrc).toMatch(/extraContent\?:\s*ReactNode;/);
  });
});

describe("RailPanelRenderer — Phase 8 wiring", () => {
  it("title is wrapped in a `flex items-center gap-2 min-w-0` left-cluster div so titleIcon + inlineChip sit adjacent to the title text", () => {
    expect(rendererSrc).toMatch(
      /<div\s+className="flex\s+items-center\s+gap-2\s+min-w-0">[\s\S]{0,400}?<RailContentCardTitle/,
    );
  });

  it("titleIcon renders before the Title element at `h-3.5 w-3.5 text-text-secondary shrink-0`", () => {
    expect(rendererSrc).toMatch(
      /\{card\.title\.titleIcon\s*&&\s*\(\s*\n?\s*<card\.title\.titleIcon\s+className="h-3\.5\s+w-3\.5\s+text-text-secondary\s+shrink-0"/,
    );
  });

  it("inlineChip renders after the Title element via `RailChipFromDescriptor`", () => {
    expect(rendererSrc).toMatch(
      /\{card\.title\.inlineChip\s*&&\s*\(\s*\n?\s*<RailChipFromDescriptor\s+chip=\{card\.title\.inlineChip\}/,
    );
  });

  it("RailTrailingItemFromDescriptor handles `kind: \"iconButton\"` with `<span role=\"button\">` (avoids nested-button HTML)", () => {
    expect(rendererSrc).toMatch(/item\.kind\s*===\s*"iconButton"/);
    expect(rendererSrc).toMatch(
      /<span\s*\n?\s*role="button"[\s\S]{0,400}?onClick=\{\(e\)\s*=>\s*\{[\s\S]{0,200}?e\.stopPropagation\(\)/,
    );
  });

  it("iconButton trailing fires `item.onClick()` on Enter/Space keydown (keyboard activation)", () => {
    expect(rendererSrc).toMatch(
      /onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]{0,400}?if\s*\(e\.key\s*===\s*"Enter"\s*\|\|\s*e\.key\s*===\s*"\s"\)\s*\{[\s\S]{0,200}?item\.onClick\(\)/,
    );
  });

  it("iconButton trailing forwards `aria-disabled` when `item.disabled` is set", () => {
    expect(rendererSrc).toMatch(
      /aria-disabled=\{item\.disabled\s*\|\|\s*undefined\}/,
    );
  });

  it("iconButton trailing renders the icon at `h-3.5 w-3.5` with optional iconClassName override", () => {
    expect(rendererSrc).toMatch(
      /<Icon\s+className=\{cn\("h-3\.5\s+w-3\.5",\s*item\.iconClassName\)\}/,
    );
  });

  it("`card.extraContent` renders at the fixed slot position (after subrows/chipRow, before footer)", () => {
    // Verify it's inside RailCardFromDescriptor body and ordered
    // correctly: chipRow check appears before extraContent which
    // appears before footer.
    const cardFnIdx = rendererSrc.indexOf("function RailCardFromDescriptor");
    expect(cardFnIdx).toBeGreaterThan(-1);
    const slice = rendererSrc.slice(cardFnIdx, cardFnIdx + 6000);
    const chipRowIdx = slice.indexOf("card.chipRow");
    const extraIdx = slice.indexOf("card.extraContent");
    const footerIdx = slice.indexOf("card.footer");
    expect(chipRowIdx).toBeGreaterThan(-1);
    expect(extraIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeGreaterThan(-1);
    expect(extraIdx).toBeGreaterThan(chipRowIdx);
    expect(extraIdx).toBeLessThan(footerIdx);
  });

  it("extraContent is rendered directly (no wrapper chrome — pure escape hatch)", () => {
    // Just `{card.extraContent}` — the renderer doesn't wrap the
    // ReactNode in any chrome.
    expect(rendererSrc).toMatch(/^\s*\{card\.extraContent\}\s*$/m);
  });
});

// ── 5. Renderer canonical-token sanity (no raw arbitrary text-size) ─

describe("RailPanelRenderer — no raw arbitrary text-size classes", () => {
  it("does NOT use `text-xs` / `text-sm` / `text-[Npx]` directly", () => {
    expect(rendererSrc).not.toMatch(/\btext-xs\b/);
    expect(rendererSrc).not.toMatch(/\btext-sm\b/);
    expect(rendererSrc).not.toMatch(/\btext-\[\d+px\]/);
  });
  it("does NOT use `font-bold` (canonical contract is font-medium / font-semibold)", () => {
    expect(rendererSrc).not.toMatch(/\bfont-bold\b/);
  });
});
