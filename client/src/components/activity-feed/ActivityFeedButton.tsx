/**
 * Header trigger for the global Activity Feed drawer.
 *
 * Mirrors the tonal style of the Tasks button next to it. When the
 * drawer is open the trigger flips to a brand-green accent so the
 * relationship between trigger and panel is visually clear.
 */

import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityFeedButtonProps {
  open: boolean;
  onClick: () => void;
}

export function ActivityFeedButton({ open, onClick }: ActivityFeedButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-expanded={open}
      aria-label="Activity"
      data-testid="button-activity-header"
      className={cn(
        // 2026-05-07 RALPH — Activity trigger is now icon-only. The
        // "Activity" label is communicated via `aria-label` + the title
        // attribute below for screen readers and hover, freeing header
        // space and keeping the trigger compact next to Tasks.
        "relative h-8 w-8 p-0 inline-flex items-center justify-center",
        // Resting tonal style — matches Tasks/Help triggers in the dark header.
        !open && "bg-slate-800/60 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white",
        // Open/active accent — primary green so the trigger reads as the
        // panel's anchor while the drawer is mounted.
        open && "bg-brand border-brand text-white hover:bg-brand-hover hover:text-white",
      )}
      title="Activity"
    >
      <Activity className="h-4 w-4" />
    </Button>
  );
}
