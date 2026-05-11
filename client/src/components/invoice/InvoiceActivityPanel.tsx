/**
 * InvoiceActivityPanel — combined notes + timeline view for Invoice Detail.
 *
 * Renders the canonical EntityNotesPanel at the top (wired to
 * `notesAddSignal` so the parent's +Add button opens the note form),
 * followed by a read-only chronological activity timeline in a canonical
 * RailContentCard so it sits with the same card chrome as every other
 * rail panel card.
 *
 * The timeline consumes data already assembled by invoiceTimeline.ts —
 * no new write paths or storage columns.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CreditCard, Eye, Mail, RotateCcw, Undo2, Zap } from "lucide-react";
import type { ComponentType } from "react";
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
import {
  RailContentCard,
  RailContentCardHeader,
  RailContentCardTitle,
} from "@/components/detail-rail/RailContentCard";

export interface InvoiceActivityPanelProps {
  invoiceId: string;
  notesAddSignal: number;
}

interface TimelineEvent {
  id: string;
  kind: "created" | "issued" | "viewed" | "email" | "payment" | "refund" | "reversal";
  occurredAt: string;
  label: string;
  meta?: Record<string, unknown>;
}

const KIND_ICON: Record<TimelineEvent["kind"], ComponentType<{ className?: string }>> = {
  created: Zap,
  issued: Mail,
  viewed: Eye,
  email: Mail,
  payment: CreditCard,
  refund: Undo2,
  reversal: RotateCcw,
};

export function InvoiceActivityPanel({ invoiceId, notesAddSignal }: InvoiceActivityPanelProps) {
  const { data, isLoading } = useQuery<{ data: TimelineEvent[]; count: number }>({
    queryKey: ["invoices", "timeline", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/timeline`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const events = data?.data ?? [];

  return (
    <div className="space-y-3" data-testid="invoice-activity-panel">
      <EntityNotesPanel
        entityType="invoice"
        entityId={invoiceId}
        openAddNoteSignal={notesAddSignal}
      />

      <RailContentCard testId="invoice-timeline-section">
        <RailContentCardHeader>
          <RailContentCardTitle as="h4">Activity</RailContentCardTitle>
        </RailContentCardHeader>

        {isLoading && (
          <p className="text-helper text-muted-foreground mt-1.5">Loading…</p>
        )}

        {!isLoading && events.length === 0 && (
          <p className="text-helper text-muted-foreground mt-1.5 italic">No activity recorded.</p>
        )}

        {!isLoading && events.length > 0 && (
          <ol className="mt-1.5 space-y-2" data-testid="invoice-timeline-list">
            {events.map((e) => {
              const Icon = KIND_ICON[e.kind] ?? Zap;
              return (
                <li
                  key={e.id}
                  className="flex items-start gap-2 text-helper"
                  data-testid={`invoice-timeline-event-${e.id}`}
                >
                  <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0">
                    <span className="text-foreground">{e.label}</span>
                    <span className="ml-1.5 text-muted-foreground tabular-nums">
                      {format(new Date(e.occurredAt), "MMM d, yyyy")}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </RailContentCard>
    </div>
  );
}
