/**
 * Customer-company payment service — provider-customer resolver
 * (PR A, 2026-05-03).
 *
 * Owns the lazy "create-or-get" of `customer_companies.provider_customer_id`
 * for the saved-card flow. Provider-neutral: routes through the
 * `PaymentProvider.createCustomer` adapter call so the Stripe SDK stays
 * confined to `stripeAdapter.ts`.
 *
 * Why this lives in services/ and not storage/:
 *   - It coordinates the provider SDK call with a DB write. Storage
 *     repositories are pure data access by convention; coordination
 *     across boundaries is the service layer's job.
 *
 * Idempotency contract:
 *   1. Read `customer_companies.provider_customer_id`. If present →
 *      return it. No provider call, no DB write.
 *   2. If null, the resolver opens (or joins) a transaction, locks the
 *      row, RE-reads. If another concurrent caller minted one in
 *      between, return that. (`SELECT … FOR UPDATE` semantics.)
 *   3. Otherwise call `provider.createCustomer({ name, email,
 *      metadata })` and persist the returned id.
 *
 * Concurrency safety:
 *   - A `SELECT … FOR UPDATE` on the customer_companies row prevents
 *     two requests racing to mint two Stripe customers for the same
 *     bill-to party.
 *   - The `customer_companies_company_provider_customer_id_uq` partial
 *     unique index is the DB-level safety net: even if the lock leaks,
 *     a second concurrent INSERT would 23505.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customerCompanies } from "@shared/schema";
import { createError } from "../middleware/errorHandler";
import { resolveForCompany } from "./payments/providers/resolver";
import type { ProviderId } from "./payments/providers/types";

export interface ResolveOrCreateProviderCustomerInput {
  companyId: string;
  customerCompanyId: string;
  /**
   * Provider id. PR A only supports Stripe, but the parameter is here
   * so the dispatch shape is correct for future providers — we route
   * through `resolveForCompany` regardless.
   */
  provider?: ProviderId;
  /**
   * 2026-05-03 PR4 — Required. Connect Direct Charges puts customers
   * on the connected account, not the platform. Caller passes the
   * tenant's active `payment_provider_accounts.providerAccountId` so
   * the adapter mints the customer in the correct namespace.
   */
  providerAccountId: string;
}

export interface ResolveOrCreateProviderCustomerResult {
  providerCustomerId: string;
  /** True when this call minted the Customer object; false on cache hit. */
  created: boolean;
  providerSource: ProviderId;
}

/**
 * Idempotent resolve-or-create. Returns the provider customer id for the
 * given (tenant, customer-company) pair, minting one at the provider on
 * first call.
 *
 * Tenant + customer-company are validated; cross-tenant reads return
 * 404 (the row simply isn't found under the wrong companyId).
 */
export async function resolveOrCreateProviderCustomer(
  input: ResolveOrCreateProviderCustomerInput,
): Promise<ResolveOrCreateProviderCustomerResult> {
  const { companyId, customerCompanyId, providerAccountId } = input;
  if (!companyId) throw createError(400, "companyId is required");
  if (!customerCompanyId) throw createError(400, "customerCompanyId is required");
  if (!providerAccountId) throw createError(400, "providerAccountId is required");

  // 1. Fast path — no transaction needed when the value is already set.
  const [existing] = await db
    .select({
      id: customerCompanies.id,
      providerCustomerId: customerCompanies.providerCustomerId,
      name: customerCompanies.name,
      email: customerCompanies.email,
      firstName: customerCompanies.firstName,
      lastName: customerCompanies.lastName,
    })
    .from(customerCompanies)
    .where(
      and(
        eq(customerCompanies.id, customerCompanyId),
        eq(customerCompanies.companyId, companyId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw createError(404, "Customer company not found");
  }
  if (existing.providerCustomerId) {
    return {
      providerCustomerId: existing.providerCustomerId,
      created: false,
      providerSource: "stripe",
    };
  }

  // 2. Slow path — open a transaction, lock the row, re-read. If a
  //    concurrent caller minted one in between we return that without
  //    calling the provider.
  const provider = resolveForCompany(companyId);
  if (!provider.createCustomer) {
    throw createError(
      501,
      `Provider "${provider.id}" does not support createCustomer; saved cards require it`,
    );
  }

  return await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: customerCompanies.id,
        providerCustomerId: customerCompanies.providerCustomerId,
        name: customerCompanies.name,
        email: customerCompanies.email,
        firstName: customerCompanies.firstName,
        lastName: customerCompanies.lastName,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId),
        ),
      )
      .for("update")
      .limit(1);
    if (!locked) {
      throw createError(404, "Customer company not found");
    }
    if (locked.providerCustomerId) {
      // Concurrent caller won the race.
      return {
        providerCustomerId: locked.providerCustomerId,
        created: false,
        providerSource: provider.id,
      };
    }

    // Display name passed to the provider. Fall back gracefully:
    //   1. customer_companies.name (the company-as-primary case)
    //   2. firstName + lastName (residential / person-as-primary)
    //   3. customerCompanyId (truly nameless edge — the provider needs
    //      *something* on the Customer object).
    const personName = `${locked.firstName ?? ""} ${locked.lastName ?? ""}`.trim();
    const displayName = locked.name?.trim() || personName || locked.id;

    const result = await provider.createCustomer!({
      name: displayName,
      email: locked.email ?? null,
      metadata: {
        companyId,
        customerCompanyId,
      },
      providerAccountId,
    });

    // Persist. The partial unique index
    // `customer_companies_company_provider_customer_id_uq` is the
    // belt-and-suspenders DB guard against the lock leaking.
    await tx
      .update(customerCompanies)
      .set({
        providerCustomerId: result.providerCustomerId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId),
          // NULL guard — paranoia in case the lock leaked AND the unique
          // index missed (it can't, but the predicate documents intent).
          sql`provider_customer_id is null`,
        ),
      );

    return {
      providerCustomerId: result.providerCustomerId,
      created: true,
      providerSource: provider.id,
    };
  });
}

export const customerCompanyPaymentService = {
  resolveOrCreateProviderCustomer,
};
