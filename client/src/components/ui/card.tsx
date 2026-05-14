import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // 2026-04-29 Color Phase 3: hardcoded `shadow-[0_1px_2px_rgba(0,0,0,0.05)]`
      // migrated to the canonical `shadow-card` token (defined in
      // `tailwind.config.ts` and mirrored by `--card-shadow` in
      // `index.css`). Soft 8px-elevation lift consistent across every
      // `<Card>` consumer; spec target = "lift from background without
      // heavy shadows".
      "shadcn-card rounded-md border bg-card border-card-border text-card-foreground shadow-card",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader"

// 2026-04-29 Typography Phase B — Card primitive defaults migrated to
// canonical semantic tokens. Previously CardTitle defaulted to `text-2xl`
// (28.5px on this app's 19px html root, per the typography audit), which
// every consumer overrode. CardDescription defaulted to `text-sm` and
// the legacy shadcn `text-muted-foreground` color token. Both now resolve
// through the canonical tokens registered in `tailwind.config.ts` and
// `client/src/index.css`. The previous `leading-none` / `tracking-tight`
// CardTitle modifiers are dropped — they were compensations for the
// oversized 28.5px default and add no value at the new 16px size.
//
// Behavior contract: pages that override the default (e.g.
// `<CardTitle className="text-base font-medium">`) are unchanged because
// the override className still wins via cn(). Pages that did NOT
// override now render at the new canonical size — see Phase B follow-up
// for the (small) list of impacted consumers.
const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-section-title", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-caption text-text-muted", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

/**
 * Canonical CardShell primitives (2026-05-07).
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ READ THIS BEFORE BUILDING A DASHBOARD / LIST CARD.              │
 * │                                                                 │
 * │ This is the canonical "list card" / "dashboard card" shell for  │
 * │ the app. It is a thin layer over the shadcn `<Card>` primitive  │
 * │ above, adding the header band + body + footer rhythm that every │
 * │ dashboard / right-rail / list card was previously hand-rolling. │
 * │                                                                 │
 * │ Use these subcomponents in this exact shape:                    │
 * │                                                                 │
 * │   <CardShell>                                                   │
 * │     <CardShellHeader>                                           │
 * │       <CardShellTitle icon={Wrench}>PM Health</CardShellTitle>  │
 * │       <CardShellAction>…View all link…</CardShellAction>        │
 * │     </CardShellHeader>                                          │
 * │     <CardShellBody>                                             │
 * │       (rows / list / custom content)                            │
 * │     </CardShellBody>                                            │
 * │     <CardShellFooter>…optional…</CardShellFooter>               │
 * │   </CardShell>                                                  │
 * │                                                                 │
 * │ For the most common shape — title + icon + clickable rows of    │
 * │ label+count — use `<KpiShell>` + `<KpiRow>` instead. They wrap  │
 * │ CardShell with the standard header/body and lock the row        │
 * │ geometry observed across the dashboard (px-4 py-1.5, urgent     │
 * │ state, chevron affordance).                                     │
 * │                                                                 │
 * │ Rules:                                                          │
 * │  1. Do NOT add raw `bg-white` / `border-[#e2e8f0]` / inline     │
 * │     `boxShadow` / `border-slate-200` to a card's outer chrome.  │
 * │     CardShell already locks bg-card / border-card-border /      │
 * │     shadow-card via the canonical tokens.                       │
 * │  2. Do NOT add raw `text-sm font-semibold text-[#111827]` to a  │
 * │     header title — `<CardShellTitle>` locks that.               │
 * │  3. Do NOT build a one-off local `CardShell` function inside a  │
 * │     dashboard component. Import these primitives instead.       │
 * │  4. Card-internal row layouts (rich rows with description text, │
 * │     icon-bg blocks, multi-column metadata) stay in the calling  │
 * │     component — only the outer chrome and header band are       │
 * │     locked here. The shell is intentionally width-neutral and   │
 * │     layout-neutral; pass `className="flex flex-col h-full"` etc.│
 * │     when grid layouts demand it.                                │
 * │                                                                 │
 * │ Structural contract (locked here):                              │
 * │   CardShell         rounded-md border bg-card border-card-border│
 * │                     shadow-card overflow-hidden                 │
 * │   CardShellHeader   px-4 py-2.5 border-b border-card-border     │
 * │                     flex items-center justify-between gap-3     │
 * │   CardShellTitle    text-sm font-semibold text-text-primary     │
 * │                     (with optional icon, optional iconBg block) │
 * │   CardShellBody     no padding by default (full-bleed for rows);│
 * │                     pass `padded` to apply px-4 py-2.5          │
 * │   CardShellFooter   px-4 py-2.5 border-t border-card-border     │
 * │                     flex items-center justify-end gap-2         │
 * │   KpiRow            px-4 py-1.5 with built-in urgent state +    │
 * │                     trailing chevron                            │
 * └─────────────────────────────────────────────────────────────────┘
 */

