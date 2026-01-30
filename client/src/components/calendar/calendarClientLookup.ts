/**
 * Shared client lookup utilities for calendar components
 *
 * These functions defensively handle various shapes of the `clients` prop
 * to prevent runtime crashes when clients is undefined, null, or an object wrapper.
 */

import type { CalendarEvent } from "./calendarUtils";

/**
 * Safely convert clients prop to array (defensive against undefined/null/object shapes)
 *
 * Handles these cases:
 * - clients is already an array → return as-is
 * - clients is { clients: [...] } → unwrap the nested array
 * - clients is an object → try Object.values()
 * - clients is undefined/null → return empty array
 */
export function ensureClientsArray(clients: unknown): any[] {
  // Fast path: already an array
  if (Array.isArray(clients)) return clients;

  // Handle undefined/null
  if (clients === undefined || clients === null) {
    return [];
  }

  // DEV warning for unexpected prop shape
  if (process.env.NODE_ENV === 'development') {
    console.warn('[calendarClientLookup] clients prop is not an array:', typeof clients, clients);
  }

  // Try to handle object shapes
  if (typeof clients === 'object') {
    // Check for { clients: [...] } wrapper pattern
    const maybeWrapper = clients as { clients?: unknown };
    if (Array.isArray(maybeWrapper.clients)) {
      return maybeWrapper.clients;
    }

    // Try Object.values() for record/map shapes
    const values = Object.values(clients);

    // If values is an array of items, return it
    if (values.length > 0) {
      // Check if this is a single nested array (e.g., { 0: [...] })
      if (values.length === 1 && Array.isArray(values[0])) {
        return values[0];
      }
      return values;
    }
  }

  return [];
}

/**
 * Alias for ensureClientsArray (preferred export name)
 */
export const toClientsArray = ensureClientsArray;

/**
 * Resolve a client for a CalendarEvent using multiple fallback keys.
 * Now returns a fallback client when lookup fails to ensure events render.
 *
 * Tries these identifiers in order:
 * 1. event.clientId (legacy field)
 * 2. event.locationId (new field)
 * 3. event.locationKey (derived field from calendarUtils)
 * 4. raw.clientId, raw.locationId (from raw assignment)
 *
 * @param clientsArray - Pre-converted clients array (use toClientsArray first)
 * @param event - The CalendarEvent to find client for
 * @param options - { useFallback: boolean } - whether to return fallback client on miss (default: true)
 * @returns The matching client, fallback client, or null if useFallback=false
 */
export function resolveClientForCalendarEvent(
  clientsArray: any[],
  event: CalendarEvent & { clientId?: string; locationId?: string },
  options?: { useFallback?: boolean }
): any | null {
  const useFallback = options?.useFallback !== false;
  const raw = event.raw || {};

  // Try identifiers in priority order
  const keysToTry = [
    event.clientId,
    event.locationId,
    event.locationKey,
    raw.clientId,
    raw.locationId,
  ].filter(Boolean) as string[];

  for (const key of keysToTry) {
    const client = clientsArray.find((c: any) => c?.id === key);
    if (client) return client;
  }

  // DEV warning when client cannot be resolved
  if (process.env.NODE_ENV === "development") {
    console.warn("[calendarClientLookup] Client not resolved for event, using fallback", {
      locationKey: event.locationKey,
      clientId: event.clientId,
      locationId: event.locationId,
      jobNumber: raw.jobNumber || (event as any).jobNumber,
      keysAttempted: keysToTry,
    });
  }

  // Return fallback client to ensure event renders
  return useFallback ? createFallbackClient(event) : null;
}

/**
 * Create a fallback client object for events without a matching client.
 * This ensures events always render visibly even when client lookup fails.
 *
 * @param event - The CalendarEvent to create fallback client for
 * @returns A synthetic client object with job info for display
 */
export function createFallbackClient(event: CalendarEvent): any {
  const raw = event.raw || {};
  return {
    id: event.locationKey || event.assignmentId,
    companyName: raw.clientName || raw.companyName || raw.summary || `Job #${event.jobNumber || raw.jobNumber || "Unknown"}`,
    location: raw.locationName || raw.address || raw.siteAddress || "",
    _isFallback: true,
  };
}

/**
 * Find a client by CalendarEvent using multi-key resolution with fallback.
 *
 * Resolution order:
 * 1. event.locationKey (canonical)
 * 2. raw.clientId (legacy)
 * 3. raw.locationId (new field)
 *
 * If no client found, returns a fallback client object to ensure event renders.
 *
 * @param clients - The clients prop (may be array, object wrapper, or undefined)
 * @param event - The CalendarEvent to find client for
 * @param options - { useFallback: boolean } - whether to return fallback client on miss (default: true)
 * @returns The matching client, fallback client, or undefined if useFallback=false
 */
export function findClientByEvent(
  clients: unknown,
  event: CalendarEvent,
  options?: { useFallback?: boolean }
): any | undefined {
  const list = ensureClientsArray(clients);
  const useFallback = options?.useFallback !== false;

  // Try multiple keys for resolution
  const raw = event.raw || {};
  const keysToTry = [
    event.locationKey,
    raw.clientId,
    raw.locationId,
    (event as any).clientId,
    (event as any).locationId,
  ].filter(Boolean) as string[];

  for (const key of keysToTry) {
    const client = list.find((c: any) => c?.id === key);
    if (client) return client;
  }

  // DEV warning when client cannot be resolved
  if (process.env.NODE_ENV === "development") {
    console.warn("[calendarClientLookup] Client not resolved for event, using fallback", {
      locationKey: event.locationKey,
      jobNumber: event.jobNumber || raw.jobNumber,
      keysAttempted: keysToTry,
    });
  }

  // Return fallback client to ensure event renders
  return useFallback ? createFallbackClient(event) : undefined;
}

/**
 * Find a client by ID (defensive)
 *
 * @param clients - The clients prop (may be array, object wrapper, or undefined)
 * @param id - The client ID to find
 * @returns The matching client or undefined
 */
export function findClientById(clients: unknown, id: string): any | undefined {
  const list = ensureClientsArray(clients);
  return list.find((c: any) => c.id === id);
}
