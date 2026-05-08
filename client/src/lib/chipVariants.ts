/**
 * Canonical chip/pill variants (2026-05-08).
 *
 * SINGLE source of truth for the visual contract of every chip-shaped
 * surface in the app: status pills (job/invoice/quote), entity chips
 * (job number, notes-visibility scope), and filter chips (selectable
 * toggles on list pages).
 *
 * Why this file exists
 * --------------------
 * Pre-canonicalization the app shipped at least four parallel chip
 * primitives — `Badge` (shadcn, `rounded-md`), `StatusPill`
 * (rounded-full, 24px, 5-tone), `RailContentCardChip` (dense rail
 * 13px), the `EntityNumber` "primary" pill (blue `rounded-md`), plus
 * a one-off `FilterChips` generic in `ClientDetailPage`. Each
 * encoded its own tone palette inline, so the same "info" color
 * existed in 4 incompatible class strings.
 *
 * Goal: route every chip through ONE cva config so:
 *   - tone colors live in one place,
 *   - typography/height/padding/radius are locked at the primitive,
 *   - migrations swap the wrapper but keep the call-site simple,
 *   - drift tests can pin the contract instead of chasing palettes
 *     across 47 ad-hoc files.
 *
 * Visual baseline (preserved from existing surfaces — NOT a redesign)
 * ------------------------------------------------------------------
 *   - Capsule shape (rounded-full).
 *   - Default size 28px (h-7) for new uses (filter chips, entity
 *     chips, notes visibility) — matches the slightly larger filter
 *     chip the design system targets.
 *   - Compact size 24px (h-6) for back-compat with the existing
 *     `StatusPill` rendering, plus dense surfaces (rail panels).
 *   - Soft tints with matching border (the StatusPill aesthetic),
 *     NOT solid bold badges.
 *   - Typography: `text-helper` (13px / 500) — the canonical
 *     dense-secondary token. Avoids the legacy `text-xs` size ramp
 *     per CLAUDE.md "Phase H1: Typography Primitives" guidance.
 *
 * Tones
 * -----
 * **Status tones** (5-tone vocabulary shared with `StatusTone` in
 * `lib/statusBadges.ts` — every job/invoice/quote/lead status maps
 * here):
 *   - `neutral` — slate. Inert (draft, archived, voided).
 *   - `success` — emerald. Terminal-good (paid, won, completed).
 *   - `warning` — amber. Needs-action (partial paid, requires-invoicing).
 *   - `danger`  — rose. Bad/blocked (overdue, declined, cancelled).
 *   - `info`    — blue. Pending/in-flight (sent, scheduled, in-progress).
 *
 * **Entity tones** for cross-entity reference chips (job number, notes-
 * scope chips). Distinct from status tones because an entity chip
 * communicates "this references a Job" not "this thing has succeeded":
 *   - `job`         — blue (reuses the info palette; matches the
 *                     existing blue `EntityNumber` job-number pill).
 *   - `invoice`     — emerald (reuses success).
 *   - `quote`       — purple (the only canonical purple tone in the
 *                     palette; matches the existing `RailContentCardChip`
 *                     "Quotes" visibility chip).
 *   - `maintenance` — amber (reuses warning, signals attention).
 *   - `default`     — neutral.
 *
 * **Active** — used by `FilterChip` for the selected state. Solid
 * brand fill, NOT a soft tint. (Matches the existing `bg-[#76B054]
 * text-white` selected pill in `ClientDetailPage > FilterChips`.)
 *
 * What NOT to do
 * --------------
 * - Do NOT add ad-hoc `rounded-full px-2 py-0.5 text-xs` chips in
 *   page components. Use one of the four primitives in `chip.tsx`.
 * - Do NOT layer extra background/text utilities at the call-site to
 *   restyle a chip. If a tone is missing, add it here so every
 *   surface inherits it.
 * - Do NOT bake `font-bold` / `font-semibold` overrides on top of
 *   `text-helper` — the role token already locks the weight (500).
 *
 * Color baseline note
 * -------------------
 * The class strings below replicate the existing `StatusPill` RGB
 * tints verbatim (e.g. `bg-[rgba(34,197,94,0.12)]`) so the
 * canonicalization pass stays visually identical to the pre-migration
 * state. Migrating these to semantic CSS variables
 * (`hsl(var(--success) / 0.12)` etc.) is a follow-up token-cleanup
 * step that's intentionally out of scope here.
 */
