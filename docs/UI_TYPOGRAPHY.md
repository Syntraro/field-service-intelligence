# UI Typography Standard

Owner: frontend · Last updated: 2026-05-01 (Typography Phase C — sizes bumped to detail-page scale)

> **⚠ Source-of-truth notice (2026-05-08).** Some tables in this document
> reflect the pre-2026-05-08 token sizes (e.g. `text-section-title: 18/24/600`,
> `text-row-emphasis: 15/22/500`). After the 2026-05-08 typography
> recalibration both tokens resolve to **17/24/600**, and `text-row` bakes
> weight 500. The CURRENT source of truth is:
>
> 1. `tailwind.config.ts > theme.extend.fontSize` — the live token definitions.
> 2. `docs/SEMANTIC_TOKENS_AUDIT.md` — the canonical inventory + drift findings.
> 3. `/style-guide/typography` — the visual preview page (admin-only).
>
> If a value here contradicts those, trust those — this doc is being
> rewritten in a follow-up sweep.

## Canonical semantic tokens (2026-05-01 Typography Phase C)

The app exposes 10 named typography tokens via Tailwind utilities. **Use
these by role, not the legacy `text-xs`/`-sm`/`-base`/etc. by size.** Each
token bundles `font-size`, `line-height`, and (where applicable)
`font-weight` and `letter-spacing`. The `text-label` token additionally
applies `text-transform: uppercase` via a `@layer components` rule in
`client/src/index.css`.

