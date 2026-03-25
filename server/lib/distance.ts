/**
 * Canonical distance and travel-time utilities.
 *
 * Single source of truth for haversine distance and travel estimation.
 * All server-side distance calculations must import from this file.
 */

/** Haversine distance in meters between two lat/lng points. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Cheap travel time estimate: 2 min per km (approx 30 km/h city driving). Minimum 5 min. */
export function estimateTravelMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const distM = haversineMeters(lat1, lng1, lat2, lng2);
  return Math.max(5, Math.round((distM / 1000) * 2));
}
