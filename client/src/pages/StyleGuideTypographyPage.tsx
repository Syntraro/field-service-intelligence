/**
 * Style Guide — Typography (Phase S2, 2026-05-08).
 *
 * Internal/admin-only engineering reference sheet for every semantic
 * typography token. Phase S2 strips the page to its purpose:
 *
 *   1. Visual comparison.
 *   2. Semantic name reference.
 *   3. Display specs reference.
 *
 * No usage paragraphs, no component examples, no "where used" notes,
 * no descriptive prose. Usage guidance lives in
 * `docs/SEMANTIC_TYPOGRAPHY_SYSTEM.md`. The audit + drift inventory
 * lives in `docs/SEMANTIC_TOKENS_AUDIT.md`. This page is the visual
 * sidekick to those documents — the engineering side of the design
 * system, not the marketing side.
 *
 * Route: `/style-guide/typography` (gated `requireAdmin`). Linked
 * from `SettingsPage > Advanced > Typography Style Guide`.
 *
 * Sections (in this order):
 *   1. Print-only header (FSI / Syntraro mark + date + route).
 *   2. Page header + Print/Save-PDF button.
 *   3. Preferred Tokens — for each: `[name] · [specs]` + a single
 *      compact mixed-content preview line.
 *   4. Deprecated Aliases — dense 3-column table: alias / mapping /
 *      quality. No previews.
 *   5. Weight Overlay — compact grid of token × weight overlay. No
 *      explanations.
 *   6. Numbers & Tabular Alignment — single dense table of token ×
 *      numeric sample. No explanations.
 *
 * Print / PDF export. Browser-driven only. The embedded `@media
 * print` stylesheet hides app chrome (sidebar / topnav / modals)
 * via the visibility-collapse pattern, forces a white background,
 * removes shadows, and pages cleanly on US Letter. `break-inside:
 * avoid` on every preview row prevents mid-row page breaks. Live
 * semantic tokens render through their Tailwind utilities
 * unchanged — there is no synthetic generator.
 */

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// Sample content — single compact mixed-content line so each preview
// shows words + currency + date + separators + numeric alignment in
// one row.
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_PREVIEW = "Service appointment · $1,248.75 · 02/14/26";

// ──────────────────────────────────────────────────────────────────────
// Preferred tokens — Phase S1 simplified visual-hierarchy vocabulary.
// Spec strings mirror the live `tailwind.config.ts` values verbatim
// and carry no runtime meaning; they are informational labels only.
// ──────────────────────────────────────────────────────────────────────

interface PreferredTokenSpec {
  className: string;
  specs: string;
}

const PREFERRED_TOKENS: PreferredTokenSpec[] = [
  { className: "text-display", specs: "32 / 40 / 700" },
  { className: "text-title", specs: "30 / 36 / 700" },
  { className: "text-header", specs: "18 / 24 / 600" },
  { className: "text-subheader", specs: "16 / 22 / 500" },
  { className: "text-body", specs: "15 / 22 / 400" },
  { className: "text-row", specs: "14 / 20 / 400" },
  { className: "text-emphasis", specs: "15 / 22 / 500" },
  { className: "text-caption", specs: "14 / 20 / 400" },
  { className: "text-label", specs: "13 / 16 / 500 · 0.04em · UPPERCASE" },
  { className: "text-helper", specs: "13 / 16 / 400" },
  { className: "text-error", specs: "≈15.2 / 1.2rem / 500" },
  // Specialized compact-navigation semantic — narrow rail tab labels.
  { className: "text-nav-compact", specs: "12 / 14 / 500 · no uppercase · no tracking" },
];

// ──────────────────────────────────────────────────────────────────────
// Deprecated aliases — Phase S1 component-specific tokens retained for
// back-compat. Single dense table; no previews.
// ──────────────────────────────────────────────────────────────────────

interface DeprecatedAliasSpec {
  className: string;
  preferred: string;
  mappingQuality: "exact" | "imperfect";
}

