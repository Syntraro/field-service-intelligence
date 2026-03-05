/**
 * LiveMapPage — Dispatch-grade live map with techs, visits, and panel.
 *
 * Phase 4B → Upgraded 2026-03-05:
 * - Split layout: map (left) + dispatch panel (right, collapsible)
 * - Technician circle markers (colored by tech, online/offline opacity)
 * - Visit circle markers (numbered by tech sequence, "?" for unassigned)
 * - Right panel grouped by technician with visit list
 * - Technician multi-select filter popover (replaces simple toggle)
 * - Toggles: Show Visits / Show Unassigned
 * - Focus mode: click tech header to filter map to that tech
 * - Auto-refreshes every 15 seconds
 * - Date computed server-side in company timezone (America/Toronto default)
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  MapPin,
  Users,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface MapTechnician {
  technicianId: string;
  name: string;
  lat: string;
  lng: string;
  online: boolean;
  lastSeenAt: string;
}

interface MapVisit {
  visitId: string;
  technicianId: string | null;
  locationName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes?: number;
  lat: string | null;
  lng: string | null;
  status: string;
  source?: "visit" | "job_fallback";
  risk: {
    late?: boolean;
    overdue?: boolean;
    runningLong?: boolean;
  };
}

/** Helper: does this visit have usable map coordinates? */
function hasCoords(v: MapVisit): boolean {
  if (!v.lat || !v.lng) return false;
  const lat = parseFloat(v.lat);
  const lng = parseFloat(v.lng);
  return !isNaN(lat) && !isNaN(lng);
}

interface MapDayData {
  date: string;
  timezone?: string;
  technicians: MapTechnician[];
  visits: MapVisit[];
  meta?: {
    jobFallbackCount?: number;
    visitsTotal?: number;
    visitsWithCoords?: number;
    visitsMissingCoords?: number;
  };
}

// ============================================================================
// Hooks
// ============================================================================

