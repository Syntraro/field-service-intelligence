/**
 * SendCommunicationModal
 *   - Phase 12 (2026-04-12): shared Jobber-style send dialog (invoice / quote / job).
 *   - Commit C (2026-04-13): added CC chip input, attach-invoice-PDF toggle,
 *     and up to 5 image attachments (invoice flow only; CC applies to all).
 *
 * Contract:
 *   - fetches backend recipients + preview once on open
 *   - user may edit recipients, CC, subject, body, attach-PDF toggle,
 *     and image attachments
 *   - Send submits with overrides + extras to the matching backend endpoint
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
// 2026-05-03 modal form-field polish: internal-label wrapper.
import { CompactField } from "@/components/ui/compact-field";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  useSendCommunicationModal,
  MAX_SEND_IMAGE_ATTACHMENTS,
  type CommunicationEntityType,
} from "@/hooks/useSendCommunicationModal";
import { ContactPickerPopover } from "./ContactPickerPopover";
import { SystemImagePickerDialog, type PickedImage } from "./SystemImagePickerDialog";

export interface SendCommunicationModalProps {
  entityType: CommunicationEntityType;
  entityId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  /** For statement type: scope the PDF + email to a single service location. */
  locationId?: string | null;
}

function defaultTitle(entityType: CommunicationEntityType): string {
  switch (entityType) {
    case "invoice":          return "Send Invoice";
    case "quote":            return "Send Quote";
    case "job":              return "Send Email";
    case "statement":        return "Send Statement";
    case "invoice_reminder": return "Send Reminder";
  }
}

/**
 * Client-side soft limit for the running image-attachment total. Matches
 * the server's `MAX_EMAIL_TOTAL_ATTACHMENT_BYTES` (25 MB). Server is
 * authoritative; this is UX feedback so users aren't surprised after
 * clicking Send. We display red text + block Send when exceeded.
 */