const DEPRECATED_ALIAS_TOKENS: DeprecatedAliasSpec[] = [
  { className: "text-page-title", preferred: "text-title", mappingQuality: "exact" },
  { className: "text-section-title", preferred: "text-header", mappingQuality: "exact" },
  { className: "text-subhead", preferred: "text-subheader", mappingQuality: "exact" },
  { className: "text-modal-title", preferred: "text-header", mappingQuality: "imperfect" },
  { className: "text-row-emphasis", preferred: "text-emphasis", mappingQuality: "exact" },
  { className: "text-table-header", preferred: "text-label", mappingQuality: "exact" },
  { className: "text-table-cell", preferred: "text-row", mappingQuality: "exact" },
  { className: "text-input", preferred: "text-body", mappingQuality: "exact" },
  { className: "text-email-body", preferred: "text-body", mappingQuality: "exact" },
  { className: "text-empty-state", preferred: "text-body", mappingQuality: "imperfect" },
  { className: "text-form-label", preferred: "text-label", mappingQuality: "imperfect" },
  { className: "text-form-helper", preferred: "text-helper", mappingQuality: "imperfect" },
  { className: "text-select-label", preferred: "text-label", mappingQuality: "imperfect" },
  { className: "text-select-item", preferred: "text-row", mappingQuality: "imperfect" },
  // Legacy size-ramp utilities — deprecated by visual-hierarchy tokens.
  { className: "text-xs", preferred: "text-helper / text-caption / text-label", mappingQuality: "imperfect" },
  { className: "text-sm", preferred: "text-body / text-row", mappingQuality: "imperfect" },
  { className: "text-base", preferred: "text-body / text-header", mappingQuality: "imperfect" },
  { className: "text-lg", preferred: "text-title / text-header", mappingQuality: "imperfect" },
  { className: "text-xl", preferred: "text-title", mappingQuality: "imperfect" },
  { className: "text-2xl", preferred: "text-display", mappingQuality: "imperfect" },
];

// ──────────────────────────────────────────────────────────────────────
// Weight overlay — token × {default, medium, semibold, bold}.
// ──────────────────────────────────────────────────────────────────────

const WEIGHT_OVERLAY_TOKENS: ReadonlyArray<string> = [
  "text-row",
  "text-body",
  "text-caption",
  "text-header",
  "text-emphasis",
  "text-label",
];

const WEIGHT_OVERLAYS: ReadonlyArray<{ className: string; label: string }> = [
  { className: "", label: "default" },
  { className: "font-medium", label: "+medium" },
  { className: "font-semibold", label: "+semibold" },
  { className: "font-bold", label: "+bold" },
];

// ──────────────────────────────────────────────────────────────────────
// Numeric / tabular comparison — token × numeric sample (single dense
// table). `tabular-nums` is applied to every cell so the digit-width
// alignment is visible across rows.
// ──────────────────────────────────────────────────────────────────────

const NUMERIC_TOKENS: ReadonlyArray<string> = [
  "text-row",
  "text-caption",
  "text-label",
  "text-header",
];

const NUMERIC_SAMPLES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Money", value: "$1,248.75" },
  { label: "Invoice #", value: "INV-10482" },
  { label: "Job #", value: "JOB-24019" },
  { label: "Duration", value: "1.50 hrs" },
  { label: "Time range", value: "10:30 AM – 12:00 PM" },
];

// ──────────────────────────────────────────────────────────────────────
// Print stylesheet (scoped to @media print only).
// ──────────────────────────────────────────────────────────────────────

const PRINT_STYLES = `
@media print {
  html, body {
    background: #ffffff !important;
    color-adjust: exact;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  [data-style-guide-print-header] { display: block !important; }
  body * { visibility: hidden; }
  [data-testid="style-guide-typography-page"],
  [data-testid="style-guide-typography-page"] * { visibility: visible; }
  [data-testid="style-guide-typography-page"] {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    padding: 12px 16px;
    margin: 0;
  }
  [data-testid="style-guide-typography-page"] [class*="shadow"] {
    box-shadow: none !important;
  }
  [data-testid="style-guide-typography-page"] .break-inside-avoid {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  [data-print-hide] { display: none !important; }
  @page { size: letter; margin: 0.4in; }
}
`;

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

/**
 * Compact 2-line preferred-token row.
 *
 *   line 1 — `[name] · [specs]` (mono helper)
 *   line 2 — single live preview at the token's class
 */
function PreferredTokenRow({ token }: { token: PreferredTokenSpec }) {
  return (
    <div
      className="break-inside-avoid py-1.5 border-b border-border-default last:border-b-0"
      data-testid={`token-row-${token.className}`}
    >
      <div className="font-mono text-helper text-text-secondary">
        {token.className}
        <span className="mx-1.5 text-text-disabled">·</span>
        {token.specs}
      </div>
      <div className={`${token.className} tabular-nums whitespace-nowrap`}>
        {SAMPLE_PREVIEW}
      </div>
    </div>
  );
}

/**
 * Minimal section wrapper — h2 + content. No card, no border, no
 * shadow, no description prose. Subtle top divider for visual rhythm
 * during print.
 */
function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="break-inside-avoid pt-4 mt-4 border-t border-border-default first:pt-0 first:mt-0 first:border-t-0"
      data-testid={testId}
    >
      <h2 className="text-helper text-text-muted font-medium uppercase tracking-wide mb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────

