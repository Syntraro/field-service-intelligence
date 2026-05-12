/**
 * Form System Canonical Drift Guard (2026-05-09).
 *
 * Auto-discovers every source file under client/src/ that imports the canonical
 * form primitives from @/components/ui/form-field. Asserts that none of those
 * files contain the raw drift patterns that Phase 2C eliminated.
 *
 * COVERAGE
 * ─────────
 * Complements form-field-phase2c1.test.ts (per-file structural contracts).
 * This test runs a global regex scan that:
 *   • auto-adds new consumers as they import form-field
 *   • guards all 8 banned raw patterns in a single pass
 *   • forces documented allowlist entries for intentional exceptions
 *   • catches stale allowlist entries when a pattern is later removed
 *
 * SCOPE (what is NOT guarded here)
 * ──────────────────────────────────
 * • form-field.tsx itself — guarded by form-field-canonical.test.ts
 * • menus, headers, entity lists, toolbars — out of scope per CLAUDE.md
 * • non-form-field-consumer files — not in the scan set
 *
 * ADDING AN ALLOWLIST ENTRY
 * ──────────────────────────
 * 1. Find the file's relative path from repo root (forward slashes).
 * 2. Identify which BANNED_PATTERNS key applies.
 * 3. Add to ALLOWLIST[filePath][patternKey] = { reason: "..." }.
 * 4. reason MUST be a non-empty string. Vague reasons ("legacy", "TODO") are
 *    not acceptable — explain WHY the canonical primitive cannot be used here.
 * 5. The allowlist entry is itself tested: if the pattern disappears from the
 *    file, the stale-entry test fails, prompting cleanup.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

const ROOT = resolve(__dirname, "..");
const CLIENT_SRC = join(ROOT, "client", "src");

// ─── File Discovery ────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

const FORM_FIELD_IMPORT = /from\s+["']@\/components\/ui\/form-field["']/;

interface Consumer {
  path: string;  // absolute
  rel: string;   // relative to ROOT, forward slashes
  src: string;
}

const CONSUMERS: Consumer[] = walkDir(CLIENT_SRC)
  .filter((p) => !p.endsWith("form-field.tsx")) // exclude the primitive itself
  .map((p) => ({
    path: p,
    rel: relative(ROOT, p).replace(/\\/g, "/"),
    src: readFileSync(p, "utf-8"),
  }))
  .filter((f) => FORM_FIELD_IMPORT.test(f.src));

// ─── Banned Patterns ──────────────────────────────────────────────────────────
//
// These are the 8 raw patterns that the canonical form system replaces.
// Any file importing form-field must use the canonical primitives instead.
//
// Pattern intent notes:
//   RAW_SPACE_Y_1_DIV / RAW_SPACE_Y_1_5_DIV  — matches only <div> with that as
//     its sole className ("space-y-1.5 other-class" is NOT caught, only bare wrappers).
//   RAW_GRID_FIELD_ROW — matches <div className="grid grid-cols-2..."> and
//     <div className="grid grid-cols-3..."> (raw field-row divs before FormRow).
//   RAW_LABEL_WITH_CLASSNAME — matches <Label className=...> (React component,
//     uppercase). Does NOT match <label className=...> (HTML element, lowercase),
//     which is used for compact scheduling labels in the tech-app (intentional).

const BANNED_PATTERNS = {
  RAW_ERROR_TEXT: {
    regex: /<p\s+className="text-xs text-destructive"/,
    fix: "Use <FormErrorText> instead of <p className=\"text-xs text-destructive\">",
  },
  RAW_HELPER_TEXT: {
    regex: /<p\s+className="text-xs text-muted-foreground"/,
    fix: "Use <FormHelperText> instead of <p className=\"text-xs text-muted-foreground\">",
  },
  RAW_SPACE_Y_1_DIV: {
    regex: /<div\s+className="space-y-1"/,
    fix: "Use <FormField> instead of <div className=\"space-y-1\"> as a field wrapper",
  },
  RAW_SPACE_Y_1_5_DIV: {
    regex: /<div\s+className="space-y-1\.5"/,
    fix: "Use <FormField> instead of <div className=\"space-y-1.5\"> as a field wrapper",
  },
  RAW_FIELDSET: {
    regex: /<fieldset/,
    fix: "Use <FormSection title=\"...\"> instead of raw <fieldset>",
  },
  RAW_LEGEND: {
    regex: /<legend/,
    fix: "Use <FormSection title=\"...\"> instead of raw <legend>",
  },
  RAW_GRID_FIELD_ROW: {
    regex: /<div\s+className="grid grid-cols-[23]/,
    fix: "Use <FormRow className=\"grid-cols-N\"> instead of <div className=\"grid grid-cols-N\">",
  },
  RAW_LABEL_WITH_CLASSNAME: {
    regex: /<Label\s+className=/,
    fix: "Use <FormLabel> instead of <Label className=...> for form input labels",
  },
} as const;

type PatternKey = keyof typeof BANNED_PATTERNS;

// ─── Allowlist ─────────────────────────────────────────────────────────────────
//
// Keys are repo-relative paths with forward slashes (matching Consumer.rel).
// Every entry MUST have a non-empty `reason` string that:
//   • names the specific use case
//   • explains why the canonical primitive cannot replace it
//   • is not a generic deferral ("TODO", "legacy", "migrate later")
//
// PERMANENT EXCEPTIONS (documented here but not in the allowlist because
// the patterns don't appear in form-field consumer files):
//
//   <Label htmlFor="...">          — canonical for checkbox/switch visible labels.
//                                    Correct: NOT banned (banned: <Label className=...>).
//                                    formfield-phase2c1.test.ts pins this contract.
//
//   <label className="text-[10px]"> — compact scheduling labels in tech-app pages.
//                                    Correct: lowercase <label> (HTML element), NOT
//                                    React <Label> component. RAW_LABEL_WITH_CLASSNAME
//                                    regex matches uppercase <Label> only.
//
//   Page-level / server error banners — typically outside form-field consumers.
//   Non-form descriptive paragraphs  — use text-xs text-muted-foreground legitimately.
//   AddressAutocomplete internals    — not a form-field consumer; not in scope.

type AllowlistEntry = { reason: string };
type Allowlist = Partial<Record<PatternKey, AllowlistEntry>>;
const ALLOWLIST: Record<string, Allowlist> = {
  // Phase C-1 (2026-05-11): EditVisitModal migrated its standalone visit-notes
  // textarea to FormField + FormLabel srOnly. The schedule grid (Date / Start /
  // Duration / Assigned To) uses a two-column grid div for compact inline-label
  // rows inside h-11 bordered cells — a deliberate density constraint that does
  // not map to FormRow (which is a standard label-above-input field row). Migrating
  // the grid to FormRow would break the schedule section's layout contract.
  "client/src/components/visits/EditVisitModal.tsx": {
    RAW_GRID_FIELD_ROW: {
      reason:
        "Schedule grid uses <div className=\"grid grid-cols-2\"> for compact inline-label " +
        "rows (h-11 bordered cells, label-left / value-right). This is a density layout " +
        "pattern, not a standard label-above-input field row. FormRow cannot replace it " +
        "without breaking the schedule section's visual contract. Only the visit-notes " +
        "textarea (Phase C-1 target) was migrated in this session.",
    },
  },
  // Phase C (2026-05-11): PaymentsDashboardPage became a form-field consumer after
  // FilterField was migrated from <Label className=...> to <FormLabel>. The DisputesTab
  // summary row uses <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
  // as a responsive metric-card grid (6 SummaryCard tiles), not a label-above-input
  // field row. FormRow is a field-layout primitive and cannot replace a card grid.
  "client/src/pages/PaymentsDashboardPage.tsx": {
    RAW_GRID_FIELD_ROW: {
      reason:
        "DisputesTab summary uses <div className=\"grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6\"> " +
        "as a 6-column responsive metric-card grid (SummaryCard tiles). This is a dashboard " +
        "layout pattern, not a form field row. FormRow cannot replace it.",
    },
  },
  // Phase C (2026-05-11): SupportConsole became a form-field consumer after dialog fields
  // were migrated to FormField/FormLabel/FormHelperText. The Company Details panel uses
  // <div className="grid grid-cols-2 gap-4"> as a read-only 2-column info grid (plan /
  // status / users / locations). This is a data-display layout, not a form field row.
  "client/src/pages/SupportConsole.tsx": {
    RAW_GRID_FIELD_ROW: {
      reason:
        "Company Details panel uses <div className=\"grid grid-cols-2 gap-4\"> as a read-only " +
        "2-column info grid (subscription plan / status / user count / location count). " +
        "This is a data-display layout pattern, not a label-above-input field row. " +
        "FormRow cannot replace it without redesigning the info panel.",
    },
  },
  // Phase C (2026-05-11): RolesAccessTab migrated the Role select field to
  // FormField + FormLabel + FormHelperText. Three text-xs text-muted-foreground
  // paragraphs remain in non-form contexts:
  //   (1) member email subtitle below the card title — display metadata, not helper
  //   (2) "Loading…" skeleton in EffectiveAccessPanel — status message
  //   (3) permission.description in renderOverrideRow — metadata alongside tri-state
  //       Allow/Deny/Inherit buttons, not a standard FormField helper
  "client/src/components/team-hub/RolesAccessTab.tsx": {
    RAW_HELPER_TEXT: {
      reason:
        "Three non-form-context paragraphs: (1) member email below card title — display " +
        "metadata, not field helper text; (2) loading skeleton in EffectiveAccessPanel — " +
        "status message; (3) permission description in renderOverrideRow — descriptive " +
        "metadata alongside tri-state toggle buttons, not a standard FormField helper.",
    },
  },
  // Phase C medium-safe (2026-05-11): PMTemplateEditorPage — FrequencyPicker uses
  // <div className="grid grid-cols-3 sm:grid-cols-5"> as a button-palette layout
  // (5 frequency preset buttons in a responsive grid). This is a UI control, not a
  // label-above-input field row. FormRow cannot replace it without breaking the picker.
  "client/src/pages/PMTemplateEditorPage.tsx": {
    RAW_GRID_FIELD_ROW: {
      reason:
        "FrequencyPicker renders preset buttons in <div className=\"grid grid-cols-3 sm:grid-cols-5\"> — " +
        "a responsive button-palette layout, not a label-above-input field row. " +
        "FormRow is a field-layout primitive and cannot replace a button grid without " +
        "breaking the picker's compact visual contract.",
    },
  },
  // Phase C medium-safe (2026-05-11): PMDetailPage migrated PlanBasicsEditCard fields
  // (plan name, description) and ScheduleCard start/end date fields to FormField/FormLabel/FormRow.
  // Two patterns remain allowlisted:
  //   RAW_LABEL_WITH_CLASSNAME — service window notification section uses
  //     <Label className="text-xs text-muted-foreground"> as inline unit labels next to
  //     compact <Input type="number" className="w-16 h-8"> controls ("days before/after
  //     job creation"). These are visual suffix labels in a flex row, not label-above-input
  //     form fields. Restructuring the compact notification window layout to use FormLabel
  //     would change the density contract of the scheduling section.
  //   RAW_SPACE_Y_1_DIV — WorkQueueCard and GeneratedWorkCard use
  //     <div className="space-y-1"> as list item containers for pending PM instances and
  //     generated job link rows. These are card-body list wrappers, not form field
  //     wrappers; FormField cannot replace them.
  "client/src/pages/PMDetailPage.tsx": {
    RAW_LABEL_WITH_CLASSNAME: {
      reason:
        "Service window section uses <Label className=\"text-xs text-muted-foreground\"> as inline " +
        "unit labels for compact numeric inputs (\"days before/after job creation\") inside a flex " +
        "row. These are visual suffix labels, not label-above-input form fields. Converting them to " +
        "FormLabel would require restructuring the compact notification window layout and break the " +
        "scheduling-density contract.",
    },
    RAW_SPACE_Y_1_DIV: {
      reason:
        "WorkQueueCard and GeneratedWorkCard use <div className=\"space-y-1\"> as list item " +
        "containers for pending PM instance rows and generated job link rows. These are card-body " +
        "list wrappers, not form field wrappers; FormField cannot replace them.",
    },
  },
};

// ─── Sanity ────────────────────────────────────────────────────────────────────

describe("Form canonical drift — discovery sanity", () => {
  it("CLIENT_SRC directory exists", () => {
    expect(existsSync(CLIENT_SRC)).toBe(true);
  });

  it("discovers at least 15 form-field consumer files (2026-05-09 baseline)", () => {
    // Baseline re-pinned 2026-05-09 after Pricebook EntityListTable canonicalization.
    // Phase 2C target was 18; actual confirmed count is 15 (3 components migrated
    // away from form-field during the same session's other refactoring).
    // If this count drops below 15, a file may have lost its form-field import.
    expect(CONSUMERS.length).toBeGreaterThanOrEqual(15);
  });

  it("form-field.tsx itself is NOT in the consumer list", () => {
    const hasself = CONSUMERS.some((c) => c.rel.endsWith("form-field.tsx"));
    expect(hasself).toBe(false);
  });

  it("all discovered consumer files are still readable on disk", () => {
    for (const { path } of CONSUMERS) {
      expect(existsSync(path), `Missing: ${path}`).toBe(true);
    }
  });
});

// ─── Drift Guard ───────────────────────────────────────────────────────────────
//
// For each consumer file, checks every banned pattern.
// Allowlisted patterns generate a "stale allowlist" test instead — if the
// pattern has been removed from the file, that test fails, prompting cleanup.

describe("Form canonical drift — no banned raw patterns in migrated files", () => {
  for (const { rel, src } of CONSUMERS) {
    const fileAllowlist = ALLOWLIST[rel] ?? {};

    for (const [key, { regex, fix }] of Object.entries(BANNED_PATTERNS) as Array<
      [PatternKey, { regex: RegExp; fix: string }]
    >) {
      const entry = fileAllowlist[key];

      if (entry) {
        // Allowlisted — assert the pattern still exists so stale entries are caught.
        // If this test FAILS: the banned pattern has been removed. Delete the ALLOWLIST
        // entry for `${rel}` > `${key}`.
        it(`${rel} — ${key} — allowlisted (stale-entry guard)`, () => {
          expect(
            regex.test(src),
            `Stale allowlist: "${rel}" no longer contains ${key}. Remove ALLOWLIST["${rel}"]["${key}"].`,
          ).toBe(true);
        });
      } else {
        // Not allowlisted — pattern must be absent.
        it(`${rel} — no ${key}`, () => {
          if (regex.test(src)) {
            throw new Error(
              `Drift detected in ${rel}\n` +
                `  Pattern:  ${key}\n` +
                `  Fix:      ${fix}\n` +
                `  Or add an ALLOWLIST entry in tests/form-canonical-drift.test.ts\n` +
                `  with a documented reason if this exception is intentional.`,
            );
          }
        });
      }
    }
  }
});

// ─── FormHelperText / FormErrorText usage in migrated files ──────────────────
//
// Positive assertions: confirm that files migrated in the helper/error text sweep
// (2026-05-10) import and use the canonical primitives. The drift guard above
// ensures the banned raw patterns are gone; this section ensures the
// canonical replacements are actually present.

const MIGRATED_HELPER_FILES = [
  "client/src/components/portal/SendPaymentLinkDialog.tsx",
  "client/src/components/team-hub/AddMemberDialog.tsx",
  "client/src/components/invoice/EmbeddedStripeCardForm.tsx",
  "client/src/components/team-hub/InviteMemberDialog.tsx",
] as const;

describe("Form canonical drift — FormHelperText / FormErrorText in migrated files", () => {
  for (const rel of MIGRATED_HELPER_FILES) {
    const src = readFileSync(resolve(ROOT, rel), "utf-8");
    it(`${rel} — imports FormHelperText from form-field`, () => {
      expect(src).toContain('from "@/components/ui/form-field"');
      expect(src).toContain("FormHelperText");
    });
    it(`${rel} — uses <FormHelperText> (not raw <p>)`, () => {
      expect(src).toContain("<FormHelperText>");
      expect(src).not.toMatch(/<p\s+className="text-xs text-muted-foreground"/);
    });
    it(`${rel} — no raw <p className="text-xs text-destructive">`, () => {
      expect(src).not.toMatch(/<p\s+className="text-xs text-destructive"/);
    });
  }
});

// ─── Allowlist Integrity ───────────────────────────────────────────────────────
//
// Ensures every ALLOWLIST entry still refers to an existing consumer file.
// A file that was removed or renamed would leave an orphaned allowlist entry.

describe("Form canonical drift — allowlist integrity", () => {
  const consumerRels = new Set(CONSUMERS.map((c) => c.rel));

  for (const [filePath] of Object.entries(ALLOWLIST)) {
    it(`allowlist entry "${filePath}" refers to an active consumer`, () => {
      expect(
        consumerRels.has(filePath),
        `ALLOWLIST entry "${filePath}" does not match any form-field consumer. ` +
          "The file may have been removed or renamed — delete this allowlist entry.",
      ).toBe(true);
    });
  }

  it("allowlist has exactly 6 entries (EditVisitModal schedule grid + PaymentsDashboardPage metric card grid + SupportConsole company details info grid + RolesAccessTab non-form paragraphs + PMDetailPage service-window inline labels + list containers + PMTemplateEditorPage frequency picker button grid)", () => {
    // Phase C-1 (2026-05-11): EditVisitModal — schedule grid density layout.
    // Phase C (2026-05-11): PaymentsDashboardPage — DisputesTab metric-card grid.
    // Phase C (2026-05-11): SupportConsole — Company Details read-only info grid.
    // Phase C (2026-05-11): RolesAccessTab — non-form text-xs paragraphs (email metadata, loading state, permission description).
    // Phase C medium-safe (2026-05-11): PMDetailPage — service-window inline unit labels + work-card list containers.
    // Phase C medium-safe (2026-05-11): PMTemplateEditorPage — FrequencyPicker button-palette grid.
    expect(Object.keys(ALLOWLIST)).toHaveLength(6);
  });
});
