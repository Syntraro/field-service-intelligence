/**
 * UniversalSearch — Command Palette + Global Search
 *
 * Combines quick actions, navigation shortcuts, and the existing data search
 * into a single keyboard-driven command palette (Linear / Raycast style).
 *
 * Trigger: click the header search bar, or press Cmd+K / Ctrl+K.
 * Sections: Quick Actions → Navigation → Search Results (ranked in that order).
 * Preserves all original search behavior (debounced /api/search, grouped results).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import {
  Search, Loader2, Briefcase, FileText, Building2, MapPin, Truck, UserCircle,
  Plus, LayoutDashboard, LayoutGrid, ClipboardList, Receipt, FileCheck,
  Users, Wrench, Settings, Shield, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ========================================
// TYPES
// ========================================

type SearchResultType = "job" | "invoice" | "customerCompany" | "location" | "supplier" | "contact";

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  match: string | null;
  customerCompanyId?: string;
  tenantCompanyId?: string;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
}

/** A static command entry (quick action or navigation shortcut) */
interface CommandItem {
  id: string;
  label: string;
  /** Searchable keywords (lowercase) — label is always searched too */
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  section: "action" | "navigation";
  route?: string;
  /** If provided, called instead of navigating */
  action?: () => void;
}

/** Unified palette row — either a command or a search result */
type PaletteItem =
  | { kind: "command"; item: CommandItem }
  | { kind: "search"; item: SearchResult };

// ========================================
// STATIC COMMANDS
// ========================================

/** Build static commands — create actions use runtime callbacks when provided */
function buildCommands(callbacks: { onCreateJob?: () => void; onCreateQuote?: () => void; onCreateInvoice?: () => void }): CommandItem[] {
  return [
    // Quick Actions — true create commands only (navigation lives in sidebar)
    { id: "create-job",         label: "Create Job",         keywords: ["new job", "add job", "create work order"], icon: Plus, section: "action", action: callbacks.onCreateJob },
    { id: "create-quote",       label: "Create Quote",       keywords: ["new quote", "add quote"], icon: Plus, section: "action", action: callbacks.onCreateQuote },
    { id: "create-invoice",     label: "Create Invoice",     keywords: ["new invoice", "add invoice", "bill"], icon: Plus, section: "action", action: callbacks.onCreateInvoice },
    { id: "create-task",        label: "Create Task",        keywords: ["new task", "add task", "supplier visit"], icon: Plus, section: "action", route: "/dispatch?newTask=1" },
    { id: "create-pm-contract", label: "Create PM Contract", keywords: ["new contract", "add contract", "pm contract", "preventive maintenance contract"], icon: Plus, section: "action", route: "/pm?newContract=1" },
    // Navigation — these appear only when the user searches for them
    { id: "open-dispatch",  label: "Open Dispatch",  keywords: ["dispatch", "calendar", "schedule"], icon: LayoutGrid, section: "navigation", route: "/dispatch" },
    { id: "open-pm",        label: "Open PM",        keywords: ["pm", "preventive maintenance"], icon: Wrench, section: "navigation", route: "/pm" },
    { id: "open-clients",   label: "Open Clients",   keywords: ["clients", "customers"], icon: Users, section: "navigation", route: "/clients" },
    { id: "open-invoices",  label: "Open Invoices",  keywords: ["invoices", "billing"], icon: Receipt, section: "navigation", route: "/invoices" },
    { id: "open-quotes",    label: "Open Quotes",    keywords: ["quotes", "estimates"], icon: FileCheck, section: "navigation", route: "/quotes" },
    { id: "nav-dashboard",  label: "Dashboard",      keywords: ["home", "overview"], icon: LayoutDashboard, section: "navigation", route: "/" },
    { id: "nav-dispatch",   label: "Dispatch",       keywords: ["dispatch", "calendar", "schedule", "disp"], icon: LayoutGrid, section: "navigation", route: "/dispatch" },
    { id: "nav-jobs",       label: "Jobs",           keywords: ["jobs", "job", "work orders"], icon: ClipboardList, section: "navigation", route: "/jobs" },
    { id: "nav-pm",         label: "PM",             keywords: ["pm", "preventive maintenance", "preventative"], icon: Wrench, section: "navigation", route: "/pm" },
    { id: "nav-invoices",   label: "Invoices",       keywords: ["invoices", "invoice", "billing", "inv"], icon: Receipt, section: "navigation", route: "/invoices" },
    { id: "nav-quotes",     label: "Quotes",         keywords: ["quotes", "quote", "estimates", "estimate"], icon: FileCheck, section: "navigation", route: "/quotes" },
    { id: "nav-clients",    label: "Clients",        keywords: ["clients", "client", "customers", "customer", "cli"], icon: Users, section: "navigation", route: "/clients" },
    { id: "nav-suppliers",  label: "Suppliers",      keywords: ["suppliers", "supplier", "vendor", "vendors"], icon: Building2, section: "navigation", route: "/suppliers" },
    { id: "nav-reports",    label: "Reports",        keywords: ["reports", "report", "analytics"], icon: FileText, section: "navigation", route: "/reports" },
    { id: "nav-settings",   label: "Settings",       keywords: ["settings", "preferences", "config"], icon: Settings, section: "navigation", route: "/settings" },
    { id: "nav-admin",      label: "Admin",          keywords: ["admin", "tenants", "administration"], icon: Shield, section: "navigation", route: "/admin/tenants" },
  ];
}

