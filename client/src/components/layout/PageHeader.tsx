/**
 * PageHeader — Shared page header for list/table pages.
 * Renders a prominent title (text-2xl font-semibold), optional subtitle,
 * and a right-side actions slot.
 *
 * List Pages Refactor (2026-03-04)
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page title — rendered as h1 */
  title: string;
  /** Optional muted subtitle below the title */
  subtitle?: string;
  /** Right-side actions (buttons, links, etc.) */
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
