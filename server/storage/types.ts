export interface PaginatedResult<T> {
  items: T[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
    nextOffset?: number;
  };
}

export type { IStorage } from "./index";