import { cva, type VariantProps } from "class-variance-authority";

// ─── Tone classes — single source of truth ────────────────────────

/**
 * Soft-tint palette per status tone. Re-uses the exact RGB values
 * `client/src/components/ui/status-pill.tsx` was using before the
 * canonicalization pass, so consumers see no visual diff.
 */
const TONE_NEUTRAL =
  "bg-[#f8fafc] text-[#4b5563] border-[#e5e7eb] " +
  "dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";

const TONE_SUCCESS =
  "bg-[rgba(34,197,94,0.12)] text-[#16a34a] border-[rgba(34,197,94,0.25)] " +
  "dark:bg-green-950/40 dark:text-green-400 dark:border-green-800";

const TONE_WARNING =
  "bg-[rgba(245,158,11,0.14)] text-[#92400E] border-[rgba(245,158,11,0.28)] " +
  "dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800";

const TONE_DANGER =
  "bg-[rgba(220,38,38,0.12)] text-[#B91C1C] border-[rgba(220,38,38,0.25)] " +
  "dark:bg-red-950/40 dark:text-red-400 dark:border-red-800";

const TONE_INFO =
  "bg-[rgba(59,130,246,0.12)] text-[#1D4ED8] border-[rgba(59,130,246,0.25)] " +
  "dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800";

/** Purple tone — only used for the "Quote" entity chip. Matches the
 *  existing `RailContentCardChip variant="purple"`. */
const TONE_PURPLE =
  "bg-purple-50 text-purple-700 border-purple-100 " +
  "dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900";

/** Active = selected filter. Solid brand fill (not a tint). Matches
 *  the existing `bg-[#76B054]` selected pill in ClientDetailPage. */
const TONE_ACTIVE = "bg-brand text-white border-transparent";

// ─── Public canonical type ────────────────────────────────────────

/**
 * Canonical chip tones. Status tones (5) + entity-specific extensions
 * (purple, brand-active). Mapping helpers (status → tone) live in the
 * `*Meta` helpers in `lib/statusBadges.ts` and in `STATUS_TO_CHIP_TONE`
 * below.
 */
export type ChipTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple"
  | "active";

// ─── cva config ───────────────────────────────────────────────────

/**
 * Canonical chip cva. Every chip-shaped element in the app composes
 * from this base.
 *
 * Variants
 * --------
 *   - **tone** — semantic palette (see {@link ChipTone}).
 *   - **size** — `default` (28px tall, 12px h-pad) / `compact` (24px
 *     tall, 10px h-pad). Compact is the StatusPill back-compat
 *     dimension.
 *   - **variant** — `subtle` (default — soft tint with border, the
 *     StatusPill aesthetic) / `solid` (brand-fill, used by `active`)
 *     / `outline` (transparent fill, just the colored border + text).
 *   - **interactive** — when `true`, adds hover bg-shift, cursor, and
 *     focus-visible ring. `Chip` flips this on automatically when
 *     rendered as a `<button>`. `StatusChip` keeps it `false`.
 *   - **selected** — `FilterChip`-specific. Together with
 *     `interactive: true` the selected pill becomes solid brand.
 *
 * The base string locks the geometric/typographic contract:
 *   - capsule (`rounded-full`),
 *   - inline-flex layout with icon-friendly gap-1.5,
 *   - `text-helper` (13px / 500) typography token,
 *   - `whitespace-nowrap` (chips never wrap),
 *   - `transition-colors` for hover/selected swaps,
 *   - `disabled:opacity-50 disabled:pointer-events-none` for
 *     interactive variants,
 *   - `focus-visible:ring-2 focus-visible:ring-ring
 *     focus-visible:ring-offset-2` for keyboard accessibility.
 */
