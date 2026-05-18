import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive, Briefcase, Check, Copy, Edit, Mail, RotateCcw, Send, Trash2, X,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { ConfirmModal } from "@/components/ui/modal";
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { apiRequest } from "@/lib/queryClient";
import { invalidateQuote } from "@/lib/queryInvalidation";
import { useToast } from "@/hooks/use-toast";
import type { Quote } from "@shared/schema";

interface QuoteActionsCardProps {
  quote: Quote | undefined;
  loading: boolean;
}

const BTN = "w-full justify-start gap-2 rounded-lg h-8 text-row";
const BTN_DANGER = `${BTN} text-red-700 border-red-200 hover:bg-red-50`;
const BTN_SUCCESS = `${BTN} text-emerald-700 border-emerald-200 hover:bg-emerald-50`;

export function QuoteActionsCard({ quote, loading }: QuoteActionsCardProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [sendOpen, setSendOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);

  const quoteId = quote?.id;

  const approveMutation = useMutation({
    mutationFn: () => apiRequest<Quote>(`/api/quotes/${quoteId}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote approved" });
      setApproveOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not approve quote", description: err.message, variant: "destructive" }),
  });

  const declineMutation = useMutation({
    mutationFn: () => apiRequest<Quote>(`/api/quotes/${quoteId}/decline`, { method: "POST" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote declined and archived" });
      setDeclineOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not decline quote", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ job: { id: string }; message: string }>(`/api/quotes/${quoteId}/convert-to-job`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote converted to job" });
      setConvertOpen(false);
      setLocation(`/jobs/${data.job.id}`);
    },
    onError: (err: Error) =>
      toast({ title: "Could not convert quote", description: err.message, variant: "destructive" }),
  });

  // Archive approved/expired → set status to declined (no dedicated archive status exists)
  const archiveMutation = useMutation({
    mutationFn: () =>
      apiRequest<Quote>(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "declined" }),
      }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote archived" });
      setArchiveOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not archive quote", description: err.message, variant: "destructive" }),
  });

  // Permanent delete for draft quotes only
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean }>(`/api/quotes/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote deleted" });
      setDeleteOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not delete quote", description: err.message, variant: "destructive" }),
  });

  // Unarchive → restore to draft
  const unarchiveMutation = useMutation({
    mutationFn: () =>
      apiRequest<Quote>(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "draft" }),
      }),
    onSuccess: () => {
      invalidateQuote(queryClient, quoteId);
      toast({ title: "Quote restored to draft" });
      setUnarchiveOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not unarchive quote", description: err.message, variant: "destructive" }),
  });

  const status = quote?.status;

  return (
    <>
      <WorkspaceSectionCard
        title="Actions"
        loading={loading}
        empty={!quote && !loading}
        emptyText="Select a quote to see actions."
        data-testid="quote-actions-card"
      >
        {quote && (
          <div className="flex flex-col gap-1.5">

            {/* ── Draft ── */}
            {status === "draft" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setSendOpen(true)}
                  data-testid="qa-send"
                >
                  <Send className="h-3.5 w-3.5 text-muted-foreground" />
                  Send Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setLocation(`/quotes/${quote.id}`)}
                  data-testid="qa-edit"
                >
                  <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                  Edit Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN_DANGER}
                  onClick={() => setDeleteOpen(true)}
                  data-testid="qa-archive-draft"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  Archive Quote
                </Button>
              </>
            )}

            {/* ── Sent / Pending ── */}
            {status === "sent" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setSendOpen(true)}
                  data-testid="qa-resend"
                >
                  <Send className="h-3.5 w-3.5 text-muted-foreground" />
                  Resend Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN_SUCCESS}
                  onClick={() => setApproveOpen(true)}
                  data-testid="qa-approve"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Approve Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN_DANGER}
                  onClick={() => setDeclineOpen(true)}
                  data-testid="qa-decline-archive"
                >
                  <X className="h-3.5 w-3.5 text-red-600" />
                  Decline & Archive
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setLocation(`/quotes/${quote.id}`)}
                  data-testid="qa-edit"
                >
                  <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                  Edit Quote
                </Button>
              </>
            )}

            {/* ── Approved ── */}
            {status === "approved" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setConvertOpen(true)}
                  data-testid="qa-convert"
                >
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  Convert to Job
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setLocation(`/quotes/${quote.id}`)}
                  data-testid="qa-edit"
                >
                  <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                  Edit Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setArchiveOpen(true)}
                  data-testid="qa-archive"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  Archive Quote
                </Button>
              </>
            )}

            {/* ── Converted ── */}
            {status === "converted" && (
              <>
                {quote.convertedToJobId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={BTN}
                    onClick={() => setLocation(`/jobs/${quote.convertedToJobId!}`)}
                    data-testid="qa-open-job"
                  >
                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                    Open Job
                  </Button>
                )}
                {/* TODO: Duplicate Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-duplicate"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Duplicate Quote
                </Button>
                {/* TODO: Create Similar Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-create-similar"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Create Similar Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setSendOpen(true)}
                  data-testid="qa-email"
                >
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  Email Quote
                </Button>
              </>
            )}

            {/* ── Declined (archived) ── */}
            {status === "declined" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setUnarchiveOpen(true)}
                  data-testid="qa-unarchive"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                  Unarchive Quote
                </Button>
                {/* TODO: Duplicate Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-duplicate"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Duplicate Quote
                </Button>
                {/* TODO: Create Similar Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-create-similar"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Create Similar Quote
                </Button>
              </>
            )}

            {/* ── Expired ── */}
            {status === "expired" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setLocation(`/quotes/${quote.id}`)}
                  data-testid="qa-extend-expiry"
                >
                  <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                  Extend Expiry
                </Button>
                {/* TODO: Duplicate Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-duplicate"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Duplicate Quote
                </Button>
                {/* TODO: Create Similar Quote — requires POST /api/quotes/:id/duplicate (not yet implemented) */}
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  disabled
                  data-testid="qa-create-similar"
                >
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  Create Similar Quote
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={BTN}
                  onClick={() => setArchiveOpen(true)}
                  data-testid="qa-archive"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  Archive Quote
                </Button>
              </>
            )}

          </div>
        )}
      </WorkspaceSectionCard>

      {/* Modals */}
      {quoteId && (
        <SendCommunicationModal
          entityType="quote"
          entityId={quoteId}
          isOpen={sendOpen}
          onClose={() => setSendOpen(false)}
          onSuccess={() => invalidateQuote(queryClient, quoteId)}
        />
      )}

      <ConfirmModal
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve Quote"
        description="Mark this quote as approved. The client has agreed to proceed."
        confirmLabel={approveMutation.isPending ? "Approving…" : "Approve"}
        cancelLabel="Cancel"
        variant="neutral"
        isPending={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate()}
        testIdPrefix="quote-approve"
      />

      <ConfirmModal
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title="Decline & Archive Quote"
        description="Mark this quote as declined. It will be archived and removed from the active pipeline."
        confirmLabel={declineMutation.isPending ? "Declining…" : "Decline & Archive"}
        cancelLabel="Cancel"
        variant="destructive"
        isPending={declineMutation.isPending}
        onConfirm={() => declineMutation.mutate()}
        testIdPrefix="quote-decline"
      />

      <ConfirmModal
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert to Job"
        description="Create a new job from this approved quote. Line items and notes will be copied to the job."
        confirmLabel={convertMutation.isPending ? "Converting…" : "Convert to Job"}
        cancelLabel="Cancel"
        variant="neutral"
        isPending={convertMutation.isPending}
        onConfirm={() => convertMutation.mutate()}
        testIdPrefix="quote-convert"
      />

      <ConfirmModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive Quote"
        description="Archive this quote. It will be marked as declined and removed from the active pipeline."
        confirmLabel={archiveMutation.isPending ? "Archiving…" : "Archive"}
        cancelLabel="Cancel"
        variant="neutral"
        isPending={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
        testIdPrefix="quote-archive"
      />

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Archive Draft Quote"
        description="Permanently delete this draft quote. This cannot be undone."
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        testIdPrefix="quote-delete"
      />

      <ConfirmModal
        open={unarchiveOpen}
        onOpenChange={setUnarchiveOpen}
        title="Unarchive Quote"
        description="Restore this quote to draft status so it can be edited and re-sent."
        confirmLabel={unarchiveMutation.isPending ? "Restoring…" : "Unarchive"}
        cancelLabel="Cancel"
        variant="neutral"
        isPending={unarchiveMutation.isPending}
        onConfirm={() => unarchiveMutation.mutate()}
        testIdPrefix="quote-unarchive"
      />
    </>
  );
}
