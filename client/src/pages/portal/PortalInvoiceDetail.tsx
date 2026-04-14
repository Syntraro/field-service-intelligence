/**
 * PortalInvoiceDetail — Customer-facing invoice detail with Pay stub.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Loader2, CreditCard } from "lucide-react";
import { statusBadgeVariant, formatCurrency, formatDate } from "./portalUtils";

interface InvoiceLine {
  id: string;
  lineNumber: number;
  lineItemType: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
}

interface TaxLine {
  taxRateName: string;
  ratePercent: string;
  taxableAmount: string;
  taxAmount: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balance: string;
  notesCustomer: string | null;
  clientMessage: string | null;
  workDescription: string | null;
  showQuantity: boolean;
  showUnitPrice: boolean;
  showLineTotals: boolean;
  showLineItems: boolean;
  showBalance: boolean;
}

interface InvoiceDetailResponse {
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  taxLines: TaxLine[];
  paymentsEnabled: boolean;
}

export default function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [payModalOpen, setPayModalOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<InvoiceDetailResponse>({
    queryKey: [`/api/portal/invoices/${invoiceId}`],
    enabled: !!invoiceId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link href="/portal/invoices">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Invoice not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines, taxLines, paymentsEnabled } = data;
  const hasBalance = parseFloat(invoice.balance || "0") > 0;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link href="/portal/invoices">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4 mr-1" /> Invoices
        </Button>
      </Link>

      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-xl">
                Invoice #{invoice.invoiceNumber || "—"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Issued {formatDate(invoice.issueDate)}
                {invoice.dueDate && ` · Due ${formatDate(invoice.dueDate)}`}
              </p>
            </div>
            <Badge variant={statusBadgeVariant(invoice.status)} className="text-sm">
              {invoice.status === "partial_paid" ? "Partially Paid" : invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {/* Amount summary */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="text-lg font-bold">{formatCurrency(invoice.total, invoice.currency)}</p>
            </div>
            {invoice.showBalance && (
              <div>
                <p className="text-muted-foreground">Balance Due</p>
                <p className="text-lg font-bold">{formatCurrency(invoice.balance, invoice.currency)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Line items */}
      {invoice.showLineItems && lines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {lines.map(line => (
                <div key={line.id} className="px-4 py-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{line.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {invoice.showQuantity && `Qty: ${line.quantity}`}
                        {invoice.showQuantity && invoice.showUnitPrice && " × "}
                        {invoice.showUnitPrice && formatCurrency(line.unitPrice, invoice.currency)}
                      </p>
                    </div>
                    {invoice.showLineTotals && (
                      <p className="font-medium flex-shrink-0">
                        {formatCurrency(line.lineTotal, invoice.currency)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Totals */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
          </div>
          {taxLines.length > 0 ? (
            taxLines.map((tl, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {tl.taxRateName} ({tl.ratePercent}%)
                </span>
                <span>{formatCurrency(tl.taxAmount, invoice.currency)}</span>
              </div>
            ))
          ) : parseFloat(invoice.taxTotal || "0") > 0 ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(invoice.taxTotal, invoice.currency)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-bold text-base border-t pt-2">
            <span>Total</span>
            <span>{formatCurrency(invoice.total, invoice.currency)}</span>
          </div>
          {parseFloat(invoice.amountPaid || "0") > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Paid</span>
              <span>-{formatCurrency(invoice.amountPaid, invoice.currency)}</span>
            </div>
          )}
          {invoice.showBalance && hasBalance && (
            <div className="flex justify-between font-bold text-base">
              <span>Balance Due</span>
              <span>{formatCurrency(invoice.balance, invoice.currency)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes / Terms — work description respects the canonical
          `show_job_description` visibility flag (2026-04-14). */}
      {(invoice.clientMessage || invoice.notesCustomer || (invoice.workDescription && (invoice as any).showJobDescription !== false)) && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {invoice.clientMessage && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Message</p>
                <p className="text-sm whitespace-pre-wrap">{invoice.clientMessage}</p>
              </div>
            )}
            {invoice.notesCustomer && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{invoice.notesCustomer}</p>
              </div>
            )}
            {invoice.workDescription && (invoice as any).showJobDescription !== false && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Scope of Work</p>
                <p className="text-sm whitespace-pre-wrap">{invoice.workDescription}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pay Invoice button */}
      {hasBalance && invoice.status !== "paid" && (
        <Button
          onClick={() => setPayModalOpen(true)}
          className="w-full h-12 text-base"
          size="lg"
        >
          <CreditCard className="h-5 w-5 mr-2" />
          Pay Invoice
        </Button>
      )}

      {/* Payment modal (feature-flagged stub) */}
      <Dialog open={payModalOpen} onOpenChange={setPayModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {paymentsEnabled ? "Pay Invoice" : "Online Payments"}
            </DialogTitle>
            <DialogDescription>
              {paymentsEnabled
                ? "Payments integration is enabled but not yet connected. Please contact us to complete your payment."
                : "Online payments coming soon. Please contact us to pay this invoice."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setPayModalOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
