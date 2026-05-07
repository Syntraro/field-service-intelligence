/**
 * Bottom composer for the center conversation panel.
 *
 *   [SMS] [Internal Note]
 *   ┌──────────────────────────────────────────┐
 *   │ Type a message…                          │
 *   └──────────────────────────────────────────┘
 *   [📎 emoji 📋 internal-note]            42 / 1600  [Send]
 *
 * Phase 1: local state only — `onSend` is mocked at the page level.
 * Phase 2 will wire this to a `useSendMessage` mutation.
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Paperclip, Smile, FileText, StickyNote, Send } from "lucide-react";

const SMS_LIMIT = 1600;

type ComposerChannel = "sms" | "internal_note";

interface ConversationComposerProps {
  /** Hide the SMS / Internal Note tabs (e.g. team-chat threads). */
  showChannelTabs?: boolean;
  onSend: (input: { channel: ComposerChannel; body: string }) => void;
  disabled?: boolean;
}

export function ConversationComposer({
  showChannelTabs = true,
  onSend,
  disabled = false,
}: ConversationComposerProps) {
  const [channel, setChannel] = useState<ComposerChannel>("sms");
  const [body, setBody] = useState("");

  const trimmed = body.trim();
  const canSend = !disabled && trimmed.length > 0 && body.length <= SMS_LIMIT;

  const handleSend = () => {
    if (!canSend) return;
    onSend({ channel, body: trimmed });
    setBody("");
  };

  return (
    <div className="border-t border-border px-3 py-2.5 bg-card" data-testid="conversation-composer">
      {showChannelTabs && (
        <Tabs
          value={channel}
          onValueChange={(v) => setChannel(v as ComposerChannel)}
          className="mb-2"
        >
          <TabsList className="h-7">
            <TabsTrigger value="sms" className="text-helper px-2.5">
              SMS
            </TabsTrigger>
            <TabsTrigger value="internal_note" className="text-helper px-2.5">
              Internal Note
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Type a message…"
        rows={2}
        className="resize-none text-row min-h-[48px]"
        data-testid="conversation-composer-textarea"
        disabled={disabled}
      />

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Attach file"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Add emoji"
          >
            <Smile className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Insert template"
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Add internal note"
            onClick={() => setChannel("internal_note")}
          >
            <StickyNote className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-helper text-muted-foreground">
            {body.length} / {SMS_LIMIT}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={!canSend}
            onClick={handleSend}
            className="h-7 gap-1.5 px-3"
            data-testid="conversation-composer-send"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
