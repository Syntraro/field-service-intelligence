import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** Optional muted subtitle rendered below the title. Increases header height slightly. */
  subtitle?: string;
  /** Right-side slot: search, filters, actions, create button. */
  children?: ReactNode;
  className?: string;
}

/**
 * Canonical full-width page header.
 * Left: page title (+ optional subtitle). Right: action controls slot.
 * Used by Invoices, Jobs, Quotes, Leads.
 */
export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "bg-app-bg flex items-center px-6 shrink-0",
        subtitle ? "min-h-[72px] py-4" : "h-[60px]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 w-full min-w-0">
        <div className="shrink-0">
          <h1 className="text-title font-medium text-slate-900 leading-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
