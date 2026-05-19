/**
 * Dialog / AlertDialog taxonomy guard (2026-05-10).
 *
 * Enforces CLAUDE.md Modal Taxonomy:
 *   Rule #1  Destructive confirmation → AlertDialog
 *   Rule #2  Generic / simple modal  → ModalShell + Modal* primitives
 *
 * Sections 1–6: ProductServiceDeleteDialog per-component guards (Phase 1 / 1b).
 * Sections 7–9: App-wide ceiling / floor / health-check (Phase 1b baseline).
 *
 *   7. Raw Dialog ceiling  — non-allowlisted <Dialog opens must not grow.
 *   8. AlertDialog health  — every alert-dialog importer must use <AlertDialog.
 *   9. ModalShell floor    — modal importers must not decrease (no regressions).
 *
 * ALLOWLIST categories (never need to migrate):
 *   A. Infrastructure wrappers  — command.tsx, modal.tsx
 *   B. Platform-admin pages     — staff-only surfaces (9 files)
 *   C. Domain workflow wrappers — complex reusable flows (14 files)
 *
 * HOW TO UPDATE:
 *   After migrating a file → lower DIALOG_CEILING by the number of opens removed.
 *   After deleting a ModalShell file → lower MODAL_SHELL_FLOOR only if intentional.
 *   To allowlist a new file → add it to DIALOG_ALLOWLIST with a comment explaining why.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join, relative } from "path";

// ── Per-component file (sections 1–6) ────────────────────────────────────────

const src = readFileSync(
  resolve(__dirname, "../client/src/components/products-services/ProductServiceDeleteDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── App-wide helpers (sections 7–9) ──────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const CLIENT_SRC = resolve(ROOT, "client/src");

/** Recursively collect all .tsx files under a directory. */
function walkTsx(dir: string): string[] {
  const result: string[] = [];
  function walk(current: string) {
    for (const e of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".tsx")) result.push(full);
    }
  }
  walk(dir);
  return result;
}

/** Strip block, JSX, and line comments so pattern checks hit code only. */
function stripAll(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Normalise an absolute path to a forward-slash path relative to repo root. */
function relPosix(abs: string): string {
  return relative(ROOT, abs).replace(/\\/g, "/");
}

/**
 * DIALOG_ALLOWLIST — files permanently permitted to use raw <Dialog.
 *
 * Category A — Infrastructure: these files ARE the Dialog abstraction layer.
 * Category B — Platform-admin: internal staff surfaces; no customer impact.
 * Category C — Domain wrappers: complex reusable flows that own their Dialog.
 */
const DIALOG_ALLOWLIST = new Set([
  // ── A. Infrastructure ────────────────────────────────────────────────────
  "client/src/components/ui/command.tsx",        // CMDK command-palette base
  "client/src/components/ui/modal.tsx",          // ModalShell definition itself

  // ── B. Platform-admin pages ───────────────────────────────────────────────
  "client/src/pages/platform/BulkTenantActions.tsx",
  "client/src/pages/platform/PlatformFeaturesCatalog.tsx",
  "client/src/pages/platform/PlatformFeedbackPage.tsx",
  "client/src/pages/platform/PlatformIssuesPage.tsx",
  "client/src/pages/platform/PlatformSupportSessionsPage.tsx",
  "client/src/pages/platform/PlatformTenantDetail.tsx",
  "client/src/pages/platform/PlatformTrialsPipeline.tsx",
  "client/src/pages/platform/TenantDangerZone.tsx",
  "client/src/pages/SupportConsole.tsx",

  // ── C. Domain workflow wrappers ───────────────────────────────────────────
  "client/src/components/invoice/CollectPaymentDialog.tsx",
  "client/src/components/InvoiceCompositionDialog.tsx",
  "client/src/components/pm/CreateMaintenancePlanDialog.tsx",
  "client/src/components/TaskDialog.tsx",
  "client/src/components/QuoteTemplateModal.tsx",
  "client/src/components/JobTemplateModal.tsx",
  "client/src/components/visits/EditVisitModal.tsx",
  "client/src/components/communication/SendCommunicationModal.tsx",
  "client/src/components/communication/SystemImagePickerDialog.tsx",
  "client/src/components/communication/BatchSendInvoicesModal.tsx",
  "client/src/components/timesheets/JobSessionCreateModal.tsx",
  "client/src/components/timesheets/JobSessionEditModal.tsx",
  "client/src/components/timesheets/TimeEntryEditModal.tsx",
  "client/src/components/invoice/SelectJobsForInvoiceModal.tsx",
]);

const ALL_TSX = walkTsx(CLIENT_SRC);

// ── 1. Import shape ───────────────────────────────────────────────────────────

describe("ProductServiceDeleteDialog Phase 2 — imports", () => {
  it("does NOT import from alert-dialog (AlertDialog retired — all confirms use ConfirmModal)", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
  });

  it("does NOT import from dialog (form dialogs use ModalShell)", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("imports ConfirmModal from modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    expect(src).toMatch(/ConfirmModal/);
  });
});

