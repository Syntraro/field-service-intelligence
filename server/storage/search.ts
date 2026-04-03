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
import { JOB_ACTIVE_SQL_J } from "./jobFilters";

// ========================================
// TYPES
// ========================================

export type SearchResultType = "job" | "invoice" | "customerCompany" | "location" | "supplier" | "contact";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  match: string | null; // e.g., "job #", "invoice #", "phone", "email"
  customerCompanyId?: string; // For customerCompany results: customer_companies.id
  tenantCompanyId?: string;   // For customerCompany results: owning company (tenant) ID
  /** Internal ranking: 0 = exact, 1 = prefix, 2 = contains. Not exposed to client. */
  _rank?: number;
}

interface SearchOptions {
  query: string;
  companyId: string;
  limit?: number;
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
 * Compute match rank: 0 = exact (case-insensitive), 1 = prefix, 2 = substring.
 * Lower = better.
 */
function matchRank(title: string, query: string): number {
  const tLow = title.toLowerCase();
  const qLow = query.toLowerCase();
  if (tLow === qLow) return 0;
  if (tLow.startsWith(qLow)) return 1;
  return 2;
}

/**
 * Global ranking: sort all results by match quality, then alphabetically within rank.
 * The frontend re-groups by type for sectioned display, so ordering here
 * only determines which results survive the overall limit.
 */
function rankResults(results: SearchResult[], query: string): SearchResult[] {
  // Assign rank based on title vs query proximity
  for (const r of results) {
    r._rank = matchRank(r.title, query);
  }
  // Stable sort: rank ASC, then title ASC within same rank
  return results.sort((a, b) => {
    if ((a._rank ?? 2) !== (b._rank ?? 2)) return (a._rank ?? 2) - (b._rank ?? 2);
    return a.title.localeCompare(b.title);
  });
}

/** Safety-valve per-type SQL LIMIT. Generous enough that same-name matches are never hidden. */
const PER_TYPE_SQL_CAP = 25;

// ========================================
// MAIN SEARCH FUNCTION
// ========================================

export async function universalSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, companyId, limit = 30 } = options;
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
  // PHASE 1: Queries 1-6 are independent — build and execute in parallel.
  // Query 7 (job summary) depends on Query 2 results, so it runs in Phase 2.
  // ========================================

  // ========================================
  // 1. INVOICE NUMBER SEARCH (exact/prefix match)
  // Runs FIRST for numeric queries so invoices appear before jobs
  // ========================================

  // Build invoice query promise (conditional)
  let invoicePromise: Promise<{ rows: any[] }> = Promise.resolve({ rows: [] });
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
        AND i.is_active = true
        AND i.deleted_at IS NULL
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
    invoicePromise = pool.query(invoiceQuery, [
      companyId,
      `${searchNum}%`,
      `INV-${searchNum}%`,
      PER_TYPE_SQL_CAP,
      exactPlain,
      exactInv
    ]);
  }

  // ========================================
  // 2. JOB NUMBER SEARCH (index-friendly: exact or range match)
  // Updated for 6-digit job numbers (100000+)
  // ========================================
  // Build job number query promise (conditional)
  let jobNumberPromise: Promise<{ rows: any[] }> = Promise.resolve({ rows: [] });
  if (isNumeric && digits.length >= 2) {
    const jobNum = parseInt(digits, 10);
    let jobNumberQuery: string;
    let jobParams: (string | number)[];

    if (digits.length >= 6) {
      jobNumberQuery = `
        SELECT 'job' as type, j.id,
          CONCAT('#', j.job_number, ' - ', j.summary) as title,
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match
        FROM jobs j
        LEFT JOIN client_locations cl ON j.location_id = cl.id
        WHERE j.company_id = $1 AND j.job_number = $2
          AND ${JOB_ACTIVE_SQL_J}
        LIMIT $3
      `;
      jobParams = [companyId, jobNum, PER_TYPE_SQL_CAP];
    } else {
      const multiplier = Math.pow(10, 6 - digits.length);
      const lowerBound = jobNum * multiplier;
      const upperBound = (jobNum + 1) * multiplier;
      // Match both 6-digit prefix range (e.g. "1070" → [107000,107100))
      // AND exact literal job number (e.g. "7002" → job_number = 7002)
      jobNumberQuery = `
        SELECT 'job' as type, j.id,
          CONCAT('#', j.job_number, ' - ', j.summary) as title,
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match
        FROM jobs j
        LEFT JOIN client_locations cl ON j.location_id = cl.id
        WHERE j.company_id = $1
          AND ((j.job_number >= $2 AND j.job_number < $3) OR j.job_number = $5)
          AND ${JOB_ACTIVE_SQL_J}
        ORDER BY j.job_number ASC
        LIMIT $4
      `;
      jobParams = [companyId, lowerBound, upperBound, PER_TYPE_SQL_CAP, jobNum];
    }

    jobNumberPromise = pool.query(jobNumberQuery, jobParams);
  }

  // ========================================
  // 3-6: Build query SQL (all use same phone/like params)
  // ========================================
  const phonePattern = phoneDigits || '';
  const hasPhone = phoneDigits !== null;
  const sharedParams = [companyId, likePattern, phonePattern, hasPhone, PER_TYPE_SQL_CAP];

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
      AND cc.is_active = true
      AND (
        cc.name ILIKE $2
        OR cc.email ILIKE $2
        OR ($4 AND regexp_replace(cc.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY cc.name
    LIMIT $5
  `;

  // 2026-03-27: Include parent_company_id so search can navigate to canonical client page
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
      END as match,
      cl.parent_company_id as "customerCompanyId"
    FROM client_locations cl
    WHERE cl.company_id = $1
      AND cl.deleted_at IS NULL
      AND (cl.inactive = false OR cl.inactive IS NULL)
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

  const contactQuery = `
    SELECT
      'contact' as type,
      ct.id,
      ct.customer_company_id,
      CONCAT_WS(' ', ct.first_name, ct.last_name) as title,
      COALESCE(cc.name, '') as subtitle,
      CASE
        WHEN CONCAT_WS(' ', ct.first_name, ct.last_name) ILIKE $2 THEN 'name'
        WHEN ct.email ILIKE $2 THEN 'email'
        WHEN $4 AND regexp_replace(ct.phone, '\\D', '', 'g') ILIKE $3 THEN 'phone'
        ELSE 'name'
      END as match
    FROM contact_persons ct
    LEFT JOIN customer_companies cc ON ct.customer_company_id = cc.id
    WHERE ct.company_id = $1
      AND (
        CONCAT_WS(' ', ct.first_name, ct.last_name) ILIKE $2
        OR ct.first_name ILIKE $2
        OR ct.last_name ILIKE $2
        OR ct.email ILIKE $2
        OR ($4 AND regexp_replace(ct.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY ct.last_name, ct.first_name
    LIMIT $5
  `;

  // ========================================
  // Execute queries 1-6 in parallel (Phase 1)
  // ========================================
  const [invoiceRes, jobNumberRes, customerRes, locationRes, supplierRes, contactRes] = await Promise.all([
    invoicePromise,
    jobNumberPromise,
    pool.query(customerQuery, sharedParams),
    pool.query(locationQuery, sharedParams),
    pool.query(supplierQuery, sharedParams),
    pool.query(contactQuery, sharedParams),
  ]);

  // Push results in canonical order (same as previous sequential order)
  results.push(...invoiceRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
  })));
  results.push(...jobNumberRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
  })));
  // Dev assertion: customerCompany results use customer_companies.id (cc.id in query)
  if (process.env.NODE_ENV === "development" && customerRes.rows.length > 0) {
    console.log("[search] customerCompany IDs (from customer_companies.id):", customerRes.rows.map((r: any) => r.customer_company_id));
  }
  results.push(...customerRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    customerCompanyId: r.customer_company_id,
    tenantCompanyId: r.tenant_company_id,
  })));
  results.push(...locationRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    customerCompanyId: r.customerCompanyId,
  })));
  results.push(...supplierRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
  })));
  results.push(...contactRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    customerCompanyId: r.customer_company_id,
  })));

  // ========================================
  // 7. JOB SUMMARY SEARCH (Phase 2 — depends on Query 2 results)
  // ========================================
  // Only search job summary if we don't have enough job results from number search
  const jobCountFromNumbers = results.filter(r => r.type === "job").length;
  if (jobCountFromNumbers < PER_TYPE_SQL_CAP && !isNumeric) {
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
        AND ${JOB_ACTIVE_SQL_J}
      ORDER BY j.created_at DESC
      LIMIT $3
    `;
    const jobSummaryResults = await pool.query(jobSummaryQuery, [
      companyId,
      likePattern,
      PER_TYPE_SQL_CAP - jobCountFromNumbers
    ]);
    results.push(...jobSummaryResults.rows.map(r => ({
      type: r.type as SearchResultType,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      match: r.match,
    })));
  }

  // Global ranking: sort by match quality (exact > prefix > contains), then alpha.
  // The frontend re-groups by type for sectioned display.
  const ranked = rankResults(results, trimmedQuery);

  // Strip internal _rank before returning
  const capped = ranked.slice(0, limit);
  for (const r of capped) delete r._rank;
  return capped;
}

export const searchRepository = {
  universalSearch,
};