const CLIENT_MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function SendCommunicationModal(props: SendCommunicationModalProps) {
  const { entityType, entityId, isOpen, onClose, onSuccess, title, locationId } = props;
  const {
    recipients, cc, subject, body,
    attachPdf, attachments,
    loading, sending, error,
    setSubject, setBody,
    addRecipient, removeRecipient,
    addCc, removeCc,
    setAttachPdf,
    addAttachment, removeAttachment,
    send,
  } = useSendCommunicationModal({
    entityType,
    entityId,
    isOpen,
    locationScopeId: locationId,
    onSuccess: () => {
      onSuccess?.();
      onClose();
    },
  });

  const [recipientDraft, setRecipientDraft] = useState("");
  const [ccDraft, setCcDraft] = useState("");
  const [toFocused, setToFocused] = useState(false);
  const [ccFocused, setCcFocused] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);

  const showContactPicker = entityType === "invoice" || entityType === "statement" || entityType === "invoice_reminder";
  const contactsPath =
    entityType === "invoice" || entityType === "invoice_reminder"
      ? `/api/invoices/${entityId}/email-contacts`
      : `/api/customer-companies/${entityId}/statement-contacts`;

  const tryAdd = (value: string, add: (email: string) => void, reset: (v: string) => void) => {
    const parts = value.trim().split(/[\s,;]+/).filter(Boolean);
    for (const p of parts) add(p);
    reset("");
  };

  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      tryAdd(recipientDraft, addRecipient, setRecipientDraft);
    } else if (e.key === "Backspace" && recipientDraft === "" && recipients.length > 0) {
      removeRecipient(recipients[recipients.length - 1]);
    }
  };
  const handleCcKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      tryAdd(ccDraft, addCc, setCcDraft);
    } else if (e.key === "Backspace" && ccDraft === "" && cc.length > 0) {
      removeCc(cc[cc.length - 1]);
    }
  };

  const handlePickedSystemImages = (picked: PickedImage[]) => {
    for (const p of picked) {
      addAttachment({
        id: crypto.randomUUID(),
        fileId: p.fileId,
        filename: p.filename,
        sizeBytes: p.sizeBytes,
        mimeType: p.mimeType,
      });
    }
  };

  const disabled = loading || sending;
  const showInvoiceAttachments = entityType === "invoice";

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const imageTotalBytes = attachments.reduce((n, a) => n + (a.sizeBytes || 0), 0);
  const imageTotalExceeded = imageTotalBytes > CLIENT_MAX_TOTAL_ATTACHMENT_BYTES;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent
        className="sm:max-w-[640px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        data-testid={`modal-send-${entityType}`}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-4 pb-3 border-b">
          <DialogTitle>{title ?? defaultTitle(entityType)}</DialogTitle>
          {/* 2026-05-03 polish: visible blurb removed — title is now
              specific (caller composes "Email invoice #X to Y").
              DialogDescription kept sr-only for a11y / aria-describedby. */}
          <DialogDescription className="sr-only">
            {loading ? "Loading email preview." : "Compose and send."}
          </DialogDescription>
          {loading && (
            <p className="text-helper text-muted-foreground">Loading email preview…</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {/* Recipients (To) — internal-label CompactField. The chip
              row + draft input is rendered borderless inside the
              wrapper; the wrapper owns the bordered chrome and focus
              ring. */}
          <div className="relative">
            <CompactField
              label="To"
              htmlFor={`send-${entityType}-to`}
              testId={`field-send-to-${entityType}`}
              inline
            >
              <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
                {recipients.map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1 font-normal h-5 text-xs" data-testid={`chip-recipient-${email}`}>
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
                  id={`send-${entityType}-to`}
                  value={recipientDraft}
                  onChange={(e) => setRecipientDraft(e.target.value)}
                  onKeyDown={handleRecipientKeyDown}
                  onFocus={() => setToFocused(true)}
                  onBlur={() => {
                    setToFocused(false);
                    tryAdd(recipientDraft, addRecipient, setRecipientDraft);
                  }}
                  placeholder={recipients.length === 0 ? "Click to pick a contact or type an email" : ""}
                  disabled={disabled}
                  className="h-6 border-0 px-0 focus-visible:border-0 focus-visible:shadow-none flex-1 min-w-[160px] shadow-none text-sm bg-transparent"
                  data-testid="input-recipient-draft"
                />
              </div>
            </CompactField>
            {showContactPicker && toFocused && (
              <ContactPickerPopover
                contactsPath={contactsPath}
                selectedEmails={recipients}
                onSelect={(email) => {
                  addRecipient(email);
                  setRecipientDraft("");
                }}
                filterText={recipientDraft}
              />
            )}
          </div>

          {/* CC */}
          <div className="relative">
            <CompactField
              label="CC"
              htmlFor={`send-${entityType}-cc`}
              testId={`field-send-cc-${entityType}`}
              inline
            >
              <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
                {cc.map((email) => (
                  <Badge key={email} variant="outline" className="gap-1 font-normal h-5 text-xs" data-testid={`chip-cc-${email}`}>
                    {email}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-slate-300/50"
                      onClick={() => removeCc(email)}
                      disabled={disabled}
                      aria-label={`Remove ${email}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  id={`send-${entityType}-cc`}
                  value={ccDraft}
                  onChange={(e) => setCcDraft(e.target.value)}
                  onKeyDown={handleCcKeyDown}
                  onFocus={() => setCcFocused(true)}
                  onBlur={() => {
                    setCcFocused(false);
                    tryAdd(ccDraft, addCc, setCcDraft);
                  }}
                  placeholder=""
                  disabled={disabled}
                  className="h-6 border-0 px-0 focus-visible:border-0 focus-visible:shadow-none flex-1 min-w-[160px] shadow-none text-sm bg-transparent"
                  data-testid="input-cc-draft"
                />
              </div>
            </CompactField>
            {showContactPicker && ccFocused && (
              <ContactPickerPopover
                contactsPath={contactsPath}
                selectedEmails={[...recipients, ...cc]}
                onSelect={(email) => {
                  addCc(email);
                  setCcDraft("");
                }}
                filterText={ccDraft}
              />
            )}
          </div>

          {/* Subject */}
          <CompactField
            label="Subject"
            htmlFor={`send-${entityType}-subject`}
            testId={`field-send-subject-${entityType}`}
            inline
          >
            <Input
              id={`send-${entityType}-subject`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={disabled}
              className="h-6 border-0 px-0 focus-visible:border-0 focus-visible:shadow-none shadow-none text-sm bg-transparent"
              data-testid={`input-send-subject-${entityType}`}
            />
          </CompactField>

          {/* Body */}
          <CompactField
            label="Message"
            htmlFor={`send-${entityType}-body`}
            testId={`field-send-body-${entityType}`}
          >
            <Textarea
              id={`send-${entityType}-body`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              disabled={disabled}
              className="text-sm leading-5 border-0 px-0 py-0 focus-visible:border-0 focus-visible:shadow-none shadow-none resize-none min-h-[140px] bg-transparent"
              data-testid={`input-send-body-${entityType}`}
            />
          </CompactField>

          {/* Attachments (invoice only) — compact card under message. */}
          {showInvoiceAttachments && (
            <div className="rounded-md border bg-muted/10 px-3 py-2 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={attachPdf}
                    onCheckedChange={(v) => setAttachPdf(v === true)}
                    disabled={disabled}
                    data-testid="toggle-attach-pdf"
                  />
                  <span className="text-sm">Attach invoice PDF</span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setImagePickerOpen(true)}
                  disabled={disabled || attachments.length >= MAX_SEND_IMAGE_ATTACHMENTS}
                  data-testid="button-add-email-image"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Add images
                </Button>
                <span className="text-helper text-muted-foreground">
                  {attachments.length}/{MAX_SEND_IMAGE_ATTACHMENTS} · from system
                </span>
              </div>

              {attachments.length > 0 && (
                <div className="space-y-1">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded border border-border/60 px-2 py-1 bg-background"
                      data-testid={`email-attachment-${a.id}`}
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 min-w-0 text-xs truncate">{a.filename}</span>
                      <span className="text-helper text-muted-foreground shrink-0">
                        {formatSize(a.sizeBytes)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeAttachment(a.id)}
                        disabled={disabled}
                        aria-label={`Remove ${a.filename}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <p className={`text-helper ${imageTotalExceeded ? "text-destructive" : "text-muted-foreground"}`}>
                    Total images: {formatSize(imageTotalBytes)}
                    {imageTotalExceeded
                      ? " — total attachments exceed the 25 MB limit."
                      : ""}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-1.5"
              role="alert"
              data-testid={`error-send-${entityType}`}
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-background">
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
            disabled={
              disabled ||
              recipients.length === 0 ||
              !subject.trim() ||
              !body.trim() ||
              imageTotalExceeded
            }
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
      {entityType === "invoice" && (
        <SystemImagePickerDialog
          invoiceId={entityId}
          open={imagePickerOpen}
          onOpenChange={setImagePickerOpen}
          alreadyAttachedFileIds={attachments.map((a) => a.fileId)}
          maxSelect={MAX_SEND_IMAGE_ATTACHMENTS - attachments.length}
          onConfirm={handlePickedSystemImages}
        />
      )}
    </Dialog>
  );
}
