# Form Field Canonicalization — Migration History

## Background

Phase 1 standardized modal wrappers (`ModalShell`, `ModalHeader`, `ModalBody`, `ModalFooter`). Phase 2 standardized the interior of modal forms — labels, inputs, helper/error text, field stacks, multi-column rows, and section grouping.

**Problem:** Modal forms used ad hoc patterns: hardcoded `text-xs`/`text-sm font-medium` for labels, no consistent helper/error text structure, inconsistent multi-column grid handling.

**Solution:** Canonical primitives in `client/src/components/ui/form-field.tsx`. Test pin: `tests/form-field-canonical.test.ts`.

## Migration Phases

### Phase 2A — Primitives
Created `form-field.tsx` with all six primitives. No modal changes in this phase. Pinned by `tests/form-field-canonical.test.ts`.

### Phase 2B — Bellwether Migration
`EditCompanyDialog` — smallest field set, no `<Textarea>` / `<Select>`, already used `<fieldset><legend>`. Swap was mostly cosmetic. Used to validate the pattern in production before batch migration.

### Phase 2C — Batch Migration
Remaining 11 migrated modals in 3 clusters (client → location → other), after Phase 2B validated the pattern.

## Scope of Phase 1 (Modal Wrappers)

12 tenant modals migrated from raw shadcn `Dialog` to `ModalShell`. All 12 used `useState` directly (no react-hook-form). FormField primitives slot in without state-library refactoring.

## Back-Compat Notes

- `<Label>`, `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`, `<Switch>` — unchanged at the atomic layer.
- `<ModalShell>` / `<ModalHeader>` / `<ModalTitle>` / `<ModalBody>` / `<ModalFooter>` — Phase 1 primitives, unchanged.
- The shadcn `<Form>` family in `@/components/ui/form` — kept for react-hook-form callers. FormField primitives compose cleanly inside `<FormItem>` slots.

## Custom Layout Exceptions

Some modals own their own body structure due to padding/scrolling concerns (e.g., `ContactFormDialog` 2-section flex layout, `EditTagsModal` tag-chip + search structure). Individual fields within those layouts still use `<FormField>` / `<FormLabel>` / `<FormHelperText>` / `<FormErrorText>` where practical.
