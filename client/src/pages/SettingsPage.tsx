import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  SETTINGS_CATEGORIES,
  type SettingsCategory,
  type SettingsChild,
} from "@/lib/settingsNavConfig";

// ── Search filtering ──────────────────────────────────────────────────────────

interface SearchResult {
  child: SettingsChild;
  categoryTitle: string;
}

function searchSettings(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  for (const cat of SETTINGS_CATEGORIES) {
    for (const child of cat.children) {
      const matches =
        child.title.toLowerCase().includes(q) ||
        child.description.toLowerCase().includes(q) ||
        cat.title.toLowerCase().includes(q) ||
        child.keywords?.some((k) => k.toLowerCase().includes(q));
      if (matches) results.push({ child, categoryTitle: cat.title });
    }
  }
  return results;
}

// ── Child setting row ─────────────────────────────────────────────────────────

function ChildRow({
  child,
  onNavigate,
}: {
  child: SettingsChild;
  onNavigate: (child: SettingsChild) => void;
}) {
  const Icon = child.icon;
  return (
    <button
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left group"
      onClick={() => onNavigate(child)}
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="text-sm text-foreground truncate block">{child.title}</span>
        <span className="text-helper text-muted-foreground truncate block">{child.description}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

// ── Category section — header is static, only children navigate ───────────────

function CategorySection({
  category,
  onNavigate,
}: {
  category: SettingsCategory;
  onNavigate: (child: SettingsChild) => void;
}) {
  const Icon = category.icon;
  return (
    <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
      {/* Static, non-interactive header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b">
        <div className="p-1.5 rounded-md bg-muted shrink-0">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{category.title}</p>
          <p className="text-helper text-muted-foreground truncate">{category.description}</p>
        </div>
      </div>

      {/* Clickable child settings */}
      <div className="px-1 py-1">
        {category.children.map((child) => (
          <ChildRow key={child.key} child={child} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

// ── Search result row ─────────────────────────────────────────────────────────

function SearchResultItem({
  result,
  onNavigate,
}: {
  result: SearchResult;
  onNavigate: (child: SettingsChild) => void;
}) {
  const Icon = result.child.icon;
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm hover:border-primary/30 hover:shadow-md transition-all text-left group"
      onClick={() => onNavigate(result.child)}
    >
      <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{result.child.title}</p>
        <p className="text-helper text-muted-foreground">{result.child.description}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-helper text-muted-foreground">{result.categoryTitle}</p>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const searchResults = useMemo(() => searchSettings(search), [search]);
  const isSearching = search.trim().length > 0;

  const handleNavigate = useCallback(
    (child: SettingsChild) => {
      setLocation(child.href);
    },
    [setLocation],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="settings-page">
      {/* Header */}
      <div>
        <h1 className="text-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your application preferences</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search settings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-settings-search"
        />
      </div>

      {/* Search results */}
      {isSearching ? (
        searchResults.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="settings-empty-search">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No settings found</p>
            <p className="text-helper mt-1">Try a different keyword.</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid="settings-search-results">
            <p className="text-helper text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </p>
            {searchResults.map((result) => (
              <SearchResultItem
                key={result.child.key}
                result={result}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )
      ) : (
        /* Settings grid */
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          data-testid="settings-all-grid"
        >
          {SETTINGS_CATEGORIES.map((category) => (
            <CategorySection
              key={category.key}
              category={category}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
