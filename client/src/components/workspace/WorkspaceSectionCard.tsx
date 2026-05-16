import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/typography";
import { SECTION_CARD_HEADER_H } from "./workspace.constants";

interface WorkspaceSectionCardProps {
  title: string;
  /** Icon button or badge in the header right slot. */
  action?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  /** Remove default px-3 pb-3 body padding for edge-to-edge content. */
  noPadding?: boolean;
  /**
   * "section" (default) — flush divider style used throughout the rail.
   * "card" — white card with border + shadow, offset from rail edges by mx-3 my-2.
   */
  variant?: "section" | "card";
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Canonical section card primitive for operational right rails.
 *
 * Rules:
 * - Uses SectionLabel from typography — no local text-* class overrides.
 * - Collapse uses grid-template-rows trick (no max-height artifacts).
 * - No domain knowledge. No domain imports.
 */
export function WorkspaceSectionCard({
  title,
  action,
  collapsible = false,
  defaultCollapsed = false,
  loading = false,
  empty = false,
  emptyText = "No data.",
  noPadding = false,
  variant = "section",
  children,
  className,
  "data-testid": testId,
}: WorkspaceSectionCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isOpen = !collapsible || !collapsed;

  const isCard = variant === "card";

  return (
    <div
      className={cn(
        isCard
          ? "mx-3 my-2 rounded-md border border-slate-200 bg-white shadow-sm"
          : "border-b border-border last:border-b-0",
        className,
      )}
      data-testid={testId}
    >
      {/* Header row */}
      <div
        className={cn(
          "flex items-center gap-2 px-3",
          collapsible && "cursor-pointer select-none",
        )}
        style={{ minHeight: SECTION_CARD_HEADER_H }}
        onClick={collapsible ? () => setCollapsed((v) => !v) : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? isOpen : undefined}
      >
        <SectionLabel className="flex-1 truncate">{title}</SectionLabel>
        {collapsible ? (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
        ) : (
          action && <div className="shrink-0">{action}</div>
        )}
      </div>

      {/* Body — grid-template-rows collapse avoids max-height easing artifacts */}
      <div
        className="grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {loading ? (
            <p className={cn("text-helper text-muted-foreground", !noPadding && "px-3 pb-3")}>
              Loading…
            </p>
          ) : empty ? (
            <p className={cn("text-helper text-muted-foreground", !noPadding && "px-3 pb-3")}>
              {emptyText}
            </p>
          ) : (
            <div className={cn(!noPadding && (isCard ? "px-3 pb-2.5" : "px-3 pb-3"))}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
