/**
 * Bottom composer for the center conversation panel.
 *
 *   [SMS] [Internal Note]
 *   ┌──────────────────────────────────────────┐
 *   │ Type a message…                          │
 *   └──────────────────────────────────────────┘
 *   [📎 emoji 📋 internal-note]            42 / 1600  [Send]
 *
 * Phase 4 contract
 * ----------------
 *   • Internal Note tab — fully working. Send emits via `onSend`; the
 *     page wires the mutation through `useCreateInternalMessage`.
 *   • SMS tab — disabled. The Send button is disabled while the SMS
 *     tab is active and a helper line under the textarea explains why:
 *     "SMS sending requires a phone provider connection."
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
  // Default to the working tab — Internal Note. SMS still appears in the
  // tab list so users see the surface, but the Send action is disabled
  // until provider integration lands.
  const [channel, setChannel] = useState<ComposerChannel>("internal_note");
  const [body, setBody] = useState("");

  const trimmed = body.trim();
  // Phase 4: SMS sending is disabled until a phone provider is wired up.
  // Block the Send action when the SMS tab is active. The Internal Note
  // tab keeps the canonical blank-body + over-limit checks.
  const smsDisabled = channel === "sms";
  const canSend =
    !disabled && !smsDisabled && trimmed.length > 0 && body.length <= SMS_LIMIT;

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
        placeholder={smsDisabled ? "SMS sending is disabled — switch to Internal Note." : "Type a message…"}
        rows={2}
        className="resize-none text-row min-h-[48px]"
        data-testid="conversation-composer-textarea"
        disabled={disabled}
      />

      {smsDisabled && (
        <p
          className="mt-1.5 text-helper text-muted-foreground"
          data-testid="conversation-composer-sms-disabled"
        >
          SMS sending requires a phone provider connection.
        </p>
      )}

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
