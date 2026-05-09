# Semantic Tokens Audit

> Read-only inventory of every semantic token defined and consumed by the
> Syntraro client. Audit only — no implementation changes.
>
> **Audit date:** 2026-05-08
> **Audit scope:** `client/src/**` plus `tailwind.config.ts`, `client/src/index.css`, `docs/UI_TYPOGRAPHY.md`, the canonical primitive files in `client/src/components/ui/`, and the rail/list/chip/dashboard/communications surfaces that consume them.
>
> **Visual reference page (added 2026-05-08).** A live preview of every typography token now ships at `/style-guide/typography` (route gated `requireAdmin`). Linked from `Settings > Advanced > Typography Style Guide`. Source: `client/src/pages/StyleGuideTypographyPage.tsx`. Use it to compare scale / weight / tracking by eye instead of reading class names. The page is **printable / exportable as PDF** directly from the browser — click "Print / Save PDF" in the page header, then choose "Save as PDF" in the print dialog. The printed output preserves the live semantic tokens (no synthetic generator); page-break optimization keeps each token row on a single page.
>
> **Drift guard (added 2026-05-08).** `tests/semantic-typography-guard.test.ts` enforces a frozen baseline of legacy-ramp + arbitrary `text-[Npx]` usage. The test fails when any file's count increases or a new file introduces these classes. After a deliberate migration sweep, re-run `node scripts/scan-typography-baseline.mjs` to lower the floor. Baseline file: `tests/semantic-typography-baseline.json`.
>
> **Phase S1 — Simplified Semantic Typography (2026-05-08).** The token vocabulary has been simplified to a visual-hierarchy set: **`text-display`, `text-title`, `text-header`, `text-subheader`, `text-body`, `text-row`, `text-emphasis`, `text-caption`, `text-label`, `text-helper`, `text-error`**. Component-specific tokens (`text-page-title`, `text-section-title`, `text-subhead`, `text-modal-title`, `text-row-emphasis`, `text-table-header/cell`, `text-input`, `text-email-body`, `text-empty-state`, `text-form-label/helper`, `text-select-label/item`) are **deprecated but retained** in the live config so existing consumers render unchanged. The drift guard now also blocks new usage of the deprecated aliases. **Source of truth: `docs/SEMANTIC_TYPOGRAPHY_SYSTEM.md`.**

---

## Summary

The app has **three** layers of canonical-token machinery, with substantial drift between them and feature consumers:

1. **Token definitions.** `tailwind.config.ts > theme.extend.fontSize` exposes ~24 typography tokens by role; `theme.extend.colors` exposes the canonical color set; `:root` in `client/src/index.css` declares the underlying CSS variables. `text-label` / `text-table-header` get an additional `@layer components` rule for `text-transform: uppercase`.
2. **Compositional primitives.** `client/src/components/ui/typography.tsx` exposes `EntityName` / `EntityMeta` / `SectionLabel` / `EntityLink` / `EntityRow` plus class-string constants (`ENTITY_NAME_CLASS`, `ENTITY_META_CLASS`, etc.). `client/src/components/ui/list-surface.tsx` exposes `listPrimaryClass` / `listHeaderRowClass` / `listSecondaryClass` aliasing the typography constants. `client/src/lib/chipVariants.ts` is the canonical chip cva.
3. **Feature consumers.** Pages and feature components compose tokens. The detail-rail and Phase H1/H2-migrated communications surfaces are mostly clean. The legacy ramp (`text-xs/-sm/-base/-lg/-xl/-2xl`) is still pervasive across pages — **2,313 occurrences across 200 files**. Arbitrary `text-[Npx]` values: **446 across 100 files**. `font-medium / font-semibold / font-bold` modifiers: **872 across 100+ files** (a portion of these layer heavier weights on top of role tokens that already bake the right weight).

**Single biggest mismatch.** `tailwind.config.ts` defines `text-section-title` and `text-row-emphasis` at 17/24/600 (after the 2026-05-08 recalibration); `docs/UI_TYPOGRAPHY.md` still documents the pre-recalibration values (18/24/600 and 15/22/500). The doc is stale.

---

## Typography Tokens

Every key in `tailwind.config.ts > theme.extend.fontSize`. "Resolved" values reflect the live `tailwind.config.ts` definition, not the docs.

