# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an HVAC/R preventive maintenance scheduling application for contractors. The application manages client contracts, automates maintenance scheduling, tracks parts inventory, handles job dispatching, invoicing, and integrates with QuickBooks Online.

## Development Commands

### Build & Run
```bash
npm run dev          # Start development server (backend + Vite)
npm run build        # Build frontend and backend for production
npm start            # Run production build
npm run check        # Type-check TypeScript without emitting files
```

### Database
```bash
npm run db:push      # Push Drizzle schema changes to database
```

**Important:** This project uses Drizzle ORM. Schema is defined in `shared/schema.ts`. Use `drizzle-kit push` for schema changes. Manual SQL migrations are in the `migrations/` directory but are not automatically run - they must be executed manually against the database.

### Environment Setup
Required environment variables:
- `DATABASE_URL` - Neon PostgreSQL connection string
- `SESSION_SECRET` - Session encryption secret (required in production)
- `NODE_ENV` - Set to "production" or "development"

## Architecture

### Monorepo Structure
- **`client/`** - React frontend (Vite, TypeScript)
  - `src/components/` - UI components (shadcn/ui + custom)
  - `src/pages/` - Route pages
  - `src/hooks/` - Custom React hooks
  - `src/lib/` - Client utilities (auth, queryClient, etc.)
- **`server/`** - Express backend (TypeScript, ESM)
  - `routes/` - API route handlers
  - `services/` - Business logic services
  - `auth/` - Authentication & authorization middleware
  - `middleware/` - Shared middleware (error handling, etc.)
  - `guards/` - Business rule guards (ownership protection, etc.)
  - `utils/` - Server utilities (validation, pagination, etc.)
  - `qbo/` - QuickBooks Online integration
  - `storage/` - Repository layer for database access
  - `index.ts` - Server entry point
- **`shared/`** - Shared code between client and server
  - `schema.ts` - Drizzle ORM schema (single source of truth for database structure)
- **`migrations/`** - SQL migration files (manual execution)

### Multi-Tenancy
The app is **multi-tenant by company**. Each HVAC business is a separate company:
- `companies` table is the tenant root
- `users`, `clients`, `jobs`, `invoices`, etc. are scoped to `companyId`
- Tenant isolation enforced via middleware: `server/auth/tenantIsolation.ts`
- All database queries MUST filter by `companyId` from the authenticated user
- Never expose cross-tenant data

### Authentication & Authorization
- **Authentication:** Passport.js with local strategy, bcrypt for password hashing
- **Sessions:** PostgreSQL-backed sessions (connect-pg-simple)
- **CSRF Protection:** csurf middleware (session-based, not cookie-based)
  - CSRF token endpoint: `GET /api/csrf-token`
  - All mutating API requests require valid CSRF token
- **Authorization:** Role-Based Access Control (RBAC)
  - 5 default roles: Owner, Admin, Manager, Dispatcher, Technician
  - 24 granular permissions (defined in `server/permissions.ts`)
  - User-level permission overrides supported
  - Middleware: `requireAuth`, `requireRole`, `requirePermission` in `server/auth/`
  - Special role: `platform_admin` for cross-tenant support operations

### Security Features
- **Impersonation System:** Platform admins can impersonate company admins/owners
  - 60-minute max session, 15-minute idle timeout
  - Full audit trail in `audit_logs` table
  - See `SECURITY.md` for details
- **Helmet:** Security headers with CSP
- **Rate Limiting:** express-rate-limit on sensitive endpoints
- **Trust Proxy:** Enabled for deployment behind proxies

### Frontend Stack
- **Routing:** wouter (lightweight client-side routing)
- **State Management:** TanStack Query (React Query) for server state
- **Forms:** React Hook Form + Zod validation
- **UI Components:** shadcn/ui (Radix UI primitives + Tailwind CSS)
  - Material Design-inspired
  - Defined in `components.json` - uses `@/components/ui/` import alias
- **Icons:** Lucide React
- **Date Handling:** date-fns
- **Maps:** Leaflet / react-leaflet for route visualization

### Backend Stack
- **API:** RESTful Express.js (TypeScript, ESM modules)
- **Database:** Neon PostgreSQL (serverless)
- **ORM:** Drizzle ORM (`shared/schema.ts` is schema source of truth)
- **Validation:** Zod schemas (shared between client and server)

### Key Domain Models
- **Companies** - Tenant root, subscription data, tax settings
- **Users** - Scoped to company, roles/permissions, technician profiles
- **Customer Companies** - Main client companies (e.g., "Basil Box")
- **Client Locations** (`client_locations` table, formerly `clients`) - Service locations under customer companies
- **Jobs** - Work orders with status workflow, assigned technicians, equipment tracking (linked to client_locations)
  - Job statuses: Scheduled, In Progress, Completed, Cancelled, Invoiced, etc.
  - Job types: PM, Repair, Install, etc.
  - Supports recurring job series
- **Invoices** - Billing with QBO sync, line items, tax calculation
  - Invoice statuses: Draft, Sent, Paid, Overdue, Void
  - Client visibility toggles (show/hide prices, quantities, etc.)
- **Parts** - Inventory tracking with categories
- **Equipment** - Location-level asset tracking, linked to jobs
- **Job Templates** - Reusable parts/billing configurations per job type
- **Tasks** - Supplier visit tracking and task management

