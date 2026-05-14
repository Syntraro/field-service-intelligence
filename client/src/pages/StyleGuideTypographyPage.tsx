/**
 * Style Guide — Typography (Phase S3, 2026-05-14).
 *
 * Engineering reference for every semantic typography token. Source of
 * truth for token names, computed specs, semantic roles, and usage rules.
 *
 * All values are read from the live Tailwind utilities — no synthetic
 * generator. What renders here is what ships in production.
 *
 * Root font-size: `html { font-size: 19px }` (index.css:245). All
 * rem-based tokens (modal-title, error, empty-state, form/select group,
 * legacy ramp) compute against this root, NOT the standard 16px.
 *
 * Phase S3 corrections over S2:
 *   — Added text-list-primary / text-list-body (were missing entirely).
 *   — Removed duplicate text-row entries from Preferred Tokens.
 *   — Removed canonical preferred tokens from the Deprecated table
 *     (they were incorrectly listed there in S2).
 *   — Added text-input (non-existent) → removed from deprecated table.
 *   — Corrected text-error / text-empty-state / text-modal-title specs
 *     to computed px against 19px root.
 *   — Added per-token semantic usage descriptions.
 *   — Added Canonical Usage Rules section.
 *   — Added Role Glossary note (text-page-title → text-title, etc.).
 *   — Fixed duplicate rows in Weight Overlay and Numeric tables.
 */

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// Sample content
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_PREVIEW = "Service appointment · $1,248.75 · 02/14/26";

// ──────────────────────────────────────────────────────────────────────
// Preferred tokens
//
// All specs verified against tailwind.config.ts. Rem-based values
// computed against html { font-size: 19px }.
// Format: "SIZE / LINE-HEIGHT / WEIGHT [/ TRACKING] [/ TRANSFORM]"
// ──────────────────────────────────────────────────────────────────────

interface PreferredTokenSpec {
  className: string;
  specs: string;
  role: string;
  usage: string;
}

const PREFERRED_TOKENS: PreferredTokenSpec[] = [
  {
    className: "text-display",
    specs: "32px / 40px / 700",
    role: "Display / KPI hero",
    usage: "Large dashboard metric values, revenue totals, prominent KPI figures. Rarely used outside financial widgets.",
  },
  {
    className: "text-title",
    specs: "30px / 36px / 700",
    role: "Page title (h1)",
    usage: 'Top-level page header. One per page. Also called "page-title" conceptually — the utility class is text-title.',
  },
  {
    className: "text-header",
    specs: "18px / 24px / 600",
    role: "Card / panel / modal title (h2)",
    usage: 'Card headers, section titles, modal titles. The "section title" role — utility class is text-header.',
  },
  {
    className: "text-subheader",
    specs: "16px / 22px / 500",
    role: "Sub-group heading (h3)",
    usage: "Groupings inside a card or modal. Table section dividers, accordion headers.",
  },
  {
    className: "text-body",
    specs: "15px / 22px / 400",
    role: "Default reading text",
    usage: "Dialog body copy, form prose, description paragraphs. The default for readable multi-sentence content.",
  },
  {
    className: "text-emphasis",
    specs: "15px / 22px / 500",
    role: "Emphasized inline text",
    usage: "Inline emphasis within body copy, highlighted field values. Same size as text-body but medium weight.",
  },
  {
    className: "text-list-primary",
    specs: "15px / 20px / 500",
    role: "EntityListTable primary cell",
    usage: "Entity names and primary identifiers in list table rows (client name, job title). Tighter line-height than text-body for dense rows.",
  },
  {
    className: "text-list-body",
    specs: "15px / 20px / 400",
    role: "EntityListTable body cells",
    usage: "Descriptive/summary cells in list tables (schedule, notes, address). Same size as text-list-primary but regular weight.",
  },
  {
    className: "text-row",
    specs: "14px / 20px / 400",
    role: "Default row / table content",
    usage: "Standard table row data, rail content, sidebar labels. The default application body size for dense UI. Use text-row font-medium (fw 500) for entity names in detail panels.",
  },
  {
    className: "text-label",
    specs: "13px / 16px / 500 / 0.04em / UPPERCASE",
    role: "Table column headers, eyebrow labels",
    usage: 'All-caps metadata keys ("BILL TO", "ISSUED", "DUE DATE"), table column headers, KPI label eyebrows. Uppercase + tracking applied automatically by @layer components rule.',
  },
  {
    className: "text-helper",
    specs: "13px / 16px / 400",
    role: "Hint / footnote / dense secondary",
    usage: 'Helper text below form fields, timestamps, footnotes, dense panel metadata. The "caption" role — utility class is text-helper.',
  },
  {
    className: "text-nav-compact",
    specs: "12px / 14px / 500",
    role: "Narrow rail tab labels",
    usage: "Compact vertical navigation strips, right-rail tabs where horizontal space is constrained. No uppercase, no tracking (differs from text-label).",
  },
];

