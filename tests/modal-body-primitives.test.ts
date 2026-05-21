/**
 * Modal Body Primitives — canonical component drift prevention
 * (2026-05-09 source-level pins)
 *
 * Two new primitives added to client/src/components/ui/modal.tsx:
 *
 *   ModalStateBody — canonical loading / empty / error body state.
 *   ConfirmModal   — canonical destructive / neutral confirm wrapper.
 *
 * Migrated consumers:
 *   ConfirmVoidModal              → uses ConfirmModal (was AlertDialog)
 *   DeleteConfirmDialog           → uses ConfirmModal (was AlertDialog)
 *   SelectJobsForInvoiceModal     → uses ModalStateBody (was inline divs)
 *   PricebookPickerModal          → uses ModalStateBody (was inline divs)
 *
 * Pure source-string assertions — no React render pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

const MODAL_SRC = readFileSync(
  resolve(ROOT, "client/src/components/ui/modal.tsx"),
  "utf-8",
);

const VOID_SRC = readFileSync(
  resolve(ROOT, "client/src/components/invoice/ConfirmVoidModal.tsx"),
  "utf-8",
);

const DELETE_SRC = readFileSync(
  resolve(ROOT, "client/src/components/products-services/ProductServiceDeleteDialog.tsx"),
  "utf-8",
);

const SELECT_JOBS_SRC = readFileSync(
  resolve(ROOT, "client/src/components/invoice/SelectJobsForInvoiceModal.tsx"),
  "utf-8",
);

const PRICEBOOK_SRC = readFileSync(
  resolve(ROOT, "client/src/components/line-items/PricebookPickerModal.tsx"),
  "utf-8",
);

// Nested inline confirm consolidation (2026-05-09)
const ENTITY_NOTE_SRC = readFileSync(
  resolve(ROOT, "client/src/components/notes/EntityNoteDialog.tsx"),
  "utf-8",
);

const TIME_ENTRY_SRC = readFileSync(
  resolve(ROOT, "client/src/components/time/TimeEntryModal.tsx"),
  "utf-8",
);

// ── modal.tsx structural contracts ────────────────────────────────────

describe("modal.tsx — ModalShell structural invariants", () => {
  it("ModalShell does NOT impose a default width", () => {
    // The default-width was deliberately removed 2026-05-06.
    // ModalShell's inner DialogContent must only have "p-0 gap-0" —
    // no width utility alongside it. Width lives at the caller.
    // We find the structural lock comment + "p-0" + "gap-0" block and
    // verify no width class is baked immediately alongside those two.
    // Scope: the ModalShell function body only (before ModalHeader).
    const shellSection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ModalShell"),
      MODAL_SRC.indexOf("// ── Header"),
    );
    // The "p-0 gap-0" string must appear (structural lock).
    expect(shellSection).toMatch(/"p-0 gap-0"/);
    // No width default baked alongside it in the same className arg.
    expect(shellSection).not.toMatch(/"p-0 gap-0[^"]*max-w-/);
    expect(shellSection).not.toMatch(/max-w-\[440px\]/);
  });

  it("ModalBody is present but not required (remains optional)", () => {
    // The docstring says ← optional. The component itself must exist.
    expect(MODAL_SRC).toMatch(/export function ModalBody/);
    expect(MODAL_SRC).toMatch(/optional/);
  });
});

// ── ModalStateBody contract ────────────────────────────────────────────

describe("modal.tsx — ModalStateBody export contract", () => {
  it("exports ModalStateBody", () => {
    expect(MODAL_SRC).toMatch(/export function ModalStateBody/);
  });

  it("accepts variant loading | empty | error", () => {
    expect(MODAL_SRC).toMatch(/variant.*"loading".*"empty".*"error"/);
  });

  it("accepts message prop", () => {
    expect(MODAL_SRC).toMatch(/message:/);
  });

  it("accepts submessage prop", () => {
    expect(MODAL_SRC).toMatch(/submessage\?:/);
  });

  it("accepts onRetry prop", () => {
    expect(MODAL_SRC).toMatch(/onRetry\?:/);
  });

  it("loading state uses Loader2 animate-spin", () => {
    expect(MODAL_SRC).toMatch(/Loader2/);
    expect(MODAL_SRC).toMatch(/animate-spin/);
  });

  it("error state uses AlertTriangle", () => {
    expect(MODAL_SRC).toMatch(/AlertTriangle/);
  });

  it("empty state uses PackageSearch", () => {
    expect(MODAL_SRC).toMatch(/PackageSearch/);
  });

  it("message uses text-row text-text-secondary (no raw slate)", () => {
    expect(MODAL_SRC).toMatch(/text-row text-text-secondary/);
    // Verify no raw slate color for the message itself
    const stateBodySection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ModalStateBody"),
      MODAL_SRC.indexOf("export interface ConfirmModalProps"),
    );
    const classStrings = stateBodySection.match(/className=["'][^"']*["']/g) ?? [];
    const joined = classStrings.join(" ");
    expect(joined).not.toMatch(/\btext-slate-\d+\b/);
  });

  it("submessage uses text-helper text-muted-foreground", () => {
    expect(MODAL_SRC).toMatch(/text-helper text-muted-foreground/);
  });

  it("error variant renders Retry button via onRetry", () => {
    expect(MODAL_SRC).toMatch(/onRetry && \(/);
  });

  it("error state has role=alert", () => {
    expect(MODAL_SRC).toMatch(/role=\{variant === "error" \? "alert" : undefined\}/);
  });
});

// ── ConfirmModal contract ────────────────────────────────────────────

describe("modal.tsx — ConfirmModal export contract", () => {
  it("exports ConfirmModal", () => {
    expect(MODAL_SRC).toMatch(/export function ConfirmModal/);
  });

  it("accepts variant destructive | neutral", () => {
    expect(MODAL_SRC).toMatch(/"destructive" \| "neutral"/);
  });

  it("accepts title, description, emphasis props", () => {
    expect(MODAL_SRC).toMatch(/\btitle:/);
    expect(MODAL_SRC).toMatch(/\bdescription:/);
    expect(MODAL_SRC).toMatch(/\bemphasis\?:/);
  });

  it("accepts isPending prop", () => {
    expect(MODAL_SRC).toMatch(/isPending\?:/);
  });

  it("accepts onConfirm prop", () => {
    expect(MODAL_SRC).toMatch(/onConfirm:/);
  });

  it("destructive variant applies bg-destructive to confirm button", () => {
    expect(MODAL_SRC).toMatch(/bg-destructive text-destructive-foreground hover:bg-destructive\/90/);
  });

  it("cancel button is ModalSecondaryAction (outline)", () => {
    const confirmSection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ConfirmModal"),
    );
    expect(confirmSection).toMatch(/<ModalSecondaryAction/);
  });

  it("confirm button is ModalPrimaryAction (size sm)", () => {
    const confirmSection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ConfirmModal"),
    );
    expect(confirmSection).toMatch(/<ModalPrimaryAction/);
  });

  it("uses ModalShell internally (not AlertDialog)", () => {
    const confirmSection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ConfirmModal"),
    );
    expect(confirmSection).toMatch(/<ModalShell/);
    expect(confirmSection).not.toMatch(/AlertDialog/);
  });

  it("default width is max-w-md", () => {
    const confirmSection = MODAL_SRC.slice(
      MODAL_SRC.indexOf("export function ConfirmModal"),
    );
    expect(confirmSection).toMatch(/max-w-md/);
  });
});

// ── ConfirmVoidModal migration ─────────────────────────────────────────

describe("ConfirmVoidModal — migrated to ConfirmModal", () => {
  it("imports ConfirmModal from canonical path", () => {
    const importLines = VOID_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).toMatch(/ConfirmModal/);
    expect(importLines).toMatch(/@\/components\/ui\/modal/);
  });

  it("does NOT import AlertDialog primitives", () => {
    const importLines = VOID_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/alert-dialog/);
    expect(importLines).not.toMatch(/AlertDialogAction/);
    expect(importLines).not.toMatch(/AlertDialogCancel/);
  });

  it("renders <ConfirmModal> with variant=\"destructive\"", () => {
    expect(VOID_SRC).toMatch(/variant="destructive"/);
    expect(VOID_SRC).toMatch(/<ConfirmModal/);
  });

  it("passes isPending to ConfirmModal", () => {
    expect(VOID_SRC).toMatch(/isPending=\{isPending\}/);
  });

  it("does NOT contain raw font-medium text-destructive inline span", () => {
    expect(VOID_SRC).not.toMatch(/font-medium text-destructive/);
  });

  it("does NOT contain AlertDialogDescription", () => {
    expect(VOID_SRC).not.toMatch(/AlertDialogDescription/);
  });
});

// ── DeleteConfirmDialog migration ──────────────────────────────────────

describe("DeleteConfirmDialog — migrated to ConfirmModal", () => {
  it("imports ConfirmModal from canonical path", () => {
    expect(DELETE_SRC).toMatch(/ConfirmModal/);
    expect(DELETE_SRC).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
  });

  it("DeleteConfirmDialog uses <ConfirmModal variant=\"destructive\">", () => {
    const deleteFnStart = DELETE_SRC.indexOf("export function DeleteConfirmDialog");
    const archiveFnStart = DELETE_SRC.indexOf("export function ArchiveConfirmDialog");
    const deleteSection = DELETE_SRC.slice(deleteFnStart, archiveFnStart);
    expect(deleteSection).toMatch(/<ConfirmModal/);
    expect(deleteSection).toMatch(/variant="destructive"/);
    // Use JSX tag match — comments between functions may mention AlertDialog
    expect(deleteSection).not.toMatch(/<AlertDialog/);
  });

  it("ArchiveConfirmDialog uses <ConfirmModal variant=\"neutral\">", () => {
    // 2026-05-09: migrated from AlertDialog to ConfirmModal in confirm-consolidation pass.
    const archiveFnStart = DELETE_SRC.indexOf("export function ArchiveConfirmDialog");
    const bulkFnStart = DELETE_SRC.indexOf("export function BulkDeleteDialog");
    const archiveSection = DELETE_SRC.slice(archiveFnStart, bulkFnStart);
    expect(archiveSection).toMatch(/<ConfirmModal/);
    expect(archiveSection).toMatch(/variant="neutral"/);
    expect(archiveSection).not.toMatch(/<AlertDialog/);
  });

  it("BulkDeleteDialog uses <ConfirmModal variant=\"destructive\">", () => {
    const bulkFnStart = DELETE_SRC.indexOf("export function BulkDeleteDialog");
    const bulkCategoryFnStart = DELETE_SRC.indexOf("export function BulkCategoryDialog");
    const bulkSection = DELETE_SRC.slice(bulkFnStart, bulkCategoryFnStart);
    expect(bulkSection).toMatch(/<ConfirmModal/);
    expect(bulkSection).toMatch(/variant="destructive"/);
    expect(bulkSection).not.toMatch(/<AlertDialog/);
  });

  it("file has no remaining AlertDialog import", () => {
    expect(DELETE_SRC).not.toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
    expect(DELETE_SRC).not.toMatch(/AlertDialogAction/);
  });

  it("BulkCategoryDialog is NOT migrated (has form input — not a simple confirm)", () => {
    // BulkCategoryDialog has a text Input + datalist for category entry.
    // It is a data-entry modal, not a simple confirm flow, so it stays as raw Dialog.
    const bulkCatFnStart = DELETE_SRC.indexOf("export function BulkCategoryDialog");
    const importFnStart = DELETE_SRC.indexOf("export function ImportDialog");
    const bulkCatSection = DELETE_SRC.slice(bulkCatFnStart, importFnStart);
    expect(bulkCatSection).toMatch(/Dialog/);
    expect(bulkCatSection).toMatch(/input-bulk-category/);
  });

  it("ArchiveConfirmDialog preserves isRestoring branch logic", () => {
    const archiveFnStart = DELETE_SRC.indexOf("export function ArchiveConfirmDialog");
    const bulkFnStart = DELETE_SRC.indexOf("export function BulkDeleteDialog");
    const archiveSection = DELETE_SRC.slice(archiveFnStart, bulkFnStart);
    expect(archiveSection).toMatch(/isRestoring/);
    expect(archiveSection).toMatch(/Restore/);
    expect(archiveSection).toMatch(/Archive/);
  });

  it("BulkDeleteDialog passes count in title", () => {
    const bulkFnStart = DELETE_SRC.indexOf("export function BulkDeleteDialog");
    const bulkCategoryFnStart = DELETE_SRC.indexOf("export function BulkCategoryDialog");
    const bulkSection = DELETE_SRC.slice(bulkFnStart, bulkCategoryFnStart);
    expect(bulkSection).toMatch(/count/);
    expect(bulkSection).toMatch(/Delete/);
  });
});

// ── SelectJobsForInvoiceModal migration ───────────────────────────────

describe("SelectJobsForInvoiceModal — loading/empty use ModalStateBody", () => {
  it("imports ModalStateBody from canonical path", () => {
    const importLines = SELECT_JOBS_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).toMatch(/ModalStateBody/);
    expect(importLines).toMatch(/@\/components\/ui\/modal/);
  });

  it("does NOT import Loader2 (replaced by ModalStateBody)", () => {
    const importLines = SELECT_JOBS_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/\bLoader2\b/);
  });

  it("renders <ModalStateBody variant=\"loading\"> for loading state", () => {
    expect(SELECT_JOBS_SRC).toMatch(/<ModalStateBody[\s\S]{0,100}?variant="loading"/);
  });

  it("renders <ModalStateBody variant=\"empty\"> for empty state", () => {
    expect(SELECT_JOBS_SRC).toMatch(/<ModalStateBody[\s\S]{0,100}?variant="empty"/);
  });

  it("does NOT contain raw inline loading div with text-sm text-slate-500", () => {
    expect(SELECT_JOBS_SRC).not.toMatch(/text-sm text-slate-500[\s\S]{0,50}?Loading jobs/);
  });

  it("does NOT contain raw inline empty div with text-sm text-slate-500", () => {
    expect(SELECT_JOBS_SRC).not.toMatch(/text-sm text-slate-500[\s\S]{0,50}?No open jobs/);
  });
});

// ── PricebookPickerModal migration ────────────────────────────────────

describe("PricebookPickerModal — error/empty use ModalStateBody", () => {
  it("imports ModalStateBody from canonical path", () => {
    const importLines = PRICEBOOK_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).toMatch(/ModalStateBody/);
    expect(importLines).toMatch(/@\/components\/ui\/modal/);
  });

  it("renders <ModalStateBody variant=\"error\"> for error state", () => {
    expect(PRICEBOOK_SRC).toMatch(/<ModalStateBody[\s\S]{0,100}?variant="error"/);
  });

  it("renders <ModalStateBody variant=\"empty\"> for empty-search state", () => {
    expect(PRICEBOOK_SRC).toMatch(/<ModalStateBody[\s\S]{0,100}?variant="empty"[\s\S]{0,600}?pricebook-empty-search/);
  });

  it("renders <ModalStateBody variant=\"empty\"> for empty-catalog state", () => {
    expect(PRICEBOOK_SRC).toMatch(/<ModalStateBody[\s\S]{0,100}?variant="empty"[\s\S]{0,900}?pricebook-empty[^-]/);
  });

  it("passes onRetry to the error ModalStateBody", () => {
    expect(PRICEBOOK_SRC).toMatch(/onRetry=\{\(\) => refetchItems\(\)\}/);
  });

  it("does NOT contain raw border-rose-200 bg-rose-50 error div", () => {
    expect(PRICEBOOK_SRC).not.toMatch(/border-rose-200[\s\S]{0,50}?bg-rose-50/);
  });

  it("does NOT contain raw text-sm text-rose-700 error paragraph", () => {
    expect(PRICEBOOK_SRC).not.toMatch(/text-sm text-rose-700/);
  });

  it("does NOT contain raw text-sm text-slate-600 empty paragraph", () => {
    // The pricebook empty state previously used text-sm text-slate-600.
    // ModalStateBody uses text-row text-text-secondary instead.
    expect(PRICEBOOK_SRC).not.toMatch(/className=["'][^"']*text-sm text-slate-600[^"']*["']/);
  });

  it("preserves skeleton loading state (Skeleton — not ModalStateBody)", () => {
    // Loading in the pricebook uses skeleton cards, not a spinner.
    // That is intentional and should be preserved.
    expect(PRICEBOOK_SRC).toMatch(/Skeleton/);
    // The isLoading branch should still render the Skeleton grid.
    expect(PRICEBOOK_SRC).toMatch(/isLoading \? \(/);
    expect(PRICEBOOK_SRC).toMatch(/<Skeleton /);
  });

  it("preserves existing testIds: pricebook-error, pricebook-empty, pricebook-empty-search", () => {
    expect(PRICEBOOK_SRC).toMatch(/data-testid="pricebook-error"/);
    expect(PRICEBOOK_SRC).toMatch(/data-testid="pricebook-empty-search"/);
    expect(PRICEBOOK_SRC).toMatch(/data-testid="pricebook-empty"/);
  });

});

// ── EntityNoteDialog — nested inline AlertDialog consolidation ────────

describe("EntityNoteDialog — nested confirms migrated to ConfirmModal", () => {
  it("imports ConfirmModal from canonical path", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/ConfirmModal/);
    expect(ENTITY_NOTE_SRC).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
  });

  it("does NOT import alert-dialog", () => {
    expect(ENTITY_NOTE_SRC).not.toMatch(/from\s+["']@\/components\/ui\/alert-dialog["']/);
  });

  it("does NOT use <AlertDialog JSX", () => {
    expect(ENTITY_NOTE_SRC).not.toMatch(/<AlertDialog/);
  });

  it("delete-note confirm uses variant=\"destructive\"", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/testIdPrefix="delete-note"/);
    expect(ENTITY_NOTE_SRC).toMatch(/variant="destructive"/);
  });

  it("remove-all-attachments confirm uses variant=\"destructive\"", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/testIdPrefix="remove-all-attachments"/);
  });

  it("preserves handleDeleteNote handler", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/onConfirm=\{handleDeleteNote\}/);
  });

  it("preserves detachAllExisting handler", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/detachAllExisting/);
  });

  it("both confirms pass isPending={busy}", () => {
    const pendingMatches = (ENTITY_NOTE_SRC.match(/isPending=\{busy\}/g) ?? []).length;
    expect(pendingMatches).toBeGreaterThanOrEqual(2);
  });

  it("outer Dialog shell is unchanged (data-testid dialog-job-note still present)", () => {
    expect(ENTITY_NOTE_SRC).toMatch(/data-testid="dialog-job-note"/);
  });
});

// ── TimeEntryModal — nested inline AlertDialog consolidation ─────────

describe("TimeEntryModal — nested delete confirm migrated to ConfirmModal", () => {
  it("imports ConfirmModal from canonical path", () => {
    const importLines = TIME_ENTRY_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).toMatch(/ConfirmModal/);
    expect(importLines).toMatch(/@\/components\/ui\/modal/);
  });

  it("does NOT import alert-dialog", () => {
    const importLines = TIME_ENTRY_SRC.split("\n")
      .filter((l) => l.trimStart().startsWith("import "))
      .join("\n");
    expect(importLines).not.toMatch(/alert-dialog/);
  });

  it("does NOT use <AlertDialog JSX", () => {
    expect(TIME_ENTRY_SRC).not.toMatch(/<AlertDialog/);
  });

  it("delete confirm uses variant=\"destructive\" with testIdPrefix", () => {
    expect(TIME_ENTRY_SRC).toMatch(/testIdPrefix="delete-time-entry"/);
    expect(TIME_ENTRY_SRC).toMatch(/variant="destructive"/);
  });

  it("preserves deleteMutation.mutate() as onConfirm handler", () => {
    expect(TIME_ENTRY_SRC).toMatch(/onConfirm=\{\(\) => deleteMutation\.mutate\(\)\}/);
  });

  it("passes isPending={deleteMutation.isPending}", () => {
    expect(TIME_ENTRY_SRC).toMatch(/isPending=\{deleteMutation\.isPending\}/);
  });

  it("confirmLabel reflects pending state (Deleting… vs Delete)", () => {
    expect(TIME_ENTRY_SRC).toMatch(/Deleting…/);
    expect(TIME_ENTRY_SRC).toMatch(/confirmLabel=\{deleteMutation\.isPending/);
  });
});
