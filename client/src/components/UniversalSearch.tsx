/**
 * UniversalSearch — Search bar + navigation command palette.
 *
 * Trigger: click the header search bar, or press Cmd+K / Ctrl+K.
 * Sections: Navigation → Search Results.
 * Debounced /api/search, grouped results.
 *
 * 2026-04-26: removed the "Quick Actions" creation entries
 * (Create Job/Client/Invoice/Quote/Task/Maintenance Plan). The header
 * "+ New" dropdown is the single canonical creation entry point;
 * mirroring it in search was redundant noise.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { getClientDisplayName } from "@shared/clientDisplayName";
// 2026-05-02 entity-number visual language: same primitive used by
// detail headers + list rows. Search rows render the structured
// number as a blue pill when the server supplies the new fields.
import { EntityNumber } from "@/components/common/EntityNumber";
import {
  Search, Loader2, Briefcase, FileText, Building2, MapPin, Truck, UserCircle,
  LayoutDashboard, LayoutGrid, ClipboardList, Receipt, FileCheck,
  Users, Wrench, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ========================================
// TYPES
// ========================================

type SearchResultType = "job" | "invoice" | "quote" | "customerCompany" | "location" | "supplier" | "contact";

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  match: string | null;
  customerCompanyId?: string;
  tenantCompanyId?: string;
  firstName?: string | null;
  lastName?: string | null;
  useCompanyAsPrimary?: boolean | null;
  // 2026-05-02 entity-number visual language. Server-supplied
  // structured fields. When present, the row renders the number
  // through the canonical `EntityNumber` primitive (blue pill);
  // when absent the row falls back to the legacy `title` string.
  entityNumber?: string | null;
  entityNumberLabel?: "Job #" | "Invoice #" | "Quote #";
  entityNumberType?: "job" | "invoice" | "quote";
  titleText?: string;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

/** A static navigation shortcut row */
interface CommandItem {
  id: string;
  label: string;
  /** Searchable keywords (lowercase) — label is always searched too */
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  route: string;
}

/** Unified palette row — either a navigation command or a search result */
type PaletteItem =
  | { kind: "command"; item: CommandItem }
  | { kind: "search"; item: SearchResult };

// ========================================
// STATIC NAVIGATION COMMANDS
// ========================================

/**
 * Navigation shortcuts. Surface only when the user types a query —
 * the canonical creation entry point is the header "+ New" dropdown
 * in App.tsx, not this palette.
 */
const NAVIGATION_COMMANDS: CommandItem[] = [
  { id: "open-dispatch",  label: "Open Dispatch",  keywords: ["dispatch", "calendar", "schedule"], icon: LayoutGrid, route: "/dispatch" },
  { id: "open-pm",        label: "Open PM",        keywords: ["pm", "preventive maintenance"], icon: Wrench, route: "/pm" },
  { id: "open-clients",   label: "Open Clients",   keywords: ["clients", "customers"], icon: Users, route: "/clients" },
  { id: "open-invoices",  label: "Open Receivables",  keywords: ["invoices", "receivables", "billing"], icon: Receipt, route: "/receivables?tab=invoices" },
  { id: "open-quotes",    label: "Open Quotes",    keywords: ["quotes", "estimates"], icon: FileCheck, route: "/quotes" },
  { id: "nav-dashboard",  label: "Dashboard",      keywords: ["home", "overview"], icon: LayoutDashboard, route: "/" },
  { id: "nav-dispatch",   label: "Dispatch",       keywords: ["dispatch", "calendar", "schedule", "disp"], icon: LayoutGrid, route: "/dispatch" },
  { id: "nav-jobs",       label: "Jobs",           keywords: ["jobs", "job", "work orders"], icon: ClipboardList, route: "/jobs" },
  { id: "nav-pm",         label: "PM",             keywords: ["pm", "preventive maintenance", "preventative"], icon: Wrench, route: "/pm" },
  { id: "nav-invoices",   label: "Receivables",    keywords: ["invoices", "invoice", "receivables", "billing", "inv"], icon: Receipt, route: "/receivables?tab=invoices" },
  { id: "nav-quotes",     label: "Quotes",         keywords: ["quotes", "quote", "estimates", "estimate"], icon: FileCheck, route: "/quotes" },
  { id: "nav-clients",    label: "Clients",        keywords: ["clients", "client", "customers", "customer", "cli"], icon: Users, route: "/clients" },
  { id: "nav-suppliers",  label: "Suppliers",      keywords: ["suppliers", "supplier", "vendor", "vendors"], icon: Building2, route: "/suppliers" },
  { id: "nav-reports",    label: "Reports",        keywords: ["reports", "report", "analytics"], icon: FileText, route: "/reports" },
  { id: "nav-settings",   label: "Settings",       keywords: ["settings", "preferences", "config"], icon: Settings, route: "/settings" },
  // 2026-05-03 SECURITY LOCKDOWN: the "Admin" command-palette entry that
  // routed to /admin/tenants was removed. That URL rendered cross-tenant
  // platform data under tenant auth. Platform admin lives at /platform/*
  // (separate psid session); do not add a command-palette entry that
  // exposes platform paths through the tenant search surface.
];

