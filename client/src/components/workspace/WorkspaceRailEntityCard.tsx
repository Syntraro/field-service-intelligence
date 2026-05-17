import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface WorkspaceRailEntityCardMeta {
  label: string;
  /** Pre-formatted string or ReactNode. */
  value: React.ReactNode;
  /** Applies a semantic color to the value text. Defaults to neutral. */
  tone?: "neutral" | "warning" | "danger";
}

export interface WorkspaceRailEntityCardProps {
  /** Icon rendered inside the entity badge (e.g. FileText, Briefcase). */
  icon?: React.ElementType;
  /**
   * Primary entity display — invoice number, job number, quote number, etc.
   * Pass a fully styled/interactive node (button/link) when SPA navigation is needed.
   * If entityHref is also supplied, this content is wrapped in an <a> tag instead.
   */
  entityLabel: React.ReactNode;
  /**
   * Optional href for the entity label. When provided, entityLabel is wrapped
   * in an <a> for traditional (non-SPA) navigation. For SPA workspaces, omit
   * this and pass navigation inside entityLabel directly (e.g. a button).
   */
  entityHref?: string;
  /**
   * Client / company name. Pass a fully styled/interactive node when navigation
   * is needed, or a plain string for display-only.
   */
  clientName: React.ReactNode;
  /** 1–N metadata fields rendered in a divided row below the entity identity. */
  meta?: WorkspaceRailEntityCardMeta[];
  /** Right-side action slot — typically an ExternalLink icon button. */
  action?: React.ReactNode;
  /** Optional content rendered below the metadata row. */
  footer?: React.ReactNode;
  className?: string;
  testId?: string;
}

const META_VALUE_TONE: Record<NonNullable<WorkspaceRailEntityCardMeta["tone"]>, string> = {
  neutral: "text-foreground",
  warning: "text-amber-600",
  danger:  "text-destructive",
};

/**
 * Canonical top-of-rail entity/client summary card for operational workspaces.
 *
 * Owns the card chrome, icon badge layout, entity identity row, and metadata
 * row. All interactive content (entity links, client links, action buttons) is
 * passed as caller-owned ReactNode slots — no routing logic lives here.
 *
 * Rendering-only — no domain coupling, no data fetching.
 */
export function WorkspaceRailEntityCard({
  icon: Icon,
  entityLabel,
  entityHref,
  clientName,
  meta = [],
  action,
  footer,
  className,
  testId,
}: WorkspaceRailEntityCardProps) {
  return (
    <div
      className={cn("rounded-md border border-border bg-card shadow-sm p-3", className)}
      data-testid={testId}
    >
      {/* ── Top row: icon badge + entity identity + action ── */}
      <div className="flex items-start gap-2.5">
        {Icon && (
          <div className="shrink-0 flex items-center justify-center h-7 w-7 rounded bg-muted mt-0.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {entityHref ? (
            <a
              href={entityHref}
              className="text-row text-brand hover:underline truncate block w-full"
            >
              {entityLabel}
            </a>
          ) : (
            entityLabel
          )}
          {clientName != null && clientName}
        </div>

        {action != null && action}
      </div>

      {/* ── Metadata row ── */}
      {meta.length > 0 && (
        <div className="flex items-stretch mt-2.5 pt-2.5 border-t border-border">
          {meta.map((item, i) => (
            <Fragment key={item.label}>
              {i > 0 && (
                <div className="w-px bg-border mx-3 self-stretch" aria-hidden="true" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-label text-muted-foreground">{item.label}</p>
                <p className={cn("text-helper mt-0.5", META_VALUE_TONE[item.tone ?? "neutral"])}>
                  {item.value}
                </p>
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {footer != null && footer}
    </div>
  );
}
