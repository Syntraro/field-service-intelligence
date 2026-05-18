import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, integer, boolean, timestamp, date, numeric, uniqueIndex, jsonb, index, check, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// =============================================================================
// ENUMS
// =============================================================================

export const userAppearanceEnum = ["dark", "light"] as const;
export type UserAppearance = typeof userAppearanceEnum[number];

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
  // 2026-05-03 — DEPRECATED (single-pair model).
  // These two columns held a tenant's *single* tax registration
  // identity for customer-facing invoices. Replaced the same day by
  // the multi-row `company_tax_registrations` child table — tenants
  // now store ONE OR MORE registration entries (e.g. HST + GST, or
  // VAT + EORI) and the PDF renders every active row as its own
  // line. The columns are kept here only to preserve rollback
  // safety: existing data is mirrored into the new table by the
  // backfill in `migrations/2026_05_03_company_tax_registrations_table.sql`,
  // and a rollback to the prior code path keeps reading these
  // columns. NO CURRENT CALLER WRITES THEM. A follow-up PR will
  // drop the columns + this comment block once the new code path
  // has been live for one release cycle.
  taxRegistrationLabel: text("tax_registration_label"),
  taxRegistrationNumber: text("tax_registration_number"),
  // QBO item/tax mapping configuration
  // JSON structure: { productServiceItemId, taxableCode, nonTaxableCode } (legacy per-type fields also accepted)
  qboMappingConfig: jsonb("qbo_mapping_config"),
  // QBO Go-Live Safety Gate
  qboEnabled: boolean("qbo_enabled").notNull().default(false),
  qboEnvironment: text("qbo_environment").notNull().default("sandbox"), // "sandbox" | "production"
  qboRealmId: text("qbo_realm_id"), // QBO company ID for webhook mapping
  // 2026-04-09: Outbound payment sync toggle. Independent of qboEnabled because
  // a company may want to sync invoices to QBO without auto-pushing every
  // payment correction. Gates BOTH the post-write hook AND manual retry —
  // when false, payment sync does not happen at all.
  qboPaymentSyncEnabled: boolean("qbo_payment_sync_enabled").notNull().default(false),
  // 2026-05-03 PR1 (tenant-payments foundation) — tenant's chosen
  // payment-collection provider. NULL until onboarding picks one. Drives
  // `resolveForCompany()` in the provider resolver. Provider-neutral on
  // purpose: today the only valid value is `stripe`, but Adyen / Square /
  // etc. join the same column without a schema migration. Distinct from
  // the legacy `stripeCustomerId` / `stripeSubscriptionId` columns above
  // (which are SUBSCRIPTION billing, not customer-payment collection).
  paymentProvider: text("payment_provider"),
  // QBO onboarding — set once on first successful import run (fetched > 0)
  qboOnboardingCatalogImportedAt: timestamp("qbo_onboarding_catalog_imported_at"),
  qboOnboardingCustomersImportedAt: timestamp("qbo_onboarding_customers_imported_at"),
  // 2026-04-19 Hybrid SaaS: null until the owner finishes the onboarding
  // wizard (public signup path). Legacy tenants are backfilled to
  // `created_at` by the matching migration so they skip the wizard.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// ============================================================================
// Company Tax Registrations (2026-05-03)
// ============================================================================
//
// Tenant-level multi-row tax registration identity for customer-facing
// invoices. Each row carries an optional `label` (e.g. "HST", "GST",
// "VAT", "EORI") and a required `number` (the registration ID itself).
// A company has zero or more rows; the customer-facing invoice PDF
// renders one line per row under the company contact block.
//
// `sort_order` determines presentation order on the PDF and in the
// settings UI. The replace-all PUT endpoint reassigns sort_order
// based on input order on every save, so re-orderable lists are
// trivial to implement.
//
// UNRELATED to `company_tax_rates` / `company_tax_groups` — those
// drive the tax-RATE calculation engine (the math). This table
// describes the business as a tax-REGISTERED entity for display
// only. No invoice math reads this table.
export const companyTaxRegistrations = pgTable("company_tax_registrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  label: text("label"),
  number: text("number").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type CompanyTaxRegistration = typeof companyTaxRegistrations.$inferSelect;
export type InsertCompanyTaxRegistration = typeof companyTaxRegistrations.$inferInsert;

// 2026-04-19 Profile consolidation (Phase 1): canonical Zod schema for the
// Company Settings profile form. Fields live on `companies` (canonical) but
// the API contract — and this schema's field names — preserve `companyName`
// for backward compatibility with the existing `/api/company-settings` shape
// the frontend already speaks. The route handler translates `companyName`
// <-> `companies.name` on the write/read boundary.
export const companyProfileFormSchema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  provinceState: z.string().max(100).optional().nullable(),
  postalCode: postalCodeSchema,
  email: z.string().email().max(255).optional().nullable().or(z.literal("")),
  phone: z.string().max(30).optional().nullable(),
  // 2026-05-03: tax registration moved from these single-pair fields
  // to the dedicated `company_tax_registrations` table (one row per
  // registration, multiple rows per company). The settings page now
  // edits the list via /api/company-tax-registrations; the profile
  // form schema no longer carries any tax-registration fields.
});
export type CompanyProfileFormData = z.infer<typeof companyProfileFormSchema>;

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
  // 2026-05-04 Phase 6: enforced at the DB level by a CHECK constraint
  // (`users_role_tenant_only_chk`, see
  // `migrations/2026_05_04_users_role_restrict_to_tenant.sql`). Allowed
  // values are EXACTLY the canonical tenant role list:
  //   "owner" | "admin" | "manager" | "dispatcher" | "technician"
  // Platform roles (`platform_admin`, `platform_support`, `platform_billing`,
  // `platform_readonly_audit`) are NEVER allowed here — they live on the
  // `platform_user_roles` join table only. Any INSERT or UPDATE that
  // tries to put a platform role string into this column is rejected
  // by the database with a CHECK violation.
  role: text("role").notNull().default("technician"),
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
  // CHECK constraint mirrors migrations/2026_05_11_user_appearance_preference.sql
  appearance: text("appearance").notNull().default("dark"),
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
  "cancelAtPeriodEnd" |
  "onboardingCompletedAt"
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

// 2026-05-03: dedicated reset-token table for platform-role users.
// Deliberately separate from `passwordResetTokens` above so a tenant
// reset link can never be redeemed at the platform endpoint and vice
// versa — the two flows live in distinct token tables, distinct
// repositories, and distinct services. Same separation-of-purpose
// principle that gates the psid vs sid cookie split. See
// `server/services/platformPasswordResetService.ts`.
export const platformPasswordResetTokens = pgTable("platform_password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  requestedIp: text("requested_ip"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type PlatformPasswordResetToken = typeof platformPasswordResetTokens.$inferSelect;

// ============================================================================
// Platform Identity (Phase 2-A, 2026-05-04)
// ============================================================================
//
// Dedicated tables for SaaS-vendor staff identities (`platform_admin`,
// `platform_support`, `platform_billing`, `platform_readonly_audit`).
// Replace the legacy "platform user parked in tenant `users` with a
// fake `companyId`" model. Created by
// `migrations/2026_05_04_platform_users_create.sql` and backfilled
// from the legacy rows by `*_platform_users_backfill.sql`.
//
// Decision (2026-05-04, Option 1): same email is allowed across
// platform + tenant. Uniqueness is enforced WITHIN this surface only;
// the tenant `user_identities` table is queried independently. A real
// human MAY hold both a tenant account and a platform-staff account
// at the same email — the two surfaces are deliberately separate
// identity worlds.
//
// `platform_password_reset_tokens.user_id` will be repointed to
// `platform_users.id` in a follow-up migration once the backfill
// has run; the FK rewrite is a no-op on existing tokens because
// the backfill preserves user-ids byte-for-byte.

export const platformUsers = pgTable("platform_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  fullName: text("full_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  // 'active' | 'deactivated'. Smaller enum than tenant `users.status`
  // — platform users are bootstrapped via the seed script, never invited.
  status: text("status").notNull().default("active"),
  disabled: boolean("disabled").notNull().default(false),
  // Same session-invalidation lever as tenant `users.token_version`.
  tokenVersion: integer("token_version").notNull().default(0),
  lastLoginAt: timestamp("last_login_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type PlatformUser = typeof platformUsers.$inferSelect;
export type InsertPlatformUser = typeof platformUsers.$inferInsert;

export const platformUserIdentities = pgTable("platform_user_identities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => platformUsers.id, { onDelete: "cascade" }),
  // 'email' (SSO providers may be added later without schema change).
  provider: text("provider").notNull(),
  identifier: text("identifier").notNull(),
  passwordHash: text("password_hash"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type PlatformUserIdentity = typeof platformUserIdentities.$inferSelect;
export type InsertPlatformUserIdentity = typeof platformUserIdentities.$inferInsert;

// Multi-role join. Today every platform user has exactly one role
// (legacy single-role model); the schema is multi-role-ready so a
// future "grant additional role" flow doesn't need a migration.
// Role strings match the canonical PLATFORM_ROLES list in
// server/auth/roles.ts — application layer is source of truth, no
// CHECK constraint at the DB level (matches the existing users.role
// pattern).
export const platformUserRoles = pgTable("platform_user_roles", {
  userId: varchar("user_id")
    .notNull()
    .references(() => platformUsers.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  grantedAt: timestamp("granted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // Nullable so the bootstrap seed (the very first platform user) can
  // insert without a circular FK. ON DELETE SET NULL preserves audit
  // trail when a granter is later removed.
  grantedBy: varchar("granted_by"),
});

export type PlatformUserRole = typeof platformUserRoles.$inferSelect;
export type InsertPlatformUserRole = typeof platformUserRoles.$inferInsert;

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
  "INVITATION_CREATED",
  "INVITATION_RESENT",
  // 2026-04-26 — Per-user permission override write
  // (PATCH /api/team/:userId/permissions). Closes the audit gap surfaced
  // by the permissions audit. The DB column is plain text so the new
  // action is a TS-level enum widening with no migration.
  "PERMISSION_OVERRIDE_CHANGED",
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

// ============================================================================
// 2026-05-04 — Tenant deletion requests (4-phase secure teardown).
//
// State machine (terminals: completed | cancelled | expired | failed):
//
//   pending ──approve──▶ approved ──worker──▶ executing ──ok──▶ completed
//      │                     │                     │
//      │ cancel/expire       │ cancel              │ fail
//      ▼                     ▼                     ▼
//   cancelled / expired   cancelled              failed
//
// Tenant teardown service is invoked by the executor with confirm=true
// only after the live preview hash matches the snapshot stored on the
// row. See `tenantDeletionRequestService` for the full orchestrator.
//
// `companyId` is intentionally a plain varchar — NO FK. The cascade
// delete of the company at execution time would otherwise destroy this
// audit row.
// ============================================================================
export const tenantDeletionRequestStatusEnum = [
  "pending",
  "approved",
  "executing",
  "completed",
  "cancelled",
  "expired",
  "failed",
] as const;
export type TenantDeletionRequestStatus =
  (typeof tenantDeletionRequestStatusEnum)[number];

export const tenantDeletionRequests = pgTable(
  "tenant_deletion_requests",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id").notNull(),
    companyNameSnapshot: text("company_name_snapshot").notNull(),
    companyEmailSnapshot: text("company_email_snapshot"),
    previewHash: text("preview_hash").notNull(),
    previewPayloadJson: jsonb("preview_payload_json").notNull(),
    initiatedByUserId: varchar("initiated_by_user_id").notNull(),
    initiatedByEmail: text("initiated_by_email").notNull(),
    approvedByUserId: varchar("approved_by_user_id"),
    approvedByEmail: text("approved_by_email"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executionScheduledAt: timestamp("execution_scheduled_at", { withTimezone: true }),
    // 2026-05-04 F2 hardening: explicit anchor for the stale-executing
    // reaper. Set atomically by `transitionToExecuting`; never updated
    // afterwards. NULL means "row never entered executing".
    executionStartedAt: timestamp("execution_started_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: varchar("cancelled_by_user_id"),
    cancelledByEmail: text("cancelled_by_email"),
    environmentSnapshot: jsonb("environment_snapshot"),
    requestIp: text("request_ip"),
    requestUserAgent: text("request_user_agent"),
  },
  (table) => ({
    companyIdx: index("tenant_deletion_requests_company_id_idx").on(table.companyId),
    statusIdx: index("tenant_deletion_requests_status_idx").on(table.status),
  }),
);

export const insertTenantDeletionRequestSchema = createInsertSchema(
  tenantDeletionRequests,
).omit({ id: true, createdAt: true });
export type InsertTenantDeletionRequest = z.infer<
  typeof insertTenantDeletionRequestSchema
>;
export type TenantDeletionRequest = typeof tenantDeletionRequests.$inferSelect;

// Impersonation sessions - Persistent storage for support mode sessions
export const impersonationSessions = pgTable("impersonation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Nullable since Phase 4: read-only support sessions do not have an
  // impersonation target user.
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: timestamp("ended_at"),
  endedReason: text("ended_reason"), // "manual", "expired", "idle", "logout"
  // Phase 4 (Support Sessions)
  accessMode: text("access_mode").notNull().default("impersonation"), // "read_only" | "impersonation"
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"), // "pending" | "active" | "expired" | "revoked" | "closed"
  startedAt: timestamp("started_at"),
  revokedAt: timestamp("revoked_at"),
  // Phase 7 (Production Readiness): stable canonical source for the
  // originally-requested duration. Backfilled from (expires_at - created_at)
  // for pre-existing rows.
  requestedDurationMinutes: integer("requested_duration_minutes"),
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
  name: text("name"), // Company name (nullable for residential clients)
  nameNormalized: text("name_normalized").notNull().default(""), // Lowercase, trimmed, whitespace-collapsed — used for case-insensitive dedup
  legalName: text("legal_name"), // Official legal name if different
  // Person identity — for residential clients or mixed (person + company)
  firstName: text("first_name"),
  lastName: text("last_name"),
  // When true, company name is used as primary display/billing identity; when false, person name is primary
  useCompanyAsPrimary: boolean("use_company_as_primary").notNull().default(true),
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
  // 2026-05-03 PR A — saved-payment-method foundation. Provider-neutral
  // reference to the bill-to party's identity at whichever payment
  // provider the tenant uses. Stripe is the first concrete provider;
  // a future Adyen/Square adapter writes to the same column. Lazily
  // minted by `customerCompanyPaymentService.resolveOrCreateProviderCustomer`
  // on the first save-card request and reused thereafter. Never set
  // by user input — always provider-issued.
  providerCustomerId: text("provider_customer_id"),
  // 2026-05-07: per-client invoice payment-terms default. NULL = inherit
  // from companies.default_payment_terms_days. The Edit Client dialog
  // surfaces this as a select with a "Use company default" option that
  // maps to NULL and a "Custom" option that surfaces a free-form day
  // input. New invoices for this client default their paymentTermsDays
  // from this column when set, falling through to the tenant default
  // when null. Existing invoices are NEVER retroactively changed when
  // this value is updated — invoice.paymentTermsDays is captured at
  // create time.
  paymentTermsDays: integer("payment_terms_days"),
  // Legacy nameSource replaced by useCompanyAsPrimary boolean (2026-04-10)
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
  // 2026-05-03 PR A — same shape for the provider-neutral customer id.
  // Tenant-scoped uniqueness; partial because the column is nullable
  // (most rows stay NULL forever — only customer_companies whose
  // customers actually save a card get one minted).
  providerCustomerIdUq: uniqueIndex("customer_companies_company_provider_customer_id_uq")
    .on(table.companyId, table.providerCustomerId)
    .where(sql`provider_customer_id is not null`),
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
  // 2026-04-10: nullable — when null/blank, UI falls back to customerCompanies.name
  companyName: text("company_name"),
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

// ============================================================================
// Contact Persons — one row per human (identity), owned by customer company
// ============================================================================
export const contactPersons = pgTable("contact_persons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  // 2026-05-02 honorific split: `title` is now the honorific only
  // (Mr. / Mrs. / Ms. / Miss / Dr. / null), and the freeform
  // professional role lives in `jobTitle`. The migration
  // `migrations/2026_05_02_contact_persons_honorific_split.sql`
  // moved every pre-existing `title` value into `jobTitle` and
  // nulled out `title`, so post-migration both columns are
  // semantically clean. The Jobber `Title` import maps to
  // `jobTitle` going forward.
  title: text("title"),
  jobTitle: text("job_title"),
  email: text("email"),
  phone: text("phone"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertContactPersonSchema = createInsertSchema(contactPersons).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type ContactPerson = typeof contactPersons.$inferSelect;
export type InsertContactPerson = z.infer<typeof insertContactPersonSchema>;

// ============================================================================
// Contact Assignments — links a person to a location with roles
// ============================================================================
export const contactAssignments = pgTable("contact_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactPersonId: varchar("contact_person_id").notNull().references(() => contactPersons.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertContactAssignmentSchema = createInsertSchema(contactAssignments).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type ContactAssignment = typeof contactAssignments.$inferSelect;
export type InsertContactAssignment = z.infer<typeof insertContactAssignmentSchema>;

// Legacy compatibility alias — old code references ClientContact type
// TODO: Remove after all consumers are migrated
export type ClientContact = ContactPerson & { locationId?: string | null; roles?: string[] };
export type InsertClientContact = InsertContactPerson & { locationId?: string | null; roles?: string[] };

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

// Item categories — named persistent category labels per company.
// The items.category text field remains the FK-free source of truth on
// each item; this table is the catalog / registry that powers
// Add / Rename / Delete from the Category Management page.
// "Uncategorized" is NOT a row — derived at read time from null item.category.
export const itemCategories = pgTable("item_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ItemCategory = typeof itemCategories.$inferSelect;

// 2026-05-07 RALPH — Pricebook Groups: saved bundles of pricebook items
// (e.g. "Service Call" = Labor + Truck Charge + Parking) that expand
// into N line items when added to a job/quote/invoice.
//
// usageCount is incremented by the canonical pricebookUsageService when
// a group is added; the picker right-rail orders by usageCount DESC,
// name ASC. We chose a simple counter over a per-target usage table
// per the brief's "If full usage tracking is too large: implement a
// simple usage_count column" carve-out — recency weighting / per-
// target analytics can plug into the service later without changing
// the table shape.
export const pricebookGroups = pgTable("pricebook_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  // Display tag; future-proofing only. Picker rail does not consume yet.
  color: text("color"),
  icon: text("icon"),
  isActive: boolean("is_active").notNull().default(true),
  // Incremented atomically on bulk-add (POST /api/pricebook-groups/:id/usage).
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Unique active group name per tenant. Soft-archived groups
  // (is_active = false) are excluded so a tenant can re-use a name
  // after archiving.
  nameUq: uniqueIndex("pricebook_groups_company_name_active_uq")
    .on(table.companyId, table.name)
    .where(sql`is_active = true`),
  // Picker rail read predicate.
  lookupIdx: index("idx_pricebook_groups_lookup")
    .on(table.companyId, table.isActive, table.usageCount),
}));

// Junction table: child line items belonging to a group. Cascade-delete
// from the parent group so removing a group cleans up its children.
// Item FK uses ON DELETE CASCADE so a tenant deleting a pricebook item
// auto-removes it from any groups (avoiding broken expansions).
export const pricebookGroupItems = pgTable("pricebook_group_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  groupId: varchar("group_id").notNull().references(() => pricebookGroups.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  // Stored as numeric for parity with line_items.quantity; UI sends
  // strings. Default "1" matches the picker's default qty.
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Each (group, item) pair is unique — a child item appears at most
  // once per group. Re-adding the same item bumps quantity instead.
  uniqGroupItem: uniqueIndex("pricebook_group_items_group_item_uq")
    .on(table.groupId, table.itemId),
  groupLookupIdx: index("idx_pricebook_group_items_group")
    .on(table.companyId, table.groupId, table.sortOrder),
}));

export const insertPricebookGroupSchema = createInsertSchema(pricebookGroups).omit({
  id: true,
  companyId: true,
  userId: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPricebookGroupItemSchema = createInsertSchema(pricebookGroupItems).omit({
  id: true,
  companyId: true,
  groupId: true,
  createdAt: true,
  updatedAt: true,
});

export type PricebookGroup = typeof pricebookGroups.$inferSelect;
export type PricebookGroupItem = typeof pricebookGroupItems.$inferSelect;
export type InsertPricebookGroup = z.infer<typeof insertPricebookGroupSchema>;
export type InsertPricebookGroupItem = z.infer<typeof insertPricebookGroupItemSchema>;

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
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "cascade" }),
  // Canonical reference to service location
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
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
  // 2026-04-12 final cleanup: canonical crew input only.
  // null / empty array = unassigned; missing field = leave crew unchanged.
  assignedTechnicianIds: z.array(z.string().uuid()).nullable().optional(),
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
  assignedTechnicianIds: z.array(z.string().uuid()).nullable().optional(),
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
  // 2026-04-21 Phase 3 canonical policy architecture: invoice reminder cadence
  // relocated here from the legacy tenant_features table. These are functional
  // tenant configuration — NOT policy, NOT a feature entitlement — so they
  // belong with the other company-level preferences.
  invoiceRemindersEnabled: boolean("invoice_reminders_enabled").notNull().default(true),
  invoiceReminderFirstDelayDays: integer("invoice_reminder_first_delay_days").notNull().default(3),
  invoiceReminderRepeatEveryDays: integer("invoice_reminder_repeat_every_days").notNull().default(7),
  // Geofence start prompt — columns shipped by
  // migrations/2026_04_24_geofence_auto_start.sql. The drizzle declaration
  // mirrors only the two columns the prompt feature actually reads:
  //   - geofence_auto_start_enabled       → tenant on/off toggle
  //   - geofence_auto_start_radius_meters → DB CHECK enforces 25..1000
  // The third column (`geofence_require_manual_confirm`) shipped in the
  // migration but is unused — the prompt is always manual-confirm by
  // design. Left in the database for migration compat; not surfaced here.
  geofenceAutoStartEnabled: boolean("geofence_auto_start_enabled").notNull().default(false),
  geofenceAutoStartRadiusMeters: integer("geofence_auto_start_radius_meters").notNull().default(100),
  // Default scheduling buffer (2026-04-26): applied client-side when computing
  // scheduledEnd from a chosen work duration. DB CHECK enforces 0..240.
  defaultSchedulingBufferMinutes: integer("default_scheduling_buffer_minutes").notNull().default(0),
  // 2026-05-05: tenant-level Invoice Display policy. Visibility-only — controls
  // what appears on customer-facing invoice surfaces (PDF, email render,
  // client portal). The canonical resolver in `shared/invoiceDisplayPolicy.ts`
  // merges these tenant defaults with per-invoice override flags (already on
  // the `invoices` row) before any renderer touches output. Mandatory invoice
  // fields (company name, client name, invoice number, issue/due dates,
  // total, balance) are NOT toggled here — they are always rendered.
  invoiceShowLogo: boolean("invoice_show_logo").notNull().default(false),
  invoiceShowCompanyAddress: boolean("invoice_show_company_address").notNull().default(true),
  invoiceShowCompanyPhone: boolean("invoice_show_company_phone").notNull().default(true),
  invoiceShowCompanyEmail: boolean("invoice_show_company_email").notNull().default(true),
  invoiceShowCompanyWebsite: boolean("invoice_show_company_website").notNull().default(false),
  invoiceShowTaxNumber: boolean("invoice_show_tax_number").notNull().default(true),
  invoiceShowBillingAddress: boolean("invoice_show_billing_address").notNull().default(true),
  invoiceShowServiceAddress: boolean("invoice_show_service_address").notNull().default(true),
  invoiceShowLocationName: boolean("invoice_show_location_name").notNull().default(true),
  invoiceShowJobNumber: boolean("invoice_show_job_number").notNull().default(false),
  invoiceShowSummary: boolean("invoice_show_summary").notNull().default(false),
  invoiceShowJobDescription: boolean("invoice_show_job_description").notNull().default(true),
  invoiceShowClientMessage: boolean("invoice_show_client_message").notNull().default(true),
  // Default text used to PREFILL `invoices.client_message` when a new
  // invoice is created and `invoiceShowClientMessage = true`. Per-invoice
  // edits never propagate back here.
  invoiceDefaultClientMessage: text("invoice_default_client_message"),
  invoiceShowLineItems: boolean("invoice_show_line_items").notNull().default(true),
  invoiceShowQuantities: boolean("invoice_show_quantities").notNull().default(true),
  invoiceShowUnitPrices: boolean("invoice_show_unit_prices").notNull().default(true),
  invoiceShowLineTotals: boolean("invoice_show_line_totals").notNull().default(true),
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
}, (table) => ({
  // 2026-04-19 schema-reality sync: the DB already enforces this unique
  // constraint via migrations/2026_01_28_add_company_business_hours.sql
  // (CONSTRAINT company_business_hours_company_day_unique). Declaring
  // it here makes Drizzle aware of the invariant that
  // storage.upsertCompanyBusinessHours relies on in its
  // `onConflictDoUpdate({ target: [companyId, dayOfWeek] })`.
  companyDayUnique: uniqueIndex("company_business_hours_company_day_unique")
    .on(table.companyId, table.dayOfWeek),
}));

export const insertCompanyBusinessHoursSchema = createInsertSchema(companyBusinessHours).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompanyBusinessHours = z.infer<typeof insertCompanyBusinessHoursSchema>;
export type CompanyBusinessHours = typeof companyBusinessHours.$inferSelect;

// ============================================================================
// EQUIPMENT TYPES — tenant-owned, free-form catalog
// ============================================================================
// Each tenant manages their own list (RTU, Walk-in Cooler, Boiler, custom).
// Replaces the prior hardcoded HVAC-only frontend constant. Vertical-agnostic:
// fits HVAC, refrigeration, plumbing, electrical, fire suppression, etc.

export const equipmentTypes = pgTable("equipment_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Case-insensitive uniqueness per tenant — prevents duplicates like
  // "Boiler" / "boiler" / "BOILER" stacking up via the create-on-the-fly UX.
  uniqueNamePerCompany: uniqueIndex("equipment_types_company_name_lower_uq")
    .on(table.companyId, sql`lower(${table.name})`),
}));

export const insertEquipmentTypeSchema = createInsertSchema(equipmentTypes).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
});

export type EquipmentType = typeof equipmentTypes.$inferSelect;
export type InsertEquipmentType = z.infer<typeof insertEquipmentTypeSchema>;

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
  // Phase 3 (Ops Portal): platform-triage fields. All nullable so the
  // existing tenant submit path is unchanged.
  title: text("title"),
  route: text("route"),
  featureArea: text("feature_area"),
  priority: text("priority"),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at"),
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

// ──────────────────────────────────────────────────────────────
// Phase 3 (Ops Portal): Internal bug tracker + support notes
// ──────────────────────────────────────────────────────────────

export const issueReports = pgTable("issue_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => companies.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  source: text("source").notNull().default("platform"),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").notNull().default("medium"),
  priority: text("priority"),
  status: text("status").notNull().default("open"),
  route: text("route"),
  featureArea: text("feature_area"),
  reproSteps: text("repro_steps"),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertIssueReportSchema = createInsertSchema(issueReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertIssueReport = z.infer<typeof insertIssueReportSchema>;
export type IssueReport = typeof issueReports.$inferSelect;

export const internalSupportNotes = pgTable("internal_support_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => companies.id, { onDelete: "set null" }),
  relatedEntityType: text("related_entity_type").notNull(),
  relatedEntityId: varchar("related_entity_id").notNull(),
  note: text("note").notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertInternalSupportNoteSchema = createInsertSchema(internalSupportNotes).omit({
  id: true,
  createdAt: true,
});

export type InsertInternalSupportNote = z.infer<typeof insertInternalSupportNoteSchema>;
export type InternalSupportNote = typeof internalSupportNotes.$inferSelect;

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

// ============================================================================
// ENTITLEMENT SYSTEM — canonical feature/plan/override matrix (2026-04-19).
// Runs in parallel with legacy `tenant_features` boolean-column table; this
// is the forward source of truth for dynamic features + plan packaging.
// See migrations/2026_04_19_entitlement_system_schema.sql.
// ============================================================================

export const featureLimitTypeEnum = [
  "none",
  "count",
  "monthly_count",
  "seat_count",
  "storage_mb",
  "storage_gb",
  "branch_count",
  "per_user",
  "custom",
] as const;
export type FeatureLimitType = typeof featureLimitTypeEnum[number];

export const featureCategoryEnum = [
  "core",
  "users_team",
  "technician_app",
  "service_hvac",
  "sales_revenue",
  "integrations",
  "reporting",
  "communication",
  "scale_advanced",
] as const;
export type FeatureCategory = typeof featureCategoryEnum[number];

export const subscriptionFeatures = pgTable("subscription_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  featureKey: text("feature_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  limitType: text("limit_type").notNull().default("none"),
  isCore: boolean("is_core").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// feature_key is treated as immutable after creation (enforced in service layer).
// Admin UI does not expose an edit control for it. Only display_name /
// description / category / limit_type / metadata / active / is_core / sort_order
// are editable via the update schema.
export const insertSubscriptionFeatureSchema = createInsertSchema(subscriptionFeatures).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  featureKey: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, "feature_key must be lowercase snake_case"),
  category: z.enum(featureCategoryEnum),
  limitType: z.enum(featureLimitTypeEnum),
});

export const updateSubscriptionFeatureSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(featureCategoryEnum).optional(),
  limitType: z.enum(featureLimitTypeEnum).optional(),
  isCore: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export type InsertSubscriptionFeature = z.infer<typeof insertSubscriptionFeatureSchema>;
export type UpdateSubscriptionFeature = z.infer<typeof updateSubscriptionFeatureSchema>;
export type SubscriptionFeature = typeof subscriptionFeatures.$inferSelect;

export const subscriptionPlanFeatures = pgTable("subscription_plan_features", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "cascade" }),
  featureId: varchar("feature_id").notNull().references(() => subscriptionFeatures.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  limitValue: integer("limit_value"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  planFeatureUnique: uniqueIndex("subscription_plan_features_plan_feature_unique")
    .on(table.planId, table.featureId),
}));

export const upsertPlanFeatureSchema = z.object({
  enabled: z.boolean(),
  limitValue: z.number().int().min(0).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export type UpsertPlanFeatureInput = z.infer<typeof upsertPlanFeatureSchema>;
export type SubscriptionPlanFeature = typeof subscriptionPlanFeatures.$inferSelect;

export const tenantFeatureOverrides = pgTable("tenant_feature_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  featureId: varchar("feature_id").notNull().references(() => subscriptionFeatures.id, { onDelete: "cascade" }),
  enabled: boolean("enabled"),
  limitValue: integer("limit_value"),
  // 2026-04-20: discriminator for "is limit_value explicitly overridden?"
  //   true  → override.limitValue wins in the resolver; NULL here = unlimited
  //           for this tenant (matches the documented null-limit contract).
  //   false → resolver inherits limit from plan/core/default (backward-compat
  //           behavior — existing rows default to this).
  // See migrations/2026_04_20_entitlement_override_limit_flag.sql.
  limitOverridden: boolean("limit_overridden").notNull().default(false),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  companyFeatureUnique: uniqueIndex("tenant_feature_overrides_company_feature_unique")
    .on(table.companyId, table.featureId),
}));

export const upsertTenantOverrideSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  limitValue: z.number().int().min(0).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
}).refine(
  (d) => d.enabled !== undefined || d.limitValue !== undefined,
  { message: "Override must set at least one of enabled or limitValue" },
);

