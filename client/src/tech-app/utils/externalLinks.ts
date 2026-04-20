/**
 * externalLinks — tech-app URI builders for native phone / map handoffs.
 *
 * These helpers build the `tel:` and maps URLs that the mobile OS routes
 * to the phone app or preferred maps provider. Keeping them in a single
 * utility so the format is consistent across TodayPage, VisitDetailPage,
 * and LocationDetailPage — and so we can adjust the URL strategy in one
 * place if a future platform (e.g., iOS Apple Maps universal links) needs
 * a different scheme.
 */

/**
 * Build a `tel:` URI from a raw phone string. Strips everything that is
 * not a digit, `+`, `*`, or `#` so the dialer receives a clean address.
 * Returns `null` if no dialable characters remain — caller should skip
 * rendering the call button in that case.
 */
export function toTelHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9+*#]/g, "");
  if (!cleaned) return null;
  return `tel:${cleaned}`;
}

/**
 * Build a Google Maps search URL for the given address. Uses the `?q=`
 * form which iOS (Safari) and Android both honor — iOS offers to open
 * Apple Maps or Google Maps, Android opens the default maps app. We
 * intentionally stay on google.com rather than using `maps:` /
 * `geo:` schemes because the `https://` form gracefully falls back to
 * the web app in desktop contexts (e.g., office staff previewing the
 * tech view).
 */
export function toMapsHref(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}