> **Phase C size bump (2026-05-01).** Phase A sized tokens against an
> implicit 16px html root, but the project's actual root is 19px. This
> made canonical-token consumers (Job / Invoice list pages, dashboards)
> read visibly smaller than legacy-class consumers (`text-xs` /
> `text-3xl` on `InvoiceDetailPage`'s header). Phase C raises every
> token by ~15-18% so legacy consumers can migrate to canonical with
> near-zero visible delta and existing canonical consumers
> automatically scale up to the correct detail-page scale. Token names
> and tuple shape are unchanged. See CHANGELOG entry for the full
> before/after table.

### Headings

| Utility | Size / line-height / weight | Use for |
|---|---|---|
| `text-display` | 32 / 40 / 700 | Single biggest visible value on a page (totals, KPI emphasis). Rare. |
| `text-page-title` | 30 / 36 / 700 | h1 for a detail page (Job, Invoice, Quote, PM). One per page. |
| `text-section-title` | 18 / 24 / 600 | h2 for a card / panel / modal. **CardTitle defaults to this.** |
| `text-subhead` | 16 / 22 / 500 | h3 for groups inside a card; table sub-headers. |

### Body / row

| Utility | Size / line-height / weight | Use for |
|---|---|---|
| `text-body` | 15 / 22 / 400 | Default reading text — forms, dialogs, prose, descriptions. |
| `text-row` | 15 / 22 / 400 | Default table / list row content. |
| `text-row-emphasis` | 15 / 22 / 500 | Primary identifier in a row (entity name, the "first column"). |

### Small text

| Utility | Size / line-height / weight | Use for |
|---|---|---|
| `text-caption` | 14 / 20 / 400 | Secondary text alongside row content (timestamps, sub-amounts, technician name). **CardDescription defaults to this.** |
| `text-label` | 13 / 16 / 500 / `tracking-[0.04em]` / `uppercase` | Form field labels, table column headers, metadata keys ("BILL TO", "ISSUED"). |
| `text-helper` | 13 / 16 / 400 | Tooltip body, hint text, "?" popover content, footnotes. |

### Compositional utilities

- **Color** comes from the canonical color tokens (color Phase 1 / 2.7):
  pair size with `text-text-primary` / `text-text-secondary` /
  `text-text-muted` / `text-text-disabled`, or with `text-success` /
  `-warning` / `-danger` / `-info` for state.
- **Numeric / mono** money fields: append `tabular-nums font-mono` to
  any size token.
- **Override** any bundled property by adding the explicit utility:
  `<span className="text-row font-semibold">` overrides the default
  weight (400) with semibold (600).

### Why these specific sizes

Each px value maps onto a size already in widespread use across the
codebase via `text-[NNpx]` arbitrary classes (see the 2026-04-29
typography audit). The semantic tokens formalize the de facto scale —
they don't introduce new sizes. The migration from `text-[Npx]` to a
named token is therefore a pure renaming, not a visual change, in
~95% of cases.

The pixel values are absolute (not rem) so the rendered size is
predictable regardless of the (non-standard 19px) html root font-size.
Pre-Phase-A typography reasoning had to compensate for the 19px root in
every consumer; the new tokens neutralize this.

## CardTitle and CardDescription defaults (2026-04-29 Typography Phase B)

`client/src/components/ui/card.tsx` was updated:

| Slot | Was | Now |
|---|---|---|
| `CardTitle` | `text-2xl font-semibold leading-none tracking-tight` (28.5px on the 19px root) | `text-section-title` (16 / 22 / 600) |
| `CardDescription` | `text-sm text-muted-foreground` (17.1px, legacy shadcn color) | `text-caption text-text-muted` (12 / 16, canonical text-muted token) |

Pages that override the default with their own `className` (most pages)
are unchanged because the override className still wins via `cn()`.
Pages that did NOT override (~30 admin / settings / auth pages) now
render at the new canonical sizes — see CHANGELOG entry for the audit
list of impacted consumers.

## Legacy ramp (deprecated — retained for backward compat)

The pre-existing Tailwind size scale stays available so consumers can
migrate at their own cadence. **All new code should use the semantic
tokens above.** Legacy classes will be removed in a future Phase H lint
sweep once consumers have migrated.

| Legacy | Renders at (19px html root) | Migration target |
|---|---|---|
| `text-xs` | 15.2px / 22.8px line-height | `text-caption` (closest) or `text-label` (if uppercase metadata) |
| `text-sm` | 17.1px / 24.7px | `text-body` (forms) or `text-row` (lists/tables) |
| `text-base` | 19px / 28.5px | `text-body` (forms) or `text-section-title` (titles) |
| `text-lg` | 21.4px / 30.4px | `text-page-title` |
| `text-xl` | 23.8px / 33.3px | `text-page-title` (slightly bigger) |
| `text-2xl` | 28.5px / 38px | `text-display` (rare emphasis) or `text-page-title` |

> **Note on the previous standard ("default body = `text-xs`"):**
> Superseded. The Phase A tokens express role explicitly; pages should
> render `<span className="text-row text-text-muted">` (or similar)
> instead of relying on a global `text-xs` default. The 19px root
> mismatch that caused the "default = text-xs" rule to misfire is
> neutralized by the new px-based tokens.

---

## Pre-Phase-A guidance (historical — kept for context)


## Default body font size

**12px — Tailwind `text-xs`**

All standard UI body text defaults to `text-xs`. Larger sizes must be
intentional (headers, emphasis values).

## What counts as "body text"

| Surface | Default class |
|---|---|
| Table rows (`<td>`, `<th>` content) | `text-xs` |
| List / card rows | `text-xs` |
| Dashboard row content | `text-xs` |
| Form inputs (`<input>`, `<textarea>`, `<select>`, combobox) | `text-xs` |
| Placeholders | `text-xs` |
| Dropdown / select items | `text-xs` |
| Modal / dialog body text | `text-xs` |
| Secondary labels + metadata | `text-xs` |

## What does NOT default to `text-xs`

- Headers `h1`–`h4` (handled by `@layer base` in `client/src/index.css`).
- Section / card titles (usually `text-sm` or `text-base` with `font-semibold`).
- Emphasized values intentionally larger (grand totals, stat chips, page titles).
- Typography you *explicitly* choose to bump for hierarchy reasons.

## Canonical font-family

`client/src/index.css:88` defines:
```
--font-sans: "Inter", "SF Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```
`body { font-family: var(--font-sans); }` inherits to the whole app, and
`tailwind.config.ts` maps `font-sans` to the same variable. All body text is
Inter-first by inheritance — do not add explicit `font-family` on components.

## Rules for writing new components

1. If you're adding a new shared primitive and it renders body text, its
   default class list should include `text-xs`. Let consumers override via
   a `className` prop passed through `cn(...)`.
2. If you're writing a new page surface (table row, form field, etc.),
   don't bump to `text-sm` or higher without a documented hierarchy reason.
3. Don't set `text-base` (16px) for body text. `text-base` is reserved for
   page-level body prose, not UI chrome.
4. Don't set `font-family` on elements — inherit from body.

## Rules for modifying existing components

- Mutating a shared primitive's default class (e.g. adding `text-xs` to
  `Input`) is a **global change** because every consumer inherits it.
  Treat it like a visual redesign: scoped, reviewed, and shipped with a
  sweep of the downstream consumers that relied on the larger default.
