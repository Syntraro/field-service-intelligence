/**
 * Style Guide — Typography (2026-05-08).
 *
 * Internal/admin-only visual reference for every semantic typography
 * token defined in `tailwind.config.ts > theme.extend.fontSize`. The
 * canonical inventory + drift findings live in
 * `docs/SEMANTIC_TOKENS_AUDIT.md`; this page renders each token
 * against a shared sample set so contributors can compare scale,
 * weight, and tracking by eye instead of guessing from class names.
 *
 * Route: `/style-guide/typography` (gated `requireAdmin` — owner /
 * admin only). Linked from `SettingsPage > Advanced` as
 * "Typography Style Guide". Not exposed to technicians, dispatchers,
 * managers, or client-portal users.
 *
 * The token specs in `TYPOGRAPHY_TOKENS` mirror the live
 * `tailwind.config.ts` values verbatim. If you change a token
 * definition there, mirror the change here. Spec strings carry no
 * runtime meaning; they're informational labels only.
 *
 * Sections rendered (in order):
 *   1. Print-only header (visible only in printed/exported output)
 *   2. Usage guidance (top)
 *   3. Canonical typography tokens
 *   4. Aliases
 *   5. Form / select tokens
 *   6. Legacy ramp (deprecated)
 *   7. Raw weight overlay preview (diagnostic)
 *   8. Numbers & tabular alignment
 *
 * Print / PDF export (2026-05-08).
 *   - "Print / Save PDF" button in the header fires `window.print()`.
 *   - Print stylesheet (the `<style>` block at the top of the
 *     component) isolates the page's wrapper from app chrome
 *     (sidebar / topnav / shadows / hover affordances) so the
 *     browser's print pipeline produces a clean white reference
 *     sheet WITHOUT replacing the live semantic tokens. The actual
 *     typography on every token row is rendered by Tailwind exactly
 *     the same way it renders on screen — the print CSS only
 *     suppresses chrome and forces a white background.
 *   - Page-break optimization: token rows + section cards carry
 *     `break-inside: avoid` so a row never splits across pages.
 *
 * No state. No data fetching. Pure render.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// Sample content — single source so visual differences are obvious.
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_WORD = "Refrigeration";
const SAMPLE_SENTENCE =
  "Service appointment scheduled for Thursday at 10:30 AM.";
const SAMPLE_NUMERIC = "INV-10482 · $1,248.75 · 02/14/2026";

// ──────────────────────────────────────────────────────────────────────
// Token data
// ──────────────────────────────────────────────────────────────────────

type TokenStatus = "canonical" | "alias" | "form" | "legacy";

interface TypographyTokenSpec {
  /** Tailwind class (e.g. `"text-row-emphasis"`). */
  className: string;
  /** Display label shown in the row (`"Display"`, `"Row emphasis"`). */
  label: string;
  /** "size / line-height / weight" — informational. */
  specs: string;
  /** Letter-spacing — `"—"` if none baked. */
  tracking: string;
  /** Text transform — `"—"` if none baked. */
  transform: string;
  /** Intended-use note from the audit. */
  usage: string;
  /** Where this token actually shows up in the codebase. */
  examples: string;
  status: TokenStatus;
}

