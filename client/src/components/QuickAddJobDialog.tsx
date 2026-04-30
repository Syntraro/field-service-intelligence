/**
 * QuickAddJobDialog — Compact quick-create / edit modal for jobs.
 *
 * Redesigned 2026-03-08 for speed, compactness, and scale:
 * - Flat layout: Location → Summary → compact scheduling row → Description
 * - Searchable multi-select technician popover (scales to 200+ techs)
 * - No modal-body scrollbar on standard desktop viewport
 * - Scheduling controls inline in a single row (date, time, duration, techs)
 * - Unscheduled toggle hides time controls cleanly
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSurfaceController } from "@/hooks/useSurfaceController";
import { useToast } from "@/hooks/use-toast";
import { useActivityStore } from "@/lib/activityStore";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Plus, CalendarIcon, Users, Search, Repeat, Wand2, Wrench, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Job, InsertJob } from "@shared/schema";
// 2026-04-26 polish v4: replaced the multi-select chip-strip + Add-button
// EquipmentPicker with a Service-style inline combobox. The dialog used
// for inline create stays canonical — `AddEquipmentDialog` (now accepts
// a `defaultName` prefill so the typed text flows through).
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";

// 2026-04-26 polish v5: CreateOrSelectField import removed — Location now
// uses the inline LocationCombobox below (Popover overlay). Other surfaces
// of the codebase (NewQuoteModal, etc.) still use CreateOrSelectField.
import {
  useLocationSearch, useLocationById, getLocationKey, getLocationLabel, getLocationDescription,
  type LocationOption,
} from "@/lib/entities/locationEntity";
import {
  type JobScheduleValue,
  createDefaultScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { createJobWithSchedule } from "@/lib/jobScheduling";
import { useDefaultSchedulingBuffer, formatScheduledBlockSummary } from "@/hooks/useDefaultSchedulingBuffer";
import { TechnicianSelector } from "@/components/TechnicianSelector";
// 2026-04-26: service-catalog selector + capacity-aware tech-pick. Both use
// existing canonical endpoints (`/api/items?type=service`, `/api/dashboard/capacity`).
// No new APIs, no shadow scheduling logic.
import {
  formatSlotTimeLabel,
  computeOpenGapsForTech,
  groupOpenGapsByTech,
  getOverlappingBookedBlocks,
  type CapacityResponse,
  type OpenGap,
  type TechAvailability,
} from "@/lib/findNextAvailableSlot";
import { getSmartScheduleDefault, getWallClockInTimezone } from "@/lib/schedulingConstants";
// 2026-04-26 polish: searchable service combobox + inline "Create service".
// The canonical Add-Item modal lives at @/components/products-services/
// ProductServiceFormDialog; we mount it inside QuickAddJobDialog so the user
// never leaves the Create New Job flow. Duration formatting (`formatDuration`)
// reuses the canonical helper so the same format renders everywhere.
// 2026-04-26 polish v6: ProductServiceFormDialog + ProductFormData imports
// removed — services now use the inline one-shot create pattern. Only the
// duration formatter helper is still imported.
import { formatDuration as formatServiceDuration } from "@/components/products-services/types";
// Canonical line-item mapper — same pipeline EditVisitModal uses to persist
// services as job_parts. We rebuild the ProductOption shape from local
// SelectedService state and pipe through these helpers.
import { catalogItemToDraft, draftToJobPartPayload } from "@/lib/entities/lineItemMapper";
import { productOptionToCatalogItem } from "@/lib/entities/productEntity";

// ============================================================================
// Duration options (static) — time uses native input, no option list needed
// ============================================================================

import {
  DURATION_OPTIONS_SHORT as DURATION_OPTIONS,
  DAYS_OF_WEEK_SHORT as DAYS_OF_WEEK,
  TIME_OPTIONS_15MIN,
} from "@/lib/schedulingConstants";

// ============================================================================
// Location Combobox (Service-style inline picker)
// ============================================================================
// 2026-04-26 polish v5: replaces the inline-results CreateOrSelectField for
// the Location field. The CreateOrSelectField rendered its result list in
// the form flow (`<div className="border ... max-h-48 overflow-y-auto">`),
// which pushed the modal taller while typing — the user complaint that
// "the modal expands when searching locations." This Service-pattern
// combobox keeps results in a Popover overlay (portaled by Radix) so the
// modal shell never resizes.

interface LocationComboboxProps {
  value: LocationOption | null;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  searchResults: LocationOption[];
  searchLoading: boolean;
  onChange: (loc: LocationOption | null) => void;
  onCreateNew: (typed: string) => void;
  disabled?: boolean;
}

function LocationCombobox({
  value,
  searchText,
  onSearchTextChange,
  searchResults,
  searchLoading,
  onChange,
  onCreateNew,
  disabled,
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const triggerLabel = value ? getLocationLabel(value) : "Search locations...";
  const triggerDescription = value ? getLocationDescription(value) : null;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) onSearchTextChange(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between text-xs font-normal bg-white"
          disabled={disabled}
          data-testid="select-location"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Optional one-line description rendered just below the trigger when
          a location is selected. Helps users confirm the address without
          opening the dropdown. */}
      {triggerDescription && (
        <p className="text-[11px] text-muted-foreground truncate mt-1">{triggerDescription}</p>
      )}
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search locations..."
            value={searchText}
            onValueChange={onSearchTextChange}
            data-testid="input-location-search"
          />
          <CommandList>
            {/* 2026-04-26 polish v6: create action sits at the TOP of the
                dropdown, directly under the search input, so it's always
                visible when the user types — even with many matching
                results below. Without this, tenants with hundreds of
                clients would have to scroll past the result list to find
                "Add new client", and the affordance was effectively hidden. */}
            {searchText.trim() && (
              <CommandGroup heading="Not in your client list?">
                <CommandItem
                  value={`__create__${searchText}`}
                  onSelect={() => {
                    onCreateNew(searchText.trim());
                    setOpen(false);
                  }}
                  className="text-primary"
                  data-testid="option-location-create"
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  <span className="truncate">
                    Add new client / location: <span className="font-medium">"{searchText.trim()}"</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    onSearchTextChange("");
                    setOpen(false);
                  }}
                  data-testid="option-location-clear"
                >
                  <span className="text-muted-foreground">— No location —</span>
                </CommandItem>
              </CommandGroup>
            )}
            {searchLoading && (
              <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />Searching...
              </div>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <CommandGroup heading="Matching locations">
                {searchResults.map((loc) => (
                  <CommandItem
                    key={getLocationKey(loc)}
                    value={getLocationKey(loc)}
                    onSelect={() => {
                      onChange(loc);
                      onSearchTextChange("");
                      setOpen(false);
                    }}
                    data-testid={`option-location-${getLocationKey(loc)}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        value && getLocationKey(value) === getLocationKey(loc)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{getLocationLabel(loc)}</div>
                      {getLocationDescription(loc) && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {getLocationDescription(loc)}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!searchLoading && searchResults.length === 0 && searchText.trim() && (
              <CommandEmpty>No locations match "{searchText}".</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Equipment Combobox (Service-style inline picker)
// ============================================================================
// 2026-04-26 polish v4: Service-style single-select equipment picker with
// inline "Create equipment: '<typed text>'" action. Replaces the multi-
// select EquipmentPicker (chips above + separate Add button). Uses the
// canonical `GET /api/clients/:locationId/equipment` and the canonical
// `AddEquipmentDialog` for inline creation. Keeps the dialog's array-
// shaped state (`selectedEquipmentIds: string[]`) so the existing
// `POST /api/jobs/:id/equipment` payload contract is unchanged — the
// combobox just sets it to a 0- or 1-element array.

interface LocationEquipment {
  id: string;
  name: string;
  equipmentType?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

/** Shape stored locally in `selectedServices`. Holds the minimum the form
 *  needs to render the chip + recompute Summary / Duration. The full
 *  ProductOption shape (sku, category, taxCode, ...) is irrelevant for
 *  the create-time payload — `productOptionToCatalogItem` reconstructs
 *  the canonical shape with safe defaults at submit time. */
interface SelectedService {
  id: string;
  name: string;
  estimatedDurationMinutes: number | null;
  unitPrice?: string | null;
  unitCost?: string | null;
}

function formatEquipmentLabel(eq: LocationEquipment): string {
  const parts: string[] = [eq.name];
  if (eq.modelNumber && eq.serialNumber) parts.push(`Model: ${eq.modelNumber} — S/N: ${eq.serialNumber}`);
  else if (eq.modelNumber) parts.push(`Model: ${eq.modelNumber}`);
  else if (eq.serialNumber) parts.push(`S/N: ${eq.serialNumber}`);
  return parts.join(" — ");
}

function formatEquipmentTriggerLabel(eq: LocationEquipment): string {
  if (eq.modelNumber) return `${eq.name} (${eq.modelNumber})`;
  return eq.name;
}

interface EquipmentComboboxProps {
  locationId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function EquipmentCombobox({
  locationId,
  selectedIds,
  onChange,
  disabled,
}: EquipmentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [pendingCreateName, setPendingCreateName] = useState("");

  const { data: equipment = [], isLoading } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => {
      if (!locationId) return [];
      const res = await fetch(`/api/clients/${locationId}/equipment`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!locationId,
  });

  // Resolved selected items — preserves the user's selection order.
  const selected = useMemo(
    () => selectedIds
      .map((id) => equipment.find((e) => e.id === id))
      .filter(Boolean) as LocationEquipment[],
    [equipment, selectedIds],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipment;
    return equipment.filter((e) => {
      return (
        e.name.toLowerCase().includes(q) ||
        (e.modelNumber ?? "").toLowerCase().includes(q) ||
        (e.serialNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [equipment, search]);

  const exactMatchExists = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return equipment.some((e) => e.name.trim().toLowerCase() === q);
  }, [equipment, search]);

  const triggerDisabled = disabled || !locationId;

  // 2026-04-26 polish v6: trigger always shows the muted "Search or add"
  // placeholder. Selected items render as white pill-cards underneath the
  // trigger so the user can SEE every one — matches EditVisitModal exactly,
  // and prevents the awkward "Pump A +1" compression the v5 trigger used.
  const triggerContent: { text: string; muted: boolean } = (() => {
    if (!locationId) return { text: "Location required", muted: true };
    if (isLoading) return { text: "Loading equipment…", muted: true };
    return { text: "Search or add equipment...", muted: true };
  })();

  function handleToggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function handleCreateNew(typed: string) {
    setPendingCreateName(typed.trim());
    setOpen(false);
    setAddDialogOpen(true);
  }

  function handleEquipmentCreated(created: { id: string; name: string }) {
    if (created?.id && !selectedIds.includes(created.id)) {
      onChange([...selectedIds, created.id]);
    }
    setSearch("");
    setPendingCreateName("");
  }

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-full justify-between text-xs font-normal bg-white"
            disabled={triggerDisabled}
            data-testid="select-equipment"
          >
            <span className={cn("truncate", triggerContent.muted && "text-muted-foreground")}>
              {triggerContent.text}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command>
            <CommandInput
              placeholder="Search equipment..."
              value={search}
              onValueChange={setSearch}
              data-testid="input-equipment-search"
            />
            <CommandList>
              {selected.length > 0 && (
                <CommandGroup>
                  <CommandItem
                    value="__clear-all__"
                    onSelect={() => {
                      onChange([]);
                    }}
                    data-testid="option-equipment-clear"
                  >
                    <span className="text-muted-foreground">— Clear all —</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading={equipment.length === 0 ? undefined : "Equipment at this location"}>
                {filtered.map((eq) => {
                  const isChecked = selectedIds.includes(eq.id);
                  return (
                    <CommandItem
                      key={eq.id}
                      value={eq.name ?? eq.id}
                      onSelect={() => handleToggle(eq.id)}
                      data-testid={`option-equipment-${eq.id}`}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-3.5 w-3.5",
                          isChecked ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex-1 truncate">{formatEquipmentLabel(eq)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {search.trim() && !exactMatchExists && locationId && (
                <CommandGroup heading="Not at this location">
                  <CommandItem
                    value={`__create__${search}`}
                    onSelect={() => handleCreateNew(search)}
                    className="text-primary"
                    data-testid="option-equipment-create"
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    <span className="truncate">
                      Create equipment: <span className="font-medium">"{search.trim()}"</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {filtered.length === 0 && !search.trim() && equipment.length === 0 && (
                <CommandEmpty>No equipment at this location yet. Type a name to add one.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* 2026-04-26 polish v6: selected-equipment rows below the trigger,
          always (was: only when ≥2 items in v5). Same white pill-card
          pattern Edit Visit uses for its chip list — every item is fully
          visible with a per-row remove X. The user complained the v5 "+N"
          compression hid items; this restores explicit rows. */}
      {selected.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="selected-equipment">
          {selected.map((eq) => (
            <div
              key={eq.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              title={formatEquipmentLabel(eq)}
              data-testid={`chip-equipment-${eq.id}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Wrench className="h-3 w-3 text-slate-500 shrink-0" />
                <span className="truncate text-slate-800 font-medium">{formatEquipmentLabel(eq)}</span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(eq.id)}
                aria-label={`Remove ${eq.name}`}
                className="h-5 w-5 rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center shrink-0"
                disabled={disabled}
                data-testid={`chip-remove-equipment-${eq.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {locationId && (
        <AddEquipmentDialog
          locationId={locationId}
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          defaultName={pendingCreateName}
          onCreated={handleEquipmentCreated}
        />
      )}
    </div>
  );
}

// ============================================================================
// Services Multi-Select (Edit-Visit-pattern)
// ============================================================================
// 2026-04-26 polish v6: multi-select services for QuickAddJobDialog.
// Mirrors EditVisitModal.ServiceMultiSelect — combobox trigger on top,
// selected services rendered as white pill-cards underneath. Each card
// shows the name + duration (when known) + an X to remove. A
// `Create service: "<typed>"` action surfaces in the dropdown when the
// typed text doesn't exact-match an existing service.
//
// QuickAddJobDialog is the create surface — the job doesn't exist yet
// when the user picks services, so this component just owns the local
// selection list. Persistence happens after job create via the canonical
// `POST /api/jobs/:id/parts` call (same path Edit Visit uses).

interface ServiceCatalogItem {
  id: string;
  name: string | null;
  estimatedDurationMinutes: number | null;
  unitPrice?: string | null;
  cost?: string | null;
}

function ServicesMultiSelect({
  services,
  selected,
  searchOpen,
  onSearchOpenChange,
  searchText,
  onSearchTextChange,
  filteredServices,
  exactMatchExists,
  onAdd,
  onRemove,
  onCreateNew,
  createPending,
  disabled,
}: {
  services: ServiceCatalogItem[];
  selected: SelectedService[];
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  filteredServices: ServiceCatalogItem[];
  exactMatchExists: boolean;
  onAdd: (svc: SelectedService) => void;
  onRemove: (id: string) => void;
  onCreateNew: (name: string) => void;
  createPending: boolean;
  disabled?: boolean;
}) {
  // Hide already-selected services from the dropdown (matches Edit Visit).
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const available = useMemo(
    () => filteredServices.filter((s) => !selectedIds.has(s.id)),
    [filteredServices, selectedIds],
  );
  // services unused at this layer (filtering happens in the parent's memo);
  // accept it for API symmetry with Edit Visit.
  void services;

  return (
    <div className="space-y-1.5">
      {/* Search trigger — top */}
      <Popover open={searchOpen} onOpenChange={onSearchOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={searchOpen}
            className="h-9 w-full justify-between text-xs font-normal bg-white"
            disabled={disabled}
            data-testid="select-service"
          >
            <span className="text-muted-foreground truncate">Search or add service...</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search services..."
              value={searchText}
              onValueChange={onSearchTextChange}
              data-testid="input-service-search"
            />
            <CommandList>
              {/* Inline create — at top so it's never buried by results. */}
              {searchText.trim() && !exactMatchExists && (
                <CommandGroup heading="Not in catalog">
                  <CommandItem
                    value={`__create__${searchText}`}
                    onSelect={() => onCreateNew(searchText.trim())}
                    className="text-primary"
                    data-testid="option-service-create"
                    disabled={createPending}
                  >
                    {createPending ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-3.5 w-3.5" />
                    )}
                    <span className="truncate">
                      Create service: <span className="font-medium">"{searchText.trim()}"</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              {available.length > 0 && (
                <CommandGroup heading="Services">
                  {available.map((svc) => (
                    <CommandItem
                      key={svc.id}
                      value={svc.name ?? svc.id}
                      onSelect={() => {
                        onAdd({
                          id: svc.id,
                          name: svc.name ?? "Service",
                          estimatedDurationMinutes: svc.estimatedDurationMinutes,
                          unitPrice: svc.unitPrice ?? null,
                          unitCost: svc.cost ?? null,
                        });
                        onSearchTextChange("");
                      }}
                      data-testid={`option-service-${svc.id}`}
                    >
                      <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                      <span className="flex-1 truncate">{svc.name ?? "Service"}</span>
                      {svc.estimatedDurationMinutes && svc.estimatedDurationMinutes > 0 && (
                        <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
                          {formatServiceDuration(svc.estimatedDurationMinutes)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {available.length === 0 && !searchText.trim() && services.length === 0 && (
                <CommandEmpty>No services configured yet. Type a name to create one.</CommandEmpty>
              )}
              {available.length === 0 && searchText.trim() && exactMatchExists && (
                <CommandEmpty>Already attached to this job.</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected services — render as white pill-cards beneath the trigger.
          Same visual pattern as the EditVisitModal Service chip list so
          the two surfaces look identical when the user moves between them. */}
      {selected.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="selected-services">
          {selected.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              data-testid={`chip-service-${svc.id}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-slate-800 font-medium">{svc.name}</span>
                {svc.estimatedDurationMinutes && svc.estimatedDurationMinutes > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {formatServiceDuration(svc.estimatedDurationMinutes)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(svc.id)}
                aria-label={`Remove ${svc.name}`}
                className="h-5 w-5 rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center shrink-0"
                disabled={disabled}
                data-testid={`chip-remove-service-${svc.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Duration hours input
// ============================================================================
// 2026-04-26 polish v5: replaces the Duration <Select> with a typeable
// hours field. Accepts "1", "1.5", "2", etc. Stores minutes in canonical
// state. Re-syncs the draft when external state changes (service prefill,
// "Find next available" populating duration, etc).

function formatDurationAsHours(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return String(hours);
  // Trim trailing zeroes from the fractional part.
  return hours.toFixed(2).replace(/\.?0+$/, "");
}

interface DurationHoursInputProps {
  durationMinutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}

function DurationHoursInput({ durationMinutes, onChange, disabled }: DurationHoursInputProps) {
  const [draft, setDraft] = useState(() => formatDurationAsHours(durationMinutes));

  // Re-sync the visible draft whenever the canonical state changes from
  // outside this input — e.g. service prefill bumping the duration to
  // 90 min should display as "1.5" without the user having to refocus.
  useEffect(() => {
    const fresh = formatDurationAsHours(durationMinutes);
    setDraft(fresh);
  }, [durationMinutes]);

  function handleChange(next: string) {
    setDraft(next);
    const n = parseFloat(next);
    if (Number.isFinite(n) && n > 0) {
      const minutes = Math.round(n * 60);
      // Floor at 15 min so a typed "0.1" doesn't become a 6-min job.
      const clamped = Math.max(15, minutes);
      if (clamped !== durationMinutes) onChange(clamped);
    }
  }

  function handleBlur() {
    // Snap the visible draft back to the canonical formatting.
    setDraft(formatDurationAsHours(durationMinutes));
  }

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder="1"
        className="h-9 w-full text-xs pr-6 bg-white"
        data-testid="input-duration-hours"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
        h
      </span>
    </div>
  );
}

// ============================================================================
// Main Dialog
// ============================================================================

// Recurrence preset definitions — map user-facing labels to existing engine values
// without introducing new recurrence types or backend changes
type RecurrencePreset = "weekly" | "biweekly" | "monthly" | "quarterly" | "semi-annual" | "annual" | "custom";
const RECURRENCE_PRESETS: { value: RecurrencePreset; label: string; kind: "weekly" | "monthly"; interval: number }[] = [
  { value: "weekly",      label: "Weekly",      kind: "weekly",  interval: 1 },
  { value: "biweekly",    label: "Biweekly",    kind: "weekly",  interval: 2 },
  { value: "monthly",     label: "Monthly",     kind: "monthly", interval: 1 },
  { value: "quarterly",   label: "Quarterly",   kind: "monthly", interval: 3 },
  { value: "semi-annual", label: "Semi-Annual", kind: "monthly", interval: 6 },
  { value: "annual",      label: "Annual",      kind: "monthly", interval: 12 },
  { value: "custom",      label: "Custom",      kind: "weekly",  interval: 1 },
];

interface QuickAddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
  editJob?: Job | null;
  onSuccess?: () => void;
  /** Prefill schedule from dispatch board quick-create (tech + date + time).
   * 2026-04-12 (Option A): single-tech seed goes into `assignedTechnicianIds`
   * as a 1-element array. No `primaryTechnicianId` — jobs don't own a primary. */
  initialSchedule?: {
    date?: Date | string;
    time?: string;
    durationMinutes?: number;
    assignedTechnicianIds?: string[];
  };
  /** Mode control: "standard" = normal create with optional recurring toggle,
   *  "recurring" = opens with recurring ON by default, schedule row hidden */
  mode?: "standard" | "recurring";
  /** 2026-04-25 CreateNewDialog embedding: when true, the parent shell owns
   *  the Dialog wrapper / DialogContent / title, and this component renders
   *  only the form body + footer. Lets the new tabbed `+ New` modal compose
   *  the canonical job form alongside the canonical task form without
   *  duplicating either. */
  embedded?: boolean;
  /** Embedded-mode density hint (e.g. tabbed shell). Currently a no-op flag —
   *  the form is already compact — but reserved so callers can opt in to
   *  future trims without a breaking-change to the prop set. */
  compact?: boolean;
}

export function QuickAddJobDialog({ open, onOpenChange, preselectedLocationId, editJob, onSuccess, initialSchedule, mode = "standard", embedded = false, compact: _compact = false }: QuickAddJobDialogProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityStore();
  // Tenant default scheduling buffer (minutes) — applied at scheduledEnd
  // computation in createJobWithSchedule. Work duration is unaffected.
  const defaultBufferMinutes = useDefaultSchedulingBuffer();
  // Location selector state (canonical)
  const [locationSearch, setLocationSearchText] = useState("");
  const [selectedLocationOption, setSelectedLocationOption] = useState<LocationOption | null>(null);
  const isEditMode = !!editJob;

  const getDefaultFormData = () => ({
    locationId: preselectedLocationId || "",
    summary: "",
    description: "",
  });

  const [showConflictAlert, setShowConflictAlert] = useState(false);
  const [formData, setFormData] = useState(getDefaultFormData());
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  // 2026-04-26 polish v6: service is now multi-select, mirroring the EditVisitModal
  // pattern. Each entry holds the minimum the form needs (id, name, duration) so
  // the chip list can render without round-tripping back through `/api/items`.
  // After job creation, each entry is POSTed to `/api/jobs/:id/parts` using the
  // canonical productOptionToCatalogItem → catalogItemToDraft → draftToJobPartPayload
  // pipeline. There is no parallel persistence layer — same backend route Edit
  // Visit uses.
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  // 2026-04-26 polish v2: searchable service combobox state.
  const [serviceComboOpen, setServiceComboOpen] = useState(false);
  const [serviceSearchText, setServiceSearchText] = useState("");
  // Dirty flags: once the user manually edits Summary or Duration, we stop
  // auto-overwriting from the selected-services join. This matches the spec:
  // "If user manually edits Summary, do not overwrite. If services removed
  // and Summary auto-managed, recalculate."
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [durationDirty, setDurationDirty] = useState(false);

  // Recurring job state — when enabled, submits to POST /api/recurring-templates instead of POST /api/jobs
  // In recurring mode, isRecurring defaults ON
  const isRecurringMode = mode === "recurring";
  const [isRecurring, setIsRecurring] = useState(isRecurringMode);
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("weekly");
  const [recurringKind, setRecurringKind] = useState<"weekly" | "monthly">("weekly");
  const [recurringInterval, setRecurringInterval] = useState(1);
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>([1]); // Default Monday
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState(1);
  const [recurringStartDate, setRecurringStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [recurringEndDate, setRecurringEndDate] = useState("");

  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(
    createDefaultScheduleValue({ unscheduled: true })
  );

  // 2026-04-26 v7: dirty flag for the Start time field. Once the user (or a
  // dispatch prefill) sets a specific start, we never silently overwrite it
  // — only an explicit Unscheduled toggle resets it. Per spec: "If user
  // manually changes start time, do not overwrite it unless they change date
  // back to today and field is still untouched/defaulted."
  const [startTimeDirty, setStartTimeDirty] = useState(false);

  useEffect(() => {
    if (open && editJob) {
      // Edit mode: populate core fields only — no schedule/assignment (2026-04-03)
      setFormData({
        locationId: editJob.locationId || "",
        summary: editJob.summary || "",
        description: editJob.description || "",
      });
    } else if (open && initialSchedule) {
      // Dispatch board quick-create: prefill schedule with crew + date + time.
      // The user clicked a specific slot — treat the start time as user-chosen
      // (dirty) so subsequent date changes don't silently round-up the time.
      setScheduleValue(createDefaultScheduleValue({
        unscheduled: false,
        date: initialSchedule.date,
        time: initialSchedule.time,
        durationMinutes: initialSchedule.durationMinutes ?? 60,
        assignedTechnicianIds: initialSchedule.assignedTechnicianIds ?? [],
      }));
      setStartTimeDirty(true);
      if (preselectedLocationId) {
        setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
      }
    } else if (open && preselectedLocationId) {
      setFormData(prev => ({ ...prev, locationId: preselectedLocationId }));
    }
  }, [open, editJob, preselectedLocationId, initialSchedule]);

  // Surface controller: manages abort, debounce, cache cleanup on close/unmount
  const surface = useSurfaceController(open, {
    queryKeys: ["/api/clients/search-locations"],
  });

  useEffect(() => {
    if (!open) {
      setFormData(getDefaultFormData());
      setScheduleValue(createDefaultScheduleValue({ unscheduled: true }));
      setLocationSearchText("");
      setSelectedLocationOption(null);
      setShowConflictAlert(false);
      setSelectedEquipmentIds([]);
      setSelectedServices([]);
      setSummaryDirty(false);
      setDurationDirty(false);
      setStartTimeDirty(false);
      setServiceComboOpen(false);
      setServiceSearchText("");
      // Reset recurring state on close — recurring mode defaults ON
      setIsRecurring(isRecurringMode);
      setRecurrencePreset("weekly");
      setRecurringKind("weekly");
      setRecurringInterval(1);
      setRecurringDaysOfWeek([1]);
      setRecurringDayOfMonth(1);
      setRecurringStartDate(format(new Date(), "yyyy-MM-dd"));
      setRecurringEndDate("");
    }
  }, [open, isRecurringMode]);

  // ── Location search + resolution (canonical entity) ──
  const { data: locationResults = [], isLoading: locationSearchLoading } = useLocationSearch(locationSearch, { enabled: open });
  const { data: resolvedLocation } = useLocationById(formData.locationId && !selectedLocationOption ? formData.locationId : null);

  // Derive effective selected location: user selection > resolved from ID > null
  const selectedLocation = selectedLocationOption ?? resolvedLocation ?? null;

  // ── Service catalog (canonical /api/items?type=service) ─────────────
  // 2026-04-26: surfaces the existing items table (rows where type='service')
  // so users can pre-fill summary + duration from a configured service. The
  // selector hides itself when the tenant has no services configured.
  interface ServiceItem {
    id: string;
    name: string | null;
    description: string | null;
    estimatedDurationMinutes: number | null;
  }
  const { data: serviceData } = useQuery({
    queryKey: ["/api/items", { type: "service" }],
    queryFn: async () => {
      const res = await apiRequest<ServiceItem[] | { data: ServiceItem[] }>(
        "/api/items?type=service&limit=200",
      );
      // Endpoint returns a raw array when no `cursor`/`offset` is set, otherwise { data, meta }.
      return Array.isArray(res) ? res : res.data ?? [];
    },
    enabled: open && !isEditMode,
    staleTime: 60_000,
  });
  const services = useMemo<ServiceItem[]>(
    () => (serviceData ?? []).filter((s) => s && s.id && s.name),
    [serviceData],
  );

  /** Add a service to the multi-select list. Auto-recomputes Summary and
   *  Duration when the user has not manually edited them since the last
   *  service change. */
  function addService(svc: SelectedService) {
    setSelectedServices((prev) => {
      if (prev.some((s) => s.id === svc.id)) return prev;
      const next = [...prev, svc];
      autoSyncFromServices(next);
      return next;
    });
  }

  function removeService(id: string) {
    setSelectedServices((prev) => {
      const next = prev.filter((s) => s.id !== id);
      autoSyncFromServices(next);
      return next;
    });
  }

  /** When the services list changes, recompute Summary + Duration unless the
   *  user has explicitly edited them. Per spec: changing services again
   *  resets the auto-managed state, so this also clears the dirty flags
   *  back to false (the next services list reset becomes the new baseline). */
  function autoSyncFromServices(list: SelectedService[]) {
    if (!summaryDirty) {
      const joined = list
        .map((s) => s.name)
        .filter(Boolean)
        .join(" + ");
      setFormData((prev) => ({ ...prev, summary: joined }));
    }
    if (!durationDirty) {
      const sum = list.reduce(
        (acc, s) => acc + Math.max(0, s.estimatedDurationMinutes ?? 0),
        0,
      );
      // Spec: "Services without duration = 0." But the schedule still needs
      // a positive duration. When the sum is 0, fall back to a sensible 60-
      // minute default so unscheduled-to-scheduled flips don't surprise the
      // user with a 0-minute window.
      setScheduleValue((prev) => ({
        ...prev,
        durationMinutes: sum > 0 ? sum : 60,
      }));
    }
  }

  /** Filter services by typed search text (case-insensitive match on name). */
  const filteredServices = useMemo(() => {
    const q = serviceSearchText.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => (s.name ?? "").toLowerCase().includes(q));
  }, [services, serviceSearchText]);

  /** Whether the typed search text matches an existing service name exactly.
   *  When false AND text is non-empty, we surface the "Create service: …" CTA. */
  const exactMatchExists = useMemo(() => {
    const q = serviceSearchText.trim().toLowerCase();
    if (!q) return true; // nothing typed, no CTA needed
    return services.some((s) => (s.name ?? "").trim().toLowerCase() === q);
  }, [services, serviceSearchText]);

  /** Quick-create a service with sensible defaults. Mirrors the EditVisit
   *  pattern — one-shot POST /api/items with name + type, then auto-add
   *  the new service to selectedServices. The user can edit the service's
   *  details (cost, taxCode, etc.) later from Items management. The prior
   *  full ProductServiceFormDialog flow was overkill for quick-add and
   *  required closing the modal, filling fields, and re-opening — this
   *  inline path keeps the user in the dialog. */
  const createServiceQuickMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest<{
        id: string;
        name: string | null;
        estimatedDurationMinutes: number | null;
        unitPrice: string | null;
        cost: string | null;
      }>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          type: "service",
          isActive: true,
          isTaxable: true,
        }),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items", { type: "service" }] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      setServiceComboOpen(false);
      setServiceSearchText("");
      addService({
        id: created.id,
        name: created.name ?? "Service",
        estimatedDurationMinutes: created.estimatedDurationMinutes,
        unitPrice: created.unitPrice,
        unitCost: created.cost,
      });
      toast({ title: "Service created", description: created.name ?? "New service" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't create service", description: err.message, variant: "destructive" });
    },
  });

  // ── Find Availability (dispatcher-controlled gap picker) ──────────────
  //
  // 2026-04-26: replaced the old auto-pick "Find next available" flow.
  // The new flow does NOT mutate the form on click — it opens an inline
  // panel that shows every technician's open windows for the selected
  // date and requested duration, grouped by tech. The dispatcher then
  // chooses a gap, which prefills the form fields (`date`, `time`,
  // `assignedTechnicianIds`, `durationMinutes`) but does not save —
  // the actual create still goes through the existing Create button.
  //
  // Panel state is declared here; the `availabilityGroups` derivation
  // and the `applyAvailabilityGap` callback live below the
  // `capacityData` query (they read it).
  const [availabilityPanelOpen, setAvailabilityPanelOpen] = useState(false);

  // ── Schedule helpers ──

  const updateSchedule = useCallback((partial: Partial<JobScheduleValue>) => {
    setScheduleValue(prev => {
      const next = { ...prev, ...partial };
      if (partial.time !== undefined) {
        next.isAllDay = !partial.time;
      }
      return next;
    });
  }, []);

  // ── Capacity feed (canonical /api/dashboard/capacity) ──
  // 2026-04-26 v8: date-aware. The endpoint now accepts ?date=YYYY-MM-DD and
  // returns workday + scheduleBlocks for THAT day in the company tz; the
  // server change is a thin pass-through over the existing `now` parameter
  // of `getTodayCapacity`. Without a date param the endpoint still defaults
  // to today (Dashboard behavior unchanged).
  //
  // The query key includes the selected date so React Query refetches when
  // the user moves between today / tomorrow / next week. When the schedule
  // is unscheduled (no date), we still fetch today's capacity so the
  // "Find next available" button has data to operate on.
  const capacityQueryDate = scheduleValue.date || ""; // "" → today on server
  const { data: capacityData } = useQuery<CapacityResponse>({
    queryKey: ["/api/dashboard/capacity", capacityQueryDate],
    queryFn: () =>
      apiRequest<CapacityResponse>(
        capacityQueryDate
          ? `/api/dashboard/capacity?date=${capacityQueryDate}`
          : "/api/dashboard/capacity",
      ),
    enabled: open && !isEditMode,
    staleTime: 30_000,
  });
  const companyTimezone = capacityData?.timezone ?? null;

  // ── Find Availability — derived gap groups + apply callback ────────────
  // Reads from the cached `capacityData` above; no extra fetch. The panel
  // (rendered later in the JSX, gated by `availabilityPanelOpen`) consumes
  // these directly. Uses the canonical `groupOpenGapsByTech` helper.
  const availabilityGroups: TechAvailability[] = useMemo(() => {
    if (!capacityData) return [];
    const wantedDuration =
      scheduleValue.durationMinutes && scheduleValue.durationMinutes > 0
        ? scheduleValue.durationMinutes
        : 60;
    const todayYmd = getWallClockInTimezone(new Date(), capacityData.timezone ?? null).ymd;
    // Future date: anchor `now=0` so the panel evaluates the full workday
    // rather than clipping past times that would only matter for today.
    // Today (or unscheduled, which the server resolves to today): anchor
    // at real `Date.now()` so past slots are excluded.
    const isFutureDate = !!scheduleValue.date && scheduleValue.date > todayYmd;
    return groupOpenGapsByTech(capacityData, wantedDuration, {
      preferredTechnicianIds: scheduleValue.assignedTechnicianIds,
      now: isFutureDate ? 0 : Date.now(),
    });
  }, [
    capacityData,
    scheduleValue.date,
    scheduleValue.durationMinutes,
    scheduleValue.assignedTechnicianIds,
  ]);

  const applyAvailabilityGap = useCallback(
    (technicianId: string, gap: OpenGap) => {
      const wantedDuration =
        scheduleValue.durationMinutes && scheduleValue.durationMinutes > 0
          ? scheduleValue.durationMinutes
          : 60;
      // Apply the GAP'S START as the slot start for the requested duration —
      // not the gap's full extent. The dispatcher can still nudge the start
      // time afterwards manually.
      setScheduleValue((prev) => ({
        ...prev,
        unscheduled: false,
        date: gap.date,
        time: gap.time,
        durationMinutes: wantedDuration,
        assignedTechnicianIds: [technicianId],
        isAllDay: false,
      }));
      setStartTimeDirty(true);
      setAvailabilityPanelOpen(false);
    },
    [scheduleValue.durationMinutes],
  );

  // ── Smart default time ──
  // Pure helper wraps the canonical getSmartScheduleDefault so the dialog can
  // call it from multiple paths (unscheduled toggle, date change, etc.).
  const computeSmartDefault = useCallback(
    (targetDateYmd?: string) =>
      getSmartScheduleDefault({
        targetDateYmd,
        timezone: companyTimezone,
        now: new Date(),
      }),
    [companyTimezone],
  );

  const handleUnscheduledChange = useCallback((checked: boolean) => {
    if (checked) {
      updateSchedule({ unscheduled: true, date: "", time: "", isAllDay: false });
      setStartTimeDirty(false);
    } else {
      // Switching to scheduled: pick today as the target date and let
      // getSmartScheduleDefault compute the time. If "today" + current wall
      // clock rolls past midnight, the helper advances `date` for us.
      const smart = computeSmartDefault();
      updateSchedule({
        unscheduled: false,
        date: smart.date,
        time: smart.time,
        isAllDay: false,
      });
      // The default isn't user-chosen — leave dirty=false so a future Date
      // change to "today" can re-derive a fresh rounded value if needed.
      setStartTimeDirty(false);
    }
  }, [updateSchedule, computeSmartDefault]);

  // Date picker → if Start was never user-edited, recompute it for the
  // newly chosen date. This implements the spec rule:
  //   "If user manually changes start time, do not overwrite it unless they
  //    change date back to today and field is still untouched/defaulted."
  const handleDateChange = useCallback(
    (newDateYmd: string) => {
      if (startTimeDirty) {
        updateSchedule({ date: newDateYmd });
        return;
      }
      const smart = computeSmartDefault(newDateYmd);
      updateSchedule({ date: smart.date, time: smart.time, isAllDay: false });
    },
    [startTimeDirty, updateSchedule, computeSmartDefault],
  );

  const selectedDate = scheduleValue.date ? parseISO(scheduleValue.date) : undefined;
  const isScheduleDisabled = scheduleValue.unscheduled;
  const isAllDay = !scheduleValue.time && !scheduleValue.unscheduled && !!scheduleValue.date;

  // ── Smart-availability derivations (2026-04-26 v8) ───────────────────
  // The capacity feed is now date-aware (server accepts ?date=YYYY-MM-DD),
  // so suggestions and the conflict warning work for ANY selected date —
  // not just today. Both still require exactly ONE technician (the
  // dispatcher's "open slot for X" mental model).

  /** Today in the company's timezone — used to decide whether to clip
   *  past time during gap enumeration. For future dates we anchor `now`
   *  before workday-start so the morning isn't dropped. */
  const todayInTz = useMemo(
    () => getWallClockInTimezone(new Date(), companyTimezone).ymd,
    [companyTimezone],
  );

  const isFutureSelectedDate =
    !scheduleValue.unscheduled && !!scheduleValue.date && scheduleValue.date > todayInTz;

  /** The single selected technician (when exactly one is picked). Multi-tech
   *  jobs collapse to "no suggestions" for now — the dispatcher's mental
   *  model of "open slots" only makes sense for one person at a time. */
  const singleSelectedTechId =
    scheduleValue.assignedTechnicianIds.length === 1
      ? scheduleValue.assignedTechnicianIds[0]
      : null;

  const selectedTechCapacity = useMemo(() => {
    if (!singleSelectedTechId || !capacityData) return null;
    return (
      capacityData.technicians.find((t) => t.technicianId === singleSelectedTechId) ?? null
    );
  }, [capacityData, singleSelectedTechId]);

  /** Up to 3 earliest gaps that fit the requested duration + tenant buffer. */
  const availabilitySuggestions = useMemo(() => {
    if (scheduleValue.unscheduled) return [];
    if (!scheduleValue.date) return [];
    if (!selectedTechCapacity) return [];
    const work = scheduleValue.durationMinutes > 0 ? scheduleValue.durationMinutes : 60;
    const wanted = work + Math.max(0, defaultBufferMinutes | 0);
    return computeOpenGapsForTech(selectedTechCapacity, wanted, {
      now: isFutureSelectedDate ? 0 : Date.now(),
    }).slice(0, 3);
  }, [
    scheduleValue.unscheduled,
    scheduleValue.date,
    selectedTechCapacity,
    scheduleValue.durationMinutes,
    isFutureSelectedDate,
    defaultBufferMinutes,
  ]);

  /** Whether the user's CURRENT (date+start+duration) overlaps this
   *  technician's other booked work. Non-blocking — the warning renders
   *  inline below the schedule row and does not gate Create Job. */
  const conflictWarning = useMemo<{ count: number; techName: string } | null>(() => {
    if (scheduleValue.unscheduled) return null;
    if (!selectedTechCapacity) return null;
    if (!scheduleValue.time || !scheduleValue.date) return null;
    if (!(scheduleValue.durationMinutes > 0)) return null;
    const [y, mo, d] = scheduleValue.date.split("-").map(Number);
    const [hh, mm] = scheduleValue.time.split(":").map(Number);
    if (![y, mo, d, hh, mm].every(Number.isFinite)) return null;
    // Browser-local interpretation of the form's wall-clock matches the
    // dispatch board's overlap math when the user is in the company tz —
    // this is the same convention the rest of the dialog uses.
    const startLocal = new Date(y, (mo as number) - 1, d, hh, mm, 0, 0);
    const startMs = startLocal.getTime();
    const blockMins = scheduleValue.durationMinutes + Math.max(0, defaultBufferMinutes | 0);
    const endMs = startMs + blockMins * 60_000;
    const overlaps = getOverlappingBookedBlocks(selectedTechCapacity, startMs, endMs);
    if (overlaps.length === 0) return null;
    return { count: overlaps.length, techName: selectedTechCapacity.name };
  }, [
    scheduleValue.unscheduled,
    selectedTechCapacity,
    scheduleValue.date,
    scheduleValue.time,
    scheduleValue.durationMinutes,
    defaultBufferMinutes,
  ]);

  /** Apply a suggested gap → updates date + start, keeps duration + tech.
   *  Marks the time as user-chosen (dirty) so a downstream date change
   *  doesn't immediately undo the click. */
  const applySuggestion = useCallback(
    (suggestion: { date: string; time: string }) => {
      setScheduleValue((prev) => ({
        ...prev,
        unscheduled: false,
        date: suggestion.date,
        time: suggestion.time,
        isAllDay: false,
      }));
      setStartTimeDirty(true);
    },
    [],
  );

  // ── Mutations ──

  const createJobMutation = useMutation({
    mutationFn: async () => {
      const result = await createJobWithSchedule(
        {
          locationId: formData.locationId,
          summary: formData.summary.trim(),
          description: formData.description.trim() || null,
          priority: "medium",
        },
        scheduleValue,
        defaultBufferMinutes,
      );
      if (!result.success) throw new Error(result.error || "Failed to create job");
      return result;
    },
    onSuccess: async (result: any) => {
      const job = result.job;

      // Link selected equipment after job creation (fire-and-forget with error toast)
      if (job?.id && selectedEquipmentIds.length > 0) {
        const linkErrors: string[] = [];
        for (const equipmentId of selectedEquipmentIds) {
          try {
            await apiRequest(`/api/jobs/${job.id}/equipment`, {
              method: "POST",
              body: JSON.stringify({ equipmentId }),
            });
          } catch {
            linkErrors.push(equipmentId);
          }
        }
        if (linkErrors.length > 0) {
          toast({
            title: "Job created",
            description: `${linkErrors.length} equipment item(s) could not be linked. You can add them from the job detail page.`,
            variant: "destructive",
          });
        }
        // Invalidate job equipment cache
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "equipment"] });
      }

      // 2026-04-26 polish v6: Persist selected services as job_part rows.
      // Same canonical pipeline EditVisitModal uses:
      //   ProductOption → catalogItemToDraft → draftToJobPartPayload →
      //   POST /api/jobs/:id/parts. Failures don't block the create — the
      //   job is already saved, services can be added later from job detail.
      if (job?.id && selectedServices.length > 0) {
        const partFailures: string[] = [];
        for (const svc of selectedServices) {
          try {
            const draft = catalogItemToDraft(
              productOptionToCatalogItem({
                id: svc.id,
                name: svc.name,
                type: "service",
                unitPrice: svc.unitPrice ?? null,
                cost: svc.unitCost ?? null,
              }),
              { source: "manual", quantity: "1" },
            );
            await apiRequest(`/api/jobs/${job.id}/parts`, {
              method: "POST",
              body: JSON.stringify(draftToJobPartPayload(draft)),
            });
          } catch {
            partFailures.push(svc.name);
          }
        }
        if (partFailures.length > 0) {
          toast({
            title: "Job created",
            description: `${partFailures.length} service(s) could not be attached. Add them from the job detail page.`,
            variant: "destructive",
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "parts"] });
      }

      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });

      logActivity({
        type: "created",
        entityType: "job",
        entityId: job?.id || "",
        label: `Created Job${job?.jobNumber ? ` #${job.jobNumber}` : ""}`,
        meta: selectedLocation?.companyName || formData.summary || undefined,
      });

      toast({
        title: "Job Created",
        description: scheduleValue.unscheduled
          ? "Job has been added to the backlog."
          : "Job has been created and scheduled.",
      });
      if (quickCreateClientMutation.isSuccess) {
        // Reminder for quick-created clients that may need details completed
        const name = selectedLocation?.companyName;
        surface.timeout("needs-details-reminder", () => {
          toast({
            title: "Reminder",
            description: `Don't forget to complete the details for "${name}"!`,
          });
        }, 1500);
      }

      if (result.hasConflict) {
        // Show conflict alert — defer modal close until user acknowledges
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
      }
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create job", variant: "destructive" });
    },
  });

  const updateJobMutation = useMutation({
    mutationFn: async (data: Partial<InsertJob>) => {
      // Edit mode: update core job fields only. Schedule/assignment is managed
      // via visit-level controls (EditVisitModal), not job-level editing (2026-04-03).
      return apiRequest(`/api/jobs/${editJob?.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      // Part B: Match create-path invalidation — ensure client/company overview updates
      queryClient.invalidateQueries({ queryKey: ["/api/clients"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"], exact: false });
      toast({ title: "Job Updated", description: "Job has been updated successfully." });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update job", variant: "destructive" });
    },
  });

  const quickCreateClientMutation = useMutation({
    mutationFn: async (companyName: string) => {
      return await apiRequest<{ client: { id: string; companyName?: string } }>("/api/clients/quick-create", {
        method: "POST",
        body: JSON.stringify({ companyName }),
      });
    },
    onSuccess: (result, companyName) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/search-locations"] });
      if (result.client?.id) {
        const loc: LocationOption = { id: result.client.id, companyName: result.client.companyName ?? companyName };
        setFormData(prev => ({ ...prev, locationId: result.client.id }));
        setSelectedLocationOption(loc);
        setSelectedEquipmentIds([]);
        logActivity({ type: "created", entityType: "client", entityId: result.client.id, label: "Created Client", meta: companyName });
      }
      toast({ title: "Client Created", description: "Client has been quick-created. Remember to fill in details later!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create client", variant: "destructive" });
    },
  });

  // Apply recurrence preset — auto-configures kind/interval from preset selection
  const handlePresetChange = useCallback((preset: RecurrencePreset) => {
    setRecurrencePreset(preset);
    if (preset !== "custom") {
      const def = RECURRENCE_PRESETS.find((p) => p.value === preset)!;
      setRecurringKind(def.kind);
      setRecurringInterval(def.interval);
    }
  }, []);

  // Recurring template creation — maps QuickAddJob form fields to POST /api/recurring-templates payload
  const createRecurringMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: formData.summary.trim(),
        description: formData.description.trim() || null,
        locationId: formData.locationId || null,
        // Non-PM recurring jobs must use a non-maintenance jobType so they are distinguishable from PM contracts
        jobType: "repair",
        priority: "medium",
        recurrenceKind: recurringKind,
        interval: recurringInterval,
        startDate: recurringStartDate,
        endDate: recurringEndDate || null,
        // Non-PM recurring job defaults: no PM billing, no PM parts, phase generation mode
        pmBillingModel: null,
        includeLocationPmParts: false,
        generationMode: "phase",
        // 2026-04-02: Recurring jobs use tight window (7 before, 0 after) — not PM-style 14-day after
        serviceWindowDaysBefore: 7,
        serviceWindowDaysAfter: 0,
        // Do not force sub-status — let jobs generate with status=open, no sub-status
        openSubStatusDefault: null,
      };
      if (recurringKind === "weekly") {
        payload.daysOfWeek = recurringDaysOfWeek;
      } else {
        payload.dayOfMonth = recurringDayOfMonth;
      }
      return await apiRequest("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-jobs"] });
      toast({
        title: "Recurring Job Created",
        description: "A recurring job template has been created. Jobs will be generated automatically.",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create recurring job", variant: "destructive" });
    },
  });

  const isPending = createJobMutation.isPending || updateJobMutation.isPending || createRecurringMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.locationId) {
      toast({ title: "Error", description: "Please select a location", variant: "destructive" });
      return;
    }
    if (!formData.summary.trim()) {
      toast({ title: "Error", description: "Please enter a job summary", variant: "destructive" });
      return;
    }

    // Recurring path: validate recurring fields and submit to recurring template API
    if (isRecurring && !isEditMode) {
      if (!recurringStartDate) {
        toast({ title: "Error", description: "Please select a start date for the recurring job", variant: "destructive" });
        return;
      }
      if (recurringKind === "weekly" && recurringDaysOfWeek.length === 0) {
        toast({ title: "Error", description: "Please select at least one day of the week", variant: "destructive" });
        return;
      }
      createRecurringMutation.mutate(undefined);
      return;
    }

    // Schedule validation only applies to create mode (2026-04-03)
    if (!isEditMode && !scheduleValue.unscheduled && !scheduleValue.date) {
      toast({ title: "Error", description: "Please select a date for the scheduled job", variant: "destructive" });
      return;
    }

    if (isEditMode) {
      updateJobMutation.mutate({
        locationId: formData.locationId,
        summary: formData.summary.trim(),
        description: formData.description.trim() || null,
        priority: "medium" as any,
      });
    } else {
      createJobMutation.mutate(undefined);
    }
  };

  // 2026-04-25: in embedded mode the parent shell (CreateNewDialog) already
  // renders the Dialog wrapper + title strip + tab-aware sizing, so we render
  // only the form + footer. The conflict alert + quick-create-client toast
  // logic stay live in both modes — they're not visual chrome.
  const formBody = (
    <form onSubmit={handleSubmit} className="space-y-2">
          {/* ── Location ──
              2026-04-26 polish v5: switched from CreateOrSelectField (inline
              results that expanded the modal while typing) to a Service-style
              Popover+Command combobox. Results overlay; modal shell stays
              stable. */}
          <div>
            <Label className="text-xs font-medium mb-0.5 block">Location *</Label>
            <LocationCombobox
              value={selectedLocation}
              searchText={locationSearch}
              onSearchTextChange={setLocationSearchText}
              searchResults={locationResults}
              searchLoading={locationSearchLoading}
              onChange={(loc) => {
                setSelectedLocationOption(loc);
                setFormData(prev => ({ ...prev, locationId: loc?.id ?? "" }));
                setSelectedEquipmentIds([]); // Reset equipment on location change
              }}
              onCreateNew={(text) => quickCreateClientMutation.mutate(text)}
              disabled={isPending}
            />
          </div>

          {/* ── Service + Equipment row ──
              2026-04-26 polish v3: paired side-by-side on desktop/tablet,
              stack on mobile. Service comes first per spec (left of Equipment).
              Both are optional inputs that hang off the selected Location. */}
          {!isEditMode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* Service (multi-select) ── 2026-04-26 polish v6
                 Mirrors EditVisitModal's ServiceMultiSelect: search-only
                 trigger on top, selected services rendered as white pill-
                 cards underneath. Add multiple, sum duration, " + "-join
                 summary auto-fill. Keeps the dialog state local; persists
                 to /api/jobs/:id/parts after the job is created. */}
            <div>
              <Label className="text-xs font-medium mb-0.5 block flex items-center gap-1.5">
                <Wrench className="h-3 w-3 text-muted-foreground" />
                Service (optional)
              </Label>
              <ServicesMultiSelect
                services={services}
                selected={selectedServices}
                searchOpen={serviceComboOpen}
                onSearchOpenChange={setServiceComboOpen}
                searchText={serviceSearchText}
                onSearchTextChange={setServiceSearchText}
                filteredServices={filteredServices}
                exactMatchExists={exactMatchExists}
                onAdd={addService}
                onRemove={removeService}
                onCreateNew={(name) => createServiceQuickMutation.mutate(name)}
                createPending={createServiceQuickMutation.isPending}
                disabled={isPending}
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-0.5 block flex items-center gap-1.5">
                <Wrench className="h-3 w-3 text-muted-foreground" />
                Equipment (optional)
              </Label>
              <EquipmentCombobox
                locationId={formData.locationId || null}
                selectedIds={selectedEquipmentIds}
                onChange={setSelectedEquipmentIds}
                disabled={isPending}
              />
            </div>
          </div>
          )}

          {/* ── Summary ── */}
          <div>
            <Label htmlFor="summary" className="text-xs font-medium mb-0.5 block">Summary *</Label>
            <Input
              id="summary"
              value={formData.summary}
              onChange={(e) => {
                // 2026-04-26 polish v6: a non-empty manual edit flips Summary
                // into dirty mode so subsequent service changes don't overwrite
                // the user's text. Clearing the field flips back to auto so
                // the next service add re-fills the summary. Programmatic
                // updates from autoSyncFromServices don't fire onChange, so
                // they don't toggle the flag.
                const val = e.target.value;
                setFormData((prev) => ({ ...prev, summary: val }));
                setSummaryDirty(val.trim().length > 0);
              }}
              placeholder="Brief description of the job"
              className="h-9 bg-white"
              data-testid="input-summary"
            />
          </div>

          {/* ── Make Recurring toggle ── */}
          {!isEditMode && !isRecurringMode && (
            <div className="flex items-center gap-2">
              <Switch
                id="make-recurring"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
                data-testid="switch-make-recurring"
              />
              <Label htmlFor="make-recurring" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" />
                Make Recurring
              </Label>
            </div>
          )}

          {/* ── Recurring schedule fields — shown when Make Recurring is ON ── */}
          {isRecurring && !isEditMode && (
            <div className="space-y-2 rounded-md border p-2.5 bg-muted/30">
              {/* Row: Preset + Start date + End date */}
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">Recurrence</Label>
                  <Select value={recurrencePreset} onValueChange={(v) => handlePresetChange(v as RecurrencePreset)}>
                    <SelectTrigger className="h-9 text-xs" data-testid="select-recurrence-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">Start date *</Label>
                  <CanonicalDatePicker
                    value={recurringStartDate}
                    onChange={(next) => setRecurringStartDate(next ?? "")}
                    className="w-full h-9 text-xs"
                    data-testid="input-recurring-start"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs font-medium mb-1 block">End date</Label>
                  <CanonicalDatePicker
                    value={recurringEndDate}
                    onChange={(next) => setRecurringEndDate(next ?? "")}
                    placeholder="Optional"
                    clearable
                    className="w-full h-9 text-xs"
                    data-testid="input-recurring-end"
                  />
                </div>
              </div>

              {/* Custom controls — only shown when preset is "custom" */}
              {recurrencePreset === "custom" && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-xs font-medium mb-1 block">Frequency</Label>
                      <Select value={recurringKind} onValueChange={(v) => setRecurringKind(v as "weekly" | "monthly")}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Label className="text-xs font-medium mb-1 block">Every</Label>
                      <Input
                        type="number"
                        min={1}
                        max={52}
                        value={recurringInterval}
                        onChange={(e) => setRecurringInterval(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
                        className="h-9 text-xs"
                        data-testid="input-recurring-interval"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground mt-5">{recurringKind === "weekly" ? "week(s)" : "month(s)"}</span>
                  </div>

                  {/* Weekly: day-of-week buttons */}
                  {recurringKind === "weekly" && (
                    <div>
                      <Label className="text-xs font-medium mb-1.5 block">Days</Label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((day) => {
                          const selected = recurringDaysOfWeek.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              className={cn(
                                "h-8 w-9 rounded text-xs font-medium border transition-colors",
                                selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
                              )}
                              onClick={() =>
                                setRecurringDaysOfWeek(
                                  selected
                                    ? recurringDaysOfWeek.filter((d) => d !== day.value)
                                    : [...recurringDaysOfWeek, day.value].sort(),
                                )
                              }
                              data-testid={`btn-day-${day.label.toLowerCase()}`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Monthly: day-of-month selector */}
                  {recurringKind === "monthly" && (
                    <div className="w-24">
                      <Label className="text-xs font-medium mb-1 block">Day of month</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={recurringDayOfMonth}
                        onChange={(e) => setRecurringDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                        className="h-9 text-xs"
                        data-testid="input-day-of-month"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Weekly day-of-week for non-custom weekly presets */}
              {recurrencePreset !== "custom" && recurringKind === "weekly" && (
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Days</Label>
                  <div className="flex gap-1">
                    {DAYS_OF_WEEK.map((day) => {
                      const selected = recurringDaysOfWeek.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          className={cn(
                            "h-8 w-9 rounded text-xs font-medium border transition-colors",
                            selected ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted",
                          )}
                          onClick={() =>
                            setRecurringDaysOfWeek(
                              selected
                                ? recurringDaysOfWeek.filter((d) => d !== day.value)
                                : [...recurringDaysOfWeek, day.value].sort(),
                            )
                          }
                          data-testid={`btn-day-${day.label.toLowerCase()}`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly day-of-month for non-custom monthly presets */}
              {recurrencePreset !== "custom" && recurringKind === "monthly" && (
                <div className="w-24">
                  <Label className="text-xs font-medium mb-1 block">Day of month</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={recurringDayOfMonth}
                    onChange={(e) => setRecurringDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    className="h-9 text-xs"
                    data-testid="input-day-of-month"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Schedule row — labeled grid (2026-04-26 polish v3) ──
              Visible labels above each control (Date / Start / Duration /
              Assigned To) replace the old single-line wrap that left "1h"
              naked next to "Date" / time / tech. The Time control is now
              the canonical 15-min Select shared with JobScheduleFields,
              not the OS-native `<input type="time">` that rendered as a
              browser-specific 3-column popover on Windows/Chrome. */}
          {!isEditMode && !isRecurring && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Label className="text-xs font-medium">Schedule</Label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={scheduleValue.unscheduled}
                  onCheckedChange={handleUnscheduledChange}
                  data-testid="checkbox-unscheduled"
                />
                <span className="text-xs text-muted-foreground">Unscheduled (backlog)</span>
              </label>
            </div>

            <div
              className={cn(
                "grid grid-cols-2 sm:grid-cols-4 gap-1.5",
                isScheduleDisabled && "opacity-40 pointer-events-none",
              )}
            >
              {/* Date */}
              <div className="space-y-0.5 min-w-0">
                <Label className="text-[11px] font-medium text-muted-foreground">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-9 w-full text-xs justify-start gap-1.5 bg-white",
                        !scheduleValue.date && "text-muted-foreground",
                      )}
                      disabled={isScheduleDisabled}
                      data-testid="button-select-date"
                    >
                      <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {scheduleValue.date ? format(selectedDate!, "MMM d, yyyy") : "Pick date"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => d && handleDateChange(format(d, "yyyy-MM-dd"))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Start — native time input. The OS native picker overlays
                  (does not push layout) and accepts manual edits per spec.
                  Manual edits flip startTimeDirty=true so subsequent date
                  changes never silently overwrite the user's pick. */}
              <div className="space-y-0.5 min-w-0">
                <Label className="text-[11px] font-medium text-muted-foreground">Start</Label>
                <Input
                  type="time"
                  step={900}
                  value={scheduleValue.time || ""}
                  onChange={(e) => {
                    setStartTimeDirty(true);
                    updateSchedule({ time: e.target.value, isAllDay: false });
                  }}
                  disabled={isScheduleDisabled}
                  className="h-9 w-full text-xs bg-white"
                  data-testid="input-time"
                />
              </div>

              {/* Duration — editable hours field. Accepts "1", "1.5", "2".
                  Service-prefill still works (the parent updates
                  scheduleValue.durationMinutes; an effect in the inner
                  component re-syncs the draft string). */}
              <div className="space-y-0.5 min-w-0">
                <Label className="text-[11px] font-medium text-muted-foreground">Duration</Label>
                <DurationHoursInput
                  durationMinutes={scheduleValue.durationMinutes}
                  onChange={(minutes) => {
                    // 2026-04-26 polish v6: a manual duration edit flips
                    // Duration into dirty mode so subsequent service changes
                    // don't overwrite the user's value. autoSyncFromServices
                    // skips when the flag is true, matching the spec's
                    // "preserve until services change again" rule.
                    setDurationDirty(true);
                    updateSchedule({ durationMinutes: minutes });
                  }}
                  disabled={isScheduleDisabled}
                />
              </div>

              {/* Assigned To — className override removes the selector's
                  default `min-w-[120px] max-w-[220px]` so the trigger fits
                  the grid column on narrow widths and never forces the
                  modal to sideways-scroll. */}
              <div className="space-y-0.5 min-w-0">
                <Label className="text-[11px] font-medium text-muted-foreground">Assigned To</Label>
                <TechnicianSelector
                  mode="multi"
                  value={scheduleValue.assignedTechnicianIds}
                  onChange={(ids) => updateSchedule({ assignedTechnicianIds: ids })}
                  disabled={isScheduleDisabled}
                  className="!min-w-0 !max-w-full w-full"
                />
              </div>
            </div>

            {/* 2026-04-26: tenant default scheduling buffer hint. Shown only
                when buffer > 0 AND a duration is set — the helper returns
                null otherwise so this row collapses cleanly. Mirrors the
                AddVisitDialog hint and uses the same shared formatter. */}
            {!isScheduleDisabled && (() => {
              const summary = formatScheduledBlockSummary(
                scheduleValue.durationMinutes,
                defaultBufferMinutes,
              );
              return summary ? (
                <p className="text-xs text-muted-foreground" data-testid="text-buffer-hint">
                  {summary}
                </p>
              ) : null;
            })()}

            {/* 2026-04-26: dispatcher-controlled "Find Availability"
                panel. Replaces the old auto-pick "Find next available"
                button. Click toggles the inline panel; the panel shows
                every technician's open windows for the selected date
                and requested duration, grouped by tech. Picking a gap
                prefills the form — never saves. The actual create
                still goes through the Create Job button below. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setAvailabilityPanelOpen((o) => !o)}
                disabled={isScheduleDisabled}
                aria-expanded={availabilityPanelOpen}
                aria-controls="find-availability-panel"
                data-testid="button-find-availability"
                title="Show open windows grouped by technician for the selected date and duration"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Find Availability
              </Button>

              {/* Per-tech availability suggestions (2026-04-26 v7).
                  Lights up only when ONE technician is selected and the
                  date is today — the canonical capacity feed is today-only.
                  Each chip applies date + start; never blocks manual entry.
                  When the selected tech has zero fitting gaps, surfaces the
                  compact "No open slot for this duration." per spec.  */}
              {!isScheduleDisabled && singleSelectedTechId && !!scheduleValue.date && (
                <div
                  className="flex flex-wrap items-center gap-1.5 text-xs"
                  data-testid="availability-suggestions-row"
                >
                  {availabilitySuggestions.length > 0 ? (
                    <>
                      <span className="text-muted-foreground">Available:</span>
                      {availabilitySuggestions.map((s) => (
                        <Button
                          key={s.startISO}
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => applySuggestion(s)}
                          data-testid={`availability-suggestion-${s.time}`}
                        >
                          {formatSlotTimeLabel(s.date, s.time)}
                        </Button>
                      ))}
                    </>
                  ) : (
                    <span
                      className="text-muted-foreground italic"
                      data-testid="availability-suggestions-empty"
                    >
                      No open slot for this duration.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 2026-04-26: Find Availability inline panel. Renders
                only when the dispatcher has explicitly opened it.
                Shows every active technician's open windows for the
                selected date + requested duration, grouped by tech.
                Each gap button prefills the form (date / time / tech
                / duration) and closes the panel — no save. Empty
                state when no tech has a fitting window for the
                requested duration. */}
            {availabilityPanelOpen && !isScheduleDisabled && (
              <div
                id="find-availability-panel"
                className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5"
                data-testid="find-availability-panel"
              >
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="text-xs font-medium text-slate-700">
                    Availability for{" "}
                    <span className="tabular-nums">
                      {scheduleValue.date
                        ? format(parseISO(scheduleValue.date), "MMM d")
                        : "today"}
                    </span>
                    {" · "}
                    {(() => {
                      const mins =
                        scheduleValue.durationMinutes && scheduleValue.durationMinutes > 0
                          ? scheduleValue.durationMinutes
                          : 60;
                      const hrs = mins / 60;
                      return Number.isInteger(hrs) ? `${hrs}h` : `${hrs.toFixed(1)}h`;
                    })()}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => setAvailabilityPanelOpen(false)}
                    data-testid="button-find-availability-close"
                  >
                    Close
                  </Button>
                </div>
                {!capacityData ? (
                  <p className="text-xs text-muted-foreground italic">
                    Loading availability…
                  </p>
                ) : availabilityGroups.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground italic"
                    data-testid="find-availability-empty"
                  >
                    No matching availability for{" "}
                    {scheduleValue.date
                      ? format(parseISO(scheduleValue.date), "MMM d")
                      : "today"}
                    .
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {availabilityGroups.map((group) => (
                      <div
                        key={group.technicianId}
                        data-testid={`find-availability-group-${group.technicianId}`}
                      >
                        <div className="text-xs font-semibold text-slate-800 mb-0.5">
                          {group.technicianName}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.gaps.map((gap, idx) => {
                            const startLabel = formatSlotTimeLabel(gap.date, gap.time);
                            const endTime = gap.endISO.slice(11, 16);
                            const endLabel = formatSlotTimeLabel(gap.date, endTime);
                            const hrs = gap.durationMinutes / 60;
                            const durLabel = Number.isInteger(hrs)
                              ? `${hrs}h`
                              : `${hrs.toFixed(1)}h`;
                            return (
                              <Button
                                key={`${group.technicianId}-${gap.startISO}`}
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => applyAvailabilityGap(group.technicianId, gap)}
                                data-testid={`find-availability-gap-${group.technicianId}-${idx}`}
                              >
                                {startLabel} – {endLabel} · {durLabel} open
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Non-blocking overlap warning (2026-04-26 v7). Tech-selected,
                today only, recomputes on assignee/date/start/duration change.
                Renders only — never gates the Create button. */}
            {!isScheduleDisabled && conflictWarning && (
              <div
                className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
                role="status"
                data-testid="conflict-warning"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  This overlaps another scheduled visit for{" "}
                  <span className="font-medium">{conflictWarning.techName}</span>. Review dispatch board.
                </span>
              </div>
            )}
          </div>
          )}

          {/* ── Team Instructions (optional, compact 2-row) ──
              2026-04-26 v9 compactness pass: textarea trimmed to h-[40px]
              (≈ 2 lines of 14px text + minimal vertical padding). Label
              spacing also tightened. Resize disabled so users cannot
              re-grow it. */}
          <div>
            <Label htmlFor="description" className="text-xs font-medium mb-0.5 block">Team Instructions</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Add any notes or instructions for the team..."
              rows={2}
              className="text-sm resize-none h-[40px] bg-white"
              data-testid="input-description"
            />
          </div>

          {/* ── Footer ──
              2026-04-26 polish v4: footer is a natural-flow element at the
              end of the form. The previous v3 sticky version with
              `-mx-6 px-6` overflowed the embedded wrapper (which is `px-5`)
              by 8px and triggered the horizontal scrollbar at the bottom of
              the modal. The form is now compact enough to fit without the
              embedded scroll engaging on common desktop heights, so a
              sticky footer isn't needed. The embedded `overflow-y-auto`
              remains only as a small-screen safety net. */}
          <DialogFooter className="pt-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !formData.locationId || !formData.summary.trim()}
              data-testid="button-create-job"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditMode ? "Saving..." : isRecurring ? "Creating Recurring..." : "Creating..."}
                </>
              ) : (
                isEditMode ? "Save Changes" : (isRecurring || isRecurringMode) ? "Create Recurring Job" : "Create Job"
              )}
            </Button>
          </DialogFooter>
        </form>
  );

  return (
    <>
    {embedded ? (
      // 2026-04-26 v9 compactness pass: padding tightened to px-4 pt-2 pb-2
      // so the Job tab fits without internal scroll on common desktop heights
      // even after the recurring panel expands. `overflow-y-auto` stays as a
      // safety net for very small viewports (max-h-[90vh] on the parent shell).
      <div className="px-4 pt-2 pb-2 flex-1 min-h-0 overflow-y-auto" data-testid="embedded-quick-add-job">
        {formBody}
      </div>
    ) : (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl" data-testid="dialog-quick-add-job">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">{isEditMode ? "Edit Job" : isRecurringMode ? "Create Recurring Job" : "Create New Job"}</DialogTitle>
          </DialogHeader>
          {formBody}
        </DialogContent>
      </Dialog>
    )}

    <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Scheduling conflict detected</AlertDialogTitle>
          <AlertDialogDescription>
            This item overlaps another scheduled item. Please review the dispatch board.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); }}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 2026-04-26 polish v6: full ProductServiceFormDialog mount removed.
         The multi-select Service combobox now uses the simpler one-shot
         POST /api/items pattern (createServiceQuickMutation) — same
         pattern as EditVisitModal. Users wanting full service-edit fields
         can still open Items management; the modal stays focused on
         quick-create. */}
    </>
  );
}