// ========================================
// SEARCH RESULT HELPERS (preserved from original)
// ========================================

const TYPE_ORDER: SearchResultType[] = ["invoice", "job", "customerCompany", "location", "contact", "supplier"];

const TYPE_ICONS: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  job: Briefcase,
  invoice: FileText,
  customerCompany: Building2,
  location: MapPin,
  contact: UserCircle,
  supplier: Truck,
};

const TYPE_LABELS: Record<SearchResultType, string> = {
  job: "Jobs",
  invoice: "Invoices",
  customerCompany: "Companies",
  location: "Locations",
  contact: "Contacts",
  supplier: "Suppliers",
};

const TYPE_ROUTES: Record<SearchResultType, (id: string) => string> = {
  job: (id) => `/jobs/${id}`,
  invoice: (id) => `/invoices/${id}`,
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

interface UniversalSearchProps {
  /** Callback to open the create-job flow from the command palette */
  onCreateJob?: () => void;
  /** Callback to open the create-quote flow */
  onCreateQuote?: () => void;
  /** Callback to open the create-invoice flow */
  onCreateInvoice?: () => void;
}

export default function UniversalSearch({ onCreateJob, onCreateQuote, onCreateInvoice }: UniversalSearchProps = {}) {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Surface controller: manages debounce timers and abort signals.
  // Query cache cleanup not needed here (no React Query) but abort is.
  const surface = useSurfaceController(open);

  // Build commands with create callbacks
  const commands = useMemo(
    () => buildCommands({ onCreateJob, onCreateQuote, onCreateInvoice }),
    [onCreateJob, onCreateQuote, onCreateInvoice],
  );

  // ------ Command filtering ------
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show all quick actions when empty, hide navigation to keep it compact
      return commands.filter((c) => c.section === "action");
    }
    const scored = commands.map((cmd) => ({ cmd, score: scoreCommand(cmd, query) }))
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
    inputRef.current?.blur();
  }, []);

  // ------ Execute a palette item ------
  const executeItem = useCallback((item: PaletteItem) => {
    if (item.kind === "command") {
      const cmd = item.item;
      if (cmd.action) {
        cmd.action();
      } else if (cmd.route) {
        setLocation(cmd.route);
      }
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
  const actionItems = paletteItems.filter((p) => p.kind === "command" && p.item.section === "action");
  const navItems = paletteItems.filter((p) => p.kind === "command" && p.item.section === "navigation");
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
          {cmd.section === "action" && !cmd.route && (
            <Zap className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          )}
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
          <div className="font-medium truncate">{sr.title}</div>
          {sr.subtitle && (
            <div className="text-xs text-muted-foreground truncate">{sr.subtitle}</div>
          )}
        </div>
        {sr.match && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
            {sr.match}
          </span>
        )}
      </button>
    );
  };

  // ------ Section header ------
  const sectionHeader = (label: string) => (
    <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
      {label}
    </div>
  );

  // Determine if palette should show (always show when open — even with empty query for quick actions)
  const showPalette = open;

  return (
    <div ref={paletteRef} className="relative">
      {/* Header search input — always visible */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF]" />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF] animate-spin" />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder="Search or run command…"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          data-testid="universal-search-input"
          className="h-8 w-72 rounded-md border border-white/20 pl-8 pr-8 text-sm text-[#111827] placeholder:text-[#9CA3AF] bg-white/90 focus-visible:outline-none focus-visible:border-[#76B054] focus-visible:ring-2 focus-visible:ring-[rgba(118,176,84,0.25)] focus-visible:bg-white"
        />
      </div>

      {/* Floating command palette panel */}
      {showPalette && (
        <div
          className="absolute top-[calc(100%+6px)] right-0 w-96 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-50 overflow-hidden"
          data-testid="command-palette"
        >
          <div className="max-h-[420px] overflow-y-auto">
            {/* Quick Actions section */}
            {actionItems.length > 0 && (
              <div className="py-1">
                {sectionHeader("Quick Actions")}
                <div className="px-1">
                  {actionItems.map((item) => renderRow(item, paletteItems.indexOf(item)))}
                </div>
              </div>
            )}

            {/* Navigation section */}
            {navItems.length > 0 && (
              <div className="py-1">
                {actionItems.length > 0 && <div className="mx-3 border-t border-border" />}
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
                  {(actionItems.length > 0 || navItems.length > 0) && (
                    <div className="mx-3 border-t border-border" />
                  )}
                  {sectionHeader("Search Results")}
                  <div className="px-1">
                    {orderedSearchTypes.map((type) => {
                      const typeResults = groupedResults[type];
                      return (
                        <div key={type}>
                          <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
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
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground flex items-center gap-3">
            <span><kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">↵</kbd> select</span>
            <span><kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">esc</kbd> close</span>
          </div>
        </div>
      )}
    </div>
  );
}
