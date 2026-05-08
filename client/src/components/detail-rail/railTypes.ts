/**
 * Right-rail descriptor types — 2026-05-07/08.
 *
 * The data-driven right-rail moves card visuals out of feature pages
 * and into the rail system. Pages build descriptors (typed plain
 * objects); `<RailPanelRenderer>` owns the JSX, typography, spacing,
 * card chrome, chips, dividers, and empty-state visuals.
 *
 * Migration history (Phases 1–8):
 *   - Client Detail — Parts, Maintenance, Activity, Equipment,
 *     Billing, Contacts (all descriptor-driven).
 *   - Job Detail   — Labour (Phase 7), Equipment (Phase 8).
 *   - Notes is the documented exception — `EntityNotesSection`
 *     and `NotesPanel` keep direct `<RailContentCard>` slot
 *     composition because note bodies invert the entity-card
 *     hierarchy (body is primary content, not metadata).
 *
 * Cross-page reuse: these descriptor types are stable across Client
 * Detail and Job Detail today; future Invoice / Quote / Lead rails
 * can reuse the same shape when they ship.
 */

import type { ComponentType, ReactNode } from "react";

// ── Chips ──────────────────────────────────────────────────────────

/** Variant set the renderer maps to colored chip styling. Mirrors the
 *  underlying `<RailContentCardChip>` variant set so the descriptor →
 *  slot pass-through is one-to-one. */
export type RailChipVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "purple";

export interface RailChipDescriptor {
  /** Visible chip text (e.g. "Active", "×3", "LOCATION NOTE"). */
  text: string;
  /** Color variant. Defaults to "neutral". */
  variant?: RailChipVariant;
  /** Caller's localization extras (e.g. `"uppercase tracking-wide"`
   *  for uppercase origin tags). The renderer applies this AFTER the
   *  baked chip class. Avoid using this to override typography tokens
   *  — the chip's `text-helper font-medium` baseline is canonical. */
  className?: string;
  /** Forwarded `data-testid` so consumers keep their existing chip
   *  selectors (e.g. `client-parts-card-quantity`). */
  testId?: string;
  /** Optional Lucide-style icon rendered before `text` at
   *  `h-3 w-3 mr-1`. Used by Job Detail Labour's "Running"
   *  warning chip (Clock icon with `animate-pulse`). */
  icon?: ComponentType<{ className?: string }>;
  /** Extra classes on the rendered icon (e.g. `"animate-pulse"`).
   *  Merged onto the canonical `h-3 w-3 mr-1` baseline. */
  iconClassName?: string;
}

// ── Field rows ─────────────────────────────────────────────────────

export interface RailFieldDescriptor {
  /** Label text rendered as `<dt class="text-label">`. The
   *  project-wide `.text-label` rule auto-uppercases this. */
  label: string;
  /** Value rendered as `<dd class="text-row text-text-primary">`.
   *  Strings are typical; ReactNode allows formatted spans (e.g. the
   *  rare case of a value with an inner `<time>` or icon). */
  value: ReactNode;
  /** Per-row tweaks on the `<dd>` — e.g. `tabular-nums`,
   *  `line-clamp-2`, `break-all`. */
  valueClassName?: string;
  /** Forwarded `data-testid` on the row wrapper (e.g.
   *  `client-parts-card-row-sku`). */
  testId?: string;
}

// ── Title row ──────────────────────────────────────────────────────

/** Trailing item rendered next to a title — icon (e.g. primary
 *  star), chip (e.g. "Company" badge), or clickable icon button
 *  (e.g. trash button on Job Detail Equipment cards). Phase 6
 *  introduced `icon` + `chip`; Phase 8 (Job Detail Equipment)
 *  introduces `iconButton` for action affordances inside a
 *  clickable card.
 *
 *  When the parent card is itself clickable (renders as `<button>`),
 *  the iconButton renders as a `<span role="button" tabIndex={0}>`
 *  with keyboard activation so HTML stays valid (no nested
 *  `<button>` elements). The renderer applies `e.stopPropagation()`
 *  on the inner click so the trailing action doesn't bubble up to
 *  the card-level click. */