// ── CardShell (outer chrome) ───────────────────────────────────────

export interface CardShellProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `CardShell` is the outer wrapper for dashboard / list / right-rail
 * cards. Reuses the shadcn `<Card>` primitive (so the canonical
 * `bg-card` / `border-card-border` / `shadow-card` tokens stay in
 * sync) and adds `overflow-hidden` so the header divider clips
 * cleanly against the rounded corners.
 *
 * 2026-05-07: replaces ~7 hand-rolled `bg-white border border-[#e2e8f0]`
 * + inline `boxShadow` outer divs across the dashboard / activity
 * surfaces. Layout classes (`flex flex-col h-full`, etc.) are passed
 * through via className — CardShell stays width- and layout-neutral.
 */
const CardShell = React.forwardRef<HTMLDivElement, CardShellProps>(
  ({ className, ...props }, ref) => (
    <Card
      ref={ref}
      className={cn("overflow-hidden", className)}
      {...props}
    />
  ),
);
CardShell.displayName = "CardShell";

// ── CardShellHeader ────────────────────────────────────────────────

export interface CardShellHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Compact band: locks `h-11` (44px) instead of `py-2.5`. Pair with
   * `<CardShellTitle density="compact">` to produce the detail-page
   * SectionHead rhythm (13px uppercase tracked title at a 44px header
   * height). Default false renders the standard `py-2.5` dashboard
   * rhythm. Binary by design — additional density tiers should be
   * added only with evidence of repetition.
   */
  compact?: boolean;
}

/**
 * `CardShellHeader` locks the header band: 4-unit horizontal padding,
 * 2.5-unit vertical padding, bottom divider on the canonical
 * `border-card-border` token, and a flex justify-between row so a
 * `<CardShellTitle>` and `<CardShellAction>` sit on opposite ends.
 * The 3-unit gap matches the dashboard rhythm.
 *
 * 2026-05-07 (Tier 2): added `compact` prop to absorb JobDetailPage's
 * `SectionHead` h-11 rhythm without forking the primitive.
 */
const CardShellHeader = React.forwardRef<HTMLDivElement, CardShellHeaderProps>(
  ({ compact = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between gap-3 px-4 border-b border-card-border",
        compact ? "h-11" : "py-2.5",
        className,
      )}
      {...props}
    />
  ),
);
CardShellHeader.displayName = "CardShellHeader";

// ── CardShellTitle ─────────────────────────────────────────────────

export interface CardShellTitleProps
  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, "title"> {
  /** Icon component rendered to the left of the title. */
  icon?: React.ElementType;
  /** Tailwind text color class for the icon (e.g. "text-violet-600"). */
  iconColor?: string;
  /**
   * Optional tinted background block for the icon (e.g.
   * "bg-emerald-100 dark:bg-emerald-950/30"). Switches the icon
   * presentation from "bare icon" to "icon in a colored chip".
   * Used by financial / capacity / alerts cards; omit for the
   * minimal pattern (PM Health, Quote Pipeline, Revenue Center).
   */
  iconBg?: string;
  /**
   * Typography density. `"standard"` (default) renders the canonical
   * dashboard heading (`text-sm font-semibold text-text-primary`).
   * `"compact"` renders the detail-page SectionHead heading
   * (`text-helper font-semibold uppercase tracking-[0.08em]
   * text-text-secondary`) and is intended to pair with
   * `<CardShellHeader compact>`. Binary by design — keep both
   * variants narrow until a third is justified by repetition.
   */
  density?: "standard" | "compact";
}

/**
 * `CardShellTitle` locks the canonical header typography
 * (`text-sm font-semibold text-text-primary`) plus the optional
 * leading icon. The leading element renders in two variants based on
 * whether `iconBg` is supplied:
 *   • Bare:    `<Icon className="h-3.5 w-3.5 ${iconColor}" />`
 *   • Chipped: `<div className="p-1.5 rounded-md ${iconBg}"><Icon /></div>`
 *
 * Truncates by default — dashboard titles routinely sit next to
 * action buttons in tight grid columns.
 *
 * 2026-05-07 (Tier 2): added `density="compact"` variant to absorb
 * JobDetailPage's `SectionHead` typography (text-helper uppercase
 * tracked) without forking the primitive.
 */
