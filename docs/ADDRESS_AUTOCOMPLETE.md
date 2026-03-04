# Google Places Address Autocomplete

## Overview

The `AddressAutocomplete` component provides Google Places-powered street address entry. When a user types an address, Google Places suggestions appear in a dropdown. Selecting a suggestion auto-fills street, city, province, postal code, country, and stores lat/lng + place_id for geocoding.

## Required Environment Variable

```
VITE_GOOGLE_PLACES_API_KEY=your-api-key-here
```

This must be set in the Vite build environment (e.g., `.env` file or deployment env). The `VITE_` prefix makes it available to client-side code via `import.meta.env`.

## Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the **Places API** (and **Maps JavaScript API** if not already enabled)
4. Create an API key under **Credentials**
5. Restrict the key:
   - **Application restriction**: HTTP referrers
   - Add your domains (e.g., `https://yourdomain.com/*`, `http://localhost:*`)
   - **API restriction**: Restrict to "Maps JavaScript API" and "Places API"

## Fallback Behavior

The component degrades gracefully:

| Condition | Behavior |
|-----------|----------|
| `VITE_GOOGLE_PLACES_API_KEY` not set | Plain text input, no suggestions, console warning |
| Google Maps script fails to load (network, invalid key) | Plain text input, no suggestions, console warning |
| Script loads but Places API unavailable | Plain text input, no suggestions |
| Valid key + script loads | Full autocomplete with suggestions |

In all fallback cases, the form still works normally — users can type addresses manually and save.

## Architecture

### Script Loading

`client/src/lib/googleMapsLoader.ts` — Singleton promise that:
- Injects `<script src="https://maps.googleapis.com/maps/api/js?key=...&libraries=places">` into `<head>`
- Resolves to `true` when `window.google.maps.places` is available
- Resolves to `false` on error (never rejects — graceful degradation)
- Only loads once per page session

### Component

`client/src/components/ui/AddressAutocomplete.tsx`

Props:
- `value` / `onChange` — controlled string (mirrors shadcn Input)
- `onPlaceSelect(payload)` — fires when user selects a suggestion
- `countryRestrictions` — defaults to `["ca", "us"]`
- `placeholder`, `disabled`, `className`, `id` — standard input props

Payload shape (`PlaceSelectPayload`):
```typescript
{
  street: string;           // "100 Ahrens St W"
  city: string;             // "Kitchener"
  province: string;         // "ON" (short_name)
  postalCode: string;       // "N2H 4C3"
  country: string;          // "Canada"
  lat?: number;             // 43.4516395
  lng?: number;             // -80.4925337
  placeId?: string;         // "ChIJ..."
  formattedAddress?: string; // "100 Ahrens St W, Kitchener, ON N2H 4C3, Canada"
}
```

### Database Columns

Added to `client_locations`:
- `country` (text, nullable)
- `lat` (numeric(10,7), nullable)
- `lng` (numeric(10,7), nullable)
- `place_id` (text, nullable)

Added to `supplier_locations`:
- `lat` (numeric(10,7), nullable)
- `lng` (numeric(10,7), nullable)
- `place_id` (text, nullable)

All nullable — existing records unaffected.

### Route Optimization

`server/routeOptimizationService.ts` checks for persisted lat/lng before calling OpenRouteService:
- If `client.lat` and `client.lng` exist → use directly (no API call, no rate-limit delay)
- Otherwise → fall back to ORS geocoding (existing behavior)

## Current Integration

Phase 1 integrates autocomplete into **one form only**:
- `client/src/components/LocationFormModal.tsx` — Create/Edit location under a customer company

## Extending to Other Forms

To add autocomplete to another address form:

```tsx
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";

<AddressAutocomplete
  value={street}
  onChange={setStreet}
  onPlaceSelect={(place: PlaceSelectPayload) => {
    setStreet(place.street);
    setCity(place.city);
    setProvince(place.province);
    setPostalCode(place.postalCode);
    setCountry(place.country);
    setLat(place.lat != null ? String(place.lat) : null);
    setLng(place.lng != null ? String(place.lng) : null);
    setPlaceId(place.placeId || null);
  }}
/>
```

Ensure the form's save payload includes `lat`, `lng`, `placeId`, and `country` fields.

## TypeScript

`@types/google.maps` is installed as a dev dependency. The `tsconfig.json` `types` array includes `"google.maps"` to make the `google.maps.places` namespace available globally.