export type RailTitleTrailing =
  | {
      kind: "icon";
      icon: ComponentType<{ className?: string }>;
      /** Required for accessibility — the icon's `aria-label`. */
      ariaLabel?: string;
      /** Override class for the rendered icon. Defaults to
       *  `"h-2.5 w-2.5 text-amber-500 fill-amber-500"` ergonomics
       *  shouldn't need to be re-derived per call site. Pages can
       *  pass their own when colour / fill differs (e.g. brand
       *  green for unrelated indicators). */
      className?: string;
    }
  | {
      kind: "chip";
      chip: RailChipDescriptor;
    }
  | {
      kind: "iconButton";
      icon: ComponentType<{ className?: string }>;
      /** Click handler — fires on click + Enter/Space keydown. */
      onClick: () => void;
      /** Required for accessibility. */
      ariaLabel: string;
      /** Forwarded `data-testid` (e.g. `button-remove-job-equipment-${id}`). */
      testId?: string;
      /** Extra classes on the rendered icon (default chrome is
       *  `h-3.5 w-3.5`). Most callers pass nothing. */
      iconClassName?: string;
      /** When true, the rendered span carries `aria-disabled={true}`.
       *  The renderer does NOT block the click — pages should gate
       *  the action inside `onClick` themselves (e.g. via
       *  `mutation.isPending`). */
      disabled?: boolean;
    };

export interface RailCardTitleDescriptor {
  /** Title text. Renders inside `<RailContentCardTitle>` which bakes
   *  `text-row-emphasis text-text-primary truncate min-w-0` (the
   *  canonical 15px / 500 role token; no `font-semibold` modifier). */
  text: string;
  /** Inline secondary text appended after `text` with subdued
   *  weight (`font-normal text-text-secondary`). Use for
   *  parenthetical qualifiers like "(jobTitle)" on a contact name.
   *  Pages should include the parens themselves; the renderer just
   *  renders the string verbatim in a `<span>`. */
  secondary?: string;
  /** Optional trailing chip on the title row's right side. Use for
   *  the common "single chip" case (Equipment status, Maintenance
   *  status, Parts quantity). For heterogeneous trailing content
   *  (icon + chip on Contacts) use `trailing` instead — when
   *  `trailing` is set the renderer ignores `chip`. */
  chip?: RailChipDescriptor;
  /** Multiple trailing items — pages that need both an icon (e.g.
   *  primary-star indicator) AND a chip (e.g. "Company" badge) on
   *  the same row pass them here. Items render in source order
   *  inside a `flex items-center gap-1.5 shrink-0` container at the
   *  right edge of the title row. */
  trailing?: ReadonlyArray<RailTitleTrailing>;
  /** Caller-supplied className appended after the canonical title
   *  classes (e.g. `"break-words whitespace-normal"` to disable the
   *  default truncation for a multi-line title). */
  className?: string;
  /** Heading level for the rendered title. Defaults to `"h4"`. Use
   *  `"span"` for surfaces where the title isn't a true heading
   *  (Activity rows, Labour sub-row titles) — typography stays
   *  identical, only the element changes. */
  as?: "h3" | "h4" | "h5" | "span";
  /** Forwarded `data-testid` on the rendered title element. */
  testId?: string;
  /** Optional small leading icon rendered before the title text in
   *  the same left-side cluster (Job Detail Equipment uses a
   *  Wrench icon at `h-3.5 w-3.5 text-text-secondary shrink-0`).
   *  When set, the renderer wraps the title + chip in a left-side
   *  flex container so the icon stays adjacent to the title text,
   *  separate from the `trailing` area on the right. */
  titleIcon?: ComponentType<{ className?: string }>;
  /** Optional chip rendered immediately to the right of the title
   *  text on the LEFT side of the header — distinct from the
   *  `trailing` chip which renders on the FAR right. Used by Job
   *  Detail Equipment for the equipment-type chip ("HVAC", "RTU")
   *  that sits inline with the name, with the trash action on the
   *  right via `trailing`. */
  inlineChip?: RailChipDescriptor;
}

/** Single item inside a meta row — text optionally prefixed by a
 *  small Lucide icon. Phase 6 (Contacts migration) introduces this
 *  so phone/email/location lines can render with consistent
 *  icon-prefixed chrome without inline JSX in the page. */
