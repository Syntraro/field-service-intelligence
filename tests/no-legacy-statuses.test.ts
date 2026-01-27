/**
 * Regression Test: No Legacy Job Statuses
 *
 * Ensures banned legacy status strings are never used as job lifecycle status
 * values anywhere in the codebase. These values were replaced by the normalized
 * 4-status model (open, completed, invoiced, archived) with derived states.
 *
 * Banned values: scheduled, assigned, unscheduled, overdue, in_progress, requires_invoicing
 *
 * Uses ripgrep (rg) via execFileSync to scan server/, client/, shared/ directories
 * with an allowlist of files that legitimately reference these strings (e.g.,
 * migration mappings, display labels, documentation).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";

/** Files excluded from the legacy status check (legitimate uses). */
const ALLOWLISTED_GLOBS = [
  // Task module (has its own status model)
  "server/routes/tasks.routes.ts",
  "server/storage/tasks.ts",
  // Job visits module (has its own status model)
  "server/routes/jobVisits.routes.ts",
  "server/storage/jobVisits.ts",
  // Migration scripts and legacy mapping schemas
  "server/scripts/**",
  "server/schemas.ts",
  // Status rules documentation (defines state machine)
  "server/statusRules.ts",
  // Domain docs (comments documenting derived states)
  "server/domain/**",
  // Storage display-only queries (SQL CASE producing UI labels)
  "server/storage/maintenance.ts",
  "server/storage/dashboard.ts",
  // Shared schema (migration mappings, predicate docs, audit context labels)
  "shared/schema.ts",
  // Client display-only / documentation pages
  "client/src/pages/LocationDetailPage.tsx",
  "client/src/pages/JobStatusesPage.tsx",
  "client/src/pages/Dashboard.tsx",
  "client/src/pages/InvoicesListPage.tsx",
  "client/src/components/ClientJobsTab.tsx",
  "client/src/components/JobHeaderCard.tsx",
  "client/src/components/MaintenanceCard.tsx",
  "client/src/components/examples/**",
  // Scheduling history (reads audit context labels)
  "client/src/components/job/SchedulingHistory.tsx",
  // Status progress bar (displays openSubStatus workflow)
  "client/src/components/job/StatusProgressBar.tsx",
  // Tasks sidebar (has its own task status model, not job lifecycle)
  "client/src/components/TasksSidebar.tsx",
  // Quotes route (comment-only reference: "scheduled is derived from scheduledStart")
  "server/routes/quotes.ts",
  // Jobs route (comments documenting openSubStatus workflow for technicians)
  "server/routes/jobs.ts",
  // Calendar storage (SQL comment block documenting legacy data cleanup)
  "server/storage/calendar.ts",
  // Docs, changelog, tests, config
  "docs/**",
  "CHANGELOG.md",
  "tests/**",
  "*.config.ts",
];

/**
 * Banned legacy status values and their rg patterns.
 *
 * Each entry maps a banned string to a regex that detects its use as a
 * lifecycle status value (status comparisons/assignments).
 *
 * Special case: 'in_progress' is a valid openSubStatus value, so the
 * pattern uses PCRE2 negative lookbehind to exclude openSubStatus/subStatus
 * comparisons.
 */
const BANNED_STATUSES: Array<{ value: string; pattern: string; pcre2?: boolean }> = [
  { value: "scheduled", pattern: "status.*['\"]scheduled['\"]" },
  { value: "assigned", pattern: "status.*['\"]assigned['\"]" },
  { value: "unscheduled", pattern: "status.*['\"]unscheduled['\"]" },
  { value: "overdue", pattern: "status.*['\"]overdue['\"]" },
  {
    value: "in_progress",
    // PCRE2 negative lookbehind: match status...in_progress but NOT when
    // preceded by openSub, sub, or Sub (which are valid openSubStatus uses)
    pattern: "(?<!openSub|sub|Sub)[Ss]tatus.*['\"]in_progress['\"]",
    pcre2: true,
  },
  { value: "requires_invoicing", pattern: "status.*['\"]requires_invoicing['\"]" },
];

/**
 * Build rg args array for a given pattern.
 * Uses execFileSync to avoid shell quoting issues entirely.
 */
function buildRgArgs(pattern: string, usePcre2: boolean): string[] {
  const args: string[] = [];

  if (usePcre2) {
    args.push("--pcre2");
  }

  // Add tsx type definition and file type filters
  args.push("--type-add", "tsx:*.tsx", "--type", "ts", "--type", "tsx");

  // List matching files only
  args.push("-l");

  // Add allowlist exclusions
  for (const glob of ALLOWLISTED_GLOBS) {
    args.push("--glob", `!${glob}`);
  }

  // Pattern
  args.push(pattern);

  // Search directories
  args.push("server/", "client/", "shared/");

  return args;
}

describe("no-legacy-job-statuses", () => {
  for (const { value, pattern, pcre2 } of BANNED_STATUSES) {
    it(`should not use '${value}' as a job lifecycle status`, () => {
      const args = buildRgArgs(pattern, pcre2 === true);

      let matchingFiles: string[] = [];
      try {
        // execFileSync bypasses the shell, so no quoting issues
        const output = execFileSync("rg", args, {
          cwd: "/home/runner/workspace",
          encoding: "utf-8",
          timeout: 15000,
        });
        matchingFiles = output
          .trim()
          .split("\n")
          .filter((f) => f.length > 0);
      } catch (error: any) {
        // rg exit code 1 = no matches (success for us)
        if (error.status === 1) {
          matchingFiles = [];
        } else {
          throw new Error(
            `rg command failed with exit code ${error.status}: ${error.stderr || error.message}`
          );
        }
      }

      expect(
        matchingFiles,
        `Found legacy status '${value}' used as a job lifecycle status in:\n` +
          matchingFiles.map((f) => `  - ${f}`).join("\n") +
          `\n\nThese files use the banned legacy status value '${value}'.\n` +
          `Job lifecycle statuses must be one of: open, completed, invoiced, archived.\n` +
          `If this is a legitimate use (display label, migration, etc.), add the file to the allowlist.`
      ).toHaveLength(0);
    });
  }
});
