/**
 * Contact resolution — phone number → tenant contact match(es).
 *
 * Single canonical surface for "who is this phone number?" inside a
 * tenant. The Communications Hub right-panel uses this today; future
 * SMS/call provider webhooks will route inbound traffic through the
 * exact same function so an unknown number reaches the same UX path
 * regardless of how it arrived.
 *
 * Sources unioned (in this priority order — see `pickPrimary`):
 *   1. `users`              (team members on the tenant)
 *   2. `contact_persons`    (per-customer-company humans)
 *   3. `customer_companies` (company-level main number)
 *   4. `client_locations`   (per-site number)
 *
 * Match algorithm
 * ---------------
 * The shared `normalizePhoneForMatch` helper produces the canonical key
 * (trailing 10 digits). The same trailing-10-digit transform is applied
 * to each candidate column server-side via Postgres
 * `regexp_replace(col, '\D', '', 'g')` + `right(...)`. We never trust
 * presentation; the comparison happens on a normalized digit string.
 *
 * Tenant safety
 * -------------
 * Every query `WHERE company_id = :tenantId`. There is no execution path
 * that returns a row from a different tenant.
 */

import { sql, eq, and, isNotNull, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  customerCompanies,
  clientLocations,
  contactPersons,
  users,
} from "@shared/schema";
import {
  normalizePhoneForMatch,
  isMatchableE164Like,
} from "@shared/phoneNormalization";
import type {
  ContactMatch,
  ContactMatchType,
  ContactResolutionResult,
} from "@shared/communicationsTypes";

// Re-export so existing callers continue to import these types from this
// module if they prefer; the canonical source of truth is `shared/`.
export type { ContactMatch, ContactMatchType, ContactResolutionResult };
export type { ContactResolutionConfidence } from "@shared/communicationsTypes";

// ────────────────────────────────────────────────────────────────────
// SQL helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Postgres expression that produces the trailing-10-digit match key for
 * a text column. Mirrors `normalizePhoneForMatch` — keep them in lockstep.
 *
 * The `regexp_replace(... '\D', '', 'g')` strips every non-digit; `right`
 * grabs the last 10 chars. NULL stays NULL.
 */
function phoneKeyExpr(column: ReturnType<typeof sql>) {
  return sql`right(regexp_replace(${column}, '\\D', '', 'g'), 10)`;
}

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function joinAddressLine(loc: {
  address?: string | null;
  city?: string | null;
  province?: string | null;
}): string | undefined {
  const parts = [loc.address, [loc.city, loc.province].filter(nonEmpty).join(", ")]
    .filter(nonEmpty);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ────────────────────────────────────────────────────────────────────
// Source-specific lookups
// ────────────────────────────────────────────────────────────────────

interface ResolveOpts {
  tenantId: string;
  matchKey: string;
}

async function findTeamUsers({ tenantId, matchKey }: ResolveOpts): Promise<ContactMatch[]> {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, tenantId),
        isNotNull(users.phone),
        ne(users.status, "deactivated"),
        sql`right(regexp_replace(${users.phone}, '\\D', '', 'g'), 10) = ${matchKey}`,
      ),
    );

  return rows.map((u) => {
    const display =
      (u.fullName ?? "").trim() ||
      [u.firstName, u.lastName].filter(nonEmpty).join(" ").trim() ||
      u.email ||
      "Team member";
    return {
      matchType: "team_user" as const,
      sourceId: u.id,
      displayName: display,
      phone: u.phone ?? null,
      email: u.email ?? null,
      userId: u.id,
    };
  });
}

async function findContactPersons({ tenantId, matchKey }: ResolveOpts): Promise<ContactMatch[]> {
  const rows = await db
    .select({
      id: contactPersons.id,
      firstName: contactPersons.firstName,
      lastName: contactPersons.lastName,
      email: contactPersons.email,
      phone: contactPersons.phone,
      customerCompanyId: contactPersons.customerCompanyId,
      customerName: customerCompanies.name,
    })
    .from(contactPersons)
    .leftJoin(customerCompanies, eq(customerCompanies.id, contactPersons.customerCompanyId))
    .where(
      and(
        eq(contactPersons.companyId, tenantId),
        isNotNull(contactPersons.phone),
        sql`right(regexp_replace(${contactPersons.phone}, '\\D', '', 'g'), 10) = ${matchKey}`,
      ),
    );

  return rows.map((p) => {
    const personName = [p.firstName, p.lastName].filter(nonEmpty).join(" ").trim();
    const display = personName || p.email || "Contact";
    return {
      matchType: "contact_person" as const,
      sourceId: p.id,
      displayName: display,
      phone: p.phone ?? null,
      email: p.email ?? null,
      customerCompanyId: p.customerCompanyId ?? undefined,
      customerCompanyName: p.customerName ?? undefined,
    };
  });
}

