/**
 * DraftNotesCard — visual stand-in for `<EntityNotesSection embedded>`
 * on the unsaved-invoice builder.
 *
 * 2026-05-03. The live `/invoices/:id` page mounts
 * `<EntityNotesSection entityType="invoice" entityId={…} embedded …>`
 * inside a canonical card chrome on the right rail. That component
 * reads notes via `entityId` (an invoice id) and writes via
 * `writeEntityId` (the underlying job id) — neither exists before the
 * atomic POST runs, so EntityNotesSection cannot mount on
 * `/invoices/new`.
 *
 * This card replicates EntityNotesSection's `embedded`-mode chrome
 * EXACTLY (header + body + outer card classes — see
 * `EntityNotesSection.tsx:233–253` and the wrapper at
 * `InvoiceDetailPage.tsx:1889`) so the right rail looks identical
 * across both pages.
 *
 * 2026-05-10: State machine + footer migrated to useInlineEdit /
 * InlineEditFooter. Header chrome and note display view preserved as-is
 * (exact EntityNotesSection replica contract).
 */
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useInlineEdit, InlineEditFooter } from "@/components/forms/InlineEditableText";

export interface DraftNotesCardProps {
  /** Pre-save note draft value (shown on /invoices/new before the invoice is saved;
   *  post-save notes are written via POST /api/invoices/:id/notes to the invoice_notes table). */
  value: string;
  /** Commit a new value. Sync handlers cause the card to exit edit
   *  mode immediately. Async handlers cause the card to show "Saving…"
   *  and exit edit on Promise resolve. */
  onChange: (next: string) => void | Promise<void>;
  /** When true, hides the "+ Add Note" affordance and locks editing. */
  disabled?: boolean;
  /** Optional external "saving" signal. Combined with internal saving
   *  state via OR — either sets the Save button to "Saving…". */
  isSaving?: boolean;
  /** Outer card data-testid. Defaults to `card-invoice-notes`. */
  testId?: string;
}

export function DraftNotesCard({
  value,
  onChange,
  disabled = false,
  isSaving = false,
  testId = "card-invoice-notes",
}: DraftNotesCardProps) {
  const { editing, draft, setDraft, isDirty, saving, enterEdit, handleCancel, handleSave } =
    useInlineEdit({ value, onSave: onChange, isSaving });

  const hasContent = value.trim().length > 0;

  // Header — verbatim copy of EntityNotesSection.tsx:233–253 (same
  // background color, border, icon, title typography, "+ Add Note" affordance).
  const header = (
    <div
      className="flex items-center justify-between px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]"
      data-testid="trigger-notes"
    >
      <span className="text-sm font-semibold text-[#0f172a] flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#64748b]" />
        Notes
      </span>
      {!disabled && !editing && (
        <button
          type="button"
          className="text-xs text-[#76B054] hover:text-[#5F9442] font-medium"
          onClick={enterEdit}
          data-testid="button-add-note"
        >
          + Add Note
        </button>
      )}
    </div>
  );

  // Body — same `embedded` padding (`px-3 pb-3 pt-1`) the live card uses.
  const body = (
    <div className="px-3 pb-3 pt-1">
      {editing ? (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Notes for your team. Not shared with the client."
            className="min-h-[88px] resize-y text-helper leading-relaxed text-foreground"
            data-testid="textarea-add-note"
            autoFocus
          />
          <InlineEditFooter
            onCancel={handleCancel}
            onSave={() => void handleSave()}
            saving={saving}
            isDirty={isDirty}
            saveTestId="button-save-note"
          />
        </>
      ) : !hasContent ? (
        // Canonical empty state — identical to EntityNotesSection's empty branch.
        <div className="text-center py-3 text-muted-foreground">
          <MessageSquare className="h-5 w-5 mx-auto mb-1 opacity-50" />
          <p className="text-xs">No notes yet</p>
        </div>
      ) : (
        // Single-note display — same row chrome EntityNotesSection uses.
        // Click anywhere on the row to edit.
        <div className="space-y-0">
          <div
            role={disabled ? undefined : "button"}
            tabIndex={disabled ? -1 : 0}
            onClick={disabled ? undefined : enterEdit}
            onKeyDown={disabled ? undefined : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                enterEdit();
              }
            }}
            className={`group py-3 px-1 rounded transition-colors ${
              disabled ? "cursor-default" : "cursor-pointer hover:bg-slate-50"
            }`}
            data-testid="note-draft-internal"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">Internal</span>
                {" · "}
                draft
              </span>
            </div>
            <p className="text-[14px] leading-5 whitespace-pre-wrap mt-0.5 text-slate-800">
              {value}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card"
      data-testid={testId}
    >
      {header}
      {body}
    </div>
  );
}
