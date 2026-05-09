/**
 * CanonicalDetailHeader — description section visibility rules (2026-05-09).
 *
 * Canonical rule:
 *   - Empty description is HIDDEN in read mode.
 *   - The section only appears when description has content OR when the
 *     inline editor's editing state is active (descEditing=true).
 *   - `onDescriptionSave` existing alone must NOT make the section visible.
 *   - Lead and Quote both follow this rule via CDH's controlled descEditing.
 *
 * These tests grep the CDH source for the implementation shape rather than
 * running React (matching the project's existing source-pin pattern).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const CDH_PATH = resolve(ROOT, "client/src/components/detail/CanonicalDetailHeader.tsx");
const LEAD_CARD_PATH = resolve(ROOT, "client/src/components/leads/LeadSummaryCard.tsx");
const QUOTE_CARD_PATH = resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx");
const QUOTE_PAGE_PATH = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const LEAD_PAGE_PATH = resolve(ROOT, "client/src/pages/LeadDetailPage.tsx");

const cdhSrc = readFileSync(CDH_PATH, "utf-8");
const leadCardSrc = readFileSync(LEAD_CARD_PATH, "utf-8");
const quoteCardSrc = readFileSync(QUOTE_CARD_PATH, "utf-8");
const quotePageSrc = readFileSync(QUOTE_PAGE_PATH, "utf-8");
const leadPageSrc = readFileSync(LEAD_PAGE_PATH, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const cdhCode = stripComments(cdhSrc);

// ── 1. CDH card layout — showDescription logic ──────────────────────────

describe("CanonicalDetailHeader — showDescription excludes onDescriptionSave-alone", () => {
  it("does NOT include 'onDescriptionSave !== undefined' in the showDescription expression", () => {
    // The old wrong line was: onDescriptionSave !== undefined ||
    // It must not appear in the showDescription block anymore.
    // We confirm by checking the showDescription assignment itself.
    // Strip comments first, then find the assignment block.
    const showDescBlock = cdhCode.match(/const showDescription\s*=[\s\S]*?;/)?.[0] ?? "";
    expect(showDescBlock).not.toMatch(/onDescriptionSave\s*!==\s*undefined/);
  });

  it("showDescription includes hasDescription as a condition", () => {
    const showDescBlock = cdhCode.match(/const showDescription\s*=[\s\S]*?;/)?.[0] ?? "";
    expect(showDescBlock).toMatch(/hasDescription/);
  });

  it("showDescription includes descEditing as a condition", () => {
    const showDescBlock = cdhCode.match(/const showDescription\s*=[\s\S]*?;/)?.[0] ?? "";
    expect(showDescBlock).toMatch(/descEditing/);
  });

  it("showDescription includes descriptionEdit (Job edit mode) as a condition", () => {
    // After 2026-05-09 normalization: descriptionEditContent ReactNode removed;
    // typed descriptionEdit descriptor is now the condition that triggers
    // section visibility when Job is in header-edit mode.
    const showDescBlock = cdhCode.match(/const showDescription\s*=[\s\S]*?;/)?.[0] ?? "";
    expect(showDescBlock).toMatch(/descriptionEdit/);
  });
});

// ── 2. CDH card layout — descEditing state ──────────────────────────────

describe("CanonicalDetailHeader — descEditing state lives in CDH card branch", () => {
  it("declares descEditing with useState inside the card layout branch", () => {
    expect(cdhCode).toMatch(/const\s+\[descEditing,\s*setDescEditing\]\s*=\s*useState\(false\)/);
  });

  it("showAddAffordance guards the Add description button", () => {
    expect(cdhCode).toMatch(/showAddAffordance/);
    expect(cdhSrc).toMatch(/data-testid=\{`\$\{testId\}-description-add`\}/);
    expect(cdhSrc).toMatch(/data-testid=\{`\$\{testId\}-description-add-btn`\}/);
  });

  it("Add description affordance uses Plus icon and onClick setDescEditing(true)", () => {
    expect(cdhCode).toMatch(/setDescEditing\(true\)/);
    expect(cdhSrc).toMatch(/<Plus/);
  });
});

// ── 3. InlineDescriptionEditor — controlled editing state ────────────────

describe("CanonicalDetailHeader — InlineDescriptionEditor is controlled", () => {
  it("InlineDescriptionEditorProps includes editing: boolean", () => {
    expect(cdhSrc).toMatch(/editing:\s*boolean/);
  });

  it("InlineDescriptionEditorProps includes onStartEdit callback", () => {
    expect(cdhSrc).toMatch(/onStartEdit:\s*\(\)\s*=>/);
  });

  it("InlineDescriptionEditorProps includes onCancel callback", () => {
    expect(cdhSrc).toMatch(/onCancel:\s*\(\)\s*=>/);
  });

  it("InlineDescriptionEditor uses useEffect to sync draft on edit open", () => {
    expect(cdhCode).toMatch(/useEffect\(/);
    expect(cdhSrc).toMatch(/if\s*\(editing\)\s*setDraft/);
  });

  it("InlineDescriptionEditor read mode does NOT render an empty placeholder", () => {
    // The read mode should only render value content, not a fallback italic placeholder.
    // Check: the read-mode branch of InlineDescriptionEditor has no italic/placeholder fallback.
    // We verify the old pattern is gone: {value ? ... : <p className="...italic...">placeholder</p>}
    expect(cdhCode).not.toMatch(/italic.*group-hover.*transition-colors[\s\S]{0,200}placeholder/);
  });
});

// ── 4. Lead — empty description hidden (source-level check) ─────────────

describe("LeadSummaryCard — description section hidden when empty in read mode", () => {
  it("LeadDetailPage passes onDescriptionSave conditionally (undefined for terminal leads)", () => {
    // The key line in LeadDetailPage: onDescriptionSave={!isTerminal ? ... : undefined}
    // When isTerminal, onDescriptionSave is undefined → no editor, no add affordance.
    // When !isTerminal, onDescriptionSave is provided → add affordance shows when empty.
    expect(leadPageSrc).toMatch(/onDescriptionSave=\{!isTerminal/);
  });

  it("LeadDetailPage page background uses canonical bg-app-bg token (not hardcoded hex)", () => {
    expect(leadPageSrc).not.toMatch(/bg-\[#f1f5f9\]/);
    expect(leadPageSrc).toMatch(/bg-app-bg/);
  });

  it("LeadSummaryCard passes descriptionLabel to CDH", () => {
    expect(leadCardSrc).toMatch(/descriptionLabel=/);
  });
});

// ── 5. Quote — empty description hidden (source-level check) ────────────

describe("QuoteHeaderCard — description section hidden when empty in read mode", () => {
  it("QuoteHeaderCard passes onDescriptionSave to CDH", () => {
    expect(quoteCardSrc).toMatch(/onDescriptionSave=/);
  });

  it("QuoteDetailPage wires onDescriptionSave to updateDescriptionMutation", () => {
    expect(quotePageSrc).toMatch(/onDescriptionSave=\{.*updateDescriptionMutation/);
  });

  it("QuoteDetailPage passes description as quote.notesCustomer", () => {
    expect(quotePageSrc).toMatch(/description=\{quote\.notesCustomer/);
  });
});

// ── 6. Saved description renders when non-empty ──────────────────────────

describe("CanonicalDetailHeader — non-empty description renders in section", () => {
  it("hasDescription is true when description is non-null and non-empty", () => {
    // The pattern: const hasDescription = description != null && description.trim().length > 0
    expect(cdhCode).toMatch(/hasDescription\s*=\s*description\s*!=\s*null\s*&&\s*description\.trim\(\)\.length\s*>\s*0/);
  });

  it("description section has testid testId-description", () => {
    expect(cdhSrc).toMatch(/data-testid=\{`\$\{testId\}-description`\}/);
  });

  it("InlineDescriptionEditor read mode renders description-text testid", () => {
    expect(cdhSrc).toMatch(/data-testid=\{`\$\{testId\}-description-text`\}/);
  });
});
