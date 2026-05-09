# Canonical Chip System

Source files:
- `client/src/lib/chipVariants.ts` — cva config + tone palette (single source of truth)
- `client/src/components/ui/chip.tsx` — four primitives
- `tests/chip-canonical.test.ts` — drift-prevention pins

## Primitives

| Primitive | Use case |
|---|---|
| `<StatusChip tone={} \| status={}>` | Job / invoice / quote / lead status pills |
| `<EntityChip entity="job\|invoice\|quote\|maintenance">` | Job numbers, entity references, scope-visibility pills |
| `<FilterChip selected={bool}>` | List-page filter toggles |
| `<Chip>` | Anything else chip-shaped (rare) |

## Sizes

| Size | Height | Use |
|---|---|---|
| `default` | `h-7 px-3` (28px) | New uses: filter chips, entity chips, visibility chips |
| `compact` | `h-6 px-2.5` (24px) | `StatusChip` default (preserves historical `StatusPill` height), dense rail surfaces |

## Tone Palette

All tones defined in `chipVariants.ts` only. Do not encode tones anywhere else.

| Tone | Use |
|---|---|
| `neutral` | Draft, archived, voided, default unselected filter |
| `success` | Paid, won, completed, invoiced, approved |
| `warning` | Partial paid, requires-invoicing, due-soon, overdue, expired |
| `danger` | Cancelled, declined, escalated, on-hold |
| `info` | Scheduled, in-progress, on-route, sent |
| `purple` | Reserved for `quote` entity tone only |
| `active` | Selected `FilterChip` only — brand-fill, NOT a soft tint |

## Status → Tone Mapping

Two authoritative locations:
- `STATUS_TO_CHIP_TONE` in `chipVariants.ts` — keyed on raw lifecycle strings. Used by `<StatusChip status="paid">` directly.
- `getInvoiceStatusMeta` / `getQuoteStatusMeta` / `getJobStatusMeta` / `getLeadStatusMeta` in `lib/statusBadges.ts` — own precedence rules (Past Due > Due Soon > lifecycle) and return `StatusMeta { label, tone }`.

## Standard Usage

```tsx
import { StatusChip, EntityChip, FilterChip } from "@/components/ui/chip";
import { getInvoiceStatusMeta } from "@/lib/statusBadges";

// Status pill
const meta = getInvoiceStatusMeta(invoice.status, invoice.isPastDue, invoice.dueDate);
<StatusChip tone={meta.tone}>{meta.label}</StatusChip>

// Entity chip — clickable job number
<EntityChip entity="job" href={`/jobs/${job.id}`}>{job.jobNumber}</EntityChip>

// Filter chip with count
<FilterChip
  selected={filter === "active"}
  onClick={() => setFilter("active")}
  trailingIcon={<span className="tabular-nums">{count}</span>}
>
  Active
</FilterChip>
```

## What Stays As-Is (back-compat)

- `<Badge>` (shadcn) — kept for non-chip badge uses (counts, role tags) where the visual is genuinely different.
- `<RailContentCardChip>` in `components/detail-rail/RailContentCard.tsx` — dense rail-internal chip (`text-helper px-1.5 py-0.5 rounded`, not the canonical `rounded-full` capsule).
- `<StatusPill>` in `components/ui/status-pill.tsx` — thin re-export of `<StatusChip>` for back-compat. New code should reach for `<StatusChip>` directly.
- `<EntityNumber variant="primary">` — API surface unchanged; internal rendering uses `<EntityChip entity="job">`.
