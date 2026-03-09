/**
 * Geocoding utility — resolves addresses to lat/lng using OpenRouteService.
 *
 * Used by:
 * - Client location create/update paths (auto-geocode on save)
 * - Backfill endpoint for existing locations missing coordinates
 *
 * Returns [lat, lng] as strings (matching numeric(10,7) schema) or null.
 */

const ORS_BASE = "https://api.openrouteservice.org";

/** Geocode an address to [lat, lng] strings, or null if unresolvable. */
export async function geocodeToLatLng(
  address?: string | null,
  city?: string | null,
  province?: string | null,
  postalCode?: string | null,
): Promise<{ lat: string; lng: string } | null> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) return null;

  const parts = [address, city, province, postalCode].filter(Boolean);
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
 * If the record has an address but no lat/lng, attempt geocoding.
 * Returns the original data merged with geocoded coords (if resolved).
 * Does NOT overwrite existing lat/lng.
 */
export async function maybeGeocode<
  T extends { lat?: string | null; lng?: string | null; address?: string | null; city?: string | null; province?: string | null; postalCode?: string | null },
>(data: T): Promise<T> {
  // Already has coordinates — skip
  if (data.lat && data.lng) return data;

  const coords = await geocodeToLatLng(data.address, data.city, data.province, data.postalCode);
  if (coords) {
    return { ...data, lat: coords.lat, lng: coords.lng };
  }
  return data;
}
