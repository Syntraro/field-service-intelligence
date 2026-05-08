/**
 * Center column — header strip, scrollable message stream, sticky composer.
 *
 * The page chooses what data to feed it; the panel only renders.
 */

import { useEffect, useRef } from "react";
import type { CommunicationMessage, CommunicationThread } from "@shared/communicationsTypes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Phone, Info, MoreHorizontal } from "lucide-react";
import { ConversationMessageBubble } from "./ConversationMessageBubble";
import { ConversationComposer } from "./ConversationComposer";
import { getInitials } from "@/lib/getInitials";
import { cn } from "@/lib/utils";

interface ConversationPanelProps {
  thread: CommunicationThread | null;
  messages: readonly CommunicationMessage[];
  onSend: (input: { channel: "sms" | "internal_note"; body: string }) => void;
  /** 2026-05-08 Phase 5: tenant has an active phone provider. */
  smsAvailable?: boolean;
}

export function ConversationPanel({
  thread,
  messages,
  onSend,
  smsAvailable = false,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the most recent bubble whenever the thread or message
  // count changes. `block: "end"` keeps the latest bubble in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.id, messages.length]);

  if (!thread) {
    return (
      <section
        className="flex-1 min-w-0 flex flex-col bg-card items-center justify-center text-center"
        data-testid="conversation-panel-empty"
      >
        <p className="text-row text-foreground">Select a conversation</p>
        <p className="text-helper text-muted-foreground mt-1">
          Pick a thread from the list to start replying.
        </p>
      </section>
    );
  }

  const initials = getInitials({ fullName: thread.contact.displayName });
  const showChannelTabs = thread.threadType !== "team_chat";

  const badgeLabel =
    thread.contact.type === "client"
      ? "Client"
      : thread.contact.type === "team"
        ? "Team"
        : "Unknown";

  const badgeTone =
    thread.contact.type === "client"
      ? "bg-blue-50 text-blue-700 ring-blue-100"
      : thread.contact.type === "team"
        ? "bg-purple-50 text-purple-700 ring-purple-100"
        : "bg-amber-50 text-amber-700 ring-amber-100";

  return (
    <section
      className="flex-1 min-w-0 flex flex-col bg-card"
      data-testid="conversation-panel"
    >
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 px-3 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-helper bg-muted">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="text-row-emphasis text-foreground truncate"
                data-testid="conversation-panel-title"
              >
                {thread.contact.displayName}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-helper ring-1",
                  badgeTone,
                )}
              >
                {badgeLabel}
              </span>
            </div>
            {thread.contact.phoneNumber && (
              <div className="text-helper text-muted-foreground truncate">
                {thread.contact.phoneNumber}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Call"
            data-testid="conversation-panel-call"
          >
            <Phone className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Info"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="More"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Message stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-app-bg"
        data-testid="conversation-message-stream"
      >
        {messages.length === 0 ? (
          <div className="text-center text-helper text-muted-foreground py-8">
            No messages in this conversation yet.
          </div>
        ) : (
          messages.map((m) => <ConversationMessageBubble key={m.id} message={m} />)
        )}
      </div>

      {/* Sticky composer */}
      <ConversationComposer
        showChannelTabs={showChannelTabs}
        onSend={onSend}
        smsAvailable={smsAvailable}
        threadSupportsSms={thread.threadType !== "team_chat"}
      />
    </section>
  );
}
