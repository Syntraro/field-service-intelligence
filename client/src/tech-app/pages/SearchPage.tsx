/**
 * Technician PWA — Search Page.
 * Tech-safe location search through the assignment-scoped tech endpoint.
 * 2026-05-04 Phase 2 PR 3: switched from the shared office hook to the
 * tech-only sibling so the search surface no longer depends on an
 * office API. Backend scoping enforces per-tech assignment access.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Search, MapPin, Phone, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { MobileShell } from "../components/MobileShell";
import { useTechLocationSearch } from "../hooks/useTechLocationSearch";
import { useDebouncedValue } from "../utils/useDebouncedValue";

export function SearchPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  // Debounce the query string locally so the tech search hook fires
  // at most once per quiet window instead of on every keystroke.
  // Does not change the hook's contract or query key.
  const debouncedSearch = useDebouncedValue(search, 200);

  const { data: results, isLoading, isError, refetch } = useTechLocationSearch(debouncedSearch, { limit: 30 });

  const list = results ?? [];

  return (
    <MobileShell showNav>
      <div className="px-3 pt-3 pb-2">
        <label htmlFor="tech-search-input" className="sr-only">Search clients or locations</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
          <input
            id="tech-search-input"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients, locations..."
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className="w-full h-10 pl-10 pr-3 text-sm border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-shadow"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-20">
        {search.length < 2 && (
          <div className="text-center py-16 text-slate-400">
            <Search className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">Search for a client or location</p>
            <p className="text-xs mt-1">Type at least 2 characters</p>
          </div>
        )}

        {/* "Searching…" covers both the debounce wait (search !== debouncedSearch)
            and the network fetch, so the user never sees a misleading
            "No results" flash while typing. */}
        {search.length >= 2 && (isLoading || search !== debouncedSearch) && (
          <div
            className="flex flex-col items-center justify-center py-12 text-slate-400"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-6 w-6 animate-spin mb-2 opacity-50" aria-hidden="true" />
            <p className="text-xs font-medium">Searching…</p>
          </div>
        )}

        {search.length >= 2 && search === debouncedSearch && !isLoading && isError && (
          <div className="text-center py-12 px-6">
            <AlertCircle className="h-10 w-10 mx-auto mb-2 text-slate-400 opacity-60" />
            <p className="text-sm font-medium text-slate-600">Search failed</p>
            <p className="text-xs mt-1 text-slate-400">Check your connection and try again.</p>
            <button
              onClick={() => refetch()}
              className="mt-3 min-h-[44px] px-5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100"
            >
              Retry
            </button>
          </div>
        )}

        {search.length >= 2 && search === debouncedSearch && !isLoading && !isError && list.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm font-medium">No results found</p>
            <p className="text-xs mt-1">Try a different search term</p>
          </div>
        )}

        {list.length > 0 && (
          <div className="divide-y divide-slate-100">
            {list.map(r => {
              const addressParts = [r.address, r.city].filter(Boolean).join(", ");
              return (
                <button
                  key={r.id}
                  onClick={() => setLocation(`/tech/location/${r.id}`)}
                  className="w-full text-left px-3 py-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                >
                  <div className="h-9 w-9 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{r.companyName}</p>
                    {r.parentCompanyName && r.parentCompanyName !== r.companyName && (
                      <p className="text-xs text-slate-500 truncate">{r.parentCompanyName}</p>
                    )}
                    {addressParts && (
                      <p className="text-xs text-slate-400 truncate">{addressParts}</p>
                    )}
                    {r.phone && (
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="h-2.5 w-2.5" />{r.phone}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
