import { format, formatDistanceToNow, isPast, parseISO } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { Quote } from "@shared/schema";

interface QuoteFollowUpCardProps {
  quote: Quote | undefined;
  loading: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-helper text-muted-foreground shrink-0">{label}</span>
      <span className="text-helper text-foreground text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

function expiryLabel(quote: Quote): string | null {
  if (!quote.expiryDate) return null;
  const expiry = parseISO(quote.expiryDate);
  if (isPast(expiry)) return `Expired ${formatDistanceToNow(expiry, { addSuffix: true })}`;
  return `Expires ${formatDistanceToNow(expiry, { addSuffix: true })} (${format(expiry, "MMM d")})`;
}

export function QuoteFollowUpCard({ quote, loading }: QuoteFollowUpCardProps) {
  // Only meaningful when quote is in an active pipeline state.
  const isActive = quote && ["draft", "sent", "approved"].includes(quote.status);
  if (!loading && !isActive) return null;

  return (
    <WorkspaceSectionCard
      title="Follow-up"
      loading={loading}
      empty={!quote && !loading}
      emptyText="No quote selected."
      data-testid="quote-follow-up-card"
    >
      {quote && (
        <div className="space-y-1.5">
          {quote.sentAt && (
            <Row
              label="Sent"
              value={format(new Date(quote.sentAt), "MMM d, yyyy")}
            />
          )}
          {!quote.sentAt && quote.status === "draft" && (
            <Row label="Sent" value={<span className="text-muted-foreground italic">Not yet sent</span>} />
          )}
          {quote.expiryDate && (
            <Row label="Expiry" value={expiryLabel(quote) ?? "—"} />
          )}
          {quote.assessmentStatus && (
            <Row
              label="Assessment"
              value={
                <span className="capitalize">
                  {quote.assessmentStatus === "required"
                    ? "Needed"
                    : quote.assessmentStatus === "scheduled"
                      ? "Scheduled"
                      : "Completed"}
                </span>
              }
            />
          )}
          {quote.viewedAt && (
            <Row
              label="Viewed"
              value={format(new Date(quote.viewedAt), "MMM d, yyyy")}
            />
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
