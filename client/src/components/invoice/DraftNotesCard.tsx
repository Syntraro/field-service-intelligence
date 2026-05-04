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
 * across both pages. The body hosts a single `notesInternal` draft
 * value: when empty, the user sees the canonical "No notes yet"
 * empty state with the same icon and copy; when non-empty, the value
 * renders as a single inline note. The "+ Add Note" affordance opens
 * an inline textarea with Save / Cancel buttons that commit the value
 * to local state. No mutations, no API calls — the value flows into
 * the atomic POST payload as `notesInternal` on Save Invoice.
 */
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface DraftNotesCardProps {
  /** Current `notesInternal` value (from invoice column, or local
   *  draft state on /invoices/new). */
  value: string;
  /** Commit a new value. Sync handlers cause the card to exit edit
   *  mode immediately (matches the create-mode UX where local state
   *  updates synchronously). Async handlers (e.g. wrapping a TanStack
   *  Query `mutateAsync`) cause the card to show "Saving…" and exit
   *  edit on Promise resolve — same async pattern
   *  `<EditableMessageCard>` uses. */
  onChange: (next: string) => void | Promise<void>;
  /** When true, hides the "+ Add Note" affordance and locks editing.
   *  Used by /invoices/new before a client/location is picked. */
  disabled?: boolean;
  /** Optional external "saving" signal. Useful when the consumer
   *  holds the in-flight state itself (e.g. a TanStack Query
   *  mutation already exposes `isPending`). Combined with the
   *  internal saving state via OR — either signal sets the Save
   *  button to "Saving…". */
  isSaving?: boolean;
  /** Outer card data-testid. Defaults to `card-invoice-notes` to
   *  mirror the live page's testid contract. */
  testId?: string;
}

export function DraftNotesCard({
  value,
  onChange,
  disabled = false,
  isSaving = false,
  testId = "card-invoice-notes",
}: DraftNotesCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localSaving, setLocalSaving] = useState(false);

  // Resync from props when value changes externally (e.g. parent
  // resets) — same pattern as EditableMessageCard.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const hasContent = value.trim().length > 0;
  const isDirty = draft !== value;
  const showSavingLabel = isSaving || localSaving;

  const enterEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };
  const handleSave = async () => {
    if (!isDirty) {
      setEditing(false);
      return;
    }
    const result = onChange(draft);
    if (result instanceof Promise) {
      setLocalSaving(true);
      try {
        await result;
        setEditing(false);
      } catch {
        // Consumer surfaces its own error toast; stay in edit so the
        // user can retry or cancel.
      } finally {
        setLocalSaving(false);
      }
    } else {
      setEditing(false);
    }
  };

  // Header — verbatim copy of EntityNotesSection.tsx:233–253 (same
  // background color, same border, same icon, same title typography,
  // same "+ Add Note" affordance color + copy). Counts default to
  // hidden (matches the live page's `showCount={false}`).
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

  // Body — same `embedded` padding (`px-3 pb-3 pt-1`) the live card
  // uses. Three states: empty + closed (canonical empty state),
  // value + closed (single inline note), editing (textarea + Save /
  // Cancel).
  const body = (
    <div className="px-3 pb-3 pt-1">
      {editing ? (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Notes for your team. Not shared with the client."
            className="min-h-[88px] resize-y text-sm leading-relaxed text-slate-700"
            data-testid="textarea-add-note"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCancel}
              disabled={showSavingLabel}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={showSavingLabel || !isDirty}
              onClick={() => void handleSave()}
              data-testid="button-save-note"
            >
              {showSavingLabel ? "Saving..." : "Save"}
            </Button>
          </div>
        </>
      ) : !hasContent ? (
        // Canonical empty state — identical to EntityNotesSection's
        // empty branch (icon at 50% opacity, "No notes yet" copy).
        <div className="text-center py-3 text-muted-foreground">
          <MessageSquare className="h-5 w-5 mx-auto mb-1 opacity-50" />
          <p className="text-xs">No notes yet</p>
        </div>
      ) : (
        // Single-note display — same row chrome EntityNotesSection
        // uses for individual notes (py-3 px-1, hover state when
        // editable). Click anywhere on the row to edit.
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

  // Outer card chrome — verbatim from `InvoiceDetailPage.tsx:1889`.
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
