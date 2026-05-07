/**
 * CreateNewDialog modal canonicalization source-pin tests (2026-05-06).
 *
 * The global "+ New" launcher (`client/src/components/CreateNewDialog.tsx`)
 * is the single canonical entry point for Job + Task creation across the
 * app shell, dispatch quick-create, and the dashboard. Per CLAUDE.md
 * Modal Taxonomy rule #2 (generic / simple modals), it routes through
 * the canonical `<ModalShell>` + `<Modal*>` primitives instead of raw
 * `<Dialog>`. These pins lock that contract:
 *
 *   - Imports the canonical Modal primitives from
 *     `@/components/ui/modal` (NOT raw Dialog from `@/components/ui/dialog`).
 *   - Mounts via `<ModalShell>` with the call-site-owned width (Modal
 *     Taxonomy rule #5 — ModalShell stays width-neutral).
 *   - Header is sr-only — tabs are the first visible content.
 *   - The two tabs (Job, Task) preserve their existing data-testids,
 *     labels, and embedded child mounts (QuickAddJobDialog,
 *     TaskDialog with forcedType="GENERAL").
 *   - Tab content uses `forceMount` so form state persists across tab
 *     switches.
 *   - The legacy `"supplier-visit"` tab id silently maps to the Task tab.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const createNewDialogSrc = readFileSync(
  resolve(__dirname, "../client/src/components/CreateNewDialog.tsx"),
  "utf-8",
);

// Code-only view — strip block + line + JSX comments so doc commentary
// that references the legacy `<Dialog>` surface (kept for context)
// doesn't false-match the negative pins below.
const codeOnly = createNewDialogSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("CreateNewDialog — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(createNewDialogSrc).toMatch(
      /from\s+["']@\/components\/ui\/modal["']/,
    );
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalDescription",
    ]) {
      expect(createNewDialogSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogFooter",
      "DialogDescription",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });
});

// ── 2. ModalShell composition + width contract ─────────────────────

describe("CreateNewDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(createNewDialogSrc).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width + height + flex + overflow at the call-site (ModalShell stays width-neutral)", () => {
    // Pin the explicit className contract. The pre-migration
    // DialogContent baked these classes inline; the post-migration
    // ModalShell receives them via className so the primitive layer
    // remains width-agnostic per Modal Taxonomy rule #5.
    expect(createNewDialogSrc).toMatch(
      /<ModalShell[\s\S]*?className="max-w-xl sm:max-w-\[600px\] h-auto max-h-\[90vh\] flex flex-col overflow-hidden"/,
    );
  });

  it("retains the canonical wrapper testid for downstream UI tests", () => {
    expect(createNewDialogSrc).toMatch(
      /<ModalShell[\s\S]*?data-testid="dialog-create-new"/,
    );
  });

  it("renders <ModalHeader> with sr-only so tabs are the first visible content", () => {
    expect(createNewDialogSrc).toMatch(
      /<ModalHeader\s+className="sr-only">/,
    );
  });

  it("renders an accessible <ModalTitle> + <ModalDescription> (Radix a11y contract)", () => {
    expect(createNewDialogSrc).toMatch(
      /<ModalTitle\s+data-testid="text-create-new-title">\s*Create New\s*<\/ModalTitle>/,
    );
    expect(createNewDialogSrc).toMatch(
      /<ModalDescription>\s*Choose what you'd like to create\.\s*<\/ModalDescription>/,
    );
  });
});

// ── 3. Tab options preserved verbatim ──────────────────────────────

describe("CreateNewDialog — tab options preserved", () => {
  it("renders the Job tab trigger with the canonical testid + label", () => {
    expect(createNewDialogSrc).toMatch(
      /<TabsTrigger\s+value="job"[\s\S]*?data-testid="tab-job">[\s\S]*?Job/,
    );
  });

  it("renders the Task tab trigger with the canonical testid + label", () => {
    expect(createNewDialogSrc).toMatch(
      /<TabsTrigger\s+value="task"[\s\S]*?data-testid="tab-task">[\s\S]*?Task/,
    );
  });

  it("renders exactly two TabsTriggers (Supplier Visit was merged into Task)", () => {
    const matches = codeOnly.match(/<TabsTrigger\b/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("uses a 2-column TabsList grid (no leftover 3-col styling)", () => {
    expect(createNewDialogSrc).toMatch(
      /<TabsList\s+className="grid grid-cols-2/,
    );
  });
});

// ── 4. Tab content routes to the correct embedded child ────────────

describe("CreateNewDialog — Job tab routes to QuickAddJobDialog (embedded)", () => {
  it("Job TabsContent uses forceMount + data-[state=inactive]:hidden so form state persists", () => {
    expect(createNewDialogSrc).toMatch(
      /<TabsContent[\s\S]*?value="job"[\s\S]*?forceMount[\s\S]*?data-\[state=inactive\]:hidden/,
    );
    expect(createNewDialogSrc).toMatch(/data-testid="content-job"/);
  });

  it("Job tab mounts <QuickAddJobDialog embedded compact /> with prefill prop pass-through", () => {
    expect(createNewDialogSrc).toMatch(
      /<QuickAddJobDialog[\s\S]*?embedded[\s\S]*?compact[\s\S]*?\/>/,
    );
    // Prop pass-through pins
    for (const propName of [
      "preselectedLocationId",
      "initialSchedule",
      "cloneFromJobId",
      "onSuccess",
    ]) {
      expect(createNewDialogSrc).toMatch(new RegExp(`\\b${propName}=`));
    }
  });
});

describe("CreateNewDialog — Task tab routes to TaskDialog (embedded, GENERAL)", () => {
  it("Task TabsContent uses forceMount + data-[state=inactive]:hidden", () => {
    expect(createNewDialogSrc).toMatch(
      /<TabsContent[\s\S]*?value="task"[\s\S]*?forceMount[\s\S]*?data-\[state=inactive\]:hidden/,
    );
    expect(createNewDialogSrc).toMatch(/data-testid="content-task"/);
  });

  it("Task tab mounts <TaskDialog embedded forcedType=\"GENERAL\" />", () => {
    expect(createNewDialogSrc).toMatch(
      /<TaskDialog[\s\S]*?embedded[\s\S]*?forcedType="GENERAL"/,
    );
    expect(createNewDialogSrc).toMatch(/initialData=\{taskInitialData\}/);
    expect(createNewDialogSrc).toMatch(/onChanged=\{onTaskChanged\}/);
  });
});

// ── 5. Behavior preservation — tab state + legacy mapping ──────────

describe("CreateNewDialog — behavior preservation", () => {
  it("normalizes the legacy 'supplier-visit' defaultTab to 'task'", () => {
    expect(createNewDialogSrc).toMatch(
      /defaultTab\s*===\s*["']supplier-visit["']\s*\?\s*["']task["']\s*:\s*defaultTab/,
    );
  });

  it("re-syncs the active tab when the modal is (re-)opened", () => {
    expect(createNewDialogSrc).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(open\)\s*setTab\(normalizedDefaultTab\)/,
    );
  });

  it("preserves the public `CreateNewTab` union (job | task | supplier-visit) for caller back-compat", () => {
    expect(createNewDialogSrc).toMatch(
      /export\s+type\s+CreateNewTab\s*=\s*["']job["']\s*\|\s*["']task["']\s*\|\s*["']supplier-visit["']/,
    );
  });
});
