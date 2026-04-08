/**
 * useLocationSearch — Re-exports from canonical location entity.
 * This file exists for backward compatibility with existing consumers.
 * New code should import from @/lib/entities/locationEntity directly.
 */
export { useLocationSearch, useLocationById, type LocationOption as LocationResult } from "@/lib/entities/locationEntity";
