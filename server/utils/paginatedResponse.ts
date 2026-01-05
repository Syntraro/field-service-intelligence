export function paginated<T>(items: T[], meta: { limit: number; nextCursor?: string; nextOffset?: number; hasMore: boolean }) {
  return { data: items, meta };
}
