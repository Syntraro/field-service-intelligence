/**
 * Geocoding utility — resolves addresses to lat/lng using OpenRouteService.
 *
 * Used by:
 * - Client location create/update paths (auto-geocode on save)
 * - Backfill endpoint for existing locations missing coordinates
 *
 * Returns [lat, lng] as strings (matching numeric(10,7) schema) or null.
 *
 * 2026-03-31: Added country parameter to disambiguate province abbreviations
 * (e.g., "Ont" → Ontario, Canada instead of Ontario, California).
 * Added Canada bounds guard in maybeGeocode to reject obviously bad coordinates.
 */

const ORS_BASE = "https://api.openrouteservice.org";

// Broad Canada bounding box: lat 41.7–83.1, lng -141.0–-52.6
const CANADA_LAT_MIN = 41.7;
const CANADA_LAT_MAX = 83.1;
const CANADA_LNG_MIN = -141.0;
const CANADA_LNG_MAX = -52.6;

/** Check if coordinates fall within broad Canada bounds */
function isWithinCanadaBounds(lat: number, lng: number): boolean {
  return lat >= CANADA_LAT_MIN && lat <= CANADA_LAT_MAX
    && lng >= CANADA_LNG_MIN && lng <= CANADA_LNG_MAX;
}

/** Geocode an address to [lat, lng] strings, or null if unresolvable. */
export async function geocodeToLatLng(
  address?: string | null,
  city?: string | null,
  province?: string | null,
  postalCode?: string | null,
  country?: string | null,
): Promise<{ lat: string; lng: string } | null> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) return null;

  const parts = [address, city, province, postalCode, country].filter(Boolean);
  if (parts.length === 0) return null;

  const fullAddress = parts.join(", ");

  try {
    const res = await fetch(
      `${ORS_BASE}/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(fullAddress)}&size=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates; // GeoJSON: [lng, lat]
      return { lat: lat.toFixed(7), lng: lng.toFixed(7) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * If the record has no lat/lng (or has obviously invalid coordinates for
 * Canadian addresses), attempt geocoding. Returns the original data merged
 * with geocoded coords (if resolved).
 */
export async function maybeGeocode<
  T extends { lat?: string | null; lng?: string | null; address?: string | null; city?: string | null; province?: string | null; postalCode?: string | null; country?: string | null },
>(data: T): Promise<T> {
  let needsGeocode = !data.lat || !data.lng;

  // Guard: if country looks Canadian and existing coordinates are outside Canada bounds,
  // discard them and re-geocode rather than preserving obviously bad data.
  if (!needsGeocode && data.lat && data.lng) {
    const countryLower = (data.country ?? "").toLowerCase().trim();
    const isCanadian = countryLower === "canada" || countryLower === "ca";
    if (isCanadian) {
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);
      if (!isNaN(lat) && !isNaN(lng) && !isWithinCanadaBounds(lat, lng)) {
        needsGeocode = true;
      }
    }
  }

  if (!needsGeocode) return data;

  const coords = await geocodeToLatLng(data.address, data.city, data.province, data.postalCode, data.country);
  if (coords) {
    return { ...data, lat: coords.lat, lng: coords.lng };
  }
  return data;
}