- Prefer fixing the page first (scope the `text-xs` locally), then
  migrate the primitive once every major consumer has caught up.

## Enforcement

- Inline comment guardrails live at the top of each shared primitive
  file (`input.tsx`, `select.tsx`, `textarea.tsx`, `table.tsx`, etc.)
  so reviewers see the standard before changing the default class list.
- No automatic lint rule today. If we add one, it belongs here as a
  Tailwind `safelist` check in `tailwind.config.ts` plus a codemod to
  flag `text-sm` in `<td>` / `<input>` usages.

## Current state (audit as of 2026-04-13)

Read-only sweep — no fixes applied. **889 `text-sm` occurrences across
157 files.** This is the existing baseline and is intentionally not
migrated as part of this standards doc.

### Highest-density users of `text-sm` (≥10 occurrences)

These are not bugs, just the most concentrated places to consider when
the surrounding page is next touched.

| File | `text-sm` count |
|---|---|
| `client/src/tech-app/pages/VisitDetailPage.tsx` | 44 |
| `client/src/pages/QboConsolePage.tsx` | 42 |
| `client/src/pages/InvoiceDetailPage.tsx` | 39 |
| `client/src/pages/AdminTenantDetail.tsx` | 32 |
| `client/src/pages/PMWorkspacePage.tsx` | 28 |
| `client/src/pages/PMDetailPage.tsx` | 26 |
| `client/src/pages/PayrollPage.tsx` | 20 |
| `client/src/pages/QuoteDetailPage.tsx` | 19 |
| `client/src/tech-app/pages/TimesheetPage.tsx` | 19 |
| `client/src/pages/PMWizardPage.tsx` | 16 |
| `client/src/components/time/TimeEntryModal.tsx` | 14 |
| `client/src/pages/SettingsPage.tsx` | 14 |
| `client/src/pages/portal/PortalInvoiceDetail.tsx` | 14 |
| `client/src/pages/ClientImportPage.tsx` | 14 |
| `client/src/pages/TeamMemberDetail.tsx` | 13 |
| `client/src/pages/SubscriptionSettings.tsx` | 12 |
| `client/src/pages/JobDetailPage.tsx` | 11 |
| `client/src/pages/TaxBillingRulesPage.tsx` | 11 |
| `client/src/pages/LeadDetailPage.tsx` | 11 |
| `client/src/pages/Jobs.tsx` | 10 |
| `client/src/pages/JobImportPage.tsx` | 10 |
| `client/src/tech-app/pages/TaskDetailPage.tsx` | 10 |
| `client/src/pages/TimeBillingRulesPage.tsx` | 10 |

### Shared primitives still defaulting > `text-xs`

These are the highest-leverage changes if/when the team is ready to
flip defaults. Each one cascades to many consumers — change with a
sweep, not in isolation.

| Primitive | Default text size today | Comment guardrail in place |
|---|---|---|
| `client/src/components/ui/input.tsx` | `text-base md:text-sm` | yes |
| `client/src/components/ui/textarea.tsx` | `text-base md:text-sm` | yes |
| `client/src/components/ui/select.tsx` (trigger) | `text-sm` | yes |
| `client/src/components/ui/table.tsx` | `text-sm` | yes |
| `client/src/components/ui/dialog.tsx` (description) | `text-sm` | yes |
| `client/src/components/ui/dropdown-menu.tsx` | `text-sm` | none yet |
| `client/src/components/ui/command.tsx` | `text-sm` | none yet |
| `client/src/components/ui/sidebar.tsx` | `text-sm` (multiple) | none yet |

### Method
`grep -rn "text-sm" client/src` (case-sensitive). Only counts class
literals; does not catch dynamic class joins or className utility
helpers, so the true count is somewhat higher. Treat as a directional
baseline, not a strict tally.