// ──────────────────────────────────────────────────────────────────────
// Special-purpose tokens
//
// Not part of the visual hierarchy ramp. Still active — retained because
// they serve distinct component roles with no exact match in the
// preferred set. Do not use these for general content.
// ──────────────────────────────────────────────────────────────────────

interface SpecialTokenSpec {
  className: string;
  specs: string;
  role: string;
  usage: string;
}

const SPECIAL_PURPOSE_TOKENS: SpecialTokenSpec[] = [
  {
    className: "text-modal-title",
    specs: "~21.4px (1.125rem) / ~30.4px (1.6rem) / 600",
    role: "Dialog title chrome",
    usage: "shadcn DialogTitle only. Intentionally larger than text-header (18px) because modal chrome reads at a higher visual hierarchy level.",
  },
  {
    className: "text-error",
    specs: "~15.2px (0.8rem) / ~22.8px (1.2rem) / 500",
    role: "Form validation error",
    usage: "Inline field validation errors. Always pair with text-destructive for red color. Do not use for general error banners — those use text-body.",
  },
  {
    className: "text-empty-state",
    specs: "~15.2px (0.8rem) / ~22.8px (1.2rem) / 400",
    role: "Empty state copy",
    usage: "Empty state body text inside list pages and cards. Visually close to text-body but rem-based for legacy compat.",
  },
];

// ──────────────────────────────────────────────────────────────────────
// Deprecated tokens — Form & Select group
//
// Phase S1 (2026-05-08) status: deprecated, do NOT use in new code.
// Guarded by tests/semantic-typography-guard.test.ts.
// Values preserved verbatim for back-compat; shadcn primitives still
// consume them. Pending design decision: align to text-label / text-helper
// at 13px or introduce a sentence-case form-label preferred role.
// ──────────────────────────────────────────────────────────────────────

interface DeprecatedTokenSpec {
  className: string;
  computedSpecs: string;
  note: string;
}

const DEPRECATED_FORM_TOKENS: DeprecatedTokenSpec[] = [
  {
    className: "text-form-label",
    computedSpecs: "~15.2px / ~22.8px / 500",
    note: "Sentence-case form label (Label, FormLabel). Kept for shadcn compat. Pending migration to text-label or a new preferred role.",
  },
  {
    className: "text-form-helper",
    computedSpecs: "~15.2px / ~22.8px / 400",
    note: "Hint text below form fields (FormDescription). Pending migration to text-helper.",
  },
  {
    className: "text-select-label",
    computedSpecs: "~15.2px / ~22.8px / 600",
    note: "Group label inside a Select dropdown. Kept for shadcn compat.",
  },
  {
    className: "text-select-item",
    computedSpecs: "~15.2px / ~22.8px / 400",
    note: "Option row inside a Select dropdown. Kept for shadcn compat.",
  },
];

// ──────────────────────────────────────────────────────────────────────
// Deprecated tokens — Legacy size ramp
//
// Sizes render larger than standard because html { font-size: 19px }.
// E.g. text-xs = 0.8rem × 19px = 15.2px (not 12.8px as expected).
// Migrate all usages to preferred semantic tokens.
// ──────────────────────────────────────────────────────────────────────

interface LegacyTokenSpec {
  className: string;
  computedSize: string;
  migratesTo: string;
}

const LEGACY_SIZE_RAMP: LegacyTokenSpec[] = [
  { className: "text-xs",   computedSize: "~15.2px",  migratesTo: "text-helper · text-row · text-label" },
  { className: "text-sm",   computedSize: "~17.1px",  migratesTo: "text-body · text-row" },
  { className: "text-base", computedSize: "19px",     migratesTo: "text-body · text-header" },
  { className: "text-lg",   computedSize: "~21.4px",  migratesTo: "text-title · text-header" },
  { className: "text-xl",   computedSize: "~23.8px",  migratesTo: "text-title" },
  { className: "text-2xl",  computedSize: "~28.5px",  migratesTo: "text-display" },
];

