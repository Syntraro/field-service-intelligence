/**
 * BatchSendInvoicesModal (Phase 14, 2026-04-12).
 *
 * Orchestrates sending N invoices in one workflow through the canonical
 * backend batch endpoint. Each invoice still dispatches as its own email
 * with its own PDF and its own delivery record — this modal is UX only.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, CheckCircle2, XCircle } from "lucide-react";
import { PickerShell } from "@/components/ui/picker-shell";

export interface BatchSendInvoicesModalProps {
  invoiceIds: string[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: BatchResult) => void;
}

type RecipientMode = "defaults" | "manual_override";

interface BatchInvoiceResult {
  invoiceId: string;
  ok: boolean;
  emailId?: string | null;
  recipients?: string[];
  error?: string;
}
interface BatchResult {
  successCount: number;
  failureCount: number;
  results: BatchInvoiceResult[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BatchSendInvoicesModal(props: BatchSendInvoicesModalProps) {
  const { invoiceIds, isOpen, onClose, onSuccess } = props;

  const [recipientMode, setRecipientMode] = useState<RecipientMode>("defaults");
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [subjectOverride, setSubjectOverride] = useState("");
  const [bodyOverride, setBodyOverride] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRecipientMode("defaults");
    setManualRecipients([]);
    setRecipientDraft("");
    setSubjectOverride("");
    setBodyOverride("");
    setResult(null);
    setError(null);
  };

  const addRecipientFromDraft = () => {
    const parts = recipientDraft.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    setManualRecipients((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const p of parts) {
        if (!EMAIL_RE.test(p)) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(p);
      }
      return next;
    });
    setRecipientDraft("");
  };
  const removeManualRecipient = (e: string) => {
    setManualRecipients((prev) => prev.filter((x) => x !== e));
  };

  const mutation = useMutation<BatchResult, Error>({
    mutationFn: async () => {
      return await apiRequest<BatchResult>("/api/invoices/batch-send", {
        method: "POST",
        body: JSON.stringify({
          invoiceIds,
          recipientMode,
          manualRecipients: recipientMode === "manual_override" ? manualRecipients : undefined,
          subjectOverride: subjectOverride.trim() ? subjectOverride : undefined,
          bodyOverride: bodyOverride.trim() ? bodyOverride : undefined,
        }),
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      onSuccess?.(data);
    },
    onError: (err: any) => {
      if (err?.status === 429 || /429|rate limit/i.test(String(err?.message))) {
        setError("Too many sends. Please try again shortly.");
      } else {
        setError(err?.message ?? "Batch send failed.");
      }
    },
  });

  const sending = mutation.isPending;
  const canSend =
    !sending &&
    invoiceIds.length > 0 &&
    (recipientMode === "defaults" || manualRecipients.length > 0);

  const handleClose = () => {
    if (sending) return;
    reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl" data-testid="modal-batch-send-invoices">
        <DialogHeader>
          <DialogTitle>Send invoices</DialogTitle>
          <DialogDescription>
            {result
              ? "Batch complete. Review results below."
              : `You're sending ${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"}. Each will send as its own email with its own PDF attachment.`}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-5 py-2">
            {/* Recipient mode */}
            <div className="space-y-3">
              <Label>Recipients</Label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batch-recipient-mode"
                    value="defaults"
                    checked={recipientMode === "defaults"}
                    onChange={() => setRecipientMode("defaults")}
                    className="mt-1"
                    data-testid="radio-recipient-mode-defaults"
                  />
                  {/* 2026-05-03 typography standardization: radio
                      labels drop from `text-sm` (17.1px) to `text-xs`
                      (15.2px) to match canonical body text in modals. */}
                  <span className="text-xs">
                    <span className="font-medium">Use default recipients per invoice</span>
                    <span className="block text-xs text-muted-foreground">
                      Each invoice uses its own billing contacts. Invoices with no recipients on file will fail and be reported in the results.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="batch-recipient-mode"
                    value="manual_override"
                    checked={recipientMode === "manual_override"}
                    onChange={() => setRecipientMode("manual_override")}
                    className="mt-1"
                    data-testid="radio-recipient-mode-manual"
                  />
                  <span className="text-xs">
                    <span className="font-medium">Use the same recipients for every invoice</span>
                    <span className="block text-xs text-muted-foreground">
                      One list applied to all invoices in this batch. Useful when the client asks for "all open invoices".
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {recipientMode === "manual_override" && (
              <div className="space-y-2">
                <Label>Shared recipients</Label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 min-h-[40px]">
                  {manualRecipients.map((e) => (
                    <Badge key={e} variant="secondary" className="gap-1 font-normal">
                      {e}
                      <button
                        type="button"
                        onClick={() => removeManualRecipient(e)}
                        className="ml-0.5 rounded-full hover:bg-slate-300/50"
                        aria-label={`Remove ${e}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    value={recipientDraft}
                    onChange={(ev) => setRecipientDraft(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === ",") {
                        ev.preventDefault();
                        addRecipientFromDraft();
                      } else if (ev.key === "Backspace" && recipientDraft === "" && manualRecipients.length > 0) {
                        removeManualRecipient(manualRecipients[manualRecipients.length - 1]);
                      }
                    }}
                    onBlur={addRecipientFromDraft}
                    placeholder={manualRecipients.length === 0 ? "email@example.com" : ""}
                    className="h-7 border-0 px-1 focus-visible:ring-0 flex-1 min-w-[160px] shadow-none"
                    data-testid="input-batch-manual-recipient"
                  />
                </div>
              </div>
            )}

            {/* Optional shared overrides */}
            <div className="space-y-2">
              <Label htmlFor="batch-subject">Subject override (optional)</Label>
              <Input
                id="batch-subject"
                value={subjectOverride}
                onChange={(e) => setSubjectOverride(e.target.value)}
                placeholder="Leave blank to use each invoice's rendered subject"
                data-testid="input-batch-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-body">Message override (optional)</Label>
              <Textarea
                id="batch-body"
                value={bodyOverride}
                onChange={(e) => setBodyOverride(e.target.value)}
                rows={6}
                placeholder="Leave blank to use each invoice's rendered message"
                data-testid="input-batch-body"
              />
            </div>

            {error && (
              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
          </div>
        ) : (
          // Results view
          <div className="space-y-3 py-2">
            {/* 2026-05-03 typography standardization: results summary
                row drops from `text-sm` (17.1px) to `text-xs` (15.2px). */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-medium">{result.successCount} sent</span>
              </div>
              <div className="flex items-center gap-1.5 text-destructive">
                <XCircle className="h-4 w-4" />
                <span className="font-medium">{result.failureCount} failed</span>
              </div>
            </div>
            <PickerShell className="max-h-64">
              {result.results.map((r) => (
                <div
                  key={r.invoiceId}
                  className="flex items-start gap-2 px-3 py-2 text-xs"
                  data-testid={`batch-result-${r.invoiceId}`}
                >
                  {r.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-muted-foreground truncate">
                      {r.invoiceId.slice(0, 8)}…
                    </div>
                    {r.ok ? (
                      <div className="text-xs text-muted-foreground truncate">
                        Sent to {(r.recipients ?? []).join(", ")}
                      </div>
                    ) : (
                      <div className="text-xs text-destructive truncate">{r.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </PickerShell>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={sending}>Cancel</Button>
              <Button onClick={() => mutation.mutate()} disabled={!canSend} data-testid="button-batch-send-submit">
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending {invoiceIds.length}…
                  </>
                ) : (
                  `Send ${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"}`
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
