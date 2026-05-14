import { Clock } from "lucide-react";
import { EntityName, EntityMeta } from "@/components/ui/typography";

// TODO: Wire to GET /api/receivables/activity — global receivables activity feed
// Parameters: offset, limit, type filter (reminders | statements | payments | disputes | notes)

export function ActivityTab() {
  return (
    <div className="p-6 space-y-4" data-testid="receivables-activity-tab">
      <div>
        <EntityName className="text-foreground">Global Activity Feed</EntityName>
        <EntityMeta className="mt-0.5">All receivables events across your customer accounts.</EntityMeta>
      </div>

      <div
        className="flex flex-col items-center justify-center py-16 text-center rounded-md border border-border bg-card"
        data-testid="activity-tab-coming-soon"
      >
        <Clock className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="font-medium text-foreground">Coming soon</p>
        <p className="text-caption text-muted-foreground mt-1 max-w-xs">
          The global activity feed is not yet available. Receivables notes and actions are visible in the Invoices tab.
        </p>
      </div>
    </div>
  );
}
