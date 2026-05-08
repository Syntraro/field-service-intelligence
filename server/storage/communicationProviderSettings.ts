/**
 * Communication Provider Settings storage — Phase 5 (2026-05-08).
 *
 * Tenant-scoped CRUD for `communication_provider_settings`. The
 * encryption boundary lives here:
 *   * Writes accept plaintext credential / webhook secret, seal them
 *     with `providerCredentialCrypto.sealCredential`, and persist the
 *     three base64 columns (`encrypted_*`, `*_iv`, `*_tag`).
 *   * Reads marked "for server use" return a `ResolvedProviderSettings`
 *     with the decrypted credential + webhook secret materialized.
 *     Plaintext lives only on the request stack — callers MUST NOT
 *     persist or log it.
 *   * The public DTO (`toPublic`) strips every secret-bearing column
 *     and is the only shape returned to clients.
 *
 * One-active-per-tenant invariant is enforced at the DB layer by the
 * partial unique index in the migration. The storage layer provides a
 * convenience `getActiveForCompany` for the common "outbound send"
 * lookup and surfaces unique-violation errors with a user-friendly
 * message on activation.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  communicationProviderSettings,
  type CommunicationProviderSettingsRow,
} from "@shared/schema";
import { normalizePhoneForMatch } from "@shared/phoneNormalization";
import {
  isCommunicationProviderId,
  type CommunicationProviderId,
  type ProviderSettingsPublic,
  type ResolvedProviderSettings,
} from "../services/communications/providers";
import {
  openCredential,
  sealCredential,
} from "../services/communications/providerCredentialCrypto";

interface UpsertProviderSettingsInput {
  companyId: string;
  providerId: CommunicationProviderId;
  phoneNumber: string;
  /** Plaintext account identifier (Twilio AccountSid). Optional. */
  accountIdentifier?: string | null;
  /** Plaintext credential to seal. */
  credential: string;
  /** Plaintext webhook secret to seal. */
  webhookSecret: string;
  isActive?: boolean;
}

