import { z } from "zod";

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

// Supports either cursor-based or offset-based
const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type PaginationParams = z.infer<typeof PaginationSchema>;

/**
 * Strict pagination parser - requires explicit offset or cursor param.
 * Throws 400 if pagination params are missing.
 */
export function parsePagination(query: unknown): PaginationParams {
  const parsed = PaginationSchema.safeParse(query);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
    const err = new Error(`Invalid pagination params: ${msg}`);
    (err as any).status = 400;
    throw err;
  }

  const { cursor, offset } = parsed.data;

  // Require one pagination mode
  if (!cursor && offset === undefined) {
    const err = new Error(`Pagination required: provide either ?cursor=... or ?offset=0 (plus ?limit=...)`);
    (err as any).status = 400;
    throw err;
  }

  // Prevent mixed-mode ambiguity
  if (cursor && offset !== undefined) {
    const err = new Error(`Provide only one pagination mode: cursor OR offset`);
    (err as any).status = 400;
    throw err;
  }

  return parsed.data;
}

/**
 * Lenient pagination parser - applies defaults when params are missing.
 * Used for backwards compatibility during migration.
 * Returns pagination params AND whether explicit pagination was requested.
 */
export function parsePaginationLenient(query: unknown): { 
  params: PaginationParams; 
  explicit: boolean;
} {
  const q = (query || {}) as Record<string, unknown>;
  const hasExplicitPagination = q.offset !== undefined || q.cursor !== undefined || q.limit !== undefined;
  
  // Apply default offset=0 if no pagination mode specified
  const queryWithDefaults = {
    ...q,
    ...(q.cursor === undefined && q.offset === undefined ? { offset: 0 } : {})
  };
  
  const parsed = PaginationSchema.safeParse(queryWithDefaults);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
    const err = new Error(`Invalid pagination params: ${msg}`);
    (err as any).status = 400;
    throw err;
  }

  // Prevent mixed-mode ambiguity
  if (parsed.data.cursor && parsed.data.offset !== undefined) {
    const err = new Error(`Provide only one pagination mode: cursor OR offset`);
    (err as any).status = 400;
    throw err;
  }

  return { params: parsed.data, explicit: hasExplicitPagination };
}

/**
 * Apply pagination to an array (for simple in-memory or small result sets).
 * Also calculates hasMore by checking if there are more items beyond the current page.
 */
export function applyOffsetPagination<T>(
  items: T[], 
  offset: number, 
  limit: number
): { items: T[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } } {
  const paginatedItems = items.slice(offset, offset + limit);
  const hasMore = offset + limit < items.length;
  
  return {
    items: paginatedItems,
    meta: {
      limit,
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
    }
  };
}
