/**
 * InvoiceTimelineCard (2026-04-19 Phase 12).
 *
 * Read-only invoice activity timeline. Consumes
 * `GET /api/invoices/:id/timeline` which assembles events from
 * canonical sources (invoices, email_deliveries, payments). This
 * component renders only — no mutations, no new state.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText,
  Send,
  Eye,
  Mail,
  Receipt,
  Undo2,
  CornerUpLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RailContentCardMeta } from "@/components/detail-rail/RailContentCard";
import { formatCurrency } from "@/lib/formatters";
import { IconToneBadge } from "@/components/ui/icon-tone-badge";
import { type IconTone } from "@/lib/iconToneVariants";

type EventKind =
  | "created"
  | "issued"
  | "viewed"
  | "email"
  | "payment"
  | "refund"
  | "reversal";

interface TimelineEvent {
  id: string;
  kind: EventKind;
  occurredAt: string;
  label: string;
  meta?: {
    deliveryId?: string;
    status?: string;
    statusLabel?: string;
    subject?: string | null;
    recipientCount?: number;
    isResend?: boolean;
    errorMessage?: string | null;
    paymentId?: string;
    amount?: string;
    amountNumber?: number;
    method?: string;
    reference?: string | null;
    providerSource?: string;
    paymentType?: string;
  };
}

interface TimelineResponse {
  data: TimelineEvent[];
  count: number;
}

function iconForKind(kind: EventKind, statusLabel?: string) {
  switch (kind) {
    case "created":  return <FileText className="h-3 w-3" />;
    case "issued":   return <Send className="h-3 w-3" />;
    case "viewed":   return <Eye className="h-3 w-3" />;
    case "email":
      if (statusLabel === "Bounced" || statusLabel === "Failed" || statusLabel === "Marked as spam") {
        return <AlertTriangle className="h-3 w-3" />;
      }
      if (statusLabel === "Opened") return <Eye className="h-3 w-3" />;
      if (statusLabel === "Delivered") return <CheckCircle2 className="h-3 w-3" />;
      return <Mail className="h-3 w-3" />;
    case "payment":  return <Receipt className="h-3 w-3" />;
    case "refund":   return <Undo2 className="h-3 w-3" />;
    case "reversal": return <CornerUpLeft className="h-3 w-3" />;
  }
}

function toneForKind(kind: EventKind, statusLabel?: string): IconTone {
  if (kind === "payment") return "success";
  if (kind === "refund") return "danger";
  if (kind === "reversal") return "warning";
  if (kind === "viewed") return "info";
  if (kind === "email") {
    if (statusLabel === "Bounced" || statusLabel === "Failed" || statusLabel === "Marked as spam") {
      return "danger";
    }
    if (statusLabel === "Opened") return "info";
    if (statusLabel === "Delivered") return "success";
    return "neutral";
  }
  return "neutral";
}

function statusBadgeVariant(statusLabel?: string): "default" | "secondary" | "destructive" | "outline" {
  if (!statusLabel) return "outline";
  if (statusLabel === "Bounced" || statusLabel === "Failed" || statusLabel === "Marked as spam") {
    return "destructive";
  }
  if (statusLabel === "Opened" || statusLabel === "Delivered") return "secondary";
  return "outline";
}

interface InvoiceTimelineCardProps {
  invoiceId: string;
}

export function InvoiceTimelineCard({ invoiceId }: InvoiceTimelineCardProps) {
  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: ["invoices", "detail", invoiceId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/timeline`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
    enabled: !!invoiceId,
    staleTime: 30_000,
  });

  const events = data?.data ?? [];

  return (
    <Card data-testid="card-invoice-timeline">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Activity
          {events.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({events.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <RailContentCardMeta className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </RailContentCardMeta>
        ) : events.length === 0 ? (
          <RailContentCardMeta className="mt-2" data-testid="empty-invoice-timeline">
            No activity yet.
          </RailContentCardMeta>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((e) => {
              const tone = toneForKind(e.kind, e.meta?.statusLabel);
              return (
                <div
                  key={e.id}
                  className="py-2 text-xs flex items-start gap-2"
                  data-testid={`timeline-event-${e.kind}-${e.id}`}
                >
                  <IconToneBadge tone={tone} className="mt-0.5">
                    {iconForKind(e.kind, e.meta?.statusLabel)}
                  </IconToneBadge>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-slate-900">{e.label}</span>
                      {e.kind === "email" && e.meta?.statusLabel && e.meta.statusLabel !== "Sent" && (
                        <Badge
                          variant={statusBadgeVariant(e.meta.statusLabel)}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {e.meta.statusLabel}
                        </Badge>
                      )}
                      {(e.kind === "payment" || e.kind === "refund" || e.kind === "reversal") &&
                        typeof e.meta?.amountNumber === "number" && (
                          <span className="ml-auto font-semibold tabular-nums text-slate-900">
                            {formatCurrency(e.meta.amountNumber)}
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{format(new Date(e.occurredAt), "MMM d, yyyy · h:mm a")}</span>
                      {e.kind === "email" && e.meta?.subject && (
                        <>
                          <span>·</span>
                          <span className="truncate" title={e.meta.subject}>
                            {e.meta.subject}
                          </span>
                        </>
                      )}
                      {(e.kind === "payment" || e.kind === "refund" || e.kind === "reversal") && (
                        <>
                          {e.meta?.method && (
                            <>
                              <span>·</span>
                              <span className="capitalize">
                                {e.meta.method.replace(/_/g, " ")}
                              </span>
                            </>
                          )}
                          {e.meta?.providerSource && e.meta.providerSource !== "manual" && (
                            <>
                              <span>·</span>
                              <span className="capitalize">{e.meta.providerSource}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {e.kind === "email" && e.meta?.errorMessage && (
                      <p className="text-[11px] text-red-600 whitespace-pre-wrap">
                        {e.meta.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