export const chipVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "whitespace-nowrap leading-none",
    "rounded-full border",
    "text-helper font-medium",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    "disabled:opacity-50 disabled:pointer-events-none",
  ].join(" "),
  {
    variants: {
      tone: {
        neutral: TONE_NEUTRAL,
        success: TONE_SUCCESS,
        warning: TONE_WARNING,
        danger: TONE_DANGER,
        info: TONE_INFO,
        purple: TONE_PURPLE,
        active: TONE_ACTIVE,
      },
      size: {
        // Default — 28px capsule. New surfaces (filter chips, entity
        // chips, notes-visibility chips) target this size.
        default: "h-7 px-3",
        // Compact — 24px capsule. Back-compat with the existing
        // `StatusPill` rendering. Use this for status pills and
        // dense rail-panel chips.
        compact: "h-6 px-2.5",
      },
      variant: {
        // Soft tint + matching border. Default for status / entity
        // chips. The actual color comes from the `tone` variant.
        subtle: "",
        // Transparent fill, just the colored border + text. For
        // outline-style filter chip "unselected" or low-emphasis
        // entity references.
        outline: "bg-transparent",
        // Solid fill. Mostly used via `tone: "active"` on selected
        // filter chips. Marked here so cva can compose it cleanly.
        solid: "",
      },
      interactive: {
        // Locks the cursor + hover lift on top of the tone class.
        // `StatusChip` (display-only) sets this to false; `EntityChip`
        // and `FilterChip` set it to true via their wrappers.
        true: "cursor-pointer hover:brightness-95 active:brightness-90",
        false: "",
      },
      selected: {
        // No-op on its own; combined with `interactive: true` and the
        // `active` tone via the FilterChip wrapper.
        true: "",
        false: "",
      },
    },
    // 2026-05-08 chip Phase 3a: compound variants pair each semantic
    // tone with the `solid` variant so `<FilterChip selectedTone={...}>`
    // can render saturated brand-fill / danger-fill / etc. when
    // selected. The pre-Phase-3a `solid` slot was an empty
    // placeholder that only `tone: "active"` reached for via the
    // hardcoded `TONE_ACTIVE` (`bg-brand text-white`). Now every
    // semantic tone has a matching solid form.
    //
    // Token-gap note (mandatory — see CHANGELOG):
    //   `success` / `warning` / `info` are flat semantic tokens —
    //   they do NOT have paired `-foreground` companions like
    //   `destructive` does. The four solid rules below intentionally
    //   compose with EXISTING tokens only:
    //     - danger  → aliases `destructive` (the only paired tone in
    //                 the system). The visual matches the canonical
    //                 destructive Button shadcn ships.
    //     - info / success → `text-white` mirrors the canonical
    //                 brand-active solid (`TONE_ACTIVE` =
    //                 `bg-brand text-white`). The two HSL hues
    //                 (#2563EB info, #16A34A success) carry sufficient
    //                 contrast against white for chip-sized labels.
    //     - warning → `text-foreground` (NOT `text-white`). The
    //                 amber `--warning` (#F59E0B) is high-luminance;
    //                 white-on-amber fails WCAG contrast at compact
    //                 chip sizes. Foreground (the canonical body
    //                 text color, near-black) reads cleanly.
    //   Do NOT invent `--success-foreground` / `--warning-foreground`
    //   / `--info-foreground` to "fix" this — that's a separate
    //   token-system PR that needs its own design review.
    //
    // The `neutral` / `purple` / `active` solid slots are left to
    // their tone class (TONE_NEUTRAL / TONE_PURPLE) or `TONE_ACTIVE`
    // respectively — `active` already encodes its solid via
    // `bg-brand text-white border-transparent`, and the other two
    // don't have a documented "solid emphasis" use case yet.
    compoundVariants: [
      {
        tone: "danger",
        variant: "solid",
        className: "bg-destructive text-destructive-foreground border-transparent",
      },
      {
        tone: "info",
        variant: "solid",
        className: "bg-info text-white border-transparent",
      },
      {
        tone: "success",
        variant: "solid",
        className: "bg-success text-white border-transparent",
      },
      {
        tone: "warning",
        variant: "solid",
        className: "bg-warning text-foreground border-transparent",
      },
    ],
    defaultVariants: {
      tone: "neutral",
      size: "default",
      variant: "subtle",
      interactive: false,
      selected: false,
    },
  },
);

