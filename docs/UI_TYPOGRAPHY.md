# UI Typography Standard

Owner: frontend · Last updated: 2026-04-13

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