export interface RailMetaItem {
  /** Optional Lucide-style icon component rendered before `text` at
   *  `h-2.5 w-2.5 text-slate-400 flex-shrink-0`. */
  icon?: ComponentType<{ className?: string }>;
  /** Item text. */
  text: string;
  /** When true the item gets `truncate` so the rail's narrow column
   *  clips long values (long emails, long location names) with an
   *  ellipsis instead of overflowing. */
  truncate?: boolean;
}

/** A single meta row — one or more icon-prefixed items rendered
 *  inline. Phase 6: added so Contacts can express phone/email
 *  (multi-item) plus a separate location row (single-item). When a
 *  card has just a single meta line as plain text, use the simpler
 *  `meta: string` field instead.
 *
 *  Renderer applies `gap-3` between items when there are 2+ items
 *  in the row, and `gap-1` for single-item rows (matches the prior
 *  Contacts layout). Each item internally wraps its icon + text in
 *  a `flex items-center gap-1` span. */
export interface RailMetaRowDescriptor {
  /** Items rendered inline inside a `<RailContentCardMeta>` slot. */
  items: ReadonlyArray<RailMetaItem>;
  /** Forwarded `data-testid` on the rendered Meta slot. */
  testId?: string;
}

// ── Cards ──────────────────────────────────────────────────────────

/**
 * Section-style card header — small uppercase label on the left + a
 * compact tabular-nums value on the right. Used by Job Detail
 * Labour's per-(tech, date) cards where the date label sits left
 * and the per-date totals sit right with a `border-b` separator.
 *
 * Renders `text-label uppercase tracking-wide text-text-muted` for
 * the label and `text-caption tabular-nums text-text-primary
 * font-mono` for the value. Separator: `pb-2 border-b
 * border-slate-100` baked in.
 *
 * Mutually exclusive with `RailCardDescriptor.title` — when both
 * are set the renderer prefers `sectionHeader`.
 */
export interface RailCardSectionHeader {
  /** Section label rendered on the left in canonical
   *  `text-label uppercase tracking-wide text-text-muted` chrome. */
  label: string;
  /** Compact value rendered on the right with
   *  `text-caption tabular-nums text-text-primary font-mono`. Use
   *  for per-section totals (Labour: minutes · cost). */
  value: string;
  /** Forwarded `data-testid` on the rendered section header. */
  testId?: string;
}

/**
 * Sub-row inside a card — a clickable inline action row used when a
 * card hosts multiple entries (Job Detail Labour: each time entry
 * is a sub-row inside the per-(tech, date) card, opening the
 * TimeEntryModal in edit mode).
 *
 * The renderer bakes:
 *   - The button chrome (`<RailContentCardSubrow>`: rounded,
 *     hover-bg, focus-visible ring, tight `px-2 py-1.5` padding).
 *   - Inter-row dividers (`mt-1 pt-2 border-t border-slate-100` on
 *     every sub-row after the first, so the page never specifies
 *     them).
 *   - Top-row layout (`flex items-baseline justify-between gap-2`).
 *   - Bottom-row meta typography (`text-caption text-text-secondary
 *     font-mono` on the meta line; tabular-nums on values).
 *
 * Pages provide only the labels, the optional warning chip, the
 * optional trailing value, and the click handler.
 */
export interface RailSubrowDescriptor {
  /** React `key` prop — must be stable across re-renders. */
  key: string;
  /** Forwarded `data-testid` on the rendered button (e.g.
   *  `labour-entry-${id}`). */
  testId?: string;
  /** Click → opens the relevant detail / edit modal. */
  onClick: () => void;
  /** Required for accessibility — the rendered `<button>` carries
   *  this as its `aria-label`. */
  ariaLabel?: string;
  /** Top row: title on the left, optional chip + optional trailing
   *  value on the right. */
  title: {
    /** Primary text — rendered through `<RailContentCardTitle>` so
     *  the typography matches card titles (text-row-emphasis,
     *  the canonical 15px / 500 role token). */
    text: string;
    /** Optional inline chip in the title row (e.g. "Running"
     *  warning indicator with Clock icon). */
    chip?: RailChipDescriptor;
    /** Optional trailing value on the right side of the title row.
     *  Rendered with `text-row-emphasis tabular-nums text-text-primary
     *  font-mono shrink-0` — used for Labour's per-entry cost. */
    value?: string;
  };
  /** Optional bottom row: left text + right text. Both render with
   *  `text-caption tabular-nums text-text-secondary font-mono`. Used
   *  for Labour's time-range / duration row. */
  meta?: {
    leftText: string;
    rightText: string;
    /** When true the left text gets `truncate min-w-0` so long
     *  values clip with an ellipsis instead of overflowing. */
    leftTruncate?: boolean;
  };
}

