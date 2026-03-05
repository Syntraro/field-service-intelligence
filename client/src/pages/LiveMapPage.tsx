/**
 * LiveMapPage — Standalone live technician map (Phase 4B, 2026-03-05)
 *
 * Full-screen Leaflet map showing live technician positions.
 * Auto-refreshes every 15 seconds via useLiveTechnicians hook.
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { LatLngBounds } from "leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLiveTechnicians, type LiveTechnician } from "@/hooks/useLiveTechnicians";
import { TablePageShell } from "@/components/ui/table-page-shell";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

/** Fit map bounds to visible technician positions */
function FitToBounds({ technicians }: { technicians: LiveTechnician[] }) {
  const map = useMap();

  useEffect(() => {
    const points = technicians
      .map(t => [parseFloat(t.lat), parseFloat(t.lng)] as [number, number])
      .filter(([lat, lng]) => !isNaN(lat) && !isNaN(lng));

    if (points.length > 0) {
      const bounds = new L.LatLngBounds(points);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
      }
    }
  }, [technicians.length]); // Re-fit only when count changes

  return null;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function LiveMapPage() {
  const { data: technicians = [], isLoading } = useLiveTechnicians();

  return (
    <TablePageShell
      title="Live Map"
      actions={
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Badge variant="outline">
            {technicians.length} technician{technicians.length !== 1 ? "s" : ""} online
          </Badge>
        </div>
      }
    >
      <div className="flex-1 min-h-0 rounded-md overflow-hidden border" style={{ height: "calc(100vh - 140px)" }}>
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

          <FitToBounds technicians={technicians} />

          {technicians.map((tech) => {
            const lat = parseFloat(tech.lat);
            const lng = parseFloat(tech.lng);
            if (isNaN(lat) || isNaN(lng)) return null;
            const ago = tech.lastSeenAt ? formatTimeAgo(new Date(tech.lastSeenAt)) : "Unknown";

            const isOnline = tech.online !== false;
            return (
              <CircleMarker
                key={tech.technicianId}
                center={[lat, lng]}
                radius={10}
                pathOptions={{
                  color: isOnline ? '#2563eb' : '#9ca3af',
                  fillColor: isOnline ? '#3b82f6' : '#d1d5db',
                  fillOpacity: isOnline ? 0.9 : 0.6,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} permanent={false}>
                  <div style={{ fontSize: '12px' }}>
                    <div style={{ fontWeight: 600 }}>{tech.name}</div>
                    <div style={{ color: isOnline ? '#16a34a' : '#9ca3af' }}>
                      {isOnline ? 'Online' : 'Offline'} — {ago}
                    </div>
                    {tech.speed && parseFloat(tech.speed) > 0 && (
                      <div style={{ color: '#6b7280' }}>{parseFloat(tech.speed).toFixed(0)} km/h</div>
                    )}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-blue-600" />
          Online (&lt;5 min)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-gray-400" />
          Offline
        </div>
        <span>Auto-refreshes every 15s</span>
      </div>
    </TablePageShell>
  );
}