// ========================================
// SEARCH RESULT HELPERS (preserved from original)
// ========================================

const TYPE_ORDER: SearchResultType[] = ["invoice", "job", "quote", "customerCompany", "location", "contact", "supplier"];

const TYPE_ICONS: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  job: Briefcase,
  invoice: FileText,
  quote: FileCheck,
  customerCompany: Building2,
  location: MapPin,
  contact: UserCircle,
  supplier: Truck,
};

const TYPE_LABELS: Record<SearchResultType, string> = {
  job: "Jobs",
  invoice: "Invoices",
  quote: "Quotes",
  customerCompany: "Companies",
  location: "Locations",
  contact: "Contacts",
  supplier: "Suppliers",
};

const TYPE_ROUTES: Record<SearchResultType, (id: string) => string> = {
  job: (id) => `/jobs/${id}`,
  invoice: (id) => `/invoices/${id}`,
  quote: (id) => `/quotes/${id}`,
  customerCompany: (id) => `/clients/${id}`,
  location: (id) => `/clients/${id}`,  // Fallback only — location routing handled explicitly in executeItem
  contact: (id) => `/clients/${id}`,  // Navigate to parent company (contacts live under companies)
  supplier: (id) => `/suppliers/${id}`,
};

// ========================================
// MATCHING
// ========================================