export interface RailCardDescriptor {
  /** React `key` prop — must be stable across re-renders. */
  key: string;
  /** Forwarded `data-testid` on the card root (e.g.
   *  `client-parts-card`, `client-equipment-card`). */
  testId?: string;

  /** Click-to-open-modal handler. When set, the renderer mounts the
   *  clickable variant of `<RailContentCard>` (button + hover +
   *  focus-visible). Read-only cards omit this. */
  onClick?: () => void;
  /** Required when `onClick` is set — accessible name for the
   *  rendered `<button>`. */
  ariaLabel?: string;

  /** Title row (Header + Title slots). */
  title?: RailCardTitleDescriptor;
  /** Section-style header (label + tabular-nums value with a
   *  `border-b` separator). Used by Labour's per-(tech, date)
   *  cards. Mutually exclusive with `title` — when both are set
   *  the renderer prefers `sectionHeader`. */
  sectionHeader?: RailCardSectionHeader;
  /** Sub-rows — clickable action rows inside the card (Labour
   *  entries that open the time-entry modal). When set, render
   *  inside the card body with auto-applied inter-row dividers. */
  subrows?: ReadonlyArray<RailSubrowDescriptor>;
  /** Optional caption-typography line under the title or above the
   *  body (renderer chooses the right `mt-*` automatically via the
   *  Meta slot's `first:mt-0` baseline). */
  meta?: string;
  /** Forwarded `data-testid` on the rendered Meta slot (e.g.
   *  `client-activity-row-meta`). */
  metaTestId?: string;
  /** Multi-row icon-prefixed meta lines (Contacts: phone/email row +
   *  location row). When set, takes precedence over `meta` — the
   *  string version is for the simpler one-line case used by
   *  Activity / Equipment-subtitle. Each row renders as its own
   *  `<RailContentCardMeta>` slot. */
  metaRows?: ReadonlyArray<RailMetaRowDescriptor>;
  /** Primary body paragraph (note text, description, …). Renders via
   *  `<RailContentCardBody>` which bakes `text-row leading-relaxed
   *  whitespace-pre-wrap break-words`. */
  body?: string;
  /** When set, clamps the body to N visible lines. Only `2` and `3`
   *  are supported in Phase 1 — Tailwind needs literal class strings
   *  for `line-clamp-N` to JIT-compile. Add more here when needed. */
  bodyClamp?: 2 | 3;
  /** Forwarded `data-testid` on the rendered Body slot (e.g.
   *  `client-activity-row-body`). */
  bodyTestId?: string;

  /** dl-style label/value rows (Equipment / Parts / Maintenance /
   *  Billing snapshots). */
  fields?: RailFieldDescriptor[];

  /** Optional bottom chip row — used by Contacts for role chips.
   *  Renders inside `<RailContentCardChipRow>` which bakes
   *  `flex flex-wrap gap-1.5 mt-1.5 first:mt-0`. Each chip in the
   *  array uses the canonical compact chip chrome via
   *  `<RailContentCardChip>`. */
  chipRow?: ReadonlyArray<RailChipDescriptor>;

  /** Optional footer slot — link to a detail/edit surface, etc.
   *  Renders inside `<RailContentCardFooter>` which bakes the
   *  canonical separator + meta typography. The renderer aligns the
   *  footer content to the right (`justify-end`) so single-action
   *  cards (Maintenance "View / Edit") read as a corner CTA. */
  footer?: RailFooterDescriptor;

