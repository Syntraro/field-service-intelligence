import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * TablePageShell - Standardized page wrapper for table/list pages.
 * Provides consistent width, padding, and spacing across Jobs, Invoices, Quotes, Clients pages.
 * Reference: Jobs.tsx wrapper classes (p-6 space-y-6)
 */

interface TablePageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Page title displayed in the header */
  title: string;
  /** Action buttons/elements displayed on the right side of the header */
  actions?: React.ReactNode;
  /** Additional class names for the outer wrapper */
  className?: string;
  /** Page content (filters, table, etc.) */
  children: React.ReactNode;
}

const TablePageShell = React.forwardRef<HTMLDivElement, TablePageShellProps>(
  ({ title, actions, className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("p-6 space-y-6", className)}
        {...props}
      >
        {/* Page Header Row */}
        <div className="flex items-center justify-between">
          {/* List Pages Refactor: upgraded from text-lg to text-2xl for stronger page headers */}
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {actions}
        </div>

        {/* Page Content */}
        {children}
      </div>
    );
  }
);

TablePageShell.displayName = "TablePageShell";

export { TablePageShell };
export type { TablePageShellProps };
