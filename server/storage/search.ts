/**
 * Universal Search Storage
 *
 * Provides fast multi-entity search across jobs, invoices, customer companies,
 * and client locations. Uses pg_trgm for fuzzy text matching.
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

export type SearchResultType = "job" | "invoice" | "quote" | "customerCompany" | "location" | "contact";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  /** Legacy display string. Kept verbatim for back-compat — older clients
   *  that don't read the structured fields below still render correctly. */
  title: string;
  subtitle: string | null;
  match: string | null; // e.g., "job #", "invoice #", "phone", "email"
  customerCompanyId?: string; // For customerCompany results: customer_companies.id
  tenantCompanyId?: string;   // For customerCompany results: owning company (tenant) ID
  // Canonical identity fields for customerCompany results
  firstName?: string | null;
  lastName?: string | null;
  useCompanyAsPrimary?: boolean | null;
  // ---------------------------------------------------------------------------
  // 2026-05-02 entity-number visual language (structured fields).
  //
  // For job / invoice / quote results the canonical primitive
  // `EntityNumber` on the client renders the number as a blue pill
  // separately from the descriptive text. Sending the number embedded
  // inside `title` (e.g. "#1234 - Summary") prevented that — these
  // fields let the client render `[1234] Summary` instead.
  //
  // Frontend contract:
  //   - If `entityNumber` is set, use it as the pill content; render
  //     `titleText` next to it.
  //   - If not set, fall back to `title` verbatim (existing behavior).
  //   - `entityNumber` may be empty string for entities without a
  //     number assigned yet — the client renders the muted dash.
  // ---------------------------------------------------------------------------
  /** Bare entity number ("1234", "INV-1234", or "" if unassigned). */
  entityNumber?: string | null;
  /** Human label, e.g. "Job #" / "Invoice #" / "Quote #". */
  entityNumberLabel?: "Job #" | "Invoice #" | "Quote #";
  /** Stable kind so the client can branch styling without parsing labels. */
  entityNumberType?: "job" | "invoice" | "quote";
  /** Descriptive title text without the embedded number. */
  titleText?: string;
  /** Internal ranking: 0 = exact, 1 = prefix, 2 = contains. Not exposed to client. */
  _rank?: number;
  /** Internal: matched reference value for ranking. Not exposed to client. */
  _matchedValue?: string;
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
  // Assign rank: best of title rank or matched reference value rank
  for (const r of results) {
    const titleRank = matchRank(r.title, query);
    // Reference field hits carry _matchedValue — rank by the actual matched value
    const refRank = r._matchedValue ? matchRank(r._matchedValue, query) : 2;
    r._rank = Math.min(titleRank, refRank);
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
        CONCAT(COALESCE(cl.company_name, cc.name, ''), ' - $', i.total) as subtitle,
        'invoice #' as match,
        -- 2026-05-02 entity-number structured fields (additive — title kept).
        COALESCE(i.invoice_number, '') as entity_number,
        COALESCE(cl.company_name, cc.name, '') as title_text
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
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match,
          -- 2026-05-02 entity-number structured fields.
          j.job_number::text as entity_number,
          COALESCE(j.summary, '') as title_text
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
          COALESCE(cl.company_name, '') as subtitle, 'job #' as match,
          -- 2026-05-02 entity-number structured fields.
          j.job_number::text as entity_number,
          COALESCE(j.summary, '') as title_text
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
      cc.first_name,
      cc.last_name,
      cc.use_company_as_primary,
      COALESCE(cc.email, cc.phone, '') as subtitle,
      CASE
        WHEN cc.name ILIKE $2 THEN 'name'
        WHEN cc.first_name ILIKE $2 OR cc.last_name ILIKE $2 THEN 'name'
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
        OR cc.first_name ILIKE $2
        OR cc.last_name ILIKE $2
        OR cc.email ILIKE $2
        OR ($4 AND regexp_replace(cc.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY cc.name
    LIMIT $5
  `;

  // 2026-03-27: Include parent_company_id so search can navigate to canonical client page.
  // 2026-05-01 stale-rename fix: location title prefers the parent customer
  // company's current name (`cc.name`) over the location's own
  // denormalized `cl.company_name` field. The schema documents
  // `client_locations.company_name` as a per-location override that the UI
  // should fall back from to `customer_companies.name`, but in practice
  // create flows have eagerly populated `cl.company_name = cc.name` on
  // every location, so a rename of the parent left the denormalized
  // field stale. Treating the parent as authoritative for DISPLAY
  // (while leaving the raw column untouched for editing flows) closes
  // the symptom without a destructive data migration. Standalone
  // locations (no `parent_company_id`, hence no `cc` row) fall through
  // to the location's own column, preserving original behavior. The
  // WHERE clause now also matches on `cc.name` so users searching by
  // the new parent name find sub-locations even before a backfill.
  const locationQuery = `
    SELECT
      'location' as type,
      cl.id,
      COALESCE(cc.name, NULLIF(cl.company_name, '')) as title,
      CONCAT_WS(', ', cl.address, cl.city, cl.province) as subtitle,
      CASE
        -- 2026-05-01 strict-search: parented location's name match comes
        -- ONLY from the parent customer company. Standalone (no parent)
        -- can match its own column.
        WHEN cl.parent_company_id IS NOT NULL AND cc.name ILIKE $2 THEN 'name'
        WHEN cl.parent_company_id IS NULL AND cl.company_name ILIKE $2 THEN 'name'
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
    LEFT JOIN customer_companies cc ON cl.parent_company_id = cc.id
    WHERE cl.company_id = $1
      AND cl.deleted_at IS NULL
      AND (cl.inactive = false OR cl.inactive IS NULL)
      AND (
        -- 2026-05-01 strict-search: name match is parent-name only for
        -- parented rows; the location is own column is searchable only
        -- when the location is standalone. Stale denormalized values on
        -- cl.company_name are NOT considered. Address/city/postal/etc.
        -- continue to match — those are location attributes, not names.
        (cl.parent_company_id IS NOT NULL AND cc.name ILIKE $2)
        OR (cl.parent_company_id IS NULL AND cl.company_name ILIKE $2)
        OR cl.address ILIKE $2
        OR cl.city ILIKE $2
        OR cl.province ILIKE $2
        OR cl.postal_code ILIKE $2
        OR cl.email ILIKE $2
        OR ($4 AND regexp_replace(cl.phone, '\\D', '', 'g') ILIKE $3)
      )
    ORDER BY COALESCE(cc.name, NULLIF(cl.company_name, ''))
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
  // 7b. REFERENCE FIELD VALUE SEARCH
  // 2026-04-10: Search reference_field_values (text_value only — text-only system)
  // for searchable definitions. Maps hits back to job/invoice entity results.
  // Uses GIN trigram index on text_value for performance.
  // ========================================
  const refFieldQuery = `
    SELECT DISTINCT ON (rv.entity_type, rv.entity_id)
      rv.entity_type,
      rv.entity_id,
      rd.label as field_label,
      rv.text_value as matched_value,
      CASE rv.entity_type
        WHEN 'job' THEN (
          SELECT CONCAT('#', j.job_number, ' - ', j.summary)
          FROM jobs j WHERE j.id = rv.entity_id AND j.company_id = $1
            AND j.deleted_at IS NULL AND j.is_active = true
        )
        WHEN 'invoice' THEN (
          SELECT CONCAT('Invoice #', COALESCE(i.invoice_number, i.id))
          FROM invoices i WHERE i.id = rv.entity_id AND i.company_id = $1 LIMIT 1
        )
        WHEN 'quote' THEN (
          SELECT CONCAT('Quote #', COALESCE(q.quote_number, q.id))
          FROM quotes q WHERE q.id = rv.entity_id AND q.company_id = $1 LIMIT 1
        )
      END as entity_title,
      -- 2026-05-02 entity-number structured field. One sub-select per
      -- entity_type, mirroring the entity_title CASE shape — same
      -- joined rows, no extra DB hits beyond the existing per-row
      -- entity lookup.
      CASE rv.entity_type
        WHEN 'job' THEN (
          SELECT j.job_number::text FROM jobs j
          WHERE j.id = rv.entity_id AND j.company_id = $1
            AND j.deleted_at IS NULL AND j.is_active = true
        )
        WHEN 'invoice' THEN (
          SELECT COALESCE(i.invoice_number, '') FROM invoices i
          WHERE i.id = rv.entity_id AND i.company_id = $1 LIMIT 1
        )
        WHEN 'quote' THEN (
          SELECT COALESCE(q.quote_number, '') FROM quotes q
          WHERE q.id = rv.entity_id AND q.company_id = $1 LIMIT 1
        )
      END as entity_number,
      -- Descriptive title text without the embedded number.
      CASE rv.entity_type
        WHEN 'job' THEN (
          SELECT COALESCE(j.summary, '') FROM jobs j
          WHERE j.id = rv.entity_id AND j.company_id = $1
            AND j.deleted_at IS NULL AND j.is_active = true
        )
        WHEN 'invoice' THEN (
          SELECT COALESCE(cl.company_name, '')
          FROM invoices i LEFT JOIN client_locations cl ON i.location_id = cl.id
          WHERE i.id = rv.entity_id AND i.company_id = $1 LIMIT 1
        )
        WHEN 'quote' THEN (
          SELECT COALESCE(cl.company_name, '')
          FROM quotes q LEFT JOIN client_locations cl ON q.location_id = cl.id
          WHERE q.id = rv.entity_id AND q.company_id = $1 LIMIT 1
        )
      END as title_text,
      CASE rv.entity_type
        WHEN 'job' THEN (
          SELECT COALESCE(cl.company_name, '')
          FROM jobs j LEFT JOIN client_locations cl ON j.location_id = cl.id
          WHERE j.id = rv.entity_id AND j.company_id = $1 LIMIT 1
        )
        WHEN 'invoice' THEN (
          SELECT CONCAT(COALESCE(cl.company_name, ''), ' - $', i.total)
          FROM invoices i LEFT JOIN client_locations cl ON i.location_id = cl.id
          WHERE i.id = rv.entity_id AND i.company_id = $1 LIMIT 1
        )
        WHEN 'quote' THEN (
          SELECT COALESCE(cl.company_name, '')
          FROM quotes q LEFT JOIN client_locations cl ON q.location_id = cl.id
          WHERE q.id = rv.entity_id AND q.company_id = $1 LIMIT 1
        )
      END as entity_subtitle
    FROM reference_field_values rv
    JOIN reference_field_definitions rd
      ON rv.field_definition_id = rd.id AND rd.company_id = $1
    WHERE rv.company_id = $1
      AND rd.searchable = true
      AND rv.text_value ILIKE $2
    ORDER BY rv.entity_type, rv.entity_id
    LIMIT $3
  `;
  const refFieldPromise = pool.query(refFieldQuery, [companyId, likePattern, PER_TYPE_SQL_CAP]);

  // ========================================
  // Execute queries 1-6 + ref fields in parallel (Phase 1)
  // ========================================
  const [invoiceRes, jobNumberRes, customerRes, locationRes, contactRes, refFieldRes] = await Promise.all([
    invoicePromise,
    jobNumberPromise,
    pool.query(customerQuery, sharedParams),
    pool.query(locationQuery, sharedParams),
    pool.query(contactQuery, sharedParams),
    refFieldPromise,
  ]);

  // Push results in canonical order (same as previous sequential order).
  // 2026-05-02: invoice + job result mappers carry the structured
  // entityNumber* fields so the client EntityNumber primitive can
  // render the number as a blue pill separately from descriptive text.
  results.push(...invoiceRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    entityNumber: r.entity_number ?? "",
    entityNumberLabel: "Invoice #" as const,
    entityNumberType: "invoice" as const,
    titleText: r.title_text ?? "",
  })));
  results.push(...jobNumberRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    entityNumber: r.entity_number ?? "",
    entityNumberLabel: "Job #" as const,
    entityNumberType: "job" as const,
    titleText: r.title_text ?? "",
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
    firstName: r.first_name ?? null,
    lastName: r.last_name ?? null,
    useCompanyAsPrimary: r.use_company_as_primary ?? null,
  })));
  results.push(...locationRes.rows.map((r: any) => ({
    type: r.type as SearchResultType,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    match: r.match,
    customerCompanyId: r.customerCompanyId,
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
  // 7b. Push reference field results (mapped to entity types)
  // ========================================
  // Track existing result IDs for dedupe: type+id
  const seenIds = new Set<string>();
  results.forEach((r) => seenIds.add(`${r.type}:${r.id}`));

  refFieldRes.rows.forEach((r: any) => {
    if (!r.entity_title) return; // entity not found (deleted/inactive)
    const entityType = r.entity_type as SearchResultType;
    const key = `${entityType}:${r.entity_id}`;
    if (seenIds.has(key)) return; // dedupe: record already in results from primary search
    seenIds.add(key);
    // 2026-05-02 entity-number structured fields. Map the entity_type
    // string to the canonical label/type pair the client EntityNumber
    // primitive consumes. customerCompany / supplier / contact /
    // location result types from ref-fields don't have entity numbers
    // and are intentionally not assigned a label/type.
    let entityNumberLabel: SearchResult["entityNumberLabel"] | undefined;
    let entityNumberType: SearchResult["entityNumberType"] | undefined;
    if (entityType === "job") {
      entityNumberLabel = "Job #";
      entityNumberType = "job";
    } else if (entityType === "invoice") {
      entityNumberLabel = "Invoice #";
      entityNumberType = "invoice";
    } else if (entityType === "quote") {
      entityNumberLabel = "Quote #";
      entityNumberType = "quote";
    }
    results.push({
      type: entityType,
      id: r.entity_id,
      title: r.entity_title,
      subtitle: r.entity_subtitle || null,
      match: `ref: ${r.field_label}`,
      entityNumber: r.entity_number ?? "",
      entityNumberLabel,
      entityNumberType,
      titleText: r.title_text ?? "",
      _matchedValue: r.matched_value || undefined,
    });
  });

  // ========================================
  // 8. JOB SUMMARY SEARCH (Phase 2 — depends on Query 2 results)
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
        'summary' as match,
        -- 2026-05-02 entity-number structured fields.
        j.job_number::text as entity_number,
        COALESCE(j.summary, '') as title_text
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
      // 2026-05-02 entity-number structured fields.
      entityNumber: r.entity_number ?? "",
      entityNumberLabel: "Job #" as const,
      entityNumberType: "job" as const,
      titleText: r.title_text ?? "",
    })));
  }

  // Global ranking: sort by match quality (exact > prefix > contains), then alpha.
  // The frontend re-groups by type for sectioned display.
  const ranked = rankResults(results, trimmedQuery);

  // Strip internal _rank before returning
  const capped = ranked.slice(0, limit);
  for (const r of capped) { delete r._rank; delete r._matchedValue; }
  return capped;
}

export const searchRepository = {
  universalSearch,
};