| Token | Size | Line height | Weight | Letter-spacing | Transform | Intended use | Notes |
|---|---|---|---|---|---|---|---|
| `text-display` | 32px | 40px | 700 | — | — | Single biggest visible value on a page (totals, KPI emphasis) | Defined; near-zero direct usage observed. |
| `text-page-title` | 30px | 36px | 700 | — | — | h1 for a detail page | Used by JobDetailPage h1, IntegrationsPage, etc. |
| `text-section-title` | **17px** | 24px | 600 | — | — | h2 for a card / panel / modal — `CardTitle` defaults here | After 2026-05-08 recalibration this pixel-aligns with `text-row-emphasis`. **Doc says 18px/24px/600 — stale.** |
| `text-subhead` | 16px | 22px | 500 | — | — | h3 for groups inside a card; table sub-headers | Used by `EmptyState`, dashboard sub-headings. |
| `text-body` | 15px | 22px | 400 | — | — | Default reading text — forms, dialogs, prose | Aliased by `text-input`, `text-email-body`, `text-table-cell`. |
| `text-row` | 15px | 22px | **500** | — | — | Default table / list row content | After 2026-05-08 recalibration weight bumped to 500. Used as Notes body, rail subrow primary text (post-2026-05-08 Labour remap). |
| `text-row-emphasis` | **17px** | 24px | 600 | — | — | Primary identifier in a row (entity name) | After 2026-05-08 recalibration: 17/24/600 (was 15/22/500). **Pixel-identical to `text-section-title`** — duplicate scale by design. |
| `text-caption` | 14px | 20px | (400) | — | — | Secondary text alongside row content (timestamps, sub-amounts) — `CardDescription` defaults here | Used by Labour sectionHeader value, list-page secondary cell, Notes author/date row. |
| `text-label` | 13px | 16px | 500 | 0.04em | UPPERCASE (via `@layer components` in `client/src/index.css:378-381`) | Form field labels, table column headers, metadata keys ("BILL TO", "ISSUED") | Uppercase is part of the role identity. |
| `text-helper` | 13px | 16px | (400) | — | — | Tooltip body, hint text, footnotes; rail/panel dense-secondary | Per CLAUDE.md > Phase H1: `text-helper` is the canonical dense-secondary token for rails / panels. |
| `text-modal-title` | 1.125rem (≈21.4px) | 1.6rem | 600 | — | — | DialogTitle | Pixel-matches the legacy `text-lg font-semibold`. |
| `text-table-header` | 13px | 16px | 500 | 0.04em | UPPERCASE (via `@layer` in `client/src/index.css:387-389`) | Table column headers | **Alias of `text-label`** (same pixel output). |
| `text-table-cell` | 14px | 20px | (400) | — | — | Table cells | Alias of `text-row`. Synced to 14/20/400 (2026-05-08) — pixel-identical to current text-row. |
| `text-input` | 15px | 22px | (400) | — | — | Form input/textarea | Alias of `text-body`. |
| `text-email-body` | 15px | 22px | (400) | — | — | Email composition | Alias of `text-body`. |
| `text-error` | 0.8rem (≈15.2px) | 1.2rem | 500 | — | — | Form validation error text (pair with `text-destructive`) | Pixel-matches the legacy `text-xs font-medium` FormMessage uses. |
| `text-empty-state` | 0.8rem (≈15.2px) | 1.2rem | (400) | — | — | Empty-state copy in reports / lists / modals | Pixel-matches legacy `text-xs`. |
| `text-form-label` | 0.8rem (≈15.2px) | 1.2rem | 500 | — | — | Sentence-case form labels (Label, FormLabel) | Pixel-matches legacy `text-xs font-medium`. **Distinct from `text-label`** which is uppercase metadata. |
| `text-form-helper` | 0.8rem (≈15.2px) | 1.2rem | (400) | — | — | Helper / hint copy below a field (FormDescription) | Pair with `text-muted-foreground`. |
| `text-select-label` | 0.8rem (≈15.2px) | 1.2rem | 600 | — | — | Group label inside a Select dropdown | Heavier weight than form-label. |
| `text-select-item` | 0.8rem (≈15.2px) | 1.2rem | (400) | — | — | Option row inside a Select dropdown | — |

**Legacy ramp (still defined in `tailwind.config.ts:191-196`, deprecated):**

| Token | Size | Line height | Notes |
|---|---|---|---|
| `text-xs` | 0.8rem (≈15.2px) | 1.2rem | Renders against `html { font-size: 19px }`. Migrate to `text-caption` or `text-label`. |
| `text-sm` | 0.9rem (≈17.1px) | 1.3rem | Migrate to `text-body` (forms) or `text-row` (lists). |
| `text-base` | 1rem (19px) | 1.5rem | Migrate to `text-body` or `text-section-title`. |
| `text-lg` | 1.125rem (≈21.4px) | 1.6rem | Migrate to `text-page-title` or `text-modal-title`. |
| `text-xl` | 1.25rem (≈23.8px) | 1.75rem | Migrate to `text-page-title`. |
| `text-2xl` | 1.5rem (≈28.5px) | 2rem | Migrate to `text-display`. |

---

## Color Tokens

CSS variables in `client/src/index.css :root` (light mode) wrapped as Tailwind utilities by `tailwind.config.ts > theme.extend.colors`.

### Surface

| Token | Hex (light) | Intended use |
|---|---|---|
| `bg-app-bg` / `text-app-bg` | `#F3F5F7` (HSL `210 20% 96%`) | Global page background. Also aliased to `--background`. |
| `bg-surface` | `#FFFFFF` | Cards, popovers, modals. Also `--card`, `--popover`. |
| `bg-surface-subtle` | `#EEF2F6` | Zebra rows, list hover, subtle surface. |
| `bg-sidebar-bg` / `bg-header-bg` | `#222B36` | App sidebar + global header (aliased). |
| `bg-background` | `#F3F5F7` | Legacy alias of `--app-bg`. |
| `bg-card` | `#FFFFFF` | Card body. |
| `bg-popover` | `#FFFFFF` | Popover body. |

### Border

| Token | Hex | Intended use |
|---|---|---|
| `border-default` | `#E2E8F0` | Standard borders / dividers. |
| `border-strong` | `#CBD5E1` | Emphasized dividers, drag handles. |
| `border-border` | `#E2E8F0` | Legacy alias used by `border-border` in shadcn primitives. |
| `border-card` | `#E2E8F0` | Card border. |
| `border-input` | `#E5E7EB` | Form input border. |

### Text

