/**
 * QboInvoiceService - Create invoices in QuickBooks Online
 *
 * Handles:
 * - Creating invoices in QBO (create only, no updates in this phase)
 * - Validating invoices before sync
 * - All operations are idempotent
 *
 * CRITICAL RULES:
 * - Draft invoices must NEVER be synced
 * - Does NOT auto-sync. All syncs must be explicitly triggered.
 * - All failures are logged to qbo_sync_events.
 * - Enforces companyId isolation.
 */

import { db } from "../../db";
import { invoices, invoiceLines, clientLocations, customerCompanies, companies, items } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { Invoice, InvoiceLine, Client, CustomerCompany, QboMappingConfig } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboApiResponse, QboTokens } from "./QboClient";
import { QboSyncLogger } from "./QboSyncLogger";
import {
  toQboInvoicePayload,
  validateInvoiceForSync,
  type QBOInvoiceResponse,
} from "./QboMapper";
import { QboItemMapper, parseQboMappingConfig } from "./QboItemMapper";

export interface InvoiceSyncResult {
  success: boolean;
  qboInvoiceId?: string;
  qboSyncToken?: string;
  qboDocNumber?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * QboInvoiceService class for syncing invoices to QBO
 */
export class QboInvoiceService {
  private client: QboClient;
  private companyId: string;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string) {
    this.client = client;
    this.companyId = companyId;
    this.logger = new QboSyncLogger(companyId, triggeredBy);
  }

  /**
   * Create an invoice in QBO
   * IDEMPOTENT: If invoice already has qboInvoiceId, returns existing ID without re-creating
   *
   * CRITICAL: Draft invoices will be rejected and logged as skipped
   */
  async createInvoice(invoiceId: string): Promise<InvoiceSyncResult> {
    // Fetch the invoice with tenant isolation
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    // CRITICAL: Check if draft - drafts must NEVER sync
    if (invoice.status === "draft") {
      await this.logger.logInvoiceSkipped("INVOICE_CREATE", {
        invoiceId,
        reason: "Draft invoices cannot be synced to QBO",
      });
      return {
        success: false,
        skipped: true,
        skipReason: "Draft invoices cannot be synced to QBO",
      };
    }

    // IDEMPOTENT: If already synced, return existing IDs
    if (invoice.qboInvoiceId) {
      return {
        success: true,
        qboInvoiceId: invoice.qboInvoiceId,
        qboSyncToken: invoice.qboSyncToken || undefined,
        qboDocNumber: invoice.qboDocNumber || undefined,
      };
    }

    // Validate for sync
    const validation = validateInvoiceForSync(invoice);
    if (!validation.valid) {
      await this.logger.logInvoiceSkipped("INVOICE_CREATE", {
        invoiceId,
        reason: validation.reason!,
      });
      return { success: false, skipped: true, skipReason: validation.reason };
    }

    // Fetch location (required for invoice)
    const [location] = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.id, invoice.locationId),
          eq(clientLocations.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!location) {
      const error = "Invoice location not found";
      await this.logger.logInvoiceSkipped("INVOICE_CREATE", {
        invoiceId,
        reason: error,
      });
      return { success: false, skipped: true, skipReason: error };
    }

