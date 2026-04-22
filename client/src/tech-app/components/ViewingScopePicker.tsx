/**
 * ViewingScopePicker — manager/admin bottom-sheet for choosing whose schedule
 * the Today page renders. Single entry point for the three cross-tech modes:
 *
 *   - Me                       → { kind: "self" }
 *   - All technicians          → { kind: "all" }
 *   - Specific technicians     → { kind: "custom", technicianIds }  (single or multi)
 *
 * Data source: `useTechniciansDirectory()` — the same canonical list the
 * dispatch and QuickAddJobDialog pickers use. No parallel fetch.
 *
 * Visual pattern: shares the bottom-sheet container used by the Today page's
 * Create menu (`fixed inset-0 … rounded-t-2xl`) for consistency with existing
 * mobile surfaces.
 *
 * Safety: this component is a UX convenience only. Backend re-validates every
 * requested tech against tenant + schedulable membership and gates non-self
 * scope behind the `schedule.all.view` permission.
 */
import { useEffect, useMemo, useState } from "react";
import { X, Check, Users, User as UserIcon, Search } from "lucide-react";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { resolveTechnicianColor } from "@shared/colors";
import type { TodayScope } from "../hooks/useTodayVisits";
// 2026-04-20 Phase 3: local DEFAULT_COLORS removed — use canonical resolver.

interface Props {
  open: boolean;
  initialScope: TodayScope;
  onClose: () => void;
  onApply: (scope: TodayScope) => void;
  /** Current user's own id — excluded from the "specific" list because
   *  picking yourself there is semantically "Me" and would be confusing. */
  selfId: string | null;
}

export function ViewingScopePicker({ open, initialScope, onClose, onApply, selfId }: Props) {
  const { teamMembers, isLoading } = useTechniciansDirectory();
  const [mode, setMode] = useState<"self" | "all" | "custom">(initialScope.kind);
  const [selected, setSelected] = useState<string[]>(
    initialScope.kind === "custom" ? initialScope.technicianIds : [],
  );
  const [search, setSearch] = useState("");

  // Re-sync local state whenever the sheet is re-opened so cancelling a prior
  // session doesn't leak into the next open.
  useEffect(() => {
    if (!open) return;
    setMode(initialScope.kind);
    setSelected(initialScope.kind === "custom" ? initialScope.technicianIds : []);
    setSearch("");
  }, [open, initialScope]);

  const options = useMemo(() => {
    // Exclude self from the tech-pick list; "Me" already covers that case.
    const list = teamMembers
      .filter((m) => m.isSchedulable !== false)
      .filter((m) => m.id !== selfId);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((m) => getMemberDisplayName(m).toLowerCase().includes(q));
  }, [teamMembers, search, selfId]);

  if (!open) return null;

  const toggleTech = (id: string) => {
    setMode("custom");
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canApply = mode !== "custom" || selected.length > 0;

  const handleApply = () => {
    if (mode === "self") onApply({ kind: "self" });
    else if (mode === "all") onApply({ kind: "all" });
    else onApply({ kind: "custom", technicianIds: selected });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
      data-testid="viewing-scope-picker"
    >
      <div
        className="w-full max-w-md bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Viewing schedule</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Preset rows */}
        <div className="px-3 pt-3 space-y-1.5">
          <ScopeRow
            icon={<UserIcon className="h-4 w-4 text-slate-600" />}
            label="Me"
            selected={mode === "self"}
            onClick={() => { setMode("self"); setSelected([]); }}
            testId="scope-row-self"
          />
          <ScopeRow
            icon={<Users className="h-4 w-4 text-slate-600" />}
            label="All team"
            selected={mode === "all"}
            onClick={() => { setMode("all"); setSelected([]); }}
            testId="scope-row-all"
          />
        </div>

        {/* Specific techs — search + checkbox list */}
        <div className="mt-2 px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Specific team members
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center border border-slate-200 rounded-md px-2 py-1.5 bg-white">
            <Search className="h-3.5 w-3.5 text-slate-400 mr-1.5 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
              data-testid="scope-picker-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {isLoading ? (
            <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
          ) : options.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No other team members found</p>
          ) : (
            options.map((m) => {
              const isSelected = selected.includes(m.id);
              const color = resolveTechnicianColor(m.id, m.color);
              return (
                <button
                  key={m.id}
                  onClick={() => toggleTech(m.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border transition-colors text-left ${
                    isSelected
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  data-testid={`scope-row-tech-${m.id}`}
                >
                  <div
                    className="h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {getMemberInitials(m)}
                  </div>
                  <span className="flex-1 text-sm font-medium text-slate-700 truncate">
                    {getMemberDisplayName(m)}
                  </span>
                  {isSelected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-3 py-3 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-md border border-slate-300 text-slate-600 text-sm font-semibold active:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="flex-1 min-h-[44px] rounded-md bg-emerald-600 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
            data-testid="scope-picker-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeRow({ icon, label, selected, onClick, testId }: {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-3 rounded-md border transition-colors text-left ${
        selected ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
      data-testid={testId}
    >
      <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <span className="flex-1 text-sm font-semibold text-slate-700">{label}</span>
      {selected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
    </button>
  );
}
