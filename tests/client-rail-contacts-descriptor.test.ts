/**
 * Client Detail Contacts panel — data-driven descriptor adoption
 * (Phase 6, 2026-05-07).
 *
 * Phase 6 of the data-driven right-rail moves Contacts off inline
 * slot composition. `ContactCard` is now a thin renderer mount
 * around `buildClientContactDescriptor(...)` that mounts a
 * `kind: "single"` panel. Contacts is the sixth and final Client
 * Detail panel migrated; with this PR the page no longer imports
 * any `RailContentCard*` slot primitive.
 *
 * Other Client Detail panels are already descriptor-driven and
 * pinned by their own `client-rail-{parts,maintenance,activity,
 * equipment,billing}-descriptor.test.ts` files. Notes still mounts
 * `<NotesPanel>` directly via `DetailRailTab.content` and is
 * intentionally out of scope. Job Detail rail is intentionally
 * untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "client/src/pages/ClientDetailPage.tsx");
const pageSrc = readFileSync(PAGE, "utf-8");

function descriptorBuilderSlice(): string {
  const start = pageSrc.indexOf("function buildClientContactDescriptor");
  const end = pageSrc.indexOf("function ContactCard", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

function bodyComponentSlice(): string {
  const start = pageSrc.indexOf("function ContactCard");
  // ContactCard sits just before the "ContactFormDialog extracted"
  // comment in the file.
  const end = pageSrc.indexOf(
    "// ContactFormDialog extracted",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pageSrc.slice(start, end);
}

// ── 1. Body component — thin renderer mount ────────────────────────

describe("ContactCard — thin mount on RailPanelRenderer", () => {
  it("body component is just `<RailPanelRenderer panel={{ kind: \"single\", card: ... }}>`", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(
      /<RailPanelRenderer[\s\S]{0,800}?panel=\{\{\s*\n?\s*kind:\s*"single",[\s\S]{0,400}?card:\s*buildClientContactDescriptor\(/,
    );
    expect(slice).toMatch(/testIdPrefix="client-side"/);
  });

  it("body component does NOT directly compose any slot primitive", () => {
    const slice = bodyComponentSlice();
    for (const slot of [
      "RailContentCard",
      "RailContentCardHeader",
      "RailContentCardTitle",
      "RailContentCardBody",
      "RailContentCardMeta",
      "RailContentCardChip",
      "RailContentCardChipRow",
      "RailContentCardFieldList",
      "RailContentCardField",
      "RailContentCardFooter",
    ]) {
      expect(slice).not.toMatch(new RegExp(`<${slot}\\b`));
    }
  });

  it("forwards the ContactCard props to the descriptor builder", () => {
    const slice = bodyComponentSlice();
    expect(slice).toMatch(/buildClientContactDescriptor\(\{/);
    expect(slice).toMatch(/\bcontact\b/);
    expect(slice).toMatch(/\bonEdit\b/);
    expect(slice).toMatch(/\bshowScope\b/);
    expect(slice).toMatch(/\bassignedLocationNames\b/);
  });
});

// ── 2. Page-level invariant — slot imports are gone ────────────────

describe("ClientDetailPage — no direct slot-primitive imports (Phase 6 final)", () => {
  it("the page does NOT import any `RailContentCard*` slot primitive", () => {
    // After Phase 6, the only rail-related imports in the page are
    // the `RailPanelRenderer` and the descriptor types. Slot
    // composition is fully owned by the renderer module.
    expect(pageSrc).not.toMatch(
      /from\s+["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("the page DOES import the canonical `RailPanelRenderer`", () => {
    expect(pageSrc).toMatch(
      /import\s*\{\s*RailPanelRenderer\s*\}\s*from\s+["']@\/components\/detail-rail\/RailPanelRenderer["']/,
    );
  });
});

// ── 3. Descriptor builder — clickable contract ─────────────────────

describe("buildClientContactDescriptor — clickable contract", () => {
  it("normalises the contact via `normalizeContact(contact)`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/normalizeContact\(contact\)/);
  });

  it("when `onEdit` is supplied, descriptor carries `onClick: () => onEdit(contact)` + the canonical edit testId + ariaLabel", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/onClick:\s*onEdit\s*\?\s*\(\)\s*=>\s*onEdit\(contact\)\s*:\s*undefined/);
    expect(slice).toMatch(
      /testId:\s*onEdit\s*\?\s*"contact-card-edit"\s*:\s*"contact-card"/,
    );
    expect(slice).toMatch(
      /ariaLabel:\s*onEdit\s*\?\s*`Edit contact \$\{nc\.displayName\}`\s*:\s*undefined/,
    );
  });
});

// ── 4. Descriptor builder — title with secondary + trailing ────────

describe("buildClientContactDescriptor — title", () => {
  it("title text uses `nc.displayName` and renders as `as: \"span\"`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /title:\s*\{[\s\S]{0,400}?text:\s*nc\.displayName,[\s\S]{0,300}?as:\s*"span"/,
    );
  });

  it("title `secondary` is `(jobTitle)` when present, undefined otherwise", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /secondary:\s*nc\.jobTitle\s*\?\s*`\(\$\{nc\.jobTitle\}\)`\s*:\s*undefined/,
    );
  });

  it("title `trailing` carries an `icon: Star` when `nc.isPrimary` is true", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/if\s*\(\s*nc\.isPrimary\s*\)\s*\{/);
    expect(slice).toMatch(
      /kind:\s*"icon",[\s\S]{0,300}?icon:\s*Star,[\s\S]{0,200}?ariaLabel:\s*"Primary"/,
    );
  });

  it("title `trailing` carries a `Company` chip when `showScope && nc.scope === \"company\"`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*showScope\s*&&\s*nc\.scope\s*===\s*"company"\s*\)/,
    );
    expect(slice).toMatch(
      /kind:\s*"chip",[\s\S]{0,200}?chip:\s*\{\s*text:\s*"Company"\s*\}/,
    );
  });

  it("title `trailing` is undefined when neither primary nor company chip applies (no empty array)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /trailing:\s*trailing\.length\s*>\s*0\s*\?\s*trailing\s*:\s*undefined/,
    );
  });
});

// ── 5. Descriptor builder — meta rows ──────────────────────────────

describe("buildClientContactDescriptor — meta rows", () => {
  it("phone item uses `Phone` icon (no truncate)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*nc\.phone\s*\)\s*phoneEmailItems\.push\(\{\s*icon:\s*Phone,\s*text:\s*nc\.phone\s*\}\)/,
    );
  });

  it("email item uses `Mail` icon with `truncate: true`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*nc\.email\s*\)\s*phoneEmailItems\.push\(\{\s*icon:\s*Mail,\s*text:\s*nc\.email,\s*truncate:\s*true\s*\}\)/,
    );
  });

  it("phone/email items are pushed onto `metaRows` only when at least one is present", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*phoneEmailItems\.length\s*>\s*0\s*\)\s*\{[\s\S]{0,300}?metaRows\.push\(\{\s*items:\s*phoneEmailItems\s*\}\)/,
    );
  });

  it("location item uses `MapPin` icon with `truncate: true`", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /if\s*\(\s*locationLabel\s*\)\s*\{[\s\S]{0,400}?items:\s*\[\{\s*icon:\s*MapPin,\s*text:\s*locationLabel,\s*truncate:\s*true\s*\}\]/,
    );
  });

  it("`metaRows` is undefined when neither phone/email nor location is present", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /metaRows:\s*metaRows\.length\s*>\s*0\s*\?\s*metaRows\s*:\s*undefined/,
    );
  });
});

// ── 6. Descriptor builder — role chip row ──────────────────────────

describe("buildClientContactDescriptor — role chip row", () => {
  it("emits a `chipRow` mapping each role to a `text + capitalize` chip", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /chipRow:\s*\n?\s*nc\.roles\.length\s*>\s*0\s*\n?\s*\?\s*nc\.roles\.map\(\(r\)\s*=>\s*\(\{\s*text:\s*r,\s*className:\s*"capitalize"\s*\}\)\)/,
    );
  });

  it("`chipRow` is undefined when there are no roles", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/chipRow:[\s\S]{0,400}?:\s*undefined/);
  });
});

// ── 7. Location label formatting ───────────────────────────────────

describe("buildClientContactDescriptor — location label", () => {
  it("respects `MAX_VISIBLE_LOCATIONS = 2` and shows `+N more` when over the cap", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(/MAX_VISIBLE_LOCATIONS\s*=\s*2/);
    // The `.slice(...)` and `.join(...)` calls live on separate
    // lines in the source — allow whitespace/newlines between.
    expect(slice).toMatch(
      /assignedLocationNames[\s\S]{0,200}?\.slice\(0,\s*MAX_VISIBLE_LOCATIONS\)[\s\S]{0,200}?\.join\(",\s*"\)/,
    );
    expect(slice).toMatch(
      /\+\$\{assignedLocationNames\.length\s*-\s*MAX_VISIBLE_LOCATIONS\}\s*more/,
    );
  });

  it("returns `null` when no location names are assigned (skips the meta row)", () => {
    const slice = descriptorBuilderSlice();
    expect(slice).toMatch(
      /assignedLocationNames\s*&&\s*assignedLocationNames\.length\s*>\s*0[\s\S]{0,300}?:\s*null/,
    );
  });
});
