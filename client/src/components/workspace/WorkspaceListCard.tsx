import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface WorkspaceListCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Canonical elevated card shell for workspace entity list surfaces.
 *
 * Provides the outer margin, rounded corners, overflow clip, and subtle
 * shadow that distinguish the list area from the app background on all
 * operational workspace pages (Jobs, Quotes, Leads, Clients, Invoices,
 * Service Plans, Price Book, and sub-tabs within them).
 *
 * Always place WorkspaceCenterPane directly inside this component so that
 * bg-card and the flex column structure are provided consistently.
 */
export function WorkspaceListCard({ children, className }: WorkspaceListCardProps) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 flex flex-col mx-4 mb-6 rounded-md overflow-hidden",
        "shadow-[0_1px_3px_rgba(0,0,0,0.07),0_0_1px_rgba(0,0,0,0.05)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
