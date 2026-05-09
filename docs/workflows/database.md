# Database Workflow Reference

## Schema Change Process

1. Write the SQL migration file in `migrations/DESCRIPTIVE_NAME.sql`.
2. Add a header comment with run instructions (e.g., `-- Run: npm run db:migrate:one -- migrations/DESCRIPTIVE_NAME.sql`).
3. Apply: `npm run db:migrate:one -- migrations/DESCRIPTIVE_NAME.sql`.
4. Update `shared/schema.ts` to match (TypeScript type source of truth).
5. Document in `CHANGELOG.md` under `[Unreleased]`.

**Never use `drizzle-kit push`** — it is interactive and breaks CI/CD. Full migration rules: `docs/MIGRATIONS.md`.

## Adding a New Table

1. Write the `CREATE TABLE` statement in a new migration file.
2. Include `company_id` foreign key for tenant scoping (nearly always required).
3. Apply the migration: `npm run db:migrate:one -- migrations/FILE.sql`.
4. Add table definition to `shared/schema.ts`.
5. Add insert/update schemas with `createInsertSchema` from drizzle-zod.
6. Export types: `export type TableName = typeof tableName.$inferSelect;`

## Schema Pattern

```typescript
// shared/schema.ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const exampleItems = pgTable("example_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertExampleItemSchema = createInsertSchema(exampleItems).omit({ id: true, createdAt: true });
export type ExampleItem = typeof exampleItems.$inferSelect;
export type InsertExampleItem = typeof insertExampleItemSchema._type;
```

## Commands

```bash
npm run db:migrate           # Apply all pending migrations
npm run db:migrate:one -- migrations/FILE.sql  # Apply single migration
npm run db:sanity            # Check DB connectivity
npm run db:check             # Detect schema drift (Drizzle vs live DB)
```

## Query Pattern

Always use Drizzle queries, not raw SQL, for type safety:

```typescript
import { db } from "../db";
import { eq } from "drizzle-orm";

const items = await db.query.exampleItems.findMany({
  where: eq(exampleItems.companyId, companyId),
});
```
