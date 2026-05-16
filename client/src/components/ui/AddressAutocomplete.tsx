/**
 * AddressAutocomplete — Google Places-powered street address input.
 *
 * Renders a shadcn-style Input. When the Google Maps Places script is available,
 * attaches a google.maps.places.Autocomplete to the underlying <input> element.
 * On place selection, fires onPlaceSelect with structured address fields.
 *
 * Falls back to a plain text input when:
 * - VITE_GOOGLE_PLACES_API_KEY is not set
 * - The Google Maps script fails to load
 * - The component is used in an environment without network access
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { loadGoogleMapsPlaces } from "@/lib/googleMapsLoader";

/** Structured address payload returned by onPlaceSelect */
export interface PlaceSelectPayload {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  formattedAddress?: string;
}

interface AddressAutocompleteProps {
  /** Current value of the street address field */
  value: string;
  /** Called on every keystroke (mirrors normal Input onChange) */
  onChange: (value: string) => void;
  /** Called when user selects a place from the autocomplete dropdown */
  onPlaceSelect?: (payload: PlaceSelectPayload) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "data-testid"?: string;
  /** Restrict results to specific country codes (e.g. ["ca", "us"]) */
  countryRestrictions?: string[];
}

/**
 * Parse google.maps.places.PlaceResult.address_components into structured fields.
 */
function parsePlaceResult(place: google.maps.places.PlaceResult): PlaceSelectPayload {
  const components = place.address_components || [];

  let streetNumber = "";
  let route = "";
  let city = "";
  let province = "";
  let postalCode = "";
  let country = "";

  for (const comp of components) {
    const type = comp.types[0];
    switch (type) {
      case "street_number":
        streetNumber = comp.long_name;
        break;
      case "route":
        route = comp.long_name;
        break;
      case "locality":
        city = comp.long_name;
        break;
      case "sublocality_level_1":
        // Fallback city for places without locality (e.g. boroughs)
        if (!city) city = comp.long_name;
        break;
      case "administrative_area_level_1":
        province = comp.short_name; // "ON" not "Ontario"
        break;
      case "postal_code":
        postalCode = comp.long_name;
        break;
      case "country":
        country = comp.long_name;
        break;
    }
  }

  const street = streetNumber ? `${streetNumber} ${route}` : route;
  const lat = place.geometry?.location?.lat();
  const lng = place.geometry?.location?.lng();

  return {
    street,
    city,
    province,
    postalCode,
    country: country || "Canada",
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    placeId: place.place_id ?? undefined,
    formattedAddress: place.formatted_address ?? undefined,
  };
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Street address",
  disabled = false,
  className,
  id,
  "data-testid": testId,
  countryRestrictions = ["ca", "us"],
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [placesReady, setPlacesReady] = useState(false);

  // Load Google Maps Places script
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsPlaces().then((loaded) => {
      if (!cancelled) setPlacesReady(loaded);
    });
    return () => { cancelled = true; };
  }, []);

  // Attach autocomplete to input once Places API is ready
  useEffect(() => {
    if (!placesReady || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      componentRestrictions: countryRestrictions.length ? { country: countryRestrictions } : undefined,
      fields: ["address_components", "geometry", "place_id", "formatted_address"],
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place?.address_components) return;

      const payload = parsePlaceResult(place);
      // Update the visible input to the street address
      onChange(payload.street);
      onPlaceSelect?.(payload);
    });

    autocompleteRef.current = autocomplete;

    // Cleanup on unmount
    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesReady]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  // Prevent form submission when user presses Enter to select a suggestion
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && placesReady) {
      // If the PAC dropdown is visible, Enter selects a suggestion — don't submit the form
      const pacContainer = document.querySelector(".pac-container");
      if (pacContainer && pacContainer.querySelector(".pac-item-selected")) {
        e.preventDefault();
      }
    }
  }, [placesReady]);

  return (
    <input
      ref={inputRef}
      id={id}
      data-testid={testId}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      className={cn(
        // Match shadcn Input styling exactly
        "flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-[rgba(130,186,88,0.55)] focus-visible:shadow-[0_0_0_3px_rgba(130,186,88,0.18)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
    />
  );
}
