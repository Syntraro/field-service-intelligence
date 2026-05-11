/**
 * compact-form-field-canonical.test.ts
 *
 * Guard tests for CompactFormField and CompactColHeader (Phase B).
 *
 * Pins:
 *  1.  Exports: CompactFormField, CompactColHeader, their prop interfaces
 *  2.  htmlFor present → native <label htmlFor=…>
 *  3.  htmlFor absent → <span aria-hidden="true">
 *  4.  Default label class: text-xs font-medium mb-0.5 block text-foreground
 *  5.  helperText uses text-helper text-muted-foreground mt-0.5
 *  6.  errorText uses text-helper text-destructive mt-0.5 + role="alert"
 *  7.  errorText suppresses helperText when both are provided
 *  8.  CompactColHeader uses text-[11px] and aria-hidden="true"
 *  9.  File does not import from @/components/ui/form-field
 * 10.  File does not use text-form-label
 * 11.  File does not reference FormLabel, FormField, FormHelperText, FormErrorText
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(
  resolve(__dirname, "..", "client", "src", "components", "ui", "compact-form-field.tsx"),
  "utf-8",
);

// ── 1. Exports ────────────────────────────────────────────────────────────────

describe("compact-form-field exports", () => {
  it("exports CompactFormField function", () => {
    expect(SRC).toContain("export function CompactFormField");
  });
  it("exports CompactFormFieldProps interface", () => {
    expect(SRC).toContain("export interface CompactFormFieldProps");
  });
  it("exports CompactColHeader function", () => {
    expect(SRC).toContain("export function CompactColHeader");
  });
  it("exports CompactColHeaderProps interface", () => {
    expect(SRC).toContain("export interface CompactColHeaderProps");
  });
});

// ── 2. htmlFor present → native <label> ──────────────────────────────────────

describe("CompactFormField — htmlFor renders native label", () => {
  it("renders <label htmlFor={htmlFor}> when htmlFor is provided", () => {
    expect(SRC).toContain("<label htmlFor={htmlFor}");
  });
  it("native label carries the label class", () => {
    // The label element renders with labelClass applied
    const labelBlock = SRC.slice(SRC.indexOf("<label htmlFor"), SRC.indexOf("</label>") + 8);
    expect(labelBlock).toContain("className={labelClass}");
  });
});

// ── 3. htmlFor absent → <span aria-hidden> ───────────────────────────────────

describe("CompactFormField — no htmlFor renders aria-hidden span", () => {
  it("renders <span aria-hidden> when htmlFor is absent", () => {
    expect(SRC).toContain('<span aria-hidden="true"');
  });
  it("the span carries the label class", () => {
    // At least one span aria-hidden uses labelClass
    const spanBlock = SRC.slice(SRC.indexOf('<span aria-hidden="true"'), SRC.indexOf("</span>") + 7);
    expect(spanBlock).toContain("className={labelClass}");
  });
});

// ── 4. Default label class ────────────────────────────────────────────────────

describe("CompactFormField — default label class", () => {
  it("default label class includes text-xs", () => {
    expect(SRC).toContain('"text-xs font-medium mb-0.5 block text-foreground"');
  });
  it("default label class uses font-medium weight", () => {
    expect(SRC).toContain("font-medium");
  });
  it("default label class uses mb-0.5 spacing", () => {
    expect(SRC).toContain("mb-0.5");
  });
  it("default label class uses block display", () => {
    expect(SRC).toMatch(/text-xs font-medium mb-0\.5 block/);
  });
  it("default label class uses text-foreground color", () => {
    expect(SRC).toContain("text-foreground");
  });
});

// ── 5. helperText ─────────────────────────────────────────────────────────────

describe("CompactFormField — helperText rendering", () => {
  it("helperText paragraph uses text-helper", () => {
    expect(SRC).toContain("text-helper text-muted-foreground mt-0.5");
  });
  it("helperText paragraph does not carry role=alert", () => {
    // Find the helperText <p> and confirm it has no role
    const helperParagraph = SRC.slice(
      SRC.indexOf("text-helper text-muted-foreground mt-0.5"),
      SRC.indexOf("text-helper text-muted-foreground mt-0.5") + 80,
    );
    expect(helperParagraph).not.toContain('role="alert"');
  });
});

// ── 6. errorText ─────────────────────────────────────────────────────────────

describe("CompactFormField — errorText rendering", () => {
  it("errorText paragraph uses text-helper text-destructive", () => {
    expect(SRC).toContain("text-helper text-destructive mt-0.5");
  });
  it("errorText paragraph carries role=alert", () => {
    expect(SRC).toContain('role="alert"');
  });
  it("errorText uses mt-0.5 margin", () => {
    expect(SRC).toContain("mt-0.5");
  });
});

// ── 7. errorText suppresses helperText ───────────────────────────────────────

describe("CompactFormField — errorText takes precedence over helperText", () => {
  it("errorText branch renders before helperText branch", () => {
    const errIdx = SRC.indexOf("text-helper text-destructive mt-0.5");
    const helpIdx = SRC.indexOf("text-helper text-muted-foreground mt-0.5");
    expect(errIdx).toBeGreaterThan(0);
    expect(helpIdx).toBeGreaterThan(0);
    // errorText block appears first in source (ternary: errorText ? ... : helperText ? ...)
    expect(errIdx).toBeLessThan(helpIdx);
  });
  it("uses a ternary so errorText and helperText are mutually exclusive", () => {
    // The ternary pattern: errorText ? (...) : helperText ? (...) : null
    expect(SRC).toMatch(/errorText\s*\?[\s\S]{0,300}helperText\s*\?/);
  });
});

// ── 8. CompactColHeader ───────────────────────────────────────────────────────

describe("CompactColHeader", () => {
  it("renders a span element", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain("<span");
  });
  it("span is aria-hidden", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain('aria-hidden="true"');
  });
  it("uses text-[11px] — the allowed ultra-compact schedule-grid exception", () => {
    expect(SRC).toContain("text-[11px]");
  });
  it("uses font-medium weight", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain("font-medium");
  });
  it("uses text-muted-foreground color", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain("text-muted-foreground");
  });
  it("uses mb-0.5 bottom spacing", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain("mb-0.5");
  });
  it("uses block display", () => {
    const colSection = SRC.slice(SRC.indexOf("export function CompactColHeader"));
    expect(colSection).toContain("block");
  });
  it("has a comment documenting text-[11px] as an allowed exception", () => {
    expect(SRC).toContain("ultra-compact");
  });
});

// ── 9. No form-field import ───────────────────────────────────────────────────

describe("compact-form-field — independence from form-field primitives", () => {
  it("does not import from @/components/ui/form-field", () => {
    expect(SRC).not.toContain('from "@/components/ui/form-field"');
    expect(SRC).not.toContain("from '@/components/ui/form-field'");
  });
  it("does not import from @/components/ui/label", () => {
    // Uses native <label> element, not the shadcn Label component
    expect(SRC).not.toContain('from "@/components/ui/label"');
    expect(SRC).not.toContain("from '@/components/ui/label'");
  });
});

// ── 10. No text-form-label in className strings ───────────────────────────────

describe("compact-form-field — no standard-tier typography tokens in classNames", () => {
  it("does not use text-form-label in any className attribute", () => {
    // Comments may mention it as a contrast; only className strings are banned.
    const classNames = SRC.match(/className="[^"]*"/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-form-label");
    }
  });
  it("does not use text-sm in any className attribute", () => {
    // text-sm (17px in this codebase) is too large for compact labels
    const classNames = SRC.match(/className="[^"]*"/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-sm");
    }
  });
});

// ── 11. No FormLabel / FormField as JSX or imports ────────────────────────────

describe("compact-form-field — no standard form primitive usage (JSX or import)", () => {
  it("does not use <FormLabel as a JSX tag", () => {
    expect(SRC).not.toMatch(/<FormLabel[\s/>]/);
  });
  it("does not use <FormField as a JSX tag", () => {
    expect(SRC).not.toMatch(/<FormField[\s/>]/);
  });
  it("does not use <FormHelperText as a JSX tag", () => {
    expect(SRC).not.toMatch(/<FormHelperText[\s/>]/);
  });
  it("does not use <FormErrorText as a JSX tag", () => {
    expect(SRC).not.toMatch(/<FormErrorText[\s/>]/);
  });
});