const CANONICAL_TOKENS: TypographyTokenSpec[] = [
  {
    className: "text-display",
    label: "Display",
    specs: "32 / 40 / 700",
    tracking: "—",
    transform: "—",
    usage:
      "Single biggest visible value on a page (totals, KPI emphasis). Rare.",
    examples: "Dashboard hero KPIs.",
    status: "canonical",
  },
  {
    className: "text-page-title",
    label: "Page title",
    specs: "30 / 36 / 700",
    tracking: "—",
    transform: "—",
    usage: "h1 for a detail page (Job, Invoice, Quote, PM). One per page.",
    examples: "JobDetailPage h1, IntegrationsPage header.",
    status: "canonical",
  },
  {
    className: "text-section-title",
    label: "Section title",
    specs: "17 / 24 / 600",
    tracking: "—",
    transform: "—",
    usage:
      "h2 for a card / panel / modal. CardTitle defaults here. Pixel-aligns with text-row-emphasis after the 2026-05-08 recalibration.",
    examples: "Rail group headings (technician name in Labour panel).",
    status: "canonical",
  },
  {
    className: "text-subhead",
    label: "Subhead",
    specs: "16 / 22 / 500",
    tracking: "—",
    transform: "—",
    usage: "h3 for groups inside a card; table sub-headers.",
    examples: "EmptyState title.",
    status: "canonical",
  },
  {
    className: "text-modal-title",
    label: "Modal title",
    specs: "≈21.4 / 1.6rem / 600",
    tracking: "—",
    transform: "—",
    usage: "DialogTitle. Pixel-matches the legacy `text-lg font-semibold`.",
    examples: "Every shadcn Dialog.",
    status: "canonical",
  },
  {
    className: "text-body",
    label: "Body",
    specs: "15 / 22 / 400",
    tracking: "—",
    transform: "—",
    usage: "Default reading text — forms, dialogs, prose, descriptions.",
    examples: "Form descriptions, modal body copy.",
    status: "canonical",
  },
  {
    className: "text-row",
    label: "Row",
    specs: "15 / 22 / 500",
    tracking: "—",
    transform: "—",
    usage:
      "Default table / list row content. Weight bumped to 500 in the 2026-05-08 recalibration.",
    examples:
      "Notes body (post-cardStyle), Labour subrow primary text (post-2026-05-08 remap).",
    status: "canonical",
  },
  {
    className: "text-row-emphasis",
    label: "Row emphasis",
    specs: "17 / 24 / 600",
    tracking: "—",
    transform: "—",
    usage:
      "Primary identifier in a row (entity name). Pixel-identical to text-section-title.",
    examples: "RailContentCard title slot, equipment card name.",
    status: "canonical",
  },
  {
    className: "text-caption",
    label: "Caption",
    specs: "14 / 20 / 400",
    tracking: "—",
    transform: "—",
    usage:
      "Secondary text alongside row content (timestamps, sub-amounts). CardDescription defaults here.",
    examples: "List secondary cell, Notes author line, Labour date totals.",
    status: "canonical",
  },
  {
    className: "text-label",
    label: "Label",
    specs: "13 / 16 / 500",
    tracking: "0.04em",
    transform: "UPPERCASE (via @layer)",
    usage:
      "Form field labels, table column headers, metadata keys (BILL TO, ISSUED).",
    examples: "Card meta labels, panel section labels.",
    status: "canonical",
  },
  {
    className: "text-helper",
    label: "Helper",
    specs: "13 / 16 / 400",
    tracking: "—",
    transform: "—",
    usage:
      "Tooltip body, hint text, footnotes; rail/panel dense-secondary text. Phase H1 canonical for rails.",
    examples: "RailContentCardMeta, ChipVariants base typography.",
    status: "canonical",
  },
];

