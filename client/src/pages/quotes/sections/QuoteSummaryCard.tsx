import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { Quote } from "@shared/schema";

interface Location {
  city: string | null;
}

interface QuoteSummaryCardProps {
  quote: Quote | undefined;
  location: Location | null | undefined;
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

export function QuoteSummaryCard({ quote, location, loading }: QuoteSummaryCardProps) {
  // Suppress after load when no city — Created alone doesn't warrant a section card.
  if (!loading && !location?.city) return null;

  return (
    <WorkspaceSectionCard
      title="Details"
      loading={loading}
      empty={!quote && !loading}
      emptyText="Select a quote to see details."
      collapsible
      defaultCollapsed
      data-testid="quote-summary-card"
    >
      {quote && (
        <div className="space-y-1.5">
          {location?.city && (
            <Row label="City" value={location.city} />
          )}
          {quote.createdAt && (
            <Row label="Created" value={format(new Date(quote.createdAt), "MMM d, yyyy")} />
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