export default function StyleGuideTypographyPage() {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div
      className="px-4 py-4 lg:px-6 max-w-5xl mx-auto"
      data-testid="style-guide-typography-page"
    >
      {/* Print stylesheet — scoped to @media print, never affects screen. */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Print-only header — hidden on screen, shown during print. */}
      <div
        data-style-guide-print-header
        className="hidden border-b border-border-default pb-2 mb-3"
      >
        <div className="text-header text-text-primary">
          FSI / Syntraro Semantic Typography Reference
        </div>
        <div className="text-helper text-text-secondary mt-0.5">
          Generated {today}
          <span className="mx-1.5 text-text-disabled">·</span>
          /style-guide/typography
        </div>
      </div>

      {/* Screen-only page header. Compact: title + print button on one row. */}
      <header
        className="flex items-center justify-between gap-4 mb-4 break-inside-avoid"
        data-print-hide
      >
        <h1 className="text-title text-text-primary">
          Typography Style Guide
        </h1>
        <Button
          type="button"
          variant="outline"
          onClick={handlePrint}
          className="shrink-0 gap-2"
          data-testid="button-style-guide-print"
        >
          <Printer className="h-4 w-4" />
          Print / Save PDF
        </Button>
      </header>

      {/* ── Preferred tokens ──────────────────────────────────────── */}
      <Section title="Preferred Tokens" testId="style-guide-typography-preferred">
        <div>
          {PREFERRED_TOKENS.map((t) => (
            <PreferredTokenRow key={t.className} token={t} />
          ))}
        </div>
      </Section>

      {/* ── Deprecated aliases — dense table ──────────────────────── */}
      <Section
        title="Deprecated Aliases"
        testId="style-guide-typography-deprecated"
      >
        <table
          className="w-full border-collapse"
          data-testid="style-guide-typography-deprecated-table"
        >
          <thead>
            <tr className="border-b border-border-default">
              <th className="text-left py-1 pr-3 text-helper text-text-muted font-medium">
                Alias
              </th>
              <th className="text-left py-1 pr-3 text-helper text-text-muted font-medium">
                Maps to
              </th>
              <th className="text-left py-1 text-helper text-text-muted font-medium">
                Quality
              </th>
            </tr>
          </thead>
          <tbody>
            {DEPRECATED_ALIAS_TOKENS.map((t) => (
              <tr
                key={t.className}
                className="break-inside-avoid border-b border-border-default last:border-b-0"
                data-testid={`deprecated-token-row-${t.className}`}
              >
                <td className="py-1 pr-3 align-baseline font-mono text-helper text-text-primary">
                  {t.className}
                </td>
                <td className="py-1 pr-3 align-baseline font-mono text-helper text-text-primary">
                  {t.preferred}
                </td>
                <td className="py-1 align-baseline text-helper">
                  <span
                    className={
                      t.mappingQuality === "exact"
                        ? "text-success"
                        : "text-warning"
                    }
                  >
                    {t.mappingQuality}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ── Weight overlay grid ───────────────────────────────────── */}
      <Section
        title="Weight Overlay"
        testId="style-guide-typography-weight-overlay"
      >
        <div className="overflow-x-auto break-inside-avoid">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left py-1 pr-3 text-helper text-text-muted font-medium">
                  Token
                </th>
                {WEIGHT_OVERLAYS.map((overlay) => (
                  <th
                    key={overlay.label}
                    className="text-left py-1 pr-3 text-helper text-text-muted font-medium"
                  >
                    {overlay.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEIGHT_OVERLAY_TOKENS.map((tokenClass) => (
                <tr
                  key={tokenClass}
                  className="break-inside-avoid border-b border-border-default last:border-b-0"
                  data-testid={`weight-overlay-row-${tokenClass}`}
                >
                  <td className="py-1 pr-3 align-baseline font-mono text-helper text-text-primary">
                    {tokenClass}
                  </td>
                  {WEIGHT_OVERLAYS.map((overlay) => (
                    <td
                      key={overlay.label}
                      className={`py-1 pr-3 align-baseline ${tokenClass} ${overlay.className} tabular-nums whitespace-nowrap`}
                    >
                      {SAMPLE_PREVIEW}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Numbers / tabular grid ────────────────────────────────── */}
      <Section
        title="Numbers · Tabular Alignment"
        testId="style-guide-typography-numeric"
      >
        <div className="overflow-x-auto break-inside-avoid">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left py-1 pr-3 text-helper text-text-muted font-medium">
                  Sample
                </th>
                {NUMERIC_TOKENS.map((tokenClass) => (
                  <th
                    key={tokenClass}
                    className="text-left py-1 pr-3 text-helper text-text-muted font-medium font-mono"
                  >
                    {tokenClass}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NUMERIC_SAMPLES.map((sample) => (
                <tr
                  key={sample.label}
                  className="break-inside-avoid border-b border-border-default last:border-b-0"
                >
                  <td className="py-1 pr-3 align-baseline text-helper text-text-secondary">
                    {sample.label}
                  </td>
                  {NUMERIC_TOKENS.map((tokenClass) => (
                    <td
                      key={tokenClass}
                      className={`py-1 pr-3 align-baseline ${tokenClass} tabular-nums whitespace-nowrap`}
                    >
                      {sample.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
