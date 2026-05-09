# Typography Canonicalization — Migration History

## Background (Phase H1)

The typography token system in `tailwind.config.ts` defines real Tailwind utility classes (`text-row`, `text-row-emphasis`, `text-helper`, `text-caption`, `text-label`, `text-section-title`, etc.).

**The drift problem had three causes:**
1. Canonical class strings were re-derived per file (`PRIMARY_VALUE_CLASS`, `LINK_CLASS`).
2. The pre-existing constant library lived under `list-surface.tsx > listPrimaryClass`, named for list pages — detail panels never reached for it.
3. Source-pin tests asserted *presence* of the canonical token, not architectural composition — a file could import the right token AND fork it locally.

**Solution:** Canonical layer at `client/src/components/ui/typography.tsx`. Test guard: `tests/typography-canonical.test.ts`.

## Allowlist Policy

`tests/typography-canonical.test.ts > LEGACY_ALLOWLIST` lists files that fail the strict guard today. Each entry has a `TODO(H2)` migration target. Adding a new file to the allowlist is a deliberate debt decision — the entry documents the debt. New files in scanned directories are expected to pass the strict guard by default.

## Phase H2 — Planned Migrations

- Migrate list-page consumers (`listPrimaryClass`, `listHeaderRowClass`) from `list-surface.tsx` to use `<EntityName>` / `<EntityMeta>` component primitives directly.
- Migrate `<MetaRow>` (`components/ui/meta-row.tsx`) to use typography primitives.
- Clear the `LEGACY_ALLOWLIST` entries with `TODO(H2)` comments one by one.

## Back-Compat Notes

- `listPrimaryClass` and `listHeaderRowClass` still ship from `list-surface.tsx` for back-compat with existing list pages. `listPrimaryClass` derives from `ENTITY_NAME_CLASS` where values match.
- `<Label>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` — form field primitives are NOT replaced by the EntityName family. Feature components inside a form still use form primitives.
- `<MetaRow>` (`components/ui/meta-row.tsx`) — kept until Phase H2.
- `text-text-muted` — survives only inside `list-surface.tsx > listSecondaryClass` for visual back-compat. Not for new code.
