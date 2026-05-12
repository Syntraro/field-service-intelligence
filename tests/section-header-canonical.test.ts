/**
 * Canonical section-header primitive source-pin tests (2026-05-12).
 *
 * Pins the API contract for the CardShell header system
 * (`CardShellHeader` / `CardShellTitle` / `CardShellAction` in
 * `client/src/components/ui/card.tsx`) and enforces that the
 * `DashboardActionModal` repeated sticky-divider pattern is
 * de-duplicated via its extracted `ModalSectionDivider` helper.
 *
 * Failures here indicate:
 *   - The `CardShellHeader` / `CardShellTitle` / `CardShellAction`
 *     API was changed or dropped from card.tsx.
 *   - `DashboardActionModal.tsx` re-introduced the raw repeated
 *     sticky-header div (the pattern should exist only once, inside
 *     `ModalSectionDivider`).
 *   - A file that correctly uses `CardShell` lost its `CardShellHeader`
 *     import without an intentional exception being registered.
 *
 * Test style: source-pin via `readFileSync` (same as chip-canonical,
 * form-canonical, etc.) — no JSX rendering required.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const CARD_PATH = resolve(__dirname, "../client/src/components/ui/card.tsx");
const DAM_PATH = resolve(
  __dirname,
  "../client/src/components/DashboardActionModal.tsx",
);

const cardSrc = readFileSync(CARD_PATH, "utf-8");
const damSrc = readFileSync(DAM_PATH, "utf-8");

// Strip block + line comments so doc-commentary doesn't false-match
// negative pins.
const cardCode = cardSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
const damCode = damSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. CardShellHeader API contract ─────────────────────────────────

describe("CardShellHeader — API contract in card.tsx", () => {
  it("is exported from card.tsx", () => {
    expect(cardSrc).toMatch(/export\s*\{[\s\S]*?CardShellHeader[\s\S]*?\}/);
  });

  it("renders flex items-center justify-between gap-3 px-4 border-b border-card-border", () => {
    expect(cardCode).toMatch(
      /flex items-center justify-between gap-3 px-4 border-b border-card-border/,
    );
  });

  it("has a `compact` boolean prop for the h-11 detail-page rhythm", () => {
    expect(cardSrc).toMatch(/compact\s*\?:\s*boolean/);
  });

  it("applies `h-11` when compact=true", () => {
    expect(cardCode).toMatch(/compact\s*\?.*"h-11"/);
  });

  it("applies `py-2.5` when compact=false (standard dashboard rhythm)", () => {
    expect(cardCode).toMatch(/:\s*"py-2\.5"/);
  });
});

// ── 2. CardShellTitle API contract ──────────────────────────────────

describe("CardShellTitle — API contract in card.tsx", () => {
  it("is exported from card.tsx", () => {
    expect(cardSrc).toMatch(/export\s*\{[\s\S]*?CardShellTitle[\s\S]*?\}/);
  });

  it("has `icon` prop (ElementType)", () => {
    expect(cardSrc).toMatch(/icon\s*\?:\s*React\.ElementType/);
  });

  it("has `density` prop with 'standard' | 'compact' values", () => {
    expect(cardSrc).toMatch(/density\s*\?:\s*"standard"\s*\|\s*"compact"/);
  });

  it("standard density uses text-sm font-semibold text-text-primary", () => {
    expect(cardCode).toMatch(/text-sm font-semibold text-text-primary/);
  });

  it("compact density uses text-helper font-semibold uppercase with tracking", () => {
    expect(cardCode).toMatch(
      /text-helper font-semibold uppercase tracking-\[0\.08em\] text-text-secondary/,
    );
  });
});

// ── 3. CardShellAction API contract ─────────────────────────────────

describe("CardShellAction — API contract in card.tsx", () => {
  it("is exported from card.tsx", () => {
    expect(cardSrc).toMatch(/export\s*\{[\s\S]*?CardShellAction[\s\S]*?\}/);
  });

  it("locks shrink-0 so the action slot survives narrow grid columns", () => {
    expect(cardCode).toMatch(/shrink-0/);
  });
});

// ── 4. DashboardActionModal — ModalSectionDivider de-duplication ────

describe("DashboardActionModal — ModalSectionDivider extraction", () => {
  it("defines ModalSectionDivider as a module-level helper", () => {
    expect(damSrc).toMatch(/function ModalSectionDivider\s*\(/);
  });

  it("ModalSectionDivider accepts label, count, and optional action props", () => {
    expect(damCode).toMatch(/label\s*:\s*string/);
    expect(damCode).toMatch(/count\s*:\s*number/);
    expect(damCode).toMatch(/action\s*\?:\s*React\.ReactNode/);
  });

  it("raw sticky-header div appears exactly once (inside ModalSectionDivider)", () => {
    // The extracted component is the only place the raw class string
    // should appear. If this count > 1, a new raw instance was added.
    const rawPattern =
      "bg-[#f1f5f9] px-5 py-1.5 border-b border-[#e5e7eb] flex items-center justify-between gap-2";
    const occurrences = damSrc.split(rawPattern).length - 1;
    expect(occurrences).toBe(1);
  });

  it("uses <ModalSectionDivider> in renderSection (job rows)", () => {
    expect(damSrc).toMatch(/<ModalSectionDivider[\s\S]*?SOURCE_SECTION_LABEL\[source\]/);
  });

  it("uses <ModalSectionDivider> in renderInvoiceSection", () => {
    expect(damSrc).toMatch(
      /<ModalSectionDivider[\s\S]*?SOURCE_SECTION_LABEL\.unsent_invoices/,
    );
  });

  it("uses <ModalSectionDivider> in renderPMSection", () => {
    expect(damSrc).toMatch(
      /<ModalSectionDivider[\s\S]*?SOURCE_SECTION_LABEL\.pm_due/,
    );
  });
});

// ── 5. CardShell files use CardShellHeader (known-exceptions documented) ──

describe("CardShell consumers — CardShellHeader usage", () => {
  /**
   * Intentional exceptions:
   *   - ActivityCard.tsx: uses CardShell with a `<button>` collapsible
   *     trigger instead of CardShellHeader — button semantics required.
   *   - OperationalAlertsCard.tsx: headerless card (rows render directly
   *     without a header band by design).
   *   - KpiTile.tsx: minimal tile with no header band, just a KpiShell.
   */
  const EXCEPTIONS = new Set([
    "ActivityCard.tsx",
    "OperationalAlertsCard.tsx",
    "KpiTile.tsx",
  ]);

  const DASHBOARD_DIR = resolve(
    __dirname,
    "../client/src/components/dashboard",
  );
  const ACTIVITY_DIR = resolve(
    __dirname,
    "../client/src/components/activity",
  );
  const PAGES_DIR = resolve(__dirname, "../client/src/pages");

  function checkDir(dir: string) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
    } catch {
      return; // directory may not exist in test env
    }
    for (const file of entries) {
      if (EXCEPTIONS.has(file)) continue;
      const src = readFileSync(resolve(dir, file), "utf-8");
      if (src.includes("CardShell") && !src.includes("KpiShell")) {
        it(`${file} imports CardShellHeader when using CardShell`, () => {
          expect(src).toMatch(/CardShellHeader/);
        });
      }
    }
  }

  checkDir(DASHBOARD_DIR);
  checkDir(ACTIVITY_DIR);
});
