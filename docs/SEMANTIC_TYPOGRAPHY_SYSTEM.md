# Semantic Typography System

> **Source of truth for typography in this app.**
> Owner: frontend · Last updated: 2026-05-08 (Phase S1 — simplified visual-hierarchy tokens)

## Purpose

The app's typography vocabulary is **role-based**, not component-based. A token's name describes its visual role on the page, not where it happens to render. This is the document that defines that vocabulary.

For the visual reference, see `/style-guide/typography` (admin-only). For the audit + drift inventory, see `docs/SEMANTIC_TOKENS_AUDIT.md`.

## Preferred token set (use these)

| Token | Size / line-height / weight | Use for |
|---|---|---|
| `text-display` | 32 / 40 / 700 | Single biggest visible value on a page (totals, KPI hero). Rare. |
| `text-title` | 30 / 36 / 700 | Page title (h1). One per page. |
| `text-header` | 18 / 24 / 600 | Card / panel / modal title (h2). `CardTitle` defaults here. |
| `text-subheader` | 16 / 22 / 500 | Sub-grouping inside a card (h3); table sub-headers. |
| `text-body` | 15 / 22 / 400 | Default reading text — forms, dialogs, prose, descriptions. |
| `text-row` | 14 / 20 / 400 | Default table / list row content. Distinct role identity from `text-body` (15px) — list/row callsites. |
| `text-emphasis` | 15 / 22 / 500 | Emphasized row value / primary entity name. |
| `text-caption` | 14 / 20 / 400 | Secondary text alongside row content (timestamps, sub-amounts). `CardDescription` defaults here. |
| `text-label` | 13 / 16 / 500 / 0.04em / UPPERCASE (via @layer) | Form field labels, table column headers, metadata keys, eyebrows. |
| `text-helper` | 13 / 16 / 400 | Tooltip body, hint text, footnotes; rail/panel dense-secondary. |
| `text-error` | ≈15.2 / 1.2rem / 500 | Form validation error text. Pair with `text-destructive` for color. |
| `text-nav-compact` | 12 / 14 / 500 · no uppercase · no tracking | **Specialized compact-navigation semantic.** Constrained-width vertical nav strips (right rail tab labels). Not for general use — reach for `text-helper` or `text-label` for other surfaces. |

These are the **only** tokens new code should reach for. The drift guard (`tests/semantic-typography-guard.test.ts`) blocks new usage of every other typography utility.

## Usage table

| Role | Preferred token |
|---|---|
| Page title (h1) | `text-title` |
| Modal title | `text-header` |
| Card title | `text-header` |
| Section title (sub-grouping inside a card) | `text-subheader` |
| Row primary text | `text-row` |
| Emphasized value (entity name, headline value) | `text-emphasis` |
| Body paragraph | `text-body` |
| Secondary / meta text | `text-caption` |
| Eyebrow / field label / metadata key | `text-label` |
| Help text / footnote / dense secondary | `text-helper` |
| Error text (form validation) | `text-error` |

## Compositional utilities

- **Color** comes from canonical color tokens. Pair size with `text-text-primary` / `text-text-secondary` / `text-text-muted` / `text-text-disabled`, or `text-success` / `-warning` / `-danger` / `-info`. For rails / panels / Phase H1 surfaces, prefer `text-muted-foreground` (audit pending alignment with `text-text-muted`).
- **Numeric / mono** money fields: append `tabular-nums`. Reserve `font-mono` for ledgers / code; rails and panels render in sans-serif.
- **Override:** any bundled property can be overridden via the explicit utility — `<span className="text-row font-semibold">` overrides the default 400 weight with semibold. Use sparingly; role tokens already bake the right weight.

## Deprecated aliases

These component-specific tokens are retained in `tailwind.config.ts` so existing consumers render unchanged. **Do NOT introduce new usages.** The drift guard blocks new occurrences.