export type UpsertTenantOverrideInput = z.infer<typeof upsertTenantOverrideSchema>;
export type TenantFeatureOverride = typeof tenantFeatureOverrides.$inferSelect;

export const subscriptionPlanMetadata = pgTable("subscription_plan_metadata", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().unique().references(() => subscriptionPlans.id, { onDelete: "cascade" }),
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(false),
  annualPriceCents: integer("annual_price_cents"),
  trialEligible: boolean("trial_eligible").notNull().default(false),
  displayBadge: text("display_badge"),
  marketingSortOrder: integer("marketing_sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const upsertPlanMetadataSchema = z.object({
  description: z.string().max(4000).nullable().optional(),
  isPublic: z.boolean().optional(),
  annualPriceCents: z.number().int().min(0).nullable().optional(),
  trialEligible: z.boolean().optional(),
  displayBadge: z.string().max(60).nullable().optional(),
  marketingSortOrder: z.number().int().nullable().optional(),
});

export type UpsertPlanMetadataInput = z.infer<typeof upsertPlanMetadataSchema>;
export type SubscriptionPlanMetadata = typeof subscriptionPlanMetadata.$inferSelect;

// Plan CRUD schemas (extends existing subscription_plans table — no column additions)
export const createPlanSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, "plan name must be lowercase snake_case"),
  displayName: z.string().min(1).max(200),
  monthlyPriceCents: z.number().int().min(0).nullable().optional(),
  locationLimit: z.number().int().min(0),
  isTrial: z.boolean().optional(),
  trialDays: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const updatePlanSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  monthlyPriceCents: z.number().int().min(0).nullable().optional(),
  locationLimit: z.number().int().min(0).optional(),
  isTrial: z.boolean().optional(),
  trialDays: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// Job notes table - stores multiple timestamped notes per assignment with optional images
export const jobNotes = pgTable("job_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Optional link to specific equipment — enables equipment-scoped notes for future
  // equipment history reporting. Null = general job note, non-null = equipment-linked note.
  equipmentId: varchar("equipment_id").references(() => locationEquipment.id, { onDelete: "set null" }),
  noteText: text("note_text").notNull(),
  imageUrl: text("image_url"),
  // Offline replay idempotency — set by the client for queued notes, null otherwise.
  // DB enforces uniqueness per (company_id, idempotency_key) WHERE NOT NULL.
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
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
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "cascade" }),
  // Nullable: NULL = company-wide note, non-NULL = location-specific note
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "cascade" }),
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

// Files table — tenant-scoped file metadata.
// Phase 1 (2026-04-12): Cloudflare R2 is the canonical provider for new
// uploads. Existing rows from the legacy local-disk pipeline are preserved
// via storageProvider='local' and read through the same DTO. All blob data
// lives in the provider — Postgres holds metadata only.
export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // 'r2' for new uploads, 'local' for legacy disk rows. Read path branches on this.
  storageProvider: varchar("storage_provider").notNull().default("local"),
  // R2 bucket name (null for legacy local rows).
  bucket: varchar("bucket"),
  // For R2: full object key (`tenants/{t}/jobs/{j}/notes/{n}/{fileId}/{filename}`).
  // For local: relative path from project root. Same column, provider-specific meaning.
  storageKey: varchar("storage_key").notNull(),
  originalName: varchar("original_name"),
  mimeType: varchar("mime_type"),
  size: integer("size"),
  // Lifecycle: pending_upload → uploaded | failed → deleted (soft delete).
  status: varchar("status").notNull().default("uploaded"),
  // Coarse-grained classification derived from mime type at upload-request
  // time. Drives future filtering (gallery vs document) and analytics.
  // Clients do not set this — the server assigns it.
  category: varchar("category").notNull().default("other"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type FileRecord = typeof files.$inferSelect;

export const fileStatusEnum = ["pending_upload", "uploaded", "failed", "deleted"] as const;
export type FileStatus = (typeof fileStatusEnum)[number];

export const fileStorageProviderEnum = ["r2", "local"] as const;
export type FileStorageProvider = (typeof fileStorageProviderEnum)[number];

// Durable queue for post-delete R2 object cleanup.
export const fileCleanupQueue = pgTable("file_cleanup_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull(),
  bucket: varchar("bucket").notNull(),
  storageKey: varchar("storage_key").notNull(),
  storageProvider: varchar("storage_provider").notNull().default("r2"),
  sourceRef: varchar("source_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
});
export type FileCleanupQueueEntry = typeof fileCleanupQueue.$inferSelect;

// Kept intentionally open — new entity types will add categories without
// requiring an enum migration.
export const fileCategoryEnum = [
  "note_image",
  "note_pdf",
  "client_document",
  "contract_document",
  "technician_document",
  // 2026-04-14 Phase 1 cleanup: receipts attached to job_expenses migrated
  // off the legacy /api/uploads disk pipeline onto the canonical R2 flow.
  "job_expense_receipt",
  // 2026-05-13 Phase 0: nameplate photos uploaded for OCR processing.
  "equipment_nameplate",
  "other",
] as const;
export type FileCategory = (typeof fileCategoryEnum)[number] | string;

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

// ---------------------------------------------------------------------------
// Phase 2 file joins (2026-04-12): entity-specific bindings for the same
// canonical `files` table. Every row is tenant-scoped. Each join table is
// thin — the file metadata lives in `files`, these tables only express
// "which files are attached to which entity".
//
// NOTE: client_note uses the existing `note_attachments` table above. We do
// NOT add a second `client_note_files` table — that would be duplication of
// an already-working join.
// ---------------------------------------------------------------------------

/** Files attached directly to a client (location-level documents). */
export const clientFiles = pgTable("client_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});
export type ClientFile = typeof clientFiles.$inferSelect;

/** Files attached to a contract (recurring_job_templates acts as the contract entity). */
export const contractFiles = pgTable("contract_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contractId: varchar("contract_id").notNull().references(() => recurringJobTemplates.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});
export type ContractFile = typeof contractFiles.$inferSelect;

/** Files attached to a technician (users.role='technician' is enforced at the service boundary). */
export const technicianFiles = pgTable("technician_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  technicianId: varchar("technician_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});
export type TechnicianFile = typeof technicianFiles.$inferSelect;

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
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
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
  // 2026-05-03: canonical invoice title/summary. Short, editable, used
  // as the page-level header label. Distinct from workDescription
  // (long body) and from the linked job's summary (separate entity).
  summary: text("summary"),
  // Work description (copied from job description when invoice created from job)
  workDescription: text("work_description"), // Full job description / work performed
  // Client message (customer-facing message for invoice PDF/email)
  clientMessage: text("client_message"), // Customer-facing message
  // Client visibility toggles (controls what appears on client-facing invoice)
  // 2026-05-06: the five flags below are NULLABLE per migration
  // 2026_05_06_invoice_visibility_inherit.sql.
  //   NULL          → inherit the tenant Invoice Display default
  //                   (resolved by shared/invoiceDisplayPolicy.ts::pick)
  //   true / false  → explicit per-invoice override
  // Existing rows keep their pre-migration boolean values (no data
  // mutation) so legacy invoices behave exactly as before; new invoices
  // created after the migration leave these columns NULL and inherit.
  showQuantity: boolean("show_quantity"),
  showUnitPrice: boolean("show_unit_price"),
  showLineTotals: boolean("show_line_totals"),
  showLineItems: boolean("show_line_items"), // If false, client sees only subtotal/total
  showBalance: boolean("show_balance").notNull().default(true),
  // 2026-04-14: gate the work-description block on client-facing
  // surfaces (PDF + portal). 2026-05-06: nullable for tenant-default inheritance.
  showJobDescription: boolean("show_job_description"),
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
  // 2026-05-03: generalized email-send tracking. Bumped by every
  // outbound invoice email (manual or automated reminder). The
  // automated sweep worker reads these to gate cadence
  // (`first_delay_days` / `repeat_every_days`) — every send counts
  // toward the next cadence interval. Renamed from `last_reminder_at`
  // / `reminder_count` per migration 2026_05_03_rename_invoice_email_columns.
  lastEmailedAt: timestamp("last_emailed_at"),
  emailSendCount: integer("email_send_count").notNull().default(0),
  // Reminder pause / snooze remain reminder-specific — they only
  // affect the automated sweep worker. Manual "Email invoice" sends
  // ignore these flags.
  remindersPaused: boolean("reminders_paused").notNull().default(false),
  reminderSnoozeUntil: timestamp("reminder_snooze_until"),
  // Discount fields (Phase 11: Invoice Corrections + Discount Support)
  discountType: text("discount_type"), // "PERCENT" | "AMOUNT" | null (no discount)
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }), // e.g., 10.00 for 10%
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }), // Currency amount
  discountNotes: text("discount_notes"), // Optional reason/description for discount
  // 2026-05-13 Receivables Phase 2A: denormalized workflow-state fields for
  // fast view filtering. Written atomically by the receivablesNotes storage
  // layer; never via direct PATCH. Cleared when invoice transitions to "paid"
  // (see payment repository recalculateInvoiceBalance + applyMultiInvoicePayment).
  followUpAt: timestamp("follow_up_at"),           // user-scheduled next-action; NOT cleared on paid
  promisedPaymentAt: timestamp("promised_payment_at"), // set when promise_to_pay note created; cleared on paid
  isDisputed: boolean("is_disputed").notNull().default(false), // set when dispute note created; cleared on paid
  lastContactedAt: timestamp("last_contacted_at"),  // set when communication note created; used by no-recent-contact view
  // Status
  dirty: boolean("dirty").notNull().default(false), // True if edited after last sync (legacy)
  // 2026-04-09: isActive + deletedAt REMOVED — invoices use permanent-delete model.
  // The columns are dropped in migrations/2026_04_09_invoice_permanent_delete.sql.
  // Optimistic locking
  version: integer("version").notNull().default(0), // Incremented on every update
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // 2026-04-18 Phase 5/6 (multi-invoice-per-job): the old
  // `oneInvoicePerJob` partial unique index was the DB-level cardinality
  // enforcer that blocked a job from carrying more than one invoice.
  // Dropped in `migrations/2026_04_18_invoices_drop_job_uniqueness.sql`
  // and removed from the schema here so a future `drizzle-kit push`
  // cannot re-create it. Cardinality is now controlled by the
  // application layer (short-lived dedupe guard in
  // invoiceCreationService) and intentional business rules, NOT by the
  // FK/index topology.

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
  workDescription: z.string().nullable().optional(),
  // 2026-05-03: short editable invoice title. Distinct from
  // workDescription. Surfaces in the canonical detail header.
  summary: z.string().max(255).nullable().optional(),
  clientMessage: z.string().nullable().optional(),
  // 2026-05-06: nullable so the "Reset to tenant defaults" affordance on
  // the invoice detail page can PATCH `null` to clear the per-invoice
  // override. `null` → inherit tenant default at render time.
  // `showBalance` stays non-null — it gates a mandatory surface.
  showQuantity: z.boolean().nullable().optional(),
  showUnitPrice: z.boolean().nullable().optional(),
  showLineTotals: z.boolean().nullable().optional(),
  showLineItems: z.boolean().nullable().optional(),
  showBalance: z.boolean().optional(),
  showJobDescription: z.boolean().nullable().optional(),
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
  // 2026-04-09: isActive / deletedAt removed — invoices use permanent-delete model.
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
    // 2026-04-22: "imported" source tag added for canonical invoice import.
    // The column is text (not an enum) so this widening is a zod-layer-only
    // change — no migration. Lines tagged "imported" are catalog-exempt and
    // have null productId.
    source: z.enum(["manual", "job", "imported"]).default("manual"),

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

