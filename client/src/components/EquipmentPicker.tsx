/**
 * EquipmentPicker — Searchable location-based equipment multi-selector with inline creation.
 *
 * Fetches equipment from GET /api/clients/:locationId/equipment.
 * Parent owns selected state. No internal source of truth for selection.
 * Inline "Add Equipment" creates via POST /api/clients/:locationId/equipment (canonical path).
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wrench, X, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";

interface LocationEquipment {
  id: string;
  name: string;
  equipmentType?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

interface EquipmentPickerProps {
  locationId: string | null;
  selectedEquipmentIds: string[];
  onChange: (ids: string[]) => void;
}


/**
 * Build a descriptive label for equipment display.
 * Format: Name — Model: XXX — S/N: YYY
 * Falls back through model, serial, then notes snippet.
 */
function formatEquipmentLabel(eq: LocationEquipment): string {
  const parts: string[] = [eq.name];
  const hasModel = !!eq.modelNumber;
  const hasSerial = !!eq.serialNumber;

  if (hasModel && hasSerial) {
    parts.push(`Model: ${eq.modelNumber} — S/N: ${eq.serialNumber}`);
  } else if (hasModel) {
    parts.push(`Model: ${eq.modelNumber}`);
  } else if (hasSerial) {
    parts.push(`S/N: ${eq.serialNumber}`);
  } else if (eq.notes) {
    // Short notes snippet for identification when no model/serial
    const snippet = eq.notes.length > 30 ? eq.notes.slice(0, 30) + "…" : eq.notes;
    parts.push(snippet);
  }

  return parts.join(" — ");
}

/** Compact label for selected chips */
function formatChipLabel(eq: LocationEquipment): string {
  if (eq.modelNumber) return `${eq.name} (${eq.modelNumber})`;
  if (eq.serialNumber) return `${eq.name} (${eq.serialNumber})`;
  return eq.name;
}

/** Match equipment against a search query (client-side) */
function matchesSearch(eq: LocationEquipment, query: string): boolean {
  const q = query.toLowerCase();
  return (
    eq.name.toLowerCase().includes(q) ||
    (eq.modelNumber?.toLowerCase().includes(q) ?? false) ||
    (eq.serialNumber?.toLowerCase().includes(q) ?? false) ||
    (eq.notes?.toLowerCase().includes(q) ?? false)
  );
}


export function EquipmentPicker({ locationId, selectedEquipmentIds, onChange }: EquipmentPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { data: equipment = [], isLoading, isError } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}/equipment`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!locationId,
  });

  const available = useMemo(
    () => equipment.filter(e => !selectedEquipmentIds.includes(e.id)),
    [equipment, selectedEquipmentIds],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    return available.filter(e => matchesSearch(e, search.trim()));
  }, [available, search]);

  const selected = useMemo(
    () => selectedEquipmentIds.map(id => equipment.find(e => e.id === id)).filter(Boolean) as LocationEquipment[],
    [equipment, selectedEquipmentIds],
  );

  const handleSelect = useCallback((id: string) => {
    onChange([...selectedEquipmentIds, id]);
    setSearch("");
    // Keep popover open for multi-select
  }, [selectedEquipmentIds, onChange]);

  const handleRemove = useCallback((id: string) => {
    onChange(selectedEquipmentIds.filter(x => x !== id));
  }, [selectedEquipmentIds, onChange]);

  // Auto-select newly created equipment after inline creation
  const handleEquipmentCreated = useCallback((created: { id: string; name: string }) => {
    if (created?.id) {
      onChange([...selectedEquipmentIds, created.id]);
    }
  }, [selectedEquipmentIds, onChange]);

  // --- Disabled state: no location selected ---
  if (!locationId) {
    return (
      <p className="text-xs text-muted-foreground italic">Select location first</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Selected equipment chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(eq => (
            <span
              key={eq.id}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2 pr-1 py-0.5 text-xs font-medium text-slate-700"
              title={formatEquipmentLabel(eq)}
            >
              <Wrench className="h-2.5 w-2.5 text-slate-400" />
              {formatChipLabel(eq)}
              <button
                type="button"
                onClick={() => handleRemove(eq.id)}
                className="h-3.5 w-3.5 rounded-full hover:bg-slate-300/50 flex items-center justify-center"
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Searchable equipment picker + Add button row */}
      <div className="flex gap-1.5">
        <Popover open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setSearch(""); }}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs flex-1 justify-start text-muted-foreground"
              disabled={isLoading}
            >
              <Search className="h-3 w-3 mr-1.5 shrink-0" />
              {isLoading ? "Loading..." : "Search equipment..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            {/* Search input */}
            <div className="flex items-center border-b px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, model, serial..."
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
            {/* Results */}
            <div className="max-h-[200px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
              {filtered.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-3">
                  {available.length === 0
                    ? "No equipment at this location"
                    : "No matches found"}
                </div>
              ) : (
                filtered.map(eq => (
                  <button
                    key={eq.id}
                    type="button"
                    className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer text-left"
                    onClick={() => handleSelect(eq.id)}
                  >
                    <Wrench className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    <span className="min-w-0">{formatEquipmentLabel(eq)}</span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Add Equipment button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1 shrink-0"
          onClick={() => setAddDialogOpen(true)}
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Fetch error state */}
      {isError && (
        <p className="text-xs text-destructive">Failed to load equipment</p>
      )}

      {/* Shared Add Equipment Dialog — uses canonical POST /api/clients/:locationId/equipment */}
      {locationId && (
        <AddEquipmentDialog
          locationId={locationId}
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onCreated={handleEquipmentCreated}
        />
      )}
    </div>
  );
}