  /**
   * **Bounded escape hatch.** Optional React subtree rendered inside
   * the card body, AFTER the standard slots (sectionHeader / title /
   * meta / metaRows / fields / body / subrows / chipRow) but BEFORE
   * `footer`. Use this exclusively for content that genuinely cannot
   * fold into descriptor data — most often a child React component
   * with its own state/data fetching (e.g. Job Detail Equipment
   * cards embed `<EquipmentCatalogItemsSection>`).
   *
   * Reserved for embedded React subtrees only. Do NOT use this to
   * bypass the renderer's slot system — if your content fits any
   * standard slot, use that slot instead. The renderer still owns
   * the card chrome; this field just lets a caller drop a typed
   * ReactNode at one fixed position inside the card body.
   *
   * Pinned by `tests/rail-panel-renderer.test.ts` so the position
   * stays stable.
   */
  extraContent?: ReactNode;
}

// ── Footer ─────────────────────────────────────────────────────────

/**
 * Footer content rendered inside the canonical `<RailContentCardFooter>`
 * slot — `mt-2 pt-2 border-t border-slate-100` separator + caption
 * typography baseline. Discriminated union so the renderer dispatches
 * exhaustively; pages never construct footer JSX themselves.
 *
 *   - `link`  — single navigation affordance (Maintenance "View / Edit
 *               in Maintenance" → `/pm/:id`).
 *   - `block` — multi-line labeled content with an optional fallback
 *               line (Billing "Billing address" → 1–2 address lines
 *               OR italic "No billing address on file.").
 *
 * Future panels can extend this union with `button` or `buttons[]` if
 * a panel ever needs an inline action button. The renderer's
 * exhaustiveness check (`const _exhaustive: never = footer.kind`)
 * makes the addition cost a compile error in one place.
 */
export type RailFooterDescriptor =
  | {
      kind: "link";
      /** Wouter route (e.g. `/pm/abc-123`). */
      href: string;
      /** Visible link text. */
      label: string;
      /** Optional Lucide-style icon component rendered after the
       *  label at `h-3.5 w-3.5`. */
      icon?: ComponentType<{ className?: string }>;
      /** Required for accessibility — the rendered `<a>` carries
       *  this as its `aria-label`. */
      ariaLabel?: string;
      /** Optional hover-tooltip text (native `title` attribute). */
      title?: string;
      /** Forwarded `data-testid` on the rendered `<a>` (e.g.
       *  `client-maintenance-card-action`). */
      testId?: string;
    }
  | {
      kind: "block";
      /** Optional small label rendered above the lines /
       *  fallback in the canonical `text-label text-text-secondary`
       *  uppercase chrome. Use for "Billing address", future
       *  "Service window" / "Notes" subsection markers, etc. */
      label?: string;
      /** Multi-line body content. Each entry renders as its own
       *  `<div>` in canonical `text-row text-text-primary`. Empty /
       *  whitespace-only entries should be filtered by the page
       *  before passing — the renderer renders whatever the array
       *  contains. When `lines` is missing or empty, the renderer
       *  shows `fallback` instead. */
      lines?: string[];
      /** Italic muted fallback line shown when `lines` is missing
       *  or empty. Rendered in the Footer slot's default
       *  `text-caption text-text-secondary` baseline + `italic`. */
      fallback?: string;
    };

// ── Empty state ────────────────────────────────────────────────────

export interface RailEmptyDescriptor {
  /** Required short message — "No parts yet.", "No notes yet." */
  message: string;
  /** Optional one-line hint underneath. */
  hint?: string;
}

// ── Panel kinds ────────────────────────────────────────────────────

/**
 * Discriminated union covering every Phase-1 panel layout.
 *
 *   - `list`    — N cards (with optional empty state when `cards.length === 0`).
 *   - `single`  — exactly one card (Billing today).
 *   - `loading` — centered spinner; used while a panel's data fetch
 *                 is in flight (Activity, Maintenance).
 *
 * A `custom` escape-hatch variant is intentionally NOT included in
 * Phase 1. Notes still mounts `<NotesPanel>` directly via
 * `DetailRailTab.content` — it doesn't go through the descriptor
 * layer. If a future panel genuinely can't fold into the descriptor
 * shapes, the `custom` variant gets added then, with documented
 * justification.
 */
