# Form Workflow Reference

## Modal Form Pattern

1. Use `<ModalShell>` + `<ModalHeader>` + `<ModalBody>` + `<ModalFooter>` for structure.
2. Use `<FormField>`, `<FormLabel>`, `<FormHelperText>`, `<FormErrorText>`, `<FormSection>`, `<FormRow>` for field layout.
3. Follow the placeholder-first pattern: `placeholder` for identity, `<FormLabel srOnly>` for accessibility.
4. State management: `useState` for simple forms. react-hook-form for complex validation — FormField primitives compose into `<FormItem>` slots cleanly.
5. CSRF token: fetch from `GET /api/csrf-token` before submission and include as `X-CSRF-Token` header.

## Validation

- Define Zod schemas in `shared/schema.ts` (reuse on client and server).
- Server: `validateSchema(schema, req.body)` — throws automatically on failure.
- Client: react-hook-form `resolver: zodResolver(schema)` or manual `schema.safeParse(...)`.

## Input Type → Label Pattern

| Input type | Label pattern |
|---|---|
| text, email, phone, address, number, textarea | `<FormLabel srOnly>` + `placeholder` |
| checkbox, switch | Visible `<Label>` adjacent to control |
| radio group | Visible `<FormSection>` + per-item labels |
| complex select (combobox, multi-select) | Visible `<FormLabel>` above control |

## CSRF Fetch

```typescript
const csrfRes = await fetch("/api/csrf-token");
const { csrfToken } = await csrfRes.json();

await fetch("/api/endpoint", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  },
  body: JSON.stringify(payload),
});
```

## Full Form Field Reference

Primitives, examples, and what-stays-as-is: `docs/canonical/form-fields.md`.
