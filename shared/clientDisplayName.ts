/**
 * Canonical client/customer display name resolver.
 *
 * SINGLE SOURCE OF TRUTH for determining the display identity of a customer company.
 * Do not bypass this function with ad-hoc name fallback logic.
 * Do not create duplicate resolvers in other files.
 *
 * Used by all UI surfaces that render a client name (lists, headers, invoices, search, etc.).
 *
 * Rules:
 * 1. If useCompanyAsPrimary is true and company name exists → company name
 * 2. Else if firstName exists → full person name (first + optional last)
 * 3. Else → company name (fallback)
 * 4. Else → "Client" (ultimate fallback)
 */

export interface ClientIdentityFields {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  useCompanyAsPrimary?: boolean | null;
}

/**
 * Resolve the primary display name for a customer company.
 * Accepts any object with the relevant identity fields.
 */
export function getClientDisplayName(client: ClientIdentityFields): string {
  const companyName = client.name?.trim() || null;
  const first = client.firstName?.trim() || null;
  const last = client.lastName?.trim() || null;
  const useCompany = client.useCompanyAsPrimary !== false; // default true

  // Rule 1: company is primary and exists
  if (useCompany && companyName) return companyName;

  // Rule 2: person name exists
  if (first) return last ? `${first} ${last}` : first;

  // Rule 3: fallback to company name
  if (companyName) return companyName;

  // Rule 4: ultimate fallback
  return "Client";
}