| Deprecated | Maps to | Mapping quality | Note |
|---|---|---|---|
| `text-page-title` | `text-title` | exact | Safe rename. Identical 30/36/700 spec. |
| `text-section-title` | `text-header` | exact | Safe rename. Identical 18/24/600 spec. |
| `text-subhead` | `text-subheader` | exact | Safe rename. Identical 16/22/500 spec. |
| `text-modal-title` | `text-header` | imperfect | Held — modal-title is ~21.4px, text-header is 18px. Picking text-header would shrink dialog titles. Decide when modernizing the dialog system. |
| `text-row-emphasis` | `text-emphasis` | exact | Safe rename. Identical 15/22/500 spec. |
| `text-table-header` | `text-label` | exact | Safe rename. Identical 13/16/500/0.04em + UPPERCASE. |
| `text-table-cell` | `text-row` | exact | Synced to 14/20/400 (2026-05-08). Safe rename — pixel-identical. |
| `text-input` | `text-body` | exact | Safe rename. Identical 15/22/400 spec. |
| `text-email-body` | `text-body` | exact | Safe rename. Identical 15/22/400 spec. |
| `text-empty-state` | `text-body` | imperfect | Held — slightly bigger (15.2 vs 15) and slightly taller line-height (≈22.8 vs 22). Visual call between text-body and text-caption. |
| `text-form-label` | `text-label` | imperfect | Held — text-label is 13px UPPERCASE 0.04em; text-form-label is 15.2px sentence-case. Different role identity. Migrating would change both size and case. |
| `text-form-helper` | `text-helper` | imperfect | Held — same role family but different size (15.2 vs 13). |
| `text-select-label` | `text-label` | imperfect | Held — different size + case + weight from text-label. Migrate when modernizing the Select primitive. |
| `text-select-item` | `text-row` | imperfect | Held — 15.2px sits 1.2px above text-row (14) and text-caption (14), both now at 14px. Pick when migrating the Select primitive. |

## Migration rules

1. **Don't rename in bulk.** Aliases are not removed; their values stay frozen. New code uses the preferred set; old code migrates page-by-page when the surrounding file is touched.
2. **Exact mappings are safe to swap** (no visual delta). When migrating an exact-mapping alias, you may rewrite the entire file in one edit.
3. **Imperfect mappings need a design decision** before migration. The deprecated alias keeps its current value; the page renders unchanged. Holding is the default state — do not migrate imperfect aliases without a paired visual review and explicit sign-off.
4. **After a migration sweep**, re-run `node scripts/scan-typography-baseline.mjs` and commit the updated `tests/semantic-typography-baseline.json` so the drift guard's floor is lowered to the new state.
5. **Never introduce new aliases.** If a future surface needs a typography role that doesn't fit the preferred set, propose a name addition to *this* document first; do NOT define a component-specific alias.

## Drift guard

`tests/semantic-typography-guard.test.ts` enforces:

- **Legacy size ramp** — `text-xs / -sm / -base / -lg / -xl / -2xl / -3xl / -4xl`. Per-file count must not increase; new files must have zero.
- **Arbitrary text values** — `text-[Npx]`, `text-[1.125rem]`, `text-[#hex]`. Same baseline rules.
- **Deprecated aliases** — the 14 component-specific tokens listed above. Same baseline rules.

Allowlist: `client/src/pages/StyleGuideTypographyPage.tsx` and `client/src/components/ui/typography.tsx` (the canonical typography primitive module).

Failure message points contributors at the visual reference page and this document.

## Visual reference

`/style-guide/typography` (admin-only via `requireAdmin`). Linked from `Settings > Advanced > Typography Style Guide`.

The page renders every preferred token + every deprecated alias against a shared sample set so contributors can compare scale / weight / tracking by eye. Includes:

- Usage guidance + role → preferred-token table.
- Preferred typography tokens (visual samples + specs + intended use).
- Deprecated aliases (mapping target + quality badge + migration note).
- Legacy ramp (deprecated, retained for back-compat).
- Raw weight overlay preview (diagnostic).
- Numbers and tabular alignment.

The page is **printable / exportable as PDF** directly from the browser. Click the "Print / Save PDF" button in the header, then choose "Save as PDF" in the print dialog. The print pipeline preserves the live semantic tokens — there is no synthetic PDF generator. Page-break optimization keeps each token row on a single page; the screen-only header is replaced by a dedicated print header reading "FSI / Syntraro Semantic Typography Reference".

Recommended print settings: Landscape OFF · Background graphics ON · Margins: Default or Minimum · Scale: 100%.

## Related documents

- `docs/SEMANTIC_TOKENS_AUDIT.md` — full inventory + drift findings (audit-only).
- `docs/UI_TYPOGRAPHY.md` — historical typography standards (superseded by this document; pre-Phase-S1 sections are kept for context only).
- `tailwind.config.ts > theme.extend.fontSize` — live token definitions.
- `client/src/components/ui/typography.tsx` — compositional primitives (`<EntityName>`, `<EntityMeta>`, `<SectionLabel>`, `<EntityLink>`, `<EntityRow>`).
