/**
 * PortalDashboard — Customer portal home page.
 * Shows greeting, balance summary, and recent invoices.
 */

import { useQuery } from "@tanstack/react-query";
import { usePortalAuth } from "@/lib/portalAuth";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, FileText, ArrowRight, Loader2 } from "lucide-react";
import { statusBadgeVariant, formatCurrency, formatDate } from "./portalUtils";

interface InvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  balance: string;
}

interface InvoicesResponse {
  invoices: InvoiceRow[];
  summary: { totalBalance: string; openCount: number; totalCount: number };
}

export default function PortalDashboard() {
  const { user } = usePortalAuth();

  const { data, isLoading } = useQuery<InvoicesResponse>({
    queryKey: ["/api/portal/invoices"],
  });

  const firstName = user?.firstName || "there";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        Welcome, {firstName}
      </h1>
      <p className="text-muted-foreground">
        {user?.customerCompanyName}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4" />
              Balance Due
            </div>
            <p className="text-2xl font-bold">
              {isLoading ? "..." : formatCurrency(data?.summary.totalBalance || "0")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <FileText className="h-4 w-4" />
              Open Invoices
            </div>
            <p className="text-2xl font-bold">
              {isLoading ? "..." : data?.summary.openCount ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Invoices</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/portal/invoices">
              View all <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.invoices.length ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No invoices yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.invoices.slice(0, 5).map((inv) => (
              <Link key={inv.id} href={`/portal/invoices/${inv.id}`}>
                <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        #{inv.invoiceNumber || "—"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(inv.issueDate)}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <Badge variant={statusBadgeVariant(inv.status)}>
                        {inv.status === "partial_paid" ? "Partial" : inv.status}
                      </Badge>
                      <p className="font-semibold">{formatCurrency(inv.total)}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
