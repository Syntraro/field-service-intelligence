import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, numeric, uniqueIndex, jsonb, index, check, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// =============================================================================
// SHARED VALIDATION HELPERS
// =============================================================================

/** Canadian postal code pattern: A1A 1A1 or A1A1A1 (case-insensitive) */
const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
/** US ZIP code pattern: 12345 or 12345-6789 */
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

/**
 * Optional postal/ZIP code Zod schema.
 * Accepts Canadian (A1A 1A1) and US (12345 / 12345-6789) formats.
 * Normalizes Canadian codes to uppercase with space. Rejects invalid non-empty values.
 * Passes through null/undefined/empty string unchanged (postal codes are optional).
 */
export const postalCodeSchema = z
  .string()
  .nullable()
  .optional()
  .transform((val) => {
    if (!val || !val.trim()) return val; // pass through blank/null/undefined
    const trimmed = val.trim();
    // Normalize Canadian postal to uppercase + space
    if (CA_POSTAL_RE.test(trimmed)) {
      const upper = trimmed.toUpperCase().replace(/\s/g, "");
      return `${upper.slice(0, 3)} ${upper.slice(3)}`;
    }
    return trimmed;
  })
  .refine(
    (val) => {
      if (!val || !val.trim()) return true; // blank is valid (optional field)
      const trimmed = val.trim();
      return CA_POSTAL_RE.test(trimmed) || US_ZIP_RE.test(trimmed);
    },
    { message: "Invalid postal/ZIP code. Use Canadian (A1A 1A1) or US (12345) format." }
  );

// Companies table - each HVAC business is a company
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  provinceState: text("province_state"),
  postalCode: text("postal_code"),
  email: text("email"),
  phone: text("phone"),
  // Subscription and trial fields (moved from users to companies)
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  subscriptionPlan: text("subscription_plan"),
  billingInterval: text("billing_interval"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Tax settings
  taxName: text("tax_name").notNull().default("HST"), // Default tax name (e.g., HST, GST, PST, VAT)
  defaultTaxRate: numeric("default_tax_rate", { precision: 5, scale: 2 }).notNull().default("13.00"), // Default tax rate as percentage (e.g., 13.00 for 13%)
  // QBO item/tax mapping configuration
  // JSON structure: { productServiceItemId, taxableCode, nonTaxableCode } (legacy per-type fields also accepted)
  qboMappingConfig: jsonb("qbo_mapping_config"),
  // QBO Go-Live Safety Gate
  qboEnabled: boolean("qbo_enabled").notNull().default(false),
  qboEnvironment: text("qbo_environment").notNull().default("sandbox"), // "sandbox" | "production"
  qboRealmId: text("qbo_realm_id"), // QBO company ID for webhook mapping
  // QBO onboarding — set once on first successful import run (fetched > 0)
  qboOnboardingCatalogImportedAt: timestamp("qbo_onboarding_catalog_imported_at"),
  qboOnboardingCustomersImportedAt: timestamp("qbo_onboarding_customers_imported_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// QBO Mapping Configuration Schema
// TYPE mapping: how our catalog item types map to QBO Item.Types.
// Each catalog item is synced individually to QBO; invoice lines use per-item qboItemId.
export const qboMappingConfigSchema = z.object({
  // Type mapping: our "service" items → QBO Item.Type (always "Service")
  serviceQboItemType: z.enum(["Service"]).optional(),
  // Type mapping: our "product" items → QBO Item.Type ("NonInventory" or "Inventory")
  productQboItemType: z.enum(["NonInventory", "Inventory"]).optional(),
  // Tax code mappings (optional — QBO uses its own defaults if omitted)
  taxableCodeId: z.string().optional(),
  nonTaxableCodeId: z.string().optional(),
  // Default income account for Service/NonInventory items synced to QBO
  defaultIncomeAccountId: z.string().optional(),
  // Legacy fields (backwards compat — old configs may still have these)
  serviceItemId: z.string().optional(),
  productItemId: z.string().optional(),
  feeItemId: z.string().optional(),
  discountItemId: z.string().optional(),
  productServiceItemId: z.string().optional(),
  materialItemId: z.string().optional(),
  laborItemId: z.string().optional(),
  miscItemId: z.string().optional(),
  taxableCode: z.string().optional(),
  nonTaxableCode: z.string().optional(),
}).strict();

export type QboMappingConfig = z.infer<typeof qboMappingConfigSchema>;

// QBO Environment enum
export const qboEnvironmentEnum = ["sandbox", "production"] as const;
export type QboEnvironment = typeof qboEnvironmentEnum[number];

// QBO Connections — tenant-scoped OAuth token storage
// One row per company. Tokens are never returned to the client.
export const qboConnections = pgTable("qbo_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  environment: text("environment").notNull().default("sandbox"), // "sandbox" | "production"
  realmId: text("realm_id").notNull(), // QBO company ID from OAuth callback
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at"), // computed from expires_in
  connectedByUserId: varchar("connected_by_user_id"), // userId that initiated the OAuth flow
  connectedAt: timestamp("connected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdUq: uniqueIndex("qbo_connections_company_id_uq").on(table.companyId),
}));

export type QboConnection = typeof qboConnections.$inferSelect;

export const userStatusEnum = ["active", "invited", "deactivated"] as const;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("technician"), // Legacy field: "platform_admin", "owner", "admin", "technician"
  roleId: varchar("role_id"), // FK to roles table (will be populated by migration)
  fullName: text("full_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  status: text("status").notNull().default("active"), // active, invited, deactivated
  disabled: boolean("disabled").notNull().default(false),
  useCustomSchedule: boolean("use_custom_schedule").notNull().default(false), // If false, use company default
  isSchedulable: boolean("is_schedulable").notNull().default(true), // If true, appears in calendar/scheduling dropdowns
  tokenVersion: integer("token_version").notNull().default(0), // Increment to invalidate all sessions
  lastLoginAt: timestamp("last_login_at"),
  deletedAt: timestamp("deleted_at"), // Soft delete timestamp
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  email: z.string().email("Please enter a valid email address"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// User Identities - Login methods (email, SSO providers)
// ============================================================================

// Phase B: identityProviderEnum / IdentityProvider removed (unused exports)

/**
 * user_identities table - stores login credentials/identities for users.
 * - Each user can have multiple identities (email + SSO providers)
 * - Email identity stores passwordHash; SSO identities don't
 * - Uniqueness is scoped by companyId to support multi-tenant with same email across tenants
 */
export const userIdentities = pgTable("user_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "email", "google", "microsoft", "apple"
  identifier: text("identifier").notNull(), // email address or SSO subject ID
  passwordHash: text("password_hash"), // only for provider="email"
  verifiedAt: timestamp("verified_at"), // when the identity was verified
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Unique constraint: one provider+identifier per company
  uniqueProviderIdentifier: uniqueIndex("user_identities_company_provider_identifier_idx")
    .on(table.companyId, table.provider, table.identifier),
  // Index for finding all identities for a user
  userIdIdx: index("user_identities_user_id_idx").on(table.companyId, table.userId),
}));

export const insertUserIdentitySchema = createInsertSchema(userIdentities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserIdentity = z.infer<typeof insertUserIdentitySchema>;
export type UserIdentity = typeof userIdentities.$inferSelect;

// Authenticated user type that merges User with Company subscription data
export type AuthenticatedUser = User & Pick<Company, 
  "trialEndsAt" | 
  "subscriptionStatus" | 
  "subscriptionPlan" | 
  "stripeCustomerId" | 
  "stripeSubscriptionId" | 
  "billingInterval" | 
  "currentPeriodEnd" | 
  "cancelAtPeriodEnd"
>;

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  requestedIp: text("requested_ip"),
});

// Phase B: insertPasswordResetTokenSchema removed (unused export)

// ============================================================================
// Audit Events - Security audit trail for sensitive actions
// ============================================================================

export const auditActionEnum = [
  "TEAM_MEMBER_CREATED",
  "EMAIL_CHANGED",
  "PASSWORD_RESET",
  "ROLE_CHANGED",
  "USER_ENABLED",
  "USER_DISABLED",
] as const;
export type AuditAction = typeof auditActionEnum[number];

export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").notNull().references(() => users.id),
  targetUserId: varchar("target_user_id").references(() => users.id),
  action: text("action").notNull(), // AuditAction type
  metadata: jsonb("metadata"), // Additional context (old/new values, etc.)
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;

// Phase B: InsertPasswordResetToken, PasswordResetToken removed (unused exports)

// Audit logs for tracking impersonation and cross-tenant actions
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platformAdminId: varchar("platform_admin_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platformAdminEmail: text("platform_admin_email").notNull(),
  targetCompanyId: varchar("target_company_id").references(() => companies.id, { onDelete: "set null" }),
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // "impersonation_start", "impersonation_stop", "cross_tenant_read", "cross_tenant_write", "auth_failure"
  reason: text("reason"), // Required for impersonation actions
  details: text("details"), // JSON string with additional context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Impersonation sessions - Persistent storage for support mode sessions
export const impersonationSessions = pgTable("impersonation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: varchar("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: timestamp("ended_at"),
  endedReason: text("ended_reason"), // "manual", "expired", "idle", "logout"
});

export const insertImpersonationSessionSchema = createInsertSchema(impersonationSessions).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
  endedAt: true,
  endedReason: true,
});

export type InsertImpersonationSession = z.infer<typeof insertImpersonationSessionSchema>;
export type ImpersonationSession = typeof impersonationSessions.$inferSelect;

// Customer Companies - Parent entities that map to QBO Customers
// These represent the corporate entity (e.g. "ABC Holdings Inc")
export const customerCompanies = pgTable("customer_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Company information
  name: text("name").notNull(), // Main company name (maps to QBO DisplayName for parent)
  nameNormalized: text("name_normalized").notNull().default(""), // Lowercase, trimmed, whitespace-collapsed — used for case-insensitive dedup
  legalName: text("legal_name"), // Official legal name if different
  phone: text("phone"),
  email: text("email"),
  // Billing address (used for QBO BillAddr)
  billingStreet: text("billing_street"), // Address line 1
  billingStreet2: text("billing_street2"), // Address line 2 (suite, unit, PO box, etc.)
  billingCity: text("billing_city"),
  billingProvince: text("billing_province"),
  billingPostalCode: text("billing_postal_code"),
  billingCountry: text("billing_country"),
  // Status
  isActive: boolean("is_active").notNull().default(true),
  // QBO sync fields
  qboCustomerId: text("qbo_customer_id"), // QBO Customer.Id
  qboSyncToken: text("qbo_sync_token"), // QBO Customer.SyncToken (required for updates)
  qboLastSyncedAt: timestamp("qbo_last_synced_at"),
  qboSyncStatus: text("qbo_sync_status").notNull().default("NOT_SYNCED"), // NOT_SYNCED | SYNCED | PENDING | ERROR
  qboSyncError: text("qbo_sync_error"), // Last sync error message if any
  // Name source: 'company' = use company name as display, 'person' = use contact first+last
  nameSource: text("name_source").notNull().default("company"),
  // Soft delete
  deletedAt: timestamp("deleted_at"),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Prevent duplicate QBO customer mappings within a tenant
  qboCustomerIdUq: uniqueIndex("customer_companies_company_qbo_customer_id_uq")
    .on(table.companyId, table.qboCustomerId)
    .where(sql`qbo_customer_id is not null`),
}));

export const insertCustomerCompanySchema = createInsertSchema(customerCompanies).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomerCompanySchema = insertCustomerCompanySchema.partial();

export type InsertCustomerCompany = z.infer<typeof insertCustomerCompanySchema>;
export type UpdateCustomerCompany = z.infer<typeof updateCustomerCompanySchema>;
export type CustomerCompany = typeof customerCompanies.$inferSelect;

// Client Tags - tenant-scoped labels for categorizing customer companies
export const clientTags = pgTable("client_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6b7280"), // Tailwind gray-500 default
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("client_tags_company_name_idx").on(table.companyId, table.name),
]);

export const insertClientTagSchema = createInsertSchema(clientTags).omit({
  id: true,
  companyId: true,
  createdAt: true,
});

export type ClientTag = typeof clientTags.$inferSelect;
export type InsertClientTag = z.infer<typeof insertClientTagSchema>;

// Client Tag Assignments - many-to-many link between tags and customer companies
export const clientTagAssignments = pgTable("client_tag_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => clientTags.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("client_tag_assignments_unique_idx").on(table.tagId, table.customerCompanyId),
]);

export type ClientTagAssignment = typeof clientTagAssignments.$inferSelect;

// Client Locations - Child entities that map to QBO Sub-Customers
// These represent specific sites/locations (e.g. "Toronto Warehouse")
export const clientLocations = pgTable("client_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Creator - nullable, set null on user delete
  // Parent company reference (optional - if null, this is a standalone client)
  parentCompanyId: varchar("parent_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  companyName: text("company_name").notNull(),
  location: text("location"), // Location/site name (e.g. "Toronto Warehouse")
  // Service address
  address: text("address"), // Address line 1
  address2: text("address2"), // Address line 2 (suite, unit, floor, bay, etc.)
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  country: text("country"), // Google Places country (Phase 1 geocoding)
  // Geocoding — persisted from Google Places autocomplete
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  placeId: text("place_id"), // Google Places place_id
  // Contact info
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  roofLadderCode: text("roof_ladder_code"),
  notes: text("notes"),
  // PM scheduling
  selectedMonths: integer("selected_months").array().notNull(),
  inactive: boolean("inactive").notNull().default(false),
  nextDue: text("next_due"), // Optional - only needed for PM scheduling
  // Primary location flag - only one location per parent company should be primary
  isPrimary: boolean("is_primary").notNull().default(false),
  // Quick-create tracking
  needsDetails: boolean("needs_details").notNull().default(false), // true = created via quick-create, needs full details later
  // QBO sync fields
  billWithParent: boolean("bill_with_parent").notNull().default(true), // Maps to QBO "Bill with parent"
  qboCustomerId: text("qbo_customer_id"), // QBO Sub-Customer.Id
  qboParentCustomerId: text("qbo_parent_customer_id"), // QBO parent Customer.Id (mirrors QBO ParentRef)
  qboSyncToken: text("qbo_sync_token"), // QBO Sub-Customer.SyncToken
  qboLastSyncedAt: timestamp("qbo_last_synced_at"),
  // Optimistic locking
  version: integer("version").notNull().default(0), // Incremented on every update
  // Soft delete
  deletedAt: timestamp("deleted_at"),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Prevent duplicate QBO sub-customer mappings within a tenant
  qboCustomerIdUq: uniqueIndex("client_locations_company_qbo_customer_id_uq")
    .on(table.companyId, table.qboCustomerId)
    .where(sql`qbo_customer_id is not null`),
}));

export const insertClientLocationSchema = createInsertSchema(clientLocations).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

// Legacy aliases for backward compatibility during migration
export const clients = clientLocations; // Table alias
export const insertClientSchema = insertClientLocationSchema;
export type Client = typeof clientLocations.$inferSelect;
export type ClientLocation = typeof clientLocations.$inferSelect;
export type InsertClient = z.infer<typeof insertClientLocationSchema>;
export type InsertClientLocation = z.infer<typeof insertClientLocationSchema>;

// Location Tag Assignments — Phase 1B: many-to-many link between tags and locations
export const locationTagAssignments = pgTable("location_tag_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tagId: varchar("tag_id").notNull().references(() => clientTags.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("location_tag_assignments_unique_idx").on(table.companyId, table.locationId, table.tagId),
]);

export type LocationTagAssignment = typeof locationTagAssignments.$inferSelect;

// Client Contacts - multiple contacts per customer company or per location
// location_id = NULL → company-level contact; set → location-specific contact
export const clientContacts = pgTable("client_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  // Role flags: 'billing', 'scheduling', 'general', 'primary'
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertClientContactSchema = createInsertSchema(clientContacts).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type ClientContact = typeof clientContacts.$inferSelect;
export type InsertClientContact = z.infer<typeof insertClientContactSchema>;

// Items table - represents products and services for QuickBooks Online sync
// These Items are designed to sync to QuickBooks Online Items in the future.
// The app is currently the primary master for item details, and QBO mapping will be handled via qboItemId.
export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Creator - nullable, set null on user delete
  type: text("type").notNull(), // "product" or "service"
  // Item fields (products/services - QBO aligned)
  name: text("name"),
  sku: text("sku"), // Internal item code or SKU
  description: text("description"),
  // Pricing fields (for products and services)
  cost: numeric("cost", { precision: 12, scale: 2 }), // Cost price in dollars
  markupPercent: numeric("markup_percent", { precision: 5, scale: 2 }), // Optional markup percentage for auto-calculating unitPrice
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }), // Selling price in dollars
  // Tax fields
  isTaxable: boolean("is_taxable").default(true),
  taxExempt: boolean("tax_exempt").default(false), // Legacy field - use isTaxable for new items
  taxCode: text("tax_code"), // Reserved for future tax integration
  // Categorization
  category: text("category"), // Simple category/group label
  // Status
  isActive: boolean("is_active").default(true),
  // Future-proofing fields (Products & Services CSV import)
  estimatedDurationMinutes: integer("estimated_duration_minutes"), // Service duration in minutes (nullable)
  trackInventory: boolean("track_inventory").notNull().default(false), // Inventory tracking toggle (default off)
  // QBO sync fields for Items
  qboItemId: text("qbo_item_id"), // QBO Item id if/when synced
  qboSyncToken: text("qbo_sync_token"), // QBO sync token for optimistic locking on updates
  qboSyncStatus: text("qbo_sync_status").notNull().default("NOT_SYNCED"), // NOT_SYNCED, SYNCED, ERROR
  qboSyncError: text("qbo_sync_error"), // Last sync error message if any
  qboLastSyncedAt: timestamp("qbo_last_synced_at"), // Timestamp of last successful sync
  // Soft delete
  deletedAt: timestamp("deleted_at"),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Index for looking up items by QBO ID
  qboItemIdIdx: index("items_qbo_item_id_idx").on(table.companyId, table.qboItemId),
  // Index for filtering items by sync status
  qboSyncStatusIdx: index("items_qbo_sync_status_idx").on(table.companyId, table.qboSyncStatus),
}));

export const insertItemSchema = createInsertSchema(items).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;

export const clientParts = pgTable("client_parts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Creator - nullable
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "restrict" }),
  // Canonical reference to service location
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }),
  partId: varchar("part_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
});

export const insertClientPartSchema = createInsertSchema(clientParts).omit({
  id: true,
  companyId: true,
  userId: true,
});

export type InsertClientPart = z.infer<typeof insertClientPartSchema>;
export type ClientPart = typeof clientParts.$inferSelect;

export const maintenanceRecords = pgTable("maintenance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Creator - nullable
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "restrict" }),
  // Canonical reference to service location
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }),
  dueDate: date("due_date").notNull(), // FIXED: Changed from text() to date()
  completedAt: timestamp("completed_at"), // FIXED: Changed from text() to timestamp()
});

export const insertMaintenanceRecordSchema = createInsertSchema(maintenanceRecords).omit({
  id: true,
  companyId: true,
  userId: true,
});

export type InsertMaintenanceRecord = z.infer<typeof insertMaintenanceRecordSchema>;
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;

// ============================================================================
// REMOVED: calendar_assignments table (Model A - scheduling on jobs table)
// ============================================================================
// Scheduling is now stored directly on the jobs table using:
// - scheduledStart (timestamp) - canonical scheduling determinant
// - scheduledEnd (timestamp)
// - isAllDay (boolean) - display flag only
//
// A job is scheduled iff scheduledStart IS NOT NULL.
// ============================================================================