// ──────────────────────────────────────────────────────────────────────
// Canonical Usage Rules
// ──────────────────────────────────────────────────────────────────────

const CANONICAL_RULES: ReadonlyArray<{ rule: string; detail: string }> = [
  {
    rule: "Semantic tokens only — never ad hoc sizes",
    detail: 'Do not use text-[14px], text-xs, text-sm, or other raw Tailwind size utilities in feature components. Use a semantic token ("text-row", "text-helper", etc.) instead.',
  },
  {
    rule: "text-row is the default application body size",
    detail: "When in doubt, use text-row (14px / 400). It matches operational density across the dashboard, rails, and table rows.",
  },
  {
    rule: "text-row font-medium for entity names in panels",
    detail: "Primary entity identifiers in detail panels and rails use text-row + font-medium (14px / 500), not text-emphasis (15px). This is the EntityName canonical class.",
  },
  {
    rule: "text-helper for secondary / supporting copy",
    detail: "Timestamps, footnotes, helper text below fields, and dense secondary lines all use text-helper (13px / 400) + text-muted-foreground.",
  },
  {
    rule: "text-label is always UPPERCASE — do not override",
    detail: "text-label carries uppercase + 0.04em tracking via @layer components. It is the right token for table column headers, metadata keys (\"BILL TO\"), and eyebrow labels. Do not remove the uppercase.",
  },
  {
    rule: "Use text-list-primary / text-list-body only in list tables",
    detail: "These tokens are scoped to EntityListTable primary cells and body cells. Do not use them for prose, dialog copy, or panel content.",
  },
  {
    rule: "Do not weight-override on role tokens",
    detail: "font-bold and font-semibold overrides on text-row, text-helper, text-label etc. are forbidden (enforced by tests/typography-canonical.test.ts). font-medium is the only allowed addition.",
  },
  {
    rule: "Use text-muted-foreground for muted color — not text-text-muted",
    detail: "text-text-muted is a legacy alias kept only inside list-surface.tsx. New code must use text-muted-foreground for muted/secondary text color.",
  },
  {
    rule: "Never redeclare local *_CLASS constants with a text-* value",
    detail: "Feature components must import ENTITY_NAME_CLASS, ENTITY_META_CLASS, SECTION_LABEL_CLASS, ENTITY_LINK_CLASS from @/components/ui/typography. Local redeclarations drift and break the canonical system.",
  },
  {
    rule: "Form/select tokens are deprecated — do not add new usages",
    detail: "text-form-label, text-form-helper, text-select-label, text-select-item exist only for back-compat with shadcn internals. Guarded by tests/semantic-typography-guard.test.ts.",
  },
];

// ──────────────────────────────────────────────────────────────────────
// Weight overlay table — one row per token, 4 weight columns
// ──────────────────────────────────────────────────────────────────────

const WEIGHT_OVERLAY_TOKENS: ReadonlyArray<string> = [
  "text-display",
  "text-header",
  "text-body",
  "text-emphasis",
  "text-row",
  "text-helper",
  "text-label",
];

const WEIGHT_OVERLAYS: ReadonlyArray<{ className: string; label: string }> = [
  { className: "",              label: "default" },
  { className: "font-medium",   label: "+medium" },
  { className: "font-semibold", label: "+semibold" },
  { className: "font-bold",     label: "+bold" },
];

// ──────────────────────────────────────────────────────────────────────
// Numeric / tabular alignment table
// ──────────────────────────────────────────────────────────────────────

const NUMERIC_TOKENS: ReadonlyArray<string> = [
  "text-display",
  "text-emphasis",
  "text-row",
  "text-helper",
  "text-label",
];

const NUMERIC_SAMPLES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Revenue",     value: "$1,248.75" },
  { label: "Invoice #",   value: "INV-10482" },
  { label: "Job #",       value: "JOB-24019" },
  { label: "Duration",    value: "1.50 hrs" },
  { label: "Time range",  value: "10:30 AM – 12:00 PM" },
  { label: "Date",        value: "02/14/2026" },
];

