/**
 * QboSyncOrchestrator - Coordinates QBO sync operations
 *
 * Orchestrates syncing entities to QuickBooks Online in the correct order:
 * 1. CustomerCompany (parent customer)
 * 2. ClientLocation (sub-customer)
 * 3. Invoice
 *
 * IMPORTANT RULES:
 * - All syncs must be explicitly triggered (no auto-sync)
 * - Draft invoices are always skipped
 * - Never throws; returns structured results
 * - Enforces companyId isolation
 * - All operations are idempotent
 *
 * Usage:
 * ```typescript
 * const orchestrator = createSyncOrchestrator(tokens, companyId, userId);
 *
 * // Sync single invoice with all dependencies
 * const result = await orchestrator.syncInvoiceWithDependencies(invoiceId);
 *
 * // Sync multiple invoices
 * const results = await orchestrator.syncInvoices([id1, id2, id3]);
 * ```
 */

import { db } from "../../db";
import { invoices, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { Invoice, Client, CustomerCompany } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboTokens } from "./QboClient";
import { QboCustomerService } from "./QboCustomerService";
import type { CustomerSyncResult } from "./QboCustomerService";
import { QboInvoiceService } from "./QboInvoiceService";
import type { InvoiceSyncResult } from "./QboInvoiceService";
import { QboSyncLogger } from "./QboSyncLogger";

// ============================================================
// RESULT TYPES
// ============================================================

export interface EntitySyncResult {
  entityType: "customer_company" | "client_location" | "invoice";
  entityId: string;
  success: boolean;
  qboId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface InvoiceSyncWithDepsResult {
  invoice: EntitySyncResult;
  customerCompany?: EntitySyncResult;
  clientLocation?: EntitySyncResult;
  overallSuccess: boolean;
  errors: string[];
}

export interface BatchSyncResult {
  totalRequested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: EntitySyncResult[];
  errors: string[];
}

export interface FullSyncResult {
  customerCompanies: BatchSyncResult;
  clientLocations: BatchSyncResult;
  invoices: BatchSyncResult;
  overallSuccess: boolean;
  totalErrors: string[];
}

// ============================================================
// ORCHESTRATOR CLASS
// ============================================================

/**
 * QboSyncOrchestrator coordinates sync operations across entity types
 */
export class QboSyncOrchestrator {
  private client: QboClient;
  private companyId: string;
  private triggeredBy: string | undefined;
  private syncRunId: string | undefined;
  private customerService: QboCustomerService;
  private invoiceService: QboInvoiceService;
  private logger: QboSyncLogger;

  constructor(client: QboClient, companyId: string, triggeredBy?: string, syncRunId?: string) {
    this.client = client;
    this.companyId = companyId;
    this.triggeredBy = triggeredBy;
    this.syncRunId = syncRunId;
    this.customerService = new QboCustomerService(client, companyId, triggeredBy);
    this.invoiceService = new QboInvoiceService(client, companyId, triggeredBy);
    this.logger = new QboSyncLogger(companyId, triggeredBy, syncRunId);
  }

  // ============================================================
  // SINGLE ENTITY SYNC
  // ============================================================

