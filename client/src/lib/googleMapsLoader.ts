/**
 * Google Maps Places API script loader (singleton).
 * Loads the script once and resolves when google.maps.places is available.
 * If the API key is missing or the script fails, resolves to false (graceful fallback).
 */

let loadPromise: Promise<boolean> | null = null;

export function loadGoogleMapsPlaces(): Promise<boolean> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    // Already loaded (e.g. included in HTML)
    if (window.google?.maps?.places) {
      resolve(true);
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      console.warn("[AddressAutocomplete] VITE_GOOGLE_PLACES_API_KEY not set — plain input fallback.");
      resolve(false);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.maps?.places) {
        resolve(true);
      } else {
        console.warn("[AddressAutocomplete] Google Maps script loaded but places unavailable.");
        resolve(false);
      }
    };

    script.onerror = () => {
      console.warn("[AddressAutocomplete] Failed to load Google Maps script — plain input fallback.");
      // Allow retry on next page load
      loadPromise = null;
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Type augmentation so TS knows about google.maps on window */
declare global {
  interface Window {
    google?: {
      maps?: {
        places?: any;
        [key: string]: any;
      };
      [key: string]: any;
    };
  }
}
