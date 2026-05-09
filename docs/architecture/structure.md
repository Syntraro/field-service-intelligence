# Monorepo Structure

```
client/                     React frontend (Vite, TypeScript)
  src/
    components/             UI components (shadcn/ui + custom)
      ui/                   Atomic primitives
    pages/                  Route pages
    hooks/                  Custom React hooks
    lib/                    Utilities (auth, queryClient, etc.)

server/                     Express backend (TypeScript, ESM)
  routes/                   API route handlers
  services/                 Business logic services
  auth/                     Authentication & authorization middleware
  middleware/               Shared middleware (error handling, etc.)
  guards/                   Business rule guards (ownership protection)
  utils/                    Validation, pagination, etc.
  qbo/                      QuickBooks Online integration
  storage/                  Repository layer for database access
  index.ts                  Server entry point

shared/                     Shared code (client + server)
  schema.ts                 Drizzle ORM schema — single source of truth for DB structure
  dashboardWidgetRegistry.ts  Widget registry
  platformCapabilities.ts   Platform role capabilities

migrations/                 SQL migration files (manual execution)
docs/                       Architecture, canonical, and workflow documentation
tests/                      Canonical drift-prevention tests
```

## Path Aliases
- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

## Key Files
- `shared/schema.ts` — Drizzle schema, TypeScript type source of truth
- `server/permissions.ts` — 24 granular permissions
- `server/auth/tenantIsolation.ts` — tenant scoping middleware
- `client/src/App.tsx` — client router
- `client/src/components/AppSidebar.tsx` — navigation
- `server/routes/index.ts` — route registration