### QuickBooks Online Integration
- **Bidirectional sync:** Clients, Invoices, Payments
- **Customer hierarchy:** Clients map to QBO Customers, Locations to Sub-Customers
- **Sync fields:** `qboCustomerId`, `qboInvoiceId`, `qboSyncToken` for optimistic locking
- **Services:** `server/qbo/syncService.ts`, `server/qbo/mappers.ts`
- **Sync triggers:** Manual sync buttons, automatic on invoice creation/update

### Route Optimization
- **OpenRouteService API** integration for technician routing
- GPS coordinate conversion for client locations
- Optimal sequencing and map visualization
- Service: `server/routeOptimizationService.ts`

## Important Patterns

### Path Aliases
- `@/` - Resolves to `client/src/`
- `@shared/` - Resolves to `shared/`
- `@assets/` - Resolves to `attached_assets/`

### Database Schema Management
1. Modify `shared/schema.ts` (single source of truth)
2. Run `npm run db:push` to apply changes to database
3. Schema is typed via Drizzle - use `typeof tableName.$inferSelect` for types
4. Always use Drizzle queries, not raw SQL, for type safety

### API Route Pattern
```typescript
// server/routes/example.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../auth/routeHelpers";
import { db } from "../db";

const router = Router();

router.get("/api/example", requireAuth, requirePermission("view_clients"), async (req, res) => {
  const { companyId } = req.user!;  // Always filter by companyId
  const data = await db.query.tableName.findMany({
    where: eq(tableName.companyId, companyId)
  });
  res.json(data);
});
```

### Frontend Query Pattern
```typescript
// Use TanStack Query for API calls
const { data, isLoading } = useQuery({
  queryKey: ['/api/example'],
  queryFn: async () => {
    const res = await fetch('/api/example');
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  }
});
```

### Component Structure
- Atomic design: `components/ui/` for primitives, `components/` for composed components
- Page components in `pages/`
- Protected routes use `<ProtectedRoute>` wrapper with optional `requireAdmin` prop
- All dialogs/modals use shadcn Dialog component

## Common Development Tasks

### Adding a New Database Table
1. Add table definition to `shared/schema.ts`
2. Include `companyId` foreign key for tenant scoping
3. Create insert/update schemas with `createInsertSchema` from drizzle-zod
4. Run `npm run db:push`
5. Add types: `export type TableName = typeof tableName.$inferSelect;`

### Adding a New API Endpoint
1. Create/edit route file in `server/routes/`
2. Use `asyncHandler` wrapper to eliminate try/catch boilerplate
3. Use `validateSchema` helper for Zod validation
4. Use `createError(status, message)` for consistent error handling
5. Add tenant isolation: filter queries by `req.user.companyId`
6. Add authorization: `requireRole(...)` if needed
7. Register route in `server/routes/index.ts`

**Example:**
```typescript
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";

router.post("/endpoint", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = validateSchema(mySchema, req.body);

  // Validation throws automatically on failure
  if (!someCondition) {
    throw createError(400, "Invalid operation");
  }

  const result = await db.query...;
  res.json(result);
}));
```

### Adding a New Page
1. Create page component in `client/src/pages/`
2. Add route in `client/src/App.tsx` Router
3. Wrap with `<ProtectedRoute>` if authentication required
4. Add navigation link in `client/src/components/AppSidebar.tsx`

### Working with Forms
1. Use React Hook Form + Zod schema
2. Reuse Zod schemas from `shared/schema.ts` where possible
3. Use shadcn form components for consistent UI
4. Include CSRF token from `/api/csrf-token` for mutations

## Testing Notes
- No automated test suite currently configured
- Manual testing required for changes
- Use `npm run check` to verify TypeScript compilation

## Design Guidelines
- Follow Material Design principles (see `design_guidelines.md`)
- Use Inter font family
- Tailwind spacing: consistent use of units 2, 4, 6, 8
- Mobile-first responsive design
- Information density is important - contractors need scannable data views
- Minimize clicks for common workflows (e.g., mark job complete, create invoice)

## Special Considerations
- **Numeric Types:** Money amounts and quantities use PostgreSQL `numeric` type (stored as strings in TypeScript for precision)
- **Date Handling:** Dates stored as ISO strings or PostgreSQL date type; use date-fns for formatting
- **Calendar Cleanup:** System automatically removes invalid calendar assignments when client PM months change
- **Job Numbers:** Atomic sequences per company to prevent collisions
- **Optimistic Locking:** QBO sync uses version tokens to prevent concurrent update 
conflicts


# Project Instructions: Dispatching Software Optimization

## Role
You are a Senior Systems Architect specializing in high-performance dispatching software and DRY (Don't Repeat Yourself) principles.

## Objectives for Analysis & Development
1. **Prioritize Line Count Reduction:** Every time we touch a module, identify redundant logic. If the same logic appears in 2+ places, refactor it into a shared utility or service.
2. **Modular Architecture:** Aim for a "Thin Controller, Thick Service" model. Keep files under 300 lines where possible.
3. **Dead Code Elimination:** Automatically flag and suggest removal for unused variables, imported but unused libraries, and "hallucinated" or orphaned functions common in AI-generated code.
4. **Data Integrity:** Since this is dispatching software, prioritize the reliability of state management (e.g., driver status, GPS coordinates, and job assignments).

## Coding Standards
- Use ES6+ features to shorten code (e.g., destructuring, arrow functions).
- Consolidate multiple `if/else` chains into early returns or lookup objects.
- Ensure all API calls have a unified error handling wrapper rather than individual try/catch blocks in every file.

## Workflow
- Before writing new code, check the existing codebase for a similar function.
- If a proposed change increases line count significantly, explain why it is necessary or offer a more concise alternative.