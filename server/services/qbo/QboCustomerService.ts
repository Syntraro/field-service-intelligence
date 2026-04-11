/**
 * QboCustomerService - Create/update customers in QuickBooks Online
 *
 * Handles:
 * - Creating parent customers (CustomerCompany)
 * - Creating sub-customers (Client/Location)
 * - Updating existing customers
 * - All operations are idempotent
 *
 * IMPORTANT:
 * - Does NOT auto-sync. All syncs must be explicitly triggered.
 * - All failures are logged to qbo_sync_events.
 * - Enforces companyId isolation.
 */

import { db } from "../../db";
import { customerCompanies, clientLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { CustomerCompany, Client } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboApiResponse, QboTokens } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";
import {
  mapCustomerCompanyToQBO,
  mapClientToQBOSubCustomer,
  mapStandaloneClientToQBO,
  validateCustomerCompanyForSync,
  validateClientLocationForSync,
  type QBOCustomerResponse,
} from "./QboMapper";

export interface CustomerSyncResult {
  success: boolean;
  qboCustomerId?: string;
  qboSyncToken?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * QboCustomerService class for syncing customers to QBO
 */
export class QboCustomerService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Create or update a CustomerCompany in QBO
   * IDEMPOTENT: If already synced, performs update. If not, creates new.
   */
  async syncCustomerCompany(customerCompanyId: string): Promise<CustomerSyncResult> {
    // Fetch the customer company with tenant isolation
    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!company) {
      return { success: false, error: "Customer company not found" };
    }

    // Validate for sync
    const validation = validateCustomerCompanyForSync(company);
    if (!validation.valid) {
      await this.logger.logCustomerSkipped(
        company.qboCustomerId ? "CUSTOMER_UPDATE" : "CUSTOMER_CREATE",
        { customerCompanyId, reason: validation.reason! }
      );
      return { success: false, skipped: true, skipReason: validation.reason };
    }

    const isUpdate = Boolean(company.qboCustomerId);
    const eventType = isUpdate ? "CUSTOMER_UPDATE" : "CUSTOMER_CREATE";

    // Build QBO payload
    const payload = mapCustomerCompanyToQBO(company, isUpdate);

    const startTime = Date.now();
    let response: QboApiResponse<QBOCustomerResponse>;

    try {
      if (isUpdate) {
        response = await this.client.updateCustomer<QBOCustomerResponse>(payload);
      } else {
        response = await this.client.createCustomer<QBOCustomerResponse>(payload);
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logCustomerFailure(eventType, {
        customerCompanyId,
        errorMessage,
        requestPayload: payload,
        durationMs,
      });

      // Update sync status to ERROR
      await this.updateCustomerCompanySyncStatus(customerCompanyId, null, null, "ERROR", errorMessage);

      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logCustomerFailure(eventType, {
        customerCompanyId,
        errorMessage,
        errorCode,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs,
      });

      // Update sync status to ERROR
      await this.updateCustomerCompanySyncStatus(customerCompanyId, null, null, "ERROR", errorMessage);

      return { success: false, error: errorMessage };
    }

    // Success - update local record with QBO IDs
    const qboCustomerId = response.data.Id;
    const qboSyncToken = response.data.SyncToken;

    await this.updateCustomerCompanySyncStatus(
      customerCompanyId,
      qboCustomerId,
      qboSyncToken,
      "SYNCED",
      null
    );

    await this.logger.logCustomerSuccess(eventType, {
      customerCompanyId,
      qboCustomerId,
      qboSyncToken,
      requestPayload: payload,
      responsePayload: response.data,
      durationMs,
    });

    return { success: true, qboCustomerId, qboSyncToken };
  }

  /**
   * Create or update a Client Location in QBO as a sub-customer
   * IDEMPOTENT: If already synced, performs update. If not, creates new.
   */
  async syncClientLocation(clientLocationId: string): Promise<CustomerSyncResult> {
    // Fetch the client location with tenant isolation
    const [client] = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.id, clientLocationId),
          eq(clientLocations.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!client) {
      return { success: false, error: "Client location not found" };
    }

