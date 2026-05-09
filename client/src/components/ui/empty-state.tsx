/**
 * EmptyState — back-compat shim over StateBlock.
 *
 * 2026-03-04: Created (UI Polish Pass). Standardized 28+ inline patterns.
 * 2026-05-09: Converted to shim. New code should use StateBlock descriptors
 *   passed through EntityListTable or rendered directly; EmptyState remains
 *   available for existing 21-file import graph without changes.
 *
 * Migration: callers can switch to
 *   <StateBlock kind="empty" title={message} description={description} customIcon={icon} />
 * when they want the Phase H1 typography tokens directly.
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { StateBlock } from "@/components/ui/state-block";

interface EmptyStateProps {
  /** Lucide icon component (optional). */
  icon?: LucideIcon;
  /** Primary message. */
  message: string;
  /** Optional secondary description. */
  description?: string;
  /**
   * Optional action ReactNode. When provided, the legacy layout is used
   * because ReactNode actions cannot be mapped to StateBlock descriptors.
   * New code should pass typed `primaryAction` to StateBlock directly.
   */
  action?: React.ReactNode;
  /** Additional class names applied to the root wrapper. */
  className?: string;
}

export function EmptyState({ icon: Icon, message, description, action, className }: EmptyStateProps) {
  // Legacy path: ReactNode action cannot be expressed as a StateBlock descriptor.
  // Render original layout to avoid breaking callers.
  if (action) {
    return (
      <div className={cn("text-center py-12", className)}>
        {Icon && <Icon className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />}
        <p className="text-sm text-muted-foreground">{message}</p>
        {description && (
          <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
        )}
        <div className="mt-4">{action}</div>
      </div>
    );
  }

  // Standard path: delegate to StateBlock.
  const block = <StateBlock kind="empty" title={message} description={description} customIcon={Icon} />;
  if (className) return <div className={className}>{block}</div>;
  return block;
}