// Company counters table - tracks sequential counters per company (e.g., job numbers, invoice numbers)
// Job numbers default to 100000 (6 digits) for better readability and search
export const companyCounters = pgTable("company_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  nextJobNumber: integer("next_job_number").notNull().default(100000), // 6-digit job numbers
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1001),
  nextQuoteNumber: integer("next_quote_number").notNull().default(1001),
});

export const updateCompanyCountersSchema = z.object({
  nextJobNumber: z.number().int().positive().optional(),
  nextInvoiceNumber: z.number().int().positive().optional(),
  nextQuoteNumber: z.number().int().positive().optional(),
});

export type UpdateCompanyCounters = z.infer<typeof updateCompanyCountersSchema>;
export type CompanyCounters = typeof companyCounters.$inferSelect;

// REMOVED: Calendar assignment schemas and types (Model A - scheduling on jobs table)
// Use job scheduling schemas instead:
// - scheduleJobSchema for POST /api/calendar/schedule
// - updateJobScheduleSchema for PATCH /api/calendar/schedule/:jobId

/**
 * Schema for scheduling a job (POST /api/calendar/schedule)
 */
export const scheduleJobSchema = z.object({
  jobId: z.string().uuid(),
  startAt: z.string().datetime().optional(), // ISO 8601 datetime - required for timed events
  endAt: z.string().datetime().optional(),   // Optional - computed from duration if not provided
  date: z.string().optional(),               // YYYY-MM-DD - required for all-day events
  isAllDay: z.boolean().optional(),          // True = all-day event
  durationMinutes: z.number().int().min(15).max(720).optional(), // For timed events
  // 2026-01-29: Accept null for unassigned drops
  technicianUserId: z.string().uuid().nullable().optional(), // Optional technician to assign (null = unassign)
  version: z.number().int(),                 // Required for optimistic locking
});

/**
 * Schema for updating a job's schedule (PATCH /api/calendar/schedule/:jobId)
 */
export const updateJobScheduleSchema = z.object({
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  date: z.string().optional(),
  isAllDay: z.boolean().optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  technicianUserId: z.string().uuid().nullable().optional(),
  version: z.number().int(), // Required for optimistic locking
});

/**
 * Schema for unscheduling a job (POST /api/calendar/unschedule/:jobId)
 */
export const unscheduleJobSchema = z.object({
  version: z.number().int(), // Required for optimistic locking
});

// Phase B: ScheduleJobInput, UpdateJobScheduleInput, UnscheduleJobInput removed (unused type aliases)

export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Creator - nullable
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "restrict" }),
  // Canonical reference to service location
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  type: text("type"),
  modelNumber: text("model_number"),
  serialNumber: text("serial_number"),
  location: text("location"),
  notes: text("notes"),
  // Soft delete
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertEquipmentSchema = createInsertSchema(equipment).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
});

export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type Equipment = typeof equipment.$inferSelect;

export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  address: text("address"),
  city: text("city"),
  provinceState: text("province_state"),
  postalCode: text("postal_code"),
  email: text("email"),
  phone: text("phone"),
  calendarStartHour: integer("calendar_start_hour").notNull().default(8),
  // Scheduling timezone (IANA tz string, e.g., "America/Toronto")
  timezone: text("timezone").notNull().default("America/Toronto"),
  // Null until tenant explicitly confirms timezone (onboarding gate)
  timezoneConfirmedAt: timestamp("timezone_confirmed_at"),
  // Regional display preferences
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
  timeFormat: text("time_format").notNull().default("12h"),
  weekStartsOn: text("week_starts_on").notNull().default("monday"),
  // Invoice defaults
  defaultPaymentTermsDays: integer("default_payment_terms_days").notNull().default(30),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({
  id: true,
  companyId: true,
  userId: true,
  updatedAt: true,
});

export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// ============================================================================
// COMPANY BUSINESS HOURS - per-tenant operating hours by day of week
// ============================================================================
// Stores one row per day of week (7 rows per company).
// day_of_week: 0=Sunday, 1=Monday, ..., 6=Saturday
// times stored as minutes from midnight (0-1440)

export const companyBusinessHours = pgTable("company_business_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday, 1=Monday, ..., 6=Saturday
  isOpen: boolean("is_open").notNull().default(true),
  startMinutes: integer("start_minutes"), // 0-1439 (minutes from midnight)
  endMinutes: integer("end_minutes"), // 1-1440 (1440 = midnight next day)
  createdAt: timestamp("created_at").notNull().default(sql`NOW()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`NOW()`),
});

export const insertCompanyBusinessHoursSchema = createInsertSchema(companyBusinessHours).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyBusinessHours = z.infer<typeof insertCompanyBusinessHoursSchema>;
export type CompanyBusinessHours = typeof companyBusinessHours.$inferSelect;

// ============================================================================
// USER INVITATIONS (dispatch software access) - single-company system
// ============================================================================
// Phase B: invitationStatusEnum / InvitationStatus removed (unused exports)

export const invitations = pgTable("invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertInvitationSchema = createInsertSchema(invitations).omit({
  id: true,
  companyId: true,
  token: true,
  status: true,
  acceptedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  email: z.string().email(),
  role: z.string(),
});

export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitations.$inferSelect;

// ============================================================================
// COMPANY AUDIT LOGS (tenant-scoped operational audit trail)
// ============================================================================
export const companyAuditLogs = pgTable("company_audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: varchar("entity_id"),
  metadata: text("metadata"), // JSON string
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertCompanyAuditLogSchema = createInsertSchema(companyAuditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertCompanyAuditLog = z.infer<typeof insertCompanyAuditLogSchema>;
export type CompanyAuditLog = typeof companyAuditLogs.$inferSelect;

// ============================================================================
// TECHNICIANS (operational entity) + LABOR ENTRIES (immutable time records)
// ============================================================================
export const technicians = pgTable("technicians", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertTechnicianSchema = createInsertSchema(technicians).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTechnician = z.infer<typeof insertTechnicianSchema>;
export type Technician = typeof technicians.$inferSelect;

export const laborEntries = pgTable("labor_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => technicians.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  minutes: integer("minutes").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertLaborEntrySchema = createInsertSchema(laborEntries).omit({
  id: true,
  companyId: true,
  createdAt: true,
});

export type InsertLaborEntry = z.infer<typeof insertLaborEntrySchema>;
export type LaborEntry = typeof laborEntries.$inferSelect;

// Invitation tokens for technician onboarding
export const invitationTokens = pgTable("invitation_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  email: text("email"),
  role: text("role").notNull().default("technician"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  usedByUserId: varchar("used_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertInvitationTokenSchema = createInsertSchema(invitationTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertInvitationToken = z.infer<typeof insertInvitationTokenSchema>;
export type InvitationToken = typeof invitationTokens.$inferSelect;

export const feedback = pgTable("feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  status: text("status").notNull().default("new"),
  archived: boolean("archived").notNull().default(false),
});

export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  companyId: true,
  userId: true,
  userEmail: true,
  createdAt: true,
  status: true,
});

export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedback.$inferSelect;

export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  stripePriceId: text("stripe_price_id"),
  monthlyPriceCents: integer("monthly_price_cents"),
  locationLimit: integer("location_limit").notNull(),
  isTrial: boolean("is_trial").notNull().default(false),
  trialDays: integer("trial_days"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;

// Job notes table - stores multiple timestamped notes per assignment with optional images
export const jobNotes = pgTable("job_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertJobNoteSchema = createInsertSchema(jobNotes).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateJobNoteSchema = z.object({
  noteText: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
});

export type InsertJobNote = z.infer<typeof insertJobNoteSchema>;
export type UpdateJobNote = z.infer<typeof updateJobNoteSchema>;
export type JobNote = typeof jobNotes.$inferSelect;

// Client notes table - stores multiple timestamped notes per client/location
// locationId nullable: NULL = company-wide note, non-NULL = location-specific note
export const clientNotes = pgTable("client_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "restrict" }),
  // Nullable: NULL = company-wide note, non-NULL = location-specific note
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "restrict" }),
  // Customer-company-level notes: set when note belongs to a customer company (not a specific location)
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  // Visibility flags — control where this note surfaces
  showOnJobs: boolean("show_on_jobs").notNull().default(false),
  showOnInvoices: boolean("show_on_invoices").notNull().default(false),
  showOnQuotes: boolean("show_on_quotes").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateClientNoteSchema = z.object({
  noteText: z.string().optional(),
  showOnJobs: z.boolean().optional(),
  showOnInvoices: z.boolean().optional(),
  showOnQuotes: z.boolean().optional(),
});

export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type UpdateClientNote = z.infer<typeof updateClientNoteSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;

// Files table — tenant-scoped file metadata for local storage
export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  storageKey: varchar("storage_key").notNull(),
  originalName: varchar("original_name"),
  mimeType: varchar("mime_type"),
  size: integer("size"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type FileRecord = typeof files.$inferSelect;

// Note attachments — join table linking notes to files
export const noteAttachments = pgTable("note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  noteId: varchar("note_id").notNull().references(() => clientNotes.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type NoteAttachment = typeof noteAttachments.$inferSelect;

// Job note attachments — join table linking job notes to files (mirrors note_attachments for client notes)
export const jobNoteAttachments = pgTable("job_note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  noteId: varchar("note_id").notNull().references(() => jobNotes.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type JobNoteAttachment = typeof jobNoteAttachments.$inferSelect;

// Invoice statuses — Canonical lifecycle: draft → awaiting_payment → partial_paid/paid (with void from any non-terminal)
// "sent" is a legacy alias for "awaiting_payment" — kept for backward compatibility with existing persisted data.
// The send-invoice endpoint writes "awaiting_payment" as the canonical value.
export const invoiceStatusEnum = ["draft", "awaiting_payment", "sent", "partial_paid", "paid", "voided"] as const;
export type InvoiceStatus = typeof invoiceStatusEnum[number];

// Invoice line item types
export const lineItemTypeEnum = ["service", "material", "fee", "discount"] as const;
export type LineItemType = typeof lineItemTypeEnum[number];

// Payment methods
export const paymentMethodEnum = ["cash", "credit", "debit", "e-transfer", "cheque", "other"] as const;
export type PaymentMethod = typeof paymentMethodEnum[number];

// Invoices table - syncs with QBO Invoices
// Always belongs to a Location; billing target (Company vs Location) determined by billWithParent flag
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Always links to a Location (client) where work is performed
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }), // Prevent location deletion if invoices exist
  // Parent company reference (for easier querying when billing parent)
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  // Invoice details
  invoiceNumber: text("invoice_number"), // App-side invoice number, may mirror QBO DocNumber
  status: text("status").notNull().default("draft"), // draft, sent, paid, void, cancelled
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"),
  currency: text("currency").notNull().default("CAD"), // e.g., "CAD", "USD"
  // Totals (NUMERIC for proper decimal math)
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0.00"), // Sum of all payments
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0.00"), // total - amountPaid
  // Job reference (if created from a job)
  jobId: varchar("job_id"), // Will be linked after jobs table is defined
  // Tax group reference (v1 tax system — nullable for legacy flat-rate invoices)
  taxGroupId: varchar("tax_group_id"),
  // Payment terms
  paymentTermsDays: integer("payment_terms_days").notNull().default(30), // Net 30, Net 15, etc.
  issuedAt: timestamp("issued_at"), // When invoice was issued (set on send or creation)
  // Tracking
  sentAt: timestamp("sent_at"), // When invoice was sent to client
  sentByUserId: varchar("sent_by_user_id").references(() => users.id, { onDelete: "set null" }), // Who sent the invoice
  viewedAt: timestamp("viewed_at"), // When client viewed the invoice
  // Notes
  notesInternal: text("notes_internal"), // Not sent to QBO
  notesCustomer: text("notes_customer"), // Maps to QBO CustomerMemo
  // Work description (copied from job description when invoice created from job)
  workDescription: text("work_description"), // Full job description / work performed
  // Client message (customer-facing message for invoice PDF/email)
  clientMessage: text("client_message"), // Customer-facing message
  // Client visibility toggles (controls what appears on client-facing invoice)
  showQuantity: boolean("show_quantity").notNull().default(true),
  showUnitPrice: boolean("show_unit_price").notNull().default(true),
  showLineTotals: boolean("show_line_totals").notNull().default(true),
  showLineItems: boolean("show_line_items").notNull().default(true), // If false, client sees only subtotal/total
  showBalance: boolean("show_balance").notNull().default(true),
  // QBO sync fields
  qboInvoiceId: text("qbo_invoice_id"), // QBO Invoice.Id
  qboSyncToken: text("qbo_sync_token"), // QBO Invoice.SyncToken (required for updates)
  qboLastSyncedAt: timestamp("qbo_last_synced_at"),
  qboDocNumber: text("qbo_doc_number"), // QBO DocNumber
  qboSyncStatus: text("qbo_sync_status").notNull().default("NOT_SYNCED"), // NOT_SYNCED | SYNCED | PENDING | ERROR
  qboSyncError: text("qbo_sync_error"), // Last sync error message if any
  // Phase 10A: QBO Billing Lock + Out-of-Sync tracking
  billingLockedAt: timestamp("billing_locked_at"), // When billing was locked (typically on QBO sync)
  billingLockReason: text("billing_lock_reason"), // "QBO_SYNCED" or other reason
  qboOutOfSync: boolean("qbo_out_of_sync").notNull().default(false), // True if edited after QBO sync
  qboOutOfSyncAt: timestamp("qbo_out_of_sync_at"), // When invoice went out of sync
  qboOutOfSyncReason: text("qbo_out_of_sync_reason"), // "Edited after QBO sync: <reason>"
  lastBillingEditAt: timestamp("last_billing_edit_at"), // Last time billing fields were modified
  lastBillingEditBy: varchar("last_billing_edit_by"), // User who made last billing edit
  // Discount fields (Phase 11: Invoice Corrections + Discount Support)
  discountType: text("discount_type"), // "PERCENT" | "AMOUNT" | null (no discount)
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }), // e.g., 10.00 for 10%
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }), // Currency amount
  discountNotes: text("discount_notes"), // Optional reason/description for discount
  // Status
  dirty: boolean("dirty").notNull().default(false), // True if edited after last sync (legacy)
  isActive: boolean("is_active").notNull().default(true), // Legacy soft delete (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  // Optimistic locking
  version: integer("version").notNull().default(0), // Incremented on every update
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Enforce one invoice per job *when jobId is set*
  oneInvoicePerJob: uniqueIndex("invoices_company_job_uq")
    .on(table.companyId, table.jobId)
    .where(sql`job_id is not null`),
  // Enforce unique invoice numbers per company when invoiceNumber is set
  invoiceNumberPerCompany: uniqueIndex("invoices_company_invoice_number_uq")
    .on(table.companyId, table.invoiceNumber)
    .where(sql`invoice_number is not null`),
  // Phase 10A: Indexes for QBO sync lock lookups
  qboOutOfSyncIdx: index("invoices_company_qbo_out_of_sync_idx")
    .on(table.companyId, table.qboOutOfSync),
  qboSyncedAtIdx: index("invoices_company_qbo_synced_at_idx")
    .on(table.companyId, table.qboLastSyncedAt),
  qboInvoiceIdIdx: index("invoices_qbo_invoice_id_idx")
    .on(table.qboInvoiceId),
}));

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(invoiceStatusEnum).default("draft"),
  issueDate: z.string(), // Accept string for date input
});

export const updateInvoiceSchema = z.object({
  locationId: z.string().optional(),
  customerCompanyId: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  status: z.enum(invoiceStatusEnum).optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().optional(),
  subtotal: z.string().optional(),
  taxTotal: z.string().optional(),
  total: z.string().optional(),
  amountPaid: z.string().optional(),
  balance: z.string().optional(),
  jobId: z.string().nullable().optional(),
  sentAt: z.date().nullable().optional(),
  viewedAt: z.date().nullable().optional(),
  notesInternal: z.string().nullable().optional(),
  notesCustomer: z.string().nullable().optional(),
  workDescription: z.string().nullable().optional(),
  clientMessage: z.string().nullable().optional(),
  showQuantity: z.boolean().optional(),
  showUnitPrice: z.boolean().optional(),
  showLineTotals: z.boolean().optional(),
  showLineItems: z.boolean().optional(),
  showBalance: z.boolean().optional(),
  qboInvoiceId: z.string().nullable().optional(),
  qboSyncToken: z.string().nullable().optional(),
  qboLastSyncedAt: z.date().nullable().optional(),
  qboDocNumber: z.string().nullable().optional(),
  qboSyncStatus: z.string().optional(),
  qboSyncError: z.string().nullable().optional(),
  // Phase 10A: QBO lock fields
  billingLockedAt: z.date().nullable().optional(),
  billingLockReason: z.string().nullable().optional(),
  qboOutOfSync: z.boolean().optional(),
  qboOutOfSyncAt: z.date().nullable().optional(),
  qboOutOfSyncReason: z.string().nullable().optional(),
  lastBillingEditAt: z.date().nullable().optional(),
  lastBillingEditBy: z.string().nullable().optional(),
  dirty: z.boolean().optional(),
  isActive: z.boolean().optional(),
  deletedAt: z.date().nullable().optional(),
  // Discount fields (Phase 11)
  discountType: z.enum(["PERCENT", "AMOUNT"]).nullable().optional(),
  discountPercent: z.string().nullable().optional(), // numeric as string
  discountAmount: z.string().nullable().optional(), // numeric as string
  discountNotes: z.string().nullable().optional(),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Invoice line items table
export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(), // Ordering
  lineItemType: text("line_item_type").notNull().default("service"), // service, material, fee, discount
  description: text("description").notNull(),
  date: date("date"), // Optional date for the line item
  technicianId: varchar("technician_id"), // Optional technician reference
  quantity: text("quantity").notNull().default("1"), // Stored as text for decimal precision
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // Cost per unit (for profit margin calc)
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0.0000"), // Tax rate as decimal (e.g., 0.1300 for 13%)
  lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"), // quantity * unitPrice
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0.00"), // lineSubtotal + taxAmount
  taxCode: text("tax_code"), // Tax code name/identifier
  // Job reference (if converted from job)
  jobLineItemId: varchar("job_line_item_id"), // Reference to original job part
  // Product reference (links to items table for QBO sync)
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }), // Optional link to items
  // QBO mapping fields
  qboItemRefId: text("qbo_item_ref_id"), // Maps to QBO ItemRef (product/service)
  qboTaxCodeRefId: text("qbo_tax_code_ref_id"), // Maps to QBO TaxCodeRef
  // Metadata for extensibility
  metadata: text("metadata"), // JSON string for future use
  // Source tracking - manual vs job-derived
  source: text("source").notNull().default("manual"), // "manual" or "job"
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
    lineItemType: z.enum(lineItemTypeEnum).default("service"),
    source: z.enum(["manual", "job"]).default("manual"),

});

export const updateInvoiceLineSchema = z.object({
  lineNumber: z.number().int().optional(),
  lineItemType: z.enum(lineItemTypeEnum).optional(),
  description: z.string().optional(),
  date: z.string().nullable().optional(),
  technicianId: z.string().nullable().optional(),
  quantity: z.string().optional(),
  unitCost: z.string().nullable().optional(),
  unitPrice: z.string().optional(),
  taxRate: z.string().optional(),
  lineSubtotal: z.string().optional(),
  taxCode: z.string().nullable().optional(),
  jobLineItemId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(), // Link to items table for QBO sync
  qboItemRefId: z.string().nullable().optional(),
  qboTaxCodeRefId: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
});

export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type UpdateInvoiceLine = z.infer<typeof updateInvoiceLineSchema>;
export type InvoiceLine = typeof invoiceLines.$inferSelect;

// Payments table - tracks payments against invoices
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("other"), // cash, credit, debit, e-transfer, cheque, other
  reference: text("reference"), // Transaction ID, cheque number, etc.
  receivedAt: timestamp("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
}).extend({
  method: z.enum(paymentMethodEnum).default("other"),
  receivedAt: z.string().optional(), // Accept string for date input
});

export const updatePaymentSchema = z.object({
  amount: z.string().optional(),
  method: z.enum(paymentMethodEnum).optional(),
  reference: z.string().nullable().optional(),
  receivedAt: z.string().optional(),
  notes: z.string().nullable().optional(),
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// ============================================
// JOBS SYSTEM
// ============================================

// Job status enum values - FIXED SYSTEM ENUM (not user-editable)
// These represent the job lifecycle stages
//
// =============================================================================
// JOB STATUS MODEL (v2.0 - Four Lifecycle States)
// =============================================================================
//
// STATUS represents LIFECYCLE ONLY (4 values):
// - "open"      - Job is active, can be worked on
// - "completed" - Work is finished
// - "invoiced"  - Invoice has been created (locked)
// - "archived"  - Job is archived for historical reference
//
// SCHEDULING is DERIVED (not stored in status):
// - "scheduled" state is derived from: scheduledStart IS NOT NULL OR isAllDay = true
// - "unscheduled" state is derived from: scheduledStart IS NULL AND isAllDay = false
//
// ASSIGNMENT is DERIVED (not stored in status):
// - "assigned" state is derived from: assignedTechnicianIds.length > 0 OR primaryTechnicianId IS NOT NULL
//
// WORKFLOW STATES (when status = 'open') use openSubStatus:
// - null         - Default, no special workflow state
// - "in_progress" - Work actively being performed
// - "on_hold"     - Job is blocked (requires holdReason)
// - "on_route"    - Technician traveling to job site
// - (needs_review: removed — migrated to on_hold)
//
// INVARIANT: openSubStatus must be NULL when status !== 'open'
//
// =============================================================================

// Lifecycle-only status enum (4 values)
export const jobStatusEnum = [
  "open",       // Active job that can be worked on
  "completed",  // Work finished (may need invoicing)
  "invoiced",   // Invoice created (locked for billing)
  "archived",   // Historical archive
] as const;
export type JobStatus = typeof jobStatusEnum[number];

// Workflow sub-status (only valid when status = 'open')
export const openSubStatusEnum = [
  "in_progress",   // Work actively being performed
  "on_hold",       // Job is blocked (requires holdReason)
  "on_route",      // Technician traveling to job site
  // needs_review: REMOVED — data migrated to on_hold, zero live rows, columns dropped.
] as const;
export type OpenSubStatus = typeof openSubStatusEnum[number];

// 2026-03-18: normalizeJobStatus() REMOVED — DB CHECK constraint (jobs_status_check)
// guarantees only canonical values exist: open, completed, invoiced, archived.
// Live DB verified: zero legacy rows, constraint enforced at PostgreSQL level.
// All code now operates directly on canonical status values.

/**
 * Derive openSubStatus from legacy status.
 * Returns null if the legacy status doesn't map to a workflow sub-status.
 */
export function deriveOpenSubStatus(legacyStatus: string): OpenSubStatus | null {
  switch (legacyStatus) {
    case "in_progress":
      return "in_progress";
    case "on_hold":
      return "on_hold";
    default:
      return null;
  }
}

/**
 * CANONICAL SCHEDULING PREDICATE - Single Source of Truth
 *
 * A job is "scheduled" if and only if scheduledStart IS NOT NULL.
 *
 * IMPORTANT: isAllDay is a DISPLAY flag only, NOT a scheduling determinant.
 * For all-day events, scheduledStart MUST be set to midnight (00:00:00) of the day.
 * This ensures all scheduled jobs (timed or all-day) have a non-null scheduledStart.
 *
 * This replaces the old logic that checked `scheduledStart != null || isAllDay === true`
 * which caused inconsistency where isAllDay=true with null scheduledStart was considered scheduled.
 */
export function isJobScheduled(job: { scheduledStart?: Date | string | null }): boolean {
  return job.scheduledStart != null;
}

/**
 * Check if a job is "assigned" (has technician(s) assigned).
 * This replaces the old status === 'assigned' check.
 */
export function isJobAssigned(job: {
  primaryTechnicianId?: string | null;
  assignedTechnicianIds?: string[] | null;
}): boolean {
  return (
    job.primaryTechnicianId != null ||
    (Array.isArray(job.assignedTechnicianIds) && job.assignedTechnicianIds.length > 0)
  );
}

/**
 * CANONICAL BACKLOG PREDICATE - Single Source of Truth
 *
 * A job is "backlog eligible" (should appear in unscheduled sidebar) if:
 * - status === 'open' (active, not terminal)
 * - NOT scheduled (scheduledStart IS NULL)
 *
 * This is THE predicate for determining backlog eligibility.
 * Server queries and client filters should use this.
 */
export function isBacklogEligible(job: {
  status?: string | null;
  scheduledStart?: Date | string | null;
  openSubStatus?: string | null;
}): boolean {
  // Must be open status
  const status = job.status ?? "open";
  if (status !== "open") {
    return false;
  }
  // 2026-03-17: On-hold jobs are deliberately parked, not unscheduled backlog
  if ((job as any).openSubStatus === "on_hold") {
    return false;
  }
  // Must NOT be scheduled
  return !isJobScheduled(job);
}

/**
 * CANONICAL OVERDUE PREDICATE - Single Source of Truth
 *
 * A job is "overdue" if ALL of the following are true:
 * - status === 'open' (active, not completed/invoiced/archived)
 * - isJobScheduled(job) === true (has a scheduled start)
 * - scheduledStart < now (past the scheduled time)
 *
 * IMPORTANT:
 * - Completed/invoiced/archived jobs are NEVER overdue (work is done)
 * - Backlog jobs (unscheduled) are NEVER overdue (no schedule to miss)
 * - All-day jobs use midnight of their scheduled date for comparison
 *
 * @param job - Job object with status and scheduledStart
 * @param now - Current time (defaults to new Date())
 * @returns true if job is overdue
 */
/**
 * Canonical effective-end computation — SINGLE SOURCE OF TRUTH (JS-side).
 *
 * Computes the time by which a job or visit should have completed.
 * Used by isJobOverdue() and visitIntelligence for consistent overdue/running-long detection.
 *
 * Resolution priority:
 * 1. scheduledEnd if present (includes all-day jobs which have 23:59:59 end time)
 * 2. scheduledStart + duration if duration present (supports both durationMinutes and estimatedDurationMinutes)
 * 3. scheduledStart as fallback (point-in-time job/visit, overdue once start time passes)
 * 4. null if no scheduledStart
 *
 * SQL equivalent: effectiveEndExpr in server/lib/queryHelpers.ts (must be kept in sync).
 * SQL operates on jobs-table fields only and does not include estimatedDurationMinutes
 * (which exists on jobVisits, not jobs). This JS function may be used with broader
 * entity shapes; do not expand SQL semantics unless the underlying jobs schema changes.
 *
 * 2026-03-18: Extracted from inline logic in isJobOverdue() and visitIntelligence.ts
 * to eliminate a proven computation drift (visitIntelligence was missing the
 * scheduledStart-only fallback).
 * SYNC: tests/effective-end-sync.test.ts enforces parity for job-scoped fields only.
 */
export function getEffectiveEnd(entity: {
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  durationMinutes?: number | null;
  estimatedDurationMinutes?: number | null;
}): Date | null {
  if (!entity.scheduledStart) {
    return null;
  }

  if (entity.scheduledEnd) {
    return entity.scheduledEnd instanceof Date
      ? entity.scheduledEnd
      : new Date(entity.scheduledEnd);
  }

  // Nullish check: 0 is a valid duration (resolves to scheduledStart via start + 0).
  // This aligns with SQL where durationMinutes = 0 IS NOT NULL → branch selected.
  const duration = entity.durationMinutes != null
    ? entity.durationMinutes
    : entity.estimatedDurationMinutes;
  if (duration != null) {
    const startDate = entity.scheduledStart instanceof Date
      ? entity.scheduledStart
      : new Date(entity.scheduledStart);
    return new Date(startDate.getTime() + duration * 60 * 1000);
  }

  // Fallback: scheduledStart itself (point-in-time)
  return entity.scheduledStart instanceof Date
    ? entity.scheduledStart
    : new Date(entity.scheduledStart);
}

/**
 * Canonical overdue predicate - AUTHORITATIVE RULE
 *
 * A job is overdue ONLY when:
 * - status === 'open' (completed/invoiced/archived are NEVER overdue)
 * - scheduledStart IS NOT NULL (backlog/unscheduled is NEVER overdue)
 * - effectiveEnd < now (job should have finished by now)
 *
 * Uses getEffectiveEnd() for the canonical effective-end computation.
 *
 * For all-day jobs: MODEL A sets scheduledEnd to 23:59:59 of that day, so they're
 * only overdue once the entire day has passed.
 */
export function isJobOverdue(
  job: {
    status?: string | null;
    openSubStatus?: string | null;
    scheduledStart?: Date | string | null;
    scheduledEnd?: Date | string | null;
    durationMinutes?: number | null;
  },
  now?: Date
): boolean {
  // Only open jobs can be overdue
  const status = job.status ?? "open";
  if (status !== "open") {
    return false;
  }

  // Jobs actively being worked are not overdue-attention
  const sub = job.openSubStatus;
  if (sub === "in_progress" || sub === "on_route") {
    return false;
  }

  // Must be scheduled to be overdue (backlog is never overdue)
  if (!isJobScheduled(job)) {
    return false;
  }

  const currentTime = now ?? new Date();

  // 2026-03-18: Uses canonical getEffectiveEnd() instead of inline computation
  const effectiveEnd = getEffectiveEnd(job);
  if (!effectiveEnd) {
    return false;
  }

  // Job is overdue if it should have finished by now
  return effectiveEnd < currentTime;
}

// Hold reason values (when openSubStatus = 'on_hold')
// Note: holdReason is REQUIRED when openSubStatus = 'on_hold'
export const holdReasonEnum = [
  "parts",      // Waiting for parts
  "customer",   // Waiting for customer response/approval
  "access",     // Cannot access location
  "approval",   // Waiting for internal approval
  "weather",    // Weather-related delay
  "other",      // Other reason (see notes)
] as const;
export type HoldReason = typeof holdReasonEnum[number];

/** Canonical hold reason labels — single source of truth for UI display */
export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  parts:    "Waiting for Parts",
  customer: "Customer Approval",
  access:   "Access Issue",
  approval: "Internal Approval",
  weather:  "Weather Delay",
  other:    "Other",
};

/** Hold reason options for UI dropdowns (derived from schema enum + labels) */
export const HOLD_REASON_OPTIONS = holdReasonEnum.map(value => ({
  value,
  label: HOLD_REASON_LABELS[value],
}));

/** Get human-readable label for a hold reason value */
export function getHoldReasonLabel(value: string): string {
  return HOLD_REASON_LABELS[value as HoldReason] ?? value;
}

// Job priority enum values
export const jobPriorityEnum = ["low", "medium", "high", "urgent"] as const;
export type JobPriority = typeof jobPriorityEnum[number];

// Job type enum values
export const jobTypeEnum = ["maintenance", "repair", "inspection", "installation", "emergency"] as const;
export type JobType = typeof jobTypeEnum[number];

// Recurrence frequency enum values
export const recurrenceFrequencyEnum = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurrenceFrequency = typeof recurrenceFrequencyEnum[number];

// Recurring Job Series - template for recurring jobs
export const recurringJobSeries = pgTable("recurring_job_series", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  // Template fields
  baseSummary: text("base_summary").notNull(),
  baseDescription: text("base_description"),
  baseJobType: text("base_job_type").notNull().default("service"),
  basePriority: text("base_priority").notNull().default("normal"),
  defaultTechnicianId: varchar("default_technician_id").references(() => users.id, { onDelete: "set null" }),
  // Scheduling context
  startDate: date("start_date").notNull(),
  timezone: text("timezone").default("America/Toronto"),
  notes: text("notes"),
  // Status
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  // Metadata
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertRecurringJobSeriesSchema = createInsertSchema(recurringJobSeries).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  baseJobType: z.enum(jobTypeEnum).default("maintenance"),
  basePriority: z.enum(jobPriorityEnum).default("medium"),
});

export type InsertRecurringJobSeries = z.infer<typeof insertRecurringJobSeriesSchema>;
export type RecurringJobSeries = typeof recurringJobSeries.$inferSelect;

// Recurring Job Phases - each phase in a multi-phase recurrence
export const recurringJobPhases = pgTable("recurring_job_phases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seriesId: varchar("series_id").notNull().references(() => recurringJobSeries.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  // Recurrence pattern
  frequency: text("frequency").notNull(), // daily, weekly, monthly, quarterly, yearly
  interval: integer("interval").notNull().default(1), // e.g., every 2 weeks
  // End conditions (mutually exclusive)
  occurrences: integer("occurrences"), // Run for N occurrences
  untilDate: date("until_date"), // Run until this date
});

export const insertRecurringJobPhaseSchema = createInsertSchema(recurringJobPhases).omit({
  id: true,
}).extend({
  frequency: z.enum(recurrenceFrequencyEnum),
  interval: z.number().int().min(1).default(1),
  occurrences: z.number().int().min(1).nullable().optional(),
  untilDate: z.string().nullable().optional(), // Accept string for date input
});

export type InsertRecurringJobPhase = z.infer<typeof insertRecurringJobPhaseSchema>;
export type RecurringJobPhase = typeof recurringJobPhases.$inferSelect;

// Jobs table - individual job instances
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }), // Prevent location deletion if jobs exist
  // Job identification
  jobNumber: integer("job_number").notNull(),
  // Assignment
  primaryTechnicianId: varchar("primary_technician_id").references(() => users.id, { onDelete: "set null" }),
  assignedTechnicianIds: varchar("assigned_technician_ids").array(),
  // Status and classification (4-value lifecycle model)
  // See shared/schema.ts jobStatusEnum for valid values: open, completed, invoiced, archived
  status: text("status").notNull().default("open"),
  // Workflow sub-status (only valid when status = 'open')
  // See shared/schema.ts openSubStatusEnum: in_progress, on_hold, on_route
  openSubStatus: text("open_sub_status"),
  holdReason: text("hold_reason"), // Required when openSubStatus = "on_hold" (parts, customer, access, approval, weather, other)
  priority: text("priority").notNull().default("medium"),
  jobType: text("job_type").notNull().default("maintenance"),
  // Job details
  summary: text("summary").notNull(),
  description: text("description"),
  accessInstructions: text("access_instructions"),
  // Scheduling
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
  isAllDay: boolean("is_all_day").notNull().default(false), // True = all-day event, appears in all-day lane
  durationMinutes: integer("duration_minutes"), // Scheduled job duration for effectiveEnd calculation
  actualStart: timestamp("actual_start"),
  actualEnd: timestamp("actual_end"),
  // Travel tracking (for billing drive time)
  travelStartedAt: timestamp("travel_started_at"),  // When tech started traveling to job
  arrivedOnSiteAt: timestamp("arrived_on_site_at"), // When tech arrived at job site
  // Billing
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  qboInvoiceId: text("qbo_invoice_id"),
  billingNotes: text("billing_notes"),
  // Recurrence linkage (legacy)
  recurringSeriesId: varchar("recurring_series_id").references(() => recurringJobSeries.id, { onDelete: "set null" }),
  // Recurrence linkage (v1.1 - template-based generation)
  recurrenceTemplateId: varchar("recurrence_template_id"), // FK to recurring_job_templates (defined later in schema)
  recurrenceInstanceDate: date("recurrence_instance_date"), // Date this job was generated for
  // PM Billing Disposition: Snapshot of billing rules at job generation time
  pmBillingModel: text("pm_billing_model"), // Snapshot from contract: per_visit | monthly_fixed | annual_prepaid | do_not_bill
  pmBillingDisposition: text("pm_billing_disposition"), // Derived: invoice_on_completion | covered_by_contract | archive_no_invoice
  pmBillingStatus: text("pm_billing_status"), // Lifecycle: pending_invoice | invoiced | no_invoice_expected | billing_exception
  pmBillingLabel: text("pm_billing_label"), // Human-readable label snapshot from contract
  // REMOVED: calendarAssignmentId - scheduling is now stored directly on jobs table
  // See: scheduledStart, scheduledEnd, isAllDay fields above
  // Hold state fields (when status = "on_hold")
  holdNotes: text("hold_notes"),                        // Optional notes about why job is on hold
  nextActionDate: date("next_action_date"),             // Optional follow-up date
  onHoldAt: timestamp("on_hold_at"),                    // When job entered on_hold status (for aging)
  // 2026-03-18: actionRequired* columns DROPPED from DB.
  // Data migrated to canonical hold fields (onHoldAt, holdReason, holdNotes).
  // See: migrations/2026_03_18_drop_deprecated_action_required_columns.sql
  // Undo close support (20-second window)
  previousStatus: text("previous_status"),              // Status before close, for undo
  closedAt: timestamp("closed_at"),                     // When job was closed, for undo window
  closedBy: text("closed_by"),                          // User ID who closed the job
  // Soft deletion / state
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  // Optimistic locking
  // TASK 2: Default 1 (not 0) so new jobs start at version 1
  version: integer("version").notNull().default(1),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  jobNumberPerCompany: uniqueIndex("jobs_company_job_number_uq").on(table.companyId, table.jobNumber),
  // Performance: Calendar range queries filter by company + scheduled_start
  calendarRangeIdx: index("jobs_calendar_range_idx").on(table.companyId, table.scheduledStart),
  // Performance: Technician-specific calendar queries
  technicianScheduleIdx: index("jobs_technician_schedule_idx").on(table.companyId, table.primaryTechnicianId, table.scheduledStart),
  // CHECK: openSubStatus = 'on_hold' requires a holdReason
  holdReasonCheck: check(
    "jobs_hold_reason_check",
    sql`${table.openSubStatus} <> 'on_hold' OR ${table.holdReason} IS NOT NULL`
  ),
  // CHECK: openSubStatus must be NULL when status !== 'open'
  openSubStatusInvariantCheck: check(
    "jobs_open_sub_status_invariant_check",
    sql`${table.status} = 'open' OR ${table.openSubStatus} IS NULL`
  ),
  // CHECK: if closed_at is set, previous_status must also be set (for undo support)
  undoPreviousStatusCheck: check(
    "jobs_undo_previous_status_check",
    sql`${table.closedAt} IS NULL OR ${table.previousStatus} IS NOT NULL`
  ),
  // CHECK: status must be one of the 4 lifecycle values
  statusCheck: check(
    "jobs_status_check",
    sql`${table.status} IN ('open', 'completed', 'invoiced', 'archived')`
  ),
  // CHECK: scheduledEnd requires scheduledStart (no end without start)
  scheduledEndRequiresStartCheck: check(
    "jobs_scheduled_end_requires_start_check",
    sql`${table.scheduledEnd} IS NULL OR ${table.scheduledStart} IS NOT NULL`
  ),
  // CHECK: All-day events must have scheduledStart at midnight (UTC-safe)
  allDayStartMidnightCheck: check(
    "jobs_all_day_start_midnight_check",
    sql`${table.isAllDay} IS DISTINCT FROM TRUE OR (EXTRACT(HOUR FROM (${table.scheduledStart} AT TIME ZONE 'UTC')) = 0 AND EXTRACT(MINUTE FROM (${table.scheduledStart} AT TIME ZONE 'UTC')) = 0 AND EXTRACT(SECOND FROM (${table.scheduledStart} AT TIME ZONE 'UTC')) = 0)`
  ),
  // CHECK: All-day events must have scheduledEnd at 23:59:59 (UTC-safe)
  allDayEnd2359Check: check(
    "jobs_all_day_end_2359_check",
    sql`${table.isAllDay} IS DISTINCT FROM TRUE OR (EXTRACT(HOUR FROM (${table.scheduledEnd} AT TIME ZONE 'UTC')) = 23 AND EXTRACT(MINUTE FROM (${table.scheduledEnd} AT TIME ZONE 'UTC')) = 59 AND EXTRACT(SECOND FROM (${table.scheduledEnd} AT TIME ZONE 'UTC')) = 59)`
  ),
}));

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  companyId: true,
  jobNumber: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(jobStatusEnum).default("open"),
  holdReason: z.enum(holdReasonEnum).nullable().optional(),
  priority: z.enum(jobPriorityEnum).default("medium"),
  jobType: z.enum(jobTypeEnum).default("maintenance"),
  // Scheduling fields
  scheduledStart: z.string().nullable().optional(), // Accept ISO string
  scheduledEnd: z.string().nullable().optional(),
  isAllDay: z.boolean().optional(), // All-day event flag
  durationMinutes: z.number().int().min(0).optional(), // Duration in minutes (for scheduling)
  // Hold state fields
  holdNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // Accept ISO date string (YYYY-MM-DD)
});

export const updateJobSchema = z.object({
  // Editable job number — integer, positive, no decimals
  jobNumber: z.number().int().positive().optional(),
  locationId: z.string().optional(),
  primaryTechnicianId: z.string().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  // 2026-03-18: status and holdReason removed from generic update schema.
  // Lifecycle fields MUST be written through jobLifecycleOrchestrator only.
  // status: REMOVED — use lifecycle orchestrator intents
  // holdReason: REMOVED — use PLACE_JOB_ON_HOLD intent
  priority: z.enum(jobPriorityEnum).optional(),
  jobType: z.enum(jobTypeEnum).optional(),
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  accessInstructions: z.string().nullable().optional(),
  // Scheduling fields
  scheduledStart: z.string().nullable().optional(),
  scheduledEnd: z.string().nullable().optional(),
  isAllDay: z.boolean().optional(), // All-day event flag
  durationMinutes: z.number().int().min(0).optional(), // Duration in minutes (for scheduling)
  actualStart: z.string().nullable().optional(),
  actualEnd: z.string().nullable().optional(),
  // Travel tracking
  travelStartedAt: z.string().nullable().optional(),
  arrivedOnSiteAt: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  qboInvoiceId: z.string().nullable().optional(),
  billingNotes: z.string().nullable().optional(),
  // 2026-03-18: Hold/lifecycle/deprecated fields removed from generic update schema.
  // holdNotes: REMOVED — use UPDATE_HOLD_METADATA intent
  // nextActionDate: REMOVED — use UPDATE_HOLD_METADATA intent
  // onHoldAt: REMOVED — managed by orchestrator
  // actionRequired* columns: DROPPED from DB (2026-03-18)
  // previousStatus: REMOVED — managed by lifecycle engine
  // closedAt: REMOVED — managed by lifecycle engine
  // closedBy: REMOVED — managed by lifecycle engine
  isActive: z.boolean().optional(),
  // Optimistic locking
  version: z.number().int().optional(), // Expected version for optimistic locking
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ============================================================================
// JOB STATUS EVENTS - Audit trail for job status changes
// ============================================================================
export const jobStatusEvents = pgTable("job_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  changedAt: timestamp("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  changedBy: text("changed_by"), // User ID who made the change
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  note: text("note"), // Optional note about the change
  meta: jsonb("meta"), // Additional context: { reason, mode, invoiceId, etc. }
}, (table) => ({
  companyIdx: index("job_status_events_company_idx").on(table.companyId),
  jobIdx: index("job_status_events_job_idx").on(table.jobId),
  changedAtIdx: index("job_status_events_changed_at_idx").on(table.changedAt),
}));

export const insertJobStatusEventSchema = createInsertSchema(jobStatusEvents).omit({
  id: true,
  companyId: true,
  changedAt: true,
});

export type InsertJobStatusEvent = z.infer<typeof insertJobStatusEventSchema>;
export type JobStatusEvent = typeof jobStatusEvents.$inferSelect;

// ============================================================================
// JOB SCHEDULE AUDIT - Audit trail for scheduling changes
// ============================================================================
export const jobScheduleAudit = pgTable("job_schedule_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  contextLabel: text("context_label").notNull(), // e.g., "route:jobs:create", "storage:createAssignment"
  oldFields: jsonb("old_fields"), // Previous scheduling state (null for new jobs)
  newFields: jsonb("new_fields").notNull(), // New scheduling state
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Composite index for efficient audit history queries by job (most common access pattern)
  jobHistoryIdx: index("job_schedule_audit_job_history_idx").on(table.jobId, table.createdAt),
  // Tenant isolation index
  companyIdx: index("job_schedule_audit_company_idx").on(table.companyId),
}));

export type JobScheduleAudit = typeof jobScheduleAudit.$inferSelect;
export type InsertJobScheduleAudit = typeof jobScheduleAudit.$inferInsert;

// ============================================================================
// LOCATION PM PLAN - Preventative Maintenance schedule per location
// ============================================================================
// This table will be used to calculate part demand per month across all locations.
// Example: sum quantityPerVisit for all PM visits scheduled in a month to get
// projected filter/belt requirements for inventory planning.
export const locationPMPlans = pgTable("location_pm_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  hasPm: boolean("has_pm").notNull().default(false),
  pmType: text("pm_type"), // e.g. "filters only", "full HVAC PM"
  // Monthly PM flags
  pmJan: boolean("pm_jan").notNull().default(false),
  pmFeb: boolean("pm_feb").notNull().default(false),
  pmMar: boolean("pm_mar").notNull().default(false),
  pmApr: boolean("pm_apr").notNull().default(false),
  pmMay: boolean("pm_may").notNull().default(false),
  pmJun: boolean("pm_jun").notNull().default(false),
  pmJul: boolean("pm_jul").notNull().default(false),
  pmAug: boolean("pm_aug").notNull().default(false),
  pmSep: boolean("pm_sep").notNull().default(false),
  pmOct: boolean("pm_oct").notNull().default(false),
  pmNov: boolean("pm_nov").notNull().default(false),
  pmDec: boolean("pm_dec").notNull().default(false),
  notes: text("notes"),
  recurringSeriesId: varchar("recurring_series_id").references(() => recurringJobSeries.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertLocationPMPlanSchema = createInsertSchema(locationPMPlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateLocationPMPlanSchema = z.object({
  hasPm: z.boolean().optional(),
  pmType: z.string().nullable().optional(),
  pmJan: z.boolean().optional(),
  pmFeb: z.boolean().optional(),
  pmMar: z.boolean().optional(),
  pmApr: z.boolean().optional(),
  pmMay: z.boolean().optional(),
  pmJun: z.boolean().optional(),
  pmJul: z.boolean().optional(),
  pmAug: z.boolean().optional(),
  pmSep: z.boolean().optional(),
  pmOct: z.boolean().optional(),
  pmNov: z.boolean().optional(),
  pmDec: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  recurringSeriesId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertLocationPMPlan = z.infer<typeof insertLocationPMPlanSchema>;
export type UpdateLocationPMPlan = z.infer<typeof updateLocationPMPlanSchema>;
export type LocationPMPlan = typeof locationPMPlans.$inferSelect;

// ============================================================================
// LOCATION EQUIPMENT - Equipment tracked per location
// ============================================================================
// Equipment is tracked independently for model/serial/notes.
// Some equipment might have no PM parts (tracked for service history only).
// Equipment can be linked to PM parts templates and job parts.
// When generating PM jobs, if LocationPMPartTemplate has an equipmentId,
// the created JobPart is tied to that equipment (via JobEquipment).
// Prepares for future features: Job → Equipment associations, equipment service history.
export const locationEquipment = pgTable("location_equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g. "RTU #1", "Walk-in Freezer", "Make-up Air #2"
  equipmentType: text("equipment_type"), // e.g. "RTU", "Furnace", "Freezer"
  manufacturer: text("manufacturer"),
  modelNumber: text("model_number"),
  serialNumber: text("serial_number"),
  tagNumber: text("tag_number"), // internal asset tag or label
  installDate: date("install_date"),
  warrantyExpiry: date("warranty_expiry"),
  notes: text("notes"),
  nameplatePhotoId: varchar("nameplate_photo_id").references(() => files.id, { onDelete: "set null" }), // Nameplate photo for OCR + reference (2026-03-06)
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertLocationEquipmentSchema = createInsertSchema(locationEquipment).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateLocationEquipmentSchema = z.object({
  name: z.string().optional(),
  equipmentType: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  modelNumber: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  tagNumber: z.string().nullable().optional(),
  installDate: z.string().nullable().optional(),
  warrantyExpiry: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  nameplatePhotoId: z.string().nullable().optional(), // FK to files table (2026-03-06)
  isActive: z.boolean().optional(),
});

export type InsertLocationEquipment = z.infer<typeof insertLocationEquipmentSchema>;
export type UpdateLocationEquipment = z.infer<typeof updateLocationEquipmentSchema>;
export type LocationEquipment = typeof locationEquipment.$inferSelect;

// ============================================================================
// EQUIPMENT CATALOG ITEMS — Reference associations to catalog items (2026-03-06)
// ============================================================================
// Purely informational: shows which catalog items (parts/services) are commonly
// used when servicing a piece of equipment. NOT inventory, NOT auto-billing.
export const equipmentCatalogItems = pgTable("equipment_catalog_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  equipmentId: varchar("equipment_id").notNull().references(() => locationEquipment.id, { onDelete: "cascade" }),
  catalogItemId: varchar("catalog_item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  equipUnique: unique("equipment_catalog_items_unique").on(table.companyId, table.equipmentId, table.catalogItemId),
  equipIdx: index("equipment_catalog_items_equip_idx").on(table.companyId, table.equipmentId, table.sortOrder),
  itemIdx: index("equipment_catalog_items_item_idx").on(table.companyId, table.catalogItemId),
}));

export const insertEquipmentCatalogItemSchema = createInsertSchema(equipmentCatalogItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateEquipmentCatalogItemSchema = z.object({
  quantity: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export type EquipmentCatalogItem = typeof equipmentCatalogItems.$inferSelect;
export type InsertEquipmentCatalogItem = z.infer<typeof insertEquipmentCatalogItemSchema>;

// ============================================================================
// LOCATION PM PART TEMPLATE - Parts/filters/belts used at each PM visit
// ============================================================================
// These templates are copied into JobPart entries when generating PM jobs.
// Used for inventory planning: sum quantityPerVisit across all locations for
// a given month to project parts demand.
// If equipmentId is null, the PM part is location-level (applies to site generally).
// If equipmentId is non-null, the PM part is specific to that equipment.
export const locationPMPartTemplates = pgTable("location_pm_part_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  equipmentId: varchar("equipment_id").references(() => locationEquipment.id, { onDelete: "set null" }), // Optional link to specific equipment
  descriptionOverride: text("description_override"), // Custom description for job/invoice
  quantityPerVisit: text("quantity_per_visit").notNull(), // Stored as text for decimal precision
  equipmentLabel: text("equipment_label"), // Legacy: e.g. "RTU #1", "Freezer 3" - use equipmentId when possible
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertLocationPMPartTemplateSchema = createInsertSchema(locationPMPartTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateLocationPMPartTemplateSchema = z.object({
  productId: z.string().optional(),
  equipmentId: z.string().nullable().optional(),
  descriptionOverride: z.string().nullable().optional(),
  quantityPerVisit: z.string().optional(),
  equipmentLabel: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertLocationPMPartTemplate = z.infer<typeof insertLocationPMPartTemplateSchema>;
export type UpdateLocationPMPartTemplate = z.infer<typeof updateLocationPMPartTemplateSchema>;
export type LocationPMPartTemplate = typeof locationPMPartTemplates.$inferSelect;

// ============================================================================
// JOB PARTS - Parts attached to individual jobs
// ============================================================================
// When a PM job is generated, LocationPMPartTemplate entries are copied here.
// Later converted to invoice lines when billing.
// JobPart.equipmentId is optional and used when parts are clearly tied to a specific equipment.
export const jobPartSourceEnum = ["pm_template", "added_by_tech", "quoted", "manual"] as const;

export const jobParts = pgTable("job_parts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }),
  equipmentId: varchar("equipment_id").references(() => locationEquipment.id, { onDelete: "set null" }), // Optional link to equipment
  description: text("description").notNull(),
  quantity: text("quantity").notNull(), // Stored as text for decimal precision
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // Cost per unit (for profit margin calc)
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }), // Price per unit // pm_template, added_by_tech, quoted, manual
  equipmentLabel: text("equipment_label"), // Legacy: Copied from PM template or added by tech
  sortOrder: integer("sort_order").notNull().default(0), // For ordering line items in Parts & Billing
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertJobPartSchema = createInsertSchema(jobParts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  unitCost: z.string().nullable().optional(),
  equipmentId: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

export const updateJobPartSchema = z.object({
  productId: z.string().nullable().optional(),
  equipmentId: z.string().nullable().optional(),
  description: z.string().optional(),
  quantity: z.string().optional(),
  unitCost: z.string().nullable().optional(),
  unitPrice: z.string().nullable().optional(),
  equipmentLabel: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

export type InsertJobPart = z.infer<typeof insertJobPartSchema>;
export type UpdateJobPart = z.infer<typeof updateJobPartSchema>;
export type JobPart = typeof jobParts.$inferSelect;

// ============================================================================
// JOB EQUIPMENT - Links jobs to equipment worked on
// ============================================================================
// JobEquipment tracks which equipment a job touched, enabling equipment service history.
// Some jobs may have no equipment linked (general work at the location).
// Some equipment may never have PM parts but will still appear on jobs for one-off service calls.
export const jobEquipment = pgTable("job_equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  equipmentId: varchar("equipment_id").notNull().references(() => locationEquipment.id, { onDelete: "cascade" }),
  notes: text("notes"), // e.g. "worked on condenser section only"
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertJobEquipmentSchema = createInsertSchema(jobEquipment).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateJobEquipmentSchema = z.object({
  notes: z.string().nullable().optional(),
});

export type InsertJobEquipment = z.infer<typeof insertJobEquipmentSchema>;
export type UpdateJobEquipment = z.infer<typeof updateJobEquipmentSchema>;
export type JobEquipment = typeof jobEquipment.$inferSelect;

// ============================================================================
// JOB VISITS - Track individual site visits for jobs
// ============================================================================

// Visit completion outcome — structured replacement for [OUTCOME:] text tags
export const visitOutcomeEnum = ["completed", "needs_parts", "needs_followup"] as const;
export type VisitOutcome = typeof visitOutcomeEnum[number];

export const jobVisitStatusEnum = [
  "scheduled",
  "dispatched",
  "en_route",
  "on_site",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type JobVisitStatus = typeof jobVisitStatusEnum[number];

export const jobVisits = pgTable("job_visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),

  // Calendar compatibility
  scheduledDate: timestamp("scheduled_date").notNull(), // legacy field, keep for backwards compat
  scheduledStart: timestamp("scheduled_start"), // nullable in DB, preferred field for scheduling
  scheduledEnd: timestamp("scheduled_end"),     // nullable in DB
  isAllDay: boolean("is_all_day").notNull().default(false),

  // Duration
  estimatedDurationMinutes: integer("estimated_duration_minutes").default(60),

  // Assignment
  assignedTechnicianId: varchar("assigned_technician_id").references(() => users.id, { onDelete: "set null" }),
  assignedTechnicianIds: varchar("assigned_technician_ids").array(), // DB has array

  // Status
  status: text("status").notNull().default("scheduled"),

  // Visit sequencing
  visitNumber: integer("visit_number"), // nullable in DB, computed by repository

  // Time tracking
  checkedInAt: timestamp("checked_in_at"),
  checkedOutAt: timestamp("checked_out_at"),
  actualDurationMinutes: integer("actual_duration_minutes"),

  // Notes
  visitNotes: text("visit_notes"),

  // Structured visit outcome (Phase 1 dispatch refactor, 2026-03-06)
  // Replaces legacy [OUTCOME: ...] text tags in visitNotes as authoritative source
  outcome: text("outcome"), // "completed" | "needs_parts" | "needs_followup"
  outcomeNote: text("outcome_note"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  isFollowUpNeeded: boolean("is_follow_up_needed").notNull().default(false),

  // Soft delete + optimistic locking
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(0),

  // Archive (soft-delete with audit trail, 2026-03-05)
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedByUserId: varchar("archived_by_user_id"),
  archivedReason: text("archived_reason"),

  // Audit timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});



export const insertJobVisitSchema = createInsertSchema(jobVisits).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  actualDurationMinutes: true,
  version: true,
}).extend({
  status: z.enum(jobVisitStatusEnum).default("scheduled"),
  scheduledDate: z.string().optional(),           // ISO date string (legacy, optional)
  scheduledStart: z.string().optional(),          // ISO timestamp string (nullable in DB)
  scheduledEnd: z.string().optional(),            // ISO timestamp string (nullable in DB)
  isAllDay: z.boolean().default(false),
  estimatedDurationMinutes: z.number().int().positive().default(60),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()).optional(),
  visitNumber: z.number().int().min(1).optional(), // computed by repository if not provided
  visitNotes: z.string().nullable().optional(),
});

export const updateJobVisitSchema = z.object({
  scheduledDate: z.string().optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  isAllDay: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  visitNumber: z.number().int().min(1).optional(),
  status: z.enum(jobVisitStatusEnum).optional(),
  visitNotes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  // Structured outcome fields (Phase 1 dispatch refactor, 2026-03-06)
  outcome: z.enum(visitOutcomeEnum).nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
  completedByUserId: z.string().uuid().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  isFollowUpNeeded: z.boolean().optional(),
});


export type InsertJobVisit = z.infer<typeof insertJobVisitSchema>;
export type UpdateJobVisit = z.infer<typeof updateJobVisitSchema>;
export type JobVisit = typeof jobVisits.$inferSelect;

// ============================================================================
// ROLES & PERMISSIONS (RBAC) SYSTEM
// ============================================================================

// Roles - system-defined roles for access control
export const roleNameEnum = ["technician", "lead_technician", "dispatcher", "manager", "admin"] as const;

export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // technician, lead_technician, dispatcher, manager, admin
  description: text("description"),
  isSystemRole: boolean("is_system_role").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

// Permissions - granular permission keys
export const permissionGroupEnum = ["schedule", "jobs", "clients", "pricing", "billing", "timesheets", "reports", "admin"] as const;

export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(), // e.g. "schedule.view_own", "jobs.create"
  group: text("group").notNull(), // schedule, jobs, clients, pricing, billing, timesheets, reports, admin
  label: text("label").notNull(), // Human-readable label
  description: text("description"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});

export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

// Role-Permission mapping (many-to-many)
export const rolePermissions = pgTable("role_permissions", {
  roleId: varchar("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions);

export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

// User Permission Overrides - per-user grants/revokes on top of role
export const overrideTypeEnum = ["grant", "revoke"] as const;

export const userPermissionOverrides = pgTable("user_permission_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: varchar("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  override: text("override").notNull(), // "grant" or "revoke"
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertUserPermissionOverrideSchema = createInsertSchema(userPermissionOverrides).omit({
  id: true,
  createdAt: true,
}).extend({
  override: z.enum(overrideTypeEnum),
});

export type InsertUserPermissionOverride = z.infer<typeof insertUserPermissionOverrideSchema>;
export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;

// Technician Profiles - cost and billing information for technicians
export const technicianProfiles = pgTable("technician_profiles", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  laborCostPerHour: numeric("labor_cost_per_hour", { precision: 8, scale: 2 }), // Cost per hour
  billableRatePerHour: numeric("billable_rate_per_hour", { precision: 8, scale: 2 }), // Billable rate per hour
  color: text("color"), // Calendar color for this technician
  phone: text("phone"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertTechnicianProfileSchema = createInsertSchema(technicianProfiles).omit({
  createdAt: true,
  updatedAt: true,
});

export const updateTechnicianProfileSchema = z.object({
  laborCostPerHour: z.string().nullable().optional(),
  billableRatePerHour: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export type InsertTechnicianProfile = z.infer<typeof insertTechnicianProfileSchema>;
export type UpdateTechnicianProfile = z.infer<typeof updateTechnicianProfileSchema>;
export type TechnicianProfile = typeof technicianProfiles.$inferSelect;

// Working Hours - weekly schedule for each user
export const workingHours = pgTable("working_hours", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: text("start_time"), // e.g. "08:00"
  endTime: text("end_time"), // e.g. "17:00"
  isWorking: boolean("is_working").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertWorkingHoursSchema = createInsertSchema(workingHours).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateWorkingHoursSchema = z.object({
  dayOfWeek: z.number().min(0).max(6).optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  isWorking: z.boolean().optional(),
});

export type InsertWorkingHours = z.infer<typeof insertWorkingHoursSchema>;
export type UpdateWorkingHours = z.infer<typeof updateWorkingHoursSchema>;
export type WorkingHours = typeof workingHours.$inferSelect;

// ============================================================================
// JOB TEMPLATES - Reusable templates for populating job line items
// ============================================================================
// Allows defining default line items for different job types (service call, PM, install, etc.)
// When a job template is applied, its line items are copied to JobParts.

export const jobTemplates = pgTable("job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  jobType: text("job_type"), // Optional: "service_call", "pm", "install", "repair", etc.
  description: text("description"),
  isDefaultForJobType: boolean("is_default_for_job_type").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertJobTemplateSchema = createInsertSchema(jobTemplates).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Name is required"),
});

export const updateJobTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  jobType: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isDefaultForJobType: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type InsertJobTemplate = z.infer<typeof insertJobTemplateSchema>;
export type UpdateJobTemplate = z.infer<typeof updateJobTemplateSchema>;
export type JobTemplate = typeof jobTemplates.$inferSelect;

// Job Template Line Items - individual line items within a template
export const jobTemplateLineItems = pgTable("job_template_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => jobTemplates.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  descriptionOverride: text("description_override"),
  quantity: text("quantity").notNull().default("1"), // Stored as text for decimal precision
  unitPriceOverride: numeric("unit_price_override", { precision: 12, scale: 2 }), // If null, use product.unitPrice
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertJobTemplateLineItemSchema = createInsertSchema(jobTemplateLineItems).omit({
  id: true,
  createdAt: true,
}).extend({
  quantity: z.union([z.string(), z.number()]).transform(val => String(val)),
  unitPriceOverride: z.union([z.string(), z.number(), z.null()]).optional().transform(val => 
    val === null || val === undefined ? null : String(val)
  ),
  sortOrder: z.union([z.string(), z.number()]).optional().transform(val => 
    val === undefined ? 0 : Number(val)
  ),
});

export const updateJobTemplateLineItemSchema = z.object({
  productId: z.string().optional(),
  descriptionOverride: z.string().nullable().optional(),
  quantity: z.union([z.string(), z.number()]).optional().transform(val => 
    val === undefined ? undefined : String(val)
  ),
  unitPriceOverride: z.union([z.string(), z.number(), z.null()]).optional().transform(val => 
    val === null ? null : val === undefined ? undefined : String(val)
  ),
  sortOrder: z.union([z.string(), z.number()]).optional().transform(val => 
    val === undefined ? undefined : Number(val)
  ),
});

export type InsertJobTemplateLineItem = z.infer<typeof insertJobTemplateLineItemSchema>;
export type UpdateJobTemplateLineItem = z.infer<typeof updateJobTemplateLineItemSchema>;
export type JobTemplateLineItem = typeof jobTemplateLineItems.$inferSelect;

// Schema for creating a template with its line items in one call
export const jobTemplateWithLinesSchema = insertJobTemplateSchema.extend({
  lines: z.array(z.object({
    productId: z.string(),
    descriptionOverride: z.string().nullable().optional(),
    quantity: z.union([z.string(), z.number()]).default("1"),
    unitPriceOverride: z.union([z.string(), z.number(), z.null()]).optional(),
    sortOrder: z.number().optional().default(0),
  })).min(1, "At least one line item is required"),
});

export type JobTemplateWithLines = z.infer<typeof jobTemplateWithLinesSchema>;

// Schema for applying a template to a job
export const applyJobTemplateSchema = z.object({
  templateId: z.string().min(1, "Template ID is required"),
});
// ============================================================================
// TASKS (General + Supplier Visit)
// - Status is only OPEN / CLOSED
// - Assignment is optional (unassigned tasks allowed)
// - Actual time tracking is checkIn/checkOut timestamps
// - Supplier visits can be created without selecting supplier, then reconciled later
// ============================================================================

export const taskTypeEnum = ["GENERAL", "SUPPLIER_VISIT"] as const;
export type TaskType = typeof taskTypeEnum[number];

export const taskStatusEnum = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = typeof taskStatusEnum[number];

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Optional assignment (can be unassigned until later)
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),

  type: text("type").notNull(), // GENERAL | SUPPLIER_VISIT
  title: text("title").notNull(),
  notes: text("notes"),

  status: text("status").notNull().default("pending"), // pending | in_progress | completed | cancelled

  // Close metadata
  closedAt: timestamp("closed_at"),
  closedByUserId: varchar("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),

  // Optional calendar planning (not coupled to calendar module yet)
  scheduledStartAt: timestamp("scheduled_start_at"),
  scheduledEndAt: timestamp("scheduled_end_at"),
  allDay: boolean("all_day").notNull().default(false),

  // Actual time tracking (source of truth)
  checkedInAt: timestamp("checked_in_at"),
  checkedOutAt: timestamp("checked_out_at"),

  // Duration tracking (in minutes)
  estimatedDurationMinutes: integer("estimated_duration_minutes"), // Estimated time to complete
  actualDurationMinutes: integer("actual_duration_minutes"), // Auto-calculated from checkedInAt to checkedOutAt

  // Optional attribution to a Job and Client/Location (does NOT create billing or calendar coupling)
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "set null" }),
  // Canonical reference to service location (optional for tasks)
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Indexes for common queries (non-unique, multiple tasks per company/status/etc)
  companyAssignedIdx: index("tasks_company_assigned_idx").on(table.companyId, table.assignedToUserId),
  companyStatusIdx: index("tasks_company_status_idx").on(table.companyId, table.status),
  companyJobIdx: index("tasks_company_job_idx").on(table.companyId, table.jobId),
  // DEPRECATED: companyClientIdx - use companyLocationIdx instead
  companyClientIdx: index("tasks_company_client_idx").on(table.companyId, table.clientId),
  // Canonical location index
  companyLocationIdx: index("tasks_company_location_idx").on(table.companyId, table.locationId),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  actualDurationMinutes: true, // Auto-calculated, not user input
  closedAt: true, // Auto-set
  closedByUserId: true, // Auto-set
}).extend({
  type: z.enum(taskTypeEnum),
  status: z.enum(taskStatusEnum).default("pending"),
  notes: z.string().max(2000).optional(), // Explicitly allow notes field
  estimatedDurationMinutes: z.number().int().positive().optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(taskStatusEnum).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  scheduledStartAt: z.string().datetime().nullable().optional(),
  scheduledEndAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  type: z.enum(taskTypeEnum).optional(),
}).strict();

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// ============================================================================
// SUPPLIERS (with QBO Vendor sync and multi-location support)
// ============================================================================

export const qboSyncStatusEnum = ["NOT_SYNCED", "SYNCED", "PENDING", "ERROR"] as const;
export type QboSyncStatus = typeof qboSyncStatusEnum[number];

export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Status
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  // QBO Vendor sync fields
  qboVendorId: text("qbo_vendor_id"),
  qboSyncToken: text("qbo_sync_token"),
  qboLastSyncedAt: timestamp("qbo_last_synced_at"),
  qboSyncStatus: text("qbo_sync_status").notNull().default("NOT_SYNCED"),
  qboSyncError: text("qbo_sync_error"),
  // Contact information
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Supplier name is required"),
  email: z.string().email().nullable().optional(),
  website: z.string().url().nullable().optional(),
  qboSyncStatus: z.enum(qboSyncStatusEnum).default("NOT_SYNCED"),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ============================================================================
// SUPPLIER LOCATIONS (multi-location support for suppliers)
// ============================================================================

export const supplierLocations = pgTable("supplier_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  supplierId: varchar("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  // Location details
  name: text("name").notNull(),
  address: text("address"),
  address2: text("address2"), // Address line 2 (suite, unit, floor, bay)
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  country: text("country"),
  // Geocoding — persisted from Google Places autocomplete
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  placeId: text("place_id"), // Google Places place_id
  // Contact information
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  // Notes (account numbers, branch-specific info, etc.)
  notes: text("notes"),
  // Status
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true), // Legacy (use deletedAt)
  // Soft delete (canonical)
  deletedAt: timestamp("deleted_at"), // NULL = active, NOT NULL = soft-deleted
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertSupplierLocationSchema = createInsertSchema(supplierLocations).omit({
  id: true,
  companyId: true,
  supplierId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Location name is required"),
  email: z.string().email().optional().or(z.literal('')),
});

export const updateSupplierLocationSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  postalCode: postalCodeSchema,
  country: z.string().nullable().optional(),
  lat: z.string().nullable().optional(), // numeric stored as string
  lng: z.string().nullable().optional(),
  placeId: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertSupplierLocation = z.infer<typeof insertSupplierLocationSchema>;
export type UpdateSupplierLocation = z.infer<typeof updateSupplierLocationSchema>;
export type SupplierLocation = typeof supplierLocations.$inferSelect;

// ============================================================================
// SUPPLIER VISIT DETAILS (1:1 extension of a Task where type=SUPPLIER_VISIT)
// - Supplier can be null initially; office can reconcile later
// ============================================================================

export const supplierVisitDetails = pgTable("supplier_visit_details", {
  // 1:1 with tasks; taskId is the PK
  taskId: varchar("task_id").primaryKey().references(() => tasks.id, { onDelete: "cascade" }),

  supplierId: varchar("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  supplierLocationId: varchar("supplier_location_id").references(() => supplierLocations.id, { onDelete: "set null" }),
  supplierNameOther: text("supplier_name_other"), // tech may type supplier name if not in system yet (legacy)
  poNumber: text("po_number"),

  reconciledAt: timestamp("reconciled_at"),
  reconciledByUserId: varchar("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertSupplierVisitDetailsSchema = createInsertSchema(supplierVisitDetails).omit({
  createdAt: true,
  updatedAt: true,
}).extend({
  // supplierId OR supplierNameOther can be present; validation can be enforced at route/service layer
  supplierId: z.string().nullable().optional(),
  supplierLocationId: z.string().nullable().optional(),
  supplierNameOther: z.string().nullable().optional(),
  poNumber: z.string().nullable().optional(),
});

export type InsertSupplierVisitDetails = z.infer<typeof insertSupplierVisitDetailsSchema>;
export type SupplierVisitDetails = typeof supplierVisitDetails.$inferSelect;

// ============================================================================
// QBO SYNC EVENTS (audit log for QuickBooks Online sync operations)
// ============================================================================

export const qboSyncEventTypeEnum = [
  // Outbound sync events
  "CUSTOMER_CREATE",
  "CUSTOMER_UPDATE",
  "INVOICE_CREATE",
  "INVOICE_UPDATE",
  // Item sync events
  "ITEM_READ",
  "ITEM_CREATE",
  "ITEM_LINK",
  // Inbound read events
  "INVOICE_READ",
  "PAYMENT_READ",
  // Reconciliation events
  "RECONCILE_DRY_RUN",
  "RECONCILE_APPLY",
  "PAYMENT_CREATED_FROM_QBO",
  // Import events (QBO → App)
  "CUSTOMER_IMPORT",
  "CATALOG_IMPORT",
  // Catalog sync events (App → QBO bulk)
  "CATALOG_SYNC",
  // Go-live and preflight events
  "QBO_ENABLED",
  "QBO_DISABLED",
  "INVOICE_DRY_RUN",
] as const;
export type QboSyncEventType = typeof qboSyncEventTypeEnum[number];

export const qboSyncResultEnum = ["SUCCESS", "FAILURE", "SKIPPED", "NO_CHANGES", "PARTIAL"] as const;
export type QboSyncResult = typeof qboSyncResultEnum[number];

export const qboSyncEvents = pgTable("qbo_sync_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Event type and result
  eventType: text("event_type").notNull(), // CUSTOMER_CREATE, CUSTOMER_UPDATE, INVOICE_CREATE, INVOICE_UPDATE
  result: text("result").notNull(), // SUCCESS, FAILURE, SKIPPED
  // Entity references (nullable - one will be set based on event type)
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  clientLocationId: varchar("client_location_id").references(() => clientLocations.id, { onDelete: "set null" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  itemId: varchar("item_id").references(() => items.id, { onDelete: "set null" }),
  // QBO references (captured at sync time)
  qboEntityId: text("qbo_entity_id"), // QBO Customer.Id or Invoice.Id
  qboSyncToken: text("qbo_sync_token"), // QBO SyncToken at time of operation
  // Request/response data for debugging
  requestPayload: text("request_payload"), // JSON string of request sent to QBO
  responsePayload: text("response_payload"), // JSON string of QBO response
  errorMessage: text("error_message"), // Error message if result is FAILURE
  errorCode: text("error_code"), // QBO error code if available
  // User who triggered the sync (nullable for system-triggered syncs)
  triggeredBy: varchar("triggered_by").references(() => users.id, { onDelete: "set null" }),
  // Run correlation
  syncRunId: varchar("sync_run_id"), // Groups events from a single admin-triggered run
  // Timing
  durationMs: integer("duration_ms"), // How long the sync operation took
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Index for run queries
  syncRunIdIdx: index("qbo_sync_events_sync_run_id_idx").on(table.syncRunId),
}));

export const insertQboSyncEventSchema = createInsertSchema(qboSyncEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertQboSyncEvent = z.infer<typeof insertQboSyncEventSchema>;
export type QboSyncEvent = typeof qboSyncEvents.$inferSelect;

// ============================================================================
// QBO SYNC QUEUE - Admin-triggered queue for sync operations with retry support
// ============================================================================

export const qboQueueStatusEnum = ["QUEUED", "RUNNING", "SUCCESS", "FAILED"] as const;
export type QboQueueStatus = typeof qboQueueStatusEnum[number];

export const qboQueueEntityTypeEnum = ["CUSTOMER_COMPANY", "CLIENT_LOCATION", "INVOICE", "ITEM"] as const;
export type QboQueueEntityType = typeof qboQueueEntityTypeEnum[number];

export const qboQueueActionEnum = [
  "SYNC",                  // Standard sync via orchestrator
  "SYNC_WITH_DEPS",        // Invoice sync with dependencies
  "RECONCILE",             // Reconcile dry run
  "RECONCILE_APPLY",       // Apply reconciliation
] as const;
export type QboQueueAction = typeof qboQueueActionEnum[number];

export const qboSyncQueue = pgTable("qbo_sync_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // What to sync
  entityType: text("entity_type").notNull(), // CUSTOMER_COMPANY, CLIENT_LOCATION, INVOICE
  entityId: varchar("entity_id").notNull(),
  action: text("action").notNull(), // SYNC, SYNC_WITH_DEPS, RECONCILE, RECONCILE_APPLY
  // Queue status
  status: text("status").notNull().default("QUEUED"), // QUEUED, RUNNING, SUCCESS, FAILED
  // Retry tracking
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextRunAt: timestamp("next_run_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // Error tracking
  lastError: text("last_error"),
  lastErrorCode: text("last_error_code"),
  // Result tracking
  qboEntityId: text("qbo_entity_id"), // QBO ID if sync succeeded
  // User who enqueued the job
  enqueuedBy: varchar("enqueued_by").references(() => users.id, { onDelete: "set null" }),
  // Run correlation
  syncRunId: varchar("sync_run_id"), // Groups jobs from a single admin-triggered run
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  // Index for idempotency check - prevents duplicate active jobs
  activeJobIdx: index("qbo_sync_queue_active_job_idx").on(
    table.companyId, table.entityType, table.entityId, table.action, table.status
  ),
  // Index for run queries
  syncRunIdIdx: index("qbo_sync_queue_sync_run_id_idx").on(table.syncRunId),
}));

export const insertQboSyncQueueSchema = createInsertSchema(qboSyncQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).extend({
  entityType: z.enum(qboQueueEntityTypeEnum),
  action: z.enum(qboQueueActionEnum),
  status: z.enum(qboQueueStatusEnum).default("QUEUED"),
});

export type InsertQboSyncQueue = z.infer<typeof insertQboSyncQueueSchema>;
export type QboSyncQueue = typeof qboSyncQueue.$inferSelect;

// ============================================================================
// QBO WEBHOOK EVENTS (inbound webhook deliveries from QuickBooks Online)
// ============================================================================

export const qboWebhookStatusEnum = ["RECEIVED", "VERIFIED", "REJECTED", "PROCESSED", "IGNORED"] as const;
export type QboWebhookStatus = typeof qboWebhookStatusEnum[number];

export const qboWebhookEntityTypeEnum = ["Invoice", "Payment", "Customer", "Estimate", "SalesReceipt", "CreditMemo", "Other"] as const;
export type QboWebhookEntityType = typeof qboWebhookEntityTypeEnum[number];

export const qboWebhookOperationEnum = ["Create", "Update", "Delete", "Merge", "Void"] as const;
export type QboWebhookOperation = typeof qboWebhookOperationEnum[number];

export const qboWebhookEvents = pgTable("qbo_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Webhook identification
  realmId: text("realm_id").notNull(), // QBO company ID from webhook
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "set null" }), // Resolved from realmId
  // Deduplication key - hash of (realmId, entityType, entityId, operation, lastUpdated)
  dedupeKey: text("dedupe_key"), // SHA-256 hash for idempotency
  // Event details from QBO
  qboEntityType: text("qbo_entity_type").notNull(), // Invoice, Payment, Customer, etc.
  qboEntityId: text("qbo_entity_id").notNull(), // QBO entity ID
  operation: text("operation").notNull(), // Create, Update, Delete, Merge, Void
  lastUpdated: timestamp("last_updated"), // Timestamp from QBO
  // Processing status
  status: text("status").notNull().default("RECEIVED"), // RECEIVED, VERIFIED, REJECTED, PROCESSED, IGNORED
  verificationError: text("verification_error"), // Error if signature verification failed
  processingError: text("processing_error"), // Error if processing failed
  // What was done with this event
  actionTaken: text("action_taken"), // e.g., "DRIFT_ALERT_CREATED", "RECONCILE_ENQUEUED"
  relatedInvoiceId: varchar("related_invoice_id"), // Local invoice ID if resolved
  queueJobId: varchar("queue_job_id"), // If a queue job was created
  // Run correlation
  processedRunId: varchar("processed_run_id"), // Links to the processing run that handled this event
  // Raw payload (redacted of sensitive info)
  eventPayload: jsonb("event_payload"), // Entire notification payload (redacted)
  // Timestamps
  receivedAt: timestamp("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: timestamp("processed_at"),
}, (table) => ({
  // Unique constraint on dedupeKey for idempotency - only one event per unique combination
  dedupeKeyIdx: uniqueIndex("qbo_webhook_events_dedupe_key_idx").on(table.dedupeKey),
}));

export type QboWebhookEvent = typeof qboWebhookEvents.$inferSelect;

// ============================================================================
// QUOTES
// ============================================================================

export const quoteStatusEnum = ["draft", "sent", "approved", "declined", "expired", "converted"] as const;
export type QuoteStatus = typeof quoteStatusEnum[number];

export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Location where work will be performed
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "restrict" }),
  // Parent company reference (for easier querying when billing parent)
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  // Quote details
  quoteNumber: text("quote_number"), // App-generated quote number
  title: text("title"), // Optional quote title/summary
  status: text("status").notNull().default("draft"),
  issueDate: date("issue_date").notNull(),
  expiryDate: date("expiry_date"),
  currency: text("currency").notNull().default("CAD"),
  // Totals
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Conversion tracking
  convertedToJobId: varchar("converted_to_job_id"), // Link to job if converted
  convertedAt: timestamp("converted_at"),
  // Tracking
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  approvedAt: timestamp("approved_at"),
  declinedAt: timestamp("declined_at"),
  // Notes
  notesInternal: text("notes_internal"),
  notesCustomer: text("notes_customer"),
  // Soft delete
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  // Optimistic locking
  version: integer("version").notNull().default(0),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Unique quote numbers per company when set
  quoteNumberPerCompany: uniqueIndex("quotes_company_quote_number_uq")
    .on(table.companyId, table.quoteNumber)
    .where(sql`quote_number is not null`),
}));

export const insertQuoteSchema = createInsertSchema(quotes).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(quoteStatusEnum).default("draft"),
  issueDate: z.string(),
});

export const updateQuoteSchema = z.object({
  locationId: z.string().optional(),
  customerCompanyId: z.string().nullable().optional(),
  quoteNumber: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  status: z.enum(quoteStatusEnum).optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().nullable().optional(),
  currency: z.string().optional(),
  subtotal: z.string().optional(),
  taxTotal: z.string().optional(),
  total: z.string().optional(),
  convertedToJobId: z.string().nullable().optional(),
  convertedAt: z.date().nullable().optional(),
  sentAt: z.date().nullable().optional(),
  viewedAt: z.date().nullable().optional(),
  approvedAt: z.date().nullable().optional(),
  declinedAt: z.date().nullable().optional(),
  notesInternal: z.string().nullable().optional(),
  notesCustomer: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type UpdateQuote = z.infer<typeof updateQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

// Quote line items table
export const quoteLines = pgTable("quote_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  lineItemType: text("line_item_type").notNull().default("service"),
  description: text("description").notNull(),
  quantity: text("quantity").notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0.0000"),
  lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Product reference
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertQuoteLineSchema = createInsertSchema(quoteLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  lineItemType: z.enum(lineItemTypeEnum).default("service"),
});

export const updateQuoteLineSchema = z.object({
  lineNumber: z.number().int().optional(),
  lineItemType: z.enum(lineItemTypeEnum).optional(),
  description: z.string().optional(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  taxRate: z.string().optional(),
  lineSubtotal: z.string().optional(),
  taxAmount: z.string().optional(),
  lineTotal: z.string().optional(),
  productId: z.string().nullable().optional(),
});

export type InsertQuoteLine = z.infer<typeof insertQuoteLineSchema>;
export type UpdateQuoteLine = z.infer<typeof updateQuoteLineSchema>;
export type QuoteLine = typeof quoteLines.$inferSelect;

// ============================================================================
// QUOTE TEMPLATES
// ============================================================================

export const quoteTemplates = pgTable("quote_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertQuoteTemplateSchema = createInsertSchema(quoteTemplates).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().min(1, "Name is required"),
});

export const updateQuoteTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type InsertQuoteTemplate = z.infer<typeof insertQuoteTemplateSchema>;
export type UpdateQuoteTemplate = z.infer<typeof updateQuoteTemplateSchema>;
export type QuoteTemplate = typeof quoteTemplates.$inferSelect;

// Quote Template Line Items
export const quoteTemplateLines = pgTable("quote_template_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => quoteTemplates.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: text("quantity").notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertQuoteTemplateLineSchema = createInsertSchema(quoteTemplateLines).omit({
  id: true,
  createdAt: true,
}).extend({
  description: z.string().min(1, "Description is required"),
});

export const updateQuoteTemplateLineSchema = z.object({
  productId: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export type InsertQuoteTemplateLine = z.infer<typeof insertQuoteTemplateLineSchema>;
export type UpdateQuoteTemplateLine = z.infer<typeof updateQuoteTemplateLineSchema>;
export type QuoteTemplateLine = typeof quoteTemplateLines.$inferSelect;

// ============================================================================
// SESSION TABLE (used by express-session / passport store)
// Keep this defined so Drizzle does NOT try to drop the existing DB table.
// ============================================================================
export const session = pgTable("session", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

// ============================================================================
// TENANT FEATURE FLAGS
// Feature gates for tenant-level functionality enablement
// ============================================================================
export const tenantFeatures = pgTable("tenant_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }).unique(),
  // Core feature flags
  quotesEnabled: boolean("quotes_enabled").notNull().default(true),
  invoicesEnabled: boolean("invoices_enabled").notNull().default(true),
  calendarEnabled: boolean("calendar_enabled").notNull().default(true),
  qboEnabled: boolean("qbo_enabled").notNull().default(true),
  // Future feature flags (placeholders)
  routeOptimizationEnabled: boolean("route_optimization_enabled").notNull().default(true),
  multiTechEnabled: boolean("multi_tech_enabled").notNull().default(true),
  // Live Map feature flag — gated separately due to map tile / real-time infrastructure costs
  liveMapEnabled: boolean("live_map_enabled").notNull().default(true),
  // Customer portal feature flags
  customerPortalEnabled: boolean("customer_portal_enabled").notNull().default(false),
  customerPortalPaymentsEnabled: boolean("customer_portal_payments_enabled").notNull().default(false),
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertTenantFeaturesSchema = createInsertSchema(tenantFeatures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateTenantFeaturesSchema = z.object({
  quotesEnabled: z.boolean().optional(),
  invoicesEnabled: z.boolean().optional(),
  calendarEnabled: z.boolean().optional(),
  qboEnabled: z.boolean().optional(),
  routeOptimizationEnabled: z.boolean().optional(),
  multiTechEnabled: z.boolean().optional(),
  liveMapEnabled: z.boolean().optional(),
  customerPortalEnabled: z.boolean().optional(),
  customerPortalPaymentsEnabled: z.boolean().optional(),
});

export type InsertTenantFeatures = z.infer<typeof insertTenantFeaturesSchema>;
export type UpdateTenantFeatures = z.infer<typeof updateTenantFeaturesSchema>;
export type TenantFeatures = typeof tenantFeatures.$inferSelect;

// Feature key type for type-safe feature checks
export const featureKeys = [
  "quotesEnabled",
  "invoicesEnabled",
  "calendarEnabled",
  "qboEnabled",
  "routeOptimizationEnabled",
  "multiTechEnabled",
  "liveMapEnabled",
  "customerPortalEnabled",
  "customerPortalPaymentsEnabled",
] as const;
export type FeatureKey = typeof featureKeys[number];

// ============================================================================
// NOTIFICATIONS
// In-app notification system for event-driven alerts
// ============================================================================

export const notificationTypeEnum = [
  "quote_approved",
  "quote_declined",
  "job_scheduled",
  "job_rescheduled",
  "sla_breach",
  "qbo_failure",
  "system",
  "subscription_renewal_30",
  "subscription_renewal_7",
  "subscription_renewed",
  "subscription_reverted",
  "subscription_cancelled",
  // Time tracking alerts (Phase 6)
  "unassigned_time",
  "untracked_time",
  "long_running_entry",
  "missing_clock_out",
  // Time tracking digest (Phase 7)
  "weekly_time_digest",
] as const;
export type NotificationType = typeof notificationTypeEnum[number];

export const notificationStatusEnum = ["unread", "read"] as const;
export type NotificationStatus = typeof notificationStatusEnum[number];

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // NotificationType
  title: text("title").notNull(),
  body: text("body"),
  linkUrl: text("link_url"),
  status: text("status").notNull().default("unread"), // NotificationStatus
  // Dedupe key to prevent duplicate notifications for the same event
  dedupeKey: text("dedupe_key"),
  // Related entity references for context
  relatedEntityType: text("related_entity_type"), // "quote", "job", "invoice", etc.
  relatedEntityId: varchar("related_entity_id"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  readAt: timestamp("read_at"),
}, (table) => ({
  // Unique constraint on dedupe key per user to prevent duplicates
  dedupeIdx: uniqueIndex("notifications_dedupe_idx").on(table.userId, table.dedupeKey),
  // Index for efficient user notification queries
  userStatusIdx: index("notifications_user_status_idx").on(table.userId, table.status),
  companyIdx: index("notifications_company_idx").on(table.companyId),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  readAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ============================================================================
// TENANT SUBSCRIPTIONS - Billing cycle management (Monthly/Annual)
// ============================================================================

export const billingCycleEnum = ["monthly", "annual"] as const;
export type BillingCycle = typeof billingCycleEnum[number];

export const subscriptionStatusEnum = ["active", "pending_renewal", "cancelled"] as const;
export type SubscriptionStatus = typeof subscriptionStatusEnum[number];

export const tenantSubscriptions = pgTable("tenant_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => subscriptionPlans.id, { onDelete: "set null" }),
  // Billing cycle configuration
  billingCycle: text("billing_cycle").notNull().default("monthly"), // "monthly" | "annual"
  status: text("status").notNull().default("active"), // "active" | "pending_renewal" | "cancelled"
  autoRenewAnnual: boolean("auto_renew_annual").notNull().default(true), // Only meaningful for annual
  // Date tracking
  startDate: timestamp("start_date").notNull().default(sql`CURRENT_TIMESTAMP`),
  endDate: timestamp("end_date"), // Required for annual, null for monthly
  cancelledAt: timestamp("cancelled_at"), // When the user cancelled
  // Audit/pricing guard
  revertedFromAnnual: boolean("reverted_from_annual").notNull().default(false), // True if was annual and auto-reverted to monthly
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdx: index("tenant_subscriptions_company_idx").on(table.companyId),
  statusIdx: index("tenant_subscriptions_status_idx").on(table.status),
  endDateIdx: index("tenant_subscriptions_end_date_idx").on(table.endDate),
}));

export const insertTenantSubscriptionSchema = createInsertSchema(tenantSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  billingCycle: z.enum(billingCycleEnum).default("monthly"),
  status: z.enum(subscriptionStatusEnum).default("active"),
});

export const updateTenantSubscriptionSchema = z.object({
  planId: z.string().nullable().optional(),
  billingCycle: z.enum(billingCycleEnum).optional(),
  status: z.enum(subscriptionStatusEnum).optional(),
  autoRenewAnnual: z.boolean().optional(),
  startDate: z.date().optional(),
  endDate: z.date().nullable().optional(),
  cancelledAt: z.date().nullable().optional(),
  revertedFromAnnual: z.boolean().optional(),
});

export type InsertTenantSubscription = z.infer<typeof insertTenantSubscriptionSchema>;
export type UpdateTenantSubscription = z.infer<typeof updateTenantSubscriptionSchema>;
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;

// ============================================================================
// SUBSCRIPTION EVENTS - Idempotency + Audit Trail
// ============================================================================

export const subscriptionEventTypeEnum = [
  "renewal_notice_30",
  "renewal_notice_7",
  "annual_renewed",
  "reverted_to_monthly",
  "cancelled",
  "signup",
  "manual_renewal",
] as const;
export type SubscriptionEventType = typeof subscriptionEventTypeEnum[number];

export const subscriptionEvents = pgTable("subscription_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => tenantSubscriptions.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant queries
  type: text("type").notNull(), // SubscriptionEventType
  // Term end date that this event applies to (for idempotency)
  termEndDate: timestamp("term_end_date"), // Should be set for annual-related events
  // Additional context
  metadata: jsonb("metadata"), // JSON for additional context (e.g., old endDate, new endDate, reason)
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // UNIQUE constraint for idempotency: prevent duplicate events for the same term
  idempotencyIdx: uniqueIndex("subscription_events_idempotency_idx")
    .on(table.subscriptionId, table.type, table.termEndDate),
  subscriptionIdx: index("subscription_events_subscription_idx").on(table.subscriptionId),
  companyIdx: index("subscription_events_company_idx").on(table.companyId),
  typeIdx: index("subscription_events_type_idx").on(table.type),
}));

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEvents).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(subscriptionEventTypeEnum),
});

export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;

// ============================================================================
// TIME TRACKING V1 - Work Sessions, Time Entries, Technician Job Status Events
// ============================================================================

// Time entry type enum - categorizes different types of time entries
export const timeEntryTypeEnum = [
  "travel_to_job",
  "on_site",
  "travel_to_supplier",
  "supplier_run",
  "travel_between_jobs",
  "admin",
  "break",
  "other"
] as const;
export type TimeEntryType = typeof timeEntryTypeEnum[number];

// Work session source - how the session was created
export const workSessionSourceEnum = ["mobile", "web", "import"] as const;
export type WorkSessionSource = typeof workSessionSourceEnum[number];

// Technician job status - for mobile status updates that drive time tracking
export const technicianJobStatusEnum = ["dispatched", "en_route", "arrived", "paused", "completed"] as const;
export type TechnicianJobStatus = typeof technicianJobStatusEnum[number];

// ============================================================================
// WORK SESSIONS - Daily clock in/out for payroll
// ============================================================================
export const workSessions = pgTable("work_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Work date (YYYY-MM-DD format stored as text for consistency with codebase patterns)
  workDate: text("work_date").notNull(),
  // Time tracking
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  breakMinutes: integer("break_minutes"),
  // Metadata
  notes: text("notes"),
  source: text("source").notNull().default("web"), // mobile | web | import
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Index for finding sessions by technician and date
  techDateIdx: index("work_sessions_tech_date_idx").on(table.companyId, table.technicianId, table.workDate),
  // Index for finding open sessions (clock_out_at IS NULL)
  openSessionIdx: index("work_sessions_open_idx").on(table.companyId, table.technicianId),
}));

export const insertWorkSessionSchema = createInsertSchema(workSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  source: z.enum(workSessionSourceEnum).default("web"),
  clockInAt: z.string().datetime().optional(), // Accept ISO string, defaults to now
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Work date must be in YYYY-MM-DD format"),
});

export const updateWorkSessionSchema = z.object({
  clockOutAt: z.string().datetime().nullable().optional(),
  breakMinutes: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type InsertWorkSession = z.infer<typeof insertWorkSessionSchema>;
export type UpdateWorkSession = z.infer<typeof updateWorkSessionSchema>;
export type WorkSession = typeof workSessions.$inferSelect;

// ============================================================================
// TIME ENTRIES - Granular time tracking for billing and operations
// ============================================================================
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Optional links
  workSessionId: varchar("work_session_id").references(() => workSessions.id, { onDelete: "set null" }),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  visitId: varchar("visit_id").references(() => jobVisits.id, { onDelete: "set null" }), // Phase: labor unification — nullable FK for visit attribution
  // Entry type
  type: text("type").notNull(), // TimeEntryType
  // Time tracking
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at"), // NULL = currently running
  durationMinutes: integer("duration_minutes"), // Computed on stop
  // Billing
  billable: boolean("billable").notNull().default(true),
  billableRateSnapshot: text("billable_rate_snapshot"), // Snapshot of hourly rate at entry start (stored as string decimal)
  costRateSnapshot: text("cost_rate_snapshot"), // Optional: cost rate snapshot
  // Notes
  notes: text("notes"),
  // Invoice linkage (prevents double-invoicing)
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  invoiceLineId: varchar("invoice_line_id"), // Reference to specific line item
  invoicedAt: timestamp("invoiced_at"), // When this entry was invoiced
  // Billing rule snapshots (captured at invoice time for audit trail)
  billedMinutesSnapshot: integer("billed_minutes_snapshot"), // Final minutes after rules applied
  billedRateSnapshot: text("billed_rate_snapshot"), // Final hourly rate after multipliers
  billingRulesHash: text("billing_rules_hash"), // Hash of rules used for audit/debugging
  // Locking (Phase 9: prevents edits once invoiced)
  lockedAt: timestamp("locked_at"), // When the entry was locked
  lockedByInvoiceId: varchar("locked_by_invoice_id"), // Which invoice locked it (app-managed, no FK for safety)
  lockReason: text("lock_reason"), // e.g., "INVOICED"
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Index for finding entries by technician and time
  techStartIdx: index("time_entries_tech_start_idx").on(table.companyId, table.technicianId, table.startAt),
  // Index for finding entries by job
  jobIdx: index("time_entries_job_idx").on(table.companyId, table.jobId),
  // Index for finding entries by visit (labor unification)
  visitIdx: index("time_entries_visit_idx").on(table.companyId, table.visitId),
  // Index for finding uninvoiced entries
  invoiceIdx: index("time_entries_invoice_idx").on(table.companyId, table.invoiceId),
  // Partial index for finding running entries (endAt IS NULL) - enforced in code
  runningIdx: index("time_entries_running_idx").on(table.companyId, table.technicianId),
  // Index for finding locked entries by invoice
  lockedByInvoiceIdx: index("time_entries_locked_by_invoice_idx").on(table.lockedByInvoiceId),
}));

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  durationMinutes: true, // Computed on stop
  invoiceId: true,
  invoiceLineId: true,
  invoicedAt: true,
  // Lock fields are server-managed only
  lockedAt: true,
  lockedByInvoiceId: true,
  lockReason: true,
}).extend({
  type: z.enum(timeEntryTypeEnum),
  startAt: z.string().datetime().optional(), // Accept ISO string, defaults to now
  endAt: z.string().datetime().nullable().optional(),
  billable: z.boolean().default(true),
});

export const updateTimeEntrySchema = z.object({
  jobId: z.string().nullable().optional(),
  type: z.enum(timeEntryTypeEnum).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
  billable: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type UpdateTimeEntry = z.infer<typeof updateTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

// ============================================================================
// TIME ENTRY LOCK OVERRIDES - Audit trail for manager lock overrides
// Phase 9: Tracks when managers override invoice locks on time entries
// ============================================================================

export const timeEntryLockOverrides = pgTable("time_entry_lock_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  timeEntryId: varchar("time_entry_id").notNull().references(() => timeEntries.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id"), // The invoice that had locked the entry (if applicable)
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // Manager who performed override
  reason: text("reason").notNull(), // Required reason for override
  beforeJson: text("before_json"), // Snapshot of entry before change (minimal fields)
  afterJson: text("after_json"), // Snapshot of entry after change (minimal fields)
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  companyIdx: index("time_entry_lock_overrides_company_idx").on(table.companyId),
  timeEntryIdx: index("time_entry_lock_overrides_entry_idx").on(table.timeEntryId),
  createdAtIdx: index("time_entry_lock_overrides_created_idx").on(table.createdAt),
}));

export type TimeEntryLockOverride = typeof timeEntryLockOverrides.$inferSelect;

// ============================================================================
// TECHNICIAN JOB STATUS EVENTS - Mobile status updates that drive time entries
// Note: This is SEPARATE from jobStatusEvents which tracks status CHANGE audit trail
// This table records technician-initiated status updates (en_route, arrived, etc.)
// that trigger automatic time entry creation/stopping
// ============================================================================
export const technicianJobStatusEvents = pgTable("technician_job_status_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Status reported by technician
  status: text("status").notNull(), // TechnicianJobStatus: dispatched, en_route, arrived, paused, completed
  // When the status was reported (may differ from createdAt if backfilled)
  at: timestamp("at").notNull(),
  // Source and notes
  source: text("source").notNull().default("mobile"), // mobile | web
  notes: text("notes"),
  // Link to time entry created/stopped by this event
  timeEntryId: varchar("time_entry_id").references(() => timeEntries.id, { onDelete: "set null" }),
  // Timestamp
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Index for finding events by job
  jobAtIdx: index("technician_job_status_events_job_at_idx").on(table.companyId, table.jobId, table.at),
  // Index for finding events by technician
  techAtIdx: index("technician_job_status_events_tech_at_idx").on(table.companyId, table.technicianId, table.at),
}));

export const insertTechnicianJobStatusEventSchema = createInsertSchema(technicianJobStatusEvents).omit({
  id: true,
  createdAt: true,
}).extend({
  status: z.enum(technicianJobStatusEnum),
  at: z.string().datetime().optional(), // Accept ISO string, defaults to now
  source: z.enum(["mobile", "web"]).default("mobile"),
});

export type InsertTechnicianJobStatusEvent = z.infer<typeof insertTechnicianJobStatusEventSchema>;
export type TechnicianJobStatusEvent = typeof technicianJobStatusEvents.$inferSelect;

// ============================================================================
// TIME TRACKING SCHEMAS FOR API VALIDATION
// ============================================================================

// Clock in request
export const clockInRequestSchema = z.object({
  at: z.string().datetime().optional(), // Defaults to now
  source: z.enum(workSessionSourceEnum).default("web"),
  notes: z.string().nullable().optional(),
});
export type ClockInRequest = z.infer<typeof clockInRequestSchema>;

// Clock out request
export const clockOutRequestSchema = z.object({
  at: z.string().datetime().optional(), // Defaults to now
  breakMinutes: z.number().int().min(0).optional(),
  notes: z.string().nullable().optional(),
});
export type ClockOutRequest = z.infer<typeof clockOutRequestSchema>;

// Start time entry request
export const startTimeEntryRequestSchema = z.object({
  type: z.enum(timeEntryTypeEnum),
  jobId: z.string().nullable().optional(),
  at: z.string().datetime().optional(), // Defaults to now
  notes: z.string().nullable().optional(),
  billable: z.boolean().default(true),
});
export type StartTimeEntryRequest = z.infer<typeof startTimeEntryRequestSchema>;

// Stop time entry request
export const stopTimeEntryRequestSchema = z.object({
  timeEntryId: z.string().optional(), // If not provided, stops current running entry
  at: z.string().datetime().optional(), // Defaults to now
  notes: z.string().nullable().optional(),
});
export type StopTimeEntryRequest = z.infer<typeof stopTimeEntryRequestSchema>;

// Create finished time entry request (for manual entry)
export const createFinishedTimeEntryRequestSchema = z.object({
  type: z.enum(timeEntryTypeEnum),
  jobId: z.string().nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().nullable().optional(),
  billable: z.boolean().default(true),
});
export type CreateFinishedTimeEntryRequest = z.infer<typeof createFinishedTimeEntryRequestSchema>;

// Job status update request (mobile flow)
export const jobStatusUpdateRequestSchema = z.object({
  status: z.enum(technicianJobStatusEnum),
  at: z.string().datetime().optional(), // Defaults to now
  notes: z.string().nullable().optional(),
  source: z.enum(["mobile", "web"]).default("mobile"),
});
export type JobStatusUpdateRequest = z.infer<typeof jobStatusUpdateRequestSchema>;

// ============================================================================
// PHASE 3: MANAGER UPDATE SCHEMAS
// ============================================================================

// Manager update for time entries (with invoice override support)
export const managerUpdateTimeEntrySchema = z.object({
  billable: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  type: z.enum(timeEntryTypeEnum).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().nullable().optional(),
  jobId: z.string().nullable().optional(), // Reassign time entry to a different job
  overrideInvoiceLock: z.boolean().optional(),
  overrideReason: z.string().optional(), // Required if overrideInvoiceLock is true for invoiced entries
});
export type ManagerUpdateTimeEntry = z.infer<typeof managerUpdateTimeEntrySchema>;

// Unassigned time entry response type
export interface UnassignedTimeEntry {
  id: string;
  technicianId: string;
  technicianName: string | null;
  type: TimeEntryType;
  startAt: Date;
  endAt: Date | null;
  durationMinutes: number | null;
  billable: boolean;
  billableRateSnapshot: string | null;
  notes: string | null;
  invoiced: boolean;
  // Phase 9: Lock fields
  lockedAt: Date | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  createdAt: Date;
}

// Job time summary response type
export interface JobTimeSummary {
  jobId: string;
  travelMinutes: number;
  onSiteMinutes: number;
  otherMinutes: number;
  billableMinutes: number;
  totalMinutes: number;
  isRunning: boolean;
  runningType: TimeEntryType | null;
  technicianBreakdown: Array<{
    technicianId: string;
    technicianName: string | null;
    travelMinutes: number;
    onSiteMinutes: number;
    otherMinutes: number;
    billableMinutes: number;
    isRunning: boolean;
  }>;
  entries: Array<{
    id: string;
    technicianId: string;
    type: TimeEntryType;
    startAt: Date;
    endAt: Date | null;
    durationMinutes: number | null;
    billable: boolean;
    invoiced: boolean;
  }>;
}

// ============================================================================
// PHASE 4: TIME APPROVALS (Payroll Approval)
// ============================================================================

export const timeApprovals = pgTable("time_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Week boundaries (Monday to Sunday in company timezone)
  weekStart: text("week_start").notNull(), // YYYY-MM-DD (Monday)
  weekEnd: text("week_end").notNull(), // YYYY-MM-DD (Sunday)
  // Approval info
  approvedByUserId: varchar("approved_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  approvedAt: timestamp("approved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Unique constraint: one approval per technician per week
  uniqueTechWeek: sql`UNIQUE(${table.companyId}, ${table.technicianId}, ${table.weekStart})`,
  // Index for fetching approvals by week
  weekIdx: index("time_approvals_week_idx").on(table.companyId, table.weekStart),
  // Index for fetching approvals by technician
  techWeekIdx: index("time_approvals_tech_week_idx").on(table.companyId, table.technicianId, table.weekStart),
}));

export const insertTimeApprovalSchema = createInsertSchema(timeApprovals).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export type InsertTimeApproval = z.infer<typeof insertTimeApprovalSchema>;
export type TimeApproval = typeof timeApprovals.$inferSelect;

// ============================================================================
// PHASE 4: PAYROLL SCHEMAS FOR API VALIDATION
// ============================================================================

// Approve week request
export const approveWeekRequestSchema = z.object({
  technicianId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  notes: z.string().nullable().optional(),
});
export type ApproveWeekRequest = z.infer<typeof approveWeekRequestSchema>;

// Daily payroll breakdown
export interface DailyPayrollBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // Mon, Tue, etc.
  workedMinutes: number;
  trackedMinutes: number;
  billableMinutes: number;
}

// Technician weekly payroll summary
export interface TechnicianWeeklySummary {
  technicianId: string;
  technicianName: string | null;
  weekStart: string;
  weekEnd: string;
  totals: {
    workedMinutes: number;
    trackedMinutes: number;
    billableMinutes: number;
    untrackedMinutesRaw: number; // Can be negative
  };
  daily: DailyPayrollBreakdown[];
  approved: boolean;
  approvedAt: Date | null;
  approvedByName: string | null;
}

// Weekly payroll summary response
export interface WeeklyPayrollSummary {
  weekStart: string;
  weekEnd: string;
  summaries: TechnicianWeeklySummary[];
}

// ============================================================================
// TIME ANALYTICS (Phase 5)
// ============================================================================

// Time breakdown by type
export interface TimeByTypeBreakdown {
  travel_to_job: number;
  on_site: number;
  travel_to_supplier: number;
  supplier_run: number;
  travel_between_jobs: number;
  admin: number;
  break: number;
  other: number;
}

// Weekly analytics data point
export interface WeeklyAnalyticsData {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;   // YYYY-MM-DD (Sunday)
  workedMinutes: number;      // From work_sessions
  trackedMinutes: number;     // From time_entries (endAt not null)
  billableMinutes: number;    // From time_entries where billable = true
  untrackedMinutesRaw: number; // worked - tracked (can be negative)
  unassignedMinutes: number;  // time_entries where jobId IS NULL
  byTypeMinutes: TimeByTypeBreakdown;
  // Derived convenience fields
  travelMinutes: number;      // travel_to_job + travel_to_supplier + travel_between_jobs
  onSiteMinutes: number;
  supplierMinutes: number;    // travel_to_supplier + supplier_run
  adminMinutes: number;
  breakMinutes: number;
  otherMinutes: number;
}

// Weekly analytics response
export interface WeeklyAnalyticsResponse {
  weeks: WeeklyAnalyticsData[];
  // Summary totals across all weeks
  totals: {
    workedMinutes: number;
    trackedMinutes: number;
    billableMinutes: number;
    untrackedMinutesRaw: number;
    unassignedMinutes: number;
  };
}

// Technician analytics for a single week
export interface TechnicianAnalytics {
  technicianId: string;
  technicianName: string | null;
  workedMinutes: number;
  trackedMinutes: number;
  billableMinutes: number;
  untrackedMinutesRaw: number;
  unassignedMinutes: number;
  billablePct: number; // billable / tracked (0 if tracked is 0)
  // Simplified type breakdown
  travelMinutes: number;
  onSiteMinutes: number;
  supplierMinutes: number;
  adminMinutes: number;
  breakMinutes: number;
  otherMinutes: number;
}

// Technician analytics response
export interface TechnicianAnalyticsResponse {
  weekStart: string;
  weekEnd: string;
  technicians: TechnicianAnalytics[];
}

// ============================================================================
// PHASE 7: TIME ALERT SETTINGS (Configurable Thresholds)
// ============================================================================

export const timeAlertSettings = pgTable("time_alert_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  // Threshold settings (in minutes)
  unassignedThresholdMinutes: integer("unassigned_threshold_minutes").notNull().default(30),
  untrackedThresholdMinutes: integer("untracked_threshold_minutes").notNull().default(60),
  longRunningThresholdMinutes: integer("long_running_threshold_minutes").notNull().default(360), // 6 hours
  missingClockOutThresholdMinutes: integer("missing_clock_out_threshold_minutes").notNull().default(720), // 12 hours
  // Escalation settings
  repeatDaysToEscalate: integer("repeat_days_to_escalate").notNull().default(3),
  // Digest settings
  digestDayOfWeek: integer("digest_day_of_week").notNull().default(1), // 1=Monday, 7=Sunday
  digestEnabled: boolean("digest_enabled").notNull().default(true),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertTimeAlertSettingsSchema = createInsertSchema(timeAlertSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateTimeAlertSettingsSchema = insertTimeAlertSettingsSchema.partial().omit({
  companyId: true,
});

export type InsertTimeAlertSettings = z.infer<typeof insertTimeAlertSettingsSchema>;
export type UpdateTimeAlertSettings = z.infer<typeof updateTimeAlertSettingsSchema>;
export type TimeAlertSettings = typeof timeAlertSettings.$inferSelect;

// Default settings values
export const DEFAULT_TIME_ALERT_SETTINGS = {
  unassignedThresholdMinutes: 30,
  untrackedThresholdMinutes: 60,
  longRunningThresholdMinutes: 360, // 6 hours
  missingClockOutThresholdMinutes: 720, // 12 hours
  repeatDaysToEscalate: 3,
  digestDayOfWeek: 1, // Monday
  digestEnabled: true,
} as const;

// ============================================================================
// PHASE 7: NOTIFICATION SNOOZES
// ============================================================================

export const notificationSnoozes = pgTable("notification_snoozes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // NotificationType being snoozed
  snoozeUntil: timestamp("snooze_until").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // Unique constraint: one snooze per user per type
  uniqueUserType: uniqueIndex("notification_snoozes_user_type_idx").on(table.companyId, table.userId, table.type),
}));

export const insertNotificationSnoozeSchema = createInsertSchema(notificationSnoozes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNotificationSnooze = z.infer<typeof insertNotificationSnoozeSchema>;
export type NotificationSnooze = typeof notificationSnoozes.$inferSelect;

// Snooze request schema for API
export const snoozeRequestSchema = z.object({
  type: z.enum(notificationTypeEnum),
  snoozeUntil: z.string().datetime().or(z.date()),
});
export type SnoozeRequest = z.infer<typeof snoozeRequestSchema>;

// Clear snooze request schema
export const clearSnoozeRequestSchema = z.object({
  type: z.enum(notificationTypeEnum),
});
export type ClearSnoozeRequest = z.infer<typeof clearSnoozeRequestSchema>;

// ============================================================================
// TIME BILLING RULES - Company-configurable rules for time-to-invoice conversion
// ============================================================================

export const roundingModeEnum = ["up", "nearest", "down"] as const;
export type RoundingMode = (typeof roundingModeEnum)[number];

export const timeBillingRules = pgTable("time_billing_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  // Rounding settings
  roundingIncrementMinutes: integer("rounding_increment_minutes").notNull().default(15), // 1, 5, or 15
  roundingMode: text("rounding_mode").notNull().default("up"), // up | nearest | down
  minimumBillableMinutes: integer("minimum_billable_minutes").notNull().default(15),
  // Type-specific billing toggles
  billTravel: boolean("bill_travel").notNull().default(true),
  billSupplierRun: boolean("bill_supplier_run").notNull().default(true),
  billAdmin: boolean("bill_admin").notNull().default(false),
  // Rate multipliers (stored as decimal strings for precision)
  travelRateMultiplier: text("travel_rate_multiplier").notNull().default("1.0"),
  onSiteRateMultiplier: text("on_site_rate_multiplier").notNull().default("1.0"),
  // Optional caps
  maxTravelMinutesPerJobPerDay: integer("max_travel_minutes_per_job_per_day"), // NULL = no cap
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

// Default billing rules values for companies without explicit settings
export const DEFAULT_TIME_BILLING_RULES = {
  roundingIncrementMinutes: 15,
  roundingMode: "up" as RoundingMode,
  minimumBillableMinutes: 15,
  billTravel: true,
  billSupplierRun: true,
  billAdmin: false,
  travelRateMultiplier: "1.0",
  onSiteRateMultiplier: "1.0",
  maxTravelMinutesPerJobPerDay: null as number | null,
};

export const insertTimeBillingRulesSchema = createInsertSchema(timeBillingRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateTimeBillingRulesSchema = z.object({
  roundingIncrementMinutes: z.number().int().min(1).max(60).optional(),
  roundingMode: z.enum(roundingModeEnum).optional(),
  minimumBillableMinutes: z.number().int().min(0).max(120).optional(),
  billTravel: z.boolean().optional(),
  billSupplierRun: z.boolean().optional(),
  billAdmin: z.boolean().optional(),
  travelRateMultiplier: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  onSiteRateMultiplier: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxTravelMinutesPerJobPerDay: z.number().int().min(0).nullable().optional(),
});

export type InsertTimeBillingRules = z.infer<typeof insertTimeBillingRulesSchema>;
export type UpdateTimeBillingRules = z.infer<typeof updateTimeBillingRulesSchema>;
export type TimeBillingRules = typeof timeBillingRules.$inferSelect;

// ============================================================================
// RECURRING JOB TEMPLATES - Define recurring job patterns
// ============================================================================

export const recurrenceKindEnum = ["weekly", "monthly"] as const;
export type RecurrenceKind = typeof recurrenceKindEnum[number];

// PM generation mode: 'phase' preserves existing behavior; 'period_start' and 'day_of_month' for PM scheduling
export const generationModeEnum = ["phase", "period_start", "day_of_month"] as const;
export type GenerationMode = typeof generationModeEnum[number];

// Phase 2 Step 6: All generated jobs start as status='open'.
// Template only controls the openSubStatus default (null for normal backlog, "on_hold" for held jobs).
// templateStatusDefaultEnum removed - use openSubStatusEnum for openSubStatusDefault.

// ============================================================================
// PM TEMPLATES — Reusable job content templates for maintenance plans
// ============================================================================

export const pmBillingModeEnum = ["per_visit", "monthly", "annually", "none"] as const;
export type PmBillingMode = typeof pmBillingModeEnum[number];

// PM Billing Disposition: Contract-level billing models for PM contracts
export const pmBillingModelEnum = ["per_visit", "monthly_fixed", "annual_prepaid", "do_not_bill"] as const;
export type PmBillingModel = typeof pmBillingModelEnum[number];

// PM Billing Disposition: Job-level billing dispositions derived from contract
export const pmBillingDispositionEnum = ["invoice_on_completion", "covered_by_contract", "archive_no_invoice"] as const;
export type PmBillingDisposition = typeof pmBillingDispositionEnum[number];

// PM Billing Status: Tracks billing lifecycle on PM jobs
export const pmBillingStatusEnum = ["pending_invoice", "invoiced", "no_invoice_expected", "billing_exception"] as const;
export type PmBillingStatus = typeof pmBillingStatusEnum[number];

export const pmTemplates = pgTable("pm_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),

  // --- Template identity ---
  name: text("name").notNull(), // Internal blueprint name (e.g. "RTU Cooling PM")

  // --- Default PM content ---
  summary: text("summary"), // Default PM summary/title applied to maintenance plan/job
  description: text("description"), // Default job description body

  // --- Optional scheduling defaults ---
  defaultMonthsOfYear: integer("default_months_of_year").array(), // [1..12]
  defaultGenerationMode: text("default_generation_mode"), // "period_start" | "day_of_month"
  defaultGenerationDayOfMonth: integer("default_generation_day_of_month"), // 1..31
  defaultServiceWindowDaysBefore: integer("default_service_window_days_before"),
  defaultServiceWindowDaysAfter: integer("default_service_window_days_after"),
  defaultIncludeLocationPmParts: boolean("default_include_location_pm_parts"),

  // --- Optional billing defaults ---
  billingMode: text("billing_mode"), // per_visit | monthly | annually | none
  billingLabel: text("billing_label"), // e.g. "Preventive Maintenance"
  defaultPrice: numeric("default_price"), // e.g. "249.00"

  // --- Optional line items ---
  defaultLineItemsJson: jsonb("default_line_items_json"), // Prefill line items

  // --- Timestamps ---
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdx: index("pm_templates_company_idx").on(table.companyId),
}));

export const insertPmTemplateSchema = createInsertSchema(pmTemplates).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePmTemplateSchema = insertPmTemplateSchema.partial();

export type PmTemplate = typeof pmTemplates.$inferSelect;
export type InsertPmTemplate = z.infer<typeof insertPmTemplateSchema>;
export type UpdatePmTemplate = z.infer<typeof updatePmTemplateSchema>;

// ============================================================================
// RECURRING JOB TEMPLATES - Maintenance Plans
// ============================================================================

export const recurringJobTemplates = pgTable("recurring_job_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Optional client/location linkage
  clientId: varchar("client_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "set null" }),
  // Job template details
  title: text("title").notNull(),
  description: text("description"),
  notes: text("notes"),
  defaultDurationMinutes: integer("default_duration_minutes"),
  // preferred_technician_id dropped — PM jobs no longer pre-assign technicians
  jobType: text("job_type").notNull().default("maintenance"),
  priority: text("priority").notNull().default("medium"),
  // OpenSubStatus for generated jobs (null = backlog, "on_hold" = held jobs)
  // All generated jobs have status='open'; this controls the optional openSubStatus
  openSubStatusDefault: text("open_sub_status_default"), // null | in_progress | on_hold | on_route
  holdReason: text("hold_reason"), // Required if openSubStatusDefault = 'on_hold'
  // Active/inactive toggle
  isActive: boolean("is_active").notNull().default(true),
  // Recurrence schedule
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  timezone: text("timezone"), // IANA string, fallback to company_settings.timezone
  // Recurrence pattern
  recurrenceKind: text("recurrence_kind").notNull().default("weekly"), // weekly | monthly
  interval: integer("interval").notNull().default(1), // every N weeks/months
  daysOfWeek: integer("days_of_week").array(), // 0=Sun..6=Sat, for weekly
  dayOfMonth: integer("day_of_month"), // 1..31, for monthly (null = use startDate day)
  // PM scheduling extensions
  monthsOfYear: integer("months_of_year").array(), // 1..12; null = no month restriction
  generationMode: text("generation_mode").notNull().default("phase"), // phase | period_start | day_of_month
  generationDayOfMonth: integer("generation_day_of_month"), // 1..31, required when generationMode = 'day_of_month'
  includeLocationPmParts: boolean("include_location_pm_parts").notNull().default(false), // copy location PM parts into job_parts on generation
  // PM Phase 3: Service window — acceptable date range around ideal PM date
  serviceWindowDaysBefore: integer("service_window_days_before").notNull().default(7),
  serviceWindowDaysAfter: integer("service_window_days_after").notNull().default(14),
  // PM Billing Disposition: Contract-level billing rules
  pmBillingModel: text("pm_billing_model"), // per_visit | monthly_fixed | annual_prepaid | do_not_bill
  pmBillingLabel: text("pm_billing_label"), // Human-readable billing label (e.g. "Quarterly RTU PM")
  pmContractAmount: numeric("pm_contract_amount", { precision: 12, scale: 2 }), // Contract/service amount
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdx: index("recurring_job_templates_company_idx").on(table.companyId),
  companyActiveIdx: index("recurring_job_templates_company_active_idx").on(table.companyId, table.isActive),
}));

export const insertRecurringJobTemplateSchema = createInsertSchema(recurringJobTemplates).omit({
  id: true,
  companyId: true, // Tenant companyId is injected server-side from req.companyId
  createdAt: true,
  updatedAt: true,
}).extend({
  recurrenceKind: z.enum(recurrenceKindEnum).default("weekly"),
  openSubStatusDefault: z.enum(openSubStatusEnum).nullable().optional(), // null = normal backlog
  holdReason: z.enum(holdReasonEnum).nullable().optional(),
  jobType: z.enum(jobTypeEnum).default("maintenance"),
  priority: z.enum(jobPriorityEnum).default("medium"),
  interval: z.number().int().min(1).max(52).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: z.string(), // Accept ISO date string
  endDate: z.string().nullable().optional(),
  // PM scheduling extensions
  monthsOfYear: z.array(z.number().int().min(1).max(12)).nullable().optional(),
  generationMode: z.enum(generationModeEnum).default("phase"),
  generationDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  includeLocationPmParts: z.boolean().default(false),
  // PM Phase 3: Service window fields
  serviceWindowDaysBefore: z.number().int().min(0).max(90).default(7),
  serviceWindowDaysAfter: z.number().int().min(0).max(90).default(14),
  // PM Billing Disposition: Contract-level billing rules
  pmBillingModel: z.enum(pmBillingModelEnum).nullable().optional(),
  pmBillingLabel: z.string().nullable().optional(),
  pmContractAmount: z.string().nullable().optional(), // numeric stored as string
});

export const updateRecurringJobTemplateSchema = z.object({
  clientId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  defaultDurationMinutes: z.number().int().min(0).nullable().optional(),
  jobType: z.enum(jobTypeEnum).optional(),
  priority: z.enum(jobPriorityEnum).optional(),
  openSubStatusDefault: z.enum(openSubStatusEnum).nullable().optional(),
  holdReason: z.enum(holdReasonEnum).nullable().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  recurrenceKind: z.enum(recurrenceKindEnum).optional(),
  interval: z.number().int().min(1).max(52).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  // PM scheduling extensions
  monthsOfYear: z.array(z.number().int().min(1).max(12)).nullable().optional(),
  generationMode: z.enum(generationModeEnum).optional(),
  generationDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  includeLocationPmParts: z.boolean().optional(),
  // PM Phase 3: Service window fields
  serviceWindowDaysBefore: z.number().int().min(0).max(90).optional(),
  serviceWindowDaysAfter: z.number().int().min(0).max(90).optional(),
  // PM Billing Disposition: Contract-level billing rules
  pmBillingModel: z.enum(pmBillingModelEnum).nullable().optional(),
  pmBillingLabel: z.string().nullable().optional(),
  pmContractAmount: z.string().nullable().optional(),
});

export type InsertRecurringJobTemplate = z.infer<typeof insertRecurringJobTemplateSchema>;
export type UpdateRecurringJobTemplate = z.infer<typeof updateRecurringJobTemplateSchema>;
export type RecurringJobTemplate = typeof recurringJobTemplates.$inferSelect;

// ============================================================================
// RECURRING JOB INSTANCES - Track generated instances for idempotency
// ============================================================================

export const recurringInstanceStatusEnum = ["pending", "claiming", "generated", "skipped", "canceled"] as const;
export type RecurringInstanceStatus = typeof recurringInstanceStatusEnum[number];

export const recurringJobInstances = pgTable("recurring_job_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").notNull().references(() => recurringJobTemplates.id, { onDelete: "cascade" }),
  instanceDate: date("instance_date").notNull(),
  generatedJobId: varchar("generated_job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending | claiming | generated | skipped | canceled
  claimedAt: timestamp("claimed_at"), // Set when transitioning pending -> claiming, for stale claim recovery
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  companyIdx: index("recurring_job_instances_company_idx").on(table.companyId),
  templateIdx: index("recurring_job_instances_template_idx").on(table.templateId),
  templateDateUniq: uniqueIndex("recurring_job_instances_template_date_uniq").on(table.templateId, table.instanceDate),
}));

export const insertRecurringJobInstanceSchema = createInsertSchema(recurringJobInstances).omit({
  id: true,
  createdAt: true,
}).extend({
  status: z.enum(recurringInstanceStatusEnum).default("pending"),
  instanceDate: z.string(), // Accept ISO date string
  claimedAt: z.date().nullable().optional(),
});

export type InsertRecurringJobInstance = z.infer<typeof insertRecurringJobInstanceSchema>;
export type RecurringJobInstance = typeof recurringJobInstances.$inferSelect;

// ============================================================================
// PM BILLING EVENTS — Contract-period billing for monthly_fixed / annual_prepaid
// ============================================================================

/**
 * PM Billing Phase 2: Tracks contract-period billing events.
 * One event per billing period per PM contract (monthly or annual).
 * Links to canonical invoices for traceability.
 */
export const pmBillingEventStatusEnum = ["pending", "invoiced", "skipped", "canceled", "billing_exception"] as const;
export type PmBillingEventStatus = typeof pmBillingEventStatusEnum[number];

export const pmBillingEvents = pgTable("pm_billing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  pmContractId: varchar("pm_contract_id").notNull().references(() => recurringJobTemplates.id, { onDelete: "cascade" }),
  billingModelSnapshot: text("billing_model_snapshot").notNull(), // per_visit | monthly_fixed | annual_prepaid
  periodStart: date("period_start").notNull(), // Billing period start (e.g. 2026-04-01)
  periodEnd: date("period_end").notNull(), // Billing period end (e.g. 2026-04-30)
  billingDate: date("billing_date").notNull(), // Date event becomes actionable
  status: text("status").notNull().default("pending"), // pending | invoiced | skipped | canceled | billing_exception
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  amountSnapshot: numeric("amount_snapshot", { precision: 12, scale: 2 }), // Snapshotted from contract at creation
  billingLabelSnapshot: text("billing_label_snapshot"), // Human-readable label snapshot
  notes: text("notes"), // Optional notes (e.g. skip reason)
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyIdx: index("pm_billing_events_company_idx").on(table.companyId),
  contractIdx: index("pm_billing_events_contract_idx").on(table.pmContractId),
  // Idempotency: one event per contract per billing period
  contractPeriodUniq: uniqueIndex("pm_billing_events_contract_period_uniq").on(table.pmContractId, table.periodStart),
  statusIdx: index("pm_billing_events_status_idx").on(table.companyId, table.status),
}));

export const insertPmBillingEventSchema = createInsertSchema(pmBillingEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(pmBillingEventStatusEnum).default("pending"),
  periodStart: z.string(),
  periodEnd: z.string(),
  billingDate: z.string(),
});

export type InsertPmBillingEvent = z.infer<typeof insertPmBillingEventSchema>;
export type PmBillingEvent = typeof pmBillingEvents.$inferSelect;

// ============================================================================
// TAX RATES & TAX GROUPS (v1 multi-tax system for Canadian HVAC)
// ============================================================================

/**
 * Individual tax rates (e.g., GST 5%, PST 7%, HST 13%).
 * Soft-deleted via active flag. Scoped to company.
 */
export const companyTaxRates = pgTable("company_tax_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertCompanyTaxRateSchema = createInsertSchema(companyTaxRates).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyTaxRate = z.infer<typeof insertCompanyTaxRateSchema>;
export type CompanyTaxRate = typeof companyTaxRates.$inferSelect;

/**
 * Composable tax groups (e.g., "GST+PST" = 12%).
 * One group per company may be marked as default (partial unique index).
 * Soft-deleted via active flag.
 */
export const companyTaxGroups = pgTable("company_tax_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertCompanyTaxGroupSchema = createInsertSchema(companyTaxGroups).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyTaxGroup = z.infer<typeof insertCompanyTaxGroupSchema>;
export type CompanyTaxGroup = typeof companyTaxGroups.$inferSelect;

/**
 * Junction table: links tax groups to their component tax rates.
 * Unique on (groupId, taxRateId).
 */
export const companyTaxGroupRates = pgTable("company_tax_group_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull().references(() => companyTaxGroups.id, { onDelete: "cascade" }),
  taxRateId: varchar("tax_rate_id").notNull().references(() => companyTaxRates.id, { onDelete: "cascade" }),
}, (table) => ({
  groupRateUniq: uniqueIndex("company_tax_group_rates_uniq").on(table.groupId, table.taxRateId),
}));

export const insertCompanyTaxGroupRateSchema = createInsertSchema(companyTaxGroupRates).omit({
  id: true,
});

export type InsertCompanyTaxGroupRate = z.infer<typeof insertCompanyTaxGroupRateSchema>;
export type CompanyTaxGroupRate = typeof companyTaxGroupRates.$inferSelect;

// ============================================================================
// INVOICE TAX LINES — Snapshot of tax group composition at invoice creation
// ============================================================================

/**
 * Stores the individual tax rate breakdown applied to an invoice at creation time.
 * Freezes the group composition so later edits to rates/groups do NOT affect
 * historical invoices. One row per component rate (e.g., GST + PST = 2 rows).
 */
export const invoiceTaxLines = pgTable("invoice_tax_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  /** FK to the original tax rate (for audit); may be deactivated later */
  taxRateId: varchar("tax_rate_id").references(() => companyTaxRates.id, { onDelete: "set null" }),
  /** Snapshot: rate name at time of invoice creation */
  taxRateName: text("tax_rate_name").notNull(),
  /** Snapshot: rate percentage at time of invoice creation (e.g., "5.0000" for 5%) */
  ratePercent: numeric("rate_percent", { precision: 7, scale: 4 }).notNull(),
  /** Taxable amount this rate was applied to (invoice subtotal) */
  taxableAmount: numeric("taxable_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  /** Computed tax for this rate: taxableAmount * (ratePercent / 100) */
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  /** Snapshot: tax group ID at time of creation (for audit) */
  taxGroupId: varchar("tax_group_id"),
  /** Snapshot: tax group name at time of creation */
  taxGroupName: text("tax_group_name"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  invoiceTaxLinesInvoiceIdx: index("invoice_tax_lines_invoice_idx").on(table.invoiceId),
  invoiceTaxLinesCompanyIdx: index("invoice_tax_lines_company_idx").on(table.companyId),
}));

export const insertInvoiceTaxLineSchema = createInsertSchema(invoiceTaxLines).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoiceTaxLine = z.infer<typeof insertInvoiceTaxLineSchema>;
export type InvoiceTaxLine = typeof invoiceTaxLines.$inferSelect;

// ============================================================================
// CUSTOMER PORTAL — Magic Link Tokens
// Single-use, time-limited tokens for customer portal authentication
// ============================================================================
export const portalMagicTokens = pgTable("portal_magic_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => clientContacts.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  /** SHA-256 hash of the token (raw token is never stored) */
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"), // NULL = unused, set on first use
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tokenHashIdx: uniqueIndex("portal_magic_tokens_hash_idx").on(table.tokenHash),
  emailIdx: index("portal_magic_tokens_email_idx").on(table.email),
  expiresIdx: index("portal_magic_tokens_expires_idx").on(table.expiresAt),
}));

export type PortalMagicToken = typeof portalMagicTokens.$inferSelect;

// ============================================================================
// EVENTS — Canonical tenant-scoped append-only event log
// Used for: Recent Activity feed, entity timelines, analytics, debugging
// Phase 1 Architecture: Event Log + Attention Queue
// ============================================================================

export const eventActorTypeEnum = ["user", "system"] as const;
export type EventActorType = (typeof eventActorTypeEnum)[number];

export const eventEntityTypeEnum = [
  "job", "invoice", "quote", "client", "location", "payment", "item",
  "visit", "task", "technician", // Phase 4B.1: milestone events (2026-03-05)
  "other",
] as const;
export type EventEntityType = (typeof eventEntityTypeEnum)[number];

export const eventSeverityEnum = ["info", "warning", "important"] as const;
export type EventSeverity = (typeof eventSeverityEnum)[number];

export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: text("actor_type").notNull().default("user"), // user | system
  entityType: text("entity_type").notNull(), // job | invoice | quote | client | ...
  entityId: varchar("entity_id").notNull(),
  eventType: text("event_type").notNull(), // e.g. job.created, job.completed, invoice.created
  severity: text("severity").notNull().default("info"), // info | warning | important
  summary: text("summary").notNull(), // Short human-readable description
  meta: jsonb("meta"), // Small metadata: jobNumber, clientName, totals, etc.
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantCreatedIdx: index("events_tenant_created_idx").on(table.tenantId, table.createdAt),
  tenantEntityIdx: index("events_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId, table.createdAt),
  tenantEventTypeIdx: index("events_tenant_event_type_idx").on(table.tenantId, table.eventType, table.createdAt),
}));

export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

// ============================================================================
// ATTENTION ITEMS — Materialized "needs attention" queue with rule-based detection
// Single backend canonical queue for: requires invoicing, overdue, unassigned, unscheduled
// Phase 1 Architecture: Event Log + Attention Queue
// ============================================================================

export const attentionRuleTypeEnum = [
  "job.requires_invoicing",
  "job.overdue",
  "job.unassigned",
  "job.unscheduled",
  "invoice.past_due",
  // Phase 5: Visit intelligence signals
  "visit.late",
  "visit.overdue",
  "visit.running_long",
  "tech.offline",
  "tech.idle",
] as const;
export type AttentionRuleType = (typeof attentionRuleTypeEnum)[number];

export const attentionSeverityEnum = ["high", "medium", "low"] as const;
export type AttentionSeverity = (typeof attentionSeverityEnum)[number];

export const attentionStatusEnum = ["open", "resolved"] as const;
export type AttentionStatus = (typeof attentionStatusEnum)[number];

export const attentionItems = pgTable("attention_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // job | invoice | quote | client | other
  entityId: varchar("entity_id").notNull(),
  ruleType: text("rule_type").notNull(), // job.requires_invoicing | job.overdue | ...
  severity: text("severity").notNull().default("medium"), // high | medium | low
  status: text("status").notNull().default("open"), // open | resolved
  firstDetectedAt: timestamp("first_detected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastDetectedAt: timestamp("last_detected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: timestamp("resolved_at"),
  meta: jsonb("meta"), // e.g. { jobNumber, clientName, dueDate }
  dedupeKey: text("dedupe_key").notNull(), // "${entityType}:${entityId}:${ruleType}"
}, (table) => ({
  tenantDedupeIdx: unique("attention_items_tenant_dedupe_idx").on(table.tenantId, table.dedupeKey),
  tenantStatusIdx: index("attention_items_tenant_status_idx").on(table.tenantId, table.status, table.severity, table.lastDetectedAt),
  tenantEntityIdx: index("attention_items_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId),
}));

export const insertAttentionItemSchema = createInsertSchema(attentionItems).omit({
  id: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  resolvedAt: true,
});

export type InsertAttentionItem = z.infer<typeof insertAttentionItemSchema>;
export type AttentionItem = typeof attentionItems.$inferSelect;

// =============================================================================
// TECHNICIAN POSITIONS — Phase 4B: GPS telemetry pings (2026-03-05)
// =============================================================================

export const technicianPositions = pgTable("technician_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  accuracy: numeric("accuracy"),
  speed: numeric("speed"),
  heading: numeric("heading"),
  recordedAt: timestamp("recorded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  companyTechIdx: index("tech_positions_company_tech_idx").on(table.companyId, table.technicianId),
  techRecordedIdx: index("tech_positions_tech_recorded_idx").on(table.technicianId, table.recordedAt),
}));

export const insertTechnicianPositionSchema = createInsertSchema(technicianPositions).omit({
  id: true,
  recordedAt: true,
});

export type InsertTechnicianPosition = z.infer<typeof insertTechnicianPositionSchema>;
export type TechnicianPosition = typeof technicianPositions.$inferSelect;

// =============================================================================
// TECHNICIAN LIVE POSITIONS — Phase 4B.1: Ephemeral one-row-per-tech (2026-03-05)
// =============================================================================

export const technicianLivePositions = pgTable("technician_live_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  accuracy: numeric("accuracy"),
  speed: numeric("speed"),
  heading: numeric("heading"),
  lastSeenAt: timestamp("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  companyTechUnique: unique("tech_live_company_tech_unique").on(table.companyId, table.technicianId),
  companyLastSeenIdx: index("tech_live_company_last_seen_idx").on(table.companyId, table.lastSeenAt),
}));

export type TechnicianLivePosition = typeof technicianLivePositions.$inferSelect;

// =============================================================================
// JOB EXPENSES — Tracks additional job costs (parking, materials, mileage, etc.)
// =============================================================================
// Feeds into unified job costing: Parts + Labor + Expenses → Total Cost / Profit / Margin.
// Billable expenses can be converted to invoice lines via invoiceCreationService.

export const expenseCategoryEnum = [
  "parking", "materials", "mileage", "travel", "equipment_rental",
  "permit", "disposal", "subcontractor", "other",
] as const;
export type ExpenseCategory = typeof expenseCategoryEnum[number];

export const expenseBillingStatusEnum = ["pending", "added_to_invoice"] as const;
export type ExpenseBillingStatus = typeof expenseBillingStatusEnum[number];

export const jobExpenses = pgTable("job_expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  category: text("category").notNull(), // One of expenseCategoryEnum values
  date: timestamp("date").notNull(),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  receiptFileId: varchar("receipt_file_id").references(() => files.id, { onDelete: "set null" }),
  isBillable: boolean("is_billable").notNull().default(false),
  billingStatus: text("billing_status").notNull().default("pending"), // One of expenseBillingStatusEnum
  reimbursableToUserId: varchar("reimbursable_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  jobCompanyIdx: index("job_expenses_job_company_idx").on(table.jobId, table.companyId),
  companyCreatedAtIdx: index("job_expenses_company_created_at_idx").on(table.companyId, table.createdAt),
}));

export const insertJobExpenseSchema = createInsertSchema(jobExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  amount: z.string().or(z.number()),
  category: z.enum(expenseCategoryEnum),
  date: z.string().or(z.date()),
  billingStatus: z.enum(expenseBillingStatusEnum).optional(),
});

export const updateJobExpenseSchema = z.object({
  amount: z.string().or(z.number()).optional(),
  category: z.enum(expenseCategoryEnum).optional(),
  date: z.string().or(z.date()).optional(),
  notes: z.string().nullable().optional(),
  receiptFileId: z.string().nullable().optional(),
  isBillable: z.boolean().optional(),
  reimbursableToUserId: z.string().nullable().optional(),
});

export type InsertJobExpense = z.infer<typeof insertJobExpenseSchema>;
export type UpdateJobExpense = z.infer<typeof updateJobExpenseSchema>;
export type JobExpense = typeof jobExpenses.$inferSelect;