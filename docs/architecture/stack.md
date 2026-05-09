# Technology Stack

## Frontend

| Layer | Technology |
|---|---|
| Framework | React (Vite, TypeScript) |
| Routing | wouter (lightweight client-side) |
| Server state | TanStack Query (React Query) |
| Forms | React Hook Form + Zod validation |
| UI primitives | shadcn/ui (Radix UI + Tailwind CSS) |
| Icons | Lucide React |
| Date handling | date-fns |
| Maps | Leaflet / react-leaflet |
| Drag-and-drop | @dnd-kit (SortableContext, DndContext) |

UI style: Material Design-inspired. Inter font. Component config: `components.json`. Import alias: `@/components/ui/`.

## Backend

| Layer | Technology |
|---|---|
| API | RESTful Express.js (TypeScript, ESM modules) |
| Database | Neon PostgreSQL (serverless) |
| ORM | Drizzle ORM |
| Validation | Zod schemas (shared with client) |
| Auth | Passport.js local strategy, bcrypt |
| Sessions | connect-pg-simple (PostgreSQL-backed) |
| CSRF | csurf (session-based) |
| Security headers | Helmet (CSP) |
| Rate limiting | express-rate-limit |

## Shared
- `shared/schema.ts` — Drizzle schema. TypeScript type source of truth for DB structure. Use `typeof tableName.$inferSelect` for types.
- Zod schemas shared between client validation and server validation.