const ALIAS_TOKENS: TypographyTokenSpec[] = [
  {
    className: "text-table-header",
    label: "Table header",
    specs: "13 / 16 / 500",
    tracking: "0.04em",
    transform: "UPPERCASE (via @layer)",
    usage:
      "Table column headers. Alias of text-label — same pixel output, different role identity.",
    examples: "shared Table column headers.",
    status: "alias",
  },
  {
    className: "text-table-cell",
    label: "Table cell",
    specs: "15 / 22 / 400",
    tracking: "—",
    transform: "—",
    usage:
      "Table cell body. Note: text-row now bakes weight 500 — text-table-cell does NOT pixel-match it any more.",
    examples: "shared Table cells.",
    status: "alias",
  },
  {
    className: "text-input",
    label: "Input",
    specs: "15 / 22 / 400",
    tracking: "—",
    transform: "—",
    usage: "Form input/textarea body. Alias of text-body.",
    examples: "Input, Textarea primitives.",
    status: "alias",
  },
  {
    className: "text-email-body",
    label: "Email body",
    specs: "15 / 22 / 400",
    tracking: "—",
    transform: "—",
    usage: "Email composition body. Alias of text-body.",
    examples: "Email composer textarea.",
    status: "alias",
  },
  {
    className: "text-error",
    label: "Error",
    specs: "≈15.2 / 1.2rem / 500",
    tracking: "—",
    transform: "—",
    usage:
      "Form validation error text. Pair with text-destructive for color. Pixel-matches legacy text-xs font-medium.",
    examples: "FormMessage.",
    status: "alias",
  },
  {
    className: "text-empty-state",
    label: "Empty state",
    specs: "≈15.2 / 1.2rem / 400",
    tracking: "—",
    transform: "—",
    usage:
      "Empty-state copy in reports / lists / modals. Pixel-matches legacy text-xs.",
    examples: "Empty list copy.",
    status: "alias",
  },
];

const FORM_TOKENS: TypographyTokenSpec[] = [
  {
    className: "text-form-label",
    label: "Form label",
    specs: "≈15.2 / 1.2rem / 500",
    tracking: "—",
    transform: "—",
    usage:
      "Sentence-case form labels. Distinct from text-label which is uppercase metadata.",
    examples: "FormField, Label primitive.",
    status: "form",
  },
  {
    className: "text-form-helper",
    label: "Form helper",
    specs: "≈15.2 / 1.2rem / 400",
    tracking: "—",
    transform: "—",
    usage:
      "Helper / hint copy below a field. Pair with text-muted-foreground.",
    examples: "FormDescription, FormHelperText.",
    status: "form",
  },
  {
    className: "text-select-label",
    label: "Select label",
    specs: "≈15.2 / 1.2rem / 600",
    tracking: "—",
    transform: "—",
    usage:
      "Group label inside a Select dropdown. Heavier weight than form-label.",
    examples: "SelectGroup label.",
    status: "form",
  },
  {
    className: "text-select-item",
    label: "Select item",
    specs: "≈15.2 / 1.2rem / 400",
    tracking: "—",
    transform: "—",
    usage: "Option row inside a Select dropdown.",
    examples: "SelectItem.",
    status: "form",
  },
];

const LEGACY_TOKENS: TypographyTokenSpec[] = [
  {
    className: "text-xs",
    label: "text-xs",
    specs: "0.8rem ≈ 15.2px / 1.2rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-caption (closest) or text-label (uppercase metadata).",
    examples: "~1,100 historical occurrences.",
    status: "legacy",
  },
  {
    className: "text-sm",
    label: "text-sm",
    specs: "0.9rem ≈ 17.1px / 1.3rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-body (forms) or text-row (lists/tables).",
    examples: "~880 historical occurrences.",
    status: "legacy",
  },
  {
    className: "text-base",
    label: "text-base",
    specs: "1rem = 19px / 1.5rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-body or text-section-title.",
    examples: "~140 historical occurrences.",
    status: "legacy",
  },
  {
    className: "text-lg",
    label: "text-lg",
    specs: "1.125rem ≈ 21.4px / 1.6rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-page-title or text-modal-title.",
    examples: "~130 historical occurrences.",
    status: "legacy",
  },
  {
    className: "text-xl",
    label: "text-xl",
    specs: "1.25rem ≈ 23.8px / 1.75rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-page-title.",
    examples: "~50 historical occurrences.",
    status: "legacy",
  },
  {
    className: "text-2xl",
    label: "text-2xl",
    specs: "1.5rem ≈ 28.5px / 2rem / —",
    tracking: "—",
    transform: "—",
    usage: "Migrate to text-display.",
    examples: "~13 historical occurrences.",
    status: "legacy",
  },
];

