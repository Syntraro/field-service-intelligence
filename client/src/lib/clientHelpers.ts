import type { Client } from "@shared/schema";

export function locationDisplayName(loc: Client): string {
  return (
    loc.location?.trim() ||
    (loc.address ? `${loc.address}${loc.city ? `, ${loc.city}` : ""}` : null) ||
    "Unnamed Location"
  );
}

export function locationAddress(loc: Client): string {
  return [loc.address, loc.address2, loc.city, loc.province, loc.postalCode]
    .filter(Boolean)
    .join(", ");
}

export function locationAddressLines(loc: Client | null | undefined): string[] {
  if (!loc) return [];
  return [
    loc.address,
    loc.address2,
    [loc.city, loc.province, loc.postalCode].filter(Boolean).join(", "),
  ].filter((line): line is string => Boolean(line && line.trim()));
}
