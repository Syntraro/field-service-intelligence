import { z } from "zod";

/**
 * Zod schema for certificationExpiresAt on skill assignment routes.
 *
 * Accepts:
 *   - YYYY-MM-DD  — date-only from <input type="date">; new Date("YYYY-MM-DD")
 *                   parses as UTC midnight in Node.js, safe for TIMESTAMP write.
 *   - Full ISO datetime (any offset)
 *   - null / undefined / "" — treated as "no expiry date" (stored as null)
 *
 * Rejects: anything that is not empty and does not parse to a valid Date.
 */
export const certificationExpiresAtSchema = z
  .string()
  .nullable()
  .optional()
  .refine(
    (val) => !val || !isNaN(new Date(val).getTime()),
    { message: "Invalid date — expected YYYY-MM-DD or ISO datetime" },
  )
  .transform((val) => (!val ? null : val));