| Token | Hex | Intended use |
|---|---|---|
| `text-text-primary` | `#0F172A` | Body / heading text. |
| `text-text-secondary` | `#475569` | Sub-headings, muted-but-readable. |
| `text-text-muted` | `#64748B` | Helper text, timestamps, label color. **Phase H1 deprecates this for new code in favor of `text-muted-foreground`** (CLAUDE.md > Typography Primitives), but `list-surface.tsx` still uses it for back-compat on list pages. |
| `text-text-disabled` | `#94A3B8` | Disabled state. |
| `text-foreground` | `#0F172A` | Body text — alias of `--foreground` (slightly different HSL but visually identical to `text-primary`). |
| `text-muted-foreground` | `#5A627A` (≈) | shadcn-canonical muted text — used 650+ times across the codebase. **Live duplicate of `text-text-muted`.** |

### Brand

| Token | Hex | Intended use |
|---|---|---|
| `bg-brand` / `text-brand` | `#76B054` | Syntraro brand green (CTAs, accent bar). |
| `bg-brand-hover` | `#5F9442` | Brand hover state. |
| `--brand-ring` (raw rgba) | `rgba(118,176,84,0.18)` | Brand ring. |
| `--primary-green` | `#76B054` | **Deprecated alias of `--brand`** (slated for Phase 6 removal). |

### Status

| Token | Hex | Intended use |
|---|---|---|
| `bg-success` / `text-success` | `#16A34A` | Success state. |
| `bg-warning` / `text-warning` | `#F59E0B` | Warning state. |
| `bg-danger` / `text-danger` | `#DC2626` | Destructive / error state. |
| `bg-info` / `text-info` | `#2563EB` | Informational state. |
| `bg-status-overdue` (+ `-foreground`, `-border`) | `#DC4444` (≈) | Job/Invoice overdue badge. |
| `bg-status-upcoming` (+ `-foreground`, `-border`) | `#F0B82A` (≈) | Job upcoming badge. |
| `bg-status-this-month` (+ `-foreground`, `-border`) | `#2F8237` (≈) | Job within-this-month badge. |
| `bg-status-unscheduled` (+ `-foreground`, `-border`) | `#6B7280` (≈) | Job unscheduled badge. |

### shadcn legacy (kept for back-compat)

| Token | Notes |
|---|---|
| `bg-primary` / `text-primary-foreground` | HSL `98 37% 51%` — duplicate of `--brand`. Documented for Phase 6 cleanup in `client/src/index.css:84-89`. |
| `bg-secondary` / `text-secondary-foreground` | Pale gray surface. |
| `bg-muted` / `text-muted-foreground` | Live duplicate of `--text-muted` for the foreground side. |
| `bg-accent` / `text-accent-foreground` | Pale gray accent. |
| `bg-destructive` / `text-destructive` / `text-destructive-foreground` | `#E55656` (≈) — used by FormMessage, AlertDialog destructive variant, delete buttons. |
| `bg-input`, `bg-ring`, `bg-chart-{1..5}` | Form chrome + chart palette. |

### Chip/pill tone palette (`client/src/lib/chipVariants.ts`)

These are **not** CSS variables — they are arbitrary-value class strings inlined into the cva config. Documented as "preserved verbatim from existing surfaces" with a TODO to migrate to semantic CSS variables. Five tones (`neutral`, `success`, `warning`, `danger`, `info`) plus `purple` and `active` (brand fill).

Example: `TONE_SUCCESS = "bg-[rgba(34,197,94,0.12)] text-[#16a34a] border-[rgba(34,197,94,0.25)]"` — uses raw rgba/hex, not the canonical `--success` variable. **Documented drift, intentionally deferred.**

---

## Surface / Elevation Tokens

| Token | CSS value | Intended use |
|---|---|---|
| `shadow-card` | `0 8px 18px rgba(15, 23, 42, 0.04)` | Canonical card shadow. Mirrored in CSS as `--card-shadow`. Defined in `tailwind.config.ts:14-16`. |
| `shadow-2xs` | `0px 1px 2px 0px hsl(220 8% 20% / 0.04)` | Smallest elevation. |
| `shadow-xs` | `0px 1px 3px 0px hsl(220 8% 20% / 0.06)` | Tiny elevation. |
| `shadow-sm` | `0px 2px 4px -1px ...` | Small elevation. Used by `RailContentCard` (per `client/src/components/detail-rail/RailContentCard.tsx:79`). |
| `shadow` | medium | Default card lift. |
| `shadow-md` / `-lg` / `-xl` / `-2xl` | progressively larger | Dialog / modal / popover elevations. |

### Border radius

| Token | Value | Intended use |
|---|---|---|
| `rounded-sm` | 3px | Small chips, compact controls. |
| `rounded-md` | 6px | Default for inputs, buttons, RailContentCard. |
| `rounded-lg` | 9px | Cards, dialogs. |
| `rounded-card` | 10px | Specific dashboard cards (`tailwind.config.ts:12`). |
| `rounded-full` | full | Chips, avatars, status pills. |

### Elevation utility classes (`client/src/index.css :493-`)

`hover-elevate` / `hover-elevate-2` / `active-elevate` / `active-elevate-2` / `toggle-elevate` / `toggle-elevate-2` — pseudo-element overlays driven by `--elevate-1` (`rgba(0,0,0,.03)`) and `--elevate-2` (`rgba(0,0,0,.08)`) variables. Used by buttons, badges, and toggle controls for state contrast.

---

## Spacing / Layout Tokens

The app does **not** define a robust spacing token vocabulary. Most spacing is raw Tailwind (`gap-2`, `px-3`, `py-2.5`).

CSS variables that DO exist in `:root` (`client/src/index.css:97-100`):

