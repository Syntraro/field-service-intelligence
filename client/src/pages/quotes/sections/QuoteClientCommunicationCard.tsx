import { format } from "date-fns";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { Quote } from "@shared/schema";

interface Location {
  id: string;
  companyName: string;
  address: string | null;
  city: string | null;
}

interface CustomerCompany {
  id: string;
  name: string;
}

interface QuoteClientCommunicationCardProps {
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

export function QuoteClientCommunicationCard({
  quote,
  location,
  customerCompany,
  loading,
}: QuoteClientCommunicationCardProps) {
  return (
    <WorkspaceSectionCard
      title="Client"
      loading={loading}
      empty={!quote && !loading}
      emptyText="No quote selected."
      collapsible
      data-testid="quote-client-communication-card"
    >
      {quote && (
        <div className="space-y-1.5">
          {customerCompany?.name && (
            <Row label="Company" value={customerCompany.name} />
          )}
          {location?.companyName && (
            <Row label="Location" value={location.companyName} />
          )}
          {(location?.address || location?.city) && (
            <Row
              label="Address"
              value={[location.address, location.city].filter(Boolean).join(", ")}
            />
          )}
          {quote.sentAt && (
            <Row label="Quote Sent" value={format(new Date(quote.sentAt), "MMM d, yyyy")} />
          )}
          {!quote.sentAt && (
            <Row label="Quote Sent" value={<span className="text-muted-foreground italic">Not yet sent</span>} />
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
