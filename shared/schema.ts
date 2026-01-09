import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, date, numeric, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

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
  lastLoginAt: timestamp("last_login_at"),
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

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

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

// Customer Companies - Parent entities that map to QBO Customers
// These represent the corporate entity (e.g. "ABC Holdings Inc")
export const customerCompanies = pgTable("customer_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // Company information
  name: text("name").notNull(), // Main company name (maps to QBO DisplayName for parent)
  legalName: text("legal_name"), // Official legal name if different
  phone: text("phone"),
  email: text("email"),
  // Billing address (used for QBO BillAddr)
  billingStreet: text("billing_street"),
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
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

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

// Client Locations - Child entities that map to QBO Sub-Customers
// These represent specific sites/locations (e.g. "Toronto Warehouse")
export const clientLocations = pgTable("client_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Parent company reference (optional - if null, this is a standalone client)
  parentCompanyId: varchar("parent_company_id").references(() => customerCompanies.id, { onDelete: "set null" }),
  companyName: text("company_name").notNull(),
  location: text("location"), // Location/site name (e.g. "Toronto Warehouse")
  // Service address
  address: text("address"),
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
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
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const insertClientLocationSchema = createInsertSchema(clientLocations).omit({
  id: true,
  companyId: true,
  userId: true,
  createdAt: true,
});

// Legacy aliases for backward compatibility during migration
export const clients = clientLocations; // Table alias
export const insertClientSchema = insertClientLocationSchema;
export type Client = typeof clientLocations.$inferSelect;
export type ClientLocation = typeof clientLocations.$inferSelect;
export type InsertClient = z.infer<typeof insertClientLocationSchema>;
export type InsertClientLocation = z.infer<typeof insertClientLocationSchema>;

// Items table - represents products and services for QuickBooks Online sync
// These Items are designed to sync to QuickBooks Online Items in the future.
// The app is currently the primary master for item details, and QBO mapping will be handled via qboItemId.
export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  // QBO sync fields for Items
  qboItemId: text("qbo_item_id"), // QBO Item id if/when synced
  qboSyncToken: text("qbo_sync_token"), // QBO sync token if needed
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

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
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
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
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
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

export const calendarAssignments = pgTable("calendar_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  jobNumber: integer("job_number").notNull(),
  assignedTechnicianIds: varchar("assigned_technician_ids").array(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  day: integer("day"),
  scheduledDate: date("scheduled_date").notNull(), // FIXED: Changed from text() to date()
  scheduledHour: integer("scheduled_hour"),
  scheduledStartMinutes: integer("scheduled_start_minutes"), // Time of day in minutes (0-1439), e.g., 540 = 9:00 AM
  durationMinutes: integer("duration_minutes").default(60), // Duration in minutes (15-minute increments), default 60
  autoDueDate: boolean("auto_due_date").notNull().default(true),
  completed: boolean("completed").notNull().default(false),
  completionNotes: text("completion_notes"),
});

// Company counters table - tracks sequential counters per company (e.g., job numbers, invoice numbers)
export const companyCounters = pgTable("company_counters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique().references(() => companies.id, { onDelete: "cascade" }),
  nextJobNumber: integer("next_job_number").notNull().default(10000),
  nextInvoiceNumber: integer("next_invoice_number").notNull().default(1001),
});

export const updateCompanyCountersSchema = z.object({
  nextJobNumber: z.number().int().positive().optional(),
  nextInvoiceNumber: z.number().int().positive().optional(),
});

export type UpdateCompanyCounters = z.infer<typeof updateCompanyCountersSchema>;
export type CompanyCounters = typeof companyCounters.$inferSelect;

export const insertCalendarAssignmentSchema = createInsertSchema(calendarAssignments).omit({
  id: true,
  companyId: true,
  userId: true,
  jobNumber: true,
});

export const updateCalendarAssignmentSchema = z.object({
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  scheduledDate: z.date().nullable().optional(), // FIXED: Changed from z.string() to z.date()
  scheduledHour: z.number().int().min(0).max(23).nullable().optional(),
  scheduledStartMinutes: z.number().int().min(0).max(1439).nullable().optional(), // 0-1439 (minutes in a day)
  durationMinutes: z.number().int().min(15).max(720).nullable().optional(), // 15 min to 12 hours
  autoDueDate: z.boolean().optional(),
  completed: z.boolean().optional(),
  completionNotes: z.string().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()).optional(),
  assignedTechnicianId: z.string().nullable().optional(), // Legacy support
});

