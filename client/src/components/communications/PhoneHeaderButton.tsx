/**
 * Top-header trigger for the Communications Hub — Calls entry.
 *
 * Same icon-only `h-8 w-8 p-0` shape as the Messages and Activity
 * triggers. Click navigates to `/communications?module=calls` so the
 * hub opens directly into the Calls view.
 */

import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhoneHeaderButtonProps {
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function PhoneHeaderButton({
  active,
  unreadCount,
  onClick,
}: PhoneHeaderButtonProps) {
  const aria =
    unreadCount > 0 ? `Calls (${unreadCount} missed)` : "Calls";
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-expanded={active}
      aria-label={aria}
      data-testid="button-phone-header"
      title="Calls"
      className={cn(
        "relative h-8 w-8 p-0 inline-flex items-center justify-center",
        !active && "bg-slate-800/60 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white",
        active && "bg-brand border-brand text-white hover:bg-brand-hover hover:text-white",
      )}
    >
      <Phone className="h-4 w-4" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-brand text-white border border-header-bg h-4 min-w-4 px-1 text-helper"
          data-testid="button-phone-header-badge"
        >
          {unreadCount > 20 ? "20+" : unreadCount}
        </span>
      )}
    </Button>
  );
}
