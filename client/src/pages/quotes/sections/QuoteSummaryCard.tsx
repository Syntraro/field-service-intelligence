import { format } from "date-fns";
import { parseISO } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import { formatCurrency } from "@/lib/formatters";
import type { Quote } from "@shared/schema";

interface Location {
  id: string;
  companyName: string;
  city: string | null;
}

interface CustomerCompany {
  id: string;
  name: string;
}

interface QuoteSummaryCardProps {
  quote: Quote | undefined;
  location: Location | null | undefined;
  customerCompany: CustomerCompany | null | undefined;
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

export function QuoteSummaryCard({ quote, location, customerCompany, loading }: QuoteSummaryCardProps) {
  return (
    <WorkspaceSectionCard
      title="Quote Summary"
      loading={loading}
      empty={!quote && !loading}
      emptyText="Select a quote to see details."
      collapsible
      defaultCollapsed
      data-testid="quote-summary-card"
    >
      {quote && (
        <div className="space-y-1.5">
          {quote.quoteNumber && (
            <Row label="Quote #" value={quote.quoteNumber} />
          )}
          <Row
            label="Status"
            value={(() => {
              const meta = getQuoteStatusMeta(quote.status);
              return <StatusChip tone={meta.tone}>{meta.label}</StatusChip>;
            })()}
          />
          {customerCompany?.name && (
            <Row label="Company" value={customerCompany.name} />
          )}
          {location?.companyName && (
            <Row label="Location" value={location.companyName} />
          )}
          {location?.city && (
            <Row label="City" value={location.city} />
          )}
          {quote.total && (
            <Row label="Total" value={formatCurrency(quote.total)} />
          )}
          {quote.createdAt && (
            <Row label="Created" value={format(new Date(quote.createdAt), "MMM d, yyyy")} />
          )}
          {quote.expiryDate && (
            <Row label="Expires" value={format(parseISO(quote.expiryDate), "MMM d, yyyy")} />
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
