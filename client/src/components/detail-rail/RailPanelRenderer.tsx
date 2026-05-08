/**
 * RailPanelRenderer — data-driven right-rail panel (2026-05-07/08).
 *
 * Consumes a `RailPanelDescriptor` (typed plain objects from the
 * page) and emits the canonical right-rail JSX using the
 * `<RailContentCard>` slot primitives. Pages no longer compose card
 * chrome by hand — they feed labels, values, IDs, callbacks, chip
 * text/variant, and the renderer owns everything visual:
 *
 *   - Card shell (border / radius / bg / shadow / padding / hover)
 *   - Title typography (incl. titleIcon + inlineChip + trailing items)
 *   - Body typography (with optional line-clamp)
 *   - Meta typography (single string OR multi-row icon-prefixed items)
 *   - Chip sizing + colors (variant set: neutral/info/success/warning/destructive/purple)
 *   - Field-list <dl>/<dt>/<dd> layout
 *   - Spacing between slots (auto via `mt-1.5 first:mt-0` on slots)
 *   - Empty-state visuals
 *   - Loading spinner
 *   - List <ul>/<li> wrapper for the multi-card case + overflow indicator
 *   - Grouped panels (panel-level header + per-group cards + sub-rows)
 *   - Footer kinds: `link` (wouter <Link>) / `block` (label + lines + fallback)
 *   - Bounded `extraContent` escape hatch for one fixed-position React subtree
 *
 * Current callers (after the 2026-05-07/08 re-recovery sweep):
 *   - Client Detail rail — every panel (Parts / Activity / Maintenance /
 *     Equipment / Billing / Contacts) is descriptor-driven.
 *   - Job Detail rail — Labour (Phase 7) + Equipment (Phase 8) are
 *     descriptor-driven. Notes intentionally remains on direct
 *     `<RailContentCard>` slot composition (the Notes exception:
 *     descriptor model inverts entity hierarchy for note bodies).
 *
 * See `railTypes.ts` for the descriptor shape; see the per-panel
 * source-pin tests under `tests/client-rail-*-descriptor.test.ts` and
 * `tests/job-rail-{labour,equipment}-descriptor.test.ts` for the
 * authoritative behavioral spec for each migration.
 */

import { Fragment } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ENTITY_LINK_CLASS } from "@/components/ui/typography";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
  RailContentCardBody,
  RailContentCardMeta,
  RailContentCardChip,
  RailContentCardChipRow,
  RailContentCardFieldList,
  RailContentCardField,
  RailContentCardFooter,
  RailContentCardSubrow,
} from "./RailContentCard";
import { DetailRightRailEmpty } from "./DetailRightRail";
import type {
  RailCardDescriptor,
  RailCardTitleDescriptor,
  RailChipDescriptor,
  RailFooterDescriptor,
  RailMetaRowDescriptor,
  RailPanelDescriptor,
  RailSubrowDescriptor,
  RailTitleTrailing,
} from "./railTypes";

export interface RailPanelRendererProps {
  /** The panel's data descriptor. The renderer dispatches on `panel.kind`. */
  panel: RailPanelDescriptor;
  /** TestId prefix used for rendered chrome elements that don't get a
   *  per-descriptor testId — currently the empty-state container and
   *  the loading container. Pages pass the same prefix they pass to
   *  `<DetailRightRail>` (e.g. `"client-side"`) so DOM selectors stay
   *  stable. When omitted, those chrome elements render without a
   *  `data-testid`. */
  testIdPrefix?: string;
}

