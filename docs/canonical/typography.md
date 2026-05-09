# Canonical Typography System

Source file: `client/src/components/ui/typography.tsx`
Test guard: `tests/typography-canonical.test.ts`

## Class Constants

Import from `@/components/ui/typography` for `cn()` composition. Never redeclare locally.

| Constant | Value |
|---|---|
| `ENTITY_NAME_CLASS` | `text-row-emphasis truncate` |
| `ENTITY_NAME_LINK_CLASS` | `text-row-emphasis truncate text-brand hover:underline` |
| `ENTITY_META_CLASS` | `text-helper text-muted-foreground truncate` |
| `SECTION_LABEL_CLASS` | `text-label text-muted-foreground` |
| `ENTITY_LINK_CLASS` | `text-brand hover:underline` |

## Component Primitives

| Primitive | Renders as | Use for |
|---|---|---|
| `<EntityName href? children>` | `<Link>` (brand, hover underline) when `href` set; `<span text-foreground>` otherwise | Primary entity identifier |
| `<EntityMeta>` | `<span>` with `ENTITY_META_CLASS` | Secondary metadata line |
| `<SectionLabel>` | Uppercase tracked section header | Section headings (Client / Location / Open Jobs) |
| `<EntityLink href>` | Inline brand-green link | Inline links without entity-name sizing |
| `<EntityRow icon name meta trailing href>` | Stacked composition (name top, meta below, optional icon/trailing) | Composed entity rows in rails/panels |

## Standard Usage

```tsx
import {
  EntityName,
  EntityMeta,
  EntityRow,
  SectionLabel,
} from "@/components/ui/typography";

<SectionLabel>Open Jobs</SectionLabel>

<EntityRow
  icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}
  name="Job #1023"
  meta="Walk-in cooler PM"
  href={`/jobs/${jobId}`}
/>

<EntityName href={`/clients/${customerCompanyId}`}>{client.name}</EntityName>
<EntityMeta>{[address, phone, email].filter(Boolean).join(" · ")}</EntityMeta>
```

## Token Roles

| Token | Size | Use |
|---|---|---|
| `text-helper` | 13px | Dense-secondary in panels and side rails |
| `text-caption` | 14px | Tabular metadata (timestamps in tables, list-page footer rows) |
| `text-row-emphasis` | — | Primary entity name (weight 500 baked in) |
| `text-label` | — | Section headers |

`text-text-muted` — legacy. Survives only in `list-surface.tsx > listSecondaryClass` for back-compat. Not for new code.

## Allowlist Policy

`tests/typography-canonical.test.ts > LEGACY_ALLOWLIST` lists files that fail the strict guard. Each entry has a `TODO(H2)` comment. Adding a new file to the allowlist is a deliberate debt decision. New files in scanned directories are expected to pass the strict guard by default.

## What Stays As-Is

- `<Label>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` — form field primitives, not replaced by EntityName family.
- `listPrimaryClass`, `listHeaderRowClass` in `list-surface.tsx` — back-compat for existing list pages. `listPrimaryClass` derives from `ENTITY_NAME_CLASS`.
- `<MetaRow>` (`components/ui/meta-row.tsx`) — kept for now; migrate in H2.
