/**
 * EquipmentTypeCombobox — searchable, tenant-owned type selector with
 * create-on-the-fly. Backs the Type field in AddEquipmentDialog.
 *
 * Reads from GET /api/equipment-types (tenant-scoped).
 * Creates via POST /api/equipment-types (returns existing row on case-
 * insensitive name match — no duplicates).
 *
 * Vertical-agnostic: no hardcoded HVAC assumptions. Each tenant manages
 * their own list (RTU, Walk-in Cooler, Boiler, custom names).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface EquipmentType {
  id: string;
  name: string;
  active: boolean;
}

interface EquipmentTypeComboboxProps {
  /** Currently selected type name (free-form string stored on equipment). */
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}

const QUERY_KEY = ["/api/equipment-types"];

export function EquipmentTypeCombobox({
  value,
  onChange,
  placeholder = "Select or create type...",
  className,
}: EquipmentTypeComboboxProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: types = [], isLoading } = useQuery<EquipmentType[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/equipment-types", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch equipment types");
      return res.json();
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest<EquipmentType>("/api/equipment-types", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onChange(created.name);
      setSearch("");
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Could not create type",
        description: "Try again or pick an existing type.",
        variant: "destructive",
      });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter(t => t.name.toLowerCase().includes(q));
  }, [types, search]);

  // Show "Create '<input>'" only when search is non-empty AND no exact
  // case-insensitive match exists in the catalog.
  const trimmed = search.trim();
  const exactMatch = useMemo(
    () => trimmed && types.some(t => t.name.toLowerCase() === trimmed.toLowerCase()),
    [trimmed, types],
  );
  const canCreate = trimmed.length > 0 && !exactMatch && !createMutation.isPending;

  const handleSelect = useCallback((name: string) => {
    onChange(name);
    setSearch("");
    setOpen(false);
  }, [onChange]);

  const handleCreate = useCallback(() => {
    if (!trimmed || exactMatch) return;
    createMutation.mutate(trimmed);
  }, [trimmed, exactMatch, createMutation]);

  // Focus the search input when popover opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-8 w-full justify-between bg-white text-sm font-normal",
            !value && "text-muted-foreground",
            className,
          )}
          data-testid="combobox-equipment-type"
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center border-b bg-white px-2 py-1.5">
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="Search or type to add..."
            className="flex-1 bg-transparent text-helper outline-none placeholder:text-muted-foreground"
            data-testid="input-equipment-type-search"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-3 text-helper text-muted-foreground">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading types...
            </div>
          ) : (
            <>
              {filtered.length === 0 && !canCreate && (
                <div className="py-3 text-center text-helper text-muted-foreground">
                  {types.length === 0 ? "No types yet — start typing to add one." : "No matches."}
                </div>
              )}
              {filtered.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelect(t.name)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  data-testid={`option-equipment-type-${t.id}`}
                >
                  <span className="truncate">{t.name}</span>
                  {value === t.name && <Check className="h-3 w-3 text-primary" />}
                </button>
              ))}
              {canCreate && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-slate-100 px-2 py-1.5 text-left text-xs text-primary hover:bg-accent"
                  data-testid="button-create-equipment-type"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  <span>Create &ldquo;{trimmed}&rdquo;</span>
                </button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
