/**
 * DispatchMapPanel — Read-only map visualization of dispatch visits.
 *
 * Pure presentation component: consumes DispatchVisit[] (with lat/lng)
 * from the existing calendar query. No data fetching, no polling, no mutations.
 *
 * 2026-03-31: Created for dispatch map integration. Uses same data source
 * as DispatchTimeline/WeekDispatchGrid — no parallel queries.
 * 2026-03-31: Added hover linkage — hoveredVisitId highlights marker,
 * onHoverVisit propagates marker hover back to calendar.
 * 2026-04-02: Added "Show Routes" — draws per-technician polylines + stop
 * numbers from visible scheduled visits ordered by scheduledStart.
 */
import { useMemo, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline, useMap } from "react-leaflet";
import { LatLngBounds, divIcon } from "leaflet";
import { Marker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { DispatchVisit, Technician } from "./dispatchPreviewTypes";
import type { LiveTechnician } from "@/hooks/useLiveTechnicians";
import { formatDuration } from "./dispatchPreviewUtils";
import { useDispatchHover } from "./dispatchHoverContext";
import { format } from "date-fns";

interface DispatchMapPanelProps {
  visits: DispatchVisit[];
  technicians: Technician[];
  liveTechnicians?: LiveTechnician[];
  isDragging: boolean;
  /** When true, draw per-technician route polylines and stop-order numbers */
  showRoutes?: boolean;
}

/** Parsed visit with valid numeric coordinates */
interface PlottableVisit {
  visit: DispatchVisit;
  lat: number;
  lng: number;
}

/** Per-technician route: ordered stops with coordinates for polyline + stop numbers */
interface TechRoute {
  techId: string;
  color: string;
  stops: { lat: number; lng: number; stopNumber: number }[];
}

/**
 * MapViewportController — auto-fits map to visible markers only when the
 * plotted set materially changes. Uses a stable coordinate signature to avoid
 * fighting user pan/zoom on minor rerenders.
 *
 * 2026-04-02: Replaces naive FitBounds that refired on every bounds object change.
 */
function MapViewportController({ plottable }: { plottable: PlottableVisit[] }) {
  const map = useMap();
  const prevSignatureRef = useRef<string>("");

  // Build a stable signature from sorted visit IDs + rounded coords so we only
  // refit when the actual set of visible plotted points changes.
  const signature = useMemo(() => {
    if (plottable.length === 0) return "";
    return plottable
      .map((p) => `${p.visit.id}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .sort()
      .join("|");
  }, [plottable]);

  useEffect(() => {
    if (signature === prevSignatureRef.current) return;
    prevSignatureRef.current = signature;

    if (plottable.length === 0) return; // No markers — keep existing fallback view

    if (plottable.length === 1) {
      // Single marker — center with a practical dispatch-level zoom
      map.setView([plottable[0].lat, plottable[0].lng], 15);
      return;
    }

    // 2+ markers — fit bounds with padding and a sensible max zoom cap
    const bounds = new LatLngBounds(plottable.map((p) => [p.lat, p.lng] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [map, signature, plottable]);

  return null;
}

/** Create a small numbered circle icon for stop-order display */
function stopIcon(num: number, color: string) {
  return divIcon({
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${num}</div>`,
  });
}

export default function DispatchMapPanel({
  visits,
  technicians,
  liveTechnicians,
  isDragging,
  showRoutes,
}: DispatchMapPanelProps) {
  const { hoveredVisitId, setHoveredVisitId } = useDispatchHover();
  // Build technician color lookup
  const techColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of technicians) {
      m.set(t.id, t.color);
    }
    return m;
  }, [technicians]);

  // Filter visits with valid coordinates
  const plottable = useMemo<PlottableVisit[]>(() => {
    const result: PlottableVisit[] = [];
    for (const v of visits) {
      if (!v.lat || !v.lng) continue;
      const lat = parseFloat(v.lat);
      const lng = parseFloat(v.lng);
      if (isNaN(lat) || isNaN(lng)) continue;
      result.push({ visit: v, lat, lng });
    }
    return result;
  }, [visits]);

  // Build per-technician routes: group plottable assigned visits by tech, sort by scheduledStart
  const techRoutes = useMemo<TechRoute[]>(() => {
    if (!showRoutes) return [];
    // Group by technician — skip unassigned visits
    const byTech = new Map<string, PlottableVisit[]>();
    for (const p of plottable) {
      // 2026-04-19: derive the route-anchor tech from the canonical crew array.
      // Route plotting is a single-line-per-tech view; multi-tech visits use
      // their primary (first) tech as the anchor, matching prior behavior.
      const tid = p.visit.technicianIds[0] ?? null;
      if (!tid) continue; // Skip unassigned
      if (!byTech.has(tid)) byTech.set(tid, []);
      byTech.get(tid)!.push(p);
    }
    const routes: TechRoute[] = [];
    Array.from(byTech.entries()).forEach(([techId, stops]) => {
      if (stops.length < 2) return; // No route line for 0-1 stops
      // Sort by scheduledStart — same chronological order the board uses
      stops.sort((a: PlottableVisit, b: PlottableVisit) => {
        const aTime = a.visit.scheduledStart ?? "";
        const bTime = b.visit.scheduledStart ?? "";
        return aTime.localeCompare(bTime);
      });
      const color = techColorMap.get(techId) ?? "#6b7280";
      routes.push({
        techId,
        color,
        stops: stops.map((s: PlottableVisit, i: number) => ({ lat: s.lat, lng: s.lng, stopNumber: i + 1 })),
      });
    });
    return routes;
  }, [showRoutes, plottable, techColorMap]);


  const handleMarkerEnter = useCallback((visitId: string) => {
    setHoveredVisitId(visitId);
  }, [setHoveredVisitId]);

  const handleMarkerLeave = useCallback(() => {
    setHoveredVisitId(null);
  }, [setHoveredVisitId]);

  return (
    <div
      className={`h-full w-full ${isDragging ? "pointer-events-none" : ""}`}
      style={{ minHeight: 200, position: "relative", zIndex: 0, isolation: "isolate" }}
    >
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
        <MapViewportController plottable={plottable} />

        {/* Visit markers — completed visits excluded at source (mapVisits in DispatchPreview) */}
        {plottable.map(({ visit, lat, lng }) => {
          // 2026-04-19: marker color anchors on primary tech derived from the
          // canonical crew array (technicianIds[0]). Unassigned → neutral gray.
          const primaryTechId = visit.technicianIds[0] ?? null;
          const techColor = primaryTechId
            ? techColorMap.get(primaryTechId) ?? "#6b7280"
            : "#6b7280";
          const isHovered = hoveredVisitId === visit.id;
          const timeStr = visit.scheduledStart
            ? format(new Date(visit.scheduledStart), "h:mm a")
            : "";

          return (
            <CircleMarker
              key={`dv-${visit.id}`}
              center={[lat, lng]}
              radius={isHovered ? 11 : 7}
              pathOptions={{
                color: isHovered ? "#059669" : techColor,
                fillColor: isHovered ? "#10b981" : techColor,
                fillOpacity: isHovered ? 0.95 : 0.7,
                weight: isHovered ? 3 : 1.5,
              }}
              eventHandlers={{
                mouseover: () => handleMarkerEnter(visit.id),
                mouseout: () => handleMarkerLeave(),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <div style={{ fontSize: "11px" }}>
                  <div style={{ fontWeight: 600 }}>{visit.customerName}</div>
                  {visit.locationName !== visit.customerName && (
                    <div style={{ color: "#6b7280" }}>{visit.locationName}</div>
                  )}
                  <div style={{ color: "#6b7280" }}>
                    {timeStr}{timeStr && " · "}{formatDuration(visit.durationMinutes)}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Live technician markers (GPS overlay) */}
        {liveTechnicians?.map((tech) => {
          if (!tech.lat || !tech.lng) return null;
          const lat = parseFloat(tech.lat);
          const lng = parseFloat(tech.lng);
          if (isNaN(lat) || isNaN(lng)) return null;
          const color = techColorMap.get(tech.technicianId) ?? "#9ca3af";

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
                    {tech.online ? "Online" : "Offline"}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/*
         * Route polylines + stop numbers — rendered when showRoutes is on.
         *
         * ROUTE AUDIT (2026-04-02): These are STRAIGHT-LINE Polyline segments
         * between stop coordinates, NOT road-following geometry. No client-side
         * routing library (leaflet-routing-machine, OSRM, etc.) is installed.
         * The server has an OpenRouteService integration
         * (server/routeOptimizationService.ts) for stop-order optimization and
         * geocoding, but it does not return turn-by-turn polyline geometry.
         *
         * To upgrade to road-following routes in a future pass:
         * 1. Use ORS Directions API (already have API key) to fetch encoded
         *    polyline geometry between consecutive stops per technician.
         * 2. Decode the polyline and pass the full coordinate array to <Polyline>.
         * 3. Cache/memoize geometry to avoid repeated API calls on rerenders.
         * 4. Consider a server-side proxy to keep the ORS API key off the client.
         */}
        {techRoutes.map((route) => (
          <Polyline
            key={`route-${route.techId}`}
            positions={route.stops.map((s) => [s.lat, s.lng] as [number, number])}
            pathOptions={{ color: route.color, weight: 3, opacity: 0.6, dashArray: "8 6" }}
          />
        ))}
        {techRoutes.flatMap((route) =>
          route.stops.map((stop) => (
            <Marker
              key={`stop-${route.techId}-${stop.stopNumber}`}
              position={[stop.lat, stop.lng]}
              icon={stopIcon(stop.stopNumber, route.color)}
              interactive={false}
            />
          ))
        )}
      </MapContainer>
    </div>
  );
}
