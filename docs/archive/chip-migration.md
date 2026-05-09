# Chip Canonicalization — Migration History

## Background

Pre-canonicalization, the codebase shipped at least four parallel chip-shaped surfaces:
- `Badge` (shadcn)
- `StatusPill` (`components/ui/status-pill.tsx`)
- `RailContentCardChip` (in `components/detail-rail/RailContentCard.tsx`)
- `EntityNumber`'s blue pill (in `EntityNumber` component)
- A one-off `FilterChips` generic in `ClientDetailPage`

Each encoded its own tone palette inline (ad-hoc color triplets, hardcoded classes).

**Solution:** Consolidated onto a single cva config in `client/src/lib/chipVariants.ts` and four canonical primitives in `client/src/components/ui/chip.tsx`.

## Migration Phases

### Phase 1 — Primitives + Initial Migrations
- Created `chipVariants.ts` (cva config + 7-tone palette).
- Created `chip.tsx` (Chip, StatusChip, EntityChip, FilterChip).
- Created `tests/chip-canonical.test.ts`.
- Migrated surfaces:
  - `StatusPill` → thin re-export of `StatusChip`
  - `EntityNumber` primary variant → renders as `<EntityChip entity="job">`
  - `ClientDetailPage > FilterChips` → canonical `FilterChip`
  - `NotesPanel` Jobs/Invoices/Quotes visibility pills → `EntityChip`

### Phase 2 — Planned (not scheduled)
- `InvoiceDetailPage` local uppercase-tracked StatusPill (deliberate variant — needs design alignment).
- `Jobs.tsx` StatusBadge call-sites (tonal shift to canonical desired).
- 47+ ad-hoc `rounded-full px-2 py-0.5` spans across pages and feature components.

### Phase 3 — Token Cleanup (planned)
- Migrate soft-tint RGB literals in `chipVariants.ts` to `hsl(var(--success) / 0.12)` etc. so chip tones inherit from semantic CSS variables.

## Back-Compat Surfaces

- `<Badge>` (shadcn) — kept for non-chip uses (counts, role tags) where the visual is genuinely different.
- `<RailContentCardChip>` — kept as the dense rail-internal chip (`text-helper px-1.5 py-0.5 rounded`, NOT `rounded-full`). Its visibility-pill use in NotesPanel migrated to `<EntityChip>`.
- `<StatusPill>` — thin re-export. 14+ call-sites continue to work; new code should reach for `<StatusChip>` directly.
- `<EntityNumber variant="primary">` — API surface unchanged; internal rendering migrated to `<EntityChip>`.
