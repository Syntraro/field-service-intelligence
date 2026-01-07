import { ZodSchema } from "zod";
import { fromZodError } from "zod-validation-error";
import { createError } from "../middleware/errorHandler";

/**
 * Validates data against a Zod schema and throws a standardized error on failure
 * Usage: const validated = validateSchema(mySchema, req.body);
 */
export const validateSchema = <T>(schema: ZodSchema<T>, data: unknown): T => {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errorMessage = fromZodError(result.error).message;
    throw createError(400, errorMessage);
  }

  return result.data;
};

/**
 * Validates query parameters with lenient parsing (useful for pagination, filters)
 */
export const validateQuery = <T>(schema: ZodSchema<T>, query: unknown): T => {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw createError(400, `Invalid query parameters: ${fromZodError(result.error).message}`);
  }

  return result.data;
};

/**
 * Validates URL parameters
 */
export const validateParams = <T>(schema: ZodSchema<T>, params: unknown): T => {
  const result = schema.safeParse(params);

  if (!result.success) {
    throw createError(400, `Invalid URL parameters: ${fromZodError(result.error).message}`);
  }

  return result.data;
};