    // If client has a parent company, fetch it
    let parentCompany: CustomerCompany | null = null;
    if (client.parentCompanyId) {
      const [company] = await db
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, client.parentCompanyId),
            eq(customerCompanies.companyId, this.companyId)
          )
        )
        .limit(1);
      parentCompany = company ?? null;
    }

    // Validate for sync
    const validation = validateClientLocationForSync(client, parentCompany);
    if (!validation.valid) {
      await this.logger.logCustomerSkipped(
        client.qboCustomerId ? "CUSTOMER_UPDATE" : "CUSTOMER_CREATE",
        { clientLocationId, reason: validation.reason! }
      );
      return { success: false, skipped: true, skipReason: validation.reason };
    }

    const isUpdate = Boolean(client.qboCustomerId);
    const eventType = isUpdate ? "CUSTOMER_UPDATE" : "CUSTOMER_CREATE";

    // Build QBO payload based on whether client has a parent
    let payload;
    if (parentCompany && parentCompany.qboCustomerId) {
      // Create as sub-customer of parent
      payload = mapClientToQBOSubCustomer(
        client,
        parentCompany.name ?? "",
        parentCompany.qboCustomerId,
        isUpdate
      );
    } else {
      // Create as standalone customer
      payload = mapStandaloneClientToQBO(client, isUpdate);
    }

    const startTime = Date.now();
    let response: QboApiResponse<QBOCustomerResponse>;

    try {
      if (isUpdate) {
        response = await this.client.updateCustomer<QBOCustomerResponse>(payload);
      } else {
        response = await this.client.createCustomer<QBOCustomerResponse>(payload);
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logCustomerFailure(eventType, {
        clientLocationId,
        errorMessage,
        requestPayload: payload,
        durationMs,
      });

      // Update sync status - client locations don't have qboSyncStatus field yet
      // so we just update the QBO fields

      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logCustomerFailure(eventType, {
        clientLocationId,
        errorMessage,
        errorCode,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs,
      });

      return { success: false, error: errorMessage };
    }

    // Success - update local record with QBO IDs
    const qboCustomerId = response.data.Id;
    const qboSyncToken = response.data.SyncToken;

    await this.updateClientLocationQboFields(
      clientLocationId,
      qboCustomerId,
      qboSyncToken,
      parentCompany?.qboCustomerId || null
    );

    await this.logger.logCustomerSuccess(eventType, {
      clientLocationId,
      qboCustomerId,
      qboSyncToken,
      requestPayload: payload,
      responsePayload: response.data,
      durationMs,
    });

    return { success: true, qboCustomerId, qboSyncToken };
  }

  /**
   * Update CustomerCompany sync status and QBO fields
   */
  private async updateCustomerCompanySyncStatus(
    customerCompanyId: string,
    qboCustomerId: string | null,
    qboSyncToken: string | null,
    syncStatus: string,
    syncError: string | null
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      qboSyncStatus: syncStatus,
      qboSyncError: syncError,
      updatedAt: new Date(),
    };

    if (qboCustomerId) {
      updateData.qboCustomerId = qboCustomerId;
      updateData.qboSyncToken = qboSyncToken;
      updateData.qboLastSyncedAt = new Date();
    }

    await db
      .update(customerCompanies)
      .set(updateData)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, this.companyId)
        )
      );
  }

  /**
   * Update ClientLocation QBO fields
   */
  private async updateClientLocationQboFields(
    clientLocationId: string,
    qboCustomerId: string,
    qboSyncToken: string,
    qboParentCustomerId: string | null
  ): Promise<void> {
    await db
      .update(clientLocations)
      .set({
        qboCustomerId,
        qboSyncToken,
        qboParentCustomerId,
        qboLastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clientLocations.id, clientLocationId),
          eq(clientLocations.companyId, this.companyId)
        )
      );
  }
}

/**
 * Create a QboCustomerService instance
 */
export function createCustomerService(
  tokens: QboTokens,
  companyId: string,
  triggeredBy?: string
): QboCustomerService | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new QboClient({ clientId, clientSecret, environment }, tokens);
  return new QboCustomerService(client, companyId, triggeredBy);
}
