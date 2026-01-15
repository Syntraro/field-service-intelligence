import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { MoreHorizontal, Send, DollarSign, PenTool, RotateCw, Ban, Edit } from "lucide-react";
import type { Invoice, Client, CustomerCompany, Job } from "@shared/schema";

export interface InvoiceHeaderCardProps {
  invoice: Invoice;
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;

  onEdit?: () => void;
  onSend?: () => void;
  onCollectPayment?: () => void;
  onVoid?: () => void;

  // NEW: draft-only refresh hook (server already enforces draft-only)
  onRefreshFromJob?: () => void;
  refreshPending?: boolean;
  voidPending?: boolean;

  canEdit?: boolean;
  isDraft?: boolean;
  sendPending?: boolean;

  // Status display
  statusLabel?: string;
  statusVariant?: "default" | "destructive" | "secondary" | "outline";
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
}

export function InvoiceHeaderCard({
  invoice,
  location,
  customerCompany,
  job,
  onEdit,
  onSend,
  onCollectPayment,
  onVoid,
  onRefreshFromJob,
  refreshPending,
  voidPending,
  canEdit,
  isDraft,
  sendPending,
  statusLabel,
  statusVariant = "outline",
}: InvoiceHeaderCardProps) {
  // Derived status flags
  const isSent = invoice.status === "sent";
  const isPartialPaid = invoice.status === "partial_paid";
  const isPayable = isSent || isPartialPaid;
  const isTerminal = invoice.status === "paid" || invoice.status === "voided";
  const canVoid = !isTerminal && (isDraft || isSent || isPartialPaid);

  return (
    <Card className="p-4 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">Invoice #{invoice.invoiceNumber || "Draft"}</span>
            {statusLabel && <Badge variant={statusVariant}>{statusLabel}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground">
            {customerCompany?.name ?? location.companyName}
          </div>
          {location.location && (
            <div className="text-sm text-muted-foreground">{location.location}</div>
          )}
        </div>

        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total</div>
          <div className="text-lg font-semibold">{formatCurrency(invoice.total)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Edit - draft only */}
        {isDraft && onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-1" />
            Edit Invoice
          </Button>
        )}

        {/* Send - draft only */}
        {isDraft && onSend && (
          <Button variant="default" size="sm" onClick={onSend} disabled={sendPending}>
            <Send className="h-4 w-4 mr-1" />
            {sendPending ? "Sending..." : "Send Invoice"}
          </Button>
        )}

        {/* Add Payment - sent or partial_paid only */}
        {isPayable && onCollectPayment && (
          <Button variant="default" size="sm" onClick={onCollectPayment}>
            <DollarSign className="h-4 w-4 mr-1" />
            Add Payment
          </Button>
        )}

        {/* More Actions dropdown */}
        {!isTerminal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4 mr-1" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem disabled>
                <PenTool className="h-4 w-4 mr-2" />
                Collect Signature
              </DropdownMenuItem>

              {isDraft && job && onRefreshFromJob && (
                <DropdownMenuItem onClick={onRefreshFromJob} disabled={refreshPending}>
                  <RotateCw className="h-4 w-4 mr-2" />
                  Refresh from Job
                </DropdownMenuItem>
              )}

              {canVoid && onVoid && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onVoid}
                    disabled={voidPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    {voidPending ? "Voiding..." : "Void Invoice"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Read-only indicator for terminal states */}
        {isTerminal && (
          <span className="text-sm text-muted-foreground ml-2">
            {invoice.status === "paid" ? "Fully paid" : "Invoice voided"}
          </span>
        )}
      </div>
    </Card>
  );
}

export default InvoiceHeaderCard;