const CardShellTitle = React.forwardRef<HTMLHeadingElement, CardShellTitleProps>(
  (
    { icon: Icon, iconColor, iconBg, density = "standard", className, children, ...props },
    ref,
  ) => (
    <div className="flex items-center gap-2 min-w-0">
      {Icon && iconBg ? (
        <div className={cn("p-1.5 rounded-md shrink-0", iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        </div>
      ) : Icon ? (
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
      ) : null}
      <h3
        ref={ref}
        className={cn(
          "m-0 truncate",
          density === "compact"
            ? "text-helper font-semibold uppercase tracking-[0.08em] text-text-secondary"
            : "text-sm font-semibold text-text-primary",
          className,
        )}
        {...props}
      >
        {children}
      </h3>
    </div>
  ),
);
CardShellTitle.displayName = "CardShellTitle";

// ── CardShellAction ────────────────────────────────────────────────

export interface CardShellActionProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `CardShellAction` is the right-aligned slot inside a
 * `<CardShellHeader>`. Use it for "View all" links, secondary CTAs,
 * or status badges. Locks `shrink-0` so the slot survives narrow
 * grid columns without the title squeezing it out.
 */
const CardShellAction = React.forwardRef<HTMLDivElement, CardShellActionProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 shrink-0", className)}
      {...props}
    />
  ),
);
CardShellAction.displayName = "CardShellAction";

// ── CardShellBody ──────────────────────────────────────────────────

export interface CardShellBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Apply standard 4/2.5 internal padding. Default false — list cards
   * render full-bleed rows that own their own padding, so the body
   * shouldn't add extra horizontal space. Toggle on for content cards
   * that need a comfortable inset.
   */
  padded?: boolean;
}

/**
 * `CardShellBody` is the optional middle section. It is intentionally
 * thin: full-bleed by default so list/row patterns can render their
 * own padding, with an opt-in `padded` switch for content cards.
 * Layout concerns (flex-1, h-full, scroll containers) ride through
 * className — the body never imposes a height contract.
 */
const CardShellBody = React.forwardRef<HTMLDivElement, CardShellBodyProps>(
  ({ padded = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(padded && "px-4 py-2.5", className)}
      {...props}
    />
  ),
);
CardShellBody.displayName = "CardShellBody";

// ── CardShellFooter ────────────────────────────────────────────────

export interface CardShellFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * `CardShellFooter` mirrors `CardShellHeader`: same horizontal
 * rhythm, same divider color, but sits on the bottom and
 * right-aligns its actions. Use for Save/Cancel pairs or
 * summary totals beneath a list.
 */
const CardShellFooter = React.forwardRef<HTMLDivElement, CardShellFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-end gap-2 px-4 py-2.5 border-t border-card-border",
        className,
      )}
      {...props}
    />
  ),
);
CardShellFooter.displayName = "CardShellFooter";

// ── KpiShell (convenience wrapper for the dashboard pattern) ──────

export interface KpiShellProps extends Omit<CardShellProps, "title" | "children"> {
  title: string;
  icon?: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  /** Right-aligned action slot inside the header (link, button, badge). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * `KpiShell` is the convenience composition for the most common
 * dashboard shape: header (icon + title + optional action) plus a
 * full-bleed body that hosts a list of `<KpiRow>` items (or any
 * other content). It is purely a thin wrapper over `CardShell` +
 * `CardShellHeader` + `CardShellTitle` + `CardShellBody`, intended
 * to keep callsites short — the underlying primitives remain
 * available for cards that need a non-standard layout.
 *
 * The body inherits `flex-1` so that when the parent grid stretches
 * the card vertically, the body absorbs the extra space (matching
 * the dashboard's equalized-row-height behavior).
 */
const KpiShell = React.forwardRef<HTMLDivElement, KpiShellProps>(
  ({ title, icon, iconColor, iconBg, action, children, className, ...props }, ref) => (
    <CardShell ref={ref} className={cn("flex flex-col", className)} {...props}>
      <CardShellHeader>
        <CardShellTitle icon={icon} iconColor={iconColor} iconBg={iconBg}>
          {title}
        </CardShellTitle>
        {action ? <CardShellAction>{action}</CardShellAction> : null}
      </CardShellHeader>
      <CardShellBody className="flex-1">{children}</CardShellBody>
    </CardShell>
  ),
);
KpiShell.displayName = "KpiShell";

// ── KpiRow (label + count list row) ───────────────────────────────

export interface KpiRowProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** Left-side row label. */
  label: string;
  /** Right-side numeric count. */
  count: number;
  /** Highlight as urgent (red tint + red text) when count > 0. */
  urgent?: boolean;
  /** Last row in the list — drops the bottom divider. */
  last?: boolean;
  /** Show the trailing chevron affordance. Default true. */
  showChevron?: boolean;
}

