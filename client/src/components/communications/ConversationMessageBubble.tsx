/**
 * One message bubble inside the center conversation panel.
 *
 * Visual rules (canonical typography only):
 *   • inbound  → light neutral bubble, left-aligned
 *   • outbound → soft blue bubble, right-aligned
 *   • internal_note → amber tint, left-aligned (visually distinct)
 *
 * Body text uses `text-row` (15px) for readable line wrapping; metadata
 * (sender + time) uses `text-helper` (13px / muted).
 */

import type { CommunicationMessage } from "@shared/communicationsTypes";
import { cn } from "@/lib/utils";

interface ConversationMessageBubbleProps {
  message: CommunicationMessage;
}

function formatBubbleTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ConversationMessageBubble({ message }: ConversationMessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  const isInternal = message.channel === "internal_note";

  const align = isOutbound ? "items-end" : "items-start";

  // Tonal palette pulled from canonical CSS tokens — no raw hex.
  const bubbleClass = isInternal
    ? "bg-amber-50 text-foreground ring-1 ring-amber-100"
    : isOutbound
      ? "bg-blue-50 text-foreground ring-1 ring-blue-100"
      : "bg-muted text-foreground ring-1 ring-border/50";

  return (
    <div
      className={cn("flex flex-col gap-0.5", align)}
      data-testid={`conversation-message-${message.direction}`}
    >
      <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-row leading-snug", bubbleClass)}>
        {message.body}
      </div>
      <div className="text-helper text-muted-foreground px-1">
        {message.senderDisplayName ? `${message.senderDisplayName} · ` : ""}
        {formatBubbleTime(message.createdAt)}
        {isInternal ? " · Internal note" : ""}
      </div>
    </div>
  );
}
