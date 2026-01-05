export function paginated<T>(items: T[], meta: { limit: number; nextCursor?: string; nextOffset?: number; hasMore: boolean }) {
  return { data: items, meta };
}

/**
 * Backwards-compatible paginated response.
 * Returns raw array if explicit=false (legacy callers), or {data, meta} if explicit=true.
 */
export function paginatedCompat<T>(
  items: T[], 
  meta: { limit: number; nextCursor?: string; nextOffset?: number; hasMore: boolean },
  explicit: boolean
): T[] | { data: T[]; meta: typeof meta } {
  if (explicit) {
    return { data: items, meta };
  }
  return items;
}
