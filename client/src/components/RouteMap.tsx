import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, CircleMarker, useMap } from "react-leaflet";
import { LatLngExpression, LatLngBounds } from "leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLiveTechnicians, type LiveTechnician } from "@/hooks/useLiveTechnicians";

interface Client {
  id: string;
  companyName: string;
}

interface GeocodedClient {
  clientId: string;
  coordinates: [number, number]; // [longitude, latitude]
  address: string;
}

interface RouteMapProps {
  clients: Client[];
  geocodedClients: GeocodedClient[];
  startingCoordinates?: [number, number]; // [longitude, latitude]
  /** Show live technician markers (Phase 4B) */
  showLiveTechnicians?: boolean;
}

// Component to fit map bounds to all markers
function FitBounds({ bounds }: { bounds: LatLngBounds }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  
  return null;
}

export function RouteMap({ clients, geocodedClients, startingCoordinates, showLiveTechnicians = true }: RouteMapProps) {
  // Phase 4B: Live technician positions (auto-refresh 15s)
  const { data: liveTechnicians = [] } = useLiveTechnicians(showLiveTechnicians);
  // Convert [lng, lat] to [lat, lng] for Leaflet
  const positions: LatLngExpression[] = geocodedClients.map(gc => [gc.coordinates[1], gc.coordinates[0]]);
  
  // Calculate all points including starting location for proper map centering
  const allPoints: LatLngExpression[] = startingCoordinates 
    ? [[startingCoordinates[1], startingCoordinates[0]], ...positions]
    : positions;
  
  // Calculate center and bounds
  let center: LatLngExpression = [43.6532, -79.3832]; // Default to Toronto
  let bounds: LatLngBounds | null = null;
  
  if (allPoints.length > 0) {
    // Calculate geographic center
    const latSum = allPoints.reduce((sum, point) => sum + (point as number[])[0], 0);
    const lngSum = allPoints.reduce((sum, point) => sum + (point as number[])[1], 0);
    center = [latSum / allPoints.length, lngSum / allPoints.length];
    
    // Create bounds to fit all points
    bounds = new L.LatLngBounds(allPoints as [number, number][]);
  }

  // Route points for polyline
  const routePoints = allPoints;

  return (
    <div className="w-full h-[400px] rounded-md overflow-hidden border" data-testid="map-route">
      <MapContainer
        center={center}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        {bounds && <FitBounds bounds={bounds} />}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Starting location marker */}
        {startingCoordinates && (
          <Marker 
            position={[startingCoordinates[1], startingCoordinates[0]]}
            icon={createStartIcon()}
          >
            <Popup>
              <div className="text-sm font-medium">Starting Location</div>
            </Popup>
          </Marker>
        )}

        {/* Client markers */}
        {geocodedClients.map((gc, index) => {
          const client = clients.find(c => c.id === gc.clientId);
          return (
            <Marker
              key={gc.clientId}
              position={[gc.coordinates[1], gc.coordinates[0]]}
              icon={createNumberedIcon(index + 1)}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-medium">{client?.companyName}</div>
                  <div className="text-xs text-muted-foreground">{gc.address}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Phase 4B: Live technician markers */}
        {liveTechnicians.map((tech: LiveTechnician) => {
          const lat = parseFloat(tech.lat);
          const lng = parseFloat(tech.lng);
          if (isNaN(lat) || isNaN(lng)) return null;
          const ago = tech.lastSeenAt
            ? formatTimeAgo(new Date(tech.lastSeenAt))
            : "Unknown";
          return (
            <CircleMarker
              key={tech.technicianId}
              center={[lat, lng]}
              radius={8}
              pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent={false}>
                <div className="text-xs">
                  <div className="font-medium">{tech.name}</div>
                  <div className="text-muted-foreground">{ago}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Route line */}
        {routePoints.length > 1 && (
          <Polyline
            positions={routePoints}
            pathOptions={{
              color: '#3b82f6',
              weight: 3,
              opacity: 0.7
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}

/** Format a timestamp as relative time (e.g., "2m ago") */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Helper function to create numbered marker icon
function createNumberedIcon(number: number) {
  return new L.DivIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #3b82f6;
        color: white;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 14px;
        border: 3px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      ">${number}</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

// Helper function to create starting location icon
function createStartIcon() {
  return new L.DivIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background-color: #22c55e;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 4px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      ">
        <div style="
          background-color: white;
          border-radius: 50%;
          width: 12px;
          height: 12px;
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}