| Variable | Value | Intended use |
|---|---|---|
| `--spacing-page` | 24px | Page-level container padding. **Unreferenced by Tailwind utilities** — exists only as a CSS variable for raw CSS consumers. |
| `--spacing-card` | 16px | Card body padding. Unreferenced by Tailwind utilities. |
| `--spacing-gap` | 16px | Default gap. Unreferenced by Tailwind utilities. |
| `--header-height` | 3.5rem | Used by `[data-slot="sidebar-container"]` to offset under the header (`client/src/index.css:357-361`). |
| `--radius` | 0.375rem (6px) | Default radius (used by shadcn). |
| `--radius-sm` | 6px | Small radius. |

### Layout class constants (sub-token surface)

These are not Tailwind tokens — they're exported strings that bundle utilities. They function as "semantic layout tokens" at the JS/TSX layer.

| Constant | File | Bundles |
|---|---|---|
| `listSurfaceClass` | `client/src/components/ui/list-surface.tsx:19` | `rounded-md bg-[#ffffff] dark:bg-gray-900 overflow-hidden border border-[#e5e7eb] dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)]` |
| `listRowClass` | `:21` | `border-b border-[#e5e7eb] last:border-b-0 hover:bg-[#f8fafc] transition-colors` |
| `tableRowClass` | `:24` | clickable list row hover variant |
| `listHeaderRowClass` | `:38` | `grid items-center border-b border-[#e5e7eb] py-2 ${SECTION_LABEL_CLASS} bg-[#f8fafc]` |
| `listPrimaryClass` | `:40` | alias of `ENTITY_NAME_CLASS` |
| `listSecondaryClass` | `:42` | `text-caption text-text-muted truncate` |
| `listBadgeClass` | `:44` | `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium` |
| `listResultsClass` | `:46` | `text-xs text-muted-foreground mt-2` |
| `RAIL_WIDTH_TRANSITION` | `client/src/components/detail-rail/DetailRightRail.tsx:80` | `transition-[width] duration-300 ease-in-out motion-reduce:transition-none` |
| `RAIL_HEADER_ACTION_CLASS` | `:120` | `inline-flex items-center gap-1 h-7 px-2 rounded hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40` |
| `ENTITY_NAME_CLASS` | `client/src/components/ui/typography.tsx:83` | `text-caption font-medium truncate` |
| `ENTITY_NAME_LINK_CLASS` | `:89` | `text-caption font-medium truncate text-brand hover:underline` |
| `ENTITY_META_CLASS` | `:93` | `text-helper text-muted-foreground truncate` |
| `SECTION_LABEL_CLASS` | `:96` | `text-label text-muted-foreground` |
| `ENTITY_LINK_CLASS` | `:99` | `text-brand hover:underline` |
| `chipVariants` (cva) | `client/src/lib/chipVariants.ts:174` | full chip composition (size / tone / variant / interactive / selected) |

### Operational modal chrome (semantic CSS classes)

`client/src/index.css:430-469` defines `.operational-modal-shell` / `-header` / `-title` / `-count-badge` / `-body` / `-footer` / `-close-button`. These bundle hardcoded hex strings (`#e5e7eb`, `#f8fafc`, `#4b5563`, `#f1f5f9`, `#111827`) verbatim — documented as **intentional pinning to "default Tailwind" greys, NOT this project's custom `gray-*` palette**.

---

## Current Usage Examples

### Compliant (canonical tokens used by role)

| Location | Surface | Snippet |
|---|---|---|
| `client/src/components/detail-rail/RailContentCard.tsx:138-152` | Rail card title | `<As className={cn("text-row-emphasis text-text-primary truncate min-w-0", className)}>` |
| `client/src/components/detail-rail/RailContentCard.tsx:159-171` | Rail card subtitle | `<p className={cn("text-helper text-text-secondary truncate", className)}>` |
| `client/src/components/detail-rail/RailContentCard.tsx:180-192` | Rail card meta | `text-helper text-text-secondary mt-1.5 first:mt-0` |
| `client/src/components/detail-rail/RailPanelRenderer.tsx:204` | Grouped panel header values | `text-row-emphasis tabular-nums text-text-primary` |
| `client/src/components/detail-rail/RailPanelRenderer.tsx:251` (post-2026-05-08 remap) | Section header value | `text-caption tabular-nums text-text-primary shrink-0` |
| `client/src/components/ui/typography.tsx` | EntityName / EntityMeta primitives | composition layer |
| `client/src/lib/chipVariants.ts:179` | Chip cva | bakes `text-helper font-medium` |
| `client/src/components/notes/EntityNotesSection.tsx:355` | Notes origin chip | `text-label uppercase font-medium` (the explicit `uppercase font-medium` are redundant — `text-label` already bakes them) |

### Drift (raw utilities where a semantic token exists)