export type InsertCalendarAssignment = z.infer<typeof insertCalendarAssignmentSchema>;
export type UpdateCalendarAssignment = z.infer<typeof updateCalendarAssignmentSchema>;
export type CalendarAssignment = typeof calendarAssignments.$inferSelect;

export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"),
  modelNumber: text("model_number"),
  serialNumber: text("serial_number"),
  location: text("location"),
  notes: text("notes"),
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
// USER INVITATIONS (dispatch software access) - single-company system
// ============================================================================
export const invitationStatusEnum = ["pending", "accepted", "expired", "revoked"] as const;
export type InvitationStatus = typeof invitationStatusEnum[number];

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
  isActive: boolean("is_active").notNull().default(true),
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

// Client notes table - stores multiple timestamped notes per client
export const clientNotes = pgTable("client_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  noteText: text("note_text").notNull(),
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
});

export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type UpdateClientNote = z.infer<typeof updateClientNoteSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;

// Invoice statuses
export const invoiceStatusEnum = ["draft", "sent", "viewed", "partial_paid", "paid", "voided"] as const;
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
  // Tracking
  sentAt: timestamp("sent_at"), // When invoice was sent to client
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
  // Status
  dirty: boolean("dirty").notNull().default(false), // True if edited after last sync
  isActive: boolean("is_active").notNull().default(true), // Soft delete / void
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
  isActive: z.boolean().optional(),
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Invoice line items table
export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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

// Job status enum values
export const jobStatusEnum = [
  "draft",
  "scheduled", 
  "dispatched",
  "en_route",
  "on_site",
  "in_progress",
  "needs_parts",
  "on_hold",
  "completed",
  "invoiced",
  "closed",
  "archived",
  "cancelled"
] as const;
export type JobStatus = typeof jobStatusEnum[number];

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
  isActive: boolean("is_active").notNull().default(true),
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
  // Assignment
  primaryTechnicianId: varchar("primary_technician_id").references(() => users.id, { onDelete: "set null" }),
  assignedTechnicianIds: varchar("assigned_technician_ids").array(),
  // Status and classification
  status: text("status").notNull().default("draft"),
  priority: text("priority").notNull().default("medium"),
  jobType: text("job_type").notNull().default("maintenance"),
  // Job details
  summary: text("summary").notNull(),
  description: text("description"),
  accessInstructions: text("access_instructions"),
  // Scheduling
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
  actualStart: timestamp("actual_start"),
  actualEnd: timestamp("actual_end"),
  // Billing
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  qboInvoiceId: text("qbo_invoice_id"),
  billingNotes: text("billing_notes"),
  // Recurrence linkage
  recurringSeriesId: varchar("recurring_series_id").references(() => recurringJobSeries.id, { onDelete: "set null" }),
  // Calendar assignment linkage (for backward compatibility during migration)
  calendarAssignmentId: varchar("calendar_assignment_id").references(() => calendarAssignments.id, { onDelete: "set null" }),
  // Soft deletion / state
  isActive: boolean("is_active").notNull().default(true),
  // Optimistic locking
  version: integer("version").notNull().default(0), // Incremented on every update
  // Metadata
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  jobNumberPerCompany: uniqueIndex("jobs_company_job_number_uq").on(table.companyId, table.jobNumber),
}));

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  companyId: true,
  jobNumber: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(jobStatusEnum).default("draft"),
  priority: z.enum(jobPriorityEnum).default("medium"),
  jobType: z.enum(jobTypeEnum).default("maintenance"),
  scheduledStart: z.string().nullable().optional(), // Accept ISO string
  scheduledEnd: z.string().nullable().optional(),
});

