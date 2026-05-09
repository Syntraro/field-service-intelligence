/**
 * ActionMenu canonicalization pins (2026-05-09).
 *
 * Guards the architectural contract established by the Phase M1/M2/M3/M4 pass:
 *
 *   M1.  action-menu.tsx exports ActionMenuTone, ActionMenuItemDescriptor, ActionMenu.
 *   M2.  ActionMenuItemDescriptor has no className field.
 *   M3.  ActionMenu icon rendering does not include mr-2 (icon spacing via gap-2 only).
 *   M4.  TONE_CLASSES uses text-destructive / focus:text-destructive for destructive.
 *   M5.  TONE_CLASSES uses semantic tokens (text-success, text-warning-foreground, text-info); warning uses -foreground for WCAG AA.
 *   M6.  CDH's HeaderOverflowItem no longer has className or destructive fields.
 *   M7.  CDH delegates overflow rendering to ActionMenu (no raw DropdownMenuItem).
 *   M8.  JobDetailPage uses tone: "success" / tone: "destructive" — no className escape.
 *   M9.  QuoteHeaderCard uses tone: "destructive" — no destructive: true.
 *   M10. LeadSummaryCard uses tone: "destructive" — no destructive: true.
 *   M11. InvoiceDetailPage: no raw DropdownMenuItem in the action bar.
 *   M12. InvoiceDetailPage: no text-rose-600.
 *   M13. InvoiceDetailPage: void-invoice and delete-draft use tone: "destructive".
 *   M14. InvoiceDetailPage: all action items have stable id fields.
 *   M15. InvoiceDetailPage: portalCtasAvailable gating uses hidden, not conditional JSX.
 *   M16. disabledHint field present on ActionMenuItemDescriptor; title rendered conditionally.
 *   M17. JobHeaderCard: migrated to ActionMenu; no raw DropdownMenuItem; delete-job uses tone: "destructive".
 *   M18. ClientDetailPage: migrated to ActionMenu; delete-client and delete-location use tone: "destructive".
 *   M19. JobTemplatesPage + QuoteTemplatesPage: migrated to ActionMenu; delete uses tone: "destructive".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const ACTION_MENU    = path("client/src/components/ui/action-menu.tsx");
const CDH            = path("client/src/components/detail/CanonicalDetailHeader.tsx");
const JOB_DETAIL     = path("client/src/pages/JobDetailPage.tsx");
const QUOTE_CARD     = path("client/src/components/QuoteHeaderCard.tsx");
const LEAD_CARD      = path("client/src/components/leads/LeadSummaryCard.tsx");
const JOB_HEADER_CARD    = path("client/src/components/JobHeaderCard.tsx");
const CLIENT_DETAIL      = path("client/src/pages/ClientDetailPage.tsx");
const JOB_TEMPLATES      = path("client/src/pages/JobTemplatesPage.tsx");
const QUOTE_TEMPLATES    = path("client/src/pages/QuoteTemplatesPage.tsx");

function read(p: string): string { return readFileSync(p, "utf-8"); }

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Extract a TypeScript interface body by counting braces from the opening { onwards. */
function extractInterface(src: string, name: string): string {
  const start = src.indexOf(`interface ${name}`);
  if (start === -1) throw new Error(`interface ${name} not found`);
  const openBrace = src.indexOf("{", start);
  if (openBrace === -1) throw new Error(`opening brace for ${name} not found`);
  let depth = 0;
  let i = openBrace;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// ── M1. action-menu.tsx exports ────────────────────────────────────────

describe("action-menu.tsx — exports", () => {
  const src = read(ACTION_MENU);

  it("exports ActionMenuTone", () => {
    expect(src).toMatch(/export type ActionMenuTone/);
  });

  it("exports ActionMenuItemDescriptor", () => {
    expect(src).toMatch(/export interface ActionMenuItemDescriptor/);
  });

  it("exports ActionMenu function", () => {
    expect(src).toMatch(/export function ActionMenu/);
  });
});

// ── M2. ActionMenuItemDescriptor has no className ──────────────────────

describe("ActionMenuItemDescriptor — no className field", () => {
  const src = read(ACTION_MENU);

  it("ActionMenuItemDescriptor interface does not declare className as a field", () => {
    // Match className as a field declaration (start of line, not inside a generic like ComponentType<{className}>).
    const iface = stripComments(extractInterface(src, "ActionMenuItemDescriptor"));
    expect(iface).not.toMatch(/^\s*className\??\s*:/m);
  });
});

// ── M3. Icon rendering — no mr-2 ──────────────────────────────────────

describe("ActionMenu — icon rendering does not use mr-2", () => {
  const src = read(ACTION_MENU);

  it("no mr-2 class in action-menu.tsx source (icon spacing via gap-2)", () => {
    expect(stripComments(src)).not.toMatch(/\bmr-2\b/);
  });
});

// ── M4 + M5. Tone map uses canonical semantic tokens ──────────────────

describe("ActionMenu — TONE_CLASSES canonical token map", () => {
  const src = read(ACTION_MENU);

  it("destructive uses text-destructive focus:text-destructive", () => {
    expect(src).toMatch(/destructive.*text-destructive focus:text-destructive/);
  });

  it("success uses text-success focus:text-success (semantic token)", () => {
    expect(src).toMatch(/success.*text-success focus:text-success/);
  });

  it("warning uses text-warning-foreground focus:text-warning-foreground (WCAG AA accessible token)", () => {
    expect(src).toMatch(/warning.*text-warning-foreground focus:text-warning-foreground/);
  });

  it("info uses text-info focus:text-info (semantic token)", () => {
    expect(src).toMatch(/info.*text-info focus:text-info/);
  });

  it("does NOT contain text-rose (raw color forbidden in tone map)", () => {
    expect(stripComments(src)).not.toMatch(/text-rose/);
  });

  it("does NOT contain text-emerald (raw color forbidden in tone map)", () => {
    expect(stripComments(src)).not.toMatch(/text-emerald/);
  });
});

// ── M6. CDH HeaderOverflowItem — no className, no destructive ─────────

describe("CanonicalDetailHeader — HeaderOverflowItem interface", () => {
  const src = read(CDH);

  it("HeaderOverflowItem does not have className field", () => {
    const iface = stripComments(extractInterface(src, "HeaderOverflowItem"));
    expect(iface).not.toMatch(/^\s*className\??\s*:/m);
  });

  it("HeaderOverflowItem does not have destructive field (replaced by tone)", () => {
    const iface = stripComments(extractInterface(src, "HeaderOverflowItem"));
    expect(iface).not.toMatch(/\bdestructive\b/);
  });

  it("HeaderOverflowItem has tone field", () => {
    const iface = extractInterface(src, "HeaderOverflowItem");
    expect(iface).toMatch(/\btone\b/);
  });
});

// ── M7. CDH delegates to ActionMenu, not raw DropdownMenuItem ─────────

describe("CanonicalDetailHeader — overflow rendered via ActionMenu", () => {
  const src = read(CDH);

  it("imports ActionMenu from canonical action-menu path", () => {
    expect(src).toMatch(/from "@\/components\/ui\/action-menu"/);
  });

  it("uses <ActionMenu in overflow section", () => {
    expect(src).toMatch(/<ActionMenu/);
  });

  it("does NOT import DropdownMenuItem from dropdown-menu (delegated to ActionMenu)", () => {
    // The dropdown-menu import block should no longer exist in CDH.
    expect(src).not.toMatch(/from "@\/components\/ui\/dropdown-menu"/);
  });

  it("does NOT render raw DropdownMenuItem in overflow section", () => {
    // After migration, no raw <DropdownMenuItem in CDH source.
    expect(stripComments(src)).not.toMatch(/<DropdownMenuItem/);
  });

  it("does NOT apply item.destructive in overflow render (removed field)", () => {
    expect(stripComments(src)).not.toMatch(/item\.destructive/);
  });

  it("does NOT apply item.className in overflow render (removed field)", () => {
    expect(stripComments(src)).not.toMatch(/item\.className/);
  });
});

// ── M8. JobDetailPage — no className escape, correct tone usage ────────

describe("JobDetailPage — overflow descriptors use tone, not className", () => {
  const src = read(JOB_DETAIL);

  it("complete-job item uses tone: 'success' not className", () => {
    expect(src).toMatch(/id:\s*["']complete-job["'][\s\S]{0,300}tone:\s*["']success["']/);
  });

  it("delete-job item uses tone: 'destructive' not destructive: true", () => {
    expect(src).toMatch(/id:\s*["']delete-job["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("no HeaderOverflowItem in overflow array uses className field", () => {
    // Find the overflowActions prop block
    const overflowStart = src.indexOf("overflowActions={[");
    expect(overflowStart).toBeGreaterThan(-1);
    const overflowEnd = src.indexOf("]}", overflowStart);
    const overflowBlock = stripComments(src.slice(overflowStart, overflowEnd + 2));
    expect(overflowBlock).not.toMatch(/\bclassName:/);
  });

  it("no HeaderOverflowItem in overflow array uses destructive: true", () => {
    const overflowStart = src.indexOf("overflowActions={[");
    const overflowEnd = src.indexOf("]}", overflowStart);
    const overflowBlock = stripComments(src.slice(overflowStart, overflowEnd + 2));
    expect(overflowBlock).not.toMatch(/destructive:\s*true/);
  });

  it("no raw text-emerald-700 in overflow descriptors", () => {
    const overflowStart = src.indexOf("overflowActions={[");
    const overflowEnd = src.indexOf("]}", overflowStart);
    const overflowBlock = stripComments(src.slice(overflowStart, overflowEnd + 2));
    expect(overflowBlock).not.toMatch(/text-emerald/);
  });
});

// ── M9. QuoteHeaderCard — tone: "destructive" ─────────────────────────

describe("QuoteHeaderCard — overflow destructive item uses tone", () => {
  const src = read(QUOTE_CARD);

  it("delete-quote item uses tone: 'destructive'", () => {
    expect(src).toMatch(/id:\s*["']delete-quote["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("delete-quote item does NOT use destructive: true", () => {
    const deleteBlock = src.match(/id:\s*["']delete-quote["'][\s\S]{0,300}[}\]]/)?.[0] ?? "";
    expect(stripComments(deleteBlock)).not.toMatch(/destructive:\s*true/);
  });
});

// ── M10. LeadSummaryCard — tone: "destructive" ────────────────────────

describe("LeadSummaryCard — overflow destructive item uses tone", () => {
  const src = read(LEAD_CARD);

  it("hard-delete item uses tone: 'destructive'", () => {
    expect(src).toMatch(/id:\s*["']hard-delete["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("hard-delete item does NOT use destructive: true", () => {
    const deleteBlock = src.match(/id:\s*["']hard-delete["'][\s\S]{0,300}[}\]]/)?.[0] ?? "";
    expect(stripComments(deleteBlock)).not.toMatch(/destructive:\s*true/);
  });
});

// ── M11–M15. InvoiceDetailPage action bar migration ───────────────────

const INVOICE_DETAIL = path("client/src/pages/InvoiceDetailPage.tsx");

describe("InvoiceDetailPage — action bar uses ActionMenu descriptor", () => {
  const src = read(INVOICE_DETAIL);

  it("M11 — does not render raw <DropdownMenuItem in the file", () => {
    expect(stripComments(src)).not.toMatch(/<DropdownMenuItem/);
  });

  it("M11 — does not import from dropdown-menu", () => {
    expect(src).not.toMatch(/from "@\/components\/ui\/dropdown-menu"/);
  });

  it("M11 — imports ActionMenu from canonical action-menu path", () => {
    expect(src).toMatch(/from "@\/components\/ui\/action-menu"/);
  });

  it("M12 — no text-rose-600 in the actionBarItems descriptor block", () => {
    // text-rose-600 may legitimately appear in other parts of InvoiceDetailPage
    // (e.g. error-state paragraphs). This pin targets only the action bar.
    const blockStart = src.indexOf("const actionBarItems:");
    expect(blockStart, "actionBarItems block must exist").toBeGreaterThan(-1);
    const blockEnd = src.indexOf("];", blockStart);
    const block = stripComments(src.slice(blockStart, blockEnd + 2));
    expect(block).not.toMatch(/text-rose-600/);
  });

  it("M13 — void-invoice item uses tone: 'destructive'", () => {
    expect(src).toMatch(/id:\s*["']void-invoice["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("M13 — delete-draft item uses tone: 'destructive'", () => {
    expect(src).toMatch(/id:\s*["']delete-draft["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("M14 — stable id fields present for all expected items", () => {
    // These ids are the stable identifiers for each item.
    const ids = [
      "download-pdf",
      "print-pdf",
      "copy-payment-link",
      "open-client-portal",
      "email-payment-link",
      "toggle-sent",
      "void-invoice",
      "delete-draft",
    ];
    for (const id of ids) {
      expect(src, `id "${id}" should be present`).toMatch(
        new RegExp(`id:\\s*["']${id}["']`)
      );
    }
  });

  it("M15 — portalCtasAvailable gating uses hidden: !portalCtasAvailable (not conditional JSX)", () => {
    // The canonical pattern is `hidden: !portalCtasAvailable` on the descriptor.
    // If the old conditional-JSX pattern is present, it would look like:
    // `{portalCtasAvailable && <DropdownMenuItem`. That is already excluded by M11.
    // Positive pin: confirm hidden field is used.
    expect(stripComments(src)).toMatch(/hidden:\s*!portalCtasAvailable/);
  });

  it("M15 — primaryAction in-dropdown gating uses hasPrimaryInDropdown (not conditional JSX block)", () => {
    expect(src).toMatch(/hasPrimaryInDropdown/);
  });

  it("primary-action item has testId: 'menu-primary-action' (data-testid preserved)", () => {
    expect(src).toMatch(/id:\s*["']primary-action["'][\s\S]{0,300}testId:\s*["']menu-primary-action["']/);
  });

  it("M16 — primary-action item wires disabledHint from primaryDisabledHint", () => {
    expect(stripComments(src)).toMatch(/disabledHint:\s*primaryAction[^.]/);
  });
});

// ── M16. disabledHint API — action-menu.tsx contract ─────────────────

describe("ActionMenu — disabledHint field and title rendering", () => {
  const src = read(ACTION_MENU);

  it("ActionMenuItemDescriptor declares disabledHint field", () => {
    const iface = extractInterface(src, "ActionMenuItemDescriptor");
    expect(iface).toMatch(/\bdisabledHint\b/);
  });

  it("ActionMenu renders title attribute using disabledHint", () => {
    expect(stripComments(src)).toMatch(/title=\{.*disabledHint/);
  });

  it("title is only set when item is disabled (not unconditionally)", () => {
    // Must guard on item.disabled before applying disabledHint as title.
    expect(stripComments(src)).toMatch(/item\.disabled.*disabledHint|disabledHint.*item\.disabled/);
  });
});

// ── M17. JobHeaderCard — migrated to ActionMenu ───────────────────────

describe("JobHeaderCard — More Actions menu uses ActionMenu descriptor", () => {
  const src = read(JOB_HEADER_CARD);

  it("M17 — imports ActionMenu from canonical action-menu path", () => {
    expect(src).toMatch(/from "@\/components\/ui\/action-menu"/);
  });

  it("M17 — does not import from dropdown-menu", () => {
    expect(src).not.toMatch(/from "@\/components\/ui\/dropdown-menu"/);
  });

  it("M17 — does not render raw <DropdownMenuItem", () => {
    expect(stripComments(src)).not.toMatch(/<DropdownMenuItem/);
  });

  it("M17 — no icon mr-2 inside the ActionMenu items array", () => {
    // mr-2 on the trigger button icon is fine; the pin targets item descriptors.
    const itemsStart = src.indexOf("items={[");
    expect(itemsStart, "ActionMenu items block must exist").toBeGreaterThan(-1);
    const itemsEnd = src.indexOf("] satisfies ActionMenuItemDescriptor[]}", itemsStart);
    const block = stripComments(src.slice(itemsStart, itemsEnd));
    expect(block).not.toMatch(/\bmr-2\b/);
  });

  it("M17 — delete-job uses tone: 'destructive'", () => {
    expect(src).toMatch(/id:\s*["']delete-job["'][\s\S]{0,300}tone:\s*["']destructive["']/);
  });

  it("M17 — close-job item is hidden for terminal states (hidden: !isOfficeUser || isTerminal)", () => {
    expect(stripComments(src)).toMatch(/id:\s*["']close-job["'][\s\S]{0,200}hidden:/);
  });

  it("M17 — reopen-job item is hidden when not applicable (hidden field present)", () => {
    // Lookahead is 400 chars: reopen-job has a ternary label + disabled field before hidden.
    expect(stripComments(src)).toMatch(/id:\s*["']reopen-job["'][\s\S]{0,400}hidden:/);
  });

  it("M17 — delete-job item is hidden for non-office users (hidden: !isOfficeUser)", () => {
    expect(stripComments(src)).toMatch(/id:\s*["']delete-job["'][\s\S]{0,200}hidden:/);
  });

  it("M17 — all stable testId values preserved", () => {
    const testIds = [
      "menu-close-job",
      "menu-reopen-job",
      "menu-create-similar",
      "menu-collect-signature",
      "menu-download-pdf",
      "menu-print",
      "menu-delete-job",
    ];
    for (const tid of testIds) {
      expect(src, `testId "${tid}" should be present`).toMatch(
        new RegExp(`testId:\\s*["']${tid}["']`)
      );
    }
  });
});

// ── M18. ClientDetailPage — migrated to ActionMenu ────────────────────

describe("ClientDetailPage — header overflow menu uses ActionMenu descriptor", () => {
  const src = read(CLIENT_DETAIL);

  it("M18 — imports ActionMenu from canonical action-menu path", () => {
    expect(src).toMatch(/from "@\/components\/ui\/action-menu"/);
  });

  it("M18 — does not import from dropdown-menu", () => {
    expect(src).not.toMatch(/from "@\/components\/ui\/dropdown-menu"/);
  });

  it("M18 — does not render raw <DropdownMenuItem", () => {
    expect(stripComments(src)).not.toMatch(/<DropdownMenuItem/);
  });

  it("M18 — no h-3.5 or w-3.5 inside the ActionMenu items array (icon sizing removed)", () => {
    const itemsStart = src.indexOf("items={[");
    expect(itemsStart, "ActionMenu items block must exist").toBeGreaterThan(-1);
    const itemsEnd = src.indexOf("] satisfies ActionMenuItemDescriptor[]}", itemsStart);
    const block = stripComments(src.slice(itemsStart, itemsEnd));
    expect(block).not.toMatch(/\bh-3\.5\b|\bw-3\.5\b/);
  });

  it("M18 — no mr-2 inside the ActionMenu items array", () => {
    const itemsStart = src.indexOf("items={[");
    const itemsEnd = src.indexOf("] satisfies ActionMenuItemDescriptor[]}", itemsStart);
    const block = stripComments(src.slice(itemsStart, itemsEnd));
    expect(block).not.toMatch(/\bmr-2\b/);
  });

  it("M18 — delete-client uses tone: 'destructive'", () => {
    // 500-char lookahead: comments between separator and tone push past 300.
    expect(src).toMatch(/id:\s*["']delete-client["'][\s\S]{0,500}tone:\s*["']destructive["']/);
  });

  it("M18 — delete-location uses tone: 'destructive'", () => {
    // 500-char lookahead: hidden + comment + separator fields before tone.
    expect(src).toMatch(/id:\s*["']delete-location["'][\s\S]{0,500}tone:\s*["']destructive["']/);
  });

  it("M18 — edit-client-tags visibility gated via hidden (company scope)", () => {
    expect(stripComments(src)).toMatch(/id:\s*["']edit-client-tags["'][\s\S]{0,200}hidden:/);
  });

  it("M18 — edit-location and edit-location-tags gated via hidden (location scope)", () => {
    expect(stripComments(src)).toMatch(/id:\s*["']edit-location["'][\s\S]{0,200}hidden:/);
    expect(stripComments(src)).toMatch(/id:\s*["']edit-location-tags["'][\s\S]{0,200}hidden:/);
  });

  it("M18 — delete-location gated via hidden (location scope)", () => {
    expect(stripComments(src)).toMatch(/id:\s*["']delete-location["'][\s\S]{0,300}hidden:/);
  });
});

// ── M19. Template pages — migrated to ActionMenu ──────────────────────

/** Shared structural checks applied to both template pages. */
function assertTemplatePage(src: string, label: string) {
  describe(`${label} — row action menu uses ActionMenu descriptor`, () => {
    it("M19 — imports ActionMenu from canonical action-menu path", () => {
      expect(src).toMatch(/from "@\/components\/ui\/action-menu"/);
    });

    it("M19 — does not import from dropdown-menu", () => {
      expect(src).not.toMatch(/from "@\/components\/ui\/dropdown-menu"/);
    });

    it("M19 — does not render raw <DropdownMenuItem", () => {
      expect(stripComments(src)).not.toMatch(/<DropdownMenuItem/);
    });

    it("M19 — no mr-2 inside the ActionMenu items array", () => {
      const itemsStart = src.indexOf("items={[");
      expect(itemsStart, "ActionMenu items block must exist").toBeGreaterThan(-1);
      const itemsEnd = src.indexOf("] satisfies ActionMenuItemDescriptor[]}", itemsStart);
      const block = stripComments(src.slice(itemsStart, itemsEnd));
      expect(block).not.toMatch(/\bmr-2\b/);
    });

    it("M19 — delete item uses tone: 'destructive'", () => {
      expect(src).toMatch(/tone:\s*["']destructive["']/);
    });

    it("M19 — set-default item has hidden field (conditional visibility)", () => {
      // id is dynamic (template.id suffix), so match on label pattern + hidden field.
      expect(stripComments(src)).toMatch(/["']Set as Default["'][\s\S]{0,300}hidden:/);
    });

    it("M19 — trigger button preserves stopPropagation (row click isolation)", () => {
      // The trigger button must call stopPropagation so opening the menu
      // doesn't also fire the clickable TableRow's onClick handler.
      expect(stripComments(src)).toMatch(/stopPropagation/);
    });

    it("M19 — trigger button carries data-testid button-actions pattern", () => {
      expect(src).toMatch(/data-testid=\{`button-actions-\$\{template\.id\}`\}/);
    });
  });
}

assertTemplatePage(readFileSync(JOB_TEMPLATES, "utf-8"), "JobTemplatesPage");
assertTemplatePage(readFileSync(QUOTE_TEMPLATES, "utf-8"), "QuoteTemplatesPage");

