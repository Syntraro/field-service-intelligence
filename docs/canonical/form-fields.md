# Canonical Form Field System

Source file: `client/src/components/ui/form-field.tsx`

## Primitives

| Primitive | Purpose |
|---|---|
| `<FormField>` | Single-field wrapper. `space-y-1.5` between label, input, helper/error. |
| `<FormLabel required? srOnly?>` | Composes `<Label>` with `text-form-label` token. `required` adds aria-hidden `*`. `srOnly` hides visually (Tailwind `sr-only`) while keeping screen-reader accessible. |
| `<FormHelperText>` | Hint/instruction line below input. Bakes `text-xs text-muted-foreground`. |
| `<FormErrorText>` | Validation error line. Bakes `text-xs text-destructive`, carries `role="alert"`. |
| `<FormSection title="">` | `<fieldset>` + `<legend>` for grouped fields. Legend bakes `text-sm font-medium`. No border (Tailwind preflight resets fieldset borders). |
| `<FormRow>` | Grid wrapper. Defaults to `grid gap-3`. Caller supplies `grid-cols-2` / `grid-cols-3` via `className`. |

## Placeholder-First Pattern (Canonical)

In modal forms, basic text / email / phone / address / number / textarea inputs render identity via `placeholder`, not a visible label above the input. Reference: `QuickAddJobDialog`.

- Render `<FormLabel htmlFor="..." srOnly>` — hidden visually, screen-reader announces it on focus.
- Mirror the placeholder text in the sr-only label.
- Helper and error text may stay visible.
- **Keep visible labels** for: checkboxes, switches, radio groups, complex selects.
- **`<FormSection title="...">` legends always visible** — section headings, not field identities.

```tsx
{/* Canonical placeholder-first text input */}
<FormField>
  <FormLabel htmlFor="phone" srOnly>Phone</FormLabel>
  <Input id="phone" placeholder="Phone" value={phone} onChange={...} />
</FormField>

{/* Helper and error text */}
<FormField>
  <FormLabel htmlFor="email" srOnly>Email</FormLabel>
  <Input id="email" type="email" placeholder="Email" value={email} onChange={...} />
  {emailError ? (
    <FormErrorText>{emailError}</FormErrorText>
  ) : (
    <FormHelperText>Used for invoices and notifications</FormHelperText>
  )}
</FormField>

{/* Visible label retained for checkbox */}
<div className="flex items-center gap-2">
  <Checkbox id="opt-in" checked={...} onCheckedChange={...} />
  <Label htmlFor="opt-in">Send me marketing emails</Label>
</div>
```

## Standard Form Body

```tsx
<ModalBody className="space-y-4">
  <FormSection title="Client Identity (first name or company required)">
    <FormRow className="grid-cols-2">
      <FormField>
        <FormLabel htmlFor="first" srOnly>First name</FormLabel>
        <Input id="first" placeholder="First name" value={...} onChange={...} />
      </FormField>
      <FormField>
        <FormLabel htmlFor="last" srOnly>Last name</FormLabel>
        <Input id="last" placeholder="Last name" value={...} onChange={...} />
      </FormField>
    </FormRow>
    <FormField>
      <FormLabel htmlFor="company" srOnly>Company name</FormLabel>
      <Input id="company" placeholder="Company name" value={...} onChange={...} />
    </FormField>
  </FormSection>
</ModalBody>
```

## What Stays As-Is

- `<Label>`, `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`, `<Switch>` — atomic primitives, unchanged.
- `<ModalShell>` / `<ModalHeader>` / `<ModalBody>` / `<ModalFooter>` — modal primitives, unchanged.
- The shadcn `<Form>` family in `@/components/ui/form` — available for react-hook-form callers. FormField primitives compose cleanly inside `<FormItem>` slots.

## Framework Compatibility

These primitives are framework-agnostic — they compose existing shadcn primitives without coupling to react-hook-form. Modals using `useState` directly work without refactoring. If a future modal uses react-hook-form, FormField primitives slot into `<FormItem>` without change.

Custom layouts are allowed when the body has its own padding/scrolling concerns (e.g., a two-section flex layout or tag-chip search structure). Individual fields within those layouts should still use `<FormField>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` where practical.
