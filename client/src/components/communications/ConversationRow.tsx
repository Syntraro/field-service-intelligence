/**
 * One row in the left conversation list.
 *
 *   [avatar]  Display name              · timestamp
 *             Preview line (single, truncated)   · unread dot
 *
 * Typography (canonical compact tokens):
 *   • Name:    text-row-emphasis (15px / 500)
 *   • Preview: text-helper (13px / muted)
 *   • Time:    text-helper (13px / muted)
 *
 * Selected state uses a subtle neutral accent — never an aggressive blue
 * fill. Hover uses the canonical `hover-elevate` utility.
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Phone } from "lucide-react";
import type { CommunicationThread } from "@shared/communicationsTypes";
import { getInitials } from "@/lib/getInitials";
import { cn } from "@/lib/utils";

interface ConversationRowProps {
  thread: CommunicationThread;
  selected: boolean;
  onSelect: (id: string) => void;
}

function formatRowTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) {
    return then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const oneDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - then.getTime()) / oneDay);
  if (diffDays < 1) return "Yesterday";
  if (diffDays < 7) return then.toLocaleDateString([], { weekday: "short" });
  return then.toLocaleDateString();
}

export function ConversationRow({ thread, selected, onSelect }: ConversationRowProps) {
  const initials = getInitials({ fullName: thread.contact.displayName });
  const isMissedCall =
    thread.threadType === "unknown" || thread.lastMessagePreview.toLowerCase() === "missed call";
  const isUnread = thread.unreadCount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      data-testid={`conversation-row-${thread.id}`}
      aria-pressed={selected}
      className={cn(
        "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
        selected
          ? "bg-blue-50/60"
          : "hover-elevate active-elevate-2",
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-helper bg-muted">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-snug">
        <div className="flex items-center justify-between gap-2">
          <div
            className={cn(
              "min-w-0 truncate text-row-emphasis",
              isUnread ? "text-foreground" : "text-foreground/90",
            )}
            data-testid="conversation-row-name"
          >
            {thread.contact.displayName}
          </div>
          <div className="shrink-0 text-helper text-muted-foreground">
            {formatRowTime(thread.lastMessageAt)}
          </div>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div
            className={cn(
              "min-w-0 truncate text-helper",
              isUnread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {isMissedCall ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> Missed call
              </span>
            ) : (
              thread.lastMessagePreview
            )}
          </div>
          {isUnread && (
            <span
              className="shrink-0 inline-flex items-center justify-center rounded-full bg-brand text-white h-4 min-w-4 px-1 text-helper"
              data-testid="conversation-row-unread"
              aria-label={`${thread.unreadCount} unread`}
            >
              {thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
