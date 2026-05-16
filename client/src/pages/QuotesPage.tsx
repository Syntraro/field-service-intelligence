import { useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/ui/chip";
import { FiltersButton, FilterSection } from "@/components/filters/FiltersButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { QuotesWorkspaceTab, type QuoteStatusFilter } from "./quotes/QuotesWorkspaceTab";

// ── Filter constants ──────────────────────────────────────────────────────────

const STATUS_FILTERS: QuoteStatusFilter[] = [
  "all", "draft", "sent", "approved", "declined", "expired", "converted",
];

function filterLabel(f: QuoteStatusFilter): string {
  if (f === "all") return "All";
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// ── QuotesPage ────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const [, setLocation] = useLocation();

  // Search + filter state — rendered in page header, threaded into workspace.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("all");

  return (
    <div className="h-full bg-app-bg flex flex-col overflow-hidden" data-testid="quotes-page">
      <PageHeader title="Quotes">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            placeholder="Search quotes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 w-56 h-8 rounded-lg border-slate-200 bg-white text-sm"
            data-testid="input-search-quotes-toolbar"
          />
        </div>

        {/* Status filter */}
        <FiltersButton
          activeCount={statusFilter !== "all" ? 1 : 0}
          onClear={() => setStatusFilter("all")}
        >
          <FilterSection label="Status">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <FilterChip
                  key={f}
                  selected={statusFilter === f}
                  onClick={() => setStatusFilter(f)}
                  data-testid={`button-toolbar-filter-${f}`}
                >
                  {filterLabel(f)}
                </FilterChip>
              ))}
            </div>
          </FilterSection>
        </FiltersButton>

        {/* New Quote */}
        <Button
          type="button"
          size="sm"
          className="rounded-lg px-3.5"
          onClick={() => setLocation("/quotes/new")}
          data-testid="button-new-quote"
        >
          New Quote
        </Button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-hidden">
        <QuotesWorkspaceTab
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      </div>
    </div>
  );
}
