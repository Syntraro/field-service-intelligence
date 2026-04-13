/**
 * Recipient Resolver — entity strategies (Phase 8, 2026-04-12).
 *
 * Small per-entity helpers that produce the ORDERED, pre-dedupe list of
 * candidate emails. The shared orchestrator in `recipientResolverService`
 * owns the universal concerns:
 *   - email trim / lowercase / validation
 *   - dedupe (case-insensitive, first-occurrence order preserved)
 *   - "empty array when no match, throw only on missing entity"
 *
 * Each strategy is allowed to look like its former standalone resolver but
 * may NOT call the email-normalization or dedupe helpers itself — that is
 * the orchestrator's job. This guarantees consistent normalization across
 * entities.
 */

import { storage } from "../storage/index";
import { createError } from "../middleware/errorHandler";
import { clientContactRepository } from "../storage/clientContacts";
import { quoteRepository } from "../storage/quotes";

function hasRole(roles: string[] | null | undefined, role: string): boolean {
  return Array.isArray(roles) && roles.some((r) => typeof r === "string" && r.toLowerCase() === role);
}

function hasAnyRole(roles: string[] | null | undefined, want: readonly string[]): boolean {
  if (!Array.isArray(roles)) return false;
  const set = new Set(want.map((r) => r.toLowerCase()));
  return roles.some((r) => typeof r === "string" && set.has(r.toLowerCase()));
}

/**
 * Shared collector: billing contacts priority — used by invoice + quote
 * strategies because they share the exact same resolution order.
 */
async function collectBillingFirstRecipients(params: {
  tenantId: string;
  locationId: string;
  customerCompanyId: string | null;
  locationEmail: string | null;
}): Promise<(string | null | undefined)[]> {
  const { tenantId, locationId, customerCompanyId, locationEmail } = params;
  const out: (string | null | undefined)[] = [];

  // 1. Location-level billing contacts.
  try {
    const locationContacts = await clientContactRepository.getLocationContacts(tenantId, locationId);
    for (const c of locationContacts) {
      if (hasRole((c.assignment as any)?.roles, "billing")) out.push(c.email);
    }
  } catch {}

  // 2. Customer-company-level billing contacts.
  if (customerCompanyId) {
    try {
      const directory = await clientContactRepository.getCompanyDirectory(tenantId, customerCompanyId);
      for (const p of directory) {
        const isBilling = (p.assignments ?? []).some((a: any) => hasRole(a.roles, "billing"));
        if (isBilling) out.push(p.email);
      }
    } catch {}
  }

  // 3. Legacy location email.
  out.push(locationEmail);

  // 4. Customer-company primary contact fallback.
  if (customerCompanyId) {
    try {
      const directory = await clientContactRepository.getCompanyDirectory(tenantId, customerCompanyId);
      for (const p of directory) {
        if (p.isPrimary) out.push(p.email);
      }
    } catch {}
  }

  return out;
}

export const recipientResolverStrategies = {
  async invoice(tenantId: string, entityId: string): Promise<(string | null | undefined)[]> {
    const invoice = await storage.getInvoice(tenantId, entityId);
    if (!invoice) throw createError(404, "Invoice not found");

    const location = await storage.getClient(tenantId, invoice.locationId);
    if (!location) return [];

    const customerCompanyId =
      (invoice as any).customerCompanyId ?? (location as any).parentCompanyId ?? null;

    return collectBillingFirstRecipients({
      tenantId,
      locationId: invoice.locationId,
      customerCompanyId,
      locationEmail: (location as any).email ?? null,
    });
  },

  async quote(tenantId: string, entityId: string): Promise<(string | null | undefined)[]> {
    const quote = await quoteRepository.getQuote(tenantId, entityId);
    if (!quote) throw createError(404, "Quote not found");

    const location = await storage.getClient(tenantId, quote.locationId);
    if (!location) return [];

    const customerCompanyId =
      (quote as any).customerCompanyId ?? (location as any).parentCompanyId ?? null;

    return collectBillingFirstRecipients({
      tenantId,
      locationId: quote.locationId,
      customerCompanyId,
      locationEmail: (location as any).email ?? null,
    });
  },

  async job(tenantId: string, entityId: string): Promise<(string | null | undefined)[]> {
    const job = await storage.getJob(tenantId, entityId);
    if (!job) throw createError(404, "Job not found");

    const locationId = (job as any).locationId;
    const location = (job as any).location ?? await storage.getClient(tenantId, locationId);
    if (!location) return [];

    const customerCompanyId = (location as any).parentCompanyId ?? null;
    const preferred = ["scheduling", "site", "primary"] as const;

    const out: (string | null | undefined)[] = [];

    // 1. Preferred-role contacts on the job's location.
    try {
      const locationContacts = await clientContactRepository.getLocationContacts(tenantId, locationId);
      for (const c of locationContacts) {
        if (hasAnyRole((c.assignment as any)?.roles, preferred)) out.push(c.email);
      }
    } catch {}

    // 2. Legacy location email.
    out.push((location as any).email ?? null);

    // 3. Customer-company primary contact fallback.
    if (customerCompanyId) {
      try {
        const directory = await clientContactRepository.getCompanyDirectory(tenantId, customerCompanyId);
        for (const p of directory) {
          if (p.isPrimary) out.push(p.email);
        }
      } catch {}
    }

    return out;
  },
};
