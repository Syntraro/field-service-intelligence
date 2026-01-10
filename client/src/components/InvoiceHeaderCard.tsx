import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { MoreHorizontal, Send, DollarSign, PenTool, RotateCw } from "lucide-react";
import type { Invoice, Client, CustomerCompany, Job } from "@shared/schema";

export interface InvoiceHeaderCardProps {
  invoice: Invoice;
  location: Client;
  customerCompany?: CustomerCompany;
  job?: Job;

  onEdit?: () => void;
  onSend?: () => void;
  onCollectPayment?: () => void;

  // NEW: draft-only refresh hook (server already enforces draft-only)
  onRefreshFromJob?: () => void;
  refreshPending?: boolean;

  canEdit?: boolean;
  isDraft?: boolean;
  sendPending?: boolean;
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
  onRefreshFromJob,
  refreshPending,
  canEdit,
  isDraft,
  sendPending,
}: InvoiceHeaderCardProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">Invoice #{invoice.invoiceNumber}</div>
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
        {canEdit && onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit Invoice
          </Button>
        )}

        {canEdit && onCollectPayment && (
          <Button variant="outline" size="sm" onClick={onCollectPayment}>
            <DollarSign className="h-4 w-4 mr-1" />
            Collect Payment
          </Button>
        )}

        {isDraft && onSend && (
          <Button variant="outline" size="sm" onClick={onSend} disabled={sendPending}>
            <Send className="h-4 w-4 mr-1" />
            Send
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoreHorizontal className="h-4 w-4 mr-1" />
              More Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>
              <PenTool className="h-4 w-4 mr-2" />
              Collect Signature
            </DropdownMenuItem>

            {isDraft && job && onRefreshFromJob && (
              <DropdownMenuItem onClick={onRefreshFromJob} disabled={refreshPending}>
                <RotateCw className="h-4 w-4 mr-2" />
                Refresh from Job
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

export default InvoiceHeaderCard;