| Location | Surface | Snippet | Recommended target |
|---|---|---|---|
| `client/src/pages/ClientDetailPage.tsx:323` | Empty-state row | `text-xs text-muted-foreground` | `text-empty-state text-muted-foreground` (or `text-helper`) |
| `client/src/pages/ClientDetailPage.tsx:340` | Empty-state hint | `text-xs text-slate-500` | `text-helper text-text-secondary` |
| `client/src/pages/ClientDetailPage.tsx:364` | Job-row sub-line | `text-xs text-slate-400` | `text-helper text-text-disabled` |
| `client/src/pages/ClientDetailPage.tsx:1440-1465` | Rounded chip | `text-[11px] font-medium` | `chipVariants({size: "compact"})` (canonical chip) |
| `client/src/pages/ClientDetailPage.tsx:1576` | "Viewing" label | `text-[11px] font-medium uppercase tracking-wider text-slate-500` | `text-label text-text-muted` |
| `client/src/pages/ClientDetailPage.tsx:1868` | "Service Address" tag | `text-[11px] font-semibold uppercase tracking-wider text-slate-500` | `text-label text-text-secondary` |
| `client/src/components/ui/list-surface.tsx:44` | List badge | `text-xs font-medium` | `text-helper font-medium` (or migrate to `chipVariants`) |
| `client/src/components/ui/list-surface.tsx:46` | Results count | `text-xs text-muted-foreground` | `text-helper text-muted-foreground` |
| `client/src/index.css:449` | Operational modal count badge | `text-xs font-bold text-[#4b5563]` | `text-label text-text-secondary` (drop `font-bold` — role token bakes 500). The `[#4b5563]` is intentionally pinned per file comment. |
| `client/src/index.css:467-469` | Operational modal close button | `text-xs` | `text-helper` |

### Pre-existing token contradictions (token vs. token, not drift to raw utilities)

| Conflict | Where | What |
|---|---|---|
| `text-row-emphasis` and `text-section-title` are pixel-identical | `tailwind.config.ts:76, 92` | Both 17/24/600 after the 2026-05-08 recalibration. Roles overlap visually. |
| `text-row` / `text-table-cell` divergence | resolved 2026-05-08 | Both now 14/20/400. `text-table-cell` synced to match current `text-row`. |
| `text-text-muted` and `text-muted-foreground` | `client/src/index.css:52, 147` | Two muted-foreground tokens with different HSL values, both live, both used (`text-text-muted` ~290 hits, `text-muted-foreground` ~650 hits). CLAUDE.md > Phase H1 mandates `text-muted-foreground` for new code; `list-surface.tsx > listSecondaryClass` keeps `text-text-muted` for visual back-compat. |
| `--primary` and `--brand` | `client/src/index.css:142, 92` | Same HSL value (`98 37% 51%`); `--primary` is the shadcn alias kept for back-compat. Comment at `:84-91` flags the duplicate for Phase 6 cleanup. |
| `--primary-green` legacy hex | `client/src/index.css:95` | Deprecated alias slated for removal. |
| Multiple `border-input` definitions | `client/src/index.css` + tailwind | Used by shadcn inputs but not in the Phase 1 canonical token set. |

---

## Drift Findings

This is a representative slice — the high-density consumer count (200+ files with `text-xs/-sm/-base/-lg/-xl/-2xl`, 100+ files with `text-[Npx]`, 100+ files with `font-{medium,semibold,bold}`) is too large to enumerate exhaustively here. Each row below is exemplary, not unique.

