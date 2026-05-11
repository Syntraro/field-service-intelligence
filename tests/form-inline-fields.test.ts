/**
 * Canonical InlineInput / InlineTextarea / InlineSelectTrigger primitive tests
 * (2026-05-10).
 *
 * Pins the structural contracts for the true in-field label primitives
 * in client/src/components/ui/form-field.tsx. These source-level
 * assertions verify that:
 *   - The shell div owns the border, radius, and focus-within ring.
 *   - The label is absolutely positioned INSIDE the shell (not above it).
 *   - The inner input/textarea/SelectPrimitive.Trigger is borderless and
 *     transparent so there is no border-inside-a-border.
 *   - The old FormInlineField (label-above, incorrect) is not exported.
 *
 * These tests complement form-canonical-drift.test.ts (banned-pattern
 * guard in consumers) and product-service-form-dialog.test.ts (dialog
 * usage contracts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/ui/form-field.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. InlineInput ─────────────────────────────────────────────────

describe("form-field.tsx — InlineInput", () => {
  it("exports InlineInput with displayName", () => {
    expect(src).toMatch(/export const InlineInput/);
    expect(src).toMatch(/InlineInput\.displayName = "InlineInput"/);
  });

  it("shell container uses border-border-strong (canonical project border token)", () => {
    // The outer div must have `border border-border-strong` — the shell owns the border.
    expect(src).toMatch(/InlineInput[\s\S]*?border border-border-strong/);
  });

  it("shell container uses focus-within:border-brand (shell-level focus ring)", () => {
    // Focus ring on the shell via focus-within, not focus-visible on the <input>.
    expect(src).toMatch(/InlineInput[\s\S]*?focus-within:border-brand/);
  });

  it("label is absolutely positioned inside the shell (top-1.5, text-[10px])", () => {
    // `absolute` + `top-1.5` confirms label is inside the shell, not above it.
    expect(src).toMatch(/InlineInput[\s\S]*?absolute[\s\S]*?top-1\.5/);
    expect(src).toMatch(/text-\[10px\]/);
  });

  it("inner <input> is bg-transparent (no own background)", () => {
    // bg-transparent strips the surface background from the inner element —
    // the shell's bg-surface shows through.
    expect(src).toMatch(/InlineInput[\s\S]*?bg-transparent/);
  });

  it("inner <input> has outline-none (focus handled by shell focus-within)", () => {
    expect(src).toMatch(/InlineInput[\s\S]*?outline-none/);
  });

  it("inner <input> uses pt-6 to leave room for the inline label", () => {
    // pt-6 (24px) from top places the input text below the 10px label
    // that sits at top-1.5 (6px). 8px gap between label bottom and text.
    expect(src).toMatch(/InlineInput[\s\S]*?pt-6/);
  });

  it("supports error prop: applies destructive border + focus shadow to shell", () => {
    expect(src).toMatch(/border-destructive/);
    expect(src).toMatch(/focus-within:border-destructive/);
  });
});

// ── 2. InlineTextarea ──────────────────────────────────────────────

describe("form-field.tsx — InlineTextarea", () => {
  it("exports InlineTextarea with displayName", () => {
    expect(src).toMatch(/export const InlineTextarea/);
    expect(src).toMatch(/InlineTextarea\.displayName = "InlineTextarea"/);
  });

  it("inner <textarea> is bg-transparent (no own background)", () => {
    expect(src).toMatch(/InlineTextarea[\s\S]*?bg-transparent/);
  });

  it("inner <textarea> has resize-none by default", () => {
    expect(src).toMatch(/InlineTextarea[\s\S]*?resize-none/);
  });

  it("inner <textarea> has outline-none (focus handled by shell)", () => {
    expect(src).toMatch(/InlineTextarea[\s\S]*?outline-none/);
  });

  it("inner <textarea> uses pt-6 to leave room for the inline label", () => {
    expect(src).toMatch(/InlineTextarea[\s\S]*?pt-6/);
  });
});

// ── 3. InlineSelectTrigger ─────────────────────────────────────────

describe("form-field.tsx — InlineSelectTrigger", () => {
  it("exports InlineSelectTrigger with displayName", () => {
    expect(src).toMatch(/export const InlineSelectTrigger/);
    expect(src).toMatch(/InlineSelectTrigger\.displayName = "InlineSelectTrigger"/);
  });

  it("shell has border border-border-strong", () => {
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?border border-border-strong/);
  });

  it("uses SelectPrimitive.Trigger directly (avoids shadcn SelectTrigger style layer)", () => {
    // Bypasses SelectTrigger to avoid class-override battle over border/focus.
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?SelectPrimitive\.Trigger/);
  });

  it("inner SelectPrimitive.Trigger has h-auto (not fixed h-9)", () => {
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?h-auto/);
  });

  it("inner SelectPrimitive.Trigger uses pt-6 to leave room for the inline label", () => {
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?pt-6/);
  });

  it("renders ChevronDown icon inside SelectPrimitive.Icon", () => {
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?ChevronDown/);
    expect(src).toMatch(/InlineSelectTrigger[\s\S]*?SelectPrimitive\.Icon/);
  });
});

// ── 4. FormInlineField removed ─────────────────────────────────────

describe("form-field.tsx — FormInlineField (old label-above primitive) removed", () => {
  it("does NOT export FormInlineField", () => {
    expect(codeOnly).not.toMatch(/export const FormInlineField/);
  });

  it("does NOT have FormInlineField.displayName", () => {
    expect(codeOnly).not.toMatch(/FormInlineField\.displayName/);
  });
});
