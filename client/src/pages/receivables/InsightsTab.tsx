import { BarChart3 } from "lucide-react";
import { EntityName, EntityMeta } from "@/components/ui/typography";

// TODO: Replace with real API calls when backend is ready:
// GET /api/receivables/insights — DSO, avg days to pay, on-time rate, YTD totals
// GET /api/receivables/aging — aging bucket distribution

const PLANNED_FEATURES = [
  "Aging buckets",
  "Collection performance",
  "Average days to pay",
  "Promise-to-pay conversion",
  "Overdue trend tracking",
  "Collector activity",
];

export function InsightsTab() {
  return (
    <div className="p-6 space-y-4" data-testid="receivables-insights-tab">
      <div>
        <EntityName className="text-foreground">Receivables Insights</EntityName>
        <EntityMeta className="mt-0.5">Collection performance, aging, and payment velocity analytics.</EntityMeta>
      </div>

      <div
        className="flex items-start gap-4 px-5 py-4 rounded-md border border-border bg-card"
        data-testid="insights-tab-coming-soon"
      >
        <BarChart3 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-foreground text-sm">Coming soon</p>
          <ul className="mt-2 space-y-1">
            {PLANNED_FEATURES.map((f) => (
              <li key={f} className="text-caption text-muted-foreground flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