| File | Raw class / pattern | Current use | Classification | Recommendation |
|---|---|---|---|---|
| `client/src/index.css:328` | `html { font-size: 19px }` | Global root font size | acceptable local utility | The 19px root is intentional (per `docs/UI_TYPOGRAPHY.md`) and every canonical token is now defined in absolute px so it neutralizes the root mismatch. Document but don't change. |
| `client/src/index.css:341-355` | `h1 { @apply text-2xl font-semibold }` etc. | Global heading defaults | should be replaced | Migrate to `text-page-title` / `text-section-title` / `text-subhead` / `text-body` so any unstyled `<h1>`/`<h2>`/`<h3>`/`<p>` inherits canonical sizes. Cascading change — sweep with the page migration. |
| `client/src/index.css:438-469` | Operational modal classes baking hardcoded hex (`#e5e7eb`, `#f8fafc`, `#4b5563`, `#f1f5f9`, `#111827`) | Operational modal chrome | unclear / needs decision | File comment explicitly pins the values to "default Tailwind greys, NOT this project's custom `gray-*`". Decision needed: define `--operational-divider`, `--operational-body-bg`, etc. semantic tokens, OR keep the literal pinning permanent. |
| `client/src/components/ui/list-surface.tsx:19,21,38` | Hardcoded `#ffffff`, `#e5e7eb`, `#f8fafc` literals on every list-page surface | List page chrome | should be replaced | Migrate to `bg-surface` / `border-border-default` / `bg-surface-subtle` (the Phase 1 canonical surface tokens). Cascades to every list page (Clients / Jobs / Invoices / Quotes / Leads / etc). |
| `client/src/components/ui/list-surface.tsx:44` | `text-xs font-medium` (listBadgeClass) | List-page status badge sizing | should be replaced | Migrate to `chipVariants({tone: ..., size: "compact"})` per the chip primitive. |
| `client/src/components/ui/list-surface.tsx:46` | `text-xs text-muted-foreground` (listResultsClass) | List-page footer count | should be replaced | `text-helper text-muted-foreground`. |
| `client/src/components/ui/typography.tsx:30-66` | File-level doc comment | Token doc | acceptable local utility | Doc comment cites operational density / OperationalAlertsCard rationale — informative, no drift. |
| `client/src/pages/ClientDetailPage.tsx:1440-1868` | 18+ instances of `text-[11px] font-medium uppercase tracking-wider` | Inline labels, chips, address tags | should be replaced | Each one is `text-label` (13px / 500 / 0.04em / UPPERCASE) inverted by hand. Replace with `text-label`. |
| `client/src/pages/ClientDetailPage.tsx:323-372` | 6+ instances of `text-xs` | Empty-state copy + secondary metadata | should be replaced | `text-empty-state` for empty-state body, `text-helper` for metadata. |
| `client/src/pages/ClientDetailPage.tsx` (104 hits) | Bulk `text-{xs,sm,base,lg}` | Page-wide drift | should be replaced | Page-by-page sweep. Highest-density legacy consumer in the app. |
| `client/src/pages/InvoiceDetailPage.tsx` (29+9 hits) | `text-{xs,sm}` + `text-[Npx]` | Page-wide drift | should be replaced | Bulk migrate. The page already has unrelated TS errors (39 pre-existing on `main`) — group typography migration with that cleanup. |
| `client/src/pages/QboConsolePage.tsx` (196 + 38 hits) | Heaviest legacy ramp + `text-[Npx]` consumer | Admin/integration screen | should be replaced | Lower priority — admin-only page, low traffic. |
| `client/src/pages/FinancialDashboard.tsx` (41 + 14 hits) | Mixed `text-{xs,sm,base}` + `text-[Npx]` | Dashboard widgets | unclear / needs decision | Some widgets ship at the operational density (`OperationalAlertsCard` uses `text-caption font-medium`); others should match. Audit widget-by-widget against the "operational density" precedent in `client/src/components/ui/typography.tsx:30-58`. |
| `client/src/tech-app/pages/VisitDetailPage.tsx` (121 + 19 + 92 hits) | Heaviest tech-app drift | Mobile tech-app screen | unclear / needs decision | Tech app may legitimately want different scale (mobile) — needs design decision before sweep. |
| `client/src/components/notes/EntityNotesSection.tsx:323-355` | `text-caption text-text-muted` for author/date row + `font-semibold text-text-primary` for inner name | Notes card author line | unclear / needs decision | The 14/400 + 14/600 inner-name treatment is one tier larger than the rail's `text-helper` (13/400) baseline used by Equipment. Phase H1 says "rails and panels use `text-helper`"; the inner `font-semibold` is a heavy-weight overlay on `text-caption` that the canonical guard normally forbids. **Decision needed**: keep Notes at 14px (visually distinct from Equipment) or migrate to `text-helper` with a `font-medium` author name. |
| `client/src/components/notes/EntityNotesSection.tsx:355` | `text-label uppercase font-medium` | Notes origin chip | acceptable local utility | The `uppercase` is redundant (text-label bakes it) but harmless. The `font-medium` re-applies the role token's baked weight (also redundant). Cosmetic cleanup — low priority. |
| `client/src/components/detail-rail/DetailRightRail.tsx:282` | `text-helper transition-colors` on the vertical tab button | Rail tab labels | unclear / needs decision | Labels render at 13/400 sentence-case. Panel header above renders at 13/500 UPPERCASE 0.04em. Visually inconsistent. The earlier audit (2026-05-08 Labour audit) deferred the tab-label decision — pending. Options: add `font-medium`, OR introduce a dedicated `text-rail-tab` token. |
| `client/src/components/detail-rail/RailContentCard.tsx:266` | `text-helper font-medium` on the chip primitive baseline | RailContentCardChip | acceptable local utility | The `font-medium` (500) bakes the chip-typography weight; pairs with chipVariants. Functionally identical to `chipVariants` baseline. Consider migrating callsites of `<RailContentCardChip>` to the canonical `chipVariants`-based `<Chip>` primitive (one chip system instead of two). |
| `tailwind.config.ts:191-196` | Legacy ramp (`text-xs/-sm/-base/-lg/-xl/-2xl`) defined | Backward compat | unclear / needs decision | Removing the ramp would break ~2,300 callsites. Phase H lint enforcement was planned per `docs/UI_TYPOGRAPHY.md` but has not landed. Recommendation: leave defined; add a lint rule that flags new uses; sweep page-by-page. |
| `tailwind.config.ts:142` (`--primary`) and `:92` (`--brand`) | Same HSL — duplicate | shadcn back-compat | should be replaced | Phase 6 cleanup target per `client/src/index.css:84-91`. Non-trivial because shadcn primitives all reference `--primary`. |
| `client/src/index.css:147` (`--muted-foreground`) and `:52` (`--text-muted`) | Two muted-foreground tokens | shadcn vs canonical | unclear / needs decision | Phase H1 mandates `text-muted-foreground` for new code; list-surface still uses `text-text-muted`. Decide which is the canonical one going forward and document in CLAUDE.md. |
| `font-bold` (~150 occurrences) | Various headings, totals, KPIs | Heavier weight | should be replaced | Most `font-bold` lives on `text-display` (already 700) or on stat values that should use `text-display` / `text-page-title`. The architectural guard in `tests/typography-canonical.test.ts` already forbids `font-bold` on the scanned `client/src/components/{communications,activity-feed,detail-rail}/` directories; expand the guard scope page-by-page. |
| `font-semibold` (~400 occurrences) | Pervasive | Heavier weight on top of role tokens | should be replaced (case-by-case) | Many `text-row font-semibold` and `text-base font-semibold` patterns. Each is a candidate to migrate to `text-row-emphasis` / `text-section-title`. |
| `tracking-wide` overlaid on `text-label` (multiple) | `client/src/components/detail-rail/RailPanelRenderer.tsx:197, 248` (pre-2026-05-08 remap, now fixed); other surfaces | Layered tracking | should be replaced | `text-label` bakes 0.04em; `tracking-wide` overrides to 0.025em (TIGHTER, not wider). The Labour remap fixed two callsites; sweep for remaining instances. |
| `uppercase` overlaid on `text-label` | various | Redundant uppercase | acceptable local utility | `text-label`'s `@layer components` rule already applies uppercase. The overlay is a no-op. Cosmetic cleanup. |

