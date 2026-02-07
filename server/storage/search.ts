/**
 * Universal Search Storage
 *
 * Provides fast multi-entity search across jobs, invoices, customer companies,
 * client locations, and suppliers. Uses pg_trgm for fuzzy text matching.
 *
 * Phase 1 of RALPH global search implementation.
 *
 * Updated 2026-02-06:
 * - Invoice search runs before job search for numeric queries (invoices appear first)
 * - Invoice exact matches ranked above prefix matches
 * - Job number logic updated for 6-digit job numbers (100000+)
 */

import { pool } from "../db";

// ========================================
// TYPES
// ========================================

export type SearchResultType = "job" | "invoice" | "customerCompany" | "location" | "supplier";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  match: string | null; // e.g., "job #", "invoice #", "phone", "email"
  customerCompanyId?: string; // For customerCompany results: customer_companies.id
  tenantCompanyId?: string;   // For customerCompany results: owning company (tenant) ID
}

interface SearchOptions {
  query: string;
  companyId: string;
  limit?: number;
  perTypeLimit?: number;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/** Extract digits from a string for phone matching */
function extractDigits(str: string): string {
  return str.replace(/\D/g, "");
}

/** Check if query looks like a job/invoice number (2-6 digits, not phone-length) */
function isNumericQuery(query: string): boolean {
  const digits = extractDigits(query);
  // 2-6 digits = job/invoice numbers; 7+ digits = likely phone numbers
  return digits.length >= 2 && digits.length <= 6;
}

/** Check if query looks like an invoice number (INV-123, 123, etc.) */
function parseInvoiceQuery(query: string): string | null {
  // Strip INV- prefix if present
  const normalized = query.replace(/^INV-?/i, "").trim();
  if (/^\d+$/.test(normalized)) {
    return normalized;
  }
  return null;
}

/**
 * Round-robin interleave results by type.
 * Shows first result of each type, then second of each, etc.
 * This makes results feel smarter without full relevance ranking.
 *
 * @param results - The search results to interleave
 * @param typeOrder - Optional explicit type order for interleaving (for numeric queries: invoice first)
 */
function interleaveResults(results: SearchResult[], typeOrder?: SearchResultType[]): SearchResult[] {
  const byType: Record<string, SearchResult[]> = {};

  for (const r of results) {
    (byType[r.type] ??= []).push(r);
  }

  // Use explicit order if provided, otherwise use insertion order
  const types = typeOrder
    ? typeOrder.filter(t => byType[t]?.length > 0)
    : Object.keys(byType);

  // Add any types not in the explicit order
  if (typeOrder) {
    for (const t of Object.keys(byType)) {
      if (!types.includes(t)) {
        types.push(t);
      }
    }
  }

  const interleaved: SearchResult[] = [];
  let index = 0;

  while (interleaved.length < results.length) {
    for (const type of types) {
      if (byType[type]?.[index]) {
        interleaved.push(byType[type][index]);
      }
    }
    index++;
  }

  return interleaved;
}

// ========================================
// MAIN SEARCH FUNCTION
// ========================================

export async function universalSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, companyId, limit = 20, perTypeLimit = 6 } = options;
  const trimmedQuery = query.trim();

  if (!trimmedQuery || trimmedQuery.length < 2) {
    return [];
  }

  const results: SearchResult[] = [];
  const digits = extractDigits(trimmedQuery);
  const isNumeric = isNumericQuery(trimmedQuery);
  const invoiceNum = parseInvoiceQuery(trimmedQuery);
  const likePattern = `%${trimmedQuery}%`;
  const phoneDigits = digits.length >= 3 ? `%${digits}%` : null;

  // ========================================
  // 1. INVOICE NUMBER SEARCH (exact/prefix match)
  // Runs FIRST for numeric queries so invoices appear before jobs
  // ========================================
  if (invoiceNum || isNumeric) {
    const searchNum = invoiceNum || digits;
    // Exact match strings for priority ordering
    const exactPlain = searchNum;
    const exactInv = `INV-${searchNum}`;

    const invoiceQuery = `
      SELECT
        'invoice' as type,
        i.id,
        CONCAT('Invoice #', COALESCE(i.invoice_number, i.id)) as title,
        CONCAT(COALESCE(cc.name, cl.company_name, ''), ' - $', i.total) as subtitle,
        'invoice #' as match
      FROM invoices i
      LEFT JOIN client_locations cl ON i.location_id = cl.id
      LEFT JOIN customer_companies cc ON i.customer_company_id = cc.id
      WHERE i.company_id = $1
        AND (
          i.invoice_number ILIKE $2
          OR i.invoice_number ILIKE $3
        )
      ORDER BY
        CASE
          WHEN i.invoice_number = $5 OR i.invoice_number = $6 THEN 0
          ELSE 1
        END,
        i.issue_date DESC
      LIMIT $4
    `;
    const invoiceResults = await pool.query(invoiceQuery, [
      companyId,
      `${searchNum}%`,
      `INV-${searchNum}%`,
      perTypeLimit,
      exactPlain,
      exactInv
    ]);
    results.push(...invoiceResults.rows.map(r => ({
      type: r.type as SearchResultType,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      match: r.match,
    })));
  }

  // ========================================
  // 2. JOB NUMBER SEARCH (index-friendly: exact or range match)
  // Updated for 6-digit job numbers (100000+)
  // ========================================
  // For >=6 digits: exact match (fast index lookup)
  // For 2-5 digits: range query for prefix matching (e.g., "100" matches 100000-100999)
  if (isNumeric && digits.length >= 2) {
    const jobNum = parseInt(digits, 10);
    let jobNumberQuery: string;
    let jobParams: (string | number)[];

    if (digits.length >= 6) {
      // Exact match for 6+ digit queries (full job number)
      jobNumberQuery = `
        SELECT 'job' as type, j.id,
          CONCAT('#', j.job_number, ' - ', j.summary) as title,
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match
        FROM jobs j
        LEFT JOIN client_locations cl ON j.location_id = cl.id
        WHERE j.company_id = $1 AND j.job_number = $2
        LIMIT $3
      `;
      jobParams = [companyId, jobNum, perTypeLimit];
    } else {
      // Range query for 2-5 digit prefixes (index-friendly)
      // For 6-digit job numbers: "100" -> finds 100000-100999, "1001" -> finds 100100-100199
      const multiplier = Math.pow(10, 6 - digits.length);
      const lowerBound = jobNum * multiplier;
      const upperBound = (jobNum + 1) * multiplier;
      jobNumberQuery = `
        SELECT 'job' as type, j.id,
          CONCAT('#', j.job_number, ' - ', j.summary) as title,
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match
        FROM jobs j
        LEFT JOIN client_locations cl ON j.location_id = cl.id
        WHERE j.company_id = $1 AND j.job_number >= $2 AND j.job_number < $3
        ORDER BY j.job_number ASC
        LIMIT $4
      `;
      jobParams = [companyId, lowerBound, upperBound, perTypeLimit];
    }

    const jobResults = await pool.query(jobNumberQuery, jobParams);
    results.push(...jobResults.rows.map(r => ({
      type: r.type as SearchResultType,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      match: r.match,
    })));
  }

  // ========================================
  // 3. CUSTOMER COMPANY SEARCH (name/email/phone)
  // ========================================
  // Use empty string instead of null for phone to allow type inference
  const phonePattern = phoneDigits || '';
  const hasPhone = phoneDigits !== null;
  const customerQuery = `
    SELECT
      'customerCompany' as type,
      cc.id,
      cc.id as customer_company_id,
      cc.company_id as tenant_company_id,
      cc.name as title,
      COALESCE(cc.email, cc.phone, '') as subtitle,
      CASE
        WHEN cc.name ILIKE $2 THEN 'name'
        WHEN cc.email ILIKE $2 THEN 'email'
        WHEN $4 AND regexp_replace(cc.phone, '\\D', '', 'g') ILIKE $3 THEN 'phone'
        ELSE 'name'
      END as match
    FROM customer_companies cc
    WHERE cc.company_id = $1
      AND cc.deleted_at IS NULL
      AND (
        cc.name ILIKE $2
        OR cc.email ILIKE $2
        OR ($4 AND regexp_replace(cc.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY cc.name
    LIMIT $5
  `;
  const customerResults = await pool.query(customerQuery, [companyId, likePattern, phonePattern, hasPhone, perTypeLimit]);
  // Dev assertion: customerCompany results use customer_companies.id (cc.id in query)
  if (process.env.NODE_ENV === "development" && customerResults.rows.length > 0) {
    console.log("[search] customerCompany IDs (from customer_companies.id):", customerResults.rows.map(r => r.customer_company_id));
  }
  results.push(...customerResults.rows.map(r => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    customerCompanyId: r.customer_company_id,
    tenantCompanyId: r.tenant_company_id,
  })));

  // ========================================
  // 4. CLIENT LOCATION SEARCH (companyName/address/city/postal/email/phone)
  // ========================================
  const locationQuery = `
    SELECT
      'location' as type,
      cl.id,
      cl.company_name as title,
      CONCAT_WS(', ', cl.address, cl.city, cl.province) as subtitle,
      CASE
        WHEN cl.company_name ILIKE $2 THEN 'name'
        WHEN cl.address ILIKE $2 THEN 'address'
        WHEN cl.city ILIKE $2 THEN 'city'
        WHEN cl.province ILIKE $2 THEN 'province'
        WHEN cl.postal_code ILIKE $2 THEN 'postal'
        WHEN cl.email ILIKE $2 THEN 'email'
        WHEN $4 AND regexp_replace(cl.phone, '\\D', '', 'g') ILIKE $3 THEN 'phone'
        ELSE 'name'
      END as match
    FROM client_locations cl
    WHERE cl.company_id = $1
      AND cl.deleted_at IS NULL
      AND (
        cl.company_name ILIKE $2
        OR cl.address ILIKE $2
        OR cl.city ILIKE $2
        OR cl.province ILIKE $2
        OR cl.postal_code ILIKE $2
        OR cl.email ILIKE $2
        OR ($4 AND regexp_replace(cl.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY cl.company_name
    LIMIT $5
  `;
  const locationResults = await pool.query(locationQuery, [companyId, likePattern, phonePattern, hasPhone, perTypeLimit]);
  results.push(...locationResults.rows.map(r => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
  })));

  // ========================================
  // 5. SUPPLIER SEARCH (name/email/phone)
  // ========================================
  const supplierQuery = `
    SELECT
      'supplier' as type,
      s.id,
      s.name as title,
      COALESCE(s.email, s.phone, '') as subtitle,
      CASE
        WHEN s.name ILIKE $2 THEN 'name'
        WHEN s.email ILIKE $2 THEN 'email'
        WHEN $4 AND regexp_replace(s.phone, '\\D', '', 'g') ILIKE $3 THEN 'phone'
        ELSE 'name'
      END as match
    FROM suppliers s
    WHERE s.company_id = $1
      AND s.deleted_at IS NULL
      AND (
        s.name ILIKE $2
        OR s.email ILIKE $2
        OR ($4 AND regexp_replace(s.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY s.name
    LIMIT $5
  `;
  const supplierResults = await pool.query(supplierQuery, [companyId, likePattern, phonePattern, hasPhone, perTypeLimit]);
  results.push(...supplierResults.rows.map(r => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
  })));

  // ========================================
  // 6. JOB SUMMARY SEARCH (text match, lower priority)
  // ========================================
  // Only search job summary if we don't have enough job results from number search
  const jobCountFromNumbers = results.filter(r => r.type === "job").length;
  if (jobCountFromNumbers < perTypeLimit && !isNumeric) {
    const jobSummaryQuery = `
      SELECT
        'job' as type,
        j.id,
        CONCAT('#', j.job_number, ' - ', j.summary) as title,
        COALESCE(cl.company_name, '') as subtitle,
        'summary' as match
      FROM jobs j
      LEFT JOIN client_locations cl ON j.location_id = cl.id
      WHERE j.company_id = $1
        AND j.summary ILIKE $2
      ORDER BY j.created_at DESC
      LIMIT $3
    `;
    const jobSummaryResults = await pool.query(jobSummaryQuery, [
      companyId,
      likePattern,
      perTypeLimit - jobCountFromNumbers
    ]);
    results.push(...jobSummaryResults.rows.map(r => ({
      type: r.type as SearchResultType,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      match: r.match,
    })));
  }

  // Return interleaved results, capped at total limit
  // For numeric queries, prioritize invoice results first
  const typeOrder: SearchResultType[] | undefined = isNumeric
    ? ["invoice", "job", "customerCompany", "location", "supplier"]
    : undefined;

  return interleaveResults(results, typeOrder).slice(0, limit);
}

export const searchRepository = {
  universalSearch,
};