// ---------------------------------------------------------------------------
// Invoice notes — first-class threaded notes scoped to an invoice
// ---------------------------------------------------------------------------
//
// 2026-05-03: invoices previously had no notes table of their own. The
// `/api/invoices/:id/notes` GET endpoint borrowed entity-owned notes from
// the linked job (and fell back to the flat `invoices.notesInternal`
// column for no-job invoices). That coupled invoice notes to the job's
// lifecycle and broke for invoices created standalone (no jobId), which
// is a fully supported tenant workflow.
//
// This pair of tables (`invoice_notes` + `invoice_note_attachments`)
// mirrors the canonical per-entity pattern already used by job_notes,
// quote_notes, client_notes and lead_notes. Same shape, same FK
// behavior, same R2 attachment plumbing — extending the existing
// fileUploadService adapter map covers the upload pipeline. Invoice
// notes live and die with the invoice (cascade on delete), independent
// of any job. The legacy `notes_internal` / `notes_customer` columns
// on the invoices table have been dropped (migration 2026_05_14).
export const invoiceNotes = pgTable("invoice_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertInvoiceNoteSchema = createInsertSchema(invoiceNotes).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const updateInvoiceNoteSchema = z.object({
  noteText: z.string().optional(),
});

export type InsertInvoiceNote = z.infer<typeof insertInvoiceNoteSchema>;
export type UpdateInvoiceNote = z.infer<typeof updateInvoiceNoteSchema>;
export type InvoiceNote = typeof invoiceNotes.$inferSelect;

// Invoice note attachments — join table linking invoice notes to files.
// Mirrors `job_note_attachments` shape exactly so the fileUploadService
// adapter, the R2 object-key layout, and the read-side hydration are
// identical patterns to the job-note pipeline.
export const invoiceNoteAttachments = pgTable("invoice_note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  noteId: varchar("note_id").notNull().references(() => invoiceNotes.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type InvoiceNoteAttachment = typeof invoiceNoteAttachments.$inferSelect;

// 2026-04-14 Payments ledger foundation (Phase 1): paymentType enum +
// parent-payment self-reference so future refund/reversal rows can attach
// to the payment they offset. Stripe-compatible: Stripe Charge/Refund
// objects map 1:1 to paymentType='payment'/'refund' rows with
// reference=ch_.../re_... and parentPaymentId linking a refund to its
// charge. No Stripe code in this phase — schema foundation only.
export const paymentTypeEnum = ["payment", "refund", "reversal"] as const;
export type PaymentType = (typeof paymentTypeEnum)[number];

// Payments table - tracks payments against invoices
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // Denormalized for tenant isolation
  // 2026-05-03 multi-invoice payments (PR 1): nullable. Legacy 1:1
  // payments still set this column; multi-invoice payments will leave
  // it NULL and rely on `payment_allocations` (below). FK + cascade
  // behaviour preserved for legacy rows. The "either invoiceId IS NOT
  // NULL OR ≥1 payment_allocations row" invariant is enforced at the
  // repo / service write path, not by a DB CHECK.
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("other"), // cash, credit, debit, e-transfer, cheque, other
  reference: text("reference"), // Transaction ID, cheque number, etc.
  receivedAt: timestamp("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  // 2026-04-14 Ledger foundation. System-managed, never user-input:
  //   paymentType='payment' = money in (positive amount, no parent)
  //   paymentType='refund'  = money back (negative amount, parentPaymentId set)
  //   paymentType='reversal' = valid payment that didn't happen (NSF, bounced) — negative amount, parent set
  // CHECK constraints enforcing these shapes arrive in Phase 2 alongside
  // the refund/reversal creation path; for now all existing rows default
  // to paymentType='payment' with parentPaymentId=NULL.
  paymentType: text("payment_type").notNull().default("payment"),
  parentPaymentId: varchar("parent_payment_id").references((): any => payments.id, { onDelete: "restrict" }),
  // 2026-04-14 Payments Phase 3: provider-linked immutability + Stripe
  // readiness. Both fields are system-managed and must never be set
  // from user input (see `insertPaymentSchema.omit({...})` below).
  //
  //   providerSource='manual' — default. No external provider; fully
  //                             editable via the route.
  //   providerSource='qbo'    — row is owned by QuickBooks Online.
  //                             `qboPaymentId` carries the QBO object id.
  //   providerSource='stripe' — row mirrors a Stripe Charge or Refund.
  //                             `reference` carries the Stripe id
  //                             (`ch_...` or `re_...`); `providerEventId`
  //                             carries the webhook event id for dedupe.
  //
  // The canonical predicate `isProviderLinked` in
  // `server/lib/paymentPredicates.ts` recognizes both legacy
  // `qboPaymentId`-only rows and new `providerSource`-tagged rows.
  providerSource: text("provider_source").notNull().default("manual"),
  providerEventId: text("provider_event_id"),
  // 2026-05-03 PR1 (tenant-payments foundation): identifies which tenant
  // provider account processed this row. Nullable because:
  //   * `manual` / `qbo` rows have no provider account.
  //   * Pre-tenant-onboarding `stripe` rows that ran on the platform
  //     account also leave this NULL (will be backfilled or excluded
  //     from per-tenant payout reconciliation explicitly).
  // `paymentProviderAccountId` is the FK to our internal account row;
  // `providerAccountId` mirrors the provider's own opaque account id
  // (e.g. Stripe `acct_...`) for cross-reference in webhook payloads /
  // dashboard links without requiring a join. Both written together by
  // the future provider-aware payment writer.
  paymentProviderAccountId: varchar("payment_provider_account_id").references((): any => paymentProviderAccounts.id, { onDelete: "set null" }),
  providerAccountId: text("provider_account_id"),
  // 2026-04-09: Outbound QBO payment sync fields. Mirror the convention used
  // on customer_companies / items / invoices. None of these are mutated by the
  // canonical local payment writer (paymentRepository.recalculateInvoiceBalance);
  // they are written ONLY by the QBO payment sync service after a successful
  // QBO POST. Locked product decision #6: invoice financial state remains
  // controlled by the canonical local writer; QBO sync never mutates it.
  qboPaymentId: text("qbo_payment_id"), // QBO Payment.Id, set on first successful create
  qboSyncToken: text("qbo_sync_token"), // QBO Payment.SyncToken (required for updates)
  qboSyncStatus: text("qbo_sync_status").notNull().default("NOT_SYNCED"), // NOT_SYNCED | SYNCED | PENDING | ERROR
  qboSyncError: text("qbo_sync_error"), // Last sync error message, cleared on next successful sync
  qboLastSyncedAt: timestamp("qbo_last_synced_at"), // Last successful sync timestamp
}, (table) => ({
  // 2026-04-14 Phase 1 next-frontier: duplicate-payment guard. When a user
  // provides a reference (cheque number, txn id, receipt id), two rows
  // with the same (tenant, invoice, reference) are rejected at the DB.
  // Cash/other entries without a reference are NOT constrained — those
  // are typically entered in-person and a rare double-submit is handled
  // manually. Partial index so null/blank references do not collide.
  referenceDedupeUq: uniqueIndex("payments_company_invoice_reference_uq")
    .on(table.companyId, table.invoiceId, table.reference)
    .where(sql`reference IS NOT NULL AND reference <> ''`),
  // 2026-04-14 Payments Phase 2: refund/reversal dedupe scoped to the
  // parent payment. Catches webhook-replay or double-submit on a
  // provider-issued refund id. Pairs with the existing invoice-wide
  // constraint above; both must hold. Only applies to rows that
  // actually carry a parent id and a non-empty reference.
  parentReferenceDedupeUq: uniqueIndex("payments_company_parent_reference_uq")
    .on(table.companyId, table.parentPaymentId, table.reference)
    .where(sql`parent_payment_id IS NOT NULL AND reference IS NOT NULL AND reference <> ''`),
  // 2026-04-14 Payments Phase 2: ledger shape invariant. Every row is
  // EITHER a payment (positive amount, no parent) OR a refund/reversal
  // (negative amount, parent set). Enforces single-source-of-truth on
  // the paymentType enum + amount sign + parent presence in one rule.
  ledgerShapeChk: check(
    "payments_ledger_shape_chk",
    sql`(payment_type = 'payment' AND amount > 0 AND parent_payment_id IS NULL)
        OR
        (payment_type IN ('refund', 'reversal') AND amount < 0 AND parent_payment_id IS NOT NULL)`,
  ),
  // 2026-04-14 Payments Phase 3: provider-source enum enforcement.
  providerSourceChk: check(
    "payments_provider_source_chk",
    sql`provider_source IN ('manual', 'qbo', 'stripe')`,
  ),
  // 2026-04-14 Payments Phase 3: future-facing webhook-replay guard.
  // Blocks duplicate Stripe (or future QBO) webhook events at the DB
  // when `provider_event_id` is populated. No-op for today's rows
  // (provider_event_id defaults to NULL).
  providerEventIdUq: uniqueIndex("payments_provider_event_id_uq")
    .on(table.companyId, table.providerSource, table.providerEventId)
    .where(sql`provider_event_id IS NOT NULL`),
}));

export const paymentProviderSourceEnum = ["manual", "qbo", "stripe"] as const;
export type PaymentProviderSource = (typeof paymentProviderSourceEnum)[number];

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  // 2026-04-09: QBO sync fields are system-managed by the QBO payment sync
  // service. They must never be set via user input — that's how the canonical
  // local writer / QBO writer separation is enforced at the validation layer.
  qboPaymentId: true,
  qboSyncToken: true,
  qboSyncStatus: true,
  qboSyncError: true,
  qboLastSyncedAt: true,
  // 2026-04-14 Ledger foundation: paymentType + parentPaymentId are
  // system-managed. The canonical createPayment writer always inserts
  // paymentType='payment' via the DB default; Phase 2 refund/reversal
  // methods write the other values from server-side logic only.
  paymentType: true,
  parentPaymentId: true,
  // 2026-04-14 Payments Phase 3: providerSource + providerEventId are
  // system-managed. `providerSource` defaults to 'manual' via the DB;
  // QBO sync service sets 'qbo'; future Stripe writer will set
  // 'stripe' along with the webhook event id. Never accepted from user
  // input — that's how the canonical writer/provider separation is
  // enforced at the validation layer.
  providerSource: true,
  providerEventId: true,
  // 2026-05-03 PR1 (tenant-payments foundation): provider-account
  // attribution. Set by the future provider-aware payment writer
  // (resolves the active `payment_provider_accounts` row for the tenant
  // and stamps both fields together). Never user input — that's how the
  // canonical-writer / provider-account separation is enforced at the
  // validation layer.
  paymentProviderAccountId: true,
  providerAccountId: true,
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

// ============================================================================
// PAYMENT ALLOCATIONS (Multi-invoice payments — PR1, 2026-05-03)
// ============================================================================
// One payment can be allocated across many invoices (e.g. customer pays
// 3 outstanding invoices in a single Stripe checkout). This junction
// table captures how a payment row's gross `amount` was split across
// the invoices it paid.
//
// Co-existence with the legacy 1:1 model:
//   • Legacy single-invoice payments: `payments.invoice_id` is set,
//     and the row has ZERO `payment_allocations` entries. Read code
//     can treat `payments.invoice_id` as the canonical attribution.
//   • Modern multi-invoice payments: `payments.invoice_id` is NULL,
//     and the row has ≥1 `payment_allocations` entries. Each
//     allocation row carries the slice of the payment applied to a
//     specific invoice.
//
// See `migrations/2026_05_03_payment_allocations.sql` for the SQL.
// The "either FK or allocations, never both, never neither" invariant
// is enforced at the repo write path (not via a DB CHECK because the
// cross-table predicate is awkward to express).
export const paymentAllocations = pgTable("payment_allocations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  paymentId: varchar("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  // RESTRICT (not CASCADE) — once an invoice has been paid, deleting
  // the invoice should not silently destroy the payment-attribution
  // record. The hard-delete path on invoices already blocks delete
  // when payments exist; this index just makes that cross-table
  // safety symmetric.
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "restrict" }),
  allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  // At most one allocation row per (payment, invoice) pair. Top-up
  // semantics use UPDATE on the existing row, never INSERT a second.
  paymentInvoiceUq: uniqueIndex("payment_allocations_payment_invoice_uq")
    .on(table.paymentId, table.invoiceId),
  // Per-invoice lookup for "how much has been allocated to this
  // invoice across all payments". Tenant-scoped because every legit
  // query is.
  invoiceLookupIdx: index("payment_allocations_invoice_idx")
    .on(table.companyId, table.invoiceId),
}));

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocations).omit({
  id: true,
  createdAt: true,
});
export type InsertPaymentAllocation = z.infer<typeof insertPaymentAllocationSchema>;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;

// ============================================================================
// PAYMENT METHODS — saved-card foundation (PR A, 2026-05-03)
// ============================================================================
//
// One row per saved card, tenant + customer-company scoped. Stores ONLY the
// metadata the payment provider returns (card_brand / last4 / exp_*). Raw
// card numbers + CVV NEVER touch this table.
//
// Provider-neutral by design: `provider_source` carries which adapter wrote
// the row (`stripe` for now); column names use `provider_*` so a future
// non-Stripe adapter (Adyen, Square, etc.) writes to the same table without
// a schema migration.
//
// Invariants (mirrored by indexes — see migration 2026_05_03_payment_methods.sql):
//   * `(company_id, provider_source, provider_payment_method_id)` UNIQUE —
//     webhook replay collides on this index, the application service
//     classifies SQLSTATE 23505 as "replay" + ACKs 200 (same idempotency
//     contract `payments_provider_event_id_uq` established in PR 1).
//   * At most ONE active default per (tenant, customer-company) — partial
//     unique index excludes detached rows so soft-deleting the old default
//     doesn't block setting a new one.
//
// Lifecycle:
//   * `consent_at` / `consent_text` / `consent_ip` / `consent_user_agent`
//     captured at save-time → auditable when a regulator asks "what did
//     the customer agree to?".
//   * `detached_at` is soft-delete; the provider-side detach happens at the
//     same time so future charges fail at the provider, while the local row
//     stays for forensic queries.
export const paymentMethods = pgTable("payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),

  // Provider attribution — opaque tokens the provider issued.
  providerSource: text("provider_source").notNull(),
  providerCustomerId: text("provider_customer_id").notNull(),
  providerPaymentMethodId: text("provider_payment_method_id").notNull(),

  // Card metadata mirrored from the provider PaymentMethod object.
  // SAFE to mirror locally — the customer already sees these on their
  // statement. Raw PAN + CVV stay at the provider.
  cardBrand: text("card_brand").notNull(),
  cardLast4: text("card_last4").notNull(),
  cardExpMonth: integer("card_exp_month").notNull(),
  cardExpYear: integer("card_exp_year").notNull(),
  cardFunding: text("card_funding"),
  cardCountry: text("card_country"),

  isDefault: boolean("is_default").notNull().default(false),

  // Consent capture — see header note. NOT NULL on `consent_at` +
  // `consent_text` so every row carries auditable proof of authorization.
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  consentText: text("consent_text").notNull(),
  consentIp: text("consent_ip"),
  consentUserAgent: text("consent_user_agent"),
  createdByContactId: varchar("created_by_contact_id").references(() => contactPersons.id, { onDelete: "set null" }),

  // Soft-delete bookkeeping. `detached_at IS NULL` = active.
  detachedAt: timestamp("detached_at", { withTimezone: true }),
  detachedByContactId: varchar("detached_by_contact_id").references(() => contactPersons.id, { onDelete: "set null" }),
  detachReason: text("detach_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => ({
  // Webhook replay anchor.
  providerPmUq: uniqueIndex("payment_methods_provider_pm_uq")
    .on(table.companyId, table.providerSource, table.providerPaymentMethodId),
  // At-most-one active default.
  oneDefaultPerCustomer: uniqueIndex("payment_methods_one_default_per_customer")
    .on(table.companyId, table.customerCompanyId)
    .where(sql`is_default = true and detached_at is null`),
  // Hot-path lookup for the portal "list my saved cards" screen.
  lookupIdx: index("payment_methods_lookup_idx")
    .on(table.companyId, table.customerCompanyId, table.detachedAt),
}));

