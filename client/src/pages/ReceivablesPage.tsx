import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/ui/chip";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { InvoicesWorkspaceTab, readViewFromSearch, type InvoiceStatusFilter } from "./receivables/InvoicesWorkspaceTab";
import { PaymentsTab } from "./receivables/PaymentsTab";
import { InsightsTab } from "./receivables/InsightsTab";
import { cn } from "@/lib/utils";

type ReceivablesTab = "invoices" | "payments" | "insights";

const TAB_VALUES: ReceivablesTab[] = ["invoices", "payments", "insights"];

const TABS: { value: ReceivablesTab; label: string }[] = [
  { value: "invoices",  label: "Invoices" },
  { value: "payments",  label: "Payments" },
  { value: "insights",  label: "Insights" },
];

function readTabFromSearch(search: string): ReceivablesTab {
  const params = new URLSearchParams(search);
  const t = params.get("tab");
  // Normalize the legacy queue tab to invoices.
  if (t === "queue") return "invoices";
  // Normalize legacy activity tab to insights.
  if (t === "activity") return "insights";
  return (TAB_VALUES as string[]).includes(t ?? "") ? (t as ReceivablesTab) : "invoices";
}

const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = [
  "all", "draft", "awaiting_payment", "partial_paid", "paid", "overdue", "voided",
];

function filterLabel(f: InvoiceStatusFilter): string {
  if (f === "all") return "All";
  if (f === "awaiting_payment") return "Unpaid";
  if (f === "partial_paid") return "Partial";
  if (f === "overdue") return "Overdue";
  return f.charAt(0).toUpperCase() + f.slice(1);
}

export default function ReceivablesPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<ReceivablesTab>(() => readTabFromSearch(search));

  // Invoice search/filter state — hoisted here so the tab row can render them.
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceStatusFilter>("all");

  // Reset search/filter when the active view changes (e.g. switching from overdue → all).
  const activeView = readViewFromSearch(search);
  useEffect(() => {
    setInvoiceSearch("");
    setInvoiceFilter("all");
  }, [activeView]);

  // Sync tab state when URL search changes (back/forward, external navigation).
  useEffect(() => {
    setActiveTab(readTabFromSearch(search));
  }, [search]);

  const handleTabChange = (tab: ReceivablesTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(search);
    params.set("tab", tab);
    // Clear the view param when navigating away from the invoices tab.
    if (tab !== "invoices") params.delete("view");
    const qs = params.toString();
    setLocation(qs ? `/receivables?${qs}` : "/receivables", { replace: true });
  };

  return (
    <div className="min-h-screen bg-app-bg flex flex-col" data-testid="receivables-page">
      {/* Page header + tab strip */}
      <div className="bg-white border-b border-border px-6 pt-4 pb-0 shrink-0">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-page-title font-medium text-slate-900">Receivables</h1>
            <p className="text-caption text-slate-500 mt-0.5">
              Manage invoices, collections, payments, and customer account activity.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 h-9">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button size="sm" className="gap-1.5 h-9" data-testid="button-new-invoice-receivables">
              <Plus className="h-4 w-4" />
              New Invoice
            </Button>
          </div>
        </div>

        {/* Tab strip — tabs left, invoice search/filter right when invoices tab active */}
        <div className="flex items-end" role="tablist" aria-label="Receivables sections">
          <div className="flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.value}
                onClick={() => handleTabChange(tab.value)}
                data-testid={`tab-${tab.value}`}
                className={cn(
                  "px-4 py-2.5 text-caption border-b-2 transition-colors",
                  activeTab === tab.value
                    ? "border-b-brand text-foreground font-medium"
                    : "border-b-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Invoice search + filter — only when invoices tab is active */}
          {activeTab === "invoices" && (
            <div className="ml-auto flex items-center gap-2 pb-1" data-testid="invoice-tab-controls">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search invoices…"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  className="pl-8 h-8 w-52 rounded-md border-slate-200 bg-white text-sm"
                  data-testid="input-search-invoices-tab"
                />
              </div>
              <FiltersButton
                activeCount={invoiceFilter !== "all" ? 1 : 0}
                onClear={() => setInvoiceFilter("all")}
              >
                <FilterSection label="Status">
                  <div className="flex flex-wrap gap-1.5">
                    {INVOICE_STATUS_FILTERS.map((f) => (
                      <FilterChip
                        key={f}
                        selected={invoiceFilter === f}
                        onClick={() => setInvoiceFilter(f)}
                        data-testid={`button-tab-filter-${f}`}
                      >
                        {filterLabel(f)}
                      </FilterChip>
                    ))}
                  </div>
                </FilterSection>
              </FiltersButton>
            </div>
          )}
        </div>
      </div>

      {/* Tab content — flex-1 min-h-0 so the invoices workspace fills remaining viewport height */}
      <div className="flex-1 min-h-0">
        {activeTab === "invoices" && (
          <div className="h-full overflow-hidden" data-testid="tab-content-invoices">
            <InvoicesWorkspaceTab
              externalSearchQuery={invoiceSearch}
              onExternalSearchChange={setInvoiceSearch}
              externalActiveFilter={invoiceFilter}
              onExternalActiveFilterChange={setInvoiceFilter}
            />
          </div>
        )}
        {activeTab === "payments" && (
          <div data-testid="tab-content-payments">
            <PaymentsTab />
          </div>
        )}
        {activeTab === "insights" && (
          <div data-testid="tab-content-insights">
            <InsightsTab />
          </div>
        )}
      </div>
    </div>
  );
}
