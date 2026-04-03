/**
 * Route Optimization API — Phase 4A (2026-03-04)
 *
 * POST /api/routes/optimize
 *   Accepts a list of stops (with lat/lng or address) and returns
 *   an optimized visiting order via OpenRouteService.
 *
 * Supports two modes:
 *   1. clientIds — look up client_locations by ID, use persisted lat/lng or address
 *   2. stops — pass inline lat/lng or address fields per stop
 *
 * Security: requireAuth + tenant-scoped (clientIds verified against companyId)
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { requireFeature } from "../auth/requireFeature";
import { routeOptimizationService } from "../routeOptimizationService";
import { db } from "../db";
import { clientLocations } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

// Gate all route optimization endpoints behind feature flag
router.use(requireFeature("routeOptimizationEnabled"));

// ============================================================================
// Request / Response schemas
// ============================================================================

const stopSchema = z.object({
  id: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.object({
    address: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});

const optimizeRequestSchema = z.object({
  // Mode 1: client IDs — server looks up locations
  clientIds: z.array(z.string()).optional(),
  startingLocation: z.string().optional(), // text address for geocoding

  // Mode 2: inline stops
  start: z.object({ lat: z.number(), lng: z.number() }).optional(),
  stops: z.array(stopSchema).optional(),
}).refine(
  (data) => (data.clientIds && data.clientIds.length > 0) || (data.stops && data.stops.length > 0),
  { message: "Either 'clientIds' or 'stops' must be provided with at least one entry" }
);

type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;

// ============================================================================
// POST /optimize
// ============================================================================

router.post("/optimize", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = validateSchema(optimizeRequestSchema, req.body);
  const { companyId } = req.user!;

  let geocodeCallsSkipped = 0;
  let geocodeCallsMade = 0;

  // Resolve stops to coordinate arrays
  interface ResolvedStop {
    id: string;
    label: string;
    coordinates: [number, number]; // [lng, lat] — ORS convention
  }

  const resolvedStops: ResolvedStop[] = [];
  const missingDataStops: string[] = [];

  // -------------------------------------------------------------------
  // Mode 1: clientIds — look up from DB
  // -------------------------------------------------------------------
  if (body.clientIds && body.clientIds.length > 0) {
    const clients = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, companyId),
          inArray(clientLocations.id, body.clientIds)
        )
      );

    // Preserve request order
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    for (const clientId of body.clientIds) {
      const client = clientMap.get(clientId);
      if (!client) continue; // skip unknown IDs silently

      const label = [client.companyName, client.location].filter(Boolean).join(" — ");

      if (client.lat && client.lng) {
        // Use persisted coordinates
        resolvedStops.push({
          id: client.id,
          label,
          coordinates: [parseFloat(client.lng), parseFloat(client.lat)],
        });
        geocodeCallsSkipped++;
      } else if (client.address || client.city) {
        // Geocode via ORS
        const coords = await routeOptimizationService.geocodeAddress(
          client.address || "",
          client.city || "",
          client.province || "",
          client.postalCode || ""
        );
        if (coords) {
          resolvedStops.push({ id: client.id, label, coordinates: coords });
          geocodeCallsMade++;
        } else {
          missingDataStops.push(`${label} (id: ${client.id}) — geocoding failed`);
        }
        // Rate-limit ORS calls (40 req/min)
        if (geocodeCallsMade > 0) await delay(1500);
      } else {
        missingDataStops.push(`${label} (id: ${client.id}) — no lat/lng or address`);
      }
    }

    // Handle startingLocation (text address → geocode to coordinates)
    if (body.startingLocation) {
      const coords = await routeOptimizationService.geocodeFullAddress(body.startingLocation);
      if (coords) {
        body.start = { lat: coords[1], lng: coords[0] };
      }
    }
  }

  // -------------------------------------------------------------------
  // Mode 2: inline stops
  // -------------------------------------------------------------------
  if (body.stops && body.stops.length > 0) {
    for (const stop of body.stops) {
      if (stop.lat != null && stop.lng != null) {
        resolvedStops.push({
          id: stop.id,
          label: stop.id,
          coordinates: [stop.lng, stop.lat],
        });
        geocodeCallsSkipped++;
      } else if (stop.address) {
        const coords = await routeOptimizationService.geocodeAddress(
          stop.address.address || "",
          stop.address.city || "",
          stop.address.province || "",
          stop.address.postalCode || ""
        );
        if (coords) {
          resolvedStops.push({ id: stop.id, label: stop.id, coordinates: coords });
          geocodeCallsMade++;
          await delay(1500);
        } else {
          missingDataStops.push(`Stop ${stop.id} — geocoding failed`);
        }
      } else {
        missingDataStops.push(`Stop ${stop.id} — no lat/lng or address provided`);
      }
    }
  }

  // -------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------
  if (missingDataStops.length > 0 && resolvedStops.length < 2) {
    throw createError(400, `Cannot optimize route. Missing location data for: ${missingDataStops.join("; ")}`);
  }

  if (resolvedStops.length < 2) {
    throw createError(400, "At least 2 stops with valid coordinates or addresses are required");
  }

  // -------------------------------------------------------------------
  // Call ORS optimization
  // -------------------------------------------------------------------
  const startCoords: [number, number] | undefined = body.start
    ? [body.start.lng, body.start.lat]
    : undefined;

  // Build geocodedClients array for the service
  const geocodedClients = resolvedStops.map((s) => ({
    client: { id: s.id, companyName: s.label } as any,
    coordinates: s.coordinates,
    address: s.label,
  }));

  const optimized = await routeOptimizationService.optimizeRoute(geocodedClients, startCoords);

  if (!optimized) {
    throw createError(502, "Route optimization service returned no result. Check ORS API key.");
  }

  // -------------------------------------------------------------------
  // Build response
  // -------------------------------------------------------------------
  // Map optimized order back to resolved stops
  const orderedStops = optimized.order.map((idx) => {
    const stop = resolvedStops[idx];
    return {
      id: stop.id,
      lat: stop.coordinates[1],  // convert [lng,lat] → lat
      lng: stop.coordinates[0],  // convert [lng,lat] → lng
      label: stop.label,
    };
  });

  // Also build the geocodedClients array the dialog expects
  const geocodedClientsResponse = orderedStops.map((s) => ({
    clientId: s.id,
    coordinates: [s.lng, s.lat] as [number, number],
    address: s.label,
  }));

  // Log optimization event
  console.log(
    `[ROUTES] Route optimized: ${resolvedStops.length} stops, ` +
    `geocodeSkipped=${geocodeCallsSkipped}, geocodeMade=${geocodeCallsMade}, ` +
    `distance=${optimized.totalDistance}m, duration=${optimized.totalDuration}s`
  );

  res.json({
    // Generic stop-based response (per spec)
    orderedStops,
    totalDistanceMeters: optimized.totalDistance,
    totalDurationSeconds: optimized.totalDuration,

    // Dialog-compatible fields
    clients: optimized.clients,
    totalDistance: optimized.totalDistance,
    totalDuration: optimized.totalDuration,
    geocodedClients: geocodedClientsResponse,
    startingCoordinates: startCoords,

    // Observability
    _meta: {
      stopsCount: resolvedStops.length,
      geocodeCallsSkipped,
      geocodeCallsMade,
      ...(missingDataStops.length > 0 ? { warnings: missingDataStops } : {}),
    },
  });
}));

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default router;