// ── 2. DeleteConfirmDialog → ConfirmModal ─────────────────────────────────────

describe("ProductServiceDeleteDialog Phase 2 — DeleteConfirmDialog uses ConfirmModal", () => {
  const deleteFnStart = src.indexOf("export function DeleteConfirmDialog");
  const archiveFnStart = src.indexOf("export function ArchiveConfirmDialog");
  const deleteSection = src.slice(deleteFnStart, archiveFnStart);

  it("renders <ConfirmModal variant=\"destructive\">", () => {
    expect(deleteSection).toMatch(/<ConfirmModal/);
    expect(deleteSection).toMatch(/variant="destructive"/);
  });

  it("does not use <AlertDialog", () => {
    expect(deleteSection).not.toMatch(/<AlertDialog/);
  });

  it("uses testIdPrefix delete-item (generates delete-item-modal/confirm/cancel)", () => {
    expect(deleteSection).toContain('testIdPrefix="delete-item"');
  });

  it("title wording preserved: Delete Item?", () => {
    expect(deleteSection).toContain("Delete Item?");
  });

  it("description includes product name and cannot-be-undone wording", () => {
    expect(deleteSection).toMatch(/product.*name/);
    expect(deleteSection).toContain("This cannot be undone.");
  });

  it("confirm label: Delete", () => {
    expect(deleteSection).toContain('confirmLabel="Delete"');
  });
});

// ── 3. BulkDeleteDialog → ConfirmModal ────────────────────────────────────────

describe("ProductServiceDeleteDialog Phase 2 — BulkDeleteDialog uses ConfirmModal", () => {
  const bulkFnStart = src.indexOf("export function BulkDeleteDialog");
  const bulkCategoryFnStart = src.indexOf("export function BulkCategoryDialog");
  const bulkSection = src.slice(bulkFnStart, bulkCategoryFnStart);

  it("renders <ConfirmModal variant=\"destructive\">", () => {
    expect(bulkSection).toMatch(/<ConfirmModal/);
    expect(bulkSection).toMatch(/variant="destructive"/);
  });

  it("does not use <AlertDialog", () => {
    expect(bulkSection).not.toMatch(/<AlertDialog/);
  });

  it("uses testIdPrefix bulk-delete (generates bulk-delete-modal/confirm/cancel)", () => {
    expect(bulkSection).toContain('testIdPrefix="bulk-delete"');
  });

  it("title includes count and Delete wording", () => {
    expect(bulkSection).toMatch(/count/);
    expect(bulkSection).toMatch(/Delete/);
  });

  it("description wording preserved: cannot be undone", () => {
    expect(bulkSection).toContain("This action cannot be undone.");
  });

  it("description wording preserved: Consider archiving instead", () => {
    expect(bulkSection).toContain("Consider archiving instead.");
  });

  it("confirm label: Delete", () => {
    expect(bulkSection).toContain('confirmLabel="Delete"');
  });
});

// ── 4. ArchiveConfirmDialog stays on ConfirmModal ────────────────────────────

describe("ProductServiceDeleteDialog — ArchiveConfirmDialog stays on ConfirmModal", () => {
  it("ArchiveConfirmDialog uses ConfirmModal (neutral, reversible — not destructive)", () => {
    expect(codeOnly).toContain("ConfirmModal");
  });

  it("ArchiveConfirmDialog passes variant neutral", () => {
    expect(src).toMatch(/variant="neutral"/);
  });

  it("ArchiveConfirmDialog preserves archive-item testIdPrefix", () => {
    expect(src).toContain('testIdPrefix="archive-item"');
  });
});

// ── 5. BulkCategoryDialog → ModalShell (Phase 1b) ────────────────────────────