/** Score a command against a query. Higher = better match, 0 = no match. */
function scoreCommand(cmd: CommandItem, q: string): number {
  const lower = q.toLowerCase();
  const labelLower = cmd.label.toLowerCase();

  // Exact label match
  if (labelLower === lower) return 100;
  // Label starts with query
  if (labelLower.startsWith(lower)) return 80;
  // Label contains query
  if (labelLower.includes(lower)) return 60;

  // Check each keyword
  for (const kw of cmd.keywords) {
    if (kw === lower) return 70;
    if (kw.startsWith(lower)) return 55;
    if (kw.includes(lower)) return 40;
  }

  // Multi-word: check if all query words appear somewhere
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const searchable = `${labelLower} ${cmd.keywords.join(" ")}`;
    if (words.every((w) => searchable.includes(w))) return 50;
  }

  return 0;
}

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
  // Compact/expanded for tablet + medium-desktop widths. 2xl:w-72 always
  // wins at ≥ 1536px, so this state only has a visual effect below that.
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Surface controller: manages debounce timers and abort signals.
  // Query cache cleanup not needed here (no React Query) but abort is.
  const surface = useSurfaceController(open);

  // ------ Navigation-command filtering ------
  // Empty query = no commands rendered (search-only). Non-empty query
  // scores nav shortcuts so typing "dispatch" still jumps you there.
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return [];
    const scored = NAVIGATION_COMMANDS.map((cmd) => ({ cmd, score: scoreCommand(cmd, query) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((s) => s.cmd);
  }, [query]);

  // ------ Search results grouping (preserved) ------
  const groupedResults = useMemo(() => {
    const acc: Record<string, SearchResult[]> = {};
    for (const r of results) {
      (acc[r.type] ??= []).push(r);
    }
    return acc as Record<SearchResultType, SearchResult[]>;
  }, [results]);

  const orderedSearchTypes = TYPE_ORDER.filter((t) => groupedResults[t]?.length > 0);
  const flatSearchResults = orderedSearchTypes.flatMap((t) => groupedResults[t]);

  // ------ Build unified palette items ------
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const cmd of filteredCommands) items.push({ kind: "command", item: cmd });
    for (const sr of flatSearchResults) items.push({ kind: "search", item: sr });
    return items;
  }, [filteredCommands, flatSearchResults]);

  // Clamp selectedIndex when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [paletteItems.length]);

  // ------ Debounced API search with abort support ------
  // Uses surface.signal so in-flight requests are aborted on close/unmount.
  const search = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&limit=30`,
        { credentials: "include", signal: surface.signal }
      );
      // Guard: if surface closed while fetch was in-flight, don't update state
      if (surface.isStale()) return;
      if (res.ok) {
        const data: SearchResponse = await res.json();
        if (!surface.isStale()) setResults(data.results);
      }
    } catch (error: any) {
      // AbortError is expected when surface closes — silently ignore
      if (error?.name === "AbortError") return;
      console.error("Search error:", error);
    } finally {
      if (!surface.isStale()) setLoading(false);
    }
  }, [surface]);

  // ------ Input change with debounce ------
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (!open) setOpen(true);

    // Debounce via surface controller — auto-cancelled on close/unmount
    surface.debounce("search", () => search(value), 200);
  };

  // ------ Close + reset ------
  // All ephemeral state is reset atomically. The surface controller handles
  // aborting in-flight fetches and cancelling debounce timers.
  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    setLoading(false);
    setIsExpanded(false);
    inputRef.current?.blur();
  }, []);

  // ------ Focus / blur for compact expansion ------
  const handleFocus = useCallback(() => {
    setOpen(true);
    setIsExpanded(true);
  }, []);

  // Collapse back to compact only when query is empty and focus leaves the
  // entire palette container. Keeps the input wide while the user browses
  // results with the mouse (relatedTarget stays inside paletteRef).
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (paletteRef.current?.contains(e.relatedTarget as Node)) return;
    if (!query.trim()) {
      setIsExpanded(false);
    }
  }, [query]);

  // ------ Execute a palette item ------
  const executeItem = useCallback((item: PaletteItem) => {
    if (item.kind === "command") {
      setLocation(item.item.route);
    } else {
      const sr = item.item;
      // Location results navigate to parent client page with ?location= scope
      if (sr.type === "location") {
        if (sr.customerCompanyId) {
          setLocation(`/clients/${sr.customerCompanyId}?location=${sr.id}`);
        } else {
          // Strict guard: location must have a parent company — block navigation entirely
          console.error("[Search] Location result missing customerCompanyId — invalid state", { locationId: sr.id });
          return;
        }
      } else {
        const routeId = (sr.type === "customerCompany" || sr.type === "contact") && sr.customerCompanyId
          ? sr.customerCompanyId : sr.id;
        setLocation(TYPE_ROUTES[sr.type](routeId));
      }
    }
    closePalette();
  }, [setLocation, closePalette]);

  // ------ Keyboard navigation ------
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, paletteItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (paletteItems[selectedIndex]) executeItem(paletteItems[selectedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        closePalette();
        break;
      case "Tab":
        // Prevent Tab from moving focus out of the palette unexpectedly
        if (open) e.preventDefault();
        break;
    }
  };

  // ------ Global Cmd+K / Ctrl+K listener ------
  // IMPORTANT: Suppresses when a modal dialog is open (e.g., QuickAddJobDialog)
  // to prevent cross-surface keyboard interference. Checks for Radix Dialog's
  // [role="dialog"][data-state="open"] in the DOM as the canonical signal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Check if a modal dialog is open — if so, do NOT steal focus
        const modalOpen = document.querySelector('[role="dialog"][data-state="open"]');
        if (modalOpen) return; // Let the dialog handle its own keyboard events

        e.preventDefault();
        e.stopPropagation();
        if (open) {
          closePalette();
        } else {
          setOpen(true);
          setIsExpanded(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [open, closePalette]);

  // ------ Click-outside to close ------
  // Only active when palette is open. Ignores clicks inside modal dialogs
  // to prevent closing the palette when user clicks inside a dialog that
  // was opened from a palette action.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (paletteRef.current && !paletteRef.current.contains(target)) {
        // Don't close if click landed inside a modal dialog
        const dialog = (target as Element)?.closest?.('[role="dialog"]');
        if (dialog) return;
        closePalette();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closePalette]);

  // ------ Focus input when palette opens ------
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ------ Scroll selected item into view ------
  useEffect(() => {
    if (!open) return;
    const el = paletteRef.current?.querySelector(`[data-palette-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open]);

  // ------ Section helpers for rendering ------
  const navItems = paletteItems.filter((p) => p.kind === "command");
  const hasSearchResults = flatSearchResults.length > 0;

  /** Offset where search results start in the flat paletteItems list */
  const searchResultsOffset = filteredCommands.length;

  /** Render a single palette row */
  const renderRow = (item: PaletteItem, idx: number) => {
    const isSelected = idx === selectedIndex;
    if (item.kind === "command") {
      const cmd = item.item;
      const Icon = cmd.icon;
      return (
        <button
          key={cmd.id}
          type="button"
          data-palette-index={idx}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-md transition-colors",
            isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
          )}
          onClick={() => executeItem(item)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate">{cmd.label}</span>
        </button>
      );
    }
    // Search result row
    const sr = item.item;
    const Icon = TYPE_ICONS[sr.type];
    return (
      <button
        key={`${sr.type}-${sr.id}`}
        type="button"
        data-palette-index={idx}
        className={cn(
          "w-full flex items-start gap-3 px-3 py-2 text-left text-sm rounded-md transition-colors",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
        )}
        onClick={() => executeItem(item)}
        onMouseEnter={() => setSelectedIndex(idx)}
      >
        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          {/* 2026-05-02 entity-number rendering. When the server sends
              the structured `entityNumberType` field, render the
              number as a blue pill via the canonical EntityNumber
              primitive followed by the descriptive `titleText`. When
              `entityNumberType` is absent, fall back to the legacy
              `title` rendering verbatim — back-compat for result
              types not migrated (customerCompany / location / supplier
               / contact). The `customerCompany` branch keeps using
              `getClientDisplayName` to honor the canonical identity
              resolver. No duplicated number text — when the pill
              renders we use `titleText` (server-stripped of the
              embedded number) instead of `title`. */}
          {sr.entityNumberType ? (
            <div className="flex items-center gap-2 min-w-0">
              {sr.entityNumber
                ? <EntityNumber variant="primary">{sr.entityNumber}</EntityNumber>
                : <EntityNumber variant="missing" />}
              {sr.titleText && (
                <span className="font-medium truncate min-w-0">{sr.titleText}</span>
              )}
            </div>
          ) : (
            <div className="font-medium truncate">
              {sr.type === "customerCompany"
                ? getClientDisplayName({ name: sr.title, firstName: sr.firstName, lastName: sr.lastName, useCompanyAsPrimary: sr.useCompanyAsPrimary })
                : sr.title}
            </div>
          )}
          {sr.subtitle && (
            <div className="text-helper text-muted-foreground truncate">{sr.subtitle}</div>
          )}
        </div>
        {sr.match && (
          <span className="text-helper text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            {sr.match}
          </span>
        )}
      </button>
    );
  };

  // ------ Section header ------
  const sectionHeader = (label: string) => (
    <div className="px-3 py-1.5 text-label font-medium text-muted-foreground tracking-wider select-none">
      {label}
    </div>
  );

  // Show the palette only when there's something to render. With an empty
  // query and no results we hide it entirely — the search bar is the only
  // affordance until the user types. (Pre-2026-04-26 the palette stayed
  // open to surface Quick Actions; that section has been removed.)
  const showPalette =
    open &&
    (navItems.length > 0 || hasSearchResults || (query.trim().length >= 2));

  return (
    // Three-step responsive width — shrink-0 keeps declared widths exact:
    //   <md  (< 768px):    w-8     — icon-only
    //   md→2xl (768–1535px): md:w-24 — compact pill, placeholder "Search"
    //   2xl+ (≥ 1536px):  2xl:w-72 — full input, full placeholder
    // isExpanded overrides to w-72 at any breakpoint when the user is
    // actively searching; 2xl:w-72 always wins at true-wide desktop.
    <div
      ref={paletteRef}
      data-expanded={isExpanded}
      data-testid="universal-search-wrapper"
      className={cn(
        "relative shrink-0 transition-[width] duration-200 ease-in-out",
        isExpanded ? "w-72" : "w-8 md:w-24 2xl:w-72",
      )}
    >
      {/* Header search input — always visible */}
      <div className="relative">
        {/* pointer-events-none: clicks on the icon pass through to the input */}
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF] pointer-events-none" />
        {/* Spinner only renders when expanded — no room in compact pill */}
        {loading && isExpanded && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF] animate-spin" />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={isExpanded ? "Search jobs, clients, invoices..." : "Search"}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-testid="universal-search-input"
          className={cn(
            "h-8 w-full rounded-md border border-white/20 pl-8 text-sm text-[#111827] placeholder:text-[#9CA3AF] bg-white/90",
            "focus-visible:outline-none focus-visible:border-[#76B054] focus-visible:ring-2 focus-visible:ring-[rgba(118,176,84,0.25)] focus-visible:bg-white",
            // pr-8 when expanded (room for spinner); pr-2 compact (no spinner)
            isExpanded ? "pr-8 cursor-text" : "pr-2 cursor-pointer 2xl:cursor-text",
          )}
        />
      </div>

      {/* Floating command palette panel */}
      {showPalette && (
        <div
          className="absolute top-[calc(100%+6px)] right-0 w-96 rounded-md border border-border bg-popover text-popover-foreground shadow-lg z-50 overflow-hidden"
          data-testid="command-palette"
        >
          <div className="max-h-[420px] overflow-y-auto">
            {/* Navigation section */}
            {navItems.length > 0 && (
              <div className="py-1">
                {sectionHeader("Navigation")}
                <div className="px-1">
                  {navItems.map((item) => renderRow(item, paletteItems.indexOf(item)))}
                </div>
              </div>
            )}

            {/* Search Results section (preserved original grouped rendering) */}
            {hasSearchResults && (() => {
              let srIdx = searchResultsOffset;
              return (
                <div className="py-1">
                  {navItems.length > 0 && (
                    <div className="mx-3 border-t border-border" />
                  )}
                  {sectionHeader("Search Results")}
                  <div className="px-1">
                    {orderedSearchTypes.map((type) => {
                      const typeResults = groupedResults[type];
                      return (
                        <div key={type}>
                          <div className="px-3 py-1 text-label font-medium text-muted-foreground/70 tracking-wider">
                            {TYPE_LABELS[type]}
                          </div>
                          {typeResults.map((sr) => {
                            const idx = srIdx++;
                            return renderRow({ kind: "search", item: sr }, idx);
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Loading state for search */}
            {loading && results.length === 0 && query.trim().length >= 2 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1.5" />
                Searching...
              </div>
            )}

            {/* No results state — only when query is non-trivial and no commands match either */}
            {!loading && query.trim().length >= 2 && paletteItems.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer with keyboard hints */}
          <div className="border-t px-3 py-1.5 text-helper text-muted-foreground flex items-center gap-3">
            <span><kbd className="font-mono text-xs bg-muted px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono text-xs bg-muted px-1 py-0.5 rounded">↵</kbd> select</span>
            <span><kbd className="font-mono text-xs bg-muted px-1 py-0.5 rounded">esc</kbd> close</span>
          </div>
        </div>
      )}
    </div>
  );
}
