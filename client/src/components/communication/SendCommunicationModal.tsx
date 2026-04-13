/**
 * SendCommunicationModal (Phase 12, 2026-04-12).
 *
 * Jobber-style send dialog used by Invoice / Quote / Job. Wraps the
 * `useSendCommunicationModal` hook and the common layout.
 *
 * Contract:
 *   - fetches backend recipients + preview once on open
 *   - user may edit recipients, subject, body
 *   - Send submits with overrides to the matching backend endpoint
 *   - on success: close modal, call onSuccess
 *   - on error: show inline error, keep user input
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, X } from "lucide-react";
import {
  useSendCommunicationModal,
  type CommunicationEntityType,
} from "@/hooks/useSendCommunicationModal";

export interface SendCommunicationModalProps {
  entityType: CommunicationEntityType;
  entityId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
}

function defaultTitle(entityType: CommunicationEntityType): string {
  switch (entityType) {
    case "invoice": return "Send Invoice";
    case "quote":   return "Send Quote";
    case "job":     return "Send Email";
  }
}

export function SendCommunicationModal(props: SendCommunicationModalProps) {
  const { entityType, entityId, isOpen, onClose, onSuccess, title } = props;
  const {
    recipients, subject, body,
    loading, sending, error,
    setSubject, setBody,
    addRecipient, removeRecipient,
    send,
  } = useSendCommunicationModal({
    entityType,
    entityId,
    isOpen,
    onSuccess: () => {
      onSuccess?.();
      onClose();
    },
  });

  const [recipientDraft, setRecipientDraft] = useState("");

  const tryAddRecipient = () => {
    const value = recipientDraft.trim();
    if (!value) return;
    // Support comma- or space-separated bulk paste.
    const parts = value.split(/[\s,;]+/).filter(Boolean);
    for (const p of parts) addRecipient(p);
    setRecipientDraft("");
  };

  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      tryAddRecipient();
    } else if (e.key === "Backspace" && recipientDraft === "" && recipients.length > 0) {
      // Quick delete last chip.
      removeRecipient(recipients[recipients.length - 1]);
    }
  };

  const disabled = loading || sending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid={`modal-send-${entityType}`}>
        <DialogHeader>
          <DialogTitle>{title ?? defaultTitle(entityType)}</DialogTitle>
          <DialogDescription>
            {loading
              ? "Loading email preview…"
              : "Review the message and click Send. Changes apply to this send only."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Recipients */}
          <div className="space-y-2">
            <Label>Recipients</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 min-h-[40px]">
              {recipients.map((email) => (
                <Badge
                  key={email}
                  variant="secondary"
                  className="gap-1 font-normal"
                  data-testid={`chip-recipient-${email}`}
                >
                  {email}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-slate-300/50"
                    onClick={() => removeRecipient(email)}
                    disabled={disabled}
                    aria-label={`Remove ${email}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={recipientDraft}
                onChange={(e) => setRecipientDraft(e.target.value)}
                onKeyDown={handleRecipientKeyDown}
                onBlur={tryAddRecipient}
                placeholder={recipients.length === 0 ? "email@example.com" : ""}
                disabled={disabled}
                className="h-7 border-0 px-1 focus-visible:ring-0 flex-1 min-w-[160px] shadow-none"
                data-testid="input-recipient-draft"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Press Enter or comma to add. Backspace removes the last chip.
            </p>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor={`send-${entityType}-subject`}>Subject</Label>
            <Input
              id={`send-${entityType}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={disabled}
              data-testid={`input-send-subject-${entityType}`}
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor={`send-${entityType}-body`}>Message</Label>
            <Textarea
              id={`send-${entityType}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              disabled={disabled}
              data-testid={`input-send-body-${entityType}`}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2"
              role="alert"
              data-testid={`error-send-${entityType}`}
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={sending}
            data-testid={`button-send-cancel-${entityType}`}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void send()}
            disabled={disabled || recipients.length === 0 || !subject.trim() || !body.trim()}
            data-testid={`button-send-submit-${entityType}`}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending…
              </>
            ) : (
              "Send"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
