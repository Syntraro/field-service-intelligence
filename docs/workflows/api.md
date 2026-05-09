# API Workflow Reference

## Adding a New API Endpoint

1. Create or edit route file in `server/routes/`.
2. Use `asyncHandler` wrapper — eliminates try/catch boilerplate.
3. Use `validateSchema` helper for Zod validation.
4. Use `createError(status, message)` for consistent error responses.
5. Filter by `req.user.companyId` — always. Tenant isolation is mandatory.
6. Add `requireRole(...)` before `requirePermission(...)` if authorization is needed.
7. Register the router in `server/routes/index.ts`.

## Route Handler Pattern

```typescript
import { Router } from "express";
import { requireAuth, requireRole, requirePermission } from "../auth/routeHelpers";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { db } from "../db";
import { MANAGER_ROLES } from "../auth/roles";

const router = Router();

router.post(
  "/api/example",
  requireAuth,
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { companyId } = req.user!;
    const data = validateSchema(mySchema, req.body);

    if (!someCondition) {
      throw createError(400, "Invalid operation");
    }

    const result = await db.query.tableName.findMany({
      where: eq(tableName.companyId, companyId),
    });

    res.json(result);
  })
);
```

## Frontend Query Pattern

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Read
const { data, isLoading, isError } = useQuery({
  queryKey: ["/api/example"],
  queryFn: async () => {
    const res = await fetch("/api/example");
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
});

// Mutation with CSRF
const queryClient = useQueryClient();
const mutation = useMutation({
  mutationFn: async (payload) => {
    const csrfRes = await fetch("/api/csrf-token");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/example", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed");
    return res.json();
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/example"] }),
});
```

## CSRF Requirement

All mutating requests (POST, PUT, PATCH, DELETE) require a valid CSRF token. Fetch from `GET /api/csrf-token` and attach as `X-CSRF-Token` header.

## Error Handling

- `createError(statusCode, message)` — creates a structured error that `asyncHandler` catches and formats consistently.
- No individual try/catch per route handler — `asyncHandler` covers it.
- Validation errors throw automatically from `validateSchema`.
