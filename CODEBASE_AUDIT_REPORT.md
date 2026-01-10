# Comprehensive Codebase Audit Report

**Date:** January 10, 2026
**Application:** HVAC/R Preventive Maintenance SaaS
**Scope:** Full application audit - Frontend, Backend, Database, Security, Scalability

---

## Executive Summary

This audit identified **150+ issues** across 6 categories. The most critical issues are:

1. **65+ frontend files** using outdated `apiRequest` signature (blocking)
2. **Missing imports** causing runtime crashes (`clientNotesRouter`, `recurringJobPhases`)
3. **Missing storage exports** (`getParts`, `createPart`, etc.) breaking routes
4. **N+1 query patterns** in client import causing severe performance issues
5. **Unbounded queries** risking memory overflow at scale

---

## Table of Contents

1. [Critical Issues (Blocking)](#1-critical-issues-blocking)
2. [Frontend Issues](#2-frontend-issues)
3. [Backend Issues](#3-backend-issues)
4. [Database Schema Issues](#4-database-schema-issues)
5. [Security Issues](#5-security-issues)
6. [Scalability Issues](#6-scalability-issues)
7. [Prioritized Fix Plan](#7-prioritized-fix-plan)

---

## 1. Critical Issues (Blocking)

### 1.1 Missing Router Import - Server Crash
**File:** `server/routes/index.ts` line 110
**Issue:** `clientNotesRouter` is used but never imported
```typescript
app.use("/api", clientNotesRouter);  // undefined - will crash on startup
```
**Fix:** Add import: `import clientNotesRouter from "./client-notes";`

### 1.2 Missing Schema Import - Runtime Error
**File:** `server/storage/jobs.ts` lines 562, 584
**Issue:** `recurringJobPhases` table is used but not imported
```typescript
await tx.insert(recurringJobPhases).values(phasesToCreate);  // ReferenceError
```
**Fix:** Add to imports: `recurringJobPhases` from `@shared/schema`

### 1.3 Missing Storage Exports - Broken Routes
**File:** `server/storage/index.ts`
**Issue:** `partRepository` methods not exported but called in routes
- `storage.getParts()` - called in `routes/parts.ts:47`
- `storage.createPart()` - called in `routes/parts.ts:62`, `routes/clients.ts:394`
- `storage.updatePart()` - called in `routes/parts.ts:73`
- `storage.deletePart()` - called in `routes/parts.ts:83`

**Fix:** Add to IStorage interface and storage object:
```typescript
// Interface
getParts: typeof partRepository.getParts;
createPart: typeof partRepository.createPart;
updatePart: typeof partRepository.updatePart;
deletePart: typeof partRepository.deletePart;

// Object
getParts: partRepository.getParts.bind(partRepository),
createPart: partRepository.createPart.bind(partRepository),
updatePart: partRepository.updatePart.bind(partRepository),
deletePart: partRepository.deletePart.bind(partRepository),
```

---

## 2. Frontend Issues

### 2.1 apiRequest Signature Migration (65+ files)

The `apiRequest` function was changed from `apiRequest(method, url, body)` to `apiRequest(url, options)`.

**Files with incorrect pattern:**

| File | Line Count | Priority |
|------|------------|----------|
| `pages/Calendar.tsx` | 12 instances | HIGH |
| `components/JobDetailDialog.tsx` | 11 instances | HIGH |
| `pages/LocationDetailPage.tsx` | 10 instances | HIGH |
| `pages/Admin.tsx` | 8 instances | HIGH |
| `components/PartsBillingCard.tsx` | 5 instances | MEDIUM |
| `components/LocationPMSection.tsx` | 5 instances | MEDIUM |
| `pages/JobDetailPage.tsx` | 5 instances | MEDIUM |
| `pages/Dashboard.tsx` | 3 instances | MEDIUM |
| ... and 40+ more files | | |

**Correct Pattern:**
```typescript
// OLD (incorrect)
await apiRequest("POST", "/api/items", { name: "test" });

// NEW (correct)
await apiRequest("/api/items", {
  method: "POST",
  body: JSON.stringify({ name: "test" })
});
```

### 2.2 Double JSON Parsing (25+ instances)

Many files call `.json()` on already-parsed `apiRequest` results:
```typescript
// WRONG - apiRequest already returns parsed JSON
const res = await apiRequest(...);
const data = await res.json();  // Error: res is already an object

// CORRECT
const data = await apiRequest(...);  // Returns parsed data directly
```

**Affected files:** AddClientPage, PartsManagementPage, ClientNotesTab, LocationEquipmentSection, LocationPMSection, PartsManagementDialog, EquipmentList, and more.

### 2.3 Query Key Inconsistency

Two conflicting patterns cause cache invalidation bugs:
```typescript
// Pattern A (array)
queryKey: ["/api/clients", clientId, "notes"]

// Pattern B (template literal)
queryKey: [`/api/clients/${clientId}/notes`]
```

**Recommendation:** Standardize on array pattern for all queries.

### 2.4 Oversized Components

| File | Lines | Recommended Max |
|------|-------|-----------------|
| `pages/Calendar.tsx` | 2,044 | 300 |
| `components/ProductsServicesManager.tsx` | 1,106 | 300 |
| `pages/Dashboard.tsx` | 986 | 300 |

---

## 3. Backend Issues

### 3.1 Missing asyncHandler Wrappers

Routes without proper error handling:
- `server/routes/invitations.ts`
- `server/routes/users_admin.ts`
- `server/routes/technicians.ts`
- `server/routes/calendar.ts`

### 3.2 userId Bug in Storage Layer

**File:** `server/storage/parts.ts` line 64
```typescript
userId: companyId,  // BUG - uses companyId instead of actual userId
```

Same bug in `server/storage/company.ts` line 54.

### 3.3 Debug Logging in Production

**Files with console.log statements:**
- `server/storage/items.ts` lines 54-84
- `server/routes/items.ts` lines 48, 55, 61-94

### 3.4 Incomplete Implementations

- `storage/company.ts:getImpersonationStatus()` - Returns hardcoded defaults
- Various placeholder endpoints returning empty arrays

---

## 4. Database Schema Issues

### 4.1 Tenant Isolation Gaps

Tables missing `companyId`:
- `roles` - System-wide (intentional?)
- `permissions` - System-wide (intentional?)
- `rolePermissions` - System-wide
- `userPermissionOverrides` - Should have companyId
- `recurringJobPhases` - Only has seriesId FK

### 4.2 Naming Inconsistency: clientId vs locationId

**Tables using `clientId` (legacy):**
- clientParts, maintenanceRecords, calendarAssignments, equipment, clientNotes, tasks

**Tables using `locationId` (new standard):**
- invoices, recurringJobSeries, jobs, locationPMPlans, locationEquipment, locationPMPartTemplates

**Recommendation:** Standardize on `locationId`.

### 4.3 Soft Delete Inconsistency

| Pattern | Tables Using It |
|---------|-----------------|
| `deletedAt` only | users, customerCompanies, clientLocations, items, equipment |
| `isActive` only | jobParts, locationEquipment, jobs, invoices, jobTemplates |
| Both | None currently |

**Recommendation:** Standardize on `deletedAt` + exclude in queries.

### 4.4 Missing Indexes

Critical indexes needed for performance:
- `calendarAssignments(companyId, clientId, scheduledDate)`
- `jobParts(jobId, productId)`
- `locationPMPartTemplates(locationId, productId)`
- `clientNotes(clientId, createdAt)`
- `jobNotes(jobId, createdAt)`

### 4.5 Data Type Inconsistency

`companySettings.updatedAt` is TEXT but should be TIMESTAMP (line 403).

---

## 5. Security Issues

### 5.1 Missing Tenant Validation

**File:** `server/routes/invitations.ts` lines 52-66
```typescript
router.post("/:id/resend", requireRole(["admin", "dispatcher"]), async (req, res) => {
  // Does NOT verify invitation belongs to req.companyId before resending
  const { token, expiresAt } = await resendInvitation(req.params.id);
});
```

### 5.2 Missing Input Validation

**File:** `server/routes/clientParts.ts` lines 11-18
```typescript
router.post("/bulk", requireRole(MANAGER_ROLES), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body?.items ?? []);
  // NO ZOD VALIDATION - accepts any payload
  const result = await storage.upsertClientPartsBulk(companyId, userId, items);
});
```

### 5.3 Direct DB Queries Bypassing Storage

Services making direct Drizzle calls:
- `server/services/technicians.ts` - Direct `db.insertInto`
- `server/services/audit.ts` - Direct `db.insert`
- `server/permissions.ts` - Multiple direct DB calls

### 5.4 Password Hashing Assumption

`server/services/invitations.ts` line 51 assumes password is pre-hashed but doesn't verify.

---

## 6. Scalability Issues

### 6.1 N+1 Query Patterns (Critical)

**File:** `server/routes/clients.ts` lines 382-435
```typescript
for (const clientData of clients) {
    await storage.createClient(...);       // Query 1
    for (const partData of parts) {
        await storage.createPart(...);     // Query 2
        await storage.addClientPart(...);  // Query 3
    }
    for (const equipData of equipment) {
        await storage.createEquipment(...); // Query 4
    }
}
// 100 clients × 5 parts × 3 equipment = 1,300 sequential queries!
```

### 6.2 Unbounded Queries (Memory Risk)

| Endpoint | Issue | Risk |
|----------|-------|------|
| `/api/parts` | Loads ALL into memory, then paginates | HIGH |
| `/api/clients/:id/overview` | No limit on jobs/invoices | HIGH |
| `/api/customer-companies/:id/overview` | No limit on jobs/invoices | HIGH |
| `storage.getAllClients()` | Returns all without limit | MEDIUM |
| `storage.getAllCalendarAssignments()` | Returns all without limit | MEDIUM |

### 6.3 Missing Request Size Limits

Import endpoints accept unbounded arrays:
- `POST /api/clients/import-simple`
- `POST /api/clients/import`

10,000 clients × 100KB = 1GB payload risk.

### 6.4 Missing Caching

Frequently-accessed data without caching:
- Team members list (queried on every assignment)
- Calendar assignments (queried on every calendar view)
- Permission checks (mitigated with 5-min cache)

---

## 7. Prioritized Fix Plan

### Phase 1: Critical Blockers (Immediate)

| # | Issue | File | Fix Time |
|---|-------|------|----------|
| 1 | Add clientNotesRouter import | routes/index.ts | 5 min |
| 2 | Add recurringJobPhases import | storage/jobs.ts | 5 min |
| 3 | Export partRepository methods | storage/index.ts | 15 min |
| 4 | Fix apiRequest signature (65 files) | client/src/**/*.tsx | 2-3 hours |

### Phase 2: Security Fixes (This Week)

| # | Issue | File | Fix Time |
|---|-------|------|----------|
| 5 | Add tenant validation to /resend | routes/invitations.ts | 15 min |
| 6 | Add Zod validation to /bulk | routes/clientParts.ts | 30 min |
| 7 | Add asyncHandler to all routes | routes/*.ts | 1 hour |
| 8 | Fix userId bugs | storage/parts.ts, storage/company.ts | 30 min |

### Phase 3: Performance Fixes (This Sprint)

| # | Issue | File | Fix Time |
|---|-------|------|----------|
| 9 | Batch client import queries | routes/clients.ts | 2 hours |
| 10 | Add LIMIT to overview endpoints | routes/clients.ts, customer-companies.ts | 1 hour |
| 11 | Move pagination to DB layer | storage/parts.ts | 1 hour |
| 12 | Add request size validation | routes/clients.ts | 30 min |

### Phase 4: Schema Standardization (Next Sprint)

| # | Issue | Files | Fix Time |
|---|-------|-------|----------|
| 13 | Add missing indexes | migrations/ | 2 hours |
| 14 | Standardize soft delete pattern | schema.ts, storage/*.ts | 4 hours |
| 15 | Migrate clientId → locationId | schema.ts, storage/*.ts | 8 hours |
| 16 | Remove debug logging | storage/items.ts, routes/items.ts | 30 min |

### Phase 5: Code Quality (Ongoing)

| # | Issue | Files | Fix Time |
|---|-------|-------|----------|
| 17 | Standardize query key format | client/src/**/*.tsx | 2 hours |
| 18 | Split oversized components | Calendar.tsx, Dashboard.tsx, ProductsServicesManager.tsx | 8 hours |
| 19 | Consolidate User type definitions | client/src/**/*.tsx | 1 hour |

---

## Appendix: Files Requiring Immediate Attention

### Frontend (apiRequest migration)
```
client/src/pages/AddClientPage.tsx
client/src/pages/Admin.tsx
client/src/pages/Calendar.tsx
client/src/pages/CategoryManagementPage.tsx
client/src/pages/CompanySettingsPage.tsx
client/src/pages/Dashboard.tsx
client/src/pages/InvoiceDetailPage.tsx
client/src/pages/JobDetailPage.tsx
client/src/pages/LocationDetailPage.tsx
client/src/pages/ManageRoles.tsx
client/src/pages/PartsManagementPage.tsx
client/src/pages/RequestReset.tsx
client/src/pages/ResetPassword.tsx
client/src/pages/SupplierDetailPage.tsx
client/src/pages/SupportConsole.tsx
client/src/pages/Technician.tsx
client/src/pages/TechnicianManagementPage.tsx
client/src/components/AddJobNoteDialog.tsx
client/src/components/AddVisitDialog.tsx
client/src/components/ClientDetailDialog.tsx
client/src/components/ClientLocationsTab.tsx
client/src/components/ClientNotesTab.tsx
client/src/components/ClientReportDialog.tsx
client/src/components/EquipmentDialog.tsx
client/src/components/EquipmentList.tsx
client/src/components/FeedbackDialog.tsx
client/src/components/ImpersonationBanner.tsx
client/src/components/JobDetailDialog.tsx
client/src/components/JobEquipmentSection.tsx
client/src/components/JobHeaderCard.tsx
client/src/components/JobTemplateModal.tsx
client/src/components/JobVisitsSection.tsx
client/src/components/LocationEquipmentSection.tsx
client/src/components/LocationFormModal.tsx
client/src/components/LocationPMSection.tsx
client/src/components/NewAddClientDialog.tsx
client/src/components/PartsBillingCard.tsx
client/src/components/PartsManagementDialog.tsx
client/src/components/QuickAddClientModal.tsx
client/src/components/QuickAddJobDialog.tsx
client/src/components/TaskDialog.tsx
client/src/components/TasksSidebar.tsx
client/src/components/UserSubscriptionDialog.tsx
client/src/components/suppliers/AddLocationDialog.tsx
client/src/components/suppliers/EditLocationDialog.tsx
client/src/components/suppliers/QuickAddSupplierDialog.tsx
client/src/lib/auth.tsx
```

### Backend (Critical Fixes)
```
server/routes/index.ts (add import)
server/storage/jobs.ts (add import)
server/storage/index.ts (add exports)
server/routes/invitations.ts (tenant validation)
server/routes/clientParts.ts (input validation)
server/storage/parts.ts (userId bug)
server/storage/company.ts (userId bug)
```

---

*Report generated by Claude Code comprehensive audit*
