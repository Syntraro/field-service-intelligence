import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * EmptyState - Consistent empty/no-results state for lists and tables.
 *
 * UI Polish Pass: Created 2026-03-04.
 * Standardizes the 28+ inline empty state patterns across the app into
 * one reusable component with consistent spacing, icon sizing, and text styles.
 */

interface EmptyStateProps {
  /** Lucide icon component (optional — text-only if omitted) */
  icon?: LucideIcon;
  /** Primary message (e.g. "No invoices found") */
  message: string;
  /** Optional secondary description */
  description?: string;
  /** Optional action button/link below the text */
  action?: React.ReactNode;
  /** Additional class names */
  className?: string;
}

export function EmptyState({ icon: Icon, message, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("text-center py-12", className)}>
      {Icon && (
        <Icon className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
      )}
      <p className="text-sm text-muted-foreground">{message}</p>
      {description && (
        <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
