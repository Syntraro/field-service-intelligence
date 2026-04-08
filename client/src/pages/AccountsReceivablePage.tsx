import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Clock, FileText, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

interface ARAgingInvoice {
  id: string;
  invoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  status: string;
  total: string;
  balance: string;
  daysOverdue: number;
  agingBucket: "0-30" | "31-60" | "61-90" | "90+";
  customerCompany: {
    id: string | null;
    name: string | null;
  };
  location: {
    id: string;
    companyName: string;
    location: string | null;
  };
}

interface ARAgingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  count: number;
  totalBalance: number;
}

interface ARAgingReport {
  summary: {
    totalOutstanding: number;
    totalInvoices: number;
    averageDaysOutstanding: number;
  };
  buckets: ARAgingBucket[];
  invoices: ARAgingInvoice[];
}

const BUCKET_LABELS: Record<string, string> = {
  "0-30": "Current (0-30 days)",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "90+": "90+ days",
};

const BUCKET_COLORS: Record<string, string> = {
  "0-30": "bg-green-500",
  "31-60": "bg-yellow-500",
  "61-90": "bg-orange-500",
  "90+": "bg-red-500",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AccountsReceivablePage() {
  const [, setLocation] = useLocation();

  const { data: report, isLoading, error } = useQuery<ARAgingReport>({
    queryKey: ["/api/reports/ar-aging"],
    queryFn: async () => {
      const response = await fetch("/api/reports/ar-aging", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch AR aging report");
      return response.json();
    },
  });

  const handleInvoiceClick = (invoiceId: string) => {
    setLocation(`/invoices/${invoiceId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container mx-auto p-6">
          <Card>
            <CardContent className="p-8">
              <p className="text-center text-muted-foreground">Loading AR aging report...</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <main className="container mx-auto p-6">
          <Card>
            <CardContent className="p-8">
              <p className="text-center text-destructive">Failed to load report. Please try again.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { summary, buckets, invoices } = report || {
    summary: { totalOutstanding: 0, totalInvoices: 0, averageDaysOutstanding: 0 },
    buckets: [],
    invoices: [],
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <DollarSign className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Accounts Receivable Aging</h1>
            <p className="text-muted-foreground">Outstanding invoice balances by age</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Outstanding</CardDescription>
              <CardTitle className="text-2xl">{formatCurrency(summary.totalOutstanding)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Open Invoices</CardDescription>
              <CardTitle className="text-2xl">{summary.totalInvoices}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Days Outstanding</CardDescription>
              <CardTitle className="text-2xl">{summary.averageDaysOutstanding} days</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Aging Buckets */}
        <div className="grid md:grid-cols-4 gap-4">
          {buckets.map((bucket) => (
            <Card key={bucket.bucket}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${BUCKET_COLORS[bucket.bucket]}`} />
                  <CardDescription>{BUCKET_LABELS[bucket.bucket]}</CardDescription>
                </div>
                <CardTitle className="text-xl">{formatCurrency(bucket.totalBalance)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">
                  {bucket.count} invoice{bucket.count !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Invoice List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Outstanding Invoices
            </CardTitle>
            <CardDescription>
              Click any row to view invoice details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="text-center py-8">
                <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No outstanding invoices</p>
                <p className="text-sm text-muted-foreground mt-1">
                  All invoices have been paid or are in draft status
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow
                      key={invoice.id}
                      className="cursor-pointer"
                      onClick={() => handleInvoiceClick(invoice.id)}
                      data-testid={`ar-invoice-row-${invoice.id}`}
                    >
                      <TableCell className="font-medium">
                        {invoice.invoiceNumber || "-"}
                      </TableCell>
                      <TableCell>
                        {invoice.customerCompany.name || invoice.location.companyName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.location.location || "-"}
                      </TableCell>
                      <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(invoice.total)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(invoice.balance)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={invoice.agingBucket === "90+" ? "destructive" : "secondary"}
                          className="whitespace-nowrap"
                        >
                          {invoice.daysOverdue > 0 && (
                            <AlertTriangle className="h-3 w-3 mr-1" />
                          )}
                          {invoice.daysOverdue} days
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