// ──────────────────────────────────────────────────────────────────────
// Weight overlay preview — diagnostic only.
// ──────────────────────────────────────────────────────────────────────

const WEIGHT_OVERLAY_TOKENS: ReadonlyArray<{
  className: string;
  label: string;
}> = [
  { className: "text-row", label: "text-row" },
  { className: "text-body", label: "text-body" },
  { className: "text-caption", label: "text-caption" },
  { className: "text-section-title", label: "text-section-title" },
  { className: "text-row-emphasis", label: "text-row-emphasis" },
  { className: "text-label", label: "text-label" },
];

const WEIGHT_OVERLAYS: ReadonlyArray<{ className: string; label: string }> = [
  { className: "", label: "default" },
  { className: "font-medium", label: "+ font-medium" },
  { className: "font-semibold", label: "+ font-semibold" },
  { className: "font-bold", label: "+ font-bold" },
];

// ──────────────────────────────────────────────────────────────────────
// Numeric / tabular preview
// ──────────────────────────────────────────────────────────────────────

const NUMERIC_TOKENS: ReadonlyArray<{ className: string; label: string }> = [
  { className: "text-row", label: "text-row" },
  { className: "text-caption", label: "text-caption" },
  { className: "text-label", label: "text-label" },
  { className: "text-section-title", label: "text-section-title" },
];

const NUMERIC_SAMPLES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Money", value: "$1,248.75" },
  { label: "Invoice #", value: "INV-10482" },
  { label: "Job #", value: "JOB-24019" },
  { label: "Duration", value: "1.50 hrs" },
  { label: "Time range", value: "10:30 AM – 12:00 PM" },
];