describe("ProductServiceDeleteDialog Phase 2 — BulkCategoryDialog uses ModalShell", () => {
  it("Dialog import has been removed entirely", () => {
    expect(src).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("ModalShell is imported from modal", () => {
    expect(src).toMatch(/ModalShell/);
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
  });

  it("BulkCategoryDialog renders ModalShell (not raw Dialog)", () => {
    expect(codeOnly).toMatch(/<ModalShell/);
    expect(codeOnly).not.toMatch(/<Dialog\s+open=\{open\}/);
  });

  it("BulkCategoryDialog width class preserved on ModalShell", () => {
    expect(src).toContain('className="sm:max-w-md"');
  });

  it("BulkCategoryDialog title wording preserved: Update Category", () => {
    expect(src).toContain("Update Category");
  });

  it("BulkCategoryDialog description wording preserved", () => {
    expect(src).toContain("Set the category for");
  });

  it("input-bulk-category testid preserved", () => {
    expect(src).toContain('data-testid="input-bulk-category"');
  });

  it("BulkCategoryDialog uses ModalSecondaryAction for Cancel", () => {
    expect(src).toContain("ModalSecondaryAction");
  });

  it("BulkCategoryDialog uses ModalPrimaryAction for Apply", () => {
    expect(src).toContain("ModalPrimaryAction");
  });

  it("Apply button preserves disabled when !value || isPending", () => {
    expect(src).toContain("!value || isPending");
  });
});

// ── 6. ImportDialog → ModalShell (Phase 1b) ──────────────────────────────────

describe("ProductServiceDeleteDialog Phase 2 — ImportDialog uses ModalShell", () => {
  it("ImportDialog renders ModalShell (not raw Dialog)", () => {
    const count = (codeOnly.match(/<ModalShell/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("ImportDialog width class preserved: sm:max-w-[550px]", () => {
    expect(src).toContain('className="sm:max-w-[550px]"');
  });

  it("ImportDialog title wording preserved: Import Pricebook items", () => {
    expect(src).toContain("Import Pricebook items");
  });

  it("ImportDialog description wording preserved: Import from CSV file", () => {
    expect(src).toContain("Import from CSV file.");
  });

  it("ImportDialog isPending spinner preserved", () => {
    expect(src).toContain("isPending");
    expect(src).toContain("animate-spin");
  });

  it("ImportDialog isPending disabled state preserved", () => {
    expect(src).toContain("disabled={isPending}");
  });

  it("ImportDialog file info block preserved: FileText icon", () => {
    expect(src).toContain("FileText");
  });

  it("ImportDialog update-existing checkbox preserved", () => {
    expect(src).toContain('id="update-existing"');
    expect(src).toContain('htmlFor="update-existing"');
  });

  it("ImportDialog expected columns text preserved", () => {
    expect(src).toContain("Expected columns:");
  });
});

// ── 7. App-wide raw Dialog ceiling ────────────────────────────────────────────
//
// Counts raw <Dialog opens across ALL client/src .tsx files that are NOT in
// DIALOG_ALLOWLIST. Any new raw Dialog usage in a non-allowlisted file fails
// this test.
//
// WHEN TO LOWER THE CEILING:
//   After migrating dialogs away from raw Dialog → subtract the migrated count
//   and commit the lower ceiling in the same PR.
//
// WHEN TO ADD TO THE ALLOWLIST:
//   Only for new files that qualify as infrastructure, platform-admin, or
//   domain wrapper. Document the reason in the allowlist comment above.

describe("App-wide — raw Dialog ceiling", () => {
  // ── Baseline: 34 opens across 25 non-allowlisted files (2026-05-10).
  // Phase 2: InvoiceDetailPage showDeleteConfirm → ConfirmModal (0 raw Dialog change).
  // Phase 3: ClientDetailPage archiveDialogOpen + permDeleteDialogOpen → AlertDialog (no raw Dialog change).
  // Phase 4: PMScheduleCard hardDeleteDialogOpen → AlertDialog (−1).
  // Phase 5: FeedbackDialog → ModalShell (−1).
  // Phase 6: JobEquipmentSection "Add Equipment" → ModalShell (−1).
  // Lower this whenever a migration removes raw Dialog opens.
  const DIALOG_CEILING = 31;

  it(`non-allowlisted raw <Dialog opens ≤ ${DIALOG_CEILING} (lower after each migration)`, () => {
    let total = 0;
    const offenders: string[] = [];

    for (const file of ALL_TSX) {
      const rel = relPosix(file);
      if (DIALOG_ALLOWLIST.has(rel)) continue;
      const hits = (stripAll(readFileSync(file, "utf-8")).match(/<Dialog[\s>]/g) ?? []).length;
      if (hits > 0) offenders.push(`${rel} (${hits})`);
      total += hits;
    }

    if (total > DIALOG_CEILING) {
      throw new Error(
        `Raw <Dialog ceiling exceeded: ${total} > ${DIALOG_CEILING}.\n` +
        `Non-allowlisted contributors:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\nMigrate to ModalShell (generic) or AlertDialog (destructive), then lower DIALOG_CEILING.`,
      );
    }

    expect(total).toBeLessThanOrEqual(DIALOG_CEILING);
  });
});

// ── 8. App-wide AlertDialog health check ─────────────────────────────────────
//
// Every file that imports from @/components/ui/alert-dialog must contain at
// least one real <AlertDialog usage in code (not just in comments). This
// catches stale imports left behind after migrations.

describe("App-wide — AlertDialog health check", () => {
  it("every alert-dialog importer has at least one <AlertDialog usage in code", () => {
    const violations: string[] = [];

    for (const file of ALL_TSX) {
      const raw = readFileSync(file, "utf-8");
      if (!raw.match(/from\s+["']@\/components\/ui\/alert-dialog["']/)) continue;
      if (!(stripAll(raw).match(/<AlertDialog[\s>]/))) {
        violations.push(relPosix(file));
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Files import alert-dialog but contain no <AlertDialog usage:\n` +
        violations.map((v) => `  ${v}`).join("\n") +
        `\nRemove the stale import or add the missing <AlertDialog usage.`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

// ── 9. App-wide ModalShell floor ──────────────────────────────────────────────
//
// The number of files importing from @/components/ui/modal must never fall
// below the baseline. A decrease means a file stopped using the canonical
// modal system — likely regressed to a raw Dialog.
//
// WHEN TO LOWER THE FLOOR:
//   Only when a modal component is intentionally deleted (not migrated back to
//   raw Dialog). Lower by the exact number of deleted files and add a comment.

describe("App-wide — ModalShell floor", () => {
  // ── Baseline: 34 files importing from @/components/ui/modal (2026-05-10).
  // Lower only if a modal file is intentionally deleted (not regressed).
  const MODAL_SHELL_FLOOR = 34;

  it(`files importing @/components/ui/modal ≥ ${MODAL_SHELL_FLOOR} (prevents ModalShell regressions)`, () => {
    let count = 0;

    for (const file of ALL_TSX) {
      if (readFileSync(file, "utf-8").match(/from\s+["']@\/components\/ui\/modal["']/)) {
        count++;
      }
    }

    if (count < MODAL_SHELL_FLOOR) {
      throw new Error(
        `ModalShell floor violated: only ${count} files import from @/components/ui/modal ` +
        `(floor is ${MODAL_SHELL_FLOOR}).\n` +
        `A file may have regressed from ModalShell back to raw Dialog. Investigate before lowering the floor.`,
      );
    }

    expect(count).toBeGreaterThanOrEqual(MODAL_SHELL_FLOOR);
  });
});

// ── 10. InvoiceDetailPage — Phase 3 delete confirmation guard ─────────────────
//
// Pins that the showDeleteConfirm dialog uses ConfirmModal (migrated from AlertDialog).
// The Dialog import is preserved for the remaining showPaymentDialog form.

describe("InvoiceDetailPage Phase 3 — showDeleteConfirm uses ConfirmModal", () => {
  const invoiceSrc = readFileSync(
    resolve(__dirname, "../client/src/pages/InvoiceDetailPage.tsx"),
    "utf-8",
  );
  const invoiceCode = stripAll(invoiceSrc);

  it("does NOT import alert-dialog (migrated to ConfirmModal)", () => {
    expect(invoiceSrc).not.toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
  });

  it("imports ConfirmModal from modal", () => {
    expect(invoiceSrc).toMatch(/ConfirmModal/);
    expect(invoiceSrc).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
  });

  it("delete confirm renders <ConfirmModal (not AlertDialog)", () => {
    expect(invoiceCode).toContain("<ConfirmModal");
  });

  it("delete confirm uses variant destructive", () => {
    expect(invoiceSrc).toContain('variant="destructive"');
  });

  it("delete confirm open state bound to showDeleteConfirm", () => {
    expect(invoiceCode).toContain("open={showDeleteConfirm}");
  });

  it("delete confirm title wording preserved: Delete Draft Invoice", () => {
    expect(invoiceSrc).toContain("Delete Draft Invoice");
  });

  it("delete confirm description wording preserved: cannot be undone", () => {
    expect(invoiceSrc).toContain("This action cannot be undone.");
  });

  it("delete confirm calls deleteMutation.mutate()", () => {
    expect(invoiceCode).toContain("deleteMutation.mutate()");
  });

  it("Dialog import retained (showPaymentDialog form still uses raw Dialog)", () => {
    expect(invoiceSrc).toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("showPaymentDialog still uses raw Dialog (not migrated in Phase 2)", () => {
    expect(invoiceCode).toMatch(/<Dialog\s+open=\{showPaymentDialog\}/);
  });

  it("showDeleteConfirm no longer uses raw Dialog", () => {
    expect(invoiceCode).not.toMatch(/<Dialog\s+open=\{showDeleteConfirm\}/);
  });
});

// ── 11. ClientDetailPage — confirmation guards ────────────────────────────────
//
// Pins that destructive confirmation dialogs use AlertDialog (non-ConfirmModal:
// permDeleteDialogOpen has a text-input gate; archiveDialogOpen is non-binary).
// addLocationDialogOpen and other form dialogs in ClientDetailPage are out of scope.

describe("ClientDetailPage — archiveDialogOpen and permDeleteDialogOpen use AlertDialog", () => {
  const clientSrc = readFileSync(
    resolve(__dirname, "../client/src/pages/ClientDetailPage.tsx"),
    "utf-8",
  );
  const clientCode = stripAll(clientSrc);

  it("imports AlertDialog primitives from alert-dialog", () => {
    expect(clientSrc).toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
  });

  it("Dialog import retained (addLocationDialogOpen form still uses raw Dialog)", () => {
    expect(clientSrc).toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  // archiveDialogOpen
  it("archiveDialogOpen renders AlertDialog", () => {
    expect(clientCode).toMatch(/AlertDialog\s+open=\{archiveDialogOpen\}/);
  });

  it("archiveDialogOpen no longer uses raw Dialog", () => {
    expect(clientCode).not.toMatch(/<Dialog\s+open=\{archiveDialogOpen\}/);
  });

  it("archiveDialogOpen archive action preserved: Archiving...", () => {
    expect(clientSrc).toContain("Archiving...");
  });

  // permDeleteDialogOpen
  it("permDeleteDialogOpen renders AlertDialog", () => {
    expect(clientCode).toMatch(/AlertDialog\s+open=\{permDeleteDialogOpen\}/);
  });

  it("permDeleteDialogOpen no longer uses raw Dialog", () => {
    expect(clientCode).not.toMatch(/<Dialog\s+open=\{permDeleteDialogOpen\}/);
  });

  it("permDeleteDialogOpen text-confirm input preserved: placeholder DELETE", () => {
    expect(clientSrc).toContain('placeholder="DELETE"');
  });

  it("permDeleteDialogOpen hard-delete disabled state preserved", () => {
    expect(clientCode).toContain('permDeleteConfirmText !== "DELETE"');
  });

  it("permDeleteDialogOpen hard-delete carries destructive styling", () => {
    expect(clientSrc).toContain("bg-destructive text-destructive-foreground hover:bg-destructive/90");
  });

  it("permDeleteDialogOpen wording preserved: permanently delete", () => {
    expect(clientSrc).toContain("permanently delete");
  });

  // addLocationDialogOpen untouched
  it("addLocationDialogOpen still uses raw Dialog (form dialog, out of scope)", () => {
    expect(clientCode).toMatch(/<Dialog\s+open=\{addLocationDialogOpen\}/);
  });
});

// ── 12. PMScheduleCard — Phase 4 hard-delete confirmation guard ───────────────
//
// Pins that hardDeleteDialogOpen uses AlertDialog (rule #1 — destructive) and
// that the raw Dialog import is removed (archiveDialogOpen already used AlertDialog
// before Phase 4; no remaining Dialog usage in this file).

describe("PMScheduleCard Phase 4 — hardDeleteDialogOpen uses AlertDialog", () => {
  const pmSrc = readFileSync(
    resolve(__dirname, "../client/src/components/PMScheduleCard.tsx"),
    "utf-8",
  );
  const pmCode = pmSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("no longer imports from @/components/ui/dialog", () => {
    expect(pmSrc).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("still imports AlertDialog primitives", () => {
    expect(pmSrc).toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
  });

  it("hardDeleteDialogOpen renders AlertDialog", () => {
    expect(pmCode).toMatch(/AlertDialog\s+open=\{hardDeleteDialogOpen\}/);
  });

  it("hardDeleteDialogOpen no longer uses raw Dialog", () => {
    expect(pmCode).not.toMatch(/<Dialog\s+open=\{hardDeleteDialogOpen\}/);
  });

  it("title wording preserved: Permanently Delete PM Schedule", () => {
    expect(pmSrc).toContain("Permanently Delete PM Schedule");
  });

  it("body wording preserved: cannot be undone", () => {
    expect(pmSrc).toContain("This action cannot be undone.");
  });

  it("body wording preserved: not affected", () => {
    expect(pmSrc).toContain("not affected");
  });

  it("text-confirm input preserved: placeholder Type DELETE", () => {
    expect(pmSrc).toContain('placeholder="Type DELETE"');
  });

  it("text-confirm input test id preserved", () => {
    expect(pmSrc).toContain('data-testid="pm-hard-delete-confirm-input"');
  });

  it("confirm button test id preserved", () => {
    expect(pmSrc).toContain('data-testid="pm-hard-delete-confirm-btn"');
  });

  it("disabled state preserved: hardDeleteConfirmText !== DELETE", () => {
    expect(pmCode).toContain('hardDeleteConfirmText !== "DELETE"');
  });

  it("isPending disabled guard preserved", () => {
    expect(pmCode).toContain("hardDeleteMutation.isPending");
  });

  it("carries destructive styling", () => {
    expect(pmSrc).toContain("bg-destructive text-destructive-foreground hover:bg-destructive/90");
  });

  it("action wording preserved: Delete Permanently", () => {
    expect(pmSrc).toContain("Delete Permanently");
  });

  it("loading state wording preserved: Deleting...", () => {
    expect(pmSrc).toContain("Deleting...");
  });

  it("calls hardDeleteMutation.mutate()", () => {
    expect(pmCode).toContain("hardDeleteMutation.mutate()");
  });

  it("onOpenChange clears hardDeleteConfirmText on close", () => {
    expect(pmCode).toContain("setHardDeleteConfirmText(\"\")");
  });
});

// ── 13. FeedbackDialog — Phase 5 ModalShell migration ────────────────────────
//
// Pins that FeedbackDialog (generic form modal — taxonomy rule #2) uses
// ModalShell + Modal* primitives and no longer imports from @/components/ui/dialog.

describe("FeedbackDialog Phase 5 — uses ModalShell (generic form modal, rule #2)", () => {
  const feedbackSrc = readFileSync(
    resolve(__dirname, "../client/src/components/FeedbackDialog.tsx"),
    "utf-8",
  );
  const feedbackCode = stripAll(feedbackSrc);

  it("does NOT import from @/components/ui/dialog", () => {
    expect(feedbackSrc).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("imports ModalShell from @/components/ui/modal", () => {
    expect(feedbackSrc).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    expect(feedbackSrc).toContain("ModalShell");
  });

  it("mounts <ModalShell open={open} onOpenChange={onOpenChange}>", () => {
    expect(feedbackCode).toMatch(/<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/);
  });

  it("width class preserved on ModalShell: sm:max-w-[550px]", () => {
    expect(feedbackSrc).toContain('className="sm:max-w-[550px]"');
  });

  it("data-testid preserved on ModalShell: dialog-feedback", () => {
    expect(feedbackSrc).toContain('data-testid="dialog-feedback"');
  });

  it("title wording preserved: Send Feedback", () => {
    expect(feedbackSrc).toContain("Send Feedback");
  });

  it("description wording preserved", () => {
    expect(feedbackSrc).toContain("Share your recommendations, questions, or report issues with the app.");
  });

  it("category select data-testid preserved", () => {
    expect(feedbackSrc).toContain('data-testid="select-feedback-category"');
  });

  it("all five category options preserved", () => {
    expect(feedbackSrc).toContain('value="recommendation"');
    expect(feedbackSrc).toContain('value="question"');
    expect(feedbackSrc).toContain('value="bug"');
    expect(feedbackSrc).toContain('value="feature"');
    expect(feedbackSrc).toContain('value="other"');
  });

  it("message textarea data-testid preserved", () => {
    expect(feedbackSrc).toContain('data-testid="textarea-feedback-message"');
  });

  it("cancel button data-testid preserved and calls onOpenChange(false)", () => {
    expect(feedbackSrc).toContain('data-testid="button-cancel-feedback"');
    expect(feedbackCode).toContain("onOpenChange(false)");
  });

  it("submit button data-testid preserved", () => {
    expect(feedbackSrc).toContain('data-testid="button-submit-feedback"');
  });

  it("submit button disabled while isPending", () => {
    expect(feedbackCode).toContain("disabled={createMutation.isPending}");
  });

  it("pending label preserved: Submitting...", () => {
    expect(feedbackSrc).toContain("Submitting...");
  });

  it("submit label preserved: Submit Feedback", () => {
    expect(feedbackSrc).toContain("Submit Feedback");
  });

  it("form.reset() called on success (resets fields on close)", () => {
    expect(feedbackCode).toContain("form.reset()");
  });

  it("unused Label import removed", () => {
    expect(feedbackSrc).not.toMatch(/from\s+["']@\/components\/ui\/label["']/);
  });
});

// ── 14. JobEquipmentSection — Phase 6 ModalShell migration ───────────────────
//
// Pins that the "Add Equipment to Job" dialog uses ModalShell (generic form
// modal — taxonomy rule #2). Dialog import fully removed.

describe("JobEquipmentSection Phase 6 — Add Equipment dialog uses ModalShell (rule #2)", () => {
  const jesSrc = readFileSync(
    resolve(__dirname, "../client/src/components/JobEquipmentSection.tsx"),
    "utf-8",
  );
  const jesCode = stripAll(jesSrc);

  it("does NOT import from @/components/ui/dialog", () => {
    expect(jesSrc).not.toMatch(/from\s+["']@\/components\/ui\/dialog["']/);
  });

  it("imports ModalShell from @/components/ui/modal", () => {
    expect(jesSrc).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    expect(jesSrc).toContain("ModalShell");
  });

  it("mounts <ModalShell open={isAddDialogOpen} onOpenChange={handleAddDialogChange}>", () => {
    expect(jesCode).toMatch(/<ModalShell\s+open=\{isAddDialogOpen\}\s+onOpenChange=\{handleAddDialogChange\}/);
  });

  it("title wording preserved: Add Equipment to Job", () => {
    expect(jesSrc).toContain("Add Equipment to Job");
  });

  it("description wording preserved", () => {
    expect(jesSrc).toContain("Select existing equipment or create new equipment at this location.");
  });

  it("select data-testid preserved: select-job-equipment", () => {
    expect(jesSrc).toContain('data-testid="select-job-equipment"');
  });

  it("notes textarea data-testid preserved: input-job-equipment-notes", () => {
    expect(jesSrc).toContain('data-testid="input-job-equipment-notes"');
  });

  it("create-new button data-testid preserved: button-create-new-equipment", () => {
    expect(jesSrc).toContain('data-testid="button-create-new-equipment"');
  });

  it("cancel button data-testid preserved and calls handleAddDialogChange(false)", () => {
    expect(jesSrc).toContain('data-testid="button-cancel-job-equipment"');
    expect(jesCode).toContain("handleAddDialogChange(false)");
  });

  it("save button data-testid preserved: button-save-job-equipment", () => {
    expect(jesSrc).toContain('data-testid="button-save-job-equipment"');
  });

  it("save button disabled state preserved: !selectedEquipmentId || addMutation.isPending", () => {
    expect(jesCode).toContain("!selectedEquipmentId || addMutation.isPending");
  });

  it("pending spinner preserved on save button", () => {
    expect(jesCode).toContain("addMutation.isPending");
    expect(jesSrc).toContain("animate-spin");
  });

  it("Add to Job label preserved", () => {
    expect(jesSrc).toContain("Add to Job");
  });

  it("Create New Equipment trigger preserved", () => {
    expect(jesCode).toContain("setIsCreateDialogOpen(true)");
  });

  it("no DialogClose remains (replaced by explicit handleAddDialogChange(false))", () => {
    expect(jesCode).not.toMatch(/<DialogClose\b/);
  });
});