// `provider_source`, `provider_customer_id`, `provider_payment_method_id`,
// `card_*`, `consent_*`, `created_by_contact_id` are all required on insert.
// `id` / timestamps default at the DB; `is_default` defaults false; the
// `detach_*` columns are populated only at delete-time.
// Naming note: the enum at line ~1628 already owns `PaymentMethod` (the
// payments-table `method` enum: cash | credit | …). The saved-card row
// type uses `SavedPaymentMethod` to avoid the collision and to make the
// "this is the saved-card concept, not the payments.method enum"
// distinction unambiguous to readers.
export const insertSavedPaymentMethodSchema = createInsertSchema(paymentMethods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  detachedAt: true,
  detachedByContactId: true,
  detachReason: true,
});
export type InsertSavedPaymentMethod = z.infer<typeof insertSavedPaymentMethodSchema>;
export type SavedPaymentMethod = typeof paymentMethods.$inferSelect;

// ============================================================================
// PAYMENT WEBHOOK EVENTS (Payment Ops Dashboard — PR1, 2026-04-22)
// ============================================================================
// Persistent log of inbound provider-webhook deliveries. Provider-neutral
// column names so any adapter (Stripe today, future Square/etc.) writes
// to the same table. Mirrors the qbo_webhook_events pattern in spirit:
// one row per natural event-key with UPSERT semantics on replay.
//
// This table is a DIAGNOSTIC sidecar — the canonical payment ledger is
// still `payments`. The log answers operator questions ("which webhooks
// were 500'd last hour?", "show config-drift events for tenant X") that
// the ledger can't by itself. Writes are best-effort: a log-write
// failure must never block the real webhook decision.
//
// Redaction: `raw_metadata` is an ALLOWLIST of our own metadata keys
// (companyId, invoiceId, invoiceNumber, prospectivePaymentId,
// refundLedgerId, source). No Stripe-native payload fields are stored
// here — those could carry customer PII (emails, addresses, card-last4)
// and are not needed for ops triage.
export const paymentWebhookEventKindEnum = [
  "payment_succeeded",
  // 2026-05-03 multi-invoice payments: one Stripe Checkout Session ⇒
  // one payment row + N allocations. Distinct from `payment_succeeded`
  // so ops can filter / alert on multi-invoice flow specifically.
  "multi_invoice_payment_succeeded",
  // 2026-05-03 PR B — saved-card foundation. Stripe
  // `payment_method.attached` events that carry our save-card consent
  // metadata land in `payment_methods`. Distinct kind so ops can
  // filter / alert on save-card-specific failures separately from
  // payment failures.
  "payment_method_attached",
  "payment_failed",
  "refund_created",
  // 2026-05-03 PR2 — tenant payments onboarding. Stripe Connect
  // `account.updated` lifecycle events land under this kind so ops
  // can filter / alert on onboarding-state regressions (e.g. a
  // `restricted` flip after a payouts-disable) separately from
  // payment-flow failures.
  "account_updated",
  // 2026-05-04 PR5 — payout lifecycle. One kind per Stripe payout
  // event so ops dashboards can graph each transition independently
  // (e.g. failure spike, in_transit-to-paid lag). The matching
  // handler in paymentApplicationService folds all five back into a
  // single `paymentPayoutsRepository.upsertFromProviderEvent` call.
  "payout_created",
  "payout_updated",
  "payout_paid",
  "payout_failed",
  "payout_canceled",
  // 2026-05-04 PR6 — dispute / chargeback lifecycle. Three kinds map
  // to Stripe's `charge.dispute.created / .updated / .closed`. The
  // matching handler folds all three through
  // `paymentDisputesRepository.upsertFromProviderEvent` keyed on
  // `(provider, provider_dispute_id)`.
  "dispute_created",
  "dispute_updated",
  "dispute_closed",
  "unsupported",
  "signature_failed",
] as const;
export type PaymentWebhookEventKind =
  (typeof paymentWebhookEventKindEnum)[number];

export const paymentWebhookEventOutcomeEnum = [
  "accepted",         // handler wrote the canonical ledger row
  "replayed",         // redelivery of an already-recorded event (200 ACK)
  "ignored",          // terminal event the dispatcher intentionally does not act on
  "config_error",     // metadata drift / tenant mismatch; 200 ACK, no row
  "transient_failure",// DB / network / unexpected error; 500, Stripe retries
  "signature_failed", // payload did not pass signature verification; 400
] as const;
export type PaymentWebhookEventOutcome =
  (typeof paymentWebhookEventOutcomeEnum)[number];

export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    // Provider id of the adapter that produced this event ('stripe' today).
    providerId: text("provider_id").notNull(),
    // Provider's own event id (Stripe evt_...). Nullable because signature
    // failures happen BEFORE the event can be parsed.
    providerEventId: text("provider_event_id"),
    // Raw provider event type string (e.g. 'payment_intent.succeeded'),
    // preserved for grep-ability when debugging unusual deliveries.
    eventType: text("event_type"),
    // Normalized kind used by the dispatcher.
    eventKind: text("event_kind").notNull(),
    outcome: text("outcome").notNull(),
    // HTTP status we returned to the provider. Lets operators answer
    // "was Stripe told to retry?" without replaying container logs.
    httpStatus: integer("http_status").notNull(),
    // Resolved tenant context when available. Null for signature failures
    // and config drift where we couldn't determine the tenant safely.
    companyId: varchar("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    invoiceId: varchar("invoice_id"),
    parentPaymentId: varchar("parent_payment_id"),
    // Provider-level ids for cross-reference with the provider dashboard.
    providerPaymentId: text("provider_payment_id"),
    providerRefundId: text("provider_refund_id"),
    amountCents: integer("amount_cents"),
    errorMessage: text("error_message"),
    // Allowlist-redacted metadata. See service-layer logger for the
    // allowlist. NEVER the full provider event payload.
    rawMetadata: jsonb("raw_metadata"),
    // Natural dedupe key — `{providerId}:{eventId}` for payment/unsupported,
    // `{providerId}:{eventId}:{refundId}` for refund sub-events. Null for
    // signature failures (no stable key exists pre-verification).
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    dedupeKeyUq: uniqueIndex("payment_webhook_events_dedupe_key_uq")
      .on(table.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    companyReceivedIdx: index("payment_webhook_events_company_received_idx")
      .on(table.companyId, table.receivedAt),
    outcomeReceivedIdx: index("payment_webhook_events_outcome_received_idx")
      .on(table.outcome, table.receivedAt),
    providerEventIdx: index("payment_webhook_events_provider_event_idx")
      .on(table.providerId, table.providerEventId),
  }),
);

export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;

// ============================================================================
// PAYMENT RECONCILIATION PENDING — removed 2026-04-22 (rollback)
// ============================================================================
// The sidecar reconciliation queue was removed along with the platform
// ops dashboard. The HTTP 202 `reconciliation_pending` contract on the
// refund route is preserved; operators rely on the
// `[payments-refund] CRITICAL ledger_write_failed_after_provider_success`
// log line plus the provider webhook's automatic ledger backfill.
// See migrations/2026_04_22_rollback_payment_ops_tables.sql for the DB
// drop statement (apply only where the forward migration ran).

// ============================================================================
// TENANT PAYMENT PROVIDER FOUNDATION — PR1 (2026-05-03)
// ============================================================================
// Schema-only foundation for tenant-owned payment collection (Stripe
// Connect-style onboarding, payouts, disputes). NO behavior change in
// this PR — the resolver, adapter, webhook handlers, and UI all keep
// running on the existing platform-account path. PR2+ wires service
// logic on top of these tables.
//
// Provider-neutral by design:
//   * Column names use `provider_*` (not `stripe_*`) so a future
//     non-Stripe adapter (Adyen, Square, etc.) writes to the same
//     tables without a schema migration.
//   * `provider` text column carries the adapter id (today only
//     `stripe` is meaningful — see `paymentProviderEnum` below).
//   * Stripe-specific opaque tokens live in `provider_account_id` /
//     `provider_payout_id` / `provider_dispute_id` — the columns are
//     untyped from our perspective; the adapter validates shape.

// Provider-neutral enum of currently-supported payment-collection
// adapters. Today only `stripe` is shippable; the array exists so future
// adapter additions are a one-line change.
export const paymentProviderEnum = ["stripe"] as const;
export type PaymentProvider = (typeof paymentProviderEnum)[number];

// Lifecycle of the tenant's connected provider account. Mirrors the
// states every Connect-style provider exposes (Stripe `charges_enabled`
// + `payouts_enabled` + `requirements`-driven gating roll up into one
// of these). Provider-specific raw status is preserved on the row in
// case operators need to reconcile divergence.
//   * not_started  — row exists but `provider_account_id` is NULL
//                    (we've reserved a local slot, no provider call yet).
//   * pending      — provider account created; tenant has not finished
//                    onboarding (requirements_due non-empty).
//   * active       — charges_enabled = true AND payouts_enabled = true.
//   * restricted   — charges_enabled = true but payouts_enabled = false
//                    (tenant can collect, can't be paid out yet).
//   * disabled     — provider has disabled the account; see
//                    `disabled_reason` for the human-readable cause.
export const paymentProviderAccountStatusEnum = [
  "not_started",
  "pending",
  "active",
  "restricted",
  "disabled",
] as const;
export type PaymentProviderAccountStatus =
  (typeof paymentProviderAccountStatusEnum)[number];

// Payout lifecycle. Aligns with the canonical Stripe Payout statuses
// (pending → in_transit → paid, plus failed/canceled terminal states).
// `raw_provider_status` on the row preserves the verbatim provider
// string when it's something more granular than this normalized enum.
export const paymentPayoutStatusEnum = [
  "pending",
  "in_transit",
  "paid",
  "failed",
  "canceled",
] as const;
export type PaymentPayoutStatus = (typeof paymentPayoutStatusEnum)[number];

// Dispute / chargeback lifecycle. Covers both hard disputes (which
// require evidence + a win/lose outcome) and early-warning fraud
// notifications (Stripe `radar.early_fraud_warning` style — the
// `warning_*` triplet). `raw_provider_status` preserves the verbatim
// provider string.
//   * needs_response          — operator action required (evidence)
//   * under_review            — evidence submitted, provider deciding
//   * won / lost              — terminal outcomes
//   * warning_needs_response  — early-warning, no money moved yet
//   * warning_under_review    — early-warning, provider deciding
//   * warning_closed          — early-warning resolved, no escalation
//   * closed                  — terminal "no further action" catch-all
export const paymentDisputeStatusEnum = [
  "needs_response",
  "under_review",
  "won",
  "lost",
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "closed",
] as const;
export type PaymentDisputeStatus =
  (typeof paymentDisputeStatusEnum)[number];

// ----------------------------------------------------------------------------
// payment_provider_accounts — one row per (tenant, provider).
// ----------------------------------------------------------------------------
// Replaces the never-shipped `companies.stripe_connected_account_id`
// shortcut. Putting account state in its own table means:
//   1. Future multi-provider tenants get one row per provider (no
//      column explosion on `companies`).
//   2. Lifecycle metadata (`charges_enabled`, `payouts_enabled`,
//      `requirements_due`) lives next to the FK that owns it.
//   3. `payment_payouts` and `payment_disputes` can FK directly to the
//      account row, so a delete-the-account path doesn't have to
//      cascade through `companies`.
//
// `provider_account_id` is nullable because PR2 will create the local
// row in `not_started` state BEFORE the provider's
// `accounts.create` call. If the provider call fails, the local row
// stays around as a retry slot.
export const paymentProviderAccounts = pgTable(
  "payment_provider_accounts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // Opaque provider-issued account id (Stripe `acct_...`). Nullable
    // until the provider's `accounts.create` call returns successfully.
    providerAccountId: text("provider_account_id"),
    status: text("status").notNull().default("not_started"),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    // Provider-specific structured requirements payload — Stripe returns
    // a nested object with `currently_due` / `eventually_due` /
    // `past_due` / `pending_verification` arrays. We mirror it whole as
    // JSONB so the onboarding UI can render the live remediation list
    // without a second provider round-trip.
    requirementsDue: jsonb("requirements_due"),
    disabledReason: text("disabled_reason"),
    defaultCurrency: text("default_currency"),
    country: text("country"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // One account per (tenant, provider). A tenant cannot have two
    // Stripe accounts; if they switch providers they get a NEW row for
    // the new provider while the old one stays for historical lookup.
    companyProviderUq: uniqueIndex("payment_provider_accounts_company_provider_uq")
      .on(table.companyId, table.provider),
    // Webhook resolver hot path: incoming `account.updated` events
    // arrive with `acct_...` and need to find their owning row fast.
    // Partial because rows in `not_started` state legitimately have
    // NULL `provider_account_id`.
    providerAccountIdIdx: index("payment_provider_accounts_provider_account_id_idx")
      .on(table.provider, table.providerAccountId),
  }),
);