---

## Recommended Cleanup Plan

### Safe quick wins

These changes have no visual delta or a tiny, intentional one. Sweep them in a single PR per scope.

1. **Remove redundant `uppercase` modifiers on `text-label`.** No-op visually because the `@layer components` rule already applies it. Files: every callsite paired with `text-label` (a few hundred). Inverse pin via the typography guard. *Risk: zero.*
2. **Remove redundant `font-medium` modifiers on `text-row` / `text-row-emphasis` / `text-section-title`.** Role tokens bake the right weight (500 / 600 / 600). `font-medium` is a no-op when the token already bakes 500; on tokens that bake 600 it's a *reduction* (likely accidental). Audit each match. *Risk: low; needs visual diff on the role-600 tokens.*
3. **Reduce `tracking-wide` overlaid on `text-label` to bare `text-label`.** Every instance is silently flattening tracking from 0.04em to 0.025em. Files: ~12+ in pages. *Risk: zero; restores the canonical tracking.*
4. **Migrate `listResultsClass` from `text-xs text-muted-foreground` to `text-helper text-muted-foreground`.** Single constant in `client/src/components/ui/list-surface.tsx:46`; cascades to every list-page footer at the same pixel size (15.2px → 13px). *Risk: small visible delta — prepare a screenshot diff first.*
5. **Migrate operational modal `text-xs` lines (`-count-badge`, `-close-button`) to canonical tokens.** Two CSS rules in `client/src/index.css`. *Risk: zero (text-xs and text-helper render at very close pixel values on this 19px root).*
6. **Sweep `client/src/components/detail-rail/`** for the ~12 places `<RailContentCardChip>` is consumed and migrate to the canonical `chipVariants` `<Chip>` primitive. Eliminates one of two parallel chip systems. *Risk: low; pin with `tests/rail-card-slots.test.ts`.*

### Needs design decision

7. **Tab-strip label weight (`<DetailRightRail>` vertical tabs).** Currently `text-helper` (13/400 sans, sentence-case). Visually too light against the panel header `text-label` (13/500 UPPERCASE 0.04em). Decision: add `font-medium`, OR add a `text-rail-tab` token, OR leave as-is. Out of scope for Labour-only remap.
8. **Notes card author/date typography.** Currently `text-caption` (14/400) with `font-semibold` inner author name (14/600). Equipment uses `text-helper` (13/400) for the same role. Decision: keep Notes at 14px (heavier visual; signals "this is the entity's own content") OR align with Equipment at 13px. Affects `client/src/components/notes/EntityNotesSection.tsx`.
9. **`text-text-muted` vs. `text-muted-foreground`.** Two muted-foreground tokens with different live HSL values. CLAUDE.md > Phase H1 says "standardize on `text-muted-foreground` going forward"; `list-surface.tsx > listSecondaryClass` still uses `text-text-muted`. Decision: pick one as the canonical, deprecate the other, add a Tailwind config alias if needed for transition.
10. **`--primary` vs. `--brand`.** Same HSL value (`98 37% 51%`). `--primary` is the shadcn alias kept for back-compat. Decision: complete the Phase 6 cleanup (delete `--primary` and migrate shadcn primitives to `--brand`) OR accept the permanent alias. Currently 700+ hits on `bg-primary` / `text-primary-foreground` indirectly through shadcn primitives.
11. **Operational modal hex pinning vs. semantic variables.** `client/src/index.css:430-469` intentionally pins `#e5e7eb` / `#f8fafc` / `#4b5563` / `#f1f5f9` / `#111827` to "default Tailwind grays, NOT this project's custom `gray-*`". Decision: define dedicated `--operational-*` semantic tokens, OR keep the literal pinning permanent and document it as a design intent.
12. **Token contradiction between `text-row-emphasis` and `text-section-title` (both 17/24/600).** The 2026-05-08 recalibration intentionally pixel-aligned them. Decision: live with the shared scale (and let the role names drive intent), OR re-separate by 1px. Affects rail group headings and emphasized row values stacking together.
13. ~~**Token contradiction between `text-row` and `text-table-cell`.**~~ **Resolved 2026-05-08.** Both now 14/20/400. `text-table-cell` synced to current `text-row` — alias is pixel-identical again.
14. **Documentation drift in `docs/UI_TYPOGRAPHY.md`.** The canonical doc still cites `text-section-title: 18/24/600` and `text-row-emphasis: 15/22/500` (pre-2026-05-08 values). Decision: update the doc OR roll back the recalibration.
15. **Legacy ramp removal timing.** `tailwind.config.ts:191-196` keeps `text-xs/-sm/-base/-lg/-xl/-2xl` for back-compat. ~2,300 hits across 200 files. Decision: page-by-page migration cadence vs. flag-day removal vs. tighter lint enforcement before next major version.

### Do not change

- `html { font-size: 19px }` (`client/src/index.css:328`). Intentional; canonical tokens are absolute-px so the non-standard root is neutralized.
- `font-mono` on truly tabular numeric surfaces (e.g. invoice line-item totals, ledger views). The Labour remap dropped `font-mono` from rail surfaces because Labour was the only family-swap on the rail; surfaces where mono is the contractual rendering (financial ledgers, code displays) stay.
- `text-label`'s `@layer components` uppercase rule. Documented as part of the role's identity per `client/src/index.css:369-377` and `tailwind.config.ts:95`.
- `text-table-header` aliasing of `text-label`. Documented intent.
- The `chipVariants` cva inlining of rgba/hex tones. Documented as "preserved verbatim from the pre-canonicalization state; semantic-variable migration is intentionally out of scope" (`client/src/lib/chipVariants.ts:78-85`).
- The 5-level `--shadow-{2xs,xs,sm,md,lg,xl,2xl}` ramp. Each is consumed by a different elevation class; thinning the ramp would force callsites to pick a token.
- Status overdue / upcoming / this-month / unscheduled palette. These are bound to schema lifecycle states and must stay one-to-one with the enum.