async function findCustomerCompanies({ tenantId, matchKey }: ResolveOpts): Promise<ContactMatch[]> {
  const rows = await db
    .select({
      id: customerCompanies.id,
      name: customerCompanies.name,
      firstName: customerCompanies.firstName,
      lastName: customerCompanies.lastName,
      useCompanyAsPrimary: customerCompanies.useCompanyAsPrimary,
      email: customerCompanies.email,
      phone: customerCompanies.phone,
    })
    .from(customerCompanies)
    .where(
      and(
        eq(customerCompanies.companyId, tenantId),
        isNotNull(customerCompanies.phone),
        sql`(${customerCompanies.deletedAt} IS NULL)`,
        sql`right(regexp_replace(${customerCompanies.phone}, '\\D', '', 'g'), 10) = ${matchKey}`,
      ),
    );

  return rows.map((c) => {
    const personName = [c.firstName, c.lastName].filter(nonEmpty).join(" ").trim();
    const display = c.useCompanyAsPrimary
      ? c.name || personName || c.email || "Customer"
      : personName || c.name || c.email || "Customer";
    return {
      matchType: "customer_company" as const,
      sourceId: c.id,
      displayName: display,
      phone: c.phone ?? null,
      email: c.email ?? null,
      customerCompanyId: c.id,
      customerCompanyName: c.name ?? undefined,
    };
  });
}

async function findClientLocations({ tenantId, matchKey }: ResolveOpts): Promise<ContactMatch[]> {
  const rows = await db
    .select({
      id: clientLocations.id,
      companyName: clientLocations.companyName,
      location: clientLocations.location,
      address: clientLocations.address,
      city: clientLocations.city,
      province: clientLocations.province,
      contactName: clientLocations.contactName,
      email: clientLocations.email,
      phone: clientLocations.phone,
      parentCompanyId: clientLocations.parentCompanyId,
      parentCompanyName: customerCompanies.name,
    })
    .from(clientLocations)
    .leftJoin(customerCompanies, eq(customerCompanies.id, clientLocations.parentCompanyId))
    .where(
      and(
        eq(clientLocations.companyId, tenantId),
        isNotNull(clientLocations.phone),
        sql`(${clientLocations.deletedAt} IS NULL)`,
        sql`right(regexp_replace(${clientLocations.phone}, '\\D', '', 'g'), 10) = ${matchKey}`,
      ),
    );

  return rows.map((l) => {
    const display =
      l.contactName ||
      l.companyName ||
      l.parentCompanyName ||
      l.location ||
      "Service location";
    return {
      matchType: "client_location" as const,
      sourceId: l.id,
      displayName: display,
      phone: l.phone ?? null,
      email: l.email ?? null,
      customerCompanyId: l.parentCompanyId ?? undefined,
      customerCompanyName: l.parentCompanyName ?? undefined,
      locationId: l.id,
      locationName: l.location ?? l.companyName ?? undefined,
      addressLine: joinAddressLine(l),
    };
  });
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Source-priority order for `pickPrimary`. Earlier entries win when a
 * single resolution returns multiple identical-shape matches; the
 * caller treats the rest of the list as alternatives.
 */
const PRIMARY_PRIORITY: readonly ContactMatchType[] = [
  "team_user",
  "contact_person",
  "client_location",
  "customer_company",
];

function pickPrimary(matches: ContactMatch[]): ContactMatch | null {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return null;
  // For multiple matches, no auto-pick by design — UI shows a conflict
  // state. We still expose `primary` as null so consumers can branch
  // cleanly without re-deriving the rule.
  return null;
}

export async function resolveContactByPhone(args: {
  tenantId: string;
  phone: string;
}): Promise<ContactResolutionResult> {
  const matchKey = normalizePhoneForMatch(args.phone);

  if (!isMatchableE164Like(args.phone)) {
    return {
      normalizedKey: matchKey,
      confidence: "unknown",
      matches: [],
      primary: null,
    };
  }

  const [team, persons, companies, locations] = await Promise.all([
    findTeamUsers({ tenantId: args.tenantId, matchKey }),
    findContactPersons({ tenantId: args.tenantId, matchKey }),
    findCustomerCompanies({ tenantId: args.tenantId, matchKey }),
    findClientLocations({ tenantId: args.tenantId, matchKey }),
  ]);

  // Walk in priority order so consumers can show "best first" without
  // re-sorting on the client.
  const ordered: ContactMatch[] = [];
  for (const t of PRIMARY_PRIORITY) {
    if (t === "team_user") ordered.push(...team);
    else if (t === "contact_person") ordered.push(...persons);
    else if (t === "client_location") ordered.push(...locations);
    else if (t === "customer_company") ordered.push(...companies);
  }

  if (ordered.length === 0) {
    return { normalizedKey: matchKey, confidence: "unknown", matches: [], primary: null };
  }
  if (ordered.length === 1) {
    return {
      normalizedKey: matchKey,
      confidence: "exact_single",
      matches: ordered,
      primary: ordered[0],
    };
  }
  return {
    normalizedKey: matchKey,
    confidence: "multiple_matches",
    matches: ordered,
    primary: pickPrimary(ordered),
  };
}
