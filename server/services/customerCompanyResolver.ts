/**
 * customerCompanyResolver.ts
 * Shared service to deterministically resolve the customerCompanyId for a location.
 * Used by quote creation, invoice creation, and the clients overview endpoint.
 *
 * Logic:
 *   1. If location.parentCompanyId is already set, return it.
 *   2. Otherwise, find-or-create a customerCompanies record by the location's companyName,
 *      link the location to it, and return the new customerCompanyId.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { clientLocations } from "@shared/schema";
import { customerCompanyRepository } from "../storage/customerCompanies";

/**
 * Resolve the customerCompanyId for a given location, creating the parent
 * customer company if it doesn't exist and linking the location to it.
 *
 * @param tenantCompanyId - The tenant's company ID (for multi-tenant scoping)
 * @param location - The client_location record (must include id, companyName, parentCompanyId, and contact fields)
 * @returns The resolved customerCompanyId (never null)
 */
export async function resolveCustomerCompanyForLocation(
  tenantCompanyId: string,
  location: {
    id: string;
    companyName: string;
    parentCompanyId?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  }
): Promise<string> {
  // Fast path: location already linked to a customer company
  if (location.parentCompanyId) {
    return location.parentCompanyId;
  }

  // Slow path: find or create the customer company by name, then link the location
  const parentCompany = await customerCompanyRepository.findOrCreateCustomerCompany(
    tenantCompanyId,
    {
      name: location.companyName,
      phone: location.phone ?? null,
      email: location.email ?? null,
      billingStreet: location.address ?? null,
      billingCity: location.city ?? null,
      billingProvince: location.province ?? null,
      billingPostalCode: location.postalCode ?? null,
      billingCountry: null,
    }
  );

  // Persist the link so future lookups take the fast path
  await db
    .update(clientLocations)
    .set({ parentCompanyId: parentCompany.id })
    .where(
      and(
        eq(clientLocations.id, location.id),
        eq(clientLocations.companyId, tenantCompanyId)
      )
    );

  return parentCompany.id;
}