export const insertPaymentProviderAccountSchema = createInsertSchema(
  paymentProviderAccounts,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentProviderAccount = z.infer<
  typeof insertPaymentProviderAccountSchema
>;
export type PaymentProviderAccount =
  typeof paymentProviderAccounts.$inferSelect;

// ----------------------------------------------------------------------------
// payment_payouts — provider payout lifecycle.
// ----------------------------------------------------------------------------
// One row per provider payout event (Stripe `payout.created /
// .updated / .paid / .failed`). Tracks the provider's own settlement
// of funds from the connected account → tenant bank account. We do
// NOT initiate payouts ourselves; we mirror what the provider tells us.
//
// `payment_provider_account_id` (FK) and `provider_account_id` (text
// mirror) are stored together — same pattern as the `payments` table.
// Lookup-by-FK for our queries; lookup-by-`acct_...` for cross-
// reference with the provider dashboard without a join.
export const paymentPayouts = pgTable(
  "payment_payouts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    paymentProviderAccountId: varchar("payment_provider_account_id")
      .notNull()
      .references(() => paymentProviderAccounts.id, { onDelete: "restrict" }),
    providerAccountId: text("provider_account_id").notNull(),
    // Opaque provider-issued payout id (Stripe `po_...`). Nullable for
    // local-only rows queued before a provider call (rare, but the
    // schema permits it for symmetry with `payment_provider_accounts`).
    providerPayoutId: text("provider_payout_id"),
    // Same convention as `payments.amount` — numeric(12,2), tenant
    // currency stored separately in `currency`. Sign convention: always
    // positive (payout is money LEAVING the connected account, but we
    // record the gross transferred-to-bank amount). `failure_*` fields
    // explain reversals; we don't model them as negative-amount rows.
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    arrivalDate: timestamp("arrival_date", { withTimezone: true }),
    destinationLast4: text("destination_last4"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    rawProviderStatus: text("raw_provider_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Webhook replay anchor — same pattern as
    // `payments.providerEventIdUq` / `payment_methods.providerPmUq`.
    // Partial because `provider_payout_id` is nullable for the
    // edge-case local-only row.
    providerPayoutIdUq: uniqueIndex("payment_payouts_provider_payout_id_uq")
      .on(table.provider, table.providerPayoutId)
      .where(sql`provider_payout_id IS NOT NULL`),
    // Tenant + recency index — drives the future "Payouts" dashboard
    // listing.
    companyArrivalIdx: index("payment_payouts_company_arrival_idx")
      .on(table.companyId, table.arrivalDate),
    // Per-account drilldown index.
    accountIdx: index("payment_payouts_account_idx")
      .on(table.paymentProviderAccountId),
  }),
);

export const insertPaymentPayoutSchema = createInsertSchema(paymentPayouts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentPayout = z.infer<typeof insertPaymentPayoutSchema>;
export type PaymentPayout = typeof paymentPayouts.$inferSelect;

// ----------------------------------------------------------------------------
// payment_disputes — chargeback / dispute lifecycle.
// ----------------------------------------------------------------------------
// One row per provider dispute event (Stripe `charge.dispute.created /
// .updated / .closed`, plus `radar.early_fraud_warning.*` for the
// `warning_*` enum members).
//
// `payment_id` and `invoice_id` are nullable because:
//   * Webhook arrives BEFORE local payment row is written (race
//     against `charge.refunded` ordering): disputes resolver creates
//     the dispute row with NULL refs and backfills on next match.
//   * Standalone disputes opened from the provider dashboard for
//     payments not yet in our ledger.
// `provider_payment_id` (Stripe `ch_...`) is non-nullable so the
// dispute row always carries enough context to backfill.
export const paymentDisputes = pgTable(
  "payment_disputes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    paymentId: varchar("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    invoiceId: varchar("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    paymentProviderAccountId: varchar("payment_provider_account_id")
      .notNull()
      .references(() => paymentProviderAccounts.id, { onDelete: "restrict" }),
    providerAccountId: text("provider_account_id").notNull(),
    // Opaque provider-issued dispute id (Stripe `dp_...` /
    // `du_...` for unhandled types). Nullable to symmetry-match the
    // payouts table; in practice every dispute has one.
    providerDisputeId: text("provider_dispute_id"),
    // Stripe `ch_...` — the charge being disputed. Always populated;
    // it's how we backfill `payment_id` later if the local row arrives
    // out of order.
    providerPaymentId: text("provider_payment_id").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    // Provider's reason code (Stripe: `fraudulent`, `product_not_received`,
    // `duplicate`, …). Free text because the enum varies per provider.
    reason: text("reason"),
    // Provider deadline for evidence submission. NULL for warnings
    // (which don't accept evidence).
    evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
    rawProviderStatus: text("raw_provider_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // Webhook replay anchor.
    providerDisputeIdUq: uniqueIndex("payment_disputes_provider_dispute_id_uq")
      .on(table.provider, table.providerDisputeId)
      .where(sql`provider_dispute_id IS NOT NULL`),
    // Tenant + recency index — drives the future "Disputes" dashboard.
    companyCreatedIdx: index("payment_disputes_company_created_idx")
      .on(table.companyId, table.createdAt),
    // Backfill helper: when a payment row arrives after its dispute,
    // the resolver looks up open disputes by `provider_payment_id` and
    // wires `payment_id` / `invoice_id` in.
    providerPaymentIdIdx: index("payment_disputes_provider_payment_id_idx")
      .on(table.provider, table.providerPaymentId),
  }),
);

export const insertPaymentDisputeSchema = createInsertSchema(paymentDisputes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentDispute = z.infer<typeof insertPaymentDisputeSchema>;
export type PaymentDispute = typeof paymentDisputes.$inferSelect;

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
// ASSIGNMENT is DERIVED (not stored on the job):
// - "assigned" state is derived from visits: any visit with a non-empty
//   job_visits.assigned_technician_ids (2026-04-12 Option A — jobs no
//   longer own technician assignment)
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
 * Assignment shape carried by a visit. Jobs no longer own assignment;
 * assignment is derived exclusively from their visits.
 */
export type VisitCrewRef = {
  assignedTechnicianIds?: string[] | null;
};

/**
 * A job is "assigned" iff at least one of its visits has at least one
 * technician in the crew. No fallback to job-level fields — those fields
 * are quiescent and are not read anywhere.
 *
 * 2026-04-12 (Option A): rewritten from reading job.primaryTechnicianId /
 * job.assignedTechnicianIds to reading visit crews. Jobs are containers only.
 */
export function isJobAssigned(visits: VisitCrewRef[] | null | undefined): boolean {
  if (!visits) return false;
  for (const v of visits) {
    if (Array.isArray(v.assignedTechnicianIds) && v.assignedTechnicianIds.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Derive the technician crew for a job from its visits. Returns the
 * deduplicated, stably-sorted set of all technician IDs that appear on any
 * visit, and a `varies` flag indicating whether crews differ across visits
 * that actually have crew members.
 *
 * Rules:
 *  - dedupe by technician id
 *  - stable lexicographic sort of ids (deterministic across renders)
 *  - `varies` = true iff 2+ visits have crews and their crew sets differ
 *  - visits with no crew are ignored for the `varies` computation
 */
export function deriveJobCrew(visits: VisitCrewRef[] | null | undefined): {
  uniqueTechnicianIds: string[];
  varies: boolean;
} {
  if (!visits || visits.length === 0) {
    return { uniqueTechnicianIds: [], varies: false };
  }
  const union = new Set<string>();
  const crewsSeen: string[] = [];
  for (const v of visits) {
    const crew = Array.isArray(v.assignedTechnicianIds) ? v.assignedTechnicianIds.filter(Boolean) : [];
    if (crew.length === 0) continue;
    for (const id of crew) union.add(id);
    // canonical signature for this visit's crew (sorted, joined)
    crewsSeen.push([...crew].sort().join(","));
  }
  let varies = false;
  if (crewsSeen.length >= 2) {
    const first = crewsSeen[0];
    varies = crewsSeen.some((sig) => sig !== first);
  }
  return {
    uniqueTechnicianIds: Array.from(union).sort(),
    varies,
  };
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
  parts:    "Needs Parts",
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
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  // Job identification
  jobNumber: integer("job_number").notNull(),
  // 2026-04-12 (Option A): jobs no longer own technician assignment.
  // Canonical source is job_visits.assigned_technician_ids. See migration
  // 2026_04_12_drop_job_tech_assignment.sql and CHANGELOG.
  // Status and classification (4-value lifecycle model)
  // See shared/schema.ts jobStatusEnum for valid values: open, completed, invoiced, archived
  status: text("status").notNull().default("open"),
  // Workflow sub-status (only valid when status = 'open')
  // See shared/schema.ts openSubStatusEnum: in_progress, on_hold, on_route
  openSubStatus: text("open_sub_status"),
  holdReason: text("hold_reason"), // Required when openSubStatus = "on_hold" (parts, customer, access, approval, weather, other)
  priority: text("priority").notNull().default("medium"),
  jobType: text("job_type").default("maintenance"), // Nullable: tech-created jobs may omit type
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
  // Billing.
  // 2026-04-18 Phase 5 (multi-invoice-per-job): `invoiceId` is now the
  // **primary invoice pointer** for the job, NOT a cardinality guard.
  // Many invoices may reference a job via `invoices.jobId`; this column
  // names the preferred / first-created one for back-compat singular
  // readers. Populated by `createInvoiceFromJob` only when the job has
  // no invoices yet; preserved across subsequent invoice creations.
  // Cleared automatically (onDelete: 'set null') if the primary invoice
  // is deleted. No automatic re-assignment to a sibling invoice — by
  // design; re-assignment can be explicit in a later phase if needed.
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
  // Lead attribution — links job to originating lead for pipeline/commission tracking
  leadId: varchar("lead_id"),
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
  // 2026-04-12 (Option A): jobs_technician_schedule_idx dropped along with
  // primary_technician_id. Tech-filtered queries now JOIN job_visits and hit
  // idx_job_visits_job_company_active.
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
  jobType: z.enum(jobTypeEnum).nullable().optional(), // Nullable: tech-created jobs may omit type
  // Scheduling fields
  scheduledStart: z.string().nullable().optional(), // Accept ISO string
  scheduledEnd: z.string().nullable().optional(),
  isAllDay: z.boolean().optional(), // All-day event flag
  durationMinutes: z.number().int().min(0).optional(), // Duration in minutes (for scheduling)
  // Hold state fields
  holdNotes: z.string().nullable().optional(),
  nextActionDate: z.string().nullable().optional(), // Accept ISO date string (YYYY-MM-DD)
  // 2026-04-23: Write-only passthrough for the seed visit's crew. The
  // `jobs` table lost its `assigned_technician_ids` column on 2026-04-12
  // (crew moved to `job_visits`); this field was never re-added to the
  // insert schema, so Zod silently stripped it from POST /api/jobs and
  // Quick Create created unassigned visits. storage.createJob already
  // reads and forwards this to the seed visit (see
  // server/storage/jobs.ts:587-590); declaring it here just stops
  // strip-mode from eating the value on the way in.
  assignedTechnicianIds: z.array(z.string().uuid()).nullable().optional(),
});

export const updateJobSchema = z.object({
  // Editable job number — integer, positive, no decimals
  jobNumber: z.number().int().positive().optional(),
  locationId: z.string().optional(),
  // 2026-04-12 (Option A): job-level technician fields removed from the
  // update contract. Assignment lives on visits. Legacy callers sending
  // these fields are tolerated at the storage layer (stripped before write)
  // but the schema no longer advertises them.
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
// EQUIPMENT OCR SCANS — Nameplate scan history (2026-05-13 Phase 0)
// ============================================================================
// Separate scan-history table (Option B) so:
//   - location_equipment remains the source of truth for live field values
//   - Multiple scan attempts per equipment are preserved for audit
//   - nameplatePhotoId is set on the equipment row only after user review + save
//   - OCR results are never auto-applied (reviewed_at / applied_at track review)
export const equipmentOcrScans = pgTable("equipment_ocr_scans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  equipmentId: varchar("equipment_id").notNull().references(() => locationEquipment.id, { onDelete: "cascade" }),
  // RESTRICT: the source image must not be deleted while a scan record references it.
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "restrict" }),
  rawText: text("raw_text"),
  // Canonical field map JSON. Shape: { [field]: { value, confidence } }
  // Keys: manufacturer, modelNumber, serialNumber, equipmentType, tagNumber, installDate
  parsedFields: jsonb("parsed_fields"),
  // Overall OCR confidence from the provider (0.0000–1.0000).
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  // Provider that produced this scan: "tesseract" | "google_vision" | "azure_cv"
  provider: varchar("provider").notNull(),
  // Set when the tech taps "Save" after reviewing fields (Phase 1 UI).
  reviewedAt: timestamp("reviewed_at"),
  reviewedById: varchar("reviewed_by_id").references(() => users.id),
  // Set when the reviewed fields are written back to location_equipment.
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  equipIdx: index("equipment_ocr_scans_equipment_idx").on(table.companyId, table.equipmentId),
  fileIdx: index("equipment_ocr_scans_file_idx").on(table.companyId, table.fileId),
}));

export type EquipmentOcrScan = typeof equipmentOcrScans.$inferSelect;

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
  // Service template attribution (Phase 4 — flat-rate service integration)
  serviceTemplateId: varchar("service_template_id").references(() => serviceTemplates.id, { onDelete: "set null" }),
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
  serviceTemplateId: z.string().nullable().optional(),
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
  // 2026-04-09: tech-side pause state — set by POST /api/tech/visits/:id/pause,
  // cleared by /resume. Distinct from on_hold (office-side dispatch hold).
  "paused",
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

  // Assignment — crew only (no lead technician concept)
  assignedTechnicianIds: varchar("assigned_technician_ids").array(),

  // Equipment selection — which location equipment this visit addresses (2026-03-27)
  equipmentIds: varchar("equipment_ids").array(),

  // Status
  status: text("status").notNull().default("scheduled"),

  // Visit sequencing
  visitNumber: integer("visit_number"), // nullable in DB, computed by repository

  // Time tracking (operational timestamps — labor duration derived from time_entries)
  checkedInAt: timestamp("checked_in_at"),
  checkedOutAt: timestamp("checked_out_at"),
  // actualDurationMinutes: DROPPED — labor duration is derived from time_entries (labor unification)

  // 2026-04-10: Captured by startVisit() before transitioning to in_progress.
  // Read by cancelVisitStart() to restore the visit to its actual prior state
  // (en_route OR scheduled), instead of always restoring to en_route. Cleared
  // on successful cancel and on complete.
  previousStatus: text("previous_status"),

  // Notes
  visitNotes: text("visit_notes"),

  // Structured visit outcome (Phase 1 dispatch refactor, 2026-03-06)
  // Replaces legacy [OUTCOME: ...] text tags in visitNotes as authoritative source
  outcome: text("outcome"), // "completed" | "needs_parts" | "needs_followup"
  outcomeNote: text("outcome_note"),
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  isFollowUpNeeded: boolean("is_follow_up_needed").notNull().default(false),

  // Dispatch staging bucket — dispatcher-only, never exposed to technicians.
  // Allowed values: urgent | today | on_hold | less_urgent
  // NULL is normalised to 'today' at the application layer.
  dispatchQueueBucket: text("dispatch_queue_bucket"),

  // Board view card position within a tech×day cell. Sparse integers (0, 10, 20...).
  // NULL = unset; adapter falls back to scheduledStart ordering.
  dispatchOrder: integer("dispatch_order"),

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
  version: true,
}).extend({
  status: z.enum(jobVisitStatusEnum).default("scheduled"),
  scheduledDate: z.string().optional(),           // ISO date string (legacy, optional)
  scheduledStart: z.string().optional(),          // ISO timestamp string (nullable in DB)
  scheduledEnd: z.string().optional(),            // ISO timestamp string (nullable in DB)
  isAllDay: z.boolean().default(false),
  estimatedDurationMinutes: z.number().int().positive().default(60),
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
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  equipmentIds: z.array(z.string()).nullable().optional(),
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

export const taskTypeEnum = ["GENERAL", "QUOTE_ASSESSMENT"] as const;
export type TaskType = typeof taskTypeEnum[number];

export const taskStatusEnum = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = typeof taskStatusEnum[number];

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Optional assignment (can be unassigned until later)
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),

  type: text("type").notNull(), // GENERAL | QUOTE_ASSESSMENT
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

  // Planning
  estimatedDurationMinutes: integer("estimated_duration_minutes"), // Estimated time to complete
  // 2026-04-10: Actual worked time is now derived from time_entries (task labor unification).
  // Legacy fields checkedInAt, checkedOutAt, actualDurationMinutes DELETED.

  // Billing
  isBillable: boolean("is_billable").notNull().default(false),

  // Optional attribution to a Job and Client/Location (does NOT create billing or calendar coupling)
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  // DEPRECATED: clientId kept for backwards compatibility - use locationId instead
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "set null" }),
  // Canonical reference to service location (optional for tasks)
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "set null" }),
  // Phase 2: Quote assessment link — set for QUOTE_ASSESSMENT tasks only
  quoteId: varchar("quote_id").references(() => quotes.id, { onDelete: "set null" }),

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
  // Quote assessment index
  companyQuoteIdx: index("tasks_company_quote_idx").on(table.companyId, table.quoteId),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true, // Auto-set
  closedByUserId: true, // Auto-set
}).extend({
  type: z.enum(taskTypeEnum),
  status: z.enum(taskStatusEnum).default("pending"),
  notes: z.string().max(2000).optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  clientId: z.string().uuid().nullable().optional(),
  isBillable: z.boolean().optional(), // Server applies default based on jobId presence
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
  isBillable: z.boolean().optional(),
}).strict();

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type Task = typeof tasks.$inferSelect;

export const qboSyncStatusEnum = ["NOT_SYNCED", "SYNCED", "PENDING", "ERROR"] as const;
export type QboSyncStatus = typeof qboSyncStatusEnum[number];

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
  // 2026-04-09: Outbound payment sync events (App → QBO)
  "PAYMENT_CREATE",
  "PAYMENT_UPDATE",
  "PAYMENT_DELETE",
] as const;
export type QboSyncEventType = typeof qboSyncEventTypeEnum[number];

export const qboSyncResultEnum = ["SUCCESS", "FAILURE", "SKIPPED", "NO_CHANGES", "PARTIAL"] as const;
export type QboSyncResult = typeof qboSyncResultEnum[number];

export const qboSyncEvents = pgTable("qbo_sync_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Event type and result
  eventType: text("event_type").notNull(), // CUSTOMER_CREATE, CUSTOMER_UPDATE, INVOICE_CREATE, INVOICE_UPDATE, PAYMENT_CREATE/UPDATE/DELETE
  result: text("result").notNull(), // SUCCESS, FAILURE, SKIPPED
  // Entity references (nullable - one will be set based on event type)
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  clientLocationId: varchar("client_location_id").references(() => clientLocations.id, { onDelete: "set null" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  itemId: varchar("item_id").references(() => items.id, { onDelete: "set null" }),
  // 2026-04-09: Added for outbound payment sync events. Inbound payment events
  // (e.g. PAYMENT_READ, PAYMENT_CREATED_FROM_QBO) historically used invoiceId
  // because they originate from an invoice context. Outbound PAYMENT_CREATE /
  // UPDATE / DELETE events use this column for direct correlation to the local
  // payment row.
  paymentId: varchar("payment_id").references(() => payments.id, { onDelete: "set null" }),
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

export const quoteAssessmentStatusEnum = ["required", "scheduled", "completed"] as const;
export type QuoteAssessmentStatus = typeof quoteAssessmentStatusEnum[number];

export const quotes = pgTable("quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Location where work will be performed
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
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
  // 2026-04-26: isActive + deletedAt REMOVED — quotes use permanent-delete
  // model (matches invoices). Hard delete is allowed only when status='draft'
  // AND convertedToJobId IS NULL. See migration
  // 2026_04_26_quotes_permanent_delete.sql.
  // Optimistic locking
  // Phase 2: Quote ownership — who is commercially responsible for advancing this quote
  salesOwnerUserId: varchar("sales_owner_user_id").references(() => users.id, { onDelete: "set null" }),
  // Phase 2: Assessment workflow — orthogonal to quote.status (commercial lifecycle)
  // null = no assessment needed, 'required' = needed but not scheduled,
  // 'scheduled' = active QUOTE_ASSESSMENT task exists, 'completed' = assessment done
  assessmentStatus: text("assessment_status"),
  // Lead attribution — links quote to originating lead for pipeline tracking
  leadId: varchar("lead_id"),
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
  // 2026-04-26: isActive removed from updateQuoteSchema along with the
  // underlying column. Quotes use permanent-delete now.
  salesOwnerUserId: z.string().nullable().optional(),
  assessmentStatus: z.enum(["required", "scheduled", "completed"]).nullable().optional(),
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
  // 2026-05-06: cost basis per unit, mirrors invoice_lines.unit_cost
  // and job_parts.unit_cost. Nullable for backfill safety on rows
  // that pre-date the column. headerMetrics treats null/blank as 0.
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0.0000"),
  lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 2 }).notNull().default("0.00"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0.00"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Product reference
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }),
  // Service template attribution (Phase 3 — flat-rate service integration)
  serviceTemplateId: varchar("service_template_id").references(() => serviceTemplates.id, { onDelete: "set null" }),
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
  // 2026-05-06: cost basis per unit (nullable). Sent by the canonical
  // line-item draft mapper; persists into quote_lines.unit_cost.
  unitCost: z.string().nullable().optional(),
  unitPrice: z.string().optional(),
  taxRate: z.string().optional(),
  lineSubtotal: z.string().optional(),
  taxAmount: z.string().optional(),
  lineTotal: z.string().optional(),
  productId: z.string().nullable().optional(),
  serviceTemplateId: z.string().nullable().optional(),
});

export type InsertQuoteLine = z.infer<typeof insertQuoteLineSchema>;
export type UpdateQuoteLine = z.infer<typeof updateQuoteLineSchema>;
export type QuoteLine = typeof quoteLines.$inferSelect;

// ============================================================================
// QUOTE TEMPLATES
// ============================================================================

// 2026-04-14 Phase 3D — canonical quote notes. Mirror of jobNotes so Quote
// Detail can surface the same interactive notes UX as Job Detail.
// 2026-05-02 (Audit #2 PR 3A) — attachment parity with jobNoteAttachments
// added below. The follow-up the prior comment promised landed here as
// the backend prep step before the EntityNotesSection / EntityNoteDialog
// frontend consolidation.
export const quoteNotes = pgTable("quote_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  quoteId: varchar("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "set null" }),
  noteText: text("note_text").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertQuoteNoteSchema = createInsertSchema(quoteNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type QuoteNote = typeof quoteNotes.$inferSelect;
export type InsertQuoteNote = z.infer<typeof insertQuoteNoteSchema>;

// 2026-05-02 (Audit #2 PR 3A): quote note attachments — join table linking
// quote notes to files. Mirrors `jobNoteAttachments` one-for-one so the
// canonical EntityNoteDialog (added in a follow-up frontend pass) can
// route attach / detach through a per-entity repo with the same shape.
// Migration: `migrations/2026_05_02_quote_note_attachments.sql`.
export const quoteNoteAttachments = pgTable("quote_note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  noteId: varchar("note_id").notNull().references(() => quoteNotes.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type QuoteNoteAttachment = typeof quoteNoteAttachments.$inferSelect;

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
// TENANT FEATURE FLAGS — DELETED 2026-04-21 Phase 3
// ============================================================================
//
// The `tenant_features` table is gone. The canonical path for feature
// entitlements is the `subscription_features` + `subscription_plan_features`
// + `tenant_feature_overrides` catalog, resolved by `entitlementService`.
// Invoice reminder cadence (the only non-policy field that lived on the
// old table) moved to `company_settings`. See migration
// `2026_04_21c_drop_tenant_features.sql`.

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
  // 2026-04-16: midnight rollover auto-pause. Emitted by the midnight
  // rollover worker when a running time entry is auto-closed at tenant-
  // local 23:59:59.999. Rendered as an in-app banner by the tech app.
  "time_entry_auto_paused",
  // 2026-04-21 Phase 1 push notifications: technician newly assigned to a
  // visit. Emitted by notificationService.emitVisitAssignmentChange from
  // the canonical PATCH /api/calendar/visit/:id/assign-crew handler.
  "visit_assigned",
  // 2026-04-21 Phase 2 push notifications: assigned tech notified when a
  // visit's scheduled date/time meaningfully changes. Emitted by
  // notificationService.emitVisitScheduleChange from the canonical
  // PATCH /api/calendar/visit/:id/reschedule handler. Governed by the
  // `visitScheduleChangesEnabled` preference.
  "visit_schedule_changed",
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
// NOTIFICATION TARGETS (2026-04-21 Phase 1)
//
// Canonical registry of delivery endpoints per user/device. Sibling to the
// `notifications` table:
//   - `notifications`         = what to say (channel-agnostic)
//   - `notification_targets`  = where to send it (one row per device/browser)
//
// The (platform, channel, provider) triple is shaped so future native apps
// (iOS/Android) slot in as new rows with no schema change — Phase 3 work.
// Phase 1 writes only ("web", "web_push", "webpush") rows from the tech PWA.
// ============================================================================

export const notificationPlatformEnum = ["web", "ios", "android"] as const;
export type NotificationPlatform = typeof notificationPlatformEnum[number];

export const notificationChannelEnum = ["web_push", "native_push"] as const;
export type NotificationChannel = typeof notificationChannelEnum[number];

export const notificationProviderEnum = ["webpush", "apns", "fcm"] as const;
export type NotificationProvider = typeof notificationProviderEnum[number];

export const notificationTargets = pgTable("notification_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),                         // NotificationPlatform
  channel: text("channel").notNull(),                           // NotificationChannel
  provider: text("provider").notNull(),                         // NotificationProvider
  endpoint: text("endpoint").notNull(),                         // web-push URL | native token
  keyP256dh: text("key_p256dh"),                                // web-push only
  keyAuth: text("key_auth"),                                    // web-push only
  userAgent: text("user_agent"),                                // diagnostic
  appVersion: text("app_version"),                              // future native
  lastSeenAt: timestamp("last_seen_at"),                        // updated on every successful delivery
  revokedAt: timestamp("revoked_at"),                           // soft-revoke on stale endpoint (410/404)
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  endpointUniqueIdx: uniqueIndex("notification_targets_unique_endpoint_idx")
    .on(table.tenantId, table.userId, table.endpoint),
  tenantIdx: index("notification_targets_tenant_idx").on(table.tenantId),
  // The live-targets lookup runs on every delivery fan-out; having a
  // (tenant_id, user_id) index is enough — the WHERE revoked_at IS NULL
  // partial condition is enforced in the migration.
  userLiveIdx: index("notification_targets_user_live_idx").on(table.tenantId, table.userId),
}));

