import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase, Check, Download, ExternalLink, Send, X,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { ConfirmModal } from "@/components/ui/modal";
import { SendCommunicationModal } from "@/components/communication/SendCommunicationModal";
import { apiRequest, getCSRFToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Quote } from "@shared/schema";

interface QuoteQuickActionsCardProps {
  quote: Quote | undefined;
  loading: boolean;
}

export function QuoteQuickActionsCard({ quote, loading }: QuoteQuickActionsCardProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Modal state — card owns this.
  const [sendOpen, setSendOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  const quoteId = quote?.id;

  function invalidateQuote() {
    queryClient.invalidateQueries({ queryKey: ["quote", quoteId, "details"] });
    queryClient.invalidateQueries({ queryKey: ["/api/quotes/list"] });
    queryClient.invalidateQueries({ queryKey: ["quotes", "views", "counts"] });
  }

  const approveMutation = useMutation({
    mutationFn: () => apiRequest<Quote>(`/api/quotes/${quoteId}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidateQuote();
      toast({ title: "Quote approved" });
      setApproveOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not approve quote", description: err.message, variant: "destructive" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => apiRequest<Quote>(`/api/quotes/${quoteId}/decline`, { method: "POST" }),
    onSuccess: () => {
      invalidateQuote();
      toast({ title: "Quote declined" });
      setDeclineOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not decline quote", description: err.message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ job: { id: string }; message: string }>(`/api/quotes/${quoteId}/convert-to-job`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      invalidateQuote();
      toast({ title: "Quote converted to job" });
      setConvertOpen(false);
      setLocation(`/jobs/${data.job.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Could not convert quote", description: err.message, variant: "destructive" });
    },
  });

  const handleDownloadPdf = async () => {
    if (!quoteId) return;
    setIsPdfLoading(true);
    try {
      const token = await getCSRFToken();
      const res = await fetch(`/api/quotes/${quoteId}/pdf`, {
        credentials: "include",
        headers: { "x-csrf-token": token },
      });
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Quote-${quote?.quoteNumber ?? quoteId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setIsPdfLoading(false);
    }
  };

  return (
    <>
      <WorkspaceSectionCard
        title="Quick Actions"
        loading={loading}
        empty={!quote && !loading}
        emptyText="Select a quote to see actions."
        data-testid="quote-quick-actions-card"
      >
        {quote && (
          <div className="flex flex-col gap-1.5">
            {/* Always available */}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={() => setLocation(`/quotes/${quote.id}`)}
              data-testid="quote-action-open"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              Open Quote Detail
            </Button>

            {/* Send — draft or sent states */}
            {(quote.status === "draft" || quote.status === "sent") && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row"
                onClick={() => setSendOpen(true)}
                data-testid="quote-action-send"
              >
                <Send className="h-3.5 w-3.5 text-muted-foreground" />
                {quote.status === "sent" ? "Resend Quote" : "Send Quote"}
              </Button>
            )}

            {/* Approve — sent only */}
            {quote.status === "sent" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={() => setApproveOpen(true)}
                data-testid="quote-action-approve"
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                Approve Quote
              </Button>
            )}

            {/* Decline — sent only */}
            {quote.status === "sent" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row text-red-700 border-red-200 hover:bg-red-50"
                onClick={() => setDeclineOpen(true)}
                data-testid="quote-action-decline"
              >
                <X className="h-3.5 w-3.5 text-red-600" />
                Decline Quote
              </Button>
            )}

            {/* Convert to Job — approved only */}
            {quote.status === "approved" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-lg h-8 text-row"
                onClick={() => setConvertOpen(true)}
                data-testid="quote-action-convert"
              >
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                Convert to Job
              </Button>
            )}

            {/* PDF download — always */}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg h-8 text-row"
              onClick={handleDownloadPdf}
              disabled={isPdfLoading}
              data-testid="quote-action-download-pdf"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              {isPdfLoading ? "Generating…" : "Download PDF"}
            </Button>
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
          onSuccess={() => invalidateQuote()}
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
        title="Decline Quote"
        description="Mark this quote as declined. This cannot be undone."
        confirmLabel={declineMutation.isPending ? "Declining…" : "Decline"}
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
    </>
  );
}
