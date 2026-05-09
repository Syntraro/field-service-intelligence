/**
 * Service Plans — Service Generation card (2026-05-09 redesign).
 *
 * Pins the contract for the per-template `autoGenerateJobs` flag end
 * to end. The wizard/detail page now renders a unified "Service
 * Generation" either/or card instead of a standalone Switch toggle +
 * separate "Completion Window" section.
 *
 * Selected option:
 *   autoGenerateJobs: true  → "Automatically create work orders"
 *   autoGenerateJobs: false → "Notify me to create the work order"
 *                             + nested notification window inputs
 *
 * The two options are mutually exclusive (radio-style button pair with
 * an "OR" divider — not independent toggles).
 *
 * Critical product invariant — auto-generated jobs MUST be:
 *   - status='open' (not 'scheduled')
 *   - scheduledStart=null, scheduledEnd=null
 *   - no primary technician assignment (job-level field is gone)
 *   - no visit row created
 *   - no calendar reservation
 *   - linked back via recurrenceTemplateId + recurrenceInstanceDate
 *
 * The toggle does NOT enable auto-scheduling. Dispatchers still own
 * tech assignment and visit scheduling — auto-generation only creates
 * the work order.
 *
 * This file is a SOURCE PIN (no live database). It locks in the
 * structural shape of the wiring so a regression to "auto-promote
 * unconditionally" or "auto-promote schedules a visit too" trips here
 * before reaching production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const schemaSrc = readFileSync(
  resolve(__dirname, "../shared/schema.ts"),
  "utf-8",
);
const recurrenceSrc = readFileSync(
  resolve(__dirname, "../server/domain/recurrence.ts"),
  "utf-8",
);
const wizardSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/PMWizardPage.tsx"),
  "utf-8",
);
const detailSrc = readFileSync(
  resolve(__dirname, "../client/src/pages/PMDetailPage.tsx"),
  "utf-8",
);

// ── Schema + Zod contract ────────────────────────────────────────────

describe("recurringJobTemplates.autoGenerateJobs — schema contract", () => {
  it("Drizzle column exists, is boolean, NOT NULL, defaults to false", () => {
    expect(schemaSrc).toMatch(
      /autoGenerateJobs:\s*boolean\("auto_generate_jobs"\)\.notNull\(\)\.default\(false\)/,
    );
  });

  it("insertRecurringJobTemplateSchema accepts autoGenerateJobs (defaulting to false)", () => {
    // The insert schema must accept the field so POST /api/recurring-templates
    // can carry the wizard's toggle through to the DB.
    expect(schemaSrc).toMatch(
      /autoGenerateJobs:\s*z\.boolean\(\)\.default\(false\)/,
    );
  });

  it("updateRecurringJobTemplateSchema accepts autoGenerateJobs as optional", () => {
    // PATCH body is partial — the field is optional.
    expect(schemaSrc).toMatch(
      /autoGenerateJobs:\s*z\.boolean\(\)\.optional\(\)/,
    );
  });
});

// ── Server generation contract ───────────────────────────────────────

describe("server/domain/recurrence.ts — autoGenerateJobs is honoured", () => {
  it("generateForTemplate returns the IDs of new pending instances", () => {
    // The internal helper returns `newInstanceIds` so callers can hand
    // them to generateFromInstances when the template opts in.
    expect(recurrenceSrc).toMatch(
      /async function generateForTemplate\(\s*template: RecurringJobTemplate,[\s\S]+?\): Promise<\{ instancesCreated: number; jobsCreated: number; newInstanceIds: string\[\] \}>/,
    );
    expect(recurrenceSrc).toMatch(/const newInstanceIds: string\[\] = \[\]/);
    expect(recurrenceSrc).toMatch(/newInstanceIds\.push\(newInstance\.id\)/);
  });

  it("generateInstances auto-promotes when template.autoGenerateJobs is true", () => {
    // The batched worker path. Pin both the gate AND the call into
    // generateFromInstances — that is the function that actually
    // creates the unscheduled job.
    expect(recurrenceSrc).toMatch(
      /if \(template\.autoGenerateJobs && newInstanceIds\.length > 0\) \{[\s\S]+?const promote = await generateFromInstances\(companyId, newInstanceIds\);/,
    );
  });

  it("generateForSingleTemplate auto-promotes when template.autoGenerateJobs is true", () => {
    // The post-create path used by POST /api/recurring-templates after
    // a brand-new contract is inserted. Same auto-promote rule.
    // We pin the same conditional block twice in the file.
    const matches = recurrenceSrc.match(
      /if \(template\.autoGenerateJobs && newInstanceIds\.length > 0\) \{[\s\S]+?const promote = await generateFromInstances\(companyId, newInstanceIds\);/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT auto-promote when autoGenerateJobs is false (gate is required)", () => {
    // Inverse pin: there must be NO unconditional call to
    // generateFromInstances inside the template loop. The only
    // generateFromInstances call paths are (a) gated on
    // autoGenerateJobs and (b) the standalone exported function used
    // by the manual "generate selected" UI.
    const promoteCalls = recurrenceSrc.match(
      /await generateFromInstances\(/g,
    );
    expect(promoteCalls).not.toBeNull();
    // Two gated call sites + the exported function's body do NOT
    // recurse, so the count of `await generateFromInstances(` calls
    // is exactly 2 — the two opt-in callers.
    expect(promoteCalls!.length).toBe(2);
  });

  it("auto-promoted jobs reuse the existing unscheduled-job creation contract", () => {
    // generateFromInstances builds the job with status='open',
    // scheduledStart=null, scheduledEnd=null. We pin those literal
    // properties on the createJob payload to trip if a future
    // refactor accidentally adds a scheduled timestamp or a tech
    // assignment.
    expect(recurrenceSrc).toMatch(/status:\s*"open"\s+as\s+JobStatus/);
    expect(recurrenceSrc).toMatch(/scheduledStart:\s*null/);
    expect(recurrenceSrc).toMatch(/scheduledEnd:\s*null/);
    // Confirm the long-standing comment that PM jobs are unassigned
    // is still in place — the contract must not silently change.
    expect(recurrenceSrc).toMatch(
      /PM jobs are unassigned — dispatchers assign[\s\S]+?after generation/,
    );
    // Sanity: the file does NOT introduce any visit-row insert as
    // part of auto-generation.
    expect(recurrenceSrc).not.toMatch(/insert\(visits\)/i);
    expect(recurrenceSrc).not.toMatch(/insert\(jobVisits\)/i);
  });
});

// ── Client contract — PMWizardPage (create flow) ─────────────────────

describe("PMWizardPage — Service Generation card", () => {
  it("WizardState carries an autoGenerateJobs boolean (defaulting to false)", () => {
    expect(wizardSrc).toMatch(/autoGenerateJobs:\s*boolean/);
    expect(wizardSrc).toMatch(/autoGenerateJobs:\s*false/);
  });

  it("one parent Service Generation card exists with the correct testId", () => {
    expect(wizardSrc).toMatch(/data-testid="pm-wizard-service-generation"/);
  });

  it("no standalone Completion Window section remains", () => {
    // Check that there is no Completion Window heading rendered in the UI.
    expect(wizardSrc).not.toMatch(/<h[1-6][^>]*>\s*Completion Window\s*<\/h/);
    expect(wizardSrc).not.toMatch(/label:\s*"Completion Window"/);
  });

  it("renders the 'Automatically create work orders' option card", () => {
    expect(wizardSrc).toMatch(/data-testid="pm-wizard-service-gen-auto"/);
    expect(wizardSrc).toMatch(/Automatically create work orders/);
    expect(wizardSrc).toMatch(
      /An unscheduled work order will be created automatically on the job creation date/,
    );
    expect(wizardSrc).toMatch(
      /Dispatch can then schedule and assign the work/,
    );
  });

  it("renders the 'Notify me to create the work order' option card", () => {
    expect(wizardSrc).toMatch(/data-testid="pm-wizard-service-gen-manual"/);
    expect(wizardSrc).toMatch(/Notify me to create the work order/);
    expect(wizardSrc).toMatch(
      /You'll be notified so you can manually create the work order/,
    );
  });

  it("options are mutually exclusive (selecting auto sets autoGenerateJobs true, manual sets false)", () => {
    // Each button's onClick must hardcode the opposite boolean — not toggle.
    // onClick comes before data-testid in JSX attribute order, so match that order.
    expect(wizardSrc).toMatch(
      /onChange\(\s*\{\s*autoGenerateJobs:\s*true\s*\}\s*\)[\s\S]+?data-testid="pm-wizard-service-gen-auto"/,
    );
    expect(wizardSrc).toMatch(
      /onChange\(\s*\{\s*autoGenerateJobs:\s*false\s*\}\s*\)[\s\S]+?data-testid="pm-wizard-service-gen-manual"/,
    );
    // No Switch primitive — it would imply an independent toggle.
    expect(wizardSrc).not.toMatch(/<Switch\b[\s\S]+?data-testid="pm-wizard-auto-generate-jobs"/);
  });

  it("notification window copy references work order creation, not 'scheduled date'", () => {
    expect(wizardSrc).toMatch(/days before the work order is created/);
    expect(wizardSrc).not.toMatch(/scheduled date/);
    expect(wizardSrc).not.toMatch(/due date.*notification/i);
  });

  it("days-before input is nested under the manual option with canonical testId", () => {
    expect(wizardSrc).toMatch(/data-testid="pm-wizard-window-before"/);
    expect(wizardSrc).toMatch(/days before job creation/);
  });

  it("days-after input is nested under the manual option with canonical testId", () => {
    expect(wizardSrc).toMatch(/data-testid="pm-wizard-window-after"/);
    expect(wizardSrc).toMatch(/days after job creation/);
  });

  it("sidebar summary uses 'Service Generation' label (not 'Completion Window')", () => {
    expect(wizardSrc).toMatch(/label:\s*"Service Generation"/);
    expect(wizardSrc).not.toMatch(/label:\s*"Completion Window"/);
  });

  it("forwards autoGenerateJobs in the create payload", () => {
    expect(wizardSrc).toMatch(/autoGenerateJobs:\s*state\.autoGenerateJobs/);
  });
});

// ── Client contract — PMDetailPage (edit flow) ───────────────────────

describe("PMDetailPage — Service Generation card is editable", () => {
  it("EditFormState carries an autoGenerateJobs boolean", () => {
    expect(detailSrc).toMatch(/autoGenerateJobs:\s*boolean/);
  });

  it("templateToFormState seeds autoGenerateJobs from the loaded template", () => {
    expect(detailSrc).toMatch(
      /autoGenerateJobs:\s*\(tpl as \{[\s\S]+?\}\)\.autoGenerateJobs\s*\?\?\s*false/,
    );
  });

  it("one parent Service Generation card exists with the correct testId", () => {
    expect(detailSrc).toMatch(/data-testid="pm-detail-service-generation"/);
  });

  it("no standalone Completion Window section remains", () => {
    expect(detailSrc).not.toMatch(/Completion Window/);
  });

  it("renders 'Automatically create work orders' and 'Notify me' option cards", () => {
    expect(detailSrc).toMatch(/data-testid="pm-detail-service-gen-auto"/);
    expect(detailSrc).toMatch(/data-testid="pm-detail-service-gen-manual"/);
    expect(detailSrc).toMatch(/Automatically create work orders/);
    expect(detailSrc).toMatch(/Notify me to create the work order/);
  });

  it("options are mutually exclusive — no Switch primitive", () => {
    expect(detailSrc).not.toMatch(/<Switch\b[\s\S]+?data-testid="pm-detail-auto-generate-jobs"/);
  });

  it("the view-mode Schedule card uses 'Service generation' label", () => {
    expect(detailSrc).toMatch(/label="Service generation"/);
    expect(detailSrc).toMatch(/Automatically create work orders/);
    expect(detailSrc).toMatch(/Notify manually/);
  });

  it("forwards autoGenerateJobs in the PATCH payload", () => {
    expect(detailSrc).toMatch(/autoGenerateJobs:\s*form\.autoGenerateJobs/);
  });
});
