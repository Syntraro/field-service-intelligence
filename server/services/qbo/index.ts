/**
 * QBO Services - QuickBooks Online Integration
 *
 * This module provides the foundation for syncing data to QuickBooks Online.
 *
 * IMPORTANT RULES:
 * - No auto-sync: All syncs must be explicitly triggered
 * - Draft invoices must NEVER be synced
 * - All failures must be logged to qbo_sync_events
 * - Enforce companyId isolation on all operations
 * - All operations are idempotent
 *
 * Usage:
 * ```typescript
 * import { QboClient, QboCustomerService, QboInvoiceService } from './services/qbo';
 *
 * // Create services with OAuth tokens
 * const customerService = createCustomerService(tokens, companyId, userId);
 * const invoiceService = createInvoiceService(tokens, companyId, userId);
 *
 * // Sync entities
 * await customerService.syncCustomerCompany(customerCompanyId);
 * await invoiceService.createInvoice(invoiceId);
 * ```
 */

// Client
export { QboClient, createQboClientFromEnv, isQboConfigured } from "./QboClient";
export type { QboTokens, QboClientConfig, QboApiResponse, QboApiError } from "./QboClient";

// Mappers
export {
  // Types
  type QBOAddress,
  type QBOParentRef,
  type QBOCustomerPayload,
  type QBOCustomerResponse,
  type QBOInvoiceLineDetail,
  type QBOInvoiceLine,
  type QBOInvoicePayload,
  type QBOInvoiceResponse,
  type ParsedQBOCustomer,
  type ParsedQBOInvoice,
  type ParsedQBOInvoiceLine,
  // Customer mappers
  mapCustomerCompanyToQBO,
  mapClientToQBOSubCustomer,
  mapStandaloneClientToQBO,
  parseQBOCustomerResponse,
  validateQBOHierarchyDepth,
  buildUniqueDisplayName,
  // Invoice mappers
  toQboInvoicePayload,
  fromQboInvoicePayload,
  extractLocationIdFromMemo,
  // Validation helpers
  determineSyncStatus,
  validateCustomerCompanyForSync,
  validateClientLocationForSync,
  validateInvoiceForSync,
  shouldSyncInvoice,
  shouldSyncCustomerCompany,
  shouldSyncClientLocation,
} from "./QboMapper";

// Customer Service
export { QboCustomerService, createCustomerService } from "./QboCustomerService";
export type { CustomerSyncResult } from "./QboCustomerService";

// Invoice Service
export { QboInvoiceService, createInvoiceService } from "./QboInvoiceService";
export type { InvoiceSyncResult } from "./QboInvoiceService";

// Sync Logger
export { QboSyncLogger, createSyncLogger, logSyncEvent } from "./QboSyncLogger";
export type { SyncEventParams } from "./QboSyncLogger";

// Orchestrator
export { QboSyncOrchestrator, createSyncOrchestrator } from "./QboSyncOrchestrator";
export type {
  EntitySyncResult,
  InvoiceSyncWithDepsResult,
  BatchSyncResult,
  FullSyncResult,
} from "./QboSyncOrchestrator";

// Read Service
export { QboReadService, createReadService } from "./QboReadService";
export type {
  QBOPaymentResponse,
  QBOPaymentLine,
  QBOQueryResponse,
  ParsedQBOPayment,
  QBOInvoiceWithPayments,
} from "./QboReadService";

// Reconciliation Service
export { QboReconciliationService, createReconciliationService } from "./QboReconciliationService";
export type {
  PaymentDifference,
  ReconciliationResult,
  ReconcileApplyResult,
} from "./QboReconciliationService";

// Item Mapper
export { QboItemMapper, createItemMapper, parseQboMappingConfig } from "./QboItemMapper";
export type {
  ResolvedLineMapping,
  LineMappingValidation,
  PreflightValidationResult,
  MappingConfigStatus,
} from "./QboItemMapper";

// Queue Processor
export { QboQueueProcessor, createQueueProcessor, getQueueJobs, getQueueStats } from "./QboQueueProcessor";
export type {
  QueueJobResult,
  ProcessQueueResult,
  EnqueueResult,
} from "./QboQueueProcessor";

// Preflight Service
export { QboPreflightService, createPreflightService } from "./QboPreflightService";
export type {
  PreflightResult,
  EnableResult,
  DryRunInvoiceResult,
} from "./QboPreflightService";

// Webhook Service
export { QboWebhookService, createWebhookService } from "./QboWebhookService";
export type {
  IntuitWebhookPayload,
  WebhookVerificationResult,
  WebhookReceiveResult,
  WebhookProcessResult,
  DriftAlert,
} from "./QboWebhookService";

// Item Service
export { QboItemService, createItemService, createItemServiceFromTokens } from "./QboItemService";
export type {
  QBOItemResponse,
  QBOItemQueryResponse,
  ParsedQBOItem,
  ItemListResult,
  ItemCreateResult,
  ItemLinkResult,
} from "./QboItemService";
