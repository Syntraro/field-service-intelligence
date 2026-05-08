/**
 * Operational Alerts — modal mode wiring + per-mode source filtering
 * (2026-05-06 normalization).
 *
 * Locks the contract that:
 *   • Each Operational Alerts row routes to the shared `DashboardActionModal`.
 *   • Each row passes its own canonical mode — `requires_attention`,
 *     `past_due`, `unscheduled`, `ready_to_invoice`.
 *   • The modal renders ONLY the source(s) that belong to the active mode.
 *     Specifically: `past_due` shows only the `overdue` source (no
 *     `unscheduled` section); `unscheduled` shows only the `unscheduled`
 *     source (no `overdue` section). This replaces the prior combined
 *     `scheduling_issues` mode that surfaced both.
 *   • The card-level row counts and the modal's per-mode source data come
 *     from the same `/api/dashboard/workflow` aggregate so counts can't
 *     drift between the row and the drilldown.
 *
 * Source-pin tests over the canonical wiring points. The modal renderer
 * itself is generic (iterates `config.sources`), so locking
 * `MODE_CONFIG` is sufficient to guarantee per-mode filtering.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const MODAL_PATH = resolve(ROOT, "client/src/components/DashboardActionModal.tsx");
const ALERTS_CARD_PATH = resolve(ROOT, "client/src/components/dashboard/OperationalAlertsCard.tsx");
const DASHBOARD_PATH = resolve(ROOT, "client/src/pages/FinancialDashboard.tsx");

const modalSrc = readFileSync(MODAL_PATH, "utf-8");
const alertsCardSrc = readFileSync(ALERTS_CARD_PATH, "utf-8");
const dashSrc = readFileSync(DASHBOARD_PATH, "utf-8");

// ─── Mode union type ──────────────────────────────────────────────────

describe("DashboardActionMode — canonical mode union", () => {
  it("declares the four operational-alert modes plus invoices_not_sent", () => {
    const block = modalSrc.match(
      /export type DashboardActionMode\s*=\s*([\s\S]+?);/,
    );
    expect(block, "DashboardActionMode union must exist").toBeTruthy();
    const text = block![1];
    expect(text).toMatch(/"requires_attention"/);
    expect(text).toMatch(/"past_due"/);
    expect(text).toMatch(/"unscheduled"/);
    expect(text).toMatch(/"ready_to_invoice"/);
    // 2026-05-06 RALPH: dashboard Needs Attention drill-down for unsent
    // invoices is the fifth canonical mode — same modal, same chrome,
    // same source pattern. No standalone invoice modal component.
    expect(text).toMatch(/"invoices_not_sent"/);
  });

  it("does NOT keep the retired combined mode names", () => {
    // Both used to be in the union and the MODE_CONFIG; they must be gone.
    const codeOnly = modalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/"action_required"/);
    expect(codeOnly).not.toMatch(/"scheduling_issues"/);
  });
});

// ─── MODE_CONFIG — sources per mode ───────────────────────────────────

describe("MODE_CONFIG — each mode renders only its own filtered source(s)", () => {
  // Pull each mode's config block out of MODE_CONFIG and check `sources`.
  // Strip block + line comments so cross-referencing prose ("see also the
  // `overdue` source") doesn't false-trigger the negative source pins.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  }
  function modeBlock(mode: string): string {
    const m = modalSrc.match(
      new RegExp(`${mode}:\\s*\\{[\\s\\S]+?\\},`, "m"),
    );
    expect(m, `MODE_CONFIG.${mode} must exist`).toBeTruthy();
    return stripComments(m![0]);
  }

  it("requires_attention sources = on_hold + pm_due (no overdue / unscheduled)", () => {
    const block = modeBlock("requires_attention");
    expect(block).toMatch(/sources:\s*\["on_hold",\s*"pm_due"\]/);
    expect(block).not.toMatch(/"overdue"/);
    expect(block).not.toMatch(/"unscheduled"/);
    expect(block).toMatch(/title:\s*"Requires Attention"/);
  });

  it("past_due sources = [overdue] ONLY (no unscheduled)", () => {
    const block = modeBlock("past_due");
    expect(block).toMatch(/sources:\s*\["overdue"\]/);
    expect(block).not.toMatch(/"unscheduled"/);
    expect(block).not.toMatch(/"on_hold"/);
    expect(block).not.toMatch(/"pm_due"/);
    expect(block).toMatch(/title:\s*"Past Due Jobs"/);
  });

  it("unscheduled sources = [unscheduled] ONLY (no overdue)", () => {
    const block = modeBlock("unscheduled");
    expect(block).toMatch(/sources:\s*\["unscheduled"\]/);
    expect(block).not.toMatch(/"overdue"/);
    expect(block).not.toMatch(/"on_hold"/);
    expect(block).not.toMatch(/"pm_due"/);
    expect(block).toMatch(/title:\s*"Unscheduled Jobs"/);
  });

  it("ready_to_invoice sources = [ready_to_invoice] ONLY", () => {
    const block = modeBlock("ready_to_invoice");
    expect(block).toMatch(/sources:\s*\["ready_to_invoice"\]/);
    expect(block).not.toMatch(/"overdue"/);
    expect(block).not.toMatch(/"unscheduled"/);
    expect(block).toMatch(/title:\s*"Ready to Invoice"/);
  });

  it("invoices_not_sent sources = [unsent_invoices] ONLY", () => {
    // 2026-05-06 RALPH: Needs Attention drill-down. Single source —
    // the canonical invoice feed filtered to status=draft.
    const block = modeBlock("invoices_not_sent");
    expect(block).toMatch(/sources:\s*\["unsent_invoices"\]/);
    expect(block).not.toMatch(/"overdue"/);
    expect(block).not.toMatch(/"unscheduled"/);
    expect(block).not.toMatch(/"on_hold"/);
    expect(block).not.toMatch(/"pm_due"/);
    expect(block).not.toMatch(/"ready_to_invoice"/);
    expect(block).toMatch(/title:\s*"Invoices Not Sent"/);
  });
});

// ─── OperationalAlertsCard — row → mode mapping ──────────────────────

describe("OperationalAlertsCard — row → mode mapping is the canonical 4-mode set", () => {
  // Each row config is `{ key, label, count, icon, mode, ... }` — pin the
  // mode literal beside each row's key so a future refactor can't quietly
  // re-collapse two rows into one mode.
  it("ready_to_invoice row passes mode=ready_to_invoice", () => {
    expect(alertsCardSrc).toMatch(
      /ready_to_invoice:\s*\{[\s\S]+?mode:\s*"ready_to_invoice"/,
    );
  });

  it("past_due row passes mode=past_due (NOT scheduling_issues)", () => {
    expect(alertsCardSrc).toMatch(
      /past_due:\s*\{[\s\S]+?mode:\s*"past_due"/,
    );
    expect(alertsCardSrc).not.toMatch(/mode:\s*"scheduling_issues"/);
  });

  it("unscheduled row passes mode=unscheduled (NOT scheduling_issues)", () => {
    expect(alertsCardSrc).toMatch(
      /unscheduled:\s*\{[\s\S]+?mode:\s*"unscheduled"/,
    );
  });

  it("requires_attention row passes mode=requires_attention (NOT action_required)", () => {
    expect(alertsCardSrc).toMatch(
      /requires_attention:\s*\{[\s\S]+?mode:\s*"requires_attention"/,
    );
    expect(alertsCardSrc).not.toMatch(/mode:\s*"action_required"/);
  });

  it("invoices_not_sent row passes mode=invoices_not_sent (absorbed from Needs Attention 2026-05-07)", () => {
    // The retired Needs Attention card's single row was absorbed here.
    // Same shared modal mode — only the host card moved.
    expect(alertsCardSrc).toMatch(
      /invoices_not_sent:\s*\{[\s\S]+?mode:\s*"invoices_not_sent"/,
    );
    // The page wires openActionModal into OperationalAlertsCard, which
    // dispatches row.mode (= "invoices_not_sent") through to the modal.
    // After consolidation the literal call no longer appears on the page.
    expect(dashSrc).toMatch(
      /<OperationalAlertsCard\b[\s\S]+?onOpenActionModal=\{openActionModal\}/,
    );
  });

  it("each row routes to the shared modal via onOpenActionModal(row.mode)", () => {
    // The single click handler that delegates to the consumer's
    // openActionModal — this is the wiring that makes "every row uses the
    // shared modal" true by construction.
    expect(alertsCardSrc).toMatch(
      /onClick=\{\(\)\s*=>\s*onOpenActionModal\(row\.mode\)\}/,
    );
  });
});

// ─── Counts agree between card row and modal source ──────────────────

describe("Card row counts and modal source counts come from the same workflow data", () => {
  it("card consumes workflow.jobs.{onHoldCount,overdueCount,unscheduledCount,requiresInvoicingCount}", () => {
    // The card's count props are derived in FinancialDashboard from the
    // same `/api/dashboard/workflow` payload the modal queries.
    expect(dashSrc).toMatch(/onHoldCount/);
    expect(dashSrc).toMatch(/overdueCount/);
    expect(dashSrc).toMatch(/unscheduledCount/);
    expect(dashSrc).toMatch(/requiresInvoicingCount|readyToInvoiceCount/);
  });

  it("modal sources use the same /api/jobs filter strings as the workflow counter", () => {
    // SOURCE_PARAMS in the modal — these are the predicate sets the
    // workflow counter uses too. Pin the predicate literals so a
    // future change to the count predicate must update both sides.
    expect(modalSrc).toMatch(/overdue:\s*"status=open&overdue=true&limit=50"/);
    expect(modalSrc).toMatch(
      /unscheduled:\s*"status=open&unscheduledOnly=true&limit=50"/,
    );
    expect(modalSrc).toMatch(/on_hold:\s*"status=open&openSubStatus=on_hold&limit=50"/);
    expect(modalSrc).toMatch(/ready_to_invoice:\s*"readyToInvoiceOnly=true&limit=50"/);
    // 2026-05-06 RALPH: unsent invoices source hits the canonical
    // /api/invoices/list feed (with the status passthrough wired at the
    // route layer). No new dashboard endpoint introduced.
    expect(modalSrc).toMatch(/unsent_invoices:\s*"status=draft&limit=50"/);
  });
});

// ─── No mode renders the old combined Scheduling Issues sections ─────

describe("Scheduling Issues combined modal is gone", () => {
  it("no mode in MODE_CONFIG composes ['overdue', 'unscheduled'] together", () => {
    expect(modalSrc).not.toMatch(/sources:\s*\["overdue",\s*"unscheduled"\]/);
    expect(modalSrc).not.toMatch(/sources:\s*\["unscheduled",\s*"overdue"\]/);
  });

  it("no card row dispatches the retired scheduling_issues mode", () => {
    expect(alertsCardSrc).not.toMatch(/"scheduling_issues"/);
  });

  it("FinancialDashboard initializes with requires_attention (canonical entry mode)", () => {
    expect(dashSrc).toMatch(
      /useState<DashboardActionMode>\("requires_attention"\)/,
    );
    expect(dashSrc).not.toMatch(
      /useState<DashboardActionMode>\("action_required"\)/,
    );
  });
});

// ─── Bulk-overdue header controls remain past_due-scoped ─────────────

describe("Past Due bulk-unschedule controls render only when primarySource is overdue", () => {
  it("showOverdueBulkControls predicate gates on primarySource === \"overdue\"", () => {
    expect(modalSrc).toMatch(
      /const showOverdueBulkControls = primarySource === "overdue"/,
    );
  });

  it("select-all copy reads 'past-due' for the overdue source", () => {
    expect(modalSrc).toMatch(/Select all \$\{overdueJobs\.length\} past-due/);
  });
});