export type ChipVariantProps = VariantProps<typeof chipVariants>;

// ─── Status → tone map ────────────────────────────────────────────

/**
 * Canonical status-string → chip tone map. Mirrors the precedence
 * baked into `statusToVariant` in the legacy `status-pill.tsx`
 * (preserved verbatim) and lines up with the per-entity helpers in
 * `lib/statusBadges.ts` so a `StatusMeta.tone` can be passed through
 * to a chip without translation.
 *
 * Lookup is keyed on raw lifecycle strings (job, invoice, quote, lead).
 * Surfaces that need richer label logic (e.g. "Past Due" derived from
 * `isPastDue`, or "Requires invoicing" derived from a job's lifecycle)
 * should continue to call the `*Meta` helpers in `lib/statusBadges.ts`
 * — those helpers OWN the precedence rules. This map is the
 * fall-through for primitive status strings.
 */
export const STATUS_TO_CHIP_TONE: Record<string, ChipTone> = {
  // Job lifecycle
  open: "neutral",
  draft: "neutral",
  archived: "neutral",
  completed: "success",
  invoiced: "success",
  paid: "success",
  approved: "success",
  in_progress: "info",
  on_route: "info",
  sent: "info",
  scheduled: "info",
  assigned: "info",
  on_hold: "warning",
  requires_invoicing: "warning",
  past_due: "warning",
  overdue: "warning",
  partial_paid: "warning",
  awaiting_payment: "info",
  due_soon: "warning",
  expired: "warning",
  converted: "warning",
  overdue_critical: "danger",
  escalated: "danger",
  cancelled: "danger",
  void: "danger",
  voided: "neutral",
  declined: "danger",
  // Lead lifecycle
  new: "info",
  contacted: "warning",
  quoted: "neutral",
  won: "success",
  lost: "danger",
};

/**
 * Resolve a raw status string to a canonical chip tone. Defaults to
 * `neutral` for unknown strings so the chip is never "loud" without
 * an explicit mapping.
 */
export function statusToChipTone(status: string): ChipTone {
  return STATUS_TO_CHIP_TONE[status] ?? "neutral";
}

// ─── Entity → tone map ────────────────────────────────────────────

/**
 * Canonical entity-kind → chip tone map for cross-entity reference
 * chips (notes scope, related-entity displays, job number).
 *
 * Distinct from status tones because the meaning is "this
 * references a Job" not "this thing has succeeded." But internally
 * we re-use the status-tone palette so the visual vocabulary stays
 * tight (info=blue=jobs, success=emerald=invoices, etc.).
 */
export type ChipEntity = "job" | "invoice" | "quote" | "maintenance" | "default";

export const ENTITY_TO_CHIP_TONE: Record<ChipEntity, ChipTone> = {
  job: "info",
  invoice: "success",
  quote: "purple",
  maintenance: "warning",
  default: "neutral",
};

export function entityToChipTone(entity: ChipEntity): ChipTone {
  return ENTITY_TO_CHIP_TONE[entity];
}
