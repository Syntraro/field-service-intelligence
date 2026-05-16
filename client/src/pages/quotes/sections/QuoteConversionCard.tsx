import { format } from "date-fns";
import { Briefcase } from "lucide-react";
import { useLocation } from "wouter";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import type { Quote } from "@shared/schema";

interface QuoteConversionCardProps {
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

export function QuoteConversionCard({ quote, loading }: QuoteConversionCardProps) {
  const [, setLocation] = useLocation();

  // Only show for approved or converted quotes.
  const isRelevant = quote && ["approved", "converted"].includes(quote.status);
  if (!loading && !isRelevant) return null;

  return (
    <WorkspaceSectionCard
      title="Conversion"
      loading={loading}
      empty={!quote && !loading}
      emptyText="No quote selected."
      data-testid="quote-conversion-card"
    >
      {quote && (
        <div className="space-y-2">
          {quote.status === "approved" && (
            <>
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2">
                <p className="text-helper text-emerald-700 font-medium">Ready to convert</p>
                {quote.total && (
                  <p className="text-helper text-emerald-600 mt-0.5">
                    Total: {formatCurrency(quote.total)}
                  </p>
                )}
              </div>
              <p className="text-helper text-muted-foreground">
                Use "Convert to Job" in Quick Actions to create the job from this quote.
              </p>
            </>
          )}
          {quote.status === "converted" && (
            <div className="space-y-1.5">
              {quote.convertedAt && (
                <Row label="Converted" value={format(new Date(quote.convertedAt), "MMM d, yyyy")} />
              )}
              {quote.convertedToJobId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 rounded-lg h-8 text-row mt-1"
                  onClick={() => setLocation(`/jobs/${quote.convertedToJobId}`)}
                  data-testid="conversion-open-job"
                >
                  <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  Open Job
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </WorkspaceSectionCard>
  );
}