const NUMERIC_VARIANTS: ReadonlyArray<{ className: string; label: string }> = [
  { className: "", label: "default" },
  { className: "tabular-nums", label: "+ tabular-nums" },
  { className: "tabular-nums font-mono", label: "+ tabular-nums font-mono" },
];

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function TokenRow({ token }: { token: TypographyTokenSpec }) {
  return (
    // 2026-05-08 print: `break-inside-avoid` keeps each token row on a
    // single page in the printed/exported PDF. Combined with the
    // section-level `break-inside-avoid` on the card, page breaks fall
    // between rows / between cards rather than mid-row.
    <div
      className="break-inside-avoid grid gap-3 py-4 border-b border-border-default last:border-b-0 lg:grid-cols-[260px_1fr]"
      data-testid={`token-row-${token.className}`}
    >
      <div className="space-y-1 lg:pr-4 lg:border-r lg:border-border-default">
        <div className="font-mono text-helper text-text-primary">
          {token.className}
        </div>
        <div className="text-helper text-text-secondary">
          <span className="font-medium">{token.label}</span>
          <span className="mx-1 text-text-disabled">·</span>
          <span>{token.specs}</span>
        </div>
        {(token.tracking !== "—" || token.transform !== "—") && (
          <div className="text-helper text-text-muted">
            {token.tracking !== "—" && <>tracking: {token.tracking}</>}
            {token.tracking !== "—" && token.transform !== "—" && (
              <span className="mx-1">·</span>
            )}
            {token.transform !== "—" && <>{token.transform}</>}
          </div>
        )}
        <div className="text-helper text-text-muted">{token.usage}</div>
        <div className="text-helper text-text-disabled italic">
          {token.examples}
        </div>
      </div>
      <div className="space-y-2">
        <div className={token.className}>{SAMPLE_WORD}</div>
        <div className={token.className}>{SAMPLE_SENTENCE}</div>
        <div className={`${token.className} tabular-nums`}>{SAMPLE_NUMERIC}</div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  // 2026-05-08 print: `break-inside-avoid` on the card keeps the section
  // header glued to its content. When a section is too tall to fit on
  // one page the browser still breaks between rows (each TokenRow has
  // its own `break-inside-avoid`), so the header stays on the page
  // where the first row appears.
  return (
    <Card className="break-inside-avoid" data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && (
          <p className="text-helper text-text-secondary">{description}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────

/**
 * 2026-05-08 print pipeline.
 *
 * Browser-driven print/PDF only — no server-side PDF generation, no
 * synthetic generator. The user clicks "Print / Save PDF", the browser
 * opens its native print dialog, and the user picks "Save as PDF" /
 * the system printer. The output preserves the LIVE rendered semantic
 * tokens because the same Tailwind classes that render on screen render
 * on the printed page.
 *
 * Strategy:
 *   1. Inject a `<style>` block scoped to `@media print` only — never
 *      affects screen rendering.
 *   2. Hide every element OUTSIDE the page wrapper using the
 *      visibility:hidden / visibility:visible pattern. This is the
 *      classic "print only this section" technique: app chrome
 *      (sidebar, topnav, modals) collapses to invisible without
 *      disturbing the inner content's layout, then the wrapper is
 *      pulled to the page origin via absolute positioning so the
 *      printed area starts at the paper's top-left.
 *   3. Force a clean white print background and remove shadows /
 *      hover affordances inside the page (no `bg-white`-on-`bg-white`
 *      cards, no soft drop shadows that print as smudges).
 *   4. The actual typography tokens render via their existing classes
 *      — `text-row` is still `text-row`, `text-label` still applies
 *      its `@layer components` uppercase rule, etc. The print CSS
 *      never overrides token typography.
 *   5. `break-inside: avoid` on token rows + section cards prevents
 *      mid-row page breaks.
 */
const PRINT_STYLES = `
@media print {
  /* Force a clean white background regardless of theme. The
     '!important' is required to override Tailwind's component-layer
     bg utilities. */
  html, body {
    background: #ffffff !important;
    color-adjust: exact;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Print-only header is hidden on screen; reveal it during print. */
  [data-style-guide-print-header] {
    display: block !important;
  }

  /* Print isolation: hide everything outside the page wrapper, then
     reveal everything inside. Visibility (not display) preserves
     layout positioning of ancestors so the wrapper's children render
     at their expected dimensions. */
  body * {
    visibility: hidden;
  }
  [data-testid="style-guide-typography-page"],
  [data-testid="style-guide-typography-page"] * {
    visibility: visible;
  }
  [data-testid="style-guide-typography-page"] {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    padding: 16px 24px;
    margin: 0;
  }

  /* Remove card shadows + hover background tints that print as
     smudges. Borders stay so section + table structure still reads. */
  [data-testid="style-guide-typography-page"] [class*="shadow"] {
    box-shadow: none !important;
  }

  /* Page-break helpers. */
  [data-testid="style-guide-typography-page"] .break-inside-avoid {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Hide print-only-controls (button, instructions banner) from the
     output. */
  [data-print-hide] {
    display: none !important;
  }

  /* Standard Letter margins. The browser print dialog also exposes
     "Margins: Default / Minimum / None" — these CSS margins cooperate
     with whichever the user picks. */
  @page {
    size: letter;
    margin: 0.5in;
  }
}
`;

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
      className="px-4 py-6 lg:px-6 max-w-6xl mx-auto space-y-6"
      data-testid="style-guide-typography-page"
    >
      {/* 2026-05-08 — print stylesheet (scoped to @media print only;
          screen rendering is untouched). */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* ── Print-only header ────────────────────────────────────────
          Hidden on screen; revealed during print by the @media-print
          rule above. Renders the canonical "Syntraro Semantic
          Typography Reference" mark + generated date + route + a
          one-line note clarifying that the printed output is the live
          token rendering. */}
      <div
        data-style-guide-print-header
        className="hidden border-b border-border-default pb-3 mb-2"
      >
        <div className="text-section-title text-text-primary">
          FSI / Syntraro Semantic Typography Reference
        </div>
        <div className="text-helper text-text-secondary mt-1">
          Generated {today}
          <span className="mx-1.5 text-text-disabled">·</span>
          Route: /style-guide/typography
          <span className="mx-1.5 text-text-disabled">·</span>
          Printed from live semantic token system
        </div>
      </div>

      {/* ── Screen-only page header + print button ─────────────────── */}
      <header
        className="flex items-start justify-between gap-4 break-inside-avoid"
        data-print-hide
      >
        <div className="space-y-2 min-w-0 flex-1">
          <h1 className="text-page-title text-text-primary">
            Typography Style Guide
          </h1>
          <p className="text-body text-text-secondary">
            Visual reference for every semantic typography token currently
            defined in the app. Source of truth:{" "}
            <code>tailwind.config.ts</code>. Audit + drift inventory:{" "}
            <code>docs/SEMANTIC_TOKENS_AUDIT.md</code>.
          </p>
        </div>
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

      {/* ── Print-instruction banner ────────────────────────────────
          Compact helper note next to the print button. Hidden during
          print so the operator's print preview is the live reference,
          not these instructions. */}
      <div
        data-print-hide
        className="rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-helper text-text-secondary break-inside-avoid"
        data-testid="style-guide-typography-print-tips"
      >
        <span className="font-medium text-text-primary">
          Print / PDF tips:
        </span>{" "}
        Landscape orientation OFF · Background graphics ON · Margins:
        Default or Minimum · Scale: 100%. Click "Print / Save PDF" and
        choose "Save as PDF" in the destination dropdown.
      </div>

      {/* ── Usage guidance ──────────────────────────────────────────── */}
      <SectionCard
        title="Usage guidance"
        testId="style-guide-typography-guidance"
      >
        <ul className="space-y-1.5 text-body text-text-primary list-disc pl-5">
          <li>Semantic tokens describe intent, not appearance.</li>
          <li>
            Use <code>text-row</code> for normal row / body content.
          </li>
          <li>
            Use <code>text-caption</code> for secondary / meta text.
          </li>
          <li>
            Use <code>text-label</code> for labels, metadata keys, eyebrows
            (uppercase).
          </li>
          <li>
            Use <code>text-section-title</code> for section / card titles.
          </li>
          <li>
            Avoid raw <code>text-xs</code> / <code>text-sm</code> /{" "}
            <code>text-[Npx]</code> in app UI unless documented.
          </li>
          <li>
            Avoid stacking <code>font-semibold</code> / <code>font-bold</code>{" "}
            on semantic tokens — role tokens already bake the right weight.
          </li>
          <li>
            For numeric columns, append <code>tabular-nums</code>. Reserve{" "}
            <code>font-mono</code> for ledgers / code; rail panels use sans.
          </li>
        </ul>
      </SectionCard>

      {/* ── Canonical tokens ────────────────────────────────────────── */}
      <SectionCard
        title="Canonical typography tokens"
        description="The role-based vocabulary. Pick a token by intent (page-title vs. row vs. label), not by pixel size."
        testId="style-guide-typography-canonical"
      >
        <div>
          {CANONICAL_TOKENS.map((t) => (
            <TokenRow key={t.className} token={t} />
          ))}
        </div>
      </SectionCard>

      {/* ── Aliases ─────────────────────────────────────────────────── */}
      <SectionCard
        title="Aliases (table / input / email / error / empty-state)"
        description="Tokens that share a baseline with a canonical role but carry a distinct role identity."
        testId="style-guide-typography-aliases"
      >
        <div>
          {ALIAS_TOKENS.map((t) => (
            <TokenRow key={t.className} token={t} />
          ))}
        </div>
      </SectionCard>

      {/* ── Form / select tokens ────────────────────────────────────── */}
      <SectionCard
        title="Form & select tokens"
        description="Field-context tokens. Distinct from text-label (uppercase metadata) — these are sentence-case."
        testId="style-guide-typography-form"
      >
        <div>
          {FORM_TOKENS.map((t) => (
            <TokenRow key={t.className} token={t} />
          ))}
        </div>
      </SectionCard>

      {/* ── Legacy ramp ─────────────────────────────────────────────── */}
      <SectionCard
        title="Legacy size ramp — DEPRECATED"
        description="Retained for back-compat only. Migrate to canonical tokens. New code SHOULD NOT introduce these classes."
        testId="style-guide-typography-legacy"
      >
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-helper text-text-primary">
            <span className="font-medium">Deprecated.</span> The legacy ramp
            (<code>text-xs / -sm / -base / -lg / -xl / -2xl</code>) is kept
            available so existing pages can migrate at their own cadence.
            <br />
            New UI in this app should use the canonical tokens above. The
            drift-prevention test (
            <code>tests/semantic-typography-guard.test.ts</code>) blocks new
            usages of these classes.
          </p>
        </div>
        <div>
          {LEGACY_TOKENS.map((t) => (
            <TokenRow key={t.className} token={t} />
          ))}
        </div>
      </SectionCard>

      {/* ── Raw weight overlay preview ──────────────────────────────── */}
      <SectionCard
        title="Raw weight overlay preview (diagnostic only)"
        description="Shows what happens when font-weight utilities are added on top of semantic tokens. This is a diagnostic — do NOT pattern code on it. Role tokens already bake the correct weight."
        testId="style-guide-typography-weight-overlay"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left p-2 text-label text-text-muted">
                  Token
                </th>
                {WEIGHT_OVERLAYS.map((overlay) => (
                  <th
                    key={overlay.label}
                    className="text-left p-2 text-label text-text-muted"
                  >
                    {overlay.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEIGHT_OVERLAY_TOKENS.map((token) => (
                <tr
                  key={token.className}
                  className="border-b border-border-default last:border-b-0"
                  data-testid={`weight-overlay-row-${token.className}`}
                >
                  <td className="p-2 align-baseline">
                    <code className="text-helper text-text-primary">
                      {token.label}
                    </code>
                  </td>
                  {WEIGHT_OVERLAYS.map((overlay) => (
                    <td
                      key={overlay.label}
                      className={`p-2 align-baseline ${token.className} ${overlay.className}`}
                    >
                      {SAMPLE_WORD}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ── Numbers / tabular preview ───────────────────────────────── */}
      <SectionCard
        title="Numbers and tabular alignment"
        description="Decide which token belongs on money, invoice numbers, job numbers, durations, and timestamps. tabular-nums locks digit width without changing family; font-mono swaps to a slab/mono family."
        testId="style-guide-typography-numeric"
      >
        <div className="space-y-6">
          {NUMERIC_TOKENS.map((token) => (
            <div
              key={token.className}
              className="space-y-2"
              data-testid={`numeric-token-${token.className}`}
            >
              <div className="text-label text-text-muted">{token.label}</div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="text-left p-2 text-helper text-text-muted">
                        Sample
                      </th>
                      {NUMERIC_VARIANTS.map((variant) => (
                        <th
                          key={variant.label}
                          className="text-left p-2 text-helper text-text-muted"
                        >
                          {variant.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {NUMERIC_SAMPLES.map((sample) => (
                      <tr
                        key={sample.label}
                        className="border-b border-border-default last:border-b-0"
                      >
                        <td className="p-2 align-baseline text-helper text-text-secondary">
                          {sample.label}
                        </td>
                        {NUMERIC_VARIANTS.map((variant) => (
                          <td
                            key={variant.label}
                            className={`p-2 align-baseline ${token.className} ${variant.className}`}
                          >
                            {sample.value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <Separator />
      <p className="text-helper text-text-muted">
        Internal reference. Audit details:{" "}
        <code>docs/SEMANTIC_TOKENS_AUDIT.md</code>. Token definitions:{" "}
        <code>tailwind.config.ts</code>. Drift guard:{" "}
        <code>tests/semantic-typography-guard.test.ts</code>.
      </p>
    </div>
  );
}
