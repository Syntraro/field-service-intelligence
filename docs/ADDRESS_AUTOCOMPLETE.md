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

Autocomplete is integrated into all address forms:

| Form | Geo persistence (lat/lng/placeId) |
|------|-----------------------------------|
| `LocationFormModal.tsx` | Yes — service address |
| `QuickCreateDrawer.tsx` | Yes — service address |
| `NewAddClientDialog.tsx` | Yes — service address |
| `AddClientDialog.tsx` | Yes — service address |
| `EditClientDialog.tsx` | Yes — service address |
| `AddLocationDialog.tsx` (suppliers) | Yes — supplier location |
| `EditLocationDialog.tsx` (suppliers) | Yes — supplier location |
| `NewClientPage.tsx` — primary + additional locations | Yes — service addresses |
| `NewClientPage.tsx` — billing address | **No** — autocomplete fills fields but no geo columns for billing |
| `CompanySettingsPage.tsx` | **No** — company settings has no geo columns |

### Billing vs Service Address Persistence

The `full-create` endpoint (`POST /api/clients/full-create`) passes `lat`/`lng`/`placeId`/`country` for service addresses (primary + additional locations). Billing address only stores `street`/`city`/`province`/`postalCode`/`country` — no geo columns exist on the `customer_companies` table.

### React Hook Form Adapter

For forms using React Hook Form, use `AddressAutocompleteField`:

```tsx
import AddressAutocompleteField from "@/components/ui/AddressAutocompleteField";

// Inside a <Form> (FormProvider) context:
<AddressAutocompleteField
  name="address"
  label="Street Address"
  placeholder="123 Main St"
  fieldMapping={{
    city: "city",
    province: "provinceState",  // maps Places "province" to your RHF field name
    postalCode: "postalCode",
  }}
/>
```

The adapter uses `useFormContext()` + `Controller` internally, so it must be rendered inside a `<Form>` wrapper.

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

## Postal Code Validation (Phase 3)

All postal code fields are validated and normalized at the API boundary:

| Format | Example | Accepted | Normalized to |
|--------|---------|----------|---------------|
| Canadian | `m5v1e3` | Yes | `M5V 1E3` |
| Canadian with space | `M5V 1E3` | Yes | `M5V 1E3` |
| US ZIP | `90210` | Yes | `90210` |
| US ZIP+4 | `90210-1234` | Yes | `90210-1234` |
| Empty/null | `""` / `null` | Yes | unchanged |
| Invalid | `123` / `ABCDEF` | **Rejected** | validation error |

The shared `postalCodeSchema` (in `shared/schema.ts`) handles both validation and normalization during Zod parse. Server routes additionally call `normalizePostalCode()` for paths not using the Zod schema directly.

### Province Field Normalization (Phase 3)

Incoming API payloads may use `province`, `provinceState`, or `stateOrProvince`. The server normalizes these at the route level:

| Target table | Expected field | Server helper |
|-------------|---------------|---------------|
| `client_locations` | `province` | `normalizeServiceAddress()` |
| `supplier_locations` | `province` | `normalizeServiceAddress()` |
| `company_settings` | `provinceState` | `normalizeCompanyAddress()` |

Helpers are in `server/lib/addressNormalize.ts`.

## TypeScript

`@types/google.maps` is installed as a dev dependency. The `tsconfig.json` `types` array includes `"google.maps"` to make the `google.maps.places` namespace available globally.
