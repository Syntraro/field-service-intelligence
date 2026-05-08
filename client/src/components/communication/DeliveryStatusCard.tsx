/**
 * DeliveryStatusCard (Phase 15, 2026-04-12).
 *
 * Shows the latest email delivery for an invoice / quote / job, plus a
 * compact history of the previous attempts. Uses the shared canonical
 * endpoint `GET /api/communications/deliveries`.
 *
 * A Resend button appears only when the backend marks the row as
 * `canResend` (Phase 17 will wire the actual resend POST — this component
 * exposes the click callback via `onResendClick`).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// 2026-05-08 chip Phase 2: local StatusBadge migrated to canonical
// StatusChip. The leading icon + label remain; tones come from the
// canonical 7-tone palette.
import { StatusChip } from "@/components/ui/chip";
import type { ChipTone } from "@/lib/chipVariants";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Mail,
  MailWarning,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

export type DeliveryEntityType = "invoice" | "quote" | "job";

export interface DeliverySummary {
  id: string;
  status: "queued" | "sent" | "failed" | "delivered" | "bounced" | "complained";
  subject: string | null;
  recipientCount: number;
  recipients: string[];
  templateSource: "default" | "tenant_template" | "override";
  providerMessageId: string | null;
  sentAt: string | null;
  failedAt: string | null;
  deliveredAt: string | null;
  errorMessage: string | null;
  canResend: boolean;
  resendCount: number;
  retriedFromDeliveryId: string | null;
  createdAt: string;
}

export interface DeliveryStatusCardProps {
  entityType: DeliveryEntityType;
  entityId: string;
  /** Optional: fire after a successful resend so the parent can refresh. */
  onResendSuccess?: (newDeliveryId: string) => void;
}

// 2026-05-08 chip Phase 2: tones now resolve to the canonical
// 7-tone palette in `chipVariants.ts`. The pre-migration table
// distinguished `sent` (lighter green) from `delivered` (saturated
// green); both collapse to `success` here. The visual delta is
// deliberate (the chip palette is the new canonical truth) and the
// label text continues to differentiate the two states.
const STATUS_META: Record<
  DeliverySummary["status"],
  { label: string; icon: typeof CheckCircle2; tone: ChipTone }
> = {
  queued:     { label: "Queued",    icon: Clock,        tone: "neutral" },
  sent:       { label: "Sent",      icon: CheckCircle2, tone: "success" },
  delivered:  { label: "Delivered", icon: CheckCircle2, tone: "success" },
  failed:     { label: "Failed",    icon: XCircle,      tone: "danger" },
  bounced:    { label: "Bounced",   icon: MailWarning,  tone: "warning" },
  complained: { label: "Spam",      icon: ShieldAlert,  tone: "danger" },
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: DeliverySummary["status"] }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <StatusChip
      tone={meta.tone}
      leadingIcon={<Icon className="h-3 w-3" />}
      data-testid={`badge-delivery-status-${status}`}
    >
      {meta.label}
    </StatusChip>
  );
}

export function DeliveryStatusCard({ entityType, entityId, onResendSuccess }: DeliveryStatusCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [confirmResendId, setConfirmResendId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const queryKey = ["/api/communications/deliveries", entityType, entityId] as const;

  const { data, isLoading, isError } = useQuery<DeliverySummary[]>({
    queryKey,
    queryFn: async () =>
      apiRequest<DeliverySummary[]>(
        `/api/communications/deliveries?entityType=${entityType}&entityId=${entityId}`,
      ),
    enabled: !!entityId,
    staleTime: 15_000,
  });

  const resendMutation = useMutation<
    { ok: true; newDeliveryId: string; status: string },
    Error,
    string
  >({
    mutationFn: async (deliveryId: string) =>
      apiRequest(`/api/communications/deliveries/${deliveryId}/resend`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (resp) => {
      setResendError(null);
      setConfirmResendId(null);
      qc.invalidateQueries({ queryKey });
      toast({ title: "Email resent" });
      onResendSuccess?.(resp.newDeliveryId);
    },
    onError: (err: any) => {
      setResendError(err?.message ?? "Resend failed.");
    },
  });

  const latest = useMemo(() => (data && data.length > 0 ? data[0] : null), [data]);
  const history = useMemo(() => (data ? data.slice(1, 5) : []), [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 animate-pulse" />
          Loading email delivery…
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" />
          Unable to load delivery status.
        </CardContent>
      </Card>
    );
  }

  if (!latest) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" />
          No emails sent yet for this {entityType}.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-delivery-status">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Email status</span>
          </div>
          <StatusBadge status={latest.status} />
        </div>

        <div className="text-xs space-y-1.5">
          {latest.subject && (
            <div className="truncate">
              <span className="text-muted-foreground">Subject: </span>
              <span className="font-medium">{latest.subject}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Recipients: </span>
            {latest.recipients.length > 0 ? (
              <span>{latest.recipients.join(", ")}</span>
            ) : (
              <span className="text-muted-foreground italic">None</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">
              {latest.status === "failed"
                ? "Failed at: "
                : latest.status === "bounced"
                  ? "Bounced at: "
                  : latest.deliveredAt
                    ? "Delivered at: "
                    : "Sent at: "}
            </span>
            <span>
              {formatTime(
                latest.status === "failed"
                  ? latest.failedAt
                  : latest.deliveredAt ?? latest.sentAt,
              )}
            </span>
          </div>
          {latest.errorMessage && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-800 px-2.5 py-1.5 text-xs">
              {latest.errorMessage}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory((v) => !v)}
            data-testid="button-toggle-delivery-history"
          >
            {history.length > 0
              ? showHistory
                ? "Hide history"
                : `Show ${history.length} previous attempt${history.length === 1 ? "" : "s"}`
              : ""}
          </button>
          {latest.canResend && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setResendError(null); setConfirmResendId(latest.id); }}
              disabled={resendMutation.isPending}
              data-testid="button-delivery-resend"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Resend email
            </Button>
          )}
        </div>

        {showHistory && history.length > 0 && (
          <ul className="border-t pt-2 space-y-1.5" data-testid="list-delivery-history">
            {history.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-xs">
                <StatusBadge status={d.status} />
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {d.subject ?? <span className="text-muted-foreground italic">No subject</span>}
                  </div>
                  <div className="text-muted-foreground">
                    {formatTime(d.sentAt ?? d.failedAt ?? d.createdAt)} · {d.recipientCount} recipient
                    {d.recipientCount === 1 ? "" : "s"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {resendError && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-800 px-2.5 py-1.5 text-xs">
            {resendError}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={!!confirmResendId}
        onOpenChange={(open) => { if (!open) setConfirmResendId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend this email?</AlertDialogTitle>
            <AlertDialogDescription>
              Sends the same message and attachment to the original recipients.
              You can only resend once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resendMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resendMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmResendId) resendMutation.mutate(confirmResendId);
              }}
              data-testid="button-confirm-delivery-resend"
            >
              {resendMutation.isPending ? "Resending…" : "Resend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