    // Fetch customer company if invoice has one
    let customerCompany: CustomerCompany | undefined;
    if (invoice.customerCompanyId) {
      const [company] = await db
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, invoice.customerCompanyId),
            eq(customerCompanies.companyId, this.companyId)
          )
        )
        .limit(1);
      customerCompany = company;
    }

    // Validate QBO customer exists
    const customerRefId = this.determineCustomerRefId(location, customerCompany);
    if (!customerRefId) {
      const error = "No QBO Customer ID available. Please sync the customer first.";
      await this.logger.logInvoiceSkipped("INVOICE_CREATE", {
        invoiceId,
        reason: error,
      });
      return { success: false, skipped: true, skipReason: error };
    }

    // Fetch invoice lines
    const lines = await db
      .select()
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.invoiceId, invoiceId),
          eq(invoiceLines.companyId, this.companyId)
        )
      )
      .orderBy(invoiceLines.lineNumber);

    // Fetch company's QBO mapping config
    const [company] = await db
      .select({ qboMappingConfig: companies.qboMappingConfig })
      .from(companies)
      .where(eq(companies.id, this.companyId))
      .limit(1);

    const mappingConfig = parseQboMappingConfig(company?.qboMappingConfig);
    const itemMapper = new QboItemMapper(mappingConfig);

    // Preflight validation: ensure all lines have valid QBO mappings
    if (lines.length > 0) {
      const preflightResult = itemMapper.preflightValidation(lines, true);
      if (!preflightResult.valid) {
        const invalidLineDetails = preflightResult.lines
          .filter(l => !l.valid)
          .map(l => `Line ${l.lineNumber} (${l.lineItemType}): ${l.errors.join("; ")}`)
          .join("\n");

        const actionableError = `Invoice sync blocked: ${preflightResult.summary}\n\n${invalidLineDetails}\n\nTo fix: Sync your catalog items to QuickBooks first (QBO Console > Catalog Sync), then retry.`;

        await this.logger.logInvoiceFailure("INVOICE_CREATE", {
          invoiceId,
          errorMessage: actionableError,
          requestPayload: { missingMappings: preflightResult.missingMappings },
        });

        // Update sync status to ERROR
        await this.updateInvoiceSyncStatus(invoiceId, null, null, null, "ERROR", preflightResult.summary);

        return { success: false, error: actionableError };
      }
    }

    // Fetch item qboItemIds for lines with productId set
    const productIds = lines
      .map(l => l.productId)
      .filter((id): id is string => id !== null && id !== undefined);

    let itemQboIds: Map<string, string> | null = null;
    if (productIds.length > 0) {
      const linkedItems = await db
        .select({ id: items.id, qboItemId: items.qboItemId })
        .from(items)
        .where(and(
          eq(items.companyId, this.companyId),
          inArray(items.id, productIds)
        ));

      itemQboIds = new Map();
      for (const item of linkedItems) {
        if (item.qboItemId) {
          itemQboIds.set(item.id, item.qboItemId);
        }
      }
    }

    // Build QBO payload with resolved mappings
    let payload;
    try {
      payload = toQboInvoicePayload(invoice, location, customerCompany, lines, false, mappingConfig, itemQboIds);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.logger.logInvoiceFailure("INVOICE_CREATE", {
        invoiceId,
        errorMessage,
      });
      return { success: false, error: errorMessage };
    }

    const startTime = Date.now();
    let response: QboApiResponse<QBOInvoiceResponse>;

    try {
      response = await this.client.createInvoice<QBOInvoiceResponse>(payload);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.logger.logInvoiceFailure("INVOICE_CREATE", {
        invoiceId,
        errorMessage,
        requestPayload: payload,
        durationMs,
      });

      // Update sync status to ERROR
      await this.updateInvoiceSyncStatus(invoiceId, null, null, null, "ERROR", errorMessage);

      return { success: false, error: errorMessage };
    }

    const durationMs = Date.now() - startTime;

    if (!response.success || !response.data) {
      const errorMessage = response.error?.message || "Unknown QBO error";
      const errorCode = response.error?.code;

      await this.logger.logInvoiceFailure("INVOICE_CREATE", {
        invoiceId,
        errorMessage,
        errorCode,
        requestPayload: payload,
        responsePayload: response.raw,
        durationMs,
      });

      // Update sync status to ERROR
      await this.updateInvoiceSyncStatus(invoiceId, null, null, null, "ERROR", errorMessage);

      return { success: false, error: errorMessage };
    }

    // Success - update local record with QBO IDs
    const qboInvoiceId = response.data.Id;
    const qboSyncToken = response.data.SyncToken;
    const qboDocNumber = response.data.DocNumber || null;

    await this.updateInvoiceSyncStatus(
      invoiceId,
      qboInvoiceId,
      qboSyncToken,
      qboDocNumber,
      "SYNCED",
      null
    );

    await this.logger.logInvoiceSuccess("INVOICE_CREATE", {
      invoiceId,
      qboInvoiceId,
      qboSyncToken,
      requestPayload: payload,
      responsePayload: response.data,
      durationMs,
    });

    return {
      success: true,
      qboInvoiceId,
      qboSyncToken,
      qboDocNumber: qboDocNumber || undefined,
    };
  }

  /**
   * Determine the QBO CustomerRef ID based on billing configuration
   * Returns the appropriate QBO Customer ID or null if not available
   */
  private determineCustomerRefId(
    location: Client,
    customerCompany?: CustomerCompany
  ): string | null {
    // If billWithParent is true and we have a parent company with QBO ID
    if (location.billWithParent && customerCompany?.qboCustomerId) {
      return customerCompany.qboCustomerId;
    }

    // Otherwise use location's QBO ID
    if (location.qboCustomerId) {
      return location.qboCustomerId;
    }

    return null;
  }

  /**
   * Update Invoice sync status and QBO fields
   */
  private async updateInvoiceSyncStatus(
    invoiceId: string,
    qboInvoiceId: string | null,
    qboSyncToken: string | null,
    qboDocNumber: string | null,
    syncStatus: string,
    syncError: string | null
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      qboSyncStatus: syncStatus,
      qboSyncError: syncError,
      dirty: false, // Clear dirty flag on sync
      updatedAt: new Date(),
    };

    if (qboInvoiceId) {
      updateData.qboInvoiceId = qboInvoiceId;
      updateData.qboSyncToken = qboSyncToken;
      updateData.qboDocNumber = qboDocNumber;
      updateData.qboLastSyncedAt = new Date();
    }

    await db
      .update(invoices)
      .set(updateData)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.companyId, this.companyId)
        )
      );
  }
}

/**
 * Create a QboInvoiceService instance
 */
export function createInvoiceService(
  tokens: QboTokens,
  companyId: string,
  triggeredBy?: string
): QboInvoiceService | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new QboClient({ clientId, clientSecret, environment }, tokens);
  return new QboInvoiceService(client, companyId, triggeredBy);
}