function rowToPublic(row: CommunicationProviderSettingsRow): ProviderSettingsPublic {
  const sid = row.accountIdentifier;
  const last4 = sid && sid.length >= 4 ? sid.slice(-4) : null;
  // The providerId column is text — the storage layer is the right
  // place to narrow back to the union. Unknown values surface as a
  // throw so a corrupted row can never escape as an "unknown" provider.
  if (!isCommunicationProviderId(row.providerId)) {
    throw new Error(
      `communication_provider_settings.id=${row.id} carries unknown provider_id=${row.providerId}`,
    );
  }
  return {
    providerId: row.providerId,
    phoneNumber: row.phoneNumber,
    isActive: row.isActive,
    accountIdentifierLast4: last4,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToResolved(row: CommunicationProviderSettingsRow): ResolvedProviderSettings {
  if (!isCommunicationProviderId(row.providerId)) {
    throw new Error(
      `communication_provider_settings.id=${row.id} carries unknown provider_id=${row.providerId}`,
    );
  }
  const credential = openCredential({
    encrypted: row.encryptedCredential,
    iv: row.credentialIv,
    tag: row.credentialTag,
  });
  const webhookSecret = openCredential({
    encrypted: row.encryptedWebhookSecret,
    iv: row.webhookSecretIv,
    tag: row.webhookSecretTag,
  });
  return {
    id: row.id,
    companyId: row.companyId,
    providerId: row.providerId,
    phoneNumber: row.phoneNumber,
    normalizedPhone: row.normalizedPhone,
    isActive: row.isActive,
    accountIdentifier: row.accountIdentifier,
    credential,
    webhookSecret,
  };
}

/**
 * Insert or replace the (company_id, provider_id) row. Existing row
 * for the same pair is updated in place; activation enforced via the
 * partial unique index — callers wishing to flip the active provider
 * MUST first deactivate the prior one in the same transaction.
 */
export async function upsertProviderSettings(
  input: UpsertProviderSettingsInput,
): Promise<ProviderSettingsPublic> {
  const sealedCredential = sealCredential(input.credential);
  const sealedWebhook = sealCredential(input.webhookSecret);
  const normalizedPhone = normalizePhoneForMatch(input.phoneNumber);
  if (!normalizedPhone) {
    throw new Error(
      "upsertProviderSettings: phoneNumber must normalize to at least one digit",
    );
  }
  const isActive = input.isActive ?? false;
  return await db.transaction(async (tx) => {
    if (isActive) {
      // Deactivate any other rows for this tenant so the partial
      // unique index doesn't conflict on insert.
      await tx
        .update(communicationProviderSettings)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(communicationProviderSettings.companyId, input.companyId),
            eq(communicationProviderSettings.isActive, true),
          ),
        );
    }
    const [existing] = await tx
      .select()
      .from(communicationProviderSettings)
      .where(
        and(
          eq(communicationProviderSettings.companyId, input.companyId),
          eq(communicationProviderSettings.providerId, input.providerId),
        ),
      )
      .limit(1);
    let row: CommunicationProviderSettingsRow;
    if (existing) {
      const [updated] = await tx
        .update(communicationProviderSettings)
        .set({
          phoneNumber: input.phoneNumber,
          normalizedPhone,
          accountIdentifier: input.accountIdentifier ?? null,
          encryptedCredential: sealedCredential.encrypted,
          credentialIv: sealedCredential.iv,
          credentialTag: sealedCredential.tag,
          encryptedWebhookSecret: sealedWebhook.encrypted,
          webhookSecretIv: sealedWebhook.iv,
          webhookSecretTag: sealedWebhook.tag,
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(communicationProviderSettings.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [inserted] = await tx
        .insert(communicationProviderSettings)
        .values({
          companyId: input.companyId,
          providerId: input.providerId,
          phoneNumber: input.phoneNumber,
          normalizedPhone,
          accountIdentifier: input.accountIdentifier ?? null,
          encryptedCredential: sealedCredential.encrypted,
          credentialIv: sealedCredential.iv,
          credentialTag: sealedCredential.tag,
          encryptedWebhookSecret: sealedWebhook.encrypted,
          webhookSecretIv: sealedWebhook.iv,
          webhookSecretTag: sealedWebhook.tag,
          isActive,
        })
        .returning();
      row = inserted;
    }
    return rowToPublic(row);
  });
}

/**
 * The public DTO shape — listing every configured provider for the
 * tenant. Returns plaintext-free rows, safe to send to the client.
 */
export async function listProviderSettingsForCompany(
  companyId: string,
): Promise<ProviderSettingsPublic[]> {
  const rows = await db
    .select()
    .from(communicationProviderSettings)
    .where(eq(communicationProviderSettings.companyId, companyId));
  return rows.map(rowToPublic);
}

/**
 * Read-only lookup for the outbound-SMS route. Returns the active row
 * with credential + webhook secret decrypted onto the request stack.
 * Returns `null` if the tenant has no active provider — callers
 * surface a clean "Connect a phone provider to send SMS." error.
 *
 * IMPORTANT: never log the returned object. Treat plaintext fields as
 * having the lifetime of the calling request.
 */
export async function getActiveForCompany(
  companyId: string,
): Promise<ResolvedProviderSettings | null> {
  const [row] = await db
    .select()
    .from(communicationProviderSettings)
    .where(
      and(
        eq(communicationProviderSettings.companyId, companyId),
        eq(communicationProviderSettings.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  return rowToResolved(row);
}

/**
 * Inbound-webhook lookup. The webhook URL carries `:providerId`; the
 * route uses the parsed provider id to find the matching active row
 * for the tenant. Webhook routes have no user session, so the tenant
 * is derived from the signed payload (the row that verifies the
 * signature is by definition the tenant that owns the inbound).
 *
 * Today's MVP: one tenant per (provider_id, normalized phone) pairing.
 * The route looks up by `providerId` + the inbound payload's `To`
 * number (the tenant's number on the provider). If multiple tenants
 * shared the same provider id with different numbers, this lookup is
 * the disambiguator.
 */
export async function findActiveByProviderAndNormalizedPhone(
  providerId: CommunicationProviderId,
  normalizedTenantPhone: string,
): Promise<ResolvedProviderSettings | null> {
  const [row] = await db
    .select()
    .from(communicationProviderSettings)
    .where(
      and(
        eq(communicationProviderSettings.providerId, providerId),
        eq(communicationProviderSettings.normalizedPhone, normalizedTenantPhone),
        eq(communicationProviderSettings.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;
  return rowToResolved(row);
}

/** Public DTO type re-export so route handlers don't need a separate import. */
export type { ProviderSettingsPublic, ResolvedProviderSettings };
