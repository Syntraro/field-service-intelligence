/**
 * QboPreflightService - Go-Live Safety Gate for QBO Integration
 *
 * Handles:
 * - Preflight checks (tokens, mapping, connectivity)
 * - Enable/disable QBO sync for company
 * - Dry-run invoice sync payload generation
 *
 * RULES:
 * - Admin-only access
 * - No token exposure in responses
 * - Preflight must pass before enabling QBO
 * - All operations are companyId-scoped
 */

import { db } from "../../db";
import { companies, invoices, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { Company, Invoice, QboMappingConfig } from "@shared/schema";
import { QboClient } from "./QboClient";
import type { QboTokens } from "./QboClient";
import { QboItemMapper, parseQboMappingConfig } from "./QboItemMapper";
import type { MappingConfigStatus } from "./QboItemMapper";
import { getQueueStats } from "./QboQueueProcessor";
import { logSyncEvent } from "./QboSyncLogger";

// ============================================================
// TYPES
// ============================================================

export interface PreflightResult {
  qboEnabled: boolean;
  qboEnvironment: string;
  tokensConfigured: boolean;
  mappingStatus: MappingConfigStatus;
  connectivityCheck: {
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
  queueStats: {
    queued: number;
    running: number;
    failed: number;
    succeeded: number;
    retriable: number;
  };
  readyToSync: boolean;
  blockers: string[];
}

export interface EnableResult {
  success: boolean;
  qboEnabled: boolean;
  qboEnvironment: string;
  error?: string;
}

export interface DryRunInvoiceResult {
  success: boolean;
  invoiceId: string;
  wouldSync: boolean;
  skipReason?: string;
  payload?: Record<string, unknown>; // Redacted payload preview
  validation: {
    hasCustomerRef: boolean;
    mappingValid: boolean;
    mappingWarnings: string[];
  };
  error?: string;
}

// ============================================================
// SERVICE CLASS
// ============================================================

export class QboPreflightService {
  private companyId: string;
  private triggeredBy: string | undefined;

  constructor(companyId: string, triggeredBy?: string) {
    this.companyId = companyId;
    this.triggeredBy = triggeredBy;
  }

  /**
   * Run all preflight checks
   * Returns comprehensive status without exposing tokens
   */
  async runPreflight(tokens: QboTokens | null): Promise<PreflightResult> {
    const blockers: string[] = [];

    // Fetch company settings
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, this.companyId))
      .limit(1);

    if (!company) {
      return {
        qboEnabled: false,
        qboEnvironment: "sandbox",
        tokensConfigured: false,
        mappingStatus: QboItemMapper.checkConfigStatus(null),
        connectivityCheck: { success: false, error: "Company not found" },
        queueStats: { queued: 0, running: 0, failed: 0, succeeded: 0, retriable: 0 },
        readyToSync: false,
        blockers: ["Company not found"],
      };
    }

    const qboEnabled = company.qboEnabled ?? false;
    const qboEnvironment = company.qboEnvironment ?? "sandbox";

    // Check tokens
    const tokensConfigured = Boolean(tokens?.accessToken && tokens?.refreshToken && tokens?.realmId);
    if (!tokensConfigured) {
      blockers.push("QBO OAuth tokens not configured");
    }

    // Check mapping config
    const mappingConfig = parseQboMappingConfig(company.qboMappingConfig);
    const mappingStatus = QboItemMapper.checkConfigStatus(mappingConfig);
    if (!mappingStatus.configured) {
      blockers.push("QBO item/tax mapping not configured");
    }

    // Connectivity check (only if tokens are configured)
    let connectivityCheck: PreflightResult["connectivityCheck"] = {
      success: false,
      error: "Tokens not configured",
    };

    if (tokensConfigured && tokens) {
      connectivityCheck = await this.testConnectivity(tokens);
      if (!connectivityCheck.success) {
        blockers.push(`QBO connectivity failed: ${connectivityCheck.error}`);
      }
    }

    // Queue stats
    const queueStats = await getQueueStats(this.companyId);

    // Determine readiness
    const readyToSync = tokensConfigured && mappingStatus.configured && connectivityCheck.success;

    return {
      qboEnabled,
      qboEnvironment,
      tokensConfigured,
      mappingStatus,
      connectivityCheck,
      queueStats,
      readyToSync,
      blockers,
    };
  }

  /**
   * Test QBO API connectivity
   * Makes a simple read-only query to verify auth works
   */
  private async testConnectivity(tokens: QboTokens): Promise<PreflightResult["connectivityCheck"]> {
    try {
      const clientId = process.env.QBO_CLIENT_ID;
      const clientSecret = process.env.QBO_CLIENT_SECRET;
      const environment = (process.env.QBO_ENVIRONMENT as "sandbox" | "production") || "sandbox";

      if (!clientId || !clientSecret) {
        return { success: false, error: "QBO client credentials not configured" };
      }

      const client = new QboClient({ clientId, clientSecret, environment }, tokens);

      const startTime = Date.now();
      // Simple query to test connectivity - get company info
      const result = await client.get<{ CompanyName?: string }>("/companyinfo/" + tokens.realmId);
      const latencyMs = Date.now() - startTime;

      if (result.success) {
        return { success: true, latencyMs };
      } else {
        return {
          success: false,
          error: result.error?.message || "Unknown connectivity error",
          latencyMs,
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Enable or disable QBO sync for company
   * Only allows enabling if preflight passes
   */
  async setEnabled(
    enabled: boolean,
    environment: "sandbox" | "production" | undefined,
    tokens: QboTokens | null
  ): Promise<EnableResult> {
    // If enabling, run preflight first
    if (enabled) {
      const preflight = await this.runPreflight(tokens);

      if (!preflight.readyToSync) {
        return {
          success: false,
          qboEnabled: false,
          qboEnvironment: preflight.qboEnvironment,
          error: `Cannot enable QBO sync: ${preflight.blockers.join("; ")}`,
        };
      }
    }

    // Update company settings
    const updateData: Partial<Company> = {
      qboEnabled: enabled,
    };

    if (environment) {
      updateData.qboEnvironment = environment;
    }

    await db
      .update(companies)
      .set(updateData)
      .where(eq(companies.id, this.companyId));

    // Log event
    await logSyncEvent({
      companyId: this.companyId,
      eventType: enabled ? "QBO_ENABLED" : "QBO_DISABLED",
      result: "SUCCESS",
      triggeredBy: this.triggeredBy,
    });

    // Fetch updated company to return current state
    const [updated] = await db
      .select({ qboEnabled: companies.qboEnabled, qboEnvironment: companies.qboEnvironment })
      .from(companies)
      .where(eq(companies.id, this.companyId))
      .limit(1);

    return {
      success: true,
      qboEnabled: updated?.qboEnabled ?? false,
      qboEnvironment: updated?.qboEnvironment ?? "sandbox",
    };
  }

  /**
   * Dry-run invoice sync
   * Builds payload, validates, but does NOT call QBO
   * Returns redacted payload preview
   */
  async dryRunInvoiceSync(invoiceId: string): Promise<DryRunInvoiceResult> {
    try {
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
          success: false,
          invoiceId,
          wouldSync: false,
          skipReason: "Invoice not found",
          validation: { hasCustomerRef: false, mappingValid: false, mappingWarnings: [] },
          error: "Invoice not found",
        };
      }

      // Check if draft
      if (invoice.status === "draft") {
        return {
          success: true,
          invoiceId,
          wouldSync: false,
          skipReason: "Draft invoices cannot be synced to QBO",
          validation: { hasCustomerRef: false, mappingValid: false, mappingWarnings: [] },
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
          success: false,
          invoiceId,
          wouldSync: false,
          skipReason: "Invoice location not found",
          validation: { hasCustomerRef: false, mappingValid: false, mappingWarnings: [] },
          error: "Invoice location not found",
        };
      }

      // Check QBO customer reference
      let qboCustomerId: string | null = null;

      if (location.billWithParent && invoice.customerCompanyId) {
        // Check parent company for QBO ID
        const [customerCompany] = await db
          .select({ qboCustomerId: customerCompanies.qboCustomerId })
          .from(customerCompanies)
          .where(
            and(
              eq(customerCompanies.id, invoice.customerCompanyId),
              eq(customerCompanies.companyId, this.companyId)
            )
          )
          .limit(1);
        qboCustomerId = customerCompany?.qboCustomerId || null;
      } else {
        qboCustomerId = location.qboCustomerId || null;
      }

      const hasCustomerRef = Boolean(qboCustomerId);

      // Get mapping config
      const [company] = await db
        .select({ qboMappingConfig: companies.qboMappingConfig })
        .from(companies)
        .where(eq(companies.id, this.companyId))
        .limit(1);

      const mappingConfig = parseQboMappingConfig(company?.qboMappingConfig);
      const mappingStatus = QboItemMapper.checkConfigStatus(mappingConfig);

      // Build a preview payload (simplified for dry-run)
      const previewPayload: Record<string, unknown> = {
        DocNumber: invoice.invoiceNumber,
        TxnDate: invoice.issueDate,
        DueDate: invoice.dueDate,
        CustomerRef: {
          value: qboCustomerId || "DRY_RUN_CUSTOMER_REF",
        },
        BillEmail: location.email ? { Address: location.email } : undefined,
        Line: [
          {
            Description: "(Invoice lines would be mapped here)",
            Amount: invoice.total,
            DetailType: "SalesItemLineDetail",
          },
        ],
        PrivateNote: `Location: ${location.companyName}`,
        TotalAmt: invoice.total,
      };

      // Redact sensitive fields
      const redactedPayload = this.redactPayload(previewPayload);

      // Determine if would sync
      const wouldSync = hasCustomerRef && mappingStatus.configured;
      const skipReason = !hasCustomerRef
        ? "No QBO Customer ID available"
        : !mappingStatus.configured
        ? "QBO mapping not configured"
        : undefined;

      // Log dry-run event
      await logSyncEvent({
        companyId: this.companyId,
        eventType: "INVOICE_DRY_RUN",
        result: wouldSync ? "SUCCESS" : "SKIPPED",
        invoiceId,
        triggeredBy: this.triggeredBy,
      });

      return {
        success: true,
        invoiceId,
        wouldSync,
        skipReason,
        payload: redactedPayload,
        validation: {
          hasCustomerRef,
          mappingValid: mappingStatus.configured,
          mappingWarnings: mappingStatus.warnings,
        },
      };
    } catch (err) {
      return {
        success: false,
        invoiceId,
        wouldSync: false,
        validation: { hasCustomerRef: false, mappingValid: false, mappingWarnings: [] },
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Redact sensitive fields from payload
   */
  private redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...payload };

    // These fields should never contain tokens, but redact any potential sensitive data
    // For QBO invoice payloads, we keep most fields visible for debugging
    // but ensure no tokens or auth data leak

    // If somehow there's a token-like field, redact it
    const sensitivePatterns = /token|secret|password|key|auth/i;

    const redactObject = (obj: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitivePatterns.test(key)) {
          result[key] = "[REDACTED]";
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          result[key] = redactObject(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
          result[key] = value.map(item =>
            item && typeof item === "object" ? redactObject(item as Record<string, unknown>) : item
          );
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    return redactObject(redacted);
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

export function createPreflightService(companyId: string, triggeredBy?: string): QboPreflightService {
  return new QboPreflightService(companyId, triggeredBy);
}
