import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InvoicesWorkspaceTab, readViewFromSearch } from "./receivables/InvoicesWorkspaceTab";
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

export default function ReceivablesPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<ReceivablesTab>(() => readTabFromSearch(search));

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
    <div className="h-full bg-app-bg flex flex-col overflow-hidden" data-testid="receivables-page">
      {/* Page header — 88px fixed height */}
      <div className="bg-white border-b border-border h-[88px] flex items-center px-6 shrink-0">
        <div className="flex items-center justify-between gap-4 w-full">
          <div>
            <h1 className="text-title font-medium text-slate-900">Receivables</h1>
            <p className="text-row text-slate-500 mt-0.5">
              Manage invoices, collections, payments, and customer account activity.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-2 rounded-lg px-3.5">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button size="sm" className="rounded-lg px-3.5" data-testid="button-new-invoice-receivables">
              New Invoice
            </Button>
          </div>
        </div>
      </div>

      {/* Tab strip — 52px fixed height, 24px left padding */}
      <div
        className="bg-white border-b border-border h-[52px] pl-6 flex items-end shrink-0"
        role="tablist"
        aria-label="Receivables sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.value}
            onClick={() => handleTabChange(tab.value)}
            data-testid={`tab-${tab.value}`}
            className={cn(
              "px-4 py-2.5 text-row border-b-2 transition-colors",
              activeTab === tab.value
                ? "border-b-brand text-foreground font-medium"
                : "border-b-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "invoices" && (
          <div className="h-full overflow-hidden" data-testid="tab-content-invoices">
            <InvoicesWorkspaceTab />
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
