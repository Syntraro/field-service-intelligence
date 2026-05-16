/**
 * Invoices list page — standalone shell wrapping the canonical InvoiceListPanel.
 *
 * 2026-03-28: Redesigned to match approved Jobs-style hierarchy.
 * 2026-05-13: Extracted list/table logic into InvoiceListPanel; this file is
 *             now a thin page shell that provides the header and page wrapper.
 *             The panel handles all data-fetching, filtering, search, and bulk
 *             actions, making it reusable in the Receivables workspace.
 */
import { useSearch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { InvoiceListPanel, type InvoiceView } from "@/components/invoices/InvoiceListPanel";

// Maps URL params to InvoiceView. view= wins over filter= (legacy dashboard links).
const VALID_VIEWS: InvoiceView[] = ["all", "overdue", "awaiting-payment", "drafts", "paid"];

const FILTER_TO_VIEW: Record<string, InvoiceView> = {
  overdue:          "overdue",
  draft:            "drafts",
  awaiting_payment: "awaiting-payment",
  paid:             "paid",
};

function readActiveView(search: string): InvoiceView {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (VALID_VIEWS as string[]).includes(view)) return view as InvoiceView;
  const filter = params.get("filter");
  if (filter && FILTER_TO_VIEW[filter]) return FILTER_TO_VIEW[filter];
  return "all";
}

export default function InvoicesListPage({ embedded = false }: { embedded?: boolean }) {
  const search = useSearch();
  const activeView = readActiveView(search);

  const panel = <InvoiceListPanel activeView={activeView} />;

  // When embedded=true the workspace provides its own header.
  if (embedded) {
    return <div data-testid="invoices-page">{panel}</div>;
  }

  return (
    <div className="min-h-screen bg-app-bg" data-testid="invoices-page">
      {!embedded && (
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-title font-medium text-slate-900">Invoices</h1>
            </div>
            <Link href="/invoices/new">
              <Button size="sm" className="rounded-lg px-3.5" data-testid="button-new-invoice">
                New Invoice
              </Button>
            </Link>
          </div>
        </div>
      )}
      {panel}
    </div>
  );
}
