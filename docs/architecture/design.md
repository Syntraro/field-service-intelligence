# Design Guidelines

## Principles
- Material Design-inspired component structure.
- Information density matters — contractors need scannable data views.
- Minimize clicks for common workflows (mark job complete, create invoice, etc.).
- Mobile-first responsive design.

## Typography
- Font family: Inter.
- Use canonical role tokens from `tailwind.config.ts`: `text-row`, `text-row-emphasis`, `text-helper`, `text-caption`, `text-label`, `text-section-title`.
- Do not use raw Tailwind size ramp (`text-xs/sm/base/lg/xl/2xl`) in feature components.
- Full system: `docs/canonical/typography.md` and `docs/SEMANTIC_TYPOGRAPHY_SYSTEM.md`.

## Spacing
- Tailwind spacing units: 2, 4, 6, 8 (consistent scale).
- Panel/rail spacing: dense (8px gaps, `text-helper`).

## Colors
- Brand green: `text-brand`, `bg-brand`.
- Semantic color tokens via CSS variables. See `tailwind.config.ts`.
- Chip tones: `docs/canonical/chips.md`.
- Status colors: `lib/statusBadges.ts`.

## Component Hierarchy
- Atomic: `client/src/components/ui/` — primitives, never baked with business logic.
- Composed: `client/src/components/` — composed from primitives, may have domain concerns.
- Pages: `client/src/pages/` — route-level components, own data-fetching.

## Modals
- Taxonomy: `CLAUDE.md > Modal Taxonomy`.
- Width/sizing: domain-wrapper or callsite layer only. Never inside `ModalShell`.

## Full Reference
- `design_guidelines.md` — detailed Material Design rules.
- `docs/SEMANTIC_TOKENS_AUDIT.md` — token audit.