// ──────────────────────────────────────────────────────────────────────
// Print stylesheet
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
      className="pt-4 mt-4 border-t border-border first:pt-0 first:mt-0 first:border-t-0"
      data-testid={testId}
    >
      <h2 className="text-helper text-muted-foreground font-medium uppercase tracking-wide mb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PreferredTokenRow({ token }: { token: PreferredTokenSpec }) {
  return (
    <div
      className="break-inside-avoid py-2 border-b border-border last:border-b-0"
      data-testid={`token-row-${token.className}`}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="font-mono text-helper text-foreground">{token.className}</code>
        <span className="text-helper text-muted-foreground">{token.specs}</span>
        <span className="text-helper text-muted-foreground">·</span>
        <span className="text-helper text-muted-foreground italic">{token.role}</span>
      </div>
      <div className="text-helper text-muted-foreground mt-0.5 mb-1">{token.usage}</div>
      <div className={`${token.className} tabular-nums whitespace-nowrap`}>
        {SAMPLE_PREVIEW}
      </div>
    </div>
  );
}

function SpecialTokenRow({ token }: { token: SpecialTokenSpec }) {
  return (
    <div
      className="break-inside-avoid py-2 border-b border-border last:border-b-0"
      data-testid={`special-token-row-${token.className}`}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="font-mono text-helper text-foreground">{token.className}</code>
        <span className="text-helper text-muted-foreground">{token.specs}</span>
        <span className="text-helper text-muted-foreground">·</span>
        <span className="text-helper text-muted-foreground italic">{token.role}</span>
      </div>
      <div className="text-helper text-muted-foreground mt-0.5 mb-1">{token.usage}</div>
      <div className={`${token.className} tabular-nums whitespace-nowrap`}>
        {SAMPLE_PREVIEW}
      </div>
    </div>
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
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Print-only header */}
      <div
        data-style-guide-print-header
        className="hidden border-b border-border pb-2 mb-3"
      >
        <div className="text-header text-foreground">
          FSI / Syntraro Semantic Typography Reference
        </div>
        <div className="text-helper text-muted-foreground mt-0.5">
          Generated {today}
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          /style-guide/typography
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          html root: 19px
        </div>
      </div>

      {/* Screen header */}
      <header
        className="flex items-center justify-between gap-4 mb-4 break-inside-avoid"
        data-print-hide
      >
        <div>
          <h1 className="text-title text-foreground">Typography Style Guide</h1>
          <p className="text-helper text-muted-foreground mt-0.5">
            Canonical token reference · html root: 19px · Phase S3
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

      {/* ── Role Glossary note ───────────────────────────────────────── */}
      <div
        className="mb-4 px-3 py-2 rounded-md bg-muted/30 border border-border text-helper text-muted-foreground break-inside-avoid"
        data-testid="style-guide-role-glossary"
      >
        <span className="font-medium text-foreground">Role aliases (no separate tokens exist): </span>
        <span className="font-mono">page-title</span> → <span className="font-mono">text-title</span>
        <span className="mx-2 text-muted-foreground/40">·</span>
        <span className="font-mono">section-title</span> → <span className="font-mono">text-header</span>
        <span className="mx-2 text-muted-foreground/40">·</span>
        <span className="font-mono">caption</span> → <span className="font-mono">text-helper</span>
        <span className="mx-2 text-muted-foreground/40">·</span>
        <span className="font-mono">text-input</span> → does not exist
      </div>

      {/* ── Preferred tokens ──────────────────────────────────────────── */}
      <Section title="Preferred Tokens" testId="style-guide-typography-preferred">
        <div>
          {PREFERRED_TOKENS.map((t) => (
            <PreferredTokenRow key={t.className} token={t} />
          ))}
        </div>
      </Section>

      {/* ── Special-purpose tokens ────────────────────────────────────── */}
      <Section title="Special-Purpose Tokens" testId="style-guide-typography-special">
        <p className="text-helper text-muted-foreground mb-2">
          Active tokens with a specific component role. Not for general content. Rem values computed
          against <code className="font-mono">html &#123; font-size: 19px &#125;</code>.
        </p>
        <div>
          {SPECIAL_PURPOSE_TOKENS.map((t) => (
            <SpecialTokenRow key={t.className} token={t} />
          ))}
        </div>
      </Section>

      {/* ── Canonical Usage Rules ─────────────────────────────────────── */}
      <Section title="Canonical Usage Rules" testId="style-guide-typography-rules">
        <div className="space-y-2">
          {CANONICAL_RULES.map((r) => (
            <div
              key={r.rule}
              className="break-inside-avoid py-1.5 border-b border-border last:border-b-0"
            >
              <div className="text-row font-medium text-foreground">{r.rule}</div>
              <div className="text-helper text-muted-foreground mt-0.5">{r.detail}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Deprecated: Form & Select tokens ─────────────────────────── */}
      <Section title="Deprecated — Form & Select Tokens" testId="style-guide-typography-deprecated-form">
        <p className="text-helper text-muted-foreground mb-2">
          Deprecated since Phase S1 (2026-05-08). Preserved for shadcn back-compat only.
          Guarded by <code className="font-mono">tests/semantic-typography-guard.test.ts</code>.
          Do not add new usages.
        </p>
        <table className="w-full border-collapse" data-testid="style-guide-deprecated-form-table">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">Token</th>
              <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">Computed (19px root)</th>
              <th className="text-left py-1 text-helper text-muted-foreground font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {DEPRECATED_FORM_TOKENS.map((t) => (
              <tr
                key={t.className}
                className="break-inside-avoid border-b border-border last:border-b-0"
                data-testid={`deprecated-form-token-${t.className}`}
              >
                <td className="py-1 pr-3 align-baseline font-mono text-helper text-foreground whitespace-nowrap">
                  {t.className}
                </td>
                <td className="py-1 pr-3 align-baseline text-helper text-muted-foreground whitespace-nowrap">
                  {t.computedSpecs}
                </td>
                <td className="py-1 align-baseline text-helper text-muted-foreground">
                  {t.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ── Deprecated: Legacy size ramp ──────────────────────────────── */}
      <Section title="Deprecated — Legacy Size Ramp" testId="style-guide-typography-deprecated-ramp">
        <p className="text-helper text-muted-foreground mb-2">
          Raw Tailwind size utilities. Render larger than expected because{" "}
          <code className="font-mono">html &#123; font-size: 19px &#125;</code> (not 16px).
          Migrate to the preferred semantic tokens above.
        </p>
        <table className="w-full border-collapse" data-testid="style-guide-deprecated-ramp-table">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">Utility</th>
              <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">Computed size</th>
              <th className="text-left py-1 text-helper text-muted-foreground font-medium">Migrate to</th>
            </tr>
          </thead>
          <tbody>
            {LEGACY_SIZE_RAMP.map((t) => (
              <tr
                key={t.className}
                className="break-inside-avoid border-b border-border last:border-b-0"
                data-testid={`legacy-token-${t.className}`}
              >
                <td className="py-1 pr-3 align-baseline font-mono text-helper text-foreground">
                  {t.className}
                </td>
                <td className="py-1 pr-3 align-baseline text-helper text-muted-foreground">
                  {t.computedSize}
                </td>
                <td className="py-1 align-baseline font-mono text-helper text-muted-foreground">
                  {t.migratesTo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ── Weight overlay grid ───────────────────────────────────────── */}
      <Section title="Weight Overlay" testId="style-guide-typography-weight-overlay">
        <div className="overflow-x-auto break-inside-avoid">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">
                  Token
                </th>
                {WEIGHT_OVERLAYS.map((overlay) => (
                  <th
                    key={overlay.label}
                    className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium"
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
                  className="break-inside-avoid border-b border-border last:border-b-0"
                  data-testid={`weight-overlay-row-${tokenClass}`}
                >
                  <td className="py-1 pr-3 align-baseline font-mono text-helper text-foreground">
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

      {/* ── Numbers / tabular alignment ───────────────────────────────── */}
      <Section title="Numbers · Tabular Alignment" testId="style-guide-typography-numeric">
        <div className="overflow-x-auto break-inside-avoid">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium">
                  Sample
                </th>
                {NUMERIC_TOKENS.map((tokenClass) => (
                  <th
                    key={tokenClass}
                    className="text-left py-1 pr-3 text-helper text-muted-foreground font-medium font-mono"
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
                  className="break-inside-avoid border-b border-border last:border-b-0"
                >
                  <td className="py-1 pr-3 align-baseline text-helper text-muted-foreground">
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
