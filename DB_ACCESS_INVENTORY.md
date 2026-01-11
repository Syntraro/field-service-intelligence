# Direct DB Access Inventory (Outside Storage Layer)

Generated: 2026-01-11
Updated: 2026-01-11 (Final Foundation Cleanup complete)

## Summary
**Before:** 15 files with direct database imports outside `server/storage/**`
**After:** 2 files remaining (Stripe only - low priority)

All core application files have been refactored to use the storage layer.

## Refactoring Status

### Completed (Moved to Storage)
| File | New Storage Location | Status |
|------|---------------------|--------|
| `server/services/technicians.ts` | `server/storage/technicians.ts` | DONE |
| `server/services/audit.ts` | `server/storage/audit.ts` | DONE |
| `server/auditService.ts` | `server/storage/audit.ts` | DONE |
| `server/services/invitations.ts` | `server/storage/invitations.ts` | DONE - SECURITY FIX |
| `server/services/invitations_resend.ts` | `server/storage/invitations.ts` | DONE - SECURITY FIX |
| `server/services/jobNotes.service.ts` | `server/storage/jobNotes.ts` | DONE |
| `server/services/jobVisits.service.ts` | `server/storage/jobVisits.ts` | DONE |
| `server/routes/suppliers.ts` | `server/storage/suppliers.ts` | DONE |
| `server/routes/users_admin.ts` | `server/storage/users.ts` | DONE |
| `server/services/invoiceDirty.ts` | N/A (placeholder) | DONE - no DB needed |
| `server/permissions.ts` | `server/storage/permissions.ts` | DONE |
| `server/services/tasks.service.ts` | `server/storage/tasks.ts` | DONE |
| `server/routes/clients.ts` | `server/storage/customerCompanies.ts` | DONE |
| `server/routes/customer-companies.ts` | `server/storage/customerCompanies.ts` | DONE |
| `server/routes/client-notes.ts` | `server/storage/clientNotes.ts` | DONE |

### Remaining (Acceptable - Low Priority)
| File | Reason | Priority |
|------|--------|----------|
| `server/stripe/stripeService.ts` | Queries stripe.* schema (external) | LOW |
| `server/stripe/webhookHandlers.ts` | Webhook processing, special case | LOW |

**Note:** Stripe files access external `stripe.*` schema tables and are acceptable exceptions.

## Inventory Table (Original)

| # | File | Function(s) | Table(s) | companyId Scope | Soft Delete | Priority |
|---|------|-------------|----------|-----------------|-------------|----------|
| 1 | `server/services/technicians.ts` | `createTechnician` | `technicians` | YES | N/A | HIGH |
| 2 | `server/services/audit.ts` | `writeAuditLog` | `companyAuditLogs` | YES | N/A | HIGH |
| 3 | `server/auditService.ts` | `log`, `getLogsForAdmin`, `getLogsForCompany`, `getRecentLogs` | `auditLogs` | Partial | N/A | HIGH |
| 4 | `server/permissions.ts` | `getUserEffectivePermissions`, `getRolesWithPermissions`, `getPermissionsGrouped` | `users`, `roles`, `permissions`, `rolePermissions`, `userPermissionOverrides` | NO (global) | NO | HIGH |
| 5 | `server/services/invitations.ts` | `createInvitation`, `acceptInvitation`, `resendInvitation` | `invitations`, `users` | YES | NO | HIGH |
| 6 | `server/services/invitations_resend.ts` | `resendInvitation` | `invitations` | **NO** | NO | CRITICAL |
| 7 | `server/services/invoiceDirty.ts` | `markInvoiceDirty` | `invoices` | N/A (placeholder) | N/A | LOW |
| 8 | `server/services/jobNotes.service.ts` | `listJobNotes`, `createJobNote`, `updateJobNote`, `deleteJobNote` | `jobNotes`, `jobs`, `users` | YES | Hard delete | HIGH |
| 9 | `server/services/jobVisits.service.ts` | All CRUD operations | `jobVisits`, `jobs` | YES | Soft (isActive) | HIGH |
| 10 | `server/services/tasks.service.ts` | All CRUD operations | `tasks`, `supplierVisitDetails` | YES | NO | HIGH |
| 11 | `server/stripe/stripeService.ts` | `getSubscription`, `getProduct`, `getPrice`, `listActivePrices` | `stripe.*` tables | N/A (Stripe) | N/A | MEDIUM |
| 12 | `server/stripe/webhookHandlers.ts` | `processWebhook` | `companies` | N/A (webhook) | N/A | MEDIUM |
| 13 | `server/routes/suppliers.ts` | All CRUD operations | `suppliers`, `supplierLocations` | YES | Soft (isActive) | HIGH |
| 14 | `server/routes/users_admin.ts` | `updateRole`, `disable` | `users` | YES | NO | HIGH |
| 15 | `server/routes/customer-companies.ts` | Various queries | `customerCompanies`, `clients`, `jobs`, `invoices` | YES | NO | HIGH |
| 16 | `server/routes/clients.ts` | Various queries | `customerCompanies`, `clients`, `jobs`, `invoices` | YES | Partial | MEDIUM |
| 17 | `server/routes/client-notes.ts` | Note CRUD | `clientNotes`, `clients` | YES | NO | ALREADY DONE |

## Critical Issues Found

### 1. Missing Tenant Isolation (CRITICAL)
- `server/services/invitations_resend.ts:resendInvitation()` - queries by ID only, no companyId check

### 2. No Soft Delete Filtering
- `server/services/invitations.ts` - doesn't check invitation deletedAt
- `server/services/jobNotes.service.ts` - hard deletes notes
- `server/routes/users_admin.ts` - doesn't filter disabled users
- `server/routes/customer-companies.ts` - doesn't filter deleted clients

### 3. Global Tables (Acceptable but need centralization)
- `server/permissions.ts` - roles/permissions are global, but queries should be in storage

### 4. Stripe Tables (Special Case)
- `server/stripe/stripeService.ts` - accesses `stripe.*` schema, may need separate handling

## Phase 2 Action Plan

### Batch 1: Services (High Priority)
1. Create `server/storage/technicians.ts` - move technician queries
2. Create `server/storage/audit.ts` - move audit log queries
3. Extend `server/storage/users.ts` - add invitation methods
4. Create `server/storage/jobNotes.ts` - move job notes queries
5. Create `server/storage/jobVisits.ts` - move job visits queries
6. Move tasks queries to storage (already in service, needs refactor)

### Batch 2: Routes (Medium Priority)
1. Create `server/storage/suppliers.ts` - move supplier queries
2. Extend `server/storage/users.ts` - add admin update methods
3. Move customer-companies queries to storage

### Batch 3: Permissions & Stripe (Lower Priority)
1. Create `server/storage/permissions.ts` - centralize permission queries
2. Consider `server/storage/stripe.ts` for Stripe data access
