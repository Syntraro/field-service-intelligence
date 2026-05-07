/**
 * Top-header trigger for the Communications Hub — Messages entry.
 *
 * Visual contract — matches the Activity / Tasks / Help triggers in
 * `App.tsx`: icon-only `h-8 w-8 p-0`, dark tonal at rest, brand-green
 * accent when "active" (i.e. the user is already on /communications).
 *
 * Unread badge mirrors the Tasks counter shape exactly:
 *   `bg-brand text-white rounded-full h-4 min-w-4 px-1 text-helper`
 * absolute-positioned in the top-right of the trigger.
 */

import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessagesHeaderButtonProps {
  active: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function MessagesHeaderButton({
  active,
  unreadCount,
  onClick,
}: MessagesHeaderButtonProps) {
  const aria = unreadCount > 0 ? `Messages (${unreadCount} unread)` : "Messages";
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-expanded={active}
      aria-label={aria}
      data-testid="button-messages-header"
      title="Messages"
      className={cn(
        "relative h-8 w-8 p-0 inline-flex items-center justify-center",
        !active && "bg-slate-800/60 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white",
        active && "bg-brand border-brand text-white hover:bg-brand-hover hover:text-white",
      )}
    >
      <MessageSquare className="h-4 w-4" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-brand text-white border border-header-bg h-4 min-w-4 px-1 text-helper"
          data-testid="button-messages-header-badge"
        >
          {unreadCount > 20 ? "20+" : unreadCount}
        </span>
      )}
    </Button>
  );
}
