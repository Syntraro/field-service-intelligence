import { addDays, parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { Quote, QuoteLine } from "@shared/schema";

interface QuoteWarningsCardProps {
  quote: Quote | undefined;
  lines: QuoteLine[];
  loading: boolean;
}

interface Warning {
  key: string;
  message: string;
  severity: "high" | "medium";
}

function deriveWarnings(quote: Quote, lines: QuoteLine[]): Warning[] {
  const warnings: Warning[] = [];
  const now = new Date();
  const sevenDaysOut = addDays(now, 7);

  if (lines.length === 0) {
    warnings.push({ key: "no-lines", message: "No line items added", severity: "high" });
  }

  if (quote.status === "sent" && quote.expiryDate) {
    const expiry = parseISO(quote.expiryDate);
    if (expiry <= now) {
      warnings.push({ key: "expired", message: "Quote has passed its expiry date", severity: "high" });
    } else if (expiry <= sevenDaysOut) {
      warnings.push({ key: "expiring-soon", message: "Expiring within 7 days", severity: "high" });
    }
  }

  if (quote.status === "sent" && !quote.expiryDate) {
    warnings.push({ key: "no-expiry", message: "No expiry date set", severity: "medium" });
  }

  if (quote.assessmentStatus === "required") {
    warnings.push({ key: "assessment-needed", message: "Assessment needed but not scheduled", severity: "medium" });
  }

  return warnings;
}

export function QuoteWarningsCard({ quote, lines, loading }: QuoteWarningsCardProps) {
  const warnings = quote ? deriveWarnings(quote, lines) : [];
  const isEmpty = !loading && warnings.length === 0;

  if (isEmpty && !loading) return null;

  return (
    <WorkspaceSectionCard
      title="Warnings"
      loading={loading}
      empty={isEmpty}
      emptyText="No warnings."
      data-testid="quote-warnings-card"
    >
      <div className="space-y-1.5">
        {warnings.map((w) => (
          <div
            key={w.key}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1.5",
              w.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
            )}
            data-testid={`quote-warning-${w.key}`}
          >
            <AlertTriangle
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
                w.severity === "high" ? "text-red-600" : "text-amber-600",
              )}
            />
            <span className="text-helper">{w.message}</span>
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
