/**
 * EntityListTable — StateBlock integration pins (2026-05-09).
 *
 * Verifies the typed-descriptor contract:
 *   - emptyState is StateBlockProps, not ReactNode
 *   - loadingState is boolean | StateBlockProps, not ReactNode
 *   - errorState is StateBlockProps (new field)
 *   - legacy* props are explicitly named (back-compat, not the default)
 *   - StateBlock is imported and used for all three typed slots
 *
 * These pins fail if a future refactor:
 *   - Reverts emptyState / loadingState to open ReactNode slots
 *   - Removes errorState
 *   - Renames legacy* back to the unqualified names
 *   - Removes the StateBlock import
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "client/src/components/lists/EntityListTable.tsx");
const src = readFileSync(SRC, "utf-8");

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const code = stripComments(src);

describe("EntityListTable — StateBlock import", () => {
  it("imports StateBlock from the canonical state-block module", () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]*?\bStateBlock\b[\s\S]*?\}\s*from\s*["']@\/components\/ui\/state-block["']/,
    );
  });

  it("imports StateBlockProps type from the canonical state-block module", () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]*?\btype\s+StateBlockProps\b[\s\S]*?\}\s*from\s*["']@\/components\/ui\/state-block["']/,
    );
  });
});

describe("EntityListTable — typed prop contracts", () => {
  it("emptyState prop is typed StateBlockProps (not ReactNode)", () => {
    expect(src).toMatch(/emptyState\s*\?\s*:\s*StateBlockProps/);
    expect(src).not.toMatch(/emptyState\s*\?\s*:\s*React\.ReactNode/);
  });

  it("loadingState prop is typed boolean | StateBlockProps (not ReactNode)", () => {
    expect(src).toMatch(/loadingState\s*\?\s*:\s*boolean\s*\|\s*StateBlockProps/);
    expect(src).not.toMatch(/loadingState\s*\?\s*:\s*React\.ReactNode/);
  });

  it("errorState prop is typed StateBlockProps", () => {
    expect(src).toMatch(/errorState\s*\?\s*:\s*StateBlockProps/);
  });
});

describe("EntityListTable — legacy back-compat props are explicitly named", () => {
  it("legacy empty state prop is named legacyEmptyStateNode", () => {
    expect(src).toMatch(/legacyEmptyStateNode\s*\?\s*:\s*React\.ReactNode/);
  });

  it("legacy loading state prop is named legacyLoadingStateNode", () => {
    expect(src).toMatch(/legacyLoadingStateNode\s*\?\s*:\s*React\.ReactNode/);
  });
});

describe("EntityListTable — StateBlock rendering", () => {
  it("renders <StateBlock for typed loading (loadingState=true path)", () => {
    expect(code).toMatch(/<StateBlock\s+kind="loading"/);
  });

  it("renders <StateBlock for typed loading descriptor path", () => {
    // JSX spread: <StateBlock {...(loadingState as StateBlockProps)} />
    expect(code).toMatch(/<StateBlock\s+\{[.]{3}\(loadingState\s+as\s+StateBlockProps\)\}/);
  });

  it("renders <StateBlock for error state", () => {
    // JSX spread: <StateBlock {...errorState!} />
    expect(code).toMatch(/<StateBlock\s+\{[.]{3}errorState/);
  });

  it("renders <StateBlock for empty state", () => {
    // JSX spread: <StateBlock {...emptyState!} />
    expect(code).toMatch(/<StateBlock\s+\{[.]{3}emptyState/);
  });
});

describe("EntityListTable — no legacy ReactNode leakage", () => {
  it("does not render emptyState as raw JSX (must go through StateBlock)", () => {
    // The body region must not render emptyState as a plain expression
    // (which would mean it's still ReactNode). After migration, it must
    // be spread into <StateBlock {...emptyState!} />.
    expect(code).not.toMatch(/showEmpty\s*\?\s*\n?\s*emptyState\b(?!\s*&&|\s*\?\s*<)/);
  });
});