---

## Appendix — Token name → consumer count (live)

Approximate counts via grep across `client/src` (case-sensitive class-string match; doesn't catch dynamic `className={cn(...)}` joins, so true counts are slightly higher).

### Canonical typography tokens

| Token | Hits | Top consumers (file count) |
|---|---|---|
| `text-row-emphasis` | ~90 | rail, communications, list pages |
| `text-row` | ~150 | list pages, rail, dashboard |
| `text-caption` | ~120 | list-surface, dashboards, rail |
| `text-helper` | ~140 | rail, communications, ChipVariants, dashboards |
| `text-label` | ~110 | form labels, table headers, metadata blocks |
| `text-section-title` | ~50 | card titles, panel headers, modals |
| `text-page-title` | ~30 | detail pages |
| `text-display` | ~10 | dashboard KPIs |
| `text-subhead` | ~25 | EmptyState, sub-headers |
| `text-body` | ~40 | forms, dialogs |
| `text-form-label` / `-helper` / `-select-label` / `-select-item` | ~30 (combined) | form primitives |
| `text-modal-title` | ~15 | DialogTitle |
| `text-table-header` / `-table-cell` / `-input` / `-email-body` | ~20 (combined) | table primitive, email composer |
| `text-error` / `-empty-state` | ~10 (combined) | FormMessage, empty states |

### Legacy ramp

| Token | Hits across `client/src` |
|---|---|
| `text-xs` | ~1,100 |
| `text-sm` | ~880 |
| `text-base` | ~140 |
| `text-lg` | ~130 |
| `text-xl` | ~50 |
| `text-2xl` | ~13 |
| `text-[Npx]` (arbitrary) | ~446 |

### Color tokens (canonical)

| Token | Hits |
|---|---|
| `text-text-primary` | ~280 |
| `text-text-secondary` | ~190 |
| `text-text-muted` | ~290 |
| `text-text-disabled` | ~40 |
| `text-muted-foreground` | ~650 (shadcn parallel) |
| `text-foreground` | ~120 |
| `text-brand` | ~75 |
| `bg-app-bg` | ~15 |
| `bg-surface` / `surface-subtle` | ~50 (combined) |
| `bg-brand` / `bg-brand-hover` | ~70 |
| `border-default` / `border-strong` | ~80 (combined) |
| `text-success` / `-warning` / `-danger` / `-info` | ~120 (combined) |

---

## Top drift risks (ordered by exposure)

1. **The legacy ramp is the dominant typography surface.** `text-xs` alone has ~1,100 occurrences (vs. ~140 for `text-helper`, the role-token replacement). Until the ramp is removed or aggressively linted, every page that ships forward inherits the drift. Recommendation: enforce the typography guard on at least one new directory per sprint.
2. **`text-[Npx]` arbitrary values.** 446 across 100 files. Each one is a place a designer wanted a specific size and bypassed the role system. Most resolve to ≈11px / ≈12px / ≈13px / ≈14px / ≈18px — already covered by `text-label` / `text-helper` / `text-caption` / `text-section-title`. High value of migration; high count of edits.
3. **`text-muted-foreground` vs. `text-text-muted` parallel tokens.** 650 + 290 hits. Two live tokens for the same role with subtly different HSL. Risk of color drift between Phase H1-migrated surfaces (using `-muted-foreground`) and list pages (still using `-text-muted`) when one is updated and the other isn't.
4. **`font-semibold` / `font-bold` overlaid on canonical role tokens.** ~550 hits combined. The architectural guard forbids this in `client/src/components/{communications,activity-feed,detail-rail}/` but the rest of the app is unscanned. Each one shifts the role token's baked weight.
5. **`docs/UI_TYPOGRAPHY.md` is stale.** Token sizes documented don't match current `tailwind.config.ts` after the 2026-05-08 recalibration. Risk: contributors writing new code read the doc, not the config, and reproduce the pre-recalibration sizes.
6. **List-surface chrome bakes hex literals.** `client/src/components/ui/list-surface.tsx:19,21,38` use `#ffffff` / `#e5e7eb` / `#f8fafc` instead of `bg-surface` / `border-default` / `bg-surface-subtle`. List pages diverge from the canonical surface palette by one indirection.
7. **Operational modal classes bake hex literals.** Documented intent, but the seven `[#hex]` strings in `client/src/index.css:430-469` remain a back-door past the Phase 1 token system if other surfaces copy the pattern.
8. **`--primary` ↔ `--brand` duplicate.** Phase 6 cleanup target documented since 2026-04-29; ~700 indirect consumers via shadcn primitives. Each release that doesn't address it locks in more callsites.
9. **`text-text-muted` survives in `list-surface.tsx > listSecondaryClass` for visual back-compat.** Documented as deliberate, but every list page that consumes `listSecondaryClass` participates in the shadow duplication.
10. **`<RailContentCardChip>` parallel to `chipVariants`.** Two chip systems. `chipVariants` is the documented canonical; `RailContentCardChip` predates it. Migration is purely cosmetic + test pin churn.
