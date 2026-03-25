# ARCHITECTURE CONSTITUTION (v2.1 — POST-HARDENING)

## PURPOSE

This document defines non-negotiable architectural laws for the system.

It exists to:

- Preserve single sources of truth
- Prevent competing authorities
- Eliminate shadow workflows
- Enforce safe, predictable evolution

**This is not guidance.
This is enforceable law.**

---

## 1. CORE PRINCIPLES

### 1.1 Single Source of Truth

Every domain concern must have exactly one canonical owner.

If two places can:

- compute the same business rule
- decide the same state transition
- apply the same side effect

→ The system is in violation.

---

### 1.2 Explicit Ownership

Each domain concern is owned by a single canonical layer or module:

| Concern | Canonical Owner Type |
|---------|---------------------|
| Business workflows | Canonical service / orchestrator |
| Lifecycle/state | Canonical orchestrator / service |
| Persistence | Storage / Repository |
| Query predicates | Canonical query helpers |
| Transport shape | DTO / Mapper |
| UI rendering | Client |

**Rules:**

- Ownership must be explicit and discoverable
- Ownership must not be duplicated
- Creating a new owner for an existing concern is forbidden

---

### 1.3 Canonical Owner Extension Rule

If a workflow already has a canonical owner:

- All new entry points must reuse or extend that owner
- You must not create parallel implementations
- You must not re-abstract a solved problem

Closed hardening work is considered settled architecture.

Reopening it requires:

- code proof of a real defect, not preference

---

## 2. LAYER RESPONSIBILITIES

### 2.1 Routes (Transport Layer)

Routes are thin entry points only.

**Allowed:**

- Parse request
- Validate shape
- Call canonical service/orchestrator
- Return response

**Forbidden:**

- Business logic
- Lifecycle/state decisions
- Domain side effects
- Direct database mutation for domain behavior

---

### 2.2 Services / Orchestrators (SYSTEM AUTHORITY)

Canonical services/orchestrators are the only owners of domain workflows.

**Responsibilities:**

- Enforce business rules
- Control lifecycle/state transitions
- Coordinate multi-entity operations
- Execute side effects
- Ensure invariants

**Rules:**

- All meaningful domain mutations must pass through the canonical owner
- No parallel services for the same workflow
- No reimplementation of existing logic

**Forbidden:**

- Creating alternate workflow paths
- Splitting authority across multiple modules

---

### 2.3 Storage / Repository Layer

**Responsibilities:**

- Persistence only
- Raw data access
- Query execution

**Rules:**

- No business logic
- No lifecycle/state decisions
- No orchestration

Storage is dumb by design.

---

### 2.4 DTO / Mapper Layer

**Responsibilities:**

- Shape transformation
- Serialization/deserialization

**Rules:**

- No business logic
- No side effects
- No hidden mutations

---

### 2.5 Client Layer

**Allowed:**

- Presentation logic
- UI-only derived state
- Rendering helpers
- Display constants and mappings

**Forbidden:**

- Domain business rules
- Lifecycle/state authority
- Canonical predicate ownership
- Business write logic

The client may interpret, but never decide domain truth.

---

## 3. LIFECYCLE LAW

Lifecycle/state transitions must:

- Have a single canonical owner
- Be executed through explicit intents or orchestrator methods
- Enforce:
  - invariants
  - audit logging
  - versioning
  - side effects

**Forbidden:**

- Direct state mutation outside canonical owner
- Partial lifecycle updates
- Bypassing transition logic

---

## 4. QUERY LAW

- Reusable domain predicates must be centralized
- Inline duplication of canonical predicates is forbidden
- If a canonical helper exists → it must be used

**Allowed:**

- Raw SQL derived from canonical logic when required

**Forbidden:**

- Divergent filter definitions
- Re-implementing existing query semantics

---

## 5. WRITE PATH LAW

All domain writes must follow:

```
Route → Canonical Service/Orchestrator → Storage
```

**Forbidden:**

- Route → Storage (for domain behavior)
- Service/orchestrator bypasses
- Hidden write paths

### 5.1 Infrastructure / Non-Domain Exception

The following are explicitly allowed at the route level:

- Authentication flows (e.g., OAuth token persistence)
- Configuration / system setup (e.g., role seeding)
- External integration state (e.g., QBO tokens)
- Simple CRUD that does not implement domain workflows

**Conditions:**

These must:

- Not affect lifecycle/state transitions
- Not contain business workflow logic
- Not introduce side effects tied to domain invariants

If a route begins to:

- enforce rules
- coordinate entities
- trigger domain behavior

→ it must be moved to a canonical service/orchestrator.

---

## 6. DUPLICATION LAW

The following must never be duplicated:

- Business rules
- Lifecycle transitions
- Domain predicates
- Status definitions
- Workflow logic

If duplication is detected:

- Extract or reuse canonical source
- Delete all secondary definitions

---

## 7. TENANT ISOLATION LAW

Multi-tenant boundaries must be enforced at all times.

**Rules:**

- All queries must include tenant scoping
- No cross-tenant leakage
- No implicit assumptions

Violations are critical severity.

---

## 8. CANONICAL WORKFLOW REUSE

Existing workflows must be reused.

When adding functionality:

- Extend existing canonical workflow
- Do not fork logic
- Do not clone behavior

---

## 9. NO SHADOW WORKFLOWS

A shadow workflow is:

- Any logic that duplicates behavior of a canonical workflow
- Any write path that bypasses the canonical owner

Shadow workflows are strictly forbidden.

---

## 10. TRANSACTION PROOF RULE

Any operation that:

- touches multiple entities
- performs multiple writes
- depends on consistency

Must:

- Execute inside a transaction
- Or explicitly prove why not

---

## 11. FAILURE / REJECTION LAW

The system must reject any change that:

- Introduces competing authority
- Adds route-level domain writes
- Duplicates canonical logic
- Bypasses lifecycle or orchestrator control
- Violates tenant isolation
- Breaks transaction guarantees

Rejection must:

- Identify the violated rule
- Provide the minimal compliant alternative

---

## 12. NO GUESSING RULE

When modifying the system:

- Use only explicitly provided context
- Do not assume architecture
- Do not infer undocumented ownership
- Do not search arbitrarily for patterns

If ownership is unclear:
→ Stop and ask

---

## 13. PERFORMANCE GUARDRAIL

All changes must preserve:

- Query efficiency
- Index usage
- Batching behavior
- Avoidance of N+1 patterns

Performance regressions are not acceptable trade-offs.

---

## 14. FINAL SYSTEM POSTURE

The system is in a post-hardening, stable state.

**Implications:**

- Core workflows are considered correct and authoritative
- Refactoring is not exploratory
- Changes must be surgical and justified
- Existing canonical owners must be trusted unless code proves otherwise

---

## FINAL STATEMENT

This constitution defines how the system must evolve.

Breaking these rules results in:

- architectural drift
- hidden bugs
- long-term instability

Compliance ensures:

- predictability
- maintainability
- safe scaling