/**
 * `KpiRow` renders a clickable label + count row, the most common
 * dashboard primitive. Locks:
 *   • px-4 py-1.5 row geometry (matches PMHealthCard, the visual
 *     reference for the dashboard rhythm)
 *   • urgent state: red-50/60 background + red-600 text (only when
 *     `urgent` AND `count > 0` — the row stays neutral when an
 *     urgent metric is at zero, so we don't false-alarm)
 *   • neutral hover: pale-green tint that matches the dashboard
 *     row-hover affordance (`#F0F5F0`); not yet a token
 *   • trailing chevron in `text-[#94a3b8]` that animates on hover
 *
 * Caller controls click behavior via standard button props
 * (onClick, disabled, data-testid, aria-*). The button is the row's
 * full-width hit target.
 */
const KpiRow = React.forwardRef<HTMLButtonElement, KpiRowProps>(
  (
    { label, count, urgent = false, last = false, showChevron = true, className, ...props },
    ref,
  ) => {
    const isUrgentActive = urgent && count > 0;
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "w-full flex items-center justify-between px-4 py-1.5 text-left transition-colors group",
          isUrgentActive ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-[#F0F5F0]",
          !last && "border-b border-card-border",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "text-xs",
            isUrgentActive ? "text-red-600 font-medium" : "text-text-muted",
          )}
        >
          {label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              isUrgentActive
                ? "text-red-600"
                : count > 0
                  ? "text-text-primary"
                  : "text-text-muted",
            )}
          >
            {count}
          </span>
          {showChevron && (
            <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8] group-hover:text-text-primary transition-colors" />
          )}
        </div>
      </button>
    );
  },
);
KpiRow.displayName = "KpiRow";

// ── CardMetricBlock (label + value tile) ──────────────────────────

export interface CardMetricBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Top label — uppercase, tracked, muted. */
  label: string;
  /** Bottom value — pre-formatted text or JSX. CardMetricBlock locks
   *  `tabular-nums font-semibold` and the size; a caller wrapping the
   *  value in their own `<span className="text-emerald-700">…</span>`
   *  will compose with the size/weight here, not fight it. */
  value: React.ReactNode;
  /**
   * Class applied to the value span (e.g. `"text-emerald-700"` for
   * positive profit, `"text-rose-600"` for loss). Pure presentational —
   * no tone derivation logic lives here. Defaults to
   * `text-text-primary`.
   */
  valueClassName?: string;
  /**
   * Emphasize the value at `text-base` instead of `text-sm`. Used for
   * the headline KPI inside a metric cluster (e.g. Profit Margin among
   * the line-items profitability tiles). Visual flag only — no business
   * meaning attached.
   */
  emphasis?: boolean;
  /** Horizontal alignment of label and value. Defaults to `"end"` (right-aligned)
   *  to match the legacy line-items profitability usage. Pass `"start"` for
   *  left-aligned KPI cells (e.g. ScheduledRevenue strip, Collections summary). */
  align?: "start" | "end";
}

/**
 * `CardMetricBlock` is a pure presentational label-over-value tile,
 * the canonical primitive for the line-items profitability cluster
 * and any future detail-page metric strip.
 *
 * 2026-05-07 (Tier 2): extracted from `LineItemsCard.HeaderMetricBlock`
 * verbatim except for token swaps (slate-500 → text-text-muted on the
 * label; slate-700 default value color → text-text-primary). Caller
 * controls tone via `valueClassName` and emphasis via `emphasis`.
 *
 * Strict no-business-math rule: this primitive accepts pre-formatted
 * `value` (string or JSX). Currency formatting, profit/margin
 * calculation, and surface-specific tax logic stay in the caller (the
 * `useLineItemsDrafts` hook for line items, the page itself
 * elsewhere). Do not extend `CardMetricBlock` with computation
 * helpers — a future surface can add a higher-level wrapper if a
 * shared math API is genuinely warranted.
 */
const CardMetricBlock = React.forwardRef<HTMLDivElement, CardMetricBlockProps>(
  (
    { label, value, valueClassName, emphasis = false, align, className, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn("flex flex-col leading-tight", align === "start" ? "items-start" : "items-end", className)}
      {...props}
    >
      <span className="text-label text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums font-semibold",
          emphasis ? "text-base" : "text-sm",
          valueClassName ?? "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  ),
);
CardMetricBlock.displayName = "CardMetricBlock";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  // 2026-05-07 — canonical card-shell primitives. See block comment above.
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
  CardShellBody,
  CardShellFooter,
  KpiShell,
  KpiRow,
  // 2026-05-07 (Tier 2) — presentational metric tile primitive.
  CardMetricBlock,
}
