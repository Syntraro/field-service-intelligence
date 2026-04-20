/**
 * CreateOrSelectField — Canonical reusable search + select + create-new component.
 *
 * Supports:
 * - Async search with configurable minimum length
 * - Selecting from results
 * - "Create new" action when results are insufficient
 * - Post-create auto-selection
 * - Controlled value + reset
 * - Entity-agnostic via adapter props
 *
 * Usage:
 *   <CreateOrSelectField
 *     label="Client / Location"
 *     value={selectedLocation}
 *     onChange={setSelectedLocation}
 *     useSearch={(query) => useLocationSearch(query)}
 *     getKey={(item) => item.id}
 *     getLabel={(item) => item.companyName}
 *     getDescription={(item) => item.address}
 *     renderSelected={(item) => <div>{item.companyName}</div>}
 *     createLabel="Create new client"
 *     onCreateNew={(searchText) => openCreateFlow(searchText)}
 *     placeholder="Search clients..."
 *   />
 */
import { useState, useCallback, type ReactNode } from "react";
import { Search, Loader2, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// ── Types ──

/**
 * 2026-04-19: optional multi-action create. When provided, replaces the
 * single createLabel/onCreateNew button with a row of typed-create
 * actions (e.g., "Create 'X' as Part" / "Create 'X' as Labor"). Existing
 * single-action callers continue to use createLabel + onCreateNew unchanged.
 */
export interface CreateOption {
  label: string;
  onCreate: (searchText: string) => void;
}

export interface CreateOrSelectFieldProps<T> {
  /** Field label */
  label: string;
  /** Currently selected value (null = nothing selected) */
  value: T | null;
  /** Called when user selects or clears value */
  onChange: (value: T | null) => void;
  /** Search results hook — must return { data, isLoading } */
  searchResults: T[];
  searchLoading: boolean;
  /** Current search text (controlled) */
  searchText: string;
  /** Called when search text changes */
  onSearchTextChange: (text: string) => void;
  /** Minimum characters before search fires */
  minSearchLength?: number;
  /** Map result to unique key */
  getKey: (item: T) => string;
  /** Map result to display label */
  getLabel: (item: T) => string;
  /** Map result to secondary description (optional) */
  getDescription?: (item: T) => string | null | undefined;
  /** Render the selected value display (optional — defaults to label + change button) */
  renderSelected?: (item: T, onClear: () => void) => ReactNode;
  /** Label for the "create new" action (single-action mode) */
  createLabel?: string;
  /** Called when user clicks "create new" — receives current search text (single-action mode) */
  onCreateNew?: (searchText: string) => void;
  /**
   * Multi-action create. Mutually exclusive with createLabel/onCreateNew —
   * when provided, renders one action row per option below the search results.
   * Use for context-aware typed creation (e.g., Part vs Labor in Parts & Labor).
   */
  createOptions?: CreateOption[];
  /** Input placeholder */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Compact mode — no label, minimal padding, for inline/table-cell usage */
  compact?: boolean;
}

export function CreateOrSelectField<T>({
  label,
  value,
  onChange,
  searchResults,
  searchLoading,
  searchText,
  onSearchTextChange,
  minSearchLength = 2,
  getKey,
  getLabel,
  getDescription,
  renderSelected,
  createLabel,
  onCreateNew,
  createOptions,
  placeholder = "Search...",
  disabled = false,
  compact = false,
}: CreateOrSelectFieldProps<T>) {
  const searchActive = (searchText?.length ?? 0) >= minSearchLength;

  const handleClear = useCallback(() => {
    onChange(null);
    onSearchTextChange("");
  }, [onChange, onSearchTextChange]);

  const handleSelect = useCallback((item: T) => {
    onChange(item);
    onSearchTextChange("");
  }, [onChange, onSearchTextChange]);

  return (
    <div className={compact ? "" : "space-y-1.5"}>
      {!compact && <Label>{label}</Label>}

      {value ? (
        // ── Selected state ──
        renderSelected ? (
          renderSelected(value, handleClear)
        ) : (
          <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
            <div className="min-w-0">
              <span className="text-sm font-medium text-slate-800">{getLabel(value)}</span>
              {getDescription?.(value) && (
                <p className="text-xs text-slate-500 truncate">{getDescription(value)}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={handleClear} disabled={disabled}>
              Change
            </Button>
          </div>
        )
      ) : (
        // ── Search state ──
        <div className="space-y-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder={placeholder}
              value={searchText}
              onChange={(e) => onSearchTextChange(e.target.value)}
              className="pl-9"
              disabled={disabled}
            />
          </div>

          {searchActive && (
            <div className="border border-slate-200 rounded-md max-h-48 overflow-y-auto">
              {searchLoading && (
                <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />Searching...
                </div>
              )}

              {!searchLoading && searchResults.map((item) => (
                <button
                  key={getKey(item)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                  onClick={() => handleSelect(item)}
                >
                  <div className="font-medium text-slate-800">{getLabel(item)}</div>
                  {getDescription?.(item) && (
                    <div className="text-xs text-slate-500 truncate">{getDescription(item)}</div>
                  )}
                </button>
              ))}

              {!searchLoading && searchResults.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">No results</div>
              )}

              {/* Create new action(s).
                  2026-04-19: prefer the multi-action `createOptions` when
                  provided (e.g., Quick Add in Parts & Labor offers
                  Part vs Labor). Falls back to the single-action
                  createLabel/onCreateNew for the existing callers. */}
              {!searchLoading && createOptions && createOptions.length > 0 && (
                <div className="border-t border-slate-200">
                  {createOptions.map((opt, idx) => (
                    <button
                      key={`${opt.label}-${idx}`}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
                      onClick={() => opt.onCreate(searchText)}
                    >
                      <UserPlus className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      <span className="text-sm font-medium text-blue-600">{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {!searchLoading && (!createOptions || createOptions.length === 0) && onCreateNew && createLabel && (
                <button
                  className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-t border-slate-200 flex items-center gap-2"
                  onClick={() => onCreateNew(searchText)}
                >
                  <UserPlus className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-sm font-medium text-blue-600">{createLabel}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
