import { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Quote, QuoteNote } from "@shared/schema";

interface QuoteActivityCardProps {
  quote: Quote | undefined;
  notes: QuoteNote[];
  loading: boolean;
  error: boolean;
}

interface ActivityItem {
  id: string;
  label: string;
  date: Date;
  isSystem: boolean;
}

function buildActivityItems(quote: Quote | undefined, notes: QuoteNote[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (quote) {
    if (quote.createdAt) items.push({ id: "created", label: "Quote created", date: new Date(quote.createdAt), isSystem: true });
    if (quote.sentAt) items.push({ id: "sent", label: "Quote sent", date: new Date(quote.sentAt), isSystem: true });
    if (quote.viewedAt) items.push({ id: "viewed", label: "Quote viewed", date: new Date(quote.viewedAt), isSystem: true });
    if (quote.approvedAt) items.push({ id: "approved", label: "Quote approved", date: new Date(quote.approvedAt), isSystem: true });
    if (quote.declinedAt) items.push({ id: "declined", label: "Quote declined", date: new Date(quote.declinedAt), isSystem: true });
    if (quote.convertedAt) items.push({ id: "converted", label: "Quote converted to job", date: new Date(quote.convertedAt), isSystem: true });
  }

  for (const note of notes) {
    items.push({ id: `note-${note.id}`, label: note.noteText, date: new Date(note.createdAt), isSystem: false });
  }

  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function QuoteActivityCard({ quote, notes, loading, error }: QuoteActivityCardProps) {
  const items = useMemo(() => buildActivityItems(quote, notes), [quote, notes]);

  const cardClass = "rounded-md border border-border bg-inset-surface p-3";

  if (loading) {
    return (
      <div className={cardClass} data-testid="quote-activity-card">
        <p className="text-helper text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={cardClass} data-testid="quote-activity-card">
        <p className="text-helper text-muted-foreground">Could not load activity.</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className={cardClass} data-testid="quote-activity-card">
        <p className="text-helper text-muted-foreground">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid="quote-activity-card">
      {items.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        return (
          <div
            key={item.id}
            className={cn(
              "flex gap-2.5 py-3",
              isFirst && "pt-0",
              isLast && "pb-0",
              !isFirst && "border-t border-border",
            )}
            data-testid={`quote-activity-${item.id}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-helper text-muted-foreground">
                {format(item.date, "MMM d 'at' h:mm a")}
              </p>
              <p className={cn("text-row text-foreground", item.isSystem && "font-medium")}>
                {item.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
