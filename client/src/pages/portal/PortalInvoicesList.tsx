/**
 * PortalInvoicesList — Customer invoice list with status filters.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { statusBadgeVariant, formatCurrency, formatDate } from "./portalUtils";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  balance: string;
  amountPaid: string;
}

interface InvoicesResponse {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
}

type FilterTab = "all" | "open" | "paid";

export default function PortalInvoicesList() {
  const [tab, setTab] = useState<FilterTab>("all");

  const statusParam = tab === "open" ? "sent" : tab === "paid" ? "paid" : undefined;
  const queryKey = statusParam
    ? `/api/portal/invoices?status=${statusParam}`
    : "/api/portal/invoices";

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: [queryKey],
  });

  const invoices = data?.invoices ?? [];

  // Client-side filter for "open" tab to include partial_paid
  const filtered = tab === "open"
    ? invoices.filter(i => i.status === "sent" || i.status === "partial_paid")
    : invoices;

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Invoices</h1>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {tabs.map(t => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No {tab !== "all" ? tab : ""} invoices found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(inv => (
            <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">#{inv.invoiceNumber || "—"}</p>
                        <Badge variant={statusBadgeVariant(inv.status)}>
                          {inv.status === "partial_paid" ? "Partial" : inv.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Issued {formatDate(inv.issueDate)}
                        {inv.dueDate && ` · Due ${formatDate(inv.dueDate)}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="font-semibold">{formatCurrency(inv.total)}</p>
                      {parseFloat(inv.balance || "0") > 0 && inv.status !== "paid" && (
                        <p className="text-sm text-muted-foreground">
                          Due: {formatCurrency(inv.balance)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
