/**
 * TechnicianSelector — Canonical technician assignment component.
 *
 * Supports single-select and multi-select modes. Uses:
 *   - useTechniciansDirectory() for data
 *   - getMemberDisplayName() for labels
 *   - getMemberInitials() for avatars
 *
 * Every assignment surface should use this instead of bespoke selectors.
 */
import { useState, useMemo, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Users, ChevronsUpDown, Search, X } from "lucide-react";
import { useTechniciansDirectory, type TeamMember } from "@/hooks/useTechnicians";
import { getMemberDisplayName, getMemberInitials } from "@/lib/displayName";
import { resolveTechnicianColor } from "@shared/colors";

// ── Types ──

interface BaseSelectorProps {
  /** Placeholder when nothing is selected */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Show colored avatar circles (default: true) */
  showAvatar?: boolean;
  /** Optional filter — e.g., only schedulable members */
  filter?: (member: TeamMember) => boolean;
}

interface SingleSelectorProps extends BaseSelectorProps {
  mode: "single";
  value: string | null;
  onChange: (id: string | null) => void;
}

interface MultiSelectorProps extends BaseSelectorProps {
  mode: "multi";
  value: string[];
  onChange: (ids: string[]) => void;
}

export type TechnicianSelectorProps = SingleSelectorProps | MultiSelectorProps;

// ── Option shape (canonical) ──

interface TechOption {
  id: string;
  displayName: string;
  initials: string;
  color: string | null;
}

// 2026-04-20 Phase 3: local DEFAULT_COLORS removed — use canonical
// resolveTechnicianColor so selector matches dispatch + team hub.

// ── Component ──

export function TechnicianSelector(props: TechnicianSelectorProps) {
  const { mode, placeholder, disabled, className, showAvatar = true, filter } = props;
  const { teamMembers, isLoading } = useTechniciansDirectory();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Shape options from canonical data source
  const options: TechOption[] = useMemo(() => {
    let members = teamMembers;
    if (filter) members = members.filter(filter);
    return members.map((m) => ({
      id: m.id,
      displayName: getMemberDisplayName(m),
      initials: getMemberInitials(m),
      color: resolveTechnicianColor(m.id, m.color),
    }));
  }, [teamMembers, filter]);

  // Search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((t) => t.displayName.toLowerCase().includes(q));
  }, [options, search]);

  // Selected IDs (normalize single to array for shared rendering)
  const selectedIds = mode === "multi" ? props.value : (props.value ? [props.value] : []);

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);

  const handleToggle = useCallback((id: string) => {
    if (mode === "multi") {
      const current = props.value;
      (props as MultiSelectorProps).onChange(
        current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id]
      );
    } else {
      // Single mode: select and close
      (props as SingleSelectorProps).onChange(id);
      setOpen(false);
    }
  }, [mode, props]);

  const handleClear = useCallback(() => {
    if (mode === "multi") {
      (props as MultiSelectorProps).onChange([]);
    } else {
      (props as SingleSelectorProps).onChange(null);
    }
  }, [mode, props]);

  // Trigger label
  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return placeholder ?? "Unassigned";
    const firstName = options.find((t) => t.id === selectedIds[0])?.displayName ?? "?";
    if (selectedIds.length === 1) return firstName;
    return `${firstName} +${selectedIds.length - 1}`;
  }, [selectedIds, options, placeholder]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "text-xs gap-1.5 min-w-[120px] max-w-[220px] justify-between",
            selectedIds.length === 0 && "text-muted-foreground",
            className,
          )}
          disabled={disabled || isLoading}
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{isLoading ? "Loading..." : triggerLabel}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        {/* Search */}
        <div className="flex items-center border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team..."
            className="flex-1 text-helper bg-transparent outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Option list */}
        <div className="max-h-[240px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
          {/* Unassigned option (single mode only) */}
          {mode === "single" && (
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer",
                selectedIds.length === 0 && "bg-accent",
              )}
              onClick={() => { handleClear(); setOpen(false); }}
            >
              <span className="text-muted-foreground italic">Unassigned</span>
            </button>
          )}

          {filtered.length === 0 ? (
            <div className="text-helper text-muted-foreground text-center py-3">No team members found</div>
          ) : (
            filtered.map((tech) => {
              const selected = isSelected(tech.id);
              return (
                <button
                  key={tech.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer",
                    selected && mode === "single" && "bg-accent",
                  )}
                  onClick={() => handleToggle(tech.id)}
                >
                  {mode === "multi" && (
                    <Checkbox checked={selected} className="pointer-events-none" tabIndex={-1} />
                  )}
                  {showAvatar && (
                    <div
                      className="h-5 w-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: tech.color ?? "#6B7280" }}
                    >
                      {tech.initials}
                    </div>
                  )}
                  <span className="truncate">{tech.displayName}</span>
                  {mode === "single" && selected && (
                    <span className="ml-auto text-primary text-xs">✓</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer (multi mode) */}
        {mode === "multi" && selectedIds.length > 0 && (
          <div className="border-t px-2 py-1.5 flex items-center justify-between">
            <span className="text-helper text-muted-foreground">{selectedIds.length} selected</span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={handleClear}
            >
              Clear all
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Resolve a technician display name from an ID using the directory.
 * Canonical lookup for read-only display contexts (visit rows, summaries, etc.).
 * Returns "Unassigned" for null/undefined, "Unknown" for missing IDs.
 */
export function useTechnicianName() {
  const { teamMembers } = useTechniciansDirectory();

  return useCallback((techId: string | null | undefined): string => {
    if (!techId) return "Unassigned";
    const member = teamMembers.find((m) => m.id === techId);
    if (!member) return "Unknown";
    return getMemberDisplayName(member);
  }, [teamMembers]);
}
