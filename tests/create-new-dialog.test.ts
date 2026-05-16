/**
 * CreateJobModal + CreateTaskModal source-pin tests (2026-05-14).
 *
 * The combined CreateNewDialog was split into two focused create modals:
 *   - CreateJobModal  (client/src/components/CreateJobModal.tsx)
 *   - CreateTaskModal (client/src/components/CreateTaskModal.tsx)
 *
 * Each modal is a thin ModalShell wrapper around the existing embedded
 * dialog body (QuickAddJobDialog / TaskDialog). These pins lock the
 * canonical Modal primitive contract and prop pass-through for both.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const jobModalSrc = readFileSync(
  resolve(__dirname, "../client/src/components/CreateJobModal.tsx"),
  "utf-8",
);

const taskModalSrc = readFileSync(
  resolve(__dirname, "../client/src/components/CreateTaskModal.tsx"),
  "utf-8",
);

// Strip comments for negative assertions.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const jobCode = stripComments(jobModalSrc);
const taskCode = stripComments(taskModalSrc);

// ── CreateJobModal ─────────────────────────────────────────────────

describe("CreateJobModal — canonical ModalShell + Modal* primitives", () => {
  it("imports from @/components/ui/modal (not raw dialog)", () => {
    expect(jobModalSrc).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of ["ModalShell", "ModalHeader", "ModalTitle"]) {
      expect(jobModalSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import from @/components/ui/dialog", () => {
    expect(jobCode).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("mounts <ModalShell> with canonical width + testid", () => {
    expect(jobModalSrc).toMatch(
      /<ModalShell[\s\S]*?className="max-w-xl sm:max-w-\[600px\] h-auto max-h-\[90vh\] flex flex-col overflow-hidden"/,
    );
    expect(jobModalSrc).toMatch(/data-testid="dialog-create-job"/);
  });

  it("renders a visible ModalHeader with 'Create Job' title", () => {
    expect(jobModalSrc).toMatch(/<ModalHeader>/);
    expect(jobModalSrc).toMatch(/<ModalTitle>\s*Create Job\s*<\/ModalTitle>/);
  });

  it("mounts <QuickAddJobDialog embedded compact /> with prefill props", () => {
    expect(jobModalSrc).toMatch(/<QuickAddJobDialog[\s\S]*?embedded[\s\S]*?compact[\s\S]*?\/>/);
    for (const prop of ["preselectedLocationId", "initialSchedule", "cloneFromJobId", "onSuccess"]) {
      expect(jobModalSrc).toMatch(new RegExp(`\\b${prop}=`));
    }
  });

  it("has no tab UI", () => {
    expect(jobCode).not.toMatch(/<Tabs\b/);
    expect(jobCode).not.toMatch(/<TabsTrigger\b/);
    expect(jobCode).not.toMatch(/<TabsContent\b/);
  });
});

// ── CreateTaskModal ────────────────────────────────────────────────

describe("CreateTaskModal — canonical ModalShell + Modal* primitives", () => {
  it("imports from @/components/ui/modal (not raw dialog)", () => {
    expect(taskModalSrc).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of ["ModalShell", "ModalHeader", "ModalTitle"]) {
      expect(taskModalSrc).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import from @/components/ui/dialog", () => {
    expect(taskCode).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("mounts <ModalShell> with canonical width + testid", () => {
    expect(taskModalSrc).toMatch(
      /<ModalShell[\s\S]*?className="max-w-xl sm:max-w-\[600px\] h-auto max-h-\[90vh\] flex flex-col overflow-hidden"/,
    );
    expect(taskModalSrc).toMatch(/data-testid="dialog-create-task"/);
  });

  it("renders a visible ModalHeader with 'Create Task' title", () => {
    expect(taskModalSrc).toMatch(/<ModalHeader>/);
    expect(taskModalSrc).toMatch(/<ModalTitle>\s*Create Task\s*<\/ModalTitle>/);
  });

  it("mounts <TaskDialog embedded forcedType=\"GENERAL\" /> with prefill props", () => {
    expect(taskModalSrc).toMatch(/<TaskDialog[\s\S]*?embedded[\s\S]*?forcedType="GENERAL"/);
    expect(taskModalSrc).toMatch(/initialData=\{initialData\}/);
    expect(taskModalSrc).toMatch(/onChanged=\{onChanged\}/);
  });

  it("has no tab UI", () => {
    expect(taskCode).not.toMatch(/<Tabs\b/);
    expect(taskCode).not.toMatch(/<TabsTrigger\b/);
    expect(taskCode).not.toMatch(/<TabsContent\b/);
  });
});

// ── createMenuConfig — CreateNewTab type ───────────────────────────

describe("createMenuConfig — CreateNewTab type ownership", () => {
  const menuSrc = readFileSync(
    resolve(__dirname, "../client/src/components/create/createMenuConfig.ts"),
    "utf-8",
  );

  it("exports CreateNewTab type (moved from CreateNewDialog)", () => {
    expect(menuSrc).toMatch(/export\s+type\s+CreateNewTab\s*=/);
  });

  it("preserves 'job' | 'task' | 'supplier-visit' union for backward compat", () => {
    expect(menuSrc).toMatch(/["']job["']\s*\|\s*["']task["']\s*\|\s*["']supplier-visit["']/);
  });

  it("does NOT import CreateNewTab from CreateNewDialog", () => {
    expect(menuSrc).not.toMatch(/from\s+["']@\/components\/CreateNewDialog["']/);
  });
});