export function RailPanelRenderer({
  panel,
  testIdPrefix,
}: RailPanelRendererProps) {
  if (panel.kind === "loading") {
    // 2026-05-07 Phase 2 — descriptors may carry a custom loading
    // testId (`panel.testId`) so panels migrating from a prior
    // hand-rolled spinner can preserve their existing DOM
    // selectors (e.g. Maintenance keeps `client-maintenance-loading`).
    // Falls back to `${testIdPrefix}-panel-loading` when not set.
    const loadingTestId =
      panel.testId ??
      (testIdPrefix ? `${testIdPrefix}-panel-loading` : undefined);
    return (
      <div
        className="py-6 flex justify-center"
        data-testid={loadingTestId}
      >
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    );
  }

  if (panel.kind === "single") {
    return <RailCardFromDescriptor card={panel.card} />;
  }

  if (panel.kind === "grouped") {
    // 2026-05-07 Phase 7 — grouped panels (Job Detail Labour). The
    // panel-level header (totals) renders above the groups; each
    // group has a heading + a list of cards (each card may carry
    // `sectionHeader` + `subrows` instead of the standard slots).
    return (
      <div data-testid={panel.testId}>
        {panel.panelHeader && (
          <RailGroupedPanelHeaderRow header={panel.panelHeader} />
        )}
        <div className="space-y-4">
          {panel.groups.map((group) => (
            <div
              key={group.key}
              className="space-y-2"
              data-testid={group.testId}
            >
              <div className="flex items-center gap-2">
                <span className="text-section-title text-text-primary truncate min-w-0">
                  {group.heading}
                </span>
              </div>
              <div className="space-y-2">
                {group.cards.map((card) => (
                  <RailCardFromDescriptor key={card.key} card={card} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // kind === "list"
  if (panel.cards.length === 0) {
    return (
      <DetailRightRailEmpty
        message={panel.empty?.message ?? "Nothing to show yet."}
        hint={panel.empty?.hint}
        testIdPrefix={testIdPrefix}
      />
    );
  }
  // 2026-05-07 Phase 3 — `spacing: "compact"` (Activity feed) shrinks
  // the inter-card gap from `space-y-3` (entity panels) to
  // `space-y-2`. Tailwind needs literal class strings for the JIT to
  // pick up — map explicitly here rather than interpolating.
  const spacingClass =
    panel.spacing === "compact" ? "space-y-2" : "space-y-3";
  // 2026-05-07 Phase 4 — `overflow?: { count }` renders an extra
  // `<li>` after the cards with the canonical
  // `+ N more {item|items} not shown.` copy. Pages cap their lists
  // at a UI-visible limit and pass the truncated count; the
  // renderer owns the visual + pluralisation.
  const overflowCount = panel.overflow?.count ?? 0;
  return (
    <ul
      className={`${spacingClass} list-none p-0 m-0`}
      data-testid={panel.testId}
    >
      {panel.cards.map((card) => (
        <li key={card.key}>
          <RailCardFromDescriptor card={card} />
        </li>
      ))}
      {overflowCount > 0 && (
        <li
          className="text-helper text-text-secondary px-1 py-1"
          data-testid={panel.overflow?.testId}
        >
          + {overflowCount} more {overflowCount === 1 ? "item" : "items"} not shown.
        </li>
      )}
    </ul>
  );
}

// ── Internal: grouped panel header ─────────────────────────────────

function RailGroupedPanelHeaderRow({
  header,
}: {
  header: NonNullable<Extract<RailPanelDescriptor, { kind: "grouped" }>["panelHeader"]>;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-2 px-1 pb-3 mb-2 border-b border-border-default"
      data-testid={header.testId}
    >
      {/* 2026-05-08 Labour typography remap — `text-label` already bakes
          uppercase + 0.04em tracking via the @layer rule. The prior
          `uppercase tracking-wide` modifiers re-applied uppercase
          (no-op) and overrode the canonical 0.04em tracking with
          0.025em. Keeping `text-label` alone preserves the canonical
          tracking and matches the panel-header label "Notes" / "Labour"
          / "Equipment" exactly. */}
      <span className="text-label text-text-muted">
        {header.label}
      </span>
      {/* 2026-05-08 Labour typography remap — dropped `font-mono` from the
          values wrapper. `tabular-nums` on each value gives column
          alignment without a family swap, so the totals row reads in
          the same sans-serif as the rest of the rail panels. */}
      <span className="flex items-baseline gap-2">
        {header.values.map((v, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <span className="text-text-disabled">·</span>}
            <span className="text-row-emphasis tabular-nums text-text-primary">
              {v}
            </span>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

// ── Internal: RailCardDescriptor → JSX ─────────────────────────────

/**
 * Maps a single `RailCardDescriptor` to the canonical card JSX.
 * Centralizes the slot composition so every callsite renders the
 * exact same structure (header → meta → fields → body) at the exact
 * same spacing.
 */
function RailCardFromDescriptor({ card }: { card: RailCardDescriptor }) {
  // Phase 1 supports `bodyClamp` values 2 and 3. Tailwind needs
  // literal class strings to JIT-compile, so we map to literals here
  // rather than interpolating `line-clamp-${n}`.
  const bodyClampClass =
    card.bodyClamp === 2
      ? "line-clamp-2"
      : card.bodyClamp === 3
        ? "line-clamp-3"
        : undefined;

  return (
    <RailContentCard
      onClick={card.onClick}
      ariaLabel={card.ariaLabel}
      testId={card.testId}
    >
      {/* 2026-05-07 Phase 7 — `sectionHeader` (Labour date-cards)
          takes precedence over the standard `title` slot. Renders
          a label + tabular-nums value pair with a `border-b`
          separator, all baked. */}
      {card.sectionHeader ? (
        <RailContentCardHeader
          className="items-baseline pb-2 border-b border-slate-100"
          data-testid={card.sectionHeader.testId}
        >
          {/* 2026-05-08 Labour typography remap — see RailGroupedPanelHeaderRow
              for the rationale on dropping the redundant `uppercase
              tracking-wide` modifiers. The `text-label` token bakes
              both already; the prior overrides flattened tracking from
              the canonical 0.04em to 0.025em. */}
          <span className="text-label text-text-muted">
            {card.sectionHeader.label}
          </span>
          {/* 2026-05-08 Labour typography remap — dropped `font-mono` from
              the per-date total. The date-card aggregate now renders
              in the same sans-serif family as Equipment / Notes meta;
              `tabular-nums` keeps the value column-aligned. */}
          <span className="text-caption tabular-nums text-text-primary shrink-0">
            {card.sectionHeader.value}
          </span>
        </RailContentCardHeader>
      ) : card.title ? (
        <RailContentCardHeader>
          {/* 2026-05-07 Phase 8 — title left-cluster. When `titleIcon`
              or `inlineChip` is set we wrap the title element in a
              left-side flex container so the leading icon and the
              inline chip stay adjacent to the title text, distinct
              from the right-side `trailing` slot. When neither is
              set the wrapping div renders harmlessly with one child
              (the title) and the layout is identical to the prior
              flat shape. */}
          <div className="flex items-center gap-2 min-w-0">
            {card.title.titleIcon && (
              <card.title.titleIcon className="h-3.5 w-3.5 text-text-secondary shrink-0" />
            )}
            <RailContentCardTitle
              as={card.title.as}
              className={card.title.className}
              data-testid={card.title.testId}
            >
              {card.title.text}
              {card.title.secondary && (
                <span className="font-normal text-text-secondary">
                  {" "}
                  {card.title.secondary}
                </span>
              )}
            </RailContentCardTitle>
            {card.title.inlineChip && (
              <RailChipFromDescriptor chip={card.title.inlineChip} />
            )}
          </div>
          <RailTitleTrailingArea title={card.title} />
        </RailContentCardHeader>
      ) : null}

      {card.metaRows && card.metaRows.length > 0
        ? card.metaRows.map((row, idx) => (
            <RailMetaRowFromDescriptor key={idx} row={row} />
          ))
        : card.meta && (
            <RailContentCardMeta data-testid={card.metaTestId}>
              {card.meta}
            </RailContentCardMeta>
          )}

      {card.fields && card.fields.length > 0 && (
        <RailContentCardFieldList>
          {card.fields.map((f) => (
            <RailContentCardField
              key={f.label}
              label={f.label}
              valueClassName={f.valueClassName}
              testId={f.testId}
            >
              {f.value}
            </RailContentCardField>
          ))}
        </RailContentCardFieldList>
      )}

      {card.body && (
        <RailContentCardBody
          className={bodyClampClass}
          data-testid={card.bodyTestId}
        >
          {card.body}
        </RailContentCardBody>
      )}

      {card.subrows && card.subrows.length > 0 && (
        <div className="mt-1.5">
          {card.subrows.map((subrow, idx) => (
            <RailSubrowFromDescriptor
              key={subrow.key}
              subrow={subrow}
              isFirst={idx === 0}
            />
          ))}
        </div>
      )}

      {card.chipRow && card.chipRow.length > 0 && (
        <RailContentCardChipRow>
          {card.chipRow.map((chip, idx) => (
            <RailChipFromDescriptor key={idx} chip={chip} />
          ))}
        </RailContentCardChipRow>
      )}

      {/* 2026-05-07 Phase 8 — bounded escape hatch. Reserved for
          embedded React subtrees that genuinely cannot fold into
          descriptor data (Job Detail Equipment cards embed
          `<EquipmentCatalogItemsSection>` which has its own state +
          query + dialogs). Renders at one fixed position (after
          subrows/chipRow, before footer) so the slot system stays
          predictable. */}
      {card.extraContent}

      {card.footer && <RailFooterFromDescriptor footer={card.footer} />}
    </RailContentCard>
  );
}

// ── Internal: RailFooterDescriptor → JSX ───────────────────────────

/**
 * Maps a footer descriptor to the canonical footer slot.
 *
 *   - `link`  — Maintenance "View / Edit in Maintenance" → `/pm/:id`.
 *   - `block` — Billing "Billing address" → multi-line address with
 *               italic-muted fallback when nothing is on file.
 *
 * Pages do not import wouter / Link / Lucide / hex colour for the
 * footer — they pass typed descriptor data; the renderer owns the
 * visual.
 */
function RailFooterFromDescriptor({
  footer,
}: {
  footer: RailFooterDescriptor;
}) {
  if (footer.kind === "link") {
    const Icon = footer.icon;
    return (
      <RailContentCardFooter className="justify-end">
        <Link
          href={footer.href}
          aria-label={footer.ariaLabel}
          title={footer.title}
          // Phase H2: footer link composes the canonical ENTITY_LINK_CLASS
          // (brand-green + hover underline) with the per-callsite layout
          // (compact helper sizing + focus-visible ring + rounded box).
          // 2026-05-07 typography sweep: dropped `text-caption font-medium`
          // (14px / 500) for `text-helper` (13px / 400) so the footer
          // link rides the same dense-secondary scale as the rest of
          // the rail panel meta. Brand color comes from ENTITY_LINK_CLASS;
          // the layout token here only sets size + chrome.
          className={cn(
            "inline-flex items-center gap-1 text-helper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40 rounded px-1 py-0.5",
            ENTITY_LINK_CLASS,
          )}
          data-testid={footer.testId}
        >
          {footer.label}
          {Icon && <Icon className="h-3.5 w-3.5" />}
        </Link>
      </RailContentCardFooter>
    );
  }
  if (footer.kind === "block") {
    // Vertical stack overrides the Footer slot's default
    // `flex items-center justify-between` so the label sits above
    // the body rather than across from it. Lines render at body
    // typography (`text-row text-text-primary`); the fallback
    // inherits the Footer slot's `text-caption text-text-secondary`
    // baseline + an italic emphasis.
    const hasLines = footer.lines !== undefined && footer.lines.length > 0;
    return (
      <RailContentCardFooter className="flex-col items-start gap-1">
        {footer.label && (
          <span className="text-label text-text-secondary">{footer.label}</span>
        )}
        {hasLines ? (
          <div className="text-row text-text-primary">
            {footer.lines!.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        ) : footer.fallback ? (
          <span className="italic">{footer.fallback}</span>
        ) : null}
      </RailContentCardFooter>
    );
  }
  // Exhaustive — TS will flag a missing branch when new kinds are added.
  const _exhaustive: never = footer;
  return _exhaustive;
}

// ── Internal: title trailing area ──────────────────────────────────

/**
 * Renders the trailing area of a title row — multiple heterogeneous
 * items (icon + chip on Contacts, etc.). When `title.trailing` is
 * set we render the array; when only `title.chip` is set we fall
 * back to the single-chip path so existing migrated panels keep
 * working without descriptor churn.
 */
function RailTitleTrailingArea({
  title,
}: {
  title: RailCardTitleDescriptor;
}) {
  const trailing = title.trailing;
  if (trailing && trailing.length > 0) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        {trailing.map((item, idx) => (
          <RailTrailingItemFromDescriptor key={idx} item={item} />
        ))}
      </div>
    );
  }
  if (title.chip) {
    return <RailChipFromDescriptor chip={title.chip} />;
  }
  return null;
}

/**
 * Single trailing item — either an icon (e.g. primary star) or a
 * chip. Icons default to the canonical primary-indicator chrome
 * (`h-2.5 w-2.5 text-amber-500 fill-amber-500`); pages can override
 * via `className`.
 */
function RailTrailingItemFromDescriptor({
  item,
}: {
  item: RailTitleTrailing;
}) {
  if (item.kind === "icon") {
    const Icon = item.icon;
    return (
      <Icon
        aria-label={item.ariaLabel}
        className={cn(
          "h-2.5 w-2.5 text-amber-500 fill-amber-500",
          item.className,
        )}
      />
    );
  }
  if (item.kind === "chip") {
    return <RailChipFromDescriptor chip={item.chip} />;
  }
  if (item.kind === "iconButton") {
    // 2026-05-07 Phase 8 — clickable icon trailing button. Used by
    // Job Detail Equipment for the trash button next to the
    // equipment name. Renders as `<span role="button">` (NOT a real
    // `<button>`) because the parent card is itself a clickable
    // `<button>` and HTML doesn't allow nested buttons. Keyboard
    // activation: Enter / Space. The renderer applies
    // `e.stopPropagation()` on click so the trailing action doesn't
    // bubble up to the card-level click.
    const Icon = item.icon;
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          item.onClick();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            item.onClick();
          }
        }}
        aria-label={item.ariaLabel}
        aria-disabled={item.disabled || undefined}
        className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded text-text-secondary hover:text-destructive hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40 cursor-pointer"
        data-testid={item.testId}
      >
        <Icon className={cn("h-3.5 w-3.5", item.iconClassName)} />
      </span>
    );
  }
  const _exhaustive: never = item;
  return _exhaustive;
}

// ── Internal: chip with optional icon ──────────────────────────────

/**
 * Renders a `<RailContentCardChip>` with optional Lucide-style icon
 * before the text (Job Detail Labour's "Running" warning chip uses
 * a Clock icon with `animate-pulse`). All chip-render call sites in
 * this module flow through here so chip behaviour stays consistent.
 *
 * Icon defaults to the canonical `h-3 w-3 mr-1`; pages can layer
 * extra classes via `iconClassName` (e.g. `animate-pulse`).
 */
function RailChipFromDescriptor({ chip }: { chip: RailChipDescriptor }) {
  const Icon = chip.icon;
  return (
    <RailContentCardChip
      variant={chip.variant}
      className={chip.className}
      data-testid={chip.testId}
    >
      {Icon && <Icon className={cn("h-3 w-3 mr-1", chip.iconClassName)} />}
      {chip.text}
    </RailContentCardChip>
  );
}

// ── Internal: meta row with icon-prefixed items ────────────────────

/**
 * Renders one meta row from `metaRows`. Single-item rows use
 * `gap-1` (icon hugs text); multi-item rows use `gap-3` (more
 * breathing room between separate items). Each item internally
 * wraps its icon + text in `flex items-center gap-1` so the
 * per-item icon-text gap stays consistent regardless of row count.
 */
function RailMetaRowFromDescriptor({
  row,
}: {
  row: RailMetaRowDescriptor;
}) {
  const gapClass = row.items.length === 1 ? "gap-1" : "gap-3";
  return (
    <RailContentCardMeta
      className={`flex items-center ${gapClass}`}
      data-testid={row.testId}
    >
      {row.items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <span
            key={idx}
            className={cn(
              "flex items-center gap-1",
              item.truncate && "truncate",
            )}
          >
            {Icon && (
              <Icon className="h-2.5 w-2.5 text-slate-400 flex-shrink-0" />
            )}
            {item.text}
          </span>
        );
      })}
    </RailContentCardMeta>
  );
}

// ── Internal: subrow with title + optional meta ────────────────────

/**
 * Renders a clickable sub-entry inside a card. Used by Job Detail
 * Labour where each per-(tech, date) card hosts multiple time
 * entries as sub-rows that open the time-entry modal.
 *
 * The renderer bakes:
 *   - The `<RailContentCardSubrow>` button chrome (rounded,
 *     hover:bg-slate-50, focus-visible ring, `px-2 py-1.5`).
 *   - Inter-row dividers (`mt-1 pt-2 border-t border-slate-100` on
 *     every sub-row after the first — page never specifies them).
 *   - Top-row layout (`flex items-baseline justify-between gap-2`).
 *   - Top-row title typography is row-level (`text-row text-text-primary
 *     truncate min-w-0`) — NOT card-title typography. Subrows are
 *     entry rows nested inside a card, not mini-cards. Routing them
 *     through `<RailContentCardTitle>` (which bakes
 *     `text-row-emphasis` = 17/600) made each entry print at
 *     card-title scale and stacked 3+ heavy lines per (tech, date)
 *     card. Row-level typography matches the body/meta hierarchy
 *     used by Equipment + Notes.
 *   - Trailing value typography (`text-row tabular-nums
 *     text-text-primary shrink-0`). `tabular-nums` keeps the value
 *     column-aligned without the family swap that `font-mono`
 *     introduced previously.
 *   - Bottom-row meta (`flex items-baseline justify-between gap-2`)
 *     in `RailContentCardMeta`'s baked `text-helper` chrome plus
 *     per-span `tabular-nums`. No `font-mono` — the meta line now
 *     reads in the same sans-serif as Equipment meta lines.
 */
function RailSubrowFromDescriptor({
  subrow,
  isFirst,
}: {
  subrow: RailSubrowDescriptor;
  isFirst: boolean;
}) {
  return (
    <RailContentCardSubrow
      onClick={subrow.onClick}
      ariaLabel={subrow.ariaLabel}
      testId={subrow.testId}
      className={cn(!isFirst && "mt-1 pt-2 border-t border-slate-100")}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/* 2026-05-08 Labour typography remap — subrow title prints at
            row-level, NOT card-title-level. The prior
            `<RailContentCardTitle>` baked text-row-emphasis (17/600)
            so every Labour entry "On-site" / "Travel" rendered at the
            same scale as the technician group heading. Truncation +
            min-width are preserved so long values still clip. */}
        <span className="text-row text-text-primary truncate min-w-0">
          {subrow.title.text}
        </span>
        {subrow.title.chip && <RailChipFromDescriptor chip={subrow.title.chip} />}
        {subrow.title.value && (
          /* 2026-05-08 Labour typography remap — trailing value moves
             from text-row-emphasis font-mono (17/600 mono) to
             text-row sans-serif. tabular-nums keeps the value column-
             aligned without the family swap. */
          <span className="text-row tabular-nums text-text-primary shrink-0">
            {subrow.title.value}
          </span>
        )}
      </div>
      {subrow.meta && (
        /* 2026-05-08 Labour typography remap — meta wrapper drops
           font-mono. The inner spans keep tabular-nums for column
           alignment; family stays sans-serif so the meta line matches
           Equipment's meta line. */
        <RailContentCardMeta className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "tabular-nums",
              subrow.meta.leftTruncate && "truncate min-w-0",
            )}
          >
            {subrow.meta.leftText}
          </span>
          <span className="tabular-nums shrink-0">{subrow.meta.rightText}</span>
        </RailContentCardMeta>
      )}
    </RailContentCardSubrow>
  );
}
