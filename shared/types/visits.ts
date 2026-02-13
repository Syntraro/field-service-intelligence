/**
 * Shared visit-related types used by tech field pages.
 *
 * Superset of all field-specific definitions — each consumer uses
 * only the fields it needs; extra optional fields are harmless.
 */

/** Job metadata attached to a visit (tech field API response shape). */
export interface VisitJob {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  description?: string;
  priority?: string;
}

/** Location metadata attached to a visit (tech field API response shape). */
export interface VisitLocation {
  id: string;
  companyName: string;
  location?: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  phone?: string;
}