export const insertNotificationTargetSchema = createInsertSchema(notificationTargets).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
});

export type InsertNotificationTarget = z.infer<typeof insertNotificationTargetSchema>;
export type NotificationTarget = typeof notificationTargets.$inferSelect;

// ============================================================================
// NOTIFICATION PREFERENCES (2026-04-21 Phase 2, v1)
//
// User-level notification policy — completes the Phase 1 triptych:
//   - `notifications`            = what to say           (content)
//   - `notification_targets`     = where to send it      (delivery endpoints)
//   - `notification_preferences` = whether to send it    (user policy)
//
// Row absence semantics: if no row exists for a (tenant_id, user_id) pair,
// the repository read treats every category as TRUE. This preserves Phase 1
// behavior for existing users with zero backfill.
//
// Extension pattern: future categories are added as additional boolean
// columns (NOT NULL DEFAULT TRUE). No JSON blobs; no key/value table.
// ============================================================================

export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Phase 1 category (enforced in emitVisitAssignmentChange).
  visitAssignmentsEnabled: boolean("visit_assignments_enabled").notNull().default(true),
  // Forward-ready categories — UI can persist intent; no emitter reads them yet.
  visitScheduleChangesEnabled: boolean("visit_schedule_changes_enabled").notNull().default(true),
  visitCancellationsEnabled: boolean("visit_cancellations_enabled").notNull().default(true),
  visitRemindersEnabled: boolean("visit_reminders_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tenantUserIdx: uniqueIndex("notification_preferences_tenant_user_idx")
    .on(table.tenantId, table.userId),
}));

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;

/** Client-safe default shape (matches column defaults). Use this when a row is absent. */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  visitAssignmentsEnabled: true,
  visitScheduleChangesEnabled: true,
  visitCancellationsEnabled: true,
  visitRemindersEnabled: true,
} as const;

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
  // 2026-04-21 Phase 1 canonical policy architecture: two new event types
  // written by the canonical subscriptionLifecycleService.
  "status_changed",   // runtime-state transition (e.g., trial→active, active→past_due)
  "trial_expired",    // one-shot event written when trialEndsAt first passes
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
  "travel_between_jobs",
  "admin",
  "break",
  "task_work",
  "other"
] as const;
export type TimeEntryType = typeof timeEntryTypeEnum[number];

// Work session source - how the session was created
export const workSessionSourceEnum = ["mobile", "web", "import"] as const;
export type WorkSessionSource = typeof workSessionSourceEnum[number];

// Technician job status - for mobile status updates that drive time tracking
// 2026-04-09: added "resumed" so tech pause/resume is reversible.
// recordJobStatus(..., status: "resumed") starts a fresh on_site time entry.
export const technicianJobStatusEnum = ["dispatched", "en_route", "arrived", "paused", "resumed", "completed"] as const;
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
  // 2026-04-10: Task labor unification — task timers create canonical time_entries
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  // 2026-04-10: Visit attribution — set for visit-originated labor, null otherwise.
  // jobId remains the canonical financial parent; visitId is operational attribution.
  visitId: varchar("visit_id").references(() => jobVisits.id, { onDelete: "set null" }),
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
  // 2026-04-16: midnight rollover. Non-null when the rollover worker
  // closed this entry at tenant-local 23:59:59.999. Distinguishes auto-
  // paused entries from manually stopped ones in reports and analytics.
  // Null for every other stop path (manual, shift clock-out, task close).
  autoPausedAt: timestamp("auto_paused_at"),
  // Timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Index for finding entries by technician and time
  techStartIdx: index("time_entries_tech_start_idx").on(table.companyId, table.technicianId, table.startAt),
  // Index for finding entries by job
  jobIdx: index("time_entries_job_idx").on(table.companyId, table.jobId),
  // 2026-04-10: Index for finding entries by task
  taskIdx: index("time_entries_task_idx").on(table.companyId, table.taskId),
  // 2026-04-10: Index for finding entries by visit
  visitIdx: index("time_entries_visit_idx").on(table.companyId, table.visitId),
  // Index for finding uninvoiced entries
  invoiceIdx: index("time_entries_invoice_idx").on(table.companyId, table.invoiceId),
  // Non-partial scan index for running entries; the DB-level uniqueness backstop
  // (time_entries_one_running_per_tech WHERE end_at IS NULL) is a partial unique
  // index added in 2026_05_12_timer_data_integrity_backstops.sql — Drizzle does
  // not support partial unique indexes, so it is migration-only.
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
  jobId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  visitId: z.string().uuid().nullable().optional(),
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

// Start time entry request — jobId optional (validated if provided)
export const startTimeEntryRequestSchema = z.object({
  type: z.enum(timeEntryTypeEnum),
  jobId: z.string().uuid().nullable().optional(),
  at: z.string().datetime().optional(),
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

// Create finished time entry — jobId optional (validated if provided)
export const createFinishedTimeEntryRequestSchema = z.object({
  type: z.enum(timeEntryTypeEnum),
  jobId: z.string().uuid().nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().nullable().optional(),
  billable: z.boolean().default(true),
  costRateOverride: z.string().nullable().optional(),
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
  jobId: z.string().uuid().nullable().optional(), // Reassign or clear job association
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
  /** Total labour cost computed from costRateSnapshot × durationMinutes per entry */
  totalCostAmount: number;
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
    taskId: string | null;
    visitId: string | null;
    /** Derived source: "visit" | "task" | "manual" */
    sourceType: "visit" | "task" | "manual";
    startAt: Date;
    endAt: Date | null;
    durationMinutes: number | null;
    billable: boolean;
    invoiced: boolean;
  }>;
}

// ============================================================================
// PAYROLL SETTINGS (2026-04-12)
// ----------------------------------------------------------------------------
// Per-tenant pay-period configuration. Drives pay-period preset resolution
// (current / previous / next) in the Timesheet Report. Phase 1 wires
// `weekly` + `biweekly`; `semimonthly` + `monthly` are reserved in the
// enum but left un-implemented in the UI.
// ============================================================================

export const payrollFrequencyEnum = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const;
export type PayrollFrequency = (typeof payrollFrequencyEnum)[number];

export const payrollSettings = pgTable("payroll_settings", {
  // One row per tenant — companyId is the primary key, no duplicates.
  companyId: varchar("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  payFrequency: varchar("pay_frequency").notNull().default("biweekly"),
  // Anchor date in tenant timezone, YYYY-MM-DD. Defines the start of one
  // concrete pay period; all other periods are derived by adding/subtracting
  // multiples of the frequency.
  payAnchorDate: text("pay_anchor_date").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export type PayrollSettings = typeof payrollSettings.$inferSelect;

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

// Daily payroll breakdown — work_sessions source of truth (realigned 2026-04-06)
export interface DailyPayrollBreakdown {
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // Mon, Tue, etc.
  totalMinutes: number; // Sum of completed work_sessions duration (clockOut - clockIn - breaks)
}

// Technician weekly payroll summary — work_sessions source of truth (realigned 2026-04-06)
export interface TechnicianWeeklySummary {
  technicianId: string;
  technicianName: string | null;
  weekStart: string;
  weekEnd: string;
  totalMinutes: number; // Weekly total from work_sessions
  daily: DailyPayrollBreakdown[];
  approved: boolean;
  approvedAt: Date | null;
  approvedByName: string | null;
}

// ============================================================================
// TIME ANALYTICS (Phase 5)
// ============================================================================

// Time breakdown by type
export interface TimeByTypeBreakdown {
  travel_to_job: number;
  on_site: number;
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
  travelMinutes: number;      // travel_to_job + travel_between_jobs
  onSiteMinutes: number;
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
  locationId: varchar("location_id").references(() => clientLocations.id, { onDelete: "cascade" }),
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
  // Service Plans (2026-05-07): when true, the background generator and
  // post-create handler auto-promote newly-created pending instances into
  // UNSCHEDULED jobs (status=open, no visit, no tech, no calendar reservation).
  // Defaults to false to preserve historical "instances-only" behavior.
  autoGenerateJobs: boolean("auto_generate_jobs").notNull().default(false),
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
  // Service Plans (2026-05-07): explicit auto-generate-work toggle
  autoGenerateJobs: z.boolean().default(false),
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
  // Service Plans (2026-05-07): explicit auto-generate-work toggle
  autoGenerateJobs: z.boolean().optional(),
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
  contactId: varchar("contact_id").notNull().references(() => contactPersons.id, { onDelete: "cascade" }),
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
// CUSTOMER PORTAL — Invoice Access Tokens
// 2026-05-05: scope-limited tokens that grant view+pay access to ONE
// invoice without requiring a full portal session. Minted when an
// invoice email goes out, embedded in the Pay Invoice URL as `?t=…`,
// SHA-256 hashed at rest. Default TTL is 30 days. Unlike
// `portal_magic_tokens` (full account login) these tokens are
// invoice-scoped and ALWAYS revoked when the invoice reaches a paid
// state, so a leaked token can never be used to view other invoices
// or pay an already-paid invoice.
// ============================================================================
export const portalInvoiceAccessTokens = pgTable("portal_invoice_access_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  /** SHA-256 hash of the raw token. Raw token is never stored. */
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  /** Set on first successful payment to prevent replay. */
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  tokenHashIdx: uniqueIndex("portal_invoice_access_tokens_hash_idx").on(table.tokenHash),
  invoiceIdx: index("portal_invoice_access_tokens_invoice_idx").on(table.invoiceId),
  expiresIdx: index("portal_invoice_access_tokens_expires_idx").on(table.expiresAt),
}));

export type PortalInvoiceAccessToken = typeof portalInvoiceAccessTokens.$inferSelect;

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
  "customer_company", // collections-level events (statement sends, account-level activity)
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
// Single backend canonical queue for: requires invoicing, unassigned, unscheduled
// Phase 1 Architecture: Event Log + Attention Queue
// ============================================================================

export const attentionRuleTypeEnum = [
  "job.requires_invoicing",
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
  ruleType: text("rule_type").notNull(), // job.requires_invoicing | job.unassigned | job.unscheduled | ...
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

// 2026-04-14 Phase 1 cleanup: `receiptFileId` is not an API-accepted field.
// It is written exclusively by the `job_expense_receipt` EntityAdapter on
// file finalize and cleared by the same adapter on file delete. These
// schemas intentionally omit it so they stay consistent with the runtime
// expense API contract.
export const insertJobExpenseSchema = createInsertSchema(jobExpenses).omit({
  id: true,
  receiptFileId: true,
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
  isBillable: z.boolean().optional(),
  reimbursableToUserId: z.string().nullable().optional(),
});

export type InsertJobExpense = z.infer<typeof insertJobExpenseSchema>;
export type UpdateJobExpense = z.infer<typeof updateJobExpenseSchema>;
export type JobExpense = typeof jobExpenses.$inferSelect;

// ============================================================================
// LEADS — Pre-quote pipeline + attribution layer
// ============================================================================

// 2026-05-05: `needs_review` added — set by the lead-visit completion
// path when the LAST open lead-visit on a lead transitions to
// completed. The office reviews the lead at that point and decides
// whether to convert to a quote.
export const leadStatusEnum = ["new", "contacted", "needs_review", "quoted", "won", "lost"] as const;
export type LeadStatus = typeof leadStatusEnum[number];

export const leadSourceTypeEnum = ["tech", "office"] as const;
export type LeadSourceType = typeof leadSourceTypeEnum[number];

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  // Immutable after creation — the technician who originated the opportunity
  originTechnicianId: varchar("origin_technician_id").references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  sourceType: text("source_type").notNull().default("office"),
  sourceRefType: text("source_ref_type"), // 'visit' | 'job' | null
  sourceRefId: varchar("source_ref_id"),
  status: text("status").notNull().default("new"),
  priority: text("priority").default("medium"),
  title: text("title").notNull(),
  description: text("description"),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
  // Set when lead converts to quote
  convertedQuoteId: varchar("converted_quote_id"),
  convertedAt: timestamp("converted_at"),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(leadStatusEnum).default("new"),
  sourceType: z.enum(leadSourceTypeEnum).default("office"),
  priority: z.enum(jobPriorityEnum).nullable().default("medium"),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  estimatedValue: z.string().nullable().optional(),
});

export const updateLeadSchema = z.object({
  assignedToUserId: z.string().nullable().optional(),
  status: z.enum(leadStatusEnum).optional(),
  priority: z.enum(jobPriorityEnum).nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
  estimatedValue: z.string().nullable().optional(),
});

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type UpdateLead = z.infer<typeof updateLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// ── Lead Notes ──
export const leadNotes = pgTable("lead_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export type LeadNote = typeof leadNotes.$inferSelect;

// ── Lead Note Attachments (2026-05-05) ──
//
// Mirrors `job_note_attachments` and `quote_note_attachments` exactly so
// the canonical fileUploadService can write through `fileEntityBindings`
// without a special-case branch. Notes own attachments via `note_id`;
// the file metadata lives in `files`.
export const leadNoteAttachments = pgTable("lead_note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  noteId: varchar("note_id").notNull().references(() => leadNotes.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: varchar("created_by").references(() => users.id),
});

export type LeadNoteAttachment = typeof leadNoteAttachments.$inferSelect;

// ── Lead Visits (2026-05-05) ──
//
// Sibling to `job_visits` — pre-sales onsite appointments scheduled
// against a lead before any quote/job exists. Sibling table on purpose:
// lead visits must not pollute job visit predicates, job feeds, job
// reports, or job KPIs. Capacity reads BOTH tables to compute booked
// minutes; dispatch + tech-today merge them at the service/UI layer.
//
// Schema mirrors job_visits where it makes sense (scheduling, crew,
// status enum, soft-delete). Lead visits do NOT carry equipment,
// parts, time entries, or visitNumber — leads have no line items, no
// per-visit billing, and no per-visit equipment selection.
//
// IMPORTANT: never edit `visitPredicates.ts` to fold these in. Lead
// visits get parallel predicates in `leadVisitPredicates.ts`. The
// existing job-visit single-source-of-truth filters
// (`scheduleEligibleVisitFilter`, `uncompletedVisitFilter`,
// `reconciliationActionableVisitFilter`) drive job lifecycle and
// performance baselines per CLAUDE.md and must stay job-only.
export const leadVisitStatusEnum = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export type LeadVisitStatus = typeof leadVisitStatusEnum[number];

export const leadVisits = pgTable(
  "lead_visits",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    leadId: varchar("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),

    // Scheduling — same shape + naming as job_visits. Nullable start
    // permits unscheduled placeholder rows (the office can pre-create
    // a visit without a time slot, then assign later).
    scheduledStart: timestamp("scheduled_start"),
    scheduledEnd: timestamp("scheduled_end"),
    isAllDay: boolean("is_all_day").notNull().default(false),
    estimatedDurationMinutes: integer("estimated_duration_minutes").default(60),

    // Crew — array, mirrors job_visits.assigned_technician_ids. Office
    // UI surfaces a single-select picker by default; backend stays
    // array-shaped so future multi-tech assignments don't require a
    // schema migration.
    assignedTechnicianIds: varchar("assigned_technician_ids").array(),

    // Status (lightweight 4-value lifecycle — no on_hold, on_route,
    // dispatched, etc.; lead visits don't go through dispatch states).
    status: text("status").notNull().default("scheduled"),

    // Lightweight outcome — no equipment, no parts, no time entries.
    visitNotes: text("visit_notes"),
    outcomeNote: text("outcome_note"),
    completedByUserId: varchar("completed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at"),

    // Soft-delete + locking — same shape as job_visits.
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: varchar("archived_by_user_id"),

    // Audit
    createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    // Mirrors idx_job_visits_company_active_start. Drives the dispatch
    // calendar feed + capacity range scan.
    companyActiveStartIdx: index("idx_lead_visits_company_active_start")
      .on(table.companyId, table.isActive, table.scheduledStart),
    // Per-lead lookups (LeadVisitsCard, isLastOpenVisitForLead).
    leadCompanyActiveIdx: index("idx_lead_visits_lead_company_active")
      .on(table.leadId, table.companyId, table.isActive),
  }),
);

export const insertLeadVisitSchema = createInsertSchema(leadVisits).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(leadVisitStatusEnum).default("scheduled"),
  // Schedule fields are optional at insert time — `normalizeVisitSchedule`
  // resolves the canonical start/end/duration before we hit storage.
  scheduledStart: z.union([z.string(), z.date(), z.null()]).optional(),
  scheduledEnd: z.union([z.string(), z.date(), z.null()]).optional(),
  estimatedDurationMinutes: z.number().int().nullable().optional(),
  isAllDay: z.boolean().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  visitNotes: z.string().nullable().optional(),
});

export const updateLeadVisitSchema = z.object({
  scheduledStart: z.union([z.string(), z.date(), z.null()]).optional(),
  scheduledEnd: z.union([z.string(), z.date(), z.null()]).optional(),
  estimatedDurationMinutes: z.number().int().nullable().optional(),
  isAllDay: z.boolean().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  status: z.enum(leadVisitStatusEnum).optional(),
  visitNotes: z.string().nullable().optional(),
  outcomeNote: z.string().nullable().optional(),
});

export type InsertLeadVisit = z.infer<typeof insertLeadVisitSchema>;
export type UpdateLeadVisit = z.infer<typeof updateLeadVisitSchema>;
export type LeadVisit = typeof leadVisits.$inferSelect;

// ============================================================================
// REFERENCE FIELDS — Controlled, tenant-scoped, searchable reference data
// ============================================================================
//
// 2026-04-10: Centralized reference field system for Jobs, Quotes, and Invoices.
// Field definitions are created once by tenant admin and applied across entity types.
// Field values are stored per-record with typed columns (text/number/date).
//
// This is NOT a free-form custom fields system. It is a controlled reference-field
// registry for short structured values like PO numbers, claim numbers, permits, etc.

// 2026-04-10: Locked to text-only. Number/date support removed.
export const referenceFieldTypeEnum = ["text"] as const;
export type ReferenceFieldType = typeof referenceFieldTypeEnum[number];

// 2026-04-22 Phase 2b: extended to cover Clients (customer_company),
// Locations (client_location), and Products / Services (item) so the Import
// Center can create custom fields inline for every entity type.
export const referenceFieldEntityTypeEnum = [
  "job",
  "quote",
  "invoice",
  "customer_company",
  "client_location",
  "item",
] as const;
export type ReferenceFieldEntityType = typeof referenceFieldEntityTypeEnum[number];

// ── Definitions ──

