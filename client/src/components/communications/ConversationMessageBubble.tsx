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

/**
 * Phase 5 (2026-05-08): outbound-SMS status indicator.
 * queued / sent / delivered → muted; failed / undelivered → destructive,
 * still compact. Internal notes and inbound bubbles do not render this.
 */
function smsStatusLabel(
  status: string,
): { text: string; tone: "muted" | "destructive" } | null {
  switch (status) {
    case "queued":
      return { text: "Queued", tone: "muted" };
    case "sent":
      return { text: "Sent", tone: "muted" };
    case "delivered":
      return { text: "Delivered", tone: "muted" };
    case "failed":
      return { text: "Failed", tone: "destructive" };
    case "undelivered":
      return { text: "Undelivered", tone: "destructive" };
    default:
      return null;
  }
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

  const statusInfo =
    isOutbound && message.channel === "sms"
      ? smsStatusLabel(message.status ?? "")
      : null;

  return (
    <div
      className={cn("flex flex-col gap-0.5", align)}
      data-testid={`conversation-message-${message.direction}`}
    >
      <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-row leading-snug", bubbleClass)}>
        {message.body}
      </div>
      <div className="text-caption text-muted-foreground px-1">
        {message.senderDisplayName ? `${message.senderDisplayName} · ` : ""}
        {formatBubbleTime(message.createdAt)}
        {isInternal ? " · Internal note" : ""}
        {statusInfo && (
          <>
            {" · "}
            <span
              className={cn(
                statusInfo.tone === "destructive" ? "text-destructive" : undefined,
              )}
              data-testid={`conversation-message-sms-status-${message.id}`}
            >
              {statusInfo.text}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
