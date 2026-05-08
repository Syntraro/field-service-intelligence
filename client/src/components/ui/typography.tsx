/**
 * Canonical typography primitives + class constants.
 *
 * Phase H1 (2026-05-07).
 *
 * Single source for the role-based typography classes that feature
 * components compose to render entity names, secondary metadata, section
 * headers, and link text. The audit in CHANGELOG > "Communications Hub
 * Typography Drift" called out the three structural failures that caused
 * the Comms Hub to keep drifting:
 *
 *   1. The class strings were re-derived per file (`PRIMARY_VALUE_CLASS`,
 *      `LINK_CLASS`, etc).
 *   2. The canonical class-constant library lived under a list-page name
 *      (`list-surface.tsx > listPrimaryClass`) so panels never reached
 *      for it.
 *   3. Tests checked source strings, not architecture.
 *
 * This module is the new top-level home. Feature components MUST import
 * from here when they need an entity name / meta line / section label /
 * link text — they MUST NOT define their own `*_CLASS` constants.
 *
 * The class-string constants are exported for callers that need to apply
 * a class via `cn()` or to compose with their own layout. The component
 * primitives are the preferred surface; constants exist for the rare
 * composition case (e.g. inside a `<Link>` className that already does
 * other things).
 *
 * Token alignment
 * ---------------
 * The role-class values pin the canonical Tailwind tokens declared in
 * `tailwind.config.ts > theme.fontSize`:
 *
 *   • ENTITY_NAME_CLASS      → text-caption + font-medium (14px / fw 500)
 *   • ENTITY_META_CLASS      → text-helper (13px / fw 400) + muted
 *   • SECTION_LABEL_CLASS    → text-label (13px / fw 500 uppercase tracked)
 *   • ENTITY_LINK_CLASS      → text-brand (canonical brand color) + hover underline
 *
 * Operational density recalibration (2026-05-07 follow-up to H1/H2):
 *   • Primary entity name dropped from `text-row-emphasis` (15px / fw 500)
 *     to `text-caption font-medium` (14px / fw 500). The reference
 *     baseline is the row label density of the dashboard's
 *     `OperationalAlertsCard` — operational CRM rows at ~14px / 500.
 *   • Hierarchy stays intact:
 *       primary  (entity name) — 14px / fw 500
 *       secondary (entity meta) — 13px / fw 400 + muted
 *   • Recalibration was made at the canonical primitive layer so every
 *     dependent surface (Contacts list, ContactDetailsPanel, list pages
 *     via `listPrimaryClass`, communications rows, open-job lists,
 *     anything else composing `EntityName` / `ENTITY_NAME_CLASS`) inherits
 *     automatically. No per-screen patching.
 *   • Compositional, not new tokens: `text-caption` is the existing 14px
 *     size token; `font-medium` is the standard Tailwind weight utility.
 *     The architectural guard forbids `font-bold` / `font-semibold` but
 *     allows `font-medium`.
 *
 * `text-helper` is the canonical secondary-tier token for dense panels
 * and lists. `text-caption` (14px) is the new primary-name size as well
 * as the existing tabular-metadata size — same pixel target, different
 * weight (medium vs regular).
 *
 * Muted color: standardize on `text-muted-foreground` going forward.
 * `text-text-muted` survives only inside `list-surface.tsx > listSecondaryClass`
 * for visual back-compat with existing list pages; it is NOT a target
 * for new code.
 */

import { Link } from "wouter";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────
// Canonical class constants — single source of truth.
// ────────────────────────────────────────────────────────────────────

/**
 * Primary entity row text — non-link variant. Pair with `text-foreground`.
 *
 * 2026-05-07 recalibration: composition is `text-caption font-medium`
 * (14px / fw 500) — operational CRM density, matches the
 * `OperationalAlertsCard` row labels. Was `text-row-emphasis` (15/500).
 */
export const ENTITY_NAME_CLASS = "text-caption font-medium truncate";

/**
 * Primary entity row text — link variant. Brand-green + hover underline.
 * Same size token as `ENTITY_NAME_CLASS`.
 */
export const ENTITY_NAME_LINK_CLASS =
  "text-caption font-medium truncate text-brand hover:underline";

/** Secondary metadata line — recessed muted text. Compact (13px). */
export const ENTITY_META_CLASS = "text-helper text-muted-foreground truncate";