export const referenceFieldDefinitions = pgTable("reference_field_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),

  label: varchar("label", { length: 200 }).notNull(),
  key: varchar("key", { length: 100 }).notNull(),

  type: varchar("type", { length: 20 }).notNull(), // text | number | date

  appliesToJobs: boolean("applies_to_jobs").notNull().default(false),
  appliesToQuotes: boolean("applies_to_quotes").notNull().default(false),
  appliesToInvoices: boolean("applies_to_invoices").notNull().default(false),
  // 2026-04-22 Phase 2b: added to cover custom fields on clients, locations, products
  appliesToCustomers: boolean("applies_to_customers").notNull().default(false),
  appliesToLocations: boolean("applies_to_locations").notNull().default(false),
  appliesToProducts: boolean("applies_to_products").notNull().default(false),

  searchable: boolean("searchable").notNull().default(true),
  active: boolean("active").notNull().default(true),

  displayOrder: integer("display_order").notNull().default(0),

  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Unique key per tenant
  companyKeyUq: uniqueIndex("ref_field_defs_company_key_uq").on(table.companyId, table.key),
  // At least one applies-to must be true (extended to 6 entities in Phase 2b)
  appliesToCheck: check(
    "ref_field_defs_applies_to_check",
    sql`${table.appliesToJobs} = true OR ${table.appliesToQuotes} = true OR ${table.appliesToInvoices} = true OR ${table.appliesToCustomers} = true OR ${table.appliesToLocations} = true OR ${table.appliesToProducts} = true`
  ),
  // Type must be a valid enum value
  typeCheck: check(
    "ref_field_defs_type_check",
    sql`${table.type} IN ('text', 'number', 'date')`
  ),
}));

export const insertReferenceFieldDefinitionSchema = createInsertSchema(referenceFieldDefinitions).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  label: z.string().min(1).max(200),
  // 2026-04-10: key and type are optional — server auto-generates key from label, type is always "text"
  key: z.string().max(100).optional(),
  type: z.enum(referenceFieldTypeEnum).optional(),
  appliesToJobs: z.boolean().default(false),
  appliesToQuotes: z.boolean().default(false),
  appliesToInvoices: z.boolean().default(false),
  // 2026-04-22 Phase 2b
  appliesToCustomers: z.boolean().default(false),
  appliesToLocations: z.boolean().default(false),
  appliesToProducts: z.boolean().default(false),
  searchable: z.boolean().default(true),
  active: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(0),
}).refine(
  (data) =>
    data.appliesToJobs ||
    data.appliesToQuotes ||
    data.appliesToInvoices ||
    data.appliesToCustomers ||
    data.appliesToLocations ||
    data.appliesToProducts,
  { message: "At least one 'applies to' option must be selected", path: ["appliesToJobs"] }
);

export const updateReferenceFieldDefinitionSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  appliesToJobs: z.boolean().optional(),
  appliesToQuotes: z.boolean().optional(),
  appliesToInvoices: z.boolean().optional(),
  // 2026-04-22 Phase 2b
  appliesToCustomers: z.boolean().optional(),
  appliesToLocations: z.boolean().optional(),
  appliesToProducts: z.boolean().optional(),
  searchable: z.boolean().optional(),
  active: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
  // key and type are immutable after creation
}).strict();

export type ReferenceFieldDefinition = typeof referenceFieldDefinitions.$inferSelect;
export type InsertReferenceFieldDefinition = z.infer<typeof insertReferenceFieldDefinitionSchema>;
export type UpdateReferenceFieldDefinition = z.infer<typeof updateReferenceFieldDefinitionSchema>;

// ── Values ──

export const referenceFieldValues = pgTable("reference_field_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),

  fieldDefinitionId: varchar("field_definition_id").notNull().references(() => referenceFieldDefinitions.id, { onDelete: "cascade" }),

  entityType: varchar("entity_type", { length: 20 }).notNull(), // job | quote | invoice | customer_company | client_location | item
  entityId: varchar("entity_id").notNull(),

  textValue: varchar("text_value", { length: 500 }),
  // 2026-04-10: number_value and date_value columns dropped — text-only system

  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // One value per field per entity
  fieldEntityUq: uniqueIndex("ref_field_vals_field_entity_uq").on(
    table.companyId, table.fieldDefinitionId, table.entityType, table.entityId
  ),
  // Lookup: all values for a specific entity
  entityLookupIdx: index("ref_field_vals_entity_lookup_idx").on(
    table.companyId, table.entityType, table.entityId
  ),
  // Lookup: all values for a specific definition
  definitionIdx: index("ref_field_vals_definition_idx").on(
    table.companyId, table.fieldDefinitionId
  ),
  // Entity type constraint (2026-04-22 Phase 2b: extended to 6 entities)
  entityTypeCheck: check(
    "ref_field_vals_entity_type_check",
    sql`${table.entityType} IN ('job', 'quote', 'invoice', 'customer_company', 'client_location', 'item')`
  ),
  // 2026-04-10: singleValueCheck removed — only text_value column remains
}));

export const upsertReferenceFieldValueSchema = z.object({
  fieldDefinitionId: z.string().uuid(),
  entityType: z.enum(referenceFieldEntityTypeEnum),
  entityId: z.string().uuid(),
  textValue: z.string().max(500).nullable().optional(),
}).strict();

export type ReferenceFieldValue = typeof referenceFieldValues.$inferSelect;
export type UpsertReferenceFieldValue = z.infer<typeof upsertReferenceFieldValueSchema>;

// ============================================================================
// Communication Templates (Phase 1 — 2026-04-12)
// ============================================================================
// Tenant-scoped email/SMS templates for outbound invoice / quote / job
// messaging. See migrations/2026_04_12_communication_templates.sql.
//
// Canonical rules:
//   - one template per (tenant_id, entity_type, channel)
//   - entity_type ∈ {invoice, quote, job}
//   - channel     ∈ {email, sms}
//   - email templates require a non-null subject; SMS may omit it

export const communicationTemplateEntityTypeEnum = ["invoice", "quote", "job", "invoice_reminder", "payment_receipt"] as const;
export type CommunicationTemplateEntityType = (typeof communicationTemplateEntityTypeEnum)[number];

export const communicationTemplateChannelEnum = ["email", "sms"] as const;
export type CommunicationTemplateChannel = (typeof communicationTemplateChannelEnum)[number];

export const communicationTemplates = pgTable(
  "communication_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    channel: text("channel").notNull(),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tenantEntityChannelUq: uniqueIndex("comm_templates_tenant_entity_channel_uq").on(
      table.tenantId,
      table.entityType,
      table.channel,
    ),
    tenantIdx: index("idx_comm_templates_tenant").on(table.tenantId),
  }),
);

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const upsertCommunicationTemplateSchema = z.object({
  entityType: z.enum(communicationTemplateEntityTypeEnum),
  channel: z.enum(communicationTemplateChannelEnum),
  subjectTemplate: z.string().max(500).nullable().optional(),
  bodyTemplate: z.string().min(1).max(20000),
  isActive: z.boolean().optional(),
}).refine(
  (data) => data.channel !== "email" || (data.subjectTemplate != null && data.subjectTemplate.length > 0),
  { message: "subjectTemplate is required for email channel", path: ["subjectTemplate"] },
);

export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;
export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;
export type UpsertCommunicationTemplateInput = z.infer<typeof upsertCommunicationTemplateSchema>;

// ============================================================================
// Email Deliveries (Phase 10 — 2026-04-12)
// ============================================================================
// One row per outbound email dispatch. Tracks provider lifecycle (queued →
// sent → optionally delivered / bounced / complained, or → failed).
// See migrations/2026_04_12_email_deliveries.sql.

export const emailDeliveryStatusEnum = [
  "queued",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "complained",
  // 2026-04-14: Resend webhook `email.opened` events. Transitions from
  // `delivered` (or `sent`) to `opened`; subsequent opens are idempotent.
  "opened",
] as const;
export type EmailDeliveryStatus = (typeof emailDeliveryStatusEnum)[number];

export const emailDeliveryTemplateSourceEnum = [
  "default",
  "tenant_template",
  "override",
] as const;
export type EmailDeliveryTemplateSource =
  (typeof emailDeliveryTemplateSourceEnum)[number];

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: varchar("entity_id").notNull(),
    channel: text("channel").notNull().default("email"),
    recipientCount: integer("recipient_count").notNull().default(0),
    recipientsJson: jsonb("recipients_json").notNull().default(sql`'[]'::jsonb`),
    // 2026-04-13 (Commit C): CC recipients for this send. Parallel shape to
    // `recipientsJson`. Stored as JSON so we preserve the exact normalized
    // list without a join table.
    ccJson: jsonb("cc_json").notNull().default(sql`'[]'::jsonb`),
    // 2026-04-13 (Commit C follow-up): outbound attachment metadata — an
    // array of `DeliveryAttachmentMetadata` objects (see type below). Never
    // stores file bytes; filename/mime/size/source only. Empty array when
    // the send carried no attachments.
    attachmentsJson: jsonb("attachments_json").notNull().default(sql`'[]'::jsonb`),
    subject: text("subject"),
    bodySnapshot: text("body_snapshot"),
    templateSource: text("template_source").notNull(),
    provider: text("provider").notNull().default("resend"),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    failedAt: timestamp("failed_at"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    // Phase 15/17: resend lineage.
    resendCount: integer("resend_count").notNull().default(0),
    retriedFromDeliveryId: varchar("retried_from_delivery_id"),
  },
  (table) => ({
    tenantIdx: index("idx_email_deliveries_tenant").on(table.tenantId),
    entityIdx: index("idx_email_deliveries_entity").on(table.entityType, table.entityId),
    providerMsgIdx: index("idx_email_deliveries_provider_msg").on(table.providerMessageId),
    statusIdx: index("idx_email_deliveries_status").on(table.status),
    retriedFromIdx: index("idx_email_deliveries_retried_from").on(table.retriedFromDeliveryId),
    // 2026-04-14 Phase A hardening: partial unique index prevents a
    // concurrent duplicate `queued` row for the same (tenant, entity).
    // Transitioned rows (sent/failed/delivered/etc) are outside the
    // predicate, so legitimate resends and new sends remain possible.
    queuedActiveUq: uniqueIndex("email_deliveries_queued_active_uq")
      .on(table.tenantId, table.entityType, table.entityId)
      .where(sql`status = 'queued'`),
  }),
);

export type EmailDelivery = typeof emailDeliveries.$inferSelect;
export type InsertEmailDelivery = typeof emailDeliveries.$inferInsert;

// 2026-04-13 (Commit C follow-up): canonical shape for per-attachment
// metadata persisted on every delivery row. Never carries file bytes.
export const emailDeliveryAttachmentSourceEnum = [
  "invoice_pdf",
  "quote_pdf",
  "uploaded_image",
] as const;
export type EmailDeliveryAttachmentSource =
  (typeof emailDeliveryAttachmentSourceEnum)[number];

export interface DeliveryAttachmentMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: EmailDeliveryAttachmentSource;
  /** Present only for `uploaded_image` attachments — references the file row. */
  fileId?: string | null;
}

// ============================================================================
// TECHNICIAN CALENDAR TOKENS (Phase 1 — 2026-04-23)
// ============================================================================
//
// Per-technician private calendar subscription secret. Powers the public
// /calendar/technician/:token.ics feed which external calendar apps
// (Google / Apple / Outlook) subscribe to. Read-only; app is still the
// single source of truth for scheduling.
//
// One row per user. Rotation overwrites `token`. Disable flips `is_active`.
// See migrations/2026_04_23_technician_calendar_tokens.sql.

export const technicianCalendarTokens = pgTable(
  "technician_calendar_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastAccessedAt: timestamp("last_accessed_at"),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    userUq: uniqueIndex("tct_user_uq").on(table.userId),
    tokenUq: uniqueIndex("tct_token_uq").on(table.token),
    activeTokenIdx: index("tct_active_token_idx")
      .on(table.token)
      .where(sql`is_active`),
  }),
);

export type TechnicianCalendarToken = typeof technicianCalendarTokens.$inferSelect;
export type InsertTechnicianCalendarToken = typeof technicianCalendarTokens.$inferInsert;
// ────────────────────────────────────────────────────────────────────
// User Dashboard Widget Layout (2026-05-07 RALPH)
// ────────────────────────────────────────────────────────────────────
// Per-user dashboard layout overrides. One row per widget per dashboard
// per user; absence of a row means "use the registry default" (no
// auto-seed at signup). Reset = DELETE rows for (user_id, dashboard_key).
// See migrations/2026_05_07_user_dashboard_widgets.sql for rationale,
// and shared/dashboardWidgetRegistry.ts for the canonical widget list.
//
// `dashboard_key` is free-form text (not an enum) so future dashboards
// can be added without a migration. The server route validates against
// the registry's known dashboard keys; unknown keys are rejected at 400.
export const userDashboardWidgets = pgTable(
  "user_dashboard_widgets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dashboardKey: text("dashboard_key").notNull(),
    widgetKey: text("widget_key").notNull(),
    visible: boolean("visible").notNull().default(true),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    userKeyWidgetUq: uniqueIndex("user_dashboard_widgets_unique")
      .on(table.userId, table.dashboardKey, table.widgetKey),
    lookupIdx: index("idx_user_dashboard_widgets_lookup")
      .on(table.userId, table.dashboardKey, table.orderIndex),
  }),
);

export type UserDashboardWidget = typeof userDashboardWidgets.$inferSelect;
export type InsertUserDashboardWidget = typeof userDashboardWidgets.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Activity Feed Preferences (2026-05-07)
// ────────────────────────────────────────────────────────────────────
// Per-user toggle list for the canonical operational event_types that
// surface in the global Activity Feed drawer. Reads from the existing
// `events` table — this row only filters which event_types render.
// Absence of a row means "use canonical defaults" (DEFAULT_ENABLED_EVENT_TYPES
// in shared/activityFeedRegistry.ts).
export const activityFeedPreferences = pgTable(
  "activity_feed_preferences",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: varchar("tenant_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    enabledEventTypes: jsonb("enabled_event_types").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    userUq: uniqueIndex("activity_feed_preferences_user_unique").on(table.userId),
    tenantIdx: index("idx_activity_feed_preferences_tenant").on(table.tenantId),
  }),
);

export type ActivityFeedPreference = typeof activityFeedPreferences.$inferSelect;
export type InsertActivityFeedPreference = typeof activityFeedPreferences.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Communications Hub — Phase 3 durable thread/message/call tables
// ────────────────────────────────────────────────────────────────────
//
// Provider-neutral conversation storage. Vendor-issued ids
// (`provider_message_id`, `provider_call_id`) are stored as opaque text
// so a future Twilio/Telnyx adapter can rejoin a webhook event to the
// canonical row without leaking adapter shape into the schema.
//
// See `migrations/2026_05_07_communication_threads.sql` for the full
// schema rationale + constraint set. Field names + check-constraint
// values match `shared/communicationsTypes.ts` exactly so the read
// service can map a SQL row → `CommunicationThread` without a
// translation layer.

export const communicationThreadTypes = [
  "client_sms",
  "team_chat",
  "unknown",
] as const;
export type CommunicationThreadTypeLiteral = (typeof communicationThreadTypes)[number];

export const communicationThreadScopes = [
  "tech_visible",
  "office",
  "tenant_global",
] as const;
export type CommunicationThreadScopeLiteral = (typeof communicationThreadScopes)[number];

export const communicationMessageDirections = [
  "inbound",
  "outbound",
  "internal",
] as const;
export type CommunicationMessageDirectionLiteral =
  (typeof communicationMessageDirections)[number];

export const communicationMessageChannels = [
  "sms",
  "internal_note",
  "team_chat",
  "voicemail",
  "system",
] as const;
export type CommunicationMessageChannelLiteral =
  (typeof communicationMessageChannels)[number];

export const communicationCallStatuses = [
  "completed",
  "missed",
  "voicemail",
  "in_progress",
  "failed",
] as const;
export type CommunicationCallStatusLiteral = (typeof communicationCallStatuses)[number];

export const communicationThreads = pgTable(
  "communication_threads",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    threadType: text("thread_type").notNull(),
    scope: text("scope").notNull().default("office"),
    contactId: varchar("contact_id").references(() => contactPersons.id, {
      onDelete: "set null",
    }),
    customerCompanyId: varchar("customer_company_id").references(
      () => customerCompanies.id,
      { onDelete: "set null" },
    ),
    locationId: varchar("location_id").references(() => clientLocations.id, {
      onDelete: "set null",
    }),
    jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
    teamUserId: varchar("team_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    phoneNumber: text("phone_number"),
    normalizedPhone: text("normalized_phone"),
    displayName: text("display_name"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    assignedUserIds: text("assigned_user_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    participantUserIds: text("participant_user_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (table) => ({
    tenantLastMsgIdx: index("idx_comm_threads_tenant_last_msg").on(
      table.companyId,
      table.lastMessageAt,
    ),
    tenantPhoneIdx: index("idx_comm_threads_tenant_phone").on(
      table.companyId,
      table.normalizedPhone,
    ),
  }),
);

export type CommunicationThreadRow = typeof communicationThreads.$inferSelect;
export type InsertCommunicationThread = typeof communicationThreads.$inferInsert;

export const communicationMessages = pgTable(
  "communication_messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id")
      .notNull()
      .references(() => communicationThreads.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    channel: text("channel").notNull(),
    body: text("body").notNull(),
    providerMessageId: text("provider_message_id"),
    senderUserId: varchar("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    senderDisplayName: text("sender_display_name"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (table) => ({
    threadCreatedIdx: index("idx_comm_messages_thread_created").on(
      table.threadId,
      table.createdAt,
    ),
    tenantCreatedIdx: index("idx_comm_messages_tenant_created").on(
      table.companyId,
      table.createdAt,
    ),
  }),
);

export type CommunicationMessageRow = typeof communicationMessages.$inferSelect;
export type InsertCommunicationMessage = typeof communicationMessages.$inferInsert;

export const communicationCalls = pgTable(
  "communication_calls",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id").references(() => communicationThreads.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull(),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    status: text("status").notNull(),
    durationSeconds: integer("duration_seconds"),
    recordingUrl: text("recording_url"),
    transcription: text("transcription"),
    providerCallId: text("provider_call_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (table) => ({
    tenantCreatedIdx: index("idx_comm_calls_tenant_created").on(
      table.companyId,
      table.createdAt,
    ),
    threadCreatedIdx: index("idx_comm_calls_thread_created").on(
      table.threadId,
      table.createdAt,
    ),
  }),
);

export type CommunicationCallRow = typeof communicationCalls.$inferSelect;
export type InsertCommunicationCall = typeof communicationCalls.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Communication Provider Settings — Phase 5 (2026-05-08)
// ────────────────────────────────────────────────────────────────────
// Encrypted-at-rest tenant credential row for the SMS infrastructure.
// See `migrations/2026_05_08_communication_provider_settings.sql` and
// `server/services/communications/providerCredentialCrypto.ts`.
export const communicationProviderSettings = pgTable(
  "communication_provider_settings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    phoneNumber: text("phone_number").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    accountIdentifier: text("account_identifier"),
    encryptedCredential: text("encrypted_credential").notNull(),
    credentialIv: text("credential_iv").notNull(),
    credentialTag: text("credential_tag").notNull(),
    encryptedWebhookSecret: text("encrypted_webhook_secret").notNull(),
    webhookSecretIv: text("webhook_secret_iv").notNull(),
    webhookSecretTag: text("webhook_secret_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (table) => ({
    companyProviderIdx: index("idx_comm_provider_settings_company_provider").on(
      table.companyId,
      table.providerId,
    ),
  }),
);

export type CommunicationProviderSettingsRow =
  typeof communicationProviderSettings.$inferSelect;
export type InsertCommunicationProviderSettings =
  typeof communicationProviderSettings.$inferInsert;

// ────────────────────────────────────────────────────────────────────
// Technician Time Off (2026-05-07 RALPH)
// ────────────────────────────────────────────────────────────────────
// First-class technician time-off scheduling. Each row blocks a single
// technician's availability for one date/time interval. The capacity
// service (`server/storage/capacity.ts`) reads overlapping rows and
// clips open slots around them; full-day coverage promotes the tech
// to `state: "off_today"` on the dashboard's Today widget.
//
// See migrations/2026_05_07_technician_time_off.sql for the canonical
// schema documentation + DB-level CHECK constraints.
export const TECHNICIAN_TIME_OFF_REASONS = [
  "vacation",
  "sick",
  "personal",
  "training",
  "unavailable",
  "other",
] as const;
export type TechnicianTimeOffReason =
  (typeof TECHNICIAN_TIME_OFF_REASONS)[number];