export const updateJobSchema = z.object({
  locationId: z.string().optional(),
  primaryTechnicianId: z.string().nullable().optional(),
  assignedTechnicianIds: z.array(z.string()).nullable().optional(),
  status: z.enum(jobStatusEnum).optional(),
  priority: z.enum(jobPriorityEnum).optional(),
  jobType: z.enum(jobTypeEnum).optional(),
  summary: z.string().optional(),
  description: z.string().nullable().optional(),
  accessInstructions: z.string().nullable().optional(),
  scheduledStart: z.string().nullable().optional(),
  scheduledEnd: z.string().nullable().optional(),
  actualStart: z.string().nullable().optional(),
  actualEnd: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  qboInvoiceId: z.string().nullable().optional(),
  billingNotes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ============================================================================
// LOCATION PM PLAN - Preventative Maintenance schedule per location
// ============================================================================
// This table will be used to calculate part demand per month across all locations.
// Example: sum quantityPerVisit for all PM visits scheduled in a month to get 
// projected filter/belt requirements for inventory planning.
export const locationPMPlans = pgTable("location_pm_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  isActive: boolean("is_active").notNull().default(true),
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
  isActive: boolean("is_active").notNull().default(true),
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
  isActive: z.boolean().optional(),
});

export type InsertLocationEquipment = z.infer<typeof insertLocationEquipmentSchema>;
export type UpdateLocationEquipment = z.infer<typeof updateLocationEquipmentSchema>;
export type LocationEquipment = typeof locationEquipment.$inferSelect;

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
  locationId: varchar("location_id").notNull().references(() => clientLocations.id, { onDelete: "cascade" }),
  productId: varchar("product_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  equipmentId: varchar("equipment_id").references(() => locationEquipment.id, { onDelete: "set null" }), // Optional link to specific equipment
  descriptionOverride: text("description_override"), // Custom description for job/invoice
  quantityPerVisit: text("quantity_per_visit").notNull(), // Stored as text for decimal precision
  equipmentLabel: text("equipment_label"), // Legacy: e.g. "RTU #1", "Freezer 3" - use equipmentId when possible
  isActive: boolean("is_active").notNull().default(true),
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
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => items.id, { onDelete: "set null" }),
  equipmentId: varchar("equipment_id").references(() => locationEquipment.id, { onDelete: "set null" }), // Optional link to equipment
  description: text("description").notNull(),
  quantity: text("quantity").notNull(), // Stored as text for decimal precision
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }), // Cost per unit (for profit margin calc)
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }), // Price per unit // pm_template, added_by_tech, quoted, manual
  equipmentLabel: text("equipment_label"), // Legacy: Copied from PM template or added by tech
  sortOrder: integer("sort_order").notNull().default(0), // For ordering line items in Parts & Billing
  isActive: boolean("is_active").notNull().default(true),
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

export const jobVisitStatusEnum = [
  "scheduled",
  "dispatched",
  "en_route",
  "on_site",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled"
] as const;
export type JobVisitStatus = typeof jobVisitStatusEnum[number];

export const jobVisits = pgTable("job_visits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),

  // Scheduling
  scheduledDate: timestamp("scheduled_date").notNull(),
  estimatedDurationMinutes: integer("estimated_duration_minutes").default(60),

  // Assignment
  assignedTechnicianId: varchar("assigned_technician_id").references(() => users.id, { onDelete: "set null" }),

  // Status tracking
  status: text("status").notNull().default("scheduled"),

  // Time tracking
  checkedInAt: timestamp("checked_in_at"),
  checkedOutAt: timestamp("checked_out_at"),
  actualDurationMinutes: integer("actual_duration_minutes"), // Auto-calculated on checkout

  // Notes
  visitNotes: text("visit_notes"),

  // Soft deletion
  isActive: boolean("is_active").notNull().default(true),

  // Optimistic locking
  version: integer("version").notNull().default(0),

  // Audit timestamps
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
});

export const insertJobVisitSchema = createInsertSchema(jobVisits).omit({
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  actualDurationMinutes: true, // Auto-calculated
}).extend({
  status: z.enum(jobVisitStatusEnum).default("scheduled"),
  scheduledDate: z.string(), // Accept ISO string
  estimatedDurationMinutes: z.number().int().positive().default(60),
});

export const updateJobVisitSchema = z.object({
  scheduledDate: z.string().optional(),
  estimatedDurationMinutes: z.number().int().positive().optional(),
  assignedTechnicianId: z.string().nullable().optional(),
  status: z.enum(jobVisitStatusEnum).optional(),
  visitNotes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
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
  isActive: boolean("is_active").notNull().default(true),
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

  // Optional attribution to a Job and Client (does NOT create billing or calendar coupling)
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  clientId: varchar("client_id").references(() => clientLocations.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Indexes for common queries
  companyAssignedIdx: uniqueIndex("tasks_company_assigned_idx").on(table.companyId, table.assignedToUserId),
  companyStatusIdx: uniqueIndex("tasks_company_status_idx").on(table.companyId, table.status),
  companyJobIdx: uniqueIndex("tasks_company_job_idx").on(table.companyId, table.jobId),
  companyClientIdx: uniqueIndex("tasks_company_client_idx").on(table.companyId, table.clientId),
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
  isActive: boolean("is_active").notNull().default(true),
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
  city: text("city"),
  province: text("province"),
  postalCode: text("postal_code"),
  country: text("country"),
  // Contact information
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  // Status
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
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
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
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
// SESSION TABLE (used by express-session / passport store)
// Keep this defined so Drizzle does NOT try to drop the existing DB table.
// ============================================================================
export const session = pgTable("session", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});