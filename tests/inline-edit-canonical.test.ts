/**
 * inline-edit-canonical.test.ts — guard tests for the canonical inline-edit
 * renderer system (2026-05-10).
 *
 * Pins:
 *  1. InlineEditableText.tsx exports useInlineEdit, InlineEditFooter, InlineEditableText
 *  2. Semantic typography tokens in InlineEditableText (text-helper, not text-sm/xs)
 *  3. Semantic color tokens (text-foreground, text-muted-foreground, not hex/slate-*)
 *  4. Footer button anatomy: variant="outline" save, variant="ghost" cancel, h-7 text-xs
 *  5. Keyboard handling: Escape cancels, Cmd+Enter submits when submitOnCmdEnter
 *  6. EditableMessageCard — uses useInlineEdit / InlineEditFooter, no local state machine
 *  7. DraftNotesCard — uses useInlineEdit / InlineEditFooter, no local state machine
 *  8. QuoteDescriptionCard — uses useInlineEdit, no duplicate [editing, setEditing] pair
 *  9. No duplicated inline state machine boilerplate in any of the 3 migrated files
 * 10. autoFocus on all textareas in inline edit mode
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const FORMS = resolve(ROOT, "client/src/components/forms");
const INV   = resolve(ROOT, "client/src/components/invoice");
const QUOTE = resolve(ROOT, "client/src/components/quotes");

const PRIMITIVE  = readFileSync(resolve(FORMS, "InlineEditableText.tsx"), "utf-8");
const EMC        = readFileSync(resolve(INV,   "EditableMessageCard.tsx"), "utf-8");
const DNC        = readFileSync(resolve(INV,   "DraftNotesCard.tsx"), "utf-8");
const QDC        = readFileSync(resolve(QUOTE, "QuoteDescriptionCard.tsx"), "utf-8");

// ── 1. Primitive exports ──────────────────────────────────────────────────────

describe("InlineEditableText.tsx exports", () => {
  it("exports useInlineEdit", () => {
    expect(PRIMITIVE).toContain("export function useInlineEdit");
  });
  it("exports InlineEditFooter", () => {
    expect(PRIMITIVE).toContain("export function InlineEditFooter");
  });
  it("exports InlineEditableText", () => {
    expect(PRIMITIVE).toContain("export function InlineEditableText");
  });
  it("exports UseInlineEditParams interface", () => {
    expect(PRIMITIVE).toContain("export interface UseInlineEditParams");
  });
  it("exports InlineEditFooterProps interface", () => {
    expect(PRIMITIVE).toContain("export interface InlineEditFooterProps");
  });
  it("exports InlineEditableTextProps interface", () => {
    expect(PRIMITIVE).toContain("export interface InlineEditableTextProps");
  });
});

// ── 2. Semantic typography in the primitive ───────────────────────────────────

describe("InlineEditableText.tsx uses canonical typography tokens", () => {
  it("view text uses text-helper (not text-sm)", () => {
    // view mode paragraph uses text-helper
    expect(PRIMITIVE).toContain("text-helper leading-relaxed whitespace-pre-wrap");
  });
  it("empty label uses text-helper (not text-xs or text-sm)", () => {
    expect(PRIMITIVE).toContain("text-helper italic text-muted-foreground");
  });
  it("textarea uses text-helper (not text-sm)", () => {
    expect(PRIMITIVE).toContain("text-helper leading-relaxed text-foreground");
  });
  it("does not use banned text-sm in feature code", () => {
    // Allow text-sm in comments; reject in className strings
    const classNames = PRIMITIVE.match(/className="[^"]*"/g) ?? [];
    for (const cn of classNames) {
      expect(cn).not.toContain("text-sm");
    }
  });
  it("does not use banned text-xs in feature code", () => {
    const classNames = PRIMITIVE.match(/className="[^"]*"/g) ?? [];
    // h-7 text-xs is in buttons — allowed in the h-7 button context
    // The text-xs appears ONLY in button classes (h-7 text-xs), not in content
    for (const cn of classNames) {
      if (cn.includes("text-xs") && !cn.includes("h-7")) {
        expect.fail(`Non-button text-xs found: ${cn}`);
      }
    }
  });
});

// ── 3. Semantic color tokens in the primitive ─────────────────────────────────

describe("InlineEditableText.tsx uses semantic color tokens", () => {
  it("uses text-foreground for view text (not text-slate-*)", () => {
    expect(PRIMITIVE).toContain("text-foreground");
  });
  it("uses text-muted-foreground for empty label (not text-slate-400)", () => {
    expect(PRIMITIVE).toContain("text-muted-foreground");
  });
  it("has no hex color literals", () => {
    expect(PRIMITIVE).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
  });
  it("has no text-slate-* in content classNames (only structural)", () => {
    // text-slate-* is banned in the canonical primitive itself
    expect(PRIMITIVE).not.toMatch(/text-slate-[0-9]+/);
  });
});

// ── 4. Footer button anatomy ──────────────────────────────────────────────────

describe("InlineEditFooter button anatomy", () => {
  it("cancel button uses variant='ghost'", () => {
    // Within InlineEditFooter block
    expect(PRIMITIVE).toContain('variant="ghost"');
  });
  it("save button uses variant='outline'", () => {
    expect(PRIMITIVE).toContain('variant="outline"');
  });
  it("both buttons use size='sm' with h-7 text-xs", () => {
    expect(PRIMITIVE).toContain('className="h-7 text-xs"');
  });
  it("save button shows 'Saving...' when saving is true", () => {
    expect(PRIMITIVE).toContain('"Saving..." : "Save"');
  });
  it("save button disabled when !isDirty OR saving", () => {
    expect(PRIMITIVE).toContain("saving || !isDirty");
  });
  it("cancel button disabled when saving", () => {
    // The Cancel button in InlineEditFooter has disabled={saving}
    // Search in the InlineEditFooter function body only
    const footerFn = PRIMITIVE.slice(PRIMITIVE.indexOf("export function InlineEditFooter"));
    expect(footerFn).toContain("disabled={saving}");
  });
  it("leftSlot renders at left of footer row", () => {
    expect(PRIMITIVE).toContain("leftSlot");
    expect(PRIMITIVE).toContain("{leftSlot}");
  });
});

// ── 5. Keyboard handling in InlineEditableText ────────────────────────────────

describe("InlineEditableText keyboard handling", () => {
  it("Escape key calls handleCancel", () => {
    expect(PRIMITIVE).toContain('e.key === "Escape"');
    expect(PRIMITIVE).toContain("handleCancel()");
  });
  it("Cmd+Enter submit is gated by submitOnCmdEnter flag", () => {
    expect(PRIMITIVE).toContain("submitOnCmdEnter");
    expect(PRIMITIVE).toContain("e.metaKey || e.ctrlKey");
    expect(PRIMITIVE).toContain('e.key === "Enter"');
  });
  it("view mode Enter/Space activates edit", () => {
    // The click-to-edit affordance responds to Enter and Space
    expect(PRIMITIVE).toMatch(/e\.key === "Enter"[\s\S]{0,50}e\.key === " "/);
  });
  it("textarea has autoFocus", () => {
    expect(PRIMITIVE).toContain("autoFocus");
  });
});

// ── 6. EditableMessageCard migration ─────────────────────────────────────────

describe("EditableMessageCard — migrated to useInlineEdit / InlineEditFooter", () => {
  it("imports useInlineEdit from the canonical path", () => {
    expect(EMC).toContain('from "@/components/forms/InlineEditableText"');
    expect(EMC).toContain("useInlineEdit");
  });
  it("imports InlineEditFooter from the canonical path", () => {
    expect(EMC).toContain("InlineEditFooter");
  });
  it("no longer declares local [editing, setEditing] state", () => {
    expect(EMC).not.toContain("useState(false)");
  });
  it("no longer declares local [localSaving, setLocalSaving] state", () => {
    expect(EMC).not.toContain("localSaving");
  });
  it("no longer has handleSave defined locally", () => {
    // handleSave comes from the hook now
    expect(EMC).not.toContain("const handleSave");
  });
  it("no longer has duplicated isDirty calculation", () => {
    expect(EMC).not.toContain("draft !== value");
  });
  it("uses InlineEditFooter with leftSlot for reset button", () => {
    expect(EMC).toContain("leftSlot={resetSlot}");
  });
  it("textarea uses text-helper token (not text-sm)", () => {
    expect(EMC).toContain("text-helper leading-relaxed text-foreground");
  });
  it("view text uses text-helper token (not text-sm)", () => {
    expect(EMC).toContain("text-helper leading-relaxed whitespace-pre-wrap text-foreground");
  });
  it("textarea has autoFocus", () => {
    expect(EMC).toContain("autoFocus");
  });
  it("preserves compactCollapsed behavior", () => {
    expect(EMC).toContain("compactCollapsed");
  });
  it("preserves the reset-to-default affordance", () => {
    expect(EMC).toContain("resetSlot");
    expect(EMC).toContain("Reset to default");
  });
});

// ── 7. DraftNotesCard migration ───────────────────────────────────────────────

describe("DraftNotesCard — migrated to useInlineEdit / InlineEditFooter", () => {
  it("imports useInlineEdit from the canonical path", () => {
    expect(DNC).toContain('from "@/components/forms/InlineEditableText"');
    expect(DNC).toContain("useInlineEdit");
  });
  it("imports InlineEditFooter", () => {
    expect(DNC).toContain("InlineEditFooter");
  });
  it("no longer declares local [editing, setEditing] state", () => {
    expect(DNC).not.toContain("useState(false)");
  });
  it("no longer declares local [localSaving, setLocalSaving] state", () => {
    expect(DNC).not.toContain("localSaving");
  });
  it("no longer has handleSave defined locally", () => {
    expect(DNC).not.toContain("const handleSave");
  });
  it("no longer has duplicated isDirty calculation", () => {
    expect(DNC).not.toContain("draft !== value");
  });
  it("textarea uses text-helper token", () => {
    expect(DNC).toContain("text-helper leading-relaxed text-foreground");
  });
  it("textarea has autoFocus", () => {
    expect(DNC).toContain("autoFocus");
  });
  it("preserves click-to-edit note display row", () => {
    expect(DNC).toContain("note-draft-internal");
  });
  it("preserves empty state copy 'No notes yet'", () => {
    expect(DNC).toContain("No notes yet");
  });
});

// ── 8. QuoteDescriptionCard migration ────────────────────────────────────────

describe("QuoteDescriptionCard — migrated to useInlineEdit", () => {
  it("imports useInlineEdit from the canonical path", () => {
    expect(QDC).toContain('from "@/components/forms/InlineEditableText"');
    expect(QDC).toContain("useInlineEdit");
  });
  it("no longer declares local [editing, setEditing] state (uses hook)", () => {
    // The hook provides editing; no useState(false) for it
    expect(QDC).not.toContain("[editing, setEditing]");
  });
  it("no longer declares local [draft, setDraft] state (uses hook)", () => {
    expect(QDC).not.toContain("[draft, setDraft]");
  });
  it("no longer has a standalone commit() function", () => {
    // commit() replaced by handleSave from hook
    expect(QDC).not.toContain("const commit");
  });
  it("view text uses text-helper (not text-sm text-slate-600)", () => {
    expect(QDC).not.toContain("text-sm text-slate-600");
    expect(QDC).toContain("text-helper");
  });
  it("empty state uses text-muted-foreground (not text-slate-400)", () => {
    expect(QDC).not.toContain("text-slate-400 italic");
    expect(QDC).toContain("text-muted-foreground");
  });
  it("preserves Cmd+Enter / Escape keyboard handling", () => {
    expect(QDC).toContain("metaKey || e.ctrlKey");
    expect(QDC).toContain('e.key === "Escape"');
  });
  it("preserves Loader2 in save button (QDC-specific affordance)", () => {
    expect(QDC).toContain("Loader2");
    expect(QDC).toContain("animate-spin");
  });
  it("preserves inline prop behavior", () => {
    expect(QDC).toContain("inline");
  });
  it("preserves Collapsible in standalone card mode", () => {
    expect(QDC).toContain("Collapsible");
  });
  it("editBody and viewBody are shared between inline and card modes (no duplication)", () => {
    // Both modes reference the same editBody and viewBody variables
    expect(QDC).toContain("const editBody");
    expect(QDC).toContain("const viewBody");
    // Each should appear once defined and twice used (inline + card)
    const editBodyCount = (QDC.match(/editBody/g) ?? []).length;
    expect(editBodyCount).toBeGreaterThanOrEqual(3); // defined + 2 usages
  });
});

// ── 9. No duplicated state machine in migrated files ─────────────────────────

describe("No duplicated inline-edit state boilerplate in migrated files", () => {
  const BOILERPLATE_PATTERNS = [
    /const\s+\[editing,\s*setEditing\]\s*=\s*useState/,
    /const\s+\[localSaving,\s*setLocalSaving\]\s*=\s*useState/,
    /result\s+instanceof\s+Promise/,
    /draft\s*!==\s*value/,
  ];

  for (const [name, src] of [["EditableMessageCard", EMC], ["DraftNotesCard", DNC]] as const) {
    for (const pattern of BOILERPLATE_PATTERNS) {
      it(`${name} has no duplicated boilerplate: ${pattern.source.slice(0, 40)}`, () => {
        expect(src).not.toMatch(pattern);
      });
    }
  }
});

// ── 10. autoFocus on all edit textareas ──────────────────────────────────────

describe("autoFocus on edit textareas", () => {
  it("InlineEditableText textarea has autoFocus", () => {
    expect(PRIMITIVE).toContain("autoFocus");
  });
  it("EditableMessageCard textarea has autoFocus", () => {
    expect(EMC).toContain("autoFocus");
  });
  it("DraftNotesCard textarea has autoFocus", () => {
    expect(DNC).toContain("autoFocus");
  });
  it("QuoteDescriptionCard textarea has autoFocus", () => {
    expect(QDC).toContain("autoFocus");
  });
});
