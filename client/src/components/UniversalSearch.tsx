/**
 * UniversalSearch - Global search component for header
 *
 * Searches across jobs, invoices, customer companies, locations, and suppliers.
 * Features: debounce 200ms, grouped results, keyboard navigation, routing.
 *
 * Phase 4 of RALPH global search implementation.
 *
 * Updated 2026-02-06:
 * - Stable group ordering: invoice > job > customerCompany > location > supplier
 * - Invoices always appear above jobs in results
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, Briefcase, FileText, Building2, MapPin, Truck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ========================================
// TYPES
// ========================================

type SearchResultType = "job" | "invoice" | "customerCompany" | "location" | "supplier";

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  match: string | null;
  customerCompanyId?: string; // For customerCompany results: customer_companies.id
  tenantCompanyId?: string;   // For customerCompany results: owning company (tenant) ID
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

// ========================================
// CONSTANTS
// ========================================

// Stable group order: invoices first (especially important for numeric queries like "1001")
const TYPE_ORDER: SearchResultType[] = ["invoice", "job", "customerCompany", "location", "supplier"];

const TYPE_ICONS: Record<SearchResultType, typeof Briefcase> = {
  job: Briefcase,
  invoice: FileText,
  customerCompany: Building2,
  location: MapPin,
  supplier: Truck,
};

const TYPE_LABELS: Record<SearchResultType, string> = {
  job: "Jobs",
  invoice: "Invoices",
  customerCompany: "Companies",
  location: "Locations",
  supplier: "Suppliers",
};

const TYPE_ROUTES: Record<SearchResultType, (id: string) => string> = {
  job: (id) => `/jobs/${id}`,
  invoice: (id) => `/invoices/${id}`,
  customerCompany: (id) => `/clients/${id}`,
  location: (id) => `/locations/${id}`,
  supplier: (id) => `/suppliers/${id}`,
};

// ========================================
// COMPONENT
// ========================================

export default function UniversalSearch() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Group results by type
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = [];
    }
    acc[result.type].push(result);
    return acc;
  }, {} as Record<SearchResultType, SearchResult[]>);

  // Get ordered types that have results (stable order: invoice > job > ...)
  const orderedTypes = TYPE_ORDER.filter((t) => groupedResults[t]?.length > 0);

  // Flat list for keyboard navigation (follows same visual order)
  const flatResults = orderedTypes.flatMap((t) => groupedResults[t]);

  // Debounced search
  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=20`, { credentials: "include" });
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle input change with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setOpen(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      search(value);
    }, 200);
  };

  // Navigate to selected result
  const handleSelect = (result: SearchResult) => {
    // For customerCompany, use customerCompanyId (cc.id) for routing
    const routeId = result.type === "customerCompany" && result.customerCompanyId
      ? result.customerCompanyId
      : result.id;
    const route = TYPE_ROUTES[result.type](routeId);
    setLocation(route);
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || flatResults.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatResults[selectedIndex]) {
          handleSelect(flatResults[selectedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Maintain focus on input when results change or popover opens
  useEffect(() => {
    if (open || results.length > 0) {
      inputRef.current?.focus();
    }
  }, [open, results.length]);

  // Render a single result item
  const renderResult = (result: SearchResult, index: number) => {
    const Icon = TYPE_ICONS[result.type];
    const isSelected = index === selectedIndex;

    return (
      <button
        key={`${result.type}-${result.id}`}
        type="button"
        className={cn(
          "w-full flex items-start gap-3 px-3 py-2 text-left text-sm rounded-md transition-colors",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
        )}
        onClick={() => handleSelect(result)}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{result.title}</div>
          {result.subtitle && (
            <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
          )}
        </div>
        {result.match && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            {result.match}
          </span>
        )}
      </button>
    );
  };

  // Track current index across groups for keyboard navigation
  let currentIndex = 0;

  return (
    <Popover open={open && (query.length >= 2 || results.length > 0)} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search jobs, invoices, clients..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 2 && setOpen(true)}
            data-testid="universal-search-input"
            className="h-8 w-72 rounded-md border border-input bg-white dark:bg-gray-900 pl-8 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-96 overflow-y-auto">
          {query.length < 2 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </div>
          ) : loading && results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          ) : (
            <div className="py-2">
              {orderedTypes.map((type) => {
                const typeResults = groupedResults[type];
                const startIndex = currentIndex;
                currentIndex += typeResults.length;

                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {TYPE_LABELS[type]}
                    </div>
                    <div className="px-1">
                      {typeResults.map((result, i) => renderResult(result, startIndex + i))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium">↑↓</span> navigate · <span className="font-medium">Enter</span> select · <span className="font-medium">Esc</span> close
        </div>
      </PopoverContent>
    </Popover>
  );
}