  /**
   * Sync a single CustomerCompany to QBO
   * Returns structured result, never throws
   */
  async syncCustomerCompany(customerCompanyId: string): Promise<EntitySyncResult> {
    try {
      const result = await this.customerService.syncCustomerCompany(customerCompanyId);
      return this.toEntityResult("customer_company", customerCompanyId, result);
    } catch (err) {
      return {
        entityType: "customer_company",
        entityId: customerCompanyId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Sync a single ClientLocation to QBO
   * Returns structured result, never throws
   */
  async syncClientLocation(clientLocationId: string): Promise<EntitySyncResult> {
    try {
      const result = await this.customerService.syncClientLocation(clientLocationId);
      return this.toEntityResult("client_location", clientLocationId, result);
    } catch (err) {
      return {
        entityType: "client_location",
        entityId: clientLocationId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Sync a single Invoice to QBO (without syncing dependencies)
   * Returns structured result, never throws
   */
  async syncInvoice(invoiceId: string): Promise<EntitySyncResult> {
    try {
      const result = await this.invoiceService.createInvoice(invoiceId);
      return this.toEntityResult("invoice", invoiceId, result);
    } catch (err) {
      return {
        entityType: "invoice",
        entityId: invoiceId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ============================================================
  // INVOICE SYNC WITH DEPENDENCIES
  // ============================================================

  /**
   * Sync an invoice with all its dependencies in correct order:
   * 1. CustomerCompany (if exists and not already synced)
   * 2. ClientLocation (if not already synced)
   * 3. Invoice
   *
   * This ensures the QBO CustomerRef is available before invoice creation.
   * Returns structured result, never throws.
   */
  async syncInvoiceWithDependencies(invoiceId: string): Promise<InvoiceSyncWithDepsResult> {
    const errors: string[] = [];
    let customerCompanyResult: EntitySyncResult | undefined;
    let clientLocationResult: EntitySyncResult | undefined;

    // Fetch invoice with tenant isolation
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
      return {
        invoice: {
          entityType: "invoice",
          entityId: invoiceId,
          success: false,
          error: "Invoice not found",
        },
        overallSuccess: false,
        errors: ["Invoice not found"],
      };
    }

    // Skip draft invoices early
    if (invoice.status === "draft") {
      return {
        invoice: {
          entityType: "invoice",
          entityId: invoiceId,
          success: false,
          skipped: true,
          skipReason: "Draft invoices cannot be synced to QBO",
        },
        overallSuccess: false,
        errors: [],
      };
    }

    // Fetch location
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
      return {
        invoice: {
          entityType: "invoice",
          entityId: invoiceId,
          success: false,
          error: "Invoice location not found",
        },
        overallSuccess: false,
        errors: ["Invoice location not found"],
      };
    }

    // Step 1: Sync CustomerCompany if exists and not already synced
    if (invoice.customerCompanyId) {
      const [customerCompany] = await db
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, invoice.customerCompanyId),
            eq(customerCompanies.companyId, this.companyId)
          )
        )
        .limit(1);

      if (customerCompany && !customerCompany.qboCustomerId) {
        customerCompanyResult = await this.syncCustomerCompany(invoice.customerCompanyId);
        if (!customerCompanyResult.success && !customerCompanyResult.skipped) {
          errors.push(`CustomerCompany sync failed: ${customerCompanyResult.error}`);
        }
      } else if (customerCompany?.qboCustomerId) {
        // Already synced - return success without re-syncing
        customerCompanyResult = {
          entityType: "customer_company",
          entityId: invoice.customerCompanyId,
          success: true,
          qboId: customerCompany.qboCustomerId,
          skipped: true,
          skipReason: "Already synced to QBO",
        };
      }
    }

    // Step 2: Sync ClientLocation if not already synced
    if (!location.qboCustomerId) {
      clientLocationResult = await this.syncClientLocation(invoice.locationId);
      if (!clientLocationResult.success && !clientLocationResult.skipped) {
        errors.push(`ClientLocation sync failed: ${clientLocationResult.error}`);
      }
    } else {
      // Already synced - return success without re-syncing
      clientLocationResult = {
        entityType: "client_location",
        entityId: invoice.locationId,
        success: true,
        qboId: location.qboCustomerId,
        skipped: true,
        skipReason: "Already synced to QBO",
      };
    }

    // Step 3: Sync Invoice
    // Only proceed if we have a QBO customer reference available
    const hasCustomerRef = await this.hasQboCustomerRef(invoice.locationId, invoice.customerCompanyId);

    let invoiceResult: EntitySyncResult;
    if (!hasCustomerRef) {
      invoiceResult = {
        entityType: "invoice",
        entityId: invoiceId,
        success: false,
        skipped: true,
        skipReason: "No QBO Customer ID available after dependency sync",
      };
      errors.push("Invoice skipped: No QBO Customer ID available");
    } else {
      invoiceResult = await this.syncInvoice(invoiceId);
      if (!invoiceResult.success && !invoiceResult.skipped) {
        errors.push(`Invoice sync failed: ${invoiceResult.error}`);
      }
    }

    const overallSuccess = invoiceResult.success || (invoiceResult.skipped === true);

    return {
      invoice: invoiceResult,
      customerCompany: customerCompanyResult,
      clientLocation: clientLocationResult,
      overallSuccess,
      errors,
    };
  }

  // ============================================================
  // BATCH SYNC OPERATIONS
  // ============================================================

  /**
   * Sync multiple CustomerCompanies
   * Returns structured batch result, never throws
   */
  async syncCustomerCompanies(customerCompanyIds: string[]): Promise<BatchSyncResult> {
    const results: EntitySyncResult[] = [];
    const errors: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const id of customerCompanyIds) {
      const result = await this.syncCustomerCompany(id);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`CustomerCompany ${id}: ${result.error}`);
        }
      }
    }

    return {
      totalRequested: customerCompanyIds.length,
      succeeded,
      failed,
      skipped,
      results,
      errors,
    };
  }