/** Section header (Client / Location / Open Jobs). Uppercase tracked via @layer. */
export const SECTION_LABEL_CLASS = "text-label text-muted-foreground";

/** Link text without entity-name sizing — for inline anchors / chips. */
export const ENTITY_LINK_CLASS = "text-brand hover:underline";

// ────────────────────────────────────────────────────────────────────
// EntityName — primary identifier for an entity in a row / panel
// ────────────────────────────────────────────────────────────────────

interface EntityNameProps {
  children: ReactNode;
  /** When set, renders as a wouter `<Link>` with brand-green styling. */
  href?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Primary entity name. Renders as a `<Link>` when `href` is set
 * (brand-green link styling), otherwise as a `<span>` with `text-foreground`.
 */
export function EntityName({
  children,
  href,
  className,
  "data-testid": testId,
}: EntityNameProps) {
  if (href) {
    return (
      <Link
        href={href}
        className={cn(ENTITY_NAME_LINK_CLASS, className)}
        data-testid={testId}
      >
        {children}
      </Link>
    );
  }
  return (
    <span
      className={cn(ENTITY_NAME_CLASS, "text-foreground", className)}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// EntityMeta — recessed secondary metadata line
// ────────────────────────────────────────────────────────────────────

interface EntityMetaProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Secondary metadata line. Used for company / location subline, phone /
 * email composite line, job summary subtext, etc. Compact (13px) muted.
 */
export function EntityMeta({
  children,
  className,
  "data-testid": testId,
}: EntityMetaProps) {
  return (
    <span
      className={cn(ENTITY_META_CLASS, className)}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// SectionLabel — header for a sectioned card / panel
// ────────────────────────────────────────────────────────────────────

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Section header (CLIENT, LOCATION, OPEN JOBS, …). Uppercase + tracked
 * automatically by `text-label`'s `@layer components` rule in index.css.
 * Renders as `<h3>` for semantic grouping inside a panel.
 */
export function SectionLabel({
  children,
  className,
  "data-testid": testId,
}: SectionLabelProps) {
  return (
    <h3
      className={cn(SECTION_LABEL_CLASS, className)}
      data-testid={testId}
    >
      {children}
    </h3>
  );
}

// ────────────────────────────────────────────────────────────────────
// EntityLink — inline link text without entity-name sizing
// ────────────────────────────────────────────────────────────────────

interface EntityLinkProps {
  children: ReactNode;
  href: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Inline brand-green link — for anchors / chips that are NOT a primary
 * entity name. Pair with whichever size token the caller's surface needs
 * (e.g. `text-helper` for a meta-line link).
 */
export function EntityLink({
  children,
  href,
  className,
  "data-testid": testId,
}: EntityLinkProps) {
  return (
    <Link
      href={href}
      className={cn(ENTITY_LINK_CLASS, className)}
      data-testid={testId}
    >
      {children}
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// EntityRow — name + meta composition primitive
// ────────────────────────────────────────────────────────────────────

interface EntityRowProps {
  /** Optional leading icon / avatar. */
  icon?: ReactNode;
  /** Primary entity name content. Rendered through `<EntityName>`. */
  name: ReactNode;
  /** Optional secondary metadata. Rendered through `<EntityMeta>`. */
  meta?: ReactNode;
  /** Optional trailing slot — small icon, badge, action button. */
  trailing?: ReactNode;
  /** When set, the entity name renders as a Link to this href. */
  href?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Stacked entity row composition.
 *
 *   [icon]  Entity name
 *           Secondary meta line                        [trailing]
 *
 * No padding / border / outer container styling — call sites decide the
 * surrounding shell (rail card, panel section, list cell). The primitive
 * only owns the typography composition + the icon-name-meta-trailing
 * arrangement.
 */
export function EntityRow({
  icon,
  name,
  meta,
  trailing,
  href,
  className,
  "data-testid": testId,
}: EntityRowProps) {
  return (
    <div
      className={cn("flex items-start gap-2.5", className)}
      data-testid={testId}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1 leading-snug">
        <div>
          <EntityName href={href}>{name}</EntityName>
        </div>
        {meta != null && (
          <div className="mt-0.5">
            <EntityMeta>{meta}</EntityMeta>
          </div>
        )}
      </div>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </div>
  );
}