export const technicianTimeOff = pgTable(
  "technician_time_off",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    technicianUserId: varchar("technician_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    note: text("note"),
    createdByUserId: varchar("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    tenantTechRangeIdx: index("idx_technician_time_off_tenant_tech_range").on(
      table.companyId,
      table.technicianUserId,
      table.startsAt,
      table.endsAt,
    ),
  }),
);

export type TechnicianTimeOffRow = typeof technicianTimeOff.$inferSelect;
export type InsertTechnicianTimeOff = typeof technicianTimeOff.$inferInsert;

/** Zod schema for POST `/api/technician-time-off` body. */
export const insertTechnicianTimeOffSchema = z
  .object({
    technicianUserId: z.string().uuid(),
    reason: z.enum(TECHNICIAN_TIME_OFF_REASONS),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().default(false),
    note: z.string().max(500).optional().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      });
    }
  });

/** Zod schema for PATCH `/api/technician-time-off/:id` body. */
export const updateTechnicianTimeOffSchema = z
  .object({
    reason: z.enum(TECHNICIAN_TIME_OFF_REASONS).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    note: z.string().max(500).optional().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // If both endpoints supplied, end must be after start. (Single-
    // sided updates are validated against the persisted opposite end
    // by the route handler.)
    if (
      value.startsAt &&
      value.endsAt &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      });
    }
  });

export type TechnicianTimeOffInsertInput = z.infer<
  typeof insertTechnicianTimeOffSchema
>;
export type TechnicianTimeOffUpdateInput = z.infer<
  typeof updateTechnicianTimeOffSchema
>;

// ────────────────────────────────────────────────────────────────────
// Technician Schedule Overrides (2026-05-17 Phase 2 Team Schedule)
// ────────────────────────────────────────────────────────────────────
// Date-specific Working / Not Working overrides per technician.
// Sits between time-off (highest priority) and weekly working_hours
// (lowest) in the effective-schedule precedence stack.
//
// override_date is DATE (not timestamptz) — calendar-day semantic.
// Only one active override per (company_id, technician_user_id,
// override_date) is allowed; enforced by partial unique index.
// Archived rows are exempt, preserving the full history.
//
// See migrations/2026_05_17_technician_schedule_overrides.sql.
export const technicianScheduleOverrides = pgTable(
  "technician_schedule_overrides",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    technicianUserId: varchar("technician_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    overrideDate: date("override_date").notNull(),
    isWorking: boolean("is_working").notNull(),
    note: text("note"),
    createdByUserId: varchar("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    tenantTechDateIdx: index("idx_tech_schedule_overrides_tenant_tech_date").on(
      table.companyId,
      table.technicianUserId,
      table.overrideDate,
    ),
  }),
);

export type TechnicianScheduleOverrideRow =
  typeof technicianScheduleOverrides.$inferSelect;
export type InsertTechnicianScheduleOverride =
  typeof technicianScheduleOverrides.$inferInsert;

/** Zod schema for POST /api/team/:userId/schedule/overrides body. */
export const insertTechnicianScheduleOverrideSchema = z
  .object({
    overrideDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "overrideDate must be YYYY-MM-DD"),
    isWorking: z.boolean(),
    note: z.string().max(500).optional().nullable(),
  })
  .strict();

export type TechnicianScheduleOverrideInsertInput = z.infer<
  typeof insertTechnicianScheduleOverrideSchema
>;

// ============================================================================
// RECEIVABLES NOTES (2026-05-13 Phase 2A)
// ============================================================================
//
// Account/customer-scoped collections activity log. invoice_id and payment_id
// are optional — a single note can represent a conversation about a customer
// account that spans multiple invoices. When invoice_id is provided, certain
// note_types (promise_to_pay, dispute) also update denormalized fields on the
// invoices row atomically in the storage layer.
//
// DO NOT mix with invoice_notes. invoice_notes are first-class work-notes
// attached to a specific invoice (and can carry file attachments). Receivables
// notes are collections-workflow records: reminders, disputes, promises, etc.
//
// See migrations/2026_05_13_receivables_notes.sql.

export const receivablesNoteTypeEnum = [
  "general",
  "reminder",
  "promise_to_pay",
  "dispute",
  "escalation",
  "payment_received",
  "communication",
] as const;
export type ReceivablesNoteType = (typeof receivablesNoteTypeEnum)[number];

export const receivablesNotes = pgTable("receivables_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  customerCompanyId: varchar("customer_company_id").notNull().references(() => customerCompanies.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  paymentId: varchar("payment_id").references(() => payments.id, { onDelete: "set null" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  noteType: text("note_type").notNull(),
  noteText: text("note_text").notNull(),
  promisedAt: timestamp("promised_at"),
  contactMethod: text("contact_method"),
  outcome: text("outcome"),
  contactPersonId: varchar("contact_person_id").references(() => contactPersons.id, { onDelete: "set null" }),
  communicatedAt: timestamp("communicated_at", { withTimezone: true }),
  createdBySystem: boolean("created_by_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyCustomerIdx: index("receivables_notes_company_customer_idx")
    .on(table.companyId, table.customerCompanyId),
  companyInvoiceIdx: index("receivables_notes_company_invoice_idx")
    .on(table.companyId, table.invoiceId),
  companyCreatedAtIdx: index("receivables_notes_company_created_at_idx")
    .on(table.companyId, table.createdAt),
  companyNoteTypeIdx: index("receivables_notes_company_note_type_idx")
    .on(table.companyId, table.noteType),
}));

export type ReceivablesNote = typeof receivablesNotes.$inferSelect;
export type InsertReceivablesNote = typeof receivablesNotes.$inferInsert;

export const insertReceivablesNoteSchema = createInsertSchema(receivablesNotes).omit({
  id: true,
  companyId: true,
  userId: true,
  createdBySystem: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  noteType: z.enum(receivablesNoteTypeEnum),
  promisedAt: z.string().datetime({ offset: true }).nullable().optional(),
  contactMethod: z.string().max(100).nullable().optional(),
  outcome: z.string().max(100).nullable().optional(),
  contactPersonId: z.string().uuid().nullable().optional(),
  communicatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const updateReceivablesNoteSchema = z.object({
  noteText: z.string().min(1).max(5000).optional(),
  noteType: z.enum(receivablesNoteTypeEnum).optional(),
  promisedAt: z.string().datetime({ offset: true }).nullable().optional(),
  contactMethod: z.string().max(100).nullable().optional(),
  outcome: z.string().max(100).nullable().optional(),
  contactPersonId: z.string().uuid().nullable().optional(),
  communicatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type InsertReceivablesNoteInput = z.infer<typeof insertReceivablesNoteSchema>;
export type UpdateReceivablesNoteInput = z.infer<typeof updateReceivablesNoteSchema>;

// =============================================================================
// TEAM SKILLS — Phase 3 (2026-05-17)
// =============================================================================

/** Valid proficiency levels for a team member skill assignment. */
export const SKILL_LEVELS = ["basic", "intermediate", "advanced", "certified"] as const;
export type SkillLevel = typeof SKILL_LEVELS[number];

/** Company-scoped skill library entry. */
export const teamSkills = pgTable("team_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  requiresCertification: boolean("requires_certification").notNull().default(false),
  hasExpiryTracking: boolean("has_expiry_tracking").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  companyIdIdx: index("team_skills_company_id_idx").on(table.companyId),
}));

// =============================================================================
// JOB SKILL REQUIREMENTS — Phase 4 Skill-Aware Dispatch (2026-05-17)
// =============================================================================

/** Optional skill requirements attached to a specific job. */
export const jobRequiredSkills = pgTable("job_required_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id")
    .notNull()
    .references(() => teamSkills.id, { onDelete: "cascade" }),
  /** NULL = any level accepted. */
  minimumLevel: text("minimum_level"),
  /** true = dispatcher warned if assignee lacks skill; false = preferred only. */
  required: boolean("required").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyJobIdx: index("job_required_skills_company_job_idx").on(table.companyId, table.jobId),
  skillIdIdx: index("job_required_skills_skill_id_idx").on(table.skillId),
}));

/** Optional skill requirements attached to a reusable job template. */
export const jobTemplateRequiredSkills = pgTable("job_template_required_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  templateId: varchar("template_id")
    .notNull()
    .references(() => jobTemplates.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id")
    .notNull()
    .references(() => teamSkills.id, { onDelete: "cascade" }),
  minimumLevel: text("minimum_level"),
  required: boolean("required").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  companyTemplateIdx: index("job_template_required_skills_company_template_idx").on(table.companyId, table.templateId),
}));

/** Per-member skill assignment (links a user to a library skill with cert details). */
export const teamMemberSkills = pgTable("team_member_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  skillId: varchar("skill_id")
    .notNull()
    .references(() => teamSkills.id, { onDelete: "cascade" }),
  certificationName: text("certification_name"),
  certificationExpiresAt: timestamp("certification_expires_at"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  companyUserIdx: index("team_member_skills_company_user_idx").on(table.companyId, table.userId),
  skillIdIdx: index("team_member_skills_skill_id_idx").on(table.skillId),
}));

// =============================================================================
// TECHNICIAN SHIFT MANAGEMENT — Phase 1 (2026-05-18)
// =============================================================================
//
// Single canonical availability source for all technician scheduling.
// Replaces the ad-hoc time-off check in scheduling.ts.
//
// Row semantics:
//   One-off shift   recurrence_rule IS NULL  AND recurrence_parent_id IS NULL
//   Recurring base  recurrence_rule IS NOT NULL AND recurrence_parent_id IS NULL
//   Exception row   recurrence_parent_id IS NOT NULL (edit/cancel of one occurrence)
//
// The self-referential FK on technician_shifts (recurrence_parent_id → id)
// is expressed as a raw varchar here — Drizzle does not support self-
// referential .references() on the same table. The actual FK constraint
// with ON DELETE CASCADE is in the companion migration SQL.
//
// See migrations/2026_05_18_shift_enums.sql,
//     migrations/2026_05_18_technician_shift_templates.sql,
//     migrations/2026_05_18_technician_shifts.sql.

/** Top-level classification for every shift row. */
export const shiftTypeEnum = pgEnum("shift_type", ["normal", "on_call", "unavailable"]);

/** Reason code for unavailable shifts only. */
export const shiftSubtypeEnum = pgEnum("shift_subtype", [
  "vacation",
  "sick",
  "personal",
  "training",
  "holiday",
  "scheduled_off",
  "other",
]);

// ─── technician_shift_templates ─────────────────────────────────────────────

export const technicianShiftTemplates = pgTable(
  "technician_shift_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shiftType: shiftTypeEnum("shift_type").notNull(),
    shiftSubtype: shiftSubtypeEnum("shift_subtype"),
    label: text("label"),
    color: text("color"),
    /** Wall-clock start time "HH:MM". Both or neither must be set. */
    timeOfDayStart: text("time_of_day_start"),
    /** Wall-clock end time "HH:MM". Both or neither must be set. */
    timeOfDayEnd: text("time_of_day_end"),
    recurrenceRule: text("recurrence_rule"),
    isActive: boolean("is_active").notNull().default(true),
    /** Nullable: system-created templates may have no user author. */
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    companyIdx: index("idx_shift_templates_company").on(table.companyId),
  }),
);

export type TechnicianShiftTemplate = typeof technicianShiftTemplates.$inferSelect;
export type InsertTechnicianShiftTemplate = typeof technicianShiftTemplates.$inferInsert;

// ─── technician_shifts ──────────────────────────────────────────────────────

export const technicianShifts = pgTable(
  "technician_shifts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: varchar("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    technicianUserId: varchar("technician_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional reference to the template used to create this shift. */
    templateId: varchar("template_id").references(() => technicianShiftTemplates.id),
    shiftType: shiftTypeEnum("shift_type").notNull(),
    shiftSubtype: shiftSubtypeEnum("shift_subtype"),
    label: text("label"),
    color: text("color"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /** Wall-clock start time "HH:MM". Paired with timeOfDayEnd. */
    timeOfDayStart: text("time_of_day_start"),
    /** Wall-clock end time "HH:MM". Paired with timeOfDayStart. */
    timeOfDayEnd: text("time_of_day_end"),
    recurrenceRule: text("recurrence_rule"),
    recurrenceEndDate: date("recurrence_end_date"),
    /**
     * Self-referential FK: exception rows reference the recurring base shift.
     * Expressed as raw varchar — Drizzle does not support self-referential
     * .references() on the same table. The FK with ON DELETE CASCADE is in
     * the companion migration SQL.
     */
    recurrenceParentId: varchar("recurrence_parent_id"),
    /** Calendar date (YYYY-MM-DD in company tz) of the overridden occurrence. */
    occurrenceDate: date("occurrence_date"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    note: text("note"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    rangeIdx: index("idx_tech_shifts_range").on(
      table.companyId,
      table.technicianUserId,
      table.startsAt,
      table.endsAt,
    ),
    exceptionsIdx: index("idx_tech_shifts_exceptions").on(
      table.recurrenceParentId,
      table.occurrenceDate,
    ),
    oncallIdx: index("idx_tech_shifts_oncall").on(
      table.companyId,
      table.startsAt,
      table.endsAt,
    ),
    unavailableIdx: index("idx_tech_shifts_unavailable").on(
      table.companyId,
      table.technicianUserId,
      table.startsAt,
      table.endsAt,
    ),
  }),
);

export type TechnicianShift = typeof technicianShifts.$inferSelect;
export type InsertTechnicianShift = typeof technicianShifts.$inferInsert;

// ─── Zod schemas for the shift-management API ────────────────────────────────

const SHIFT_TYPES = ["normal", "on_call", "unavailable"] as const;
const SHIFT_SUBTYPES = [
  "vacation", "sick", "personal", "training",
  "holiday", "scheduled_off", "other",
] as const;

const timeOfDaySchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format");

export const insertShiftTemplateSchema = z
  .object({
    name: z.string().min(1).max(200),
    shiftType: z.enum(SHIFT_TYPES),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.shiftType === "unavailable" && !val.shiftSubtype) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shiftSubtype is required when shiftType is 'unavailable'",
        path: ["shiftSubtype"],
      });
    }
    if (val.shiftType !== "unavailable" && val.shiftSubtype) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shiftSubtype must be null when shiftType is not 'unavailable'",
        path: ["shiftSubtype"],
      });
    }
    const hasStart = !!val.timeOfDayStart;
    const hasEnd = !!val.timeOfDayEnd;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeOfDayStart and timeOfDayEnd must both be set or both be null",
        path: ["timeOfDayEnd"],
      });
    }
  });

export const updateShiftTemplateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    shiftType: z.enum(SHIFT_TYPES).optional(),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const insertShiftSchema = z
  .object({
    technicianUserId: z.string().uuid(),
    templateId: z.string().uuid().nullable().optional(),
    shiftType: z.enum(SHIFT_TYPES),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .nullable()
      .optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Date.parse(val.endsAt) <= Date.parse(val.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      });
    }
    if (val.shiftType === "unavailable" && !val.shiftSubtype) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shiftSubtype is required when shiftType is 'unavailable'",
        path: ["shiftSubtype"],
      });
    }
    if (val.shiftType !== "unavailable" && val.shiftSubtype) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shiftSubtype must be null when shiftType is not 'unavailable'",
        path: ["shiftSubtype"],
      });
    }
    const hasStart = !!val.timeOfDayStart;
    const hasEnd = !!val.timeOfDayEnd;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeOfDayStart and timeOfDayEnd must both be set or both be null",
        path: ["timeOfDayEnd"],
      });
    }
    if (val.allDay && val.timeOfDayStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeOfDayStart must be null when allDay is true",
        path: ["timeOfDayStart"],
      });
    }
  });

export const updateShiftSchema = z
  .object({
    shiftType: z.enum(SHIFT_TYPES).optional(),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
    recurrenceEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .nullable()
      .optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const insertShiftExceptionSchema = z
  .object({
    occurrenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    isCancelled: z.boolean().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    shiftType: z.enum(SHIFT_TYPES).optional(),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.startsAt && val.endsAt && Date.parse(val.endsAt) <= Date.parse(val.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      });
    }
  });

export const updateShiftExceptionSchema = z
  .object({
    occurrenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .optional(),
    isCancelled: z.boolean().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    allDay: z.boolean().optional(),
    timeOfDayStart: timeOfDaySchema.nullable().optional(),
    timeOfDayEnd: timeOfDaySchema.nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    shiftType: z.enum(SHIFT_TYPES).optional(),
    shiftSubtype: z.enum(SHIFT_SUBTYPES).nullable().optional(),
    label: z.string().max(100).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
  })
  .strict();

export const availabilityQuerySchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    technicianUserIds: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Date.parse(val.end) <= Date.parse(val.start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "end must be strictly after start",
        path: ["end"],
      });
    }
  });

export const validateAssignmentSchema = z
  .object({
    technicianUserId: z.string().uuid(),
    proposedStart: z.string().datetime({ offset: true }),
    proposedEnd: z.string().datetime({ offset: true }),
    ignoreUnavailable: z.boolean().optional(),
    excludeShiftId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Date.parse(val.proposedEnd) <= Date.parse(val.proposedStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "proposedEnd must be strictly after proposedStart",
        path: ["proposedEnd"],
      });
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// 2026-05-18 RALPH: Flat-Rate Service Templates
//
// A service_template is a single customer-facing line item with a flat_rate_price.
// Internally it is composed of service_template_components referencing catalog
// items (services/products) for cost estimation and operational guidance only.
// Components are NEVER exposed on invoices or synced to QBO.
// ─────────────────────────────────────────────────────────────────────────────

export const serviceTemplates = pgTable("service_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),

  name: text("name").notNull(),
  internalName: text("internal_name"),
  description: text("description"),
  internalNotes: text("internal_notes"),
  category: text("category"),
  subcategory: text("subcategory"),

  flatRatePrice: numeric("flat_rate_price", { precision: 12, scale: 2 }).notNull().default("0"),
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  requiredSkillTags: text("required_skill_tags").array().notNull().default(sql`'{}'::text[]`),
  teamSizeRequired: integer("team_size_required").notNull().default(1),

  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),

  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`NOW()`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  lookupIdx: index("idx_svc_templates_lookup")
    .on(table.companyId, table.isActive, table.usageCount),
}));

export const serviceTemplateComponents = pgTable("service_template_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").notNull().references(() => serviceTemplates.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").notNull().references(() => items.id, { onDelete: "restrict" }),

  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unitCostSnapshot: numeric("unit_cost_snapshot", { precision: 12, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),

  createdAt: timestamp("created_at").notNull().default(sql`NOW()`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  lookupIdx: index("idx_svc_template_components_lookup")
    .on(table.companyId, table.templateId, table.sortOrder),
}));

export const insertServiceTemplateSchema = createInsertSchema(serviceTemplates).omit({
  id: true,
  companyId: true,
  userId: true,
  usageCount: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceTemplateComponentSchema = createInsertSchema(serviceTemplateComponents).omit({
  id: true,
  companyId: true,
  templateId: true,
  createdAt: true,
  updatedAt: true,
});

export type ServiceTemplate = typeof serviceTemplates.$inferSelect;
export type InsertServiceTemplate = z.infer<typeof insertServiceTemplateSchema>;
export type ServiceTemplateComponent = typeof serviceTemplateComponents.$inferSelect;
export type InsertServiceTemplateComponent = z.infer<typeof insertServiceTemplateComponentSchema>;

export interface ServiceTemplateWithComponents extends ServiceTemplate {
  components: (ServiceTemplateComponent & {
    itemName: string | null;
    itemType: string | null;
  })[];
}

