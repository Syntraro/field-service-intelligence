# REFACTOR PLAYBOOK (v2.1 — POST-HARDENING)

## PURPOSE

This playbook defines the only allowed process for modifying the system.

It enforces:

- strict adherence to the Architecture Constitution
- surgical, low-risk changes
- zero regression of hardened architecture

**This is not guidance.
This is mandatory execution protocol.**

---

## 1. OPERATING MODE

The system is in a post-hardening stable state.

**Implications:**

- Architecture is considered correct
- Refactoring is not exploratory
- Changes must be minimal and justified
- Existing canonical owners must be trusted

---

## 2. REQUIRED CONTEXT (MANDATORY)

Before any change, you must load and follow:

- `ARCHITECTURE_CONSTITUTION.md`
- `CHANGELOG.md`
- `docs/REFACTORING_LOG.md`

**Rules:**

- Do not search for other documents
- Do not infer undocumented patterns
- Do not guess ownership
- If something is unclear → stop and ask

---

## 3. REFACTOR CLASSIFICATION

Every task must be classified before execution:

**Allowed categories:**

- **Bug Fix** — Fix incorrect behavior. Must preserve architecture.
- **Verified Cleanup** — Remove dead code or duplication (with proof).
- **Canonical Reuse** — Replace duplicate logic with canonical owner.
- **Required Extension** — Extend an existing canonical workflow.

**Forbidden categories:**

- Exploratory refactoring
- Structural rewrites
- "Improvement" without defect
- Creating new abstractions for existing concerns
- Reorganizing working code without necessity

---

## 4. PRE-CHANGE ANALYSIS (MANDATORY)

Before making any change, you must explicitly determine:

### 4.1 Canonical Ownership

- What is the domain concern?
- Who is the canonical owner?

You must:

- Identify the exact file/module
- Confirm it is already the system authority

### 4.2 Write Path Verification

If the change involves writes:

You must confirm:

```
Route → Canonical Service/Orchestrator → Storage
```

If not → you must fix the path, not extend the violation.

### 4.3 Duplication Check

- Does this logic already exist?
- Is there a canonical helper/service?

If yes:

- You must reuse it
- You must not reimplement it

### 4.4 Side Effects Check

- Does this trigger lifecycle changes?
- Does it affect multiple entities?

If yes:

- It must live in a service/orchestrator
- It may require a transaction

### 4.5 Performance Check

Does this introduce:

- extra queries?
- loops over rows?
- N+1 behavior?

If yes → reject or redesign

---

## 5. EXECUTION RULES

### 5.1 Surgical Changes Only

- Modify only what is necessary
- Do not expand scope
- Do not "clean up nearby code"

### 5.2 No New Authorities

Do not create:

- new services
- new orchestrators
- new lifecycle handlers

Unless:

- a genuinely new domain concern exists
- and is explicitly justified

### 5.3 No Shadow Workflows

Do not duplicate:

- lifecycle transitions
- workflow logic
- predicates

All logic must route through canonical owners.

### 5.4 No Route-Level Domain Writes

Routes must never:

- mutate domain state
- implement workflows

**Exception:** infrastructure/auth/config CRUD (per constitution §5.1).

### 5.5 Transaction Enforcement

If:

- multiple writes occur
- consistency matters

Then:

- wrap in a transaction
- or prove why not

### 5.6 Preserve Behavior

- No unintended changes
- No altered side effects
- No silent logic changes

---

## 6. DELETION RULES

Code may be deleted only if:

**Required proof:**

- Zero callers (current codebase)
- No dynamic usage
- No side effects
- No test dependency (unless replaced)

**Forbidden:**

- "Seems unused"
- "Probably safe"
- Partial deletion

---

## 7. VERIFICATION REQUIREMENTS

Every change must include:

### 7.1 Files Changed

- Exact list of modified files

### 7.2 Before / After Behavior

- What changed
- What did not change

### 7.3 Ownership Proof

- Show canonical owner is preserved
- Show no competing authority introduced

### 7.4 Write Path Proof

If applicable:

- Confirm correct path

### 7.5 Deletion Proof (if applicable)

- Show zero callers

### 7.6 TypeScript Check

- `tsc --noEmit` must pass

### 7.7 Scope Confirmation

Explicit statement:

> "No changes were made outside the defined scope."

---

## 8. REJECTION PROTOCOL

You must reject any task that:

- Violates the Architecture Constitution
- Introduces competing authority
- Adds route-level domain writes
- Duplicates canonical logic
- Expands scope beyond request
- Lacks sufficient context

Rejection must include:

- Which rule is violated
- Why it is unsafe
- The smallest compliant alternative

---

## 9. POST-HARDENING GUARDRAIL

The system is already hardened.

Therefore:

- Do not reopen solved architecture
- Do not re-evaluate canonical ownership
- Do not propose structural redesigns

Reopening requires:

- code proof of a real defect

---

## 10. FINAL RULE

When in doubt:

- Do not proceed
- Do not guess
- Do not improvise

→ Stop and ask

---

## FINAL STATEMENT

This playbook ensures:

- safe evolution
- architectural integrity
- zero regression

Any deviation risks:

- reintroducing legacy bugs
- breaking invariants
- fragmenting ownership