  /**
   * Sync multiple ClientLocations
   * Returns structured batch result, never throws
   */
  async syncClientLocations(clientLocationIds: string[]): Promise<BatchSyncResult> {
    const results: EntitySyncResult[] = [];
    const errors: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const id of clientLocationIds) {
      const result = await this.syncClientLocation(id);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`ClientLocation ${id}: ${result.error}`);
        }
      }
    }

    return {
      totalRequested: clientLocationIds.length,
      succeeded,
      failed,
      skipped,
      results,
      errors,
    };
  }

  /**
   * Sync multiple Invoices (without dependencies)
   * Returns structured batch result, never throws
   */
  async syncInvoices(invoiceIds: string[]): Promise<BatchSyncResult> {
    const results: EntitySyncResult[] = [];
    const errors: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const id of invoiceIds) {
      const result = await this.syncInvoice(id);
      results.push(result);

      if (result.success) {
        succeeded++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`Invoice ${id}: ${result.error}`);
        }
      }
    }

    return {
      totalRequested: invoiceIds.length,
      succeeded,
      failed,
      skipped,
      results,
      errors,
    };
  }

  /**
   * Sync multiple Invoices with their dependencies
   * Returns structured batch result, never throws
   */
  async syncInvoicesWithDependencies(invoiceIds: string[]): Promise<BatchSyncResult> {
    const results: EntitySyncResult[] = [];
    const errors: string[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const id of invoiceIds) {
      const depResult = await this.syncInvoiceWithDependencies(id);

      // Add the invoice result to batch results
      results.push(depResult.invoice);

      if (depResult.invoice.success) {
        succeeded++;
      } else if (depResult.invoice.skipped) {
        skipped++;
      } else {
        failed++;
      }

      // Collect any errors
      errors.push(...depResult.errors);
    }

    return {
      totalRequested: invoiceIds.length,
      succeeded,
      failed,
      skipped,
      results,
      errors,
    };
  }

  // ============================================================
  // FULL SYNC (all entities in correct order)
  // ============================================================

  /**
   * Sync all unsynced entities for the company in correct order:
   * 1. All CustomerCompanies without qboCustomerId
   * 2. All ClientLocations without qboCustomerId
   * 3. All Invoices without qboInvoiceId (excluding drafts)
   *
   * Returns structured result, never throws
   */
  async syncAllUnsynced(): Promise<FullSyncResult> {
    const totalErrors: string[] = [];

    // Step 1: Get and sync unsynced CustomerCompanies
    const unsyncedCompanies = await db
      .select({ id: customerCompanies.id })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, this.companyId),
          eq(customerCompanies.isActive, true)
        )
      );

    // Filter to only those without QBO ID
    const companyIdsToSync = unsyncedCompanies
      .map(c => c.id);

    // Fetch full records to check qboCustomerId
    const companiesToCheck = companyIdsToSync.length > 0
      ? await db
          .select()
          .from(customerCompanies)
          .where(
            and(
              eq(customerCompanies.companyId, this.companyId),
              inArray(customerCompanies.id, companyIdsToSync)
            )
          )
      : [];

    const unsyncedCompanyIds = companiesToCheck
      .filter(c => !c.qboCustomerId && c.isActive && !c.deletedAt)
      .map(c => c.id);

    const customerCompaniesResult = await this.syncCustomerCompanies(unsyncedCompanyIds);
    totalErrors.push(...customerCompaniesResult.errors);

    // Step 2: Get and sync unsynced ClientLocations
    const locationsToCheck = await db
      .select()
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.companyId, this.companyId)
        )
      );

    const unsyncedLocationIds = locationsToCheck
      .filter(l => !l.qboCustomerId && !l.inactive && !l.deletedAt)
      .map(l => l.id);

    const clientLocationsResult = await this.syncClientLocations(unsyncedLocationIds);
    totalErrors.push(...clientLocationsResult.errors);

    // Step 3: Get and sync unsynced Invoices (excluding drafts)
    const invoicesToCheck = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, this.companyId),
          eq(invoices.isActive, true)
        )
      );

    const unsyncedInvoiceIds = invoicesToCheck
      .filter(i => !i.qboInvoiceId && i.status !== "draft" && !i.deletedAt)
      .map(i => i.id);

    const invoicesResult = await this.syncInvoices(unsyncedInvoiceIds);
    totalErrors.push(...invoicesResult.errors);

    const overallSuccess =
      customerCompaniesResult.failed === 0 &&
      clientLocationsResult.failed === 0 &&
      invoicesResult.failed === 0;

    return {
      customerCompanies: customerCompaniesResult,
      clientLocations: clientLocationsResult,
      invoices: invoicesResult,
      overallSuccess,
      totalErrors,
    };
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  /**
   * Convert service result to entity result
   */
  private toEntityResult(
    entityType: EntitySyncResult["entityType"],
    entityId: string,
    result: CustomerSyncResult | InvoiceSyncResult
  ): EntitySyncResult {
    const baseResult: EntitySyncResult = {
      entityType,
      entityId,
      success: result.success,
    };

    if (result.success) {
      baseResult.qboId =
        (result as CustomerSyncResult).qboCustomerId ||
        (result as InvoiceSyncResult).qboInvoiceId;
    }

    if (result.error) {
      baseResult.error = result.error;
    }

    if (result.skipped) {
      baseResult.skipped = true;
      baseResult.skipReason = result.skipReason;
    }

    return baseResult;
  }

  /**
   * Check if a QBO Customer reference is available for an invoice
   */
  private async hasQboCustomerRef(
    locationId: string,
    customerCompanyId: string | null
  ): Promise<boolean> {
    // Check location
    const [location] = await db
      .select({ qboCustomerId: clientLocations.qboCustomerId, billWithParent: clientLocations.billWithParent })
      .from(clientLocations)
      .where(
        and(
          eq(clientLocations.id, locationId),
          eq(clientLocations.companyId, this.companyId)
        )
      )
      .limit(1);

    if (!location) {
      return false;
    }

    // If billing with parent, check parent company
    if (location.billWithParent && customerCompanyId) {
      const [company] = await db
        .select({ qboCustomerId: customerCompanies.qboCustomerId })
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.id, customerCompanyId),
            eq(customerCompanies.companyId, this.companyId)
          )
        )
        .limit(1);

      return Boolean(company?.qboCustomerId);
    }

    // Otherwise, location must have QBO ID
    return Boolean(location.qboCustomerId);
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a QboSyncOrchestrator instance
 * Returns null if QBO is not configured
 */
export function createSyncOrchestrator(
  tokens: QboTokens,
  companyId: string,
  triggeredBy?: string,
  syncRunId?: string
): QboSyncOrchestrator | null {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new QboClient({ clientId, clientSecret, environment }, tokens);
  return new QboSyncOrchestrator(client, companyId, triggeredBy, syncRunId);
}
