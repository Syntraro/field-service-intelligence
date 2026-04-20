import { z } from "zod";

/**
 * 2026-04-19 staged signup — shared form schema.
 *
 * Used by the orchestrator's single hoisted react-hook-form instance.
 * Step 1 validates only (email, password, confirmPassword) via
 * `form.trigger(...)`; Step 2 validates the full object on final submit.
 *
 * Required server fields (firstName/lastName) are enforced here on the
 * client with min(1). Business name and phone are fully optional.
 * Password minimum is 8 to match the server's public-signup schema.
 */
export const publicSignupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    companyName: z.string().optional(),
    companyPhone: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type PublicSignupFormData = z.infer<typeof publicSignupSchema>;
