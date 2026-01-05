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

export function parsePagination(query: unknown): PaginationParams {
  // query is req.query; zod will coerce strings
  const parsed = PaginationSchema.safeParse(query);
  if (!parsed.success) {
    // Normalize the error shape you already use (if you have a standard)
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
