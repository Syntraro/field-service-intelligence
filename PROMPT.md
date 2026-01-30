# Autonomous Task Loop Prompt (App-wide)

Read TODO.md and work through pending tasks sequentially.

## Core Workflow (per task)

1) **Understand**
   - Locate the relevant entrypoints (route/component/api/storage/db).
   - Read before writing: open the file(s) you think you'll change and confirm the current behavior.
   - If unclear, do a quick repo search for the symbols involved.

2) **Implement**
   - Make focused, minimal changes that directly address the task.
   - Prefer the smallest correct fix over refactors.
   - If a task spans layers (client + server + db), keep the change set tight and consistent.

3) **Verify (tiered)**
   Always run:
   - `npm run check`

   Additionally, choose the most relevant verification for the task:
   - UI change: `npm run build` (preferred) or a quick manual smoke path described in TODO.md
   - API change: hit the endpoint locally (curl / browser) or add a minimal test if available
   - DB/migration change: run migration + verify schema/data with a query
   - High-risk change (auth, billing, scheduling, migrations, constraints): require **HARD STOP**

4) **Update**
   - Mark the task complete in TODO.md: `- [ ]` → `- [x]`
   - Add a short "Verified by:" note under the task if helpful (command run / UI path).

5) **Commit**
   - Create a git commit with a clear message.
   - If the change is multi-layer, include that in the message (e.g., "tax: snapshot invoice tax lines").

## Scope Rules (App-wide)

- You MAY modify any file in the repo: `client/`, `server/`, `shared/`, `migrations/`, `scripts/`.
- Keep changes minimal; do not refactor unrelated code.
- Prefer editing existing components/modules over creating new ones, unless a clean new file reduces risk.

## Safety Tripwires (must follow)

If a task involves ANY of the following, emit `HARD STOP` before making changes:
- database migrations, schema changes, constraints, indexes
- auth/permissions, tenant isolation, RBAC
- billing/invoices/taxes, money calculations
- scheduling invariants / calendar core logic
- destructive operations (delete, backfill, mass updates)

If you cannot proceed without human input or a decision, emit:
`BLOCKED: <specific reason and what you need>`

## Signal Format (IMPORTANT)

Use these exact formats for the loop to detect them:
```
BLOCKED: Cannot proceed because X
HARD STOP: Verification needed
COMPLETE.
```

When ALL tasks in TODO.md are done, output on its own line: `COMPLETE.`

## Verification Standards (quick guide)

- UI-only: `npm run check` + `npm run build` (or clear manual steps)
- Server/API: `npm run check` + minimal endpoint smoke (describe)
- DB: migration runs + simple validation query
- Critical paths: require HARD STOP, then proceed after confirmation in TODO.md

## Current Status

Read TODO.md for the current task list and what's already been completed.
Start with the first unchecked `- [ ]` task.