/**
 * Panel-level header rendered above grouped content. Used by Job
 * Detail Labour for the "TOTAL" aggregate row that surfaces minutes
 * + cost across every tech and date.
 *
 * Renders `text-label uppercase tracking-wide text-text-muted` on the
 * left and a sequence of `text-row-emphasis tabular-nums
 * text-text-primary` values on the right (separated by
 * thin `text-text-disabled` `·` dividers when there are multiple).
 *
 * Visual separator: `pb-3 mb-2 border-b border-border-default`
 * baked into the rendered chrome so groups below sit cleanly under
 * the totals row.
 */
export interface RailGroupedPanelHeader {
  /** Section label rendered on the left (Labour: `"Total"`). */
  label: string;
  /** One or more aggregate values rendered on the right in source
   *  order, separated by canonical thin dividers. */
  values: ReadonlyArray<string>;
  /** Forwarded `data-testid` on the rendered header row. */
  testId?: string;
}

/**
 * One section inside a grouped panel — a heading (technician name on
 * Labour) plus a list of cards. The renderer applies
 * `space-y-4` between groups and `space-y-2` between cards inside
 * a group.
 */
export interface RailGroupDescriptor {
  /** React `key` prop — must be stable across re-renders. */
  key: string;
  /** Forwarded `data-testid` on the group wrapper (e.g.
   *  `labour-tech-group-${technicianId}`). */
  testId?: string;
  /** Section heading rendered above the cards in canonical
   *  `text-section-title text-text-primary` chrome (the 18px / 600
   *  role token bakes the weight; no `font-semibold` modifier). */
  heading: string;
  /** Cards in the section. Each can carry a section-header + sub-rows
   *  (Labour's date-card pattern) or any of the standard slots. */
  cards: ReadonlyArray<RailCardDescriptor>;
}

export type RailPanelDescriptor =
  | {
      kind: "list";
      cards: RailCardDescriptor[];
      /** Rendered by the renderer when `cards.length === 0`. */
      empty?: RailEmptyDescriptor;
      /** Optional `data-testid` on the rendered `<ul>` so pages can
       *  preserve their existing panel-body selectors (e.g.
       *  `client-parts-panel-body`). */
      testId?: string;
      /** Vertical gap between cards in the list.
       *
       *    - `"default"` (12px / `space-y-3`) — entity-card panels
       *      where each row carries substantial content (Equipment /
       *      Parts / Maintenance).
       *    - `"compact"` (8px / `space-y-2`) — feed-shaped panels
       *      where rows are short and reading them as a list of
       *      events feels right (Activity).
       *
       *    Defaults to `"default"`. */
      spacing?: "default" | "compact";
      /** Optional "+N more items not shown." indicator rendered as
       *  the last `<li>` in the list. Use this when the page caps a
       *  long list at a UI-visible limit (Equipment caps at 8). The
       *  renderer emits the indicator only when `count > 0` and
       *  pluralises automatically (`item` vs `items`). */
      overflow?: {
        count: number;
        /** Forwarded `data-testid` on the overflow `<li>`. */
        testId?: string;
      };
    }
  | {
      kind: "single";
      card: RailCardDescriptor;
    }
  | {
      kind: "loading";
      /** Optional override for the rendered loading container's
       *  `data-testid`. When omitted the renderer falls back to
       *  `${testIdPrefix}-panel-loading`. Maintenance uses this to
       *  preserve the prior `client-maintenance-loading` testid. */
      testId?: string;
    }
  | {
      kind: "grouped";
      /** Optional panel-level totals header rendered above all
       *  groups (Labour: "TOTAL · 8h 30m · $850"). When omitted no
       *  header chrome is rendered. */
      panelHeader?: RailGroupedPanelHeader;
      /** Sections — each renders a heading + a list of cards. */
      groups: ReadonlyArray<RailGroupDescriptor>;
      /** Forwarded `data-testid` on the rendered groups container
       *  (Labour: `labour-entries-list`). */
      testId?: string;
    };
