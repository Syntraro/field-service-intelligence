import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import type { Quote } from "@shared/schema";

interface QuoteApprovalCardProps {
  quote: Quote | undefined;
  loading: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0">{value}</span>
    </div>
  );
}

export function QuoteApprovalCard({ quote, loading }: QuoteApprovalCardProps) {
  // Only show for quotes in the approval pipeline.
  const isRelevant = quote && ["sent", "approved", "declined"].includes(quote.status);
  if (!loading && !isRelevant) return null;

  return (
    <WorkspaceSectionCard
      title="Approval"
      loading={loading}
      empty={!quote && !loading}
      emptyText="No quote selected."
      data-testid="quote-approval-card"
    >
      {quote && (
        <div className="space-y-1.5">
          <Row
            label="Status"
            value={(() => {
              const meta = getQuoteStatusMeta(quote.status);
              return <StatusChip tone={meta.tone}>{meta.label}</StatusChip>;
            })()}
          />
          {quote.sentAt && (
            <Row label="Sent" value={format(new Date(quote.sentAt), "MMM d, yyyy")} />
          )}
          {quote.viewedAt && (
            <Row label="Viewed" value={format(new Date(quote.viewedAt), "MMM d, yyyy")} />
          )}
          {quote.approvedAt && (
            <Row label="Approved" value={format(new Date(quote.approvedAt), "MMM d, yyyy")} />
          )}
          {quote.declinedAt && (
            <Row label="Declined" value={format(new Date(quote.declinedAt), "MMM d, yyyy")} />
          )}
          {!quote.viewedAt && quote.status === "sent" && (
            <p className="text-helper text-muted-foreground italic">Client has not viewed this quote yet.</p>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