/** Fetch map day data — date left blank so server uses company-timezone today. */
function useMapDay(date?: string) {
  return useQuery<MapDayData>({
    queryKey: ["/api/map/day", date || "today"],
    queryFn: async () => {
      const qs = date ? `?date=${date}` : "";
      const res = await fetch(`/api/map/day${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch map data");
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

// ============================================================================
// localStorage persistence for map preferences
// ============================================================================

const MAP_PREFS_KEY = "liveMapPreferences";

interface MapPreferences {
  selectedTechnicianIds: string[];
  showVisits: boolean;
  showUnassigned: boolean;
  panelOpen: boolean;
}

function loadMapPreferences(): MapPreferences {
  try {
    const raw = localStorage.getItem(MAP_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        selectedTechnicianIds: Array.isArray(parsed.selectedTechnicianIds) ? parsed.selectedTechnicianIds : [],
        showVisits: parsed.showVisits !== false,
        showUnassigned: parsed.showUnassigned !== false,
        panelOpen: parsed.panelOpen !== false,
      };
    }
  } catch { /* ignore */ }
  return { selectedTechnicianIds: [], showVisits: true, showUnassigned: true, panelOpen: true };
}

function saveMapPreferences(prefs: MapPreferences) {
  try { localStorage.setItem(MAP_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const TECH_COLORS = [
  "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2",
  "#be123c", "#4f46e5", "#059669", "#c026d3", "#d97706",
];

function getTechColor(index: number): string {
  return TECH_COLORS[index % TECH_COLORS.length];
}

// ============================================================================
// Map sub-components
// ============================================================================

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = new L.LatLngBounds(points);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [points.length]);
  return null;
}

let mapInstance: L.Map | null = null;

function MapRefCapture() {
  const map = useMap();
  useEffect(() => { mapInstance = map; }, [map]);
  return null;
}

function panToPoint(lat: number, lng: number, zoom = 15) {
  mapInstance?.flyTo([lat, lng], zoom, { duration: 0.5 });
}

// ============================================================================
// Risk badges
// ============================================================================

function RiskBadges({ risk }: { risk: MapVisit["risk"] }) {
  if (!risk.late && !risk.overdue && !risk.runningLong) return null;
  return (
    <span className="inline-flex gap-0.5 ml-1">
      {risk.late && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3.5">Late</Badge>}
      {risk.overdue && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3.5">Overdue</Badge>}
      {risk.runningLong && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Long</Badge>}
    </span>
  );
}

// ============================================================================
// TechnicianFilterPopover — multi-select with search + quick actions
// ============================================================================

function TechnicianFilterPopover({
  technicians,
  techColorMap,
  selectedIds,
  onChangeSelected,
}: {
  technicians: MapTechnician[];
  techColorMap: Map<string, { color: string; index: number }>;
  selectedIds: Set<string>;
  onChangeSelected: (ids: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return technicians;
    const q = search.toLowerCase();
    return technicians.filter((t) => t.name.toLowerCase().includes(q));
  }, [technicians, search]);

  // Empty selectedIds = show all (no filter active)
  const allSelected = selectedIds.size === 0;

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChangeSelected(next);
  };

  const selectAll = () => onChangeSelected(new Set());
  const selectNone = () => onChangeSelected(new Set(["__none__"])); // sentinel: explicitly none
  const selectOnline = () => onChangeSelected(new Set(technicians.filter((t) => t.online).map((t) => t.technicianId)));
  const selectOffline = () => onChangeSelected(new Set(technicians.filter((t) => !t.online).map((t) => t.technicianId)));

  const activeCount = allSelected ? technicians.length : selectedIds.size;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Technicians{" "}
          {allSelected
            ? `(${technicians.length})`
            : `(${activeCount}/${technicians.length})`
          }
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 z-[9999]" align="end">
        {/* Search */}
        <Input
          placeholder="Search technicians..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs mb-2"
        />

        {/* Quick actions */}
        <div className="flex items-center gap-1 mb-2 px-1">
          <button onClick={selectAll} className="text-[11px] text-primary hover:underline">All</button>
          <span className="text-[11px] text-muted-foreground">/</span>
          <button onClick={selectNone} className="text-[11px] text-primary hover:underline">None</button>
          <span className="text-[11px] text-muted-foreground ml-1">/</span>
          <button onClick={selectOnline} className="text-[11px] text-primary hover:underline ml-1">Online</button>
          <span className="text-[11px] text-muted-foreground">/</span>
          <button onClick={selectOffline} className="text-[11px] text-primary hover:underline">Offline</button>
        </div>

        {/* Technician checkboxes */}
        <div className="space-y-0.5 max-h-[320px] overflow-y-auto">
          {filtered.map((tech) => {
            const tc = techColorMap.get(tech.technicianId);
            const isChecked = allSelected || selectedIds.has(tech.technicianId);
            return (
              <label
                key={tech.technicianId}
                className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggle(tech.technicianId)}
                />
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: tc?.color || "#9ca3af" }}
                />
                <span className="text-xs font-medium flex-1 truncate">{tech.name}</span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tech.online ? 'bg-green-500' : 'bg-gray-300'}`} />
              </label>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">No match</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Dispatch Panel
// ============================================================================

function DispatchPanel({
  technicians,
  visits,
  techColorMap,
  focusTechId,
  onFocusTech,
  onClickVisit,
  jobFallbackCount,
}: {
  technicians: MapTechnician[];
  visits: MapVisit[];
  techColorMap: Map<string, { color: string; index: number }>;
  focusTechId: string | null;
  onFocusTech: (id: string | null) => void;
  onClickVisit: (v: MapVisit) => void;
  jobFallbackCount: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, MapVisit[]>();
    for (const v of visits) {
      const key = v.technicianId || "__unassigned__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return map;
  }, [visits]);

  const sortedTechs = useMemo(() =>
    [...technicians].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
  [technicians]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const unassignedVisits = grouped.get("__unassigned__") || [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b bg-background font-semibold text-sm flex items-center gap-2">
        <MapPin className="h-4 w-4" />
        Dispatch
        <Badge variant="secondary" className="text-[10px] ml-auto">
          {visits.length} visits
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {/* Technician groups */}
        {sortedTechs.map((tech) => {
          const techVisits = grouped.get(tech.technicianId) || [];
          const tc = techColorMap.get(tech.technicianId);
          const isCollapsed = collapsed.has(tech.technicianId);
          const isFocused = focusTechId === tech.technicianId;

          return (
            <div key={tech.technicianId} className={isFocused ? "bg-primary/5" : ""}>
              <div
                className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer hover:bg-muted/50"
                onClick={() => onFocusTech(isFocused ? null : tech.technicianId)}
              >
                <button
                  className="shrink-0"
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(tech.technicianId); }}
                >
                  {isCollapsed
                    ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                </button>
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0 border"
                  style={{ backgroundColor: tc?.color || "#9ca3af", borderColor: tc?.color || "#9ca3af" }}
                />
                <span className="text-xs font-medium truncate flex-1">{tech.name}</span>
                <span className={`text-[10px] ${tech.online ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {tech.online ? "Online" : "Offline"}
                </span>
                {techVisits.length > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1 h-4">{techVisits.length}</Badge>
                )}
              </div>

              {!isCollapsed && techVisits.map((visit, vi) => {
                const visitHasCoords = hasCoords(visit);
                return (
                  <div
                    key={visit.visitId}
                    className={`flex items-center gap-2 px-3 py-1.5 pl-8 border-b border-dashed text-xs ${
                      visitHasCoords ? 'cursor-pointer hover:bg-muted/30' : 'cursor-default'
                    }`}
                    onClick={() => visitHasCoords && onClickVisit(visit)}
                    title={!visitHasCoords ? "Add address/lat-lng to map this visit" : undefined}
                  >
                    <span
                      className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: tc?.color || "#6b7280" }}
                    >
                      {vi + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">
                        {visit.locationName}
                        {visit.source === "job_fallback" && (
                          <span className="text-amber-500 ml-1" title="From jobs table (no visit record)">*</span>
                        )}
                      </div>
                      <div className="text-muted-foreground">
                        {formatTime(visit.scheduledStart)}
                        {visit.scheduledEnd ? ` – ${formatTime(visit.scheduledEnd)}` : ""}
                      </div>
                    </div>
                    {!visitHasCoords && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-amber-600 border-amber-300">No coords</Badge>
                    )}
                    <RiskBadges risk={visit.risk} />
                    {visit.status === "completed" && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">Done</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Unassigned section */}
        {unassignedVisits.length > 0 && (
          <div>
            <div
              className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer hover:bg-muted/50"
              onClick={() => toggleCollapse("__unassigned__")}
            >
              <button className="shrink-0">
                {collapsed.has("__unassigned__")
                  ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </button>
              <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-gray-400 border border-gray-400" />
              <span className="text-xs font-medium flex-1">Unassigned</span>
              <Badge variant="outline" className="text-[10px] px-1 h-4">{unassignedVisits.length}</Badge>
            </div>

            {!collapsed.has("__unassigned__") && unassignedVisits.map((visit) => {
              const visitHasCoords = hasCoords(visit);
              return (
                <div
                  key={visit.visitId}
                  className={`flex items-center gap-2 px-3 py-1.5 pl-8 border-b border-dashed text-xs ${
                    visitHasCoords ? "cursor-pointer hover:bg-muted/30" : "cursor-default opacity-75"
                  }`}
                  onClick={() => visitHasCoords && onClickVisit(visit)}
                  title={!visitHasCoords ? "Add address/lat-lng to map this visit" : undefined}
                >
                  <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white bg-gray-400 shrink-0">
                    ?
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{visit.locationName}</div>
                    <div className="text-muted-foreground">
                      {formatTime(visit.scheduledStart)}
                      {visit.scheduledEnd ? ` – ${formatTime(visit.scheduledEnd)}` : ""}
                    </div>
                  </div>
                  {!visitHasCoords && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 text-amber-600 border-amber-300">No coords</Badge>
                  )}
                  <RiskBadges risk={visit.risk} />
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state with job fallback hint */}
        {visits.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8 px-4">
            <div>No visits for today</div>
            {jobFallbackCount > 0 && (
              <div className="mt-2 text-xs flex items-center justify-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {jobFallbackCount} scheduled job{jobFallbackCount > 1 ? "s" : ""} exist but have no visit records yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function LiveMapPage() {
  // Let server compute "today" in company timezone when no date param is passed
  const { data, isLoading } = useMapDay();
  const technicians = data?.technicians || [];
  const visits = data?.visits || [];
  const jobFallbackCount = data?.meta?.jobFallbackCount || 0;

  // Load persisted preferences
  const [prefs, setPrefs] = useState<MapPreferences>(loadMapPreferences);

  const updatePrefs = useCallback((updates: Partial<MapPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...updates };
      saveMapPreferences(next);
      return next;
    });
  }, []);

  // Technician filter: empty set = show all
  const selectedTechIds = useMemo(() => new Set(prefs.selectedTechnicianIds), [prefs.selectedTechnicianIds]);
  const techFilterActive = selectedTechIds.size > 0 && !selectedTechIds.has("__none__");
  const techFilterNone = selectedTechIds.has("__none__");

  const setSelectedTechIds = useCallback((ids: Set<string>) => {
    updatePrefs({ selectedTechnicianIds: Array.from(ids) });
  }, [updatePrefs]);

  const [panelOpen, setPanelOpen] = useState(prefs.panelOpen);
  const [showVisits, setShowVisits] = useState(prefs.showVisits);
  const [showUnassigned, setShowUnassigned] = useState(prefs.showUnassigned);
  const [focusTechId, setFocusTechId] = useState<string | null>(null);

  // Persist toggle changes
  useEffect(() => { updatePrefs({ panelOpen }); }, [panelOpen]);
  useEffect(() => { updatePrefs({ showVisits }); }, [showVisits]);
  useEffect(() => { updatePrefs({ showUnassigned }); }, [showUnassigned]);

  // Build stable tech color map
  const techColorMap = useMemo(() => {
    const map = new Map<string, { color: string; index: number }>();
    technicians.forEach((t, i) => {
      map.set(t.technicianId, { color: getTechColor(i), index: i });
    });
    return map;
  }, [technicians]);

  // Tech filter predicate
  const isTechVisible = useCallback((techId: string): boolean => {
    if (techFilterNone) return false;
    if (!techFilterActive) return true; // no filter = all visible
    return selectedTechIds.has(techId);
  }, [selectedTechIds, techFilterActive, techFilterNone]);

  // Filter techs for map markers
  const visibleTechs = useMemo(() => {
    let filtered = technicians.filter((t) => t.lat && t.lng && isTechVisible(t.technicianId));
    if (focusTechId) filtered = filtered.filter((t) => t.technicianId === focusTechId);
    return filtered;
  }, [technicians, isTechVisible, focusTechId]);

  // Filter techs for panel (same filter, but without lat/lng check)
  const panelTechs = useMemo(() => {
    let filtered = technicians.filter((t) => isTechVisible(t.technicianId));
    if (focusTechId) filtered = filtered.filter((t) => t.technicianId === focusTechId);
    return filtered;
  }, [technicians, isTechVisible, focusTechId]);

  // Filter visits for map
  const visibleVisits = useMemo(() => {
    if (!showVisits) return [];
    let filtered = visits.filter((v) => v.lat && v.lng);
    // Apply tech filter to assigned visits
    filtered = filtered.filter((v) => {
      if (!v.technicianId) return showUnassigned;
      return isTechVisible(v.technicianId);
    });
    if (focusTechId) filtered = filtered.filter((v) => v.technicianId === focusTechId);
    return filtered;
  }, [visits, showVisits, showUnassigned, isTechVisible, focusTechId]);

  // Filter visits for panel (same logic, no lat/lng check)
  const panelVisits = useMemo(() => {
    let filtered = visits.filter((v) => {
      if (!v.technicianId) return showUnassigned;
      return isTechVisible(v.technicianId);
    });
    if (focusTechId) filtered = filtered.filter((v) => v.technicianId === focusTechId || !v.technicianId);
    return filtered;
  }, [visits, showUnassigned, isTechVisible, focusTechId]);

  // Build visit sequence per tech (for numbered labels)
  const visitSequence = useMemo(() => {
    const seq = new Map<string, number>();
    const techOrder = new Map<string, number>();
    for (const v of visits) {
      if (!v.technicianId) continue;
      const count = techOrder.get(v.technicianId) || 0;
      techOrder.set(v.technicianId, count + 1);
      seq.set(v.visitId, count + 1);
    }
    return seq;
  }, [visits]);

  // Fit bounds points
  const fitPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    for (const t of visibleTechs) {
      const lat = parseFloat(t.lat);
      const lng = parseFloat(t.lng);
      if (!isNaN(lat) && !isNaN(lng)) pts.push([lat, lng]);
    }
    for (const v of visibleVisits) {
      const lat = parseFloat(v.lat!);
      const lng = parseFloat(v.lng!);
      if (!isNaN(lat) && !isNaN(lng)) pts.push([lat, lng]);
    }
    return pts;
  }, [visibleTechs, visibleVisits]);

  const handleClickVisit = useCallback((v: MapVisit) => {
    if (v.lat && v.lng) panToPoint(parseFloat(v.lat), parseFloat(v.lng));
  }, []);

  const onlineCount = technicians.filter((t) => t.online).length;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Live Map</h1>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Badge variant="outline" className="text-xs">
            {onlineCount} online · {visits.length} visits
          </Badge>
          {focusTechId && (
            <Badge variant="default" className="text-xs cursor-pointer" onClick={() => setFocusTechId(null)}>
              Focused: {technicians.find(t => t.technicianId === focusTechId)?.name || "?"} ✕
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Technician multi-select filter */}
          <TechnicianFilterPopover
            technicians={technicians}
            techColorMap={techColorMap}
            selectedIds={selectedTechIds}
            onChangeSelected={setSelectedTechIds}
          />

          {/* Visit + Unassigned toggles */}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Switch checked={showVisits} onCheckedChange={setShowVisits} className="h-4 w-7" />
            <MapPin className="h-3 w-3" /> Visits
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Switch checked={showUnassigned} onCheckedChange={setShowUnassigned} className="h-4 w-7" />
            Unassigned
          </label>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPanelOpen(!panelOpen)}
            title={panelOpen ? "Collapse panel" : "Expand panel"}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Main content: map + panel */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 min-w-0">
          <MapContainer
            center={[43.6532, -79.3832]}
            zoom={11}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapRefCapture />
            <FitBounds points={fitPoints} />

            {/* Technician markers */}
            {visibleTechs.map((tech) => {
              const lat = parseFloat(tech.lat);
              const lng = parseFloat(tech.lng);
              if (isNaN(lat) || isNaN(lng)) return null;
              const tc = techColorMap.get(tech.technicianId);
              const color = tc?.color || "#9ca3af";
              const ago = tech.lastSeenAt ? formatTimeAgo(tech.lastSeenAt) : "Unknown";

              return (
                <CircleMarker
                  key={`tech-${tech.technicianId}`}
                  center={[lat, lng]}
                  radius={10}
                  pathOptions={{
                    color: tech.online ? color : "#9ca3af",
                    fillColor: tech.online ? color : "#d1d5db",
                    fillOpacity: tech.online ? 0.9 : 0.6,
                    weight: 2,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>
                    <div style={{ fontSize: "12px" }}>
                      <div style={{ fontWeight: 600 }}>{tech.name}</div>
                      <div style={{ color: tech.online ? "#16a34a" : "#9ca3af" }}>
                        {tech.online ? "Online" : "Offline"} — {ago}
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {/* Visit markers */}
            {visibleVisits.map((visit) => {
              const lat = parseFloat(visit.lat!);
              const lng = parseFloat(visit.lng!);
              if (isNaN(lat) || isNaN(lng)) return null;

              const tc = visit.technicianId ? techColorMap.get(visit.technicianId) : null;
              const seqNum = visitSequence.get(visit.visitId);
              const label = seqNum ? String(seqNum) : "?";
              const hasRisk = visit.risk.late || visit.risk.overdue || visit.risk.runningLong;
              const markerColor = hasRisk ? "#dc2626" : (tc?.color || "#6b7280");

              return (
                <CircleMarker
                  key={`visit-${visit.visitId}`}
                  center={[lat, lng]}
                  radius={7}
                  pathOptions={{
                    color: markerColor,
                    fillColor: markerColor,
                    fillOpacity: 0.7,
                    weight: 1.5,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -8]}>
                    <div style={{ fontSize: "11px" }}>
                      <div style={{ fontWeight: 600 }}>
                        {label}. {visit.locationName}
                        {visit.source === "job_fallback" && " *"}
                      </div>
                      <div style={{ color: "#6b7280" }}>
                        {formatTime(visit.scheduledStart)}
                        {visit.scheduledEnd ? ` – ${formatTime(visit.scheduledEnd)}` : ""}
                      </div>
                      {visit.status === "in_progress" && (
                        <div style={{ color: "#2563eb", fontWeight: 500 }}>In Progress</div>
                      )}
                      {visit.status === "completed" && (
                        <div style={{ color: "#16a34a", fontWeight: 500 }}>Completed</div>
                      )}
                      {hasRisk && (
                        <div style={{ color: "#dc2626", fontWeight: 500 }}>
                          {[
                            visit.risk.late && "Late",
                            visit.risk.overdue && "Overdue",
                            visit.risk.runningLong && "Running long",
                          ].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {visit.source === "job_fallback" && (
                        <div style={{ color: "#d97706", fontWeight: 500 }}>From job (no visit record)</div>
                      )}
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* Right panel */}
        {panelOpen && (
          <div className="w-[320px] border-l bg-background flex flex-col shrink-0">
            <DispatchPanel
              technicians={panelTechs}
              visits={panelVisits}
              techColorMap={techColorMap}
              focusTechId={focusTechId}
              onFocusTech={setFocusTechId}
              onClickVisit={handleClickVisit}
              jobFallbackCount={jobFallbackCount}
            />
          </div>
        )}
      </div>
    </div>
  );
}
