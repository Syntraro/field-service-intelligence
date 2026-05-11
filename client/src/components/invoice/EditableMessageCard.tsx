/**
 * EditableMessageCard — canonical "tap pencil → edit textarea → Save /
 * Cancel" card pattern used by the invoice detail page's Client message
 * surface and reused by the new-invoice draft builder for both Client
 * message and Internal notes.
 *
 * 2026-05-10: State machine + footer migrated to useInlineEdit /
 * InlineEditFooter. Card chrome, compactCollapsed, and reset-to-default
 * button remain card-specific.
 *
 * Two consumption modes:
 *   • Live: pass an async `onSave(next)` that performs a mutation and
 *     resolves on success. Component shows "Saving…" while the promise
 *     is pending and exits edit on resolve.
 *   • Draft: pass a sync `onSave(next)` that updates local state. The
 *     component exits edit immediately.
 *
 * No mutations live inside this component. The consumer's `onSave` is
 * the only commit path.
 */
import { useInlineEdit, InlineEditFooter } from "@/components/forms/InlineEditableText";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CardSectionHeader } from "@/pages/InvoiceDetailPage";

export interface EditableMessageCardProps {
  /** Section header label, e.g. "Client message" or "Internal notes". */
  title: string;
  /** Currently-committed value. The component re-syncs its internal
   *  draft from this prop whenever it changes AND the user is not in
   *  the middle of an edit. */
  value: string;
  /** Called when the user clicks Save with a dirty draft. Sync handlers
   *  cause the card to exit edit immediately; async handlers cause the
   *  card to show "Saving…" and exit edit on Promise resolve. */
  onSave: (next: string) => void | Promise<void>;
  /** Placeholder shown inside the textarea when empty. */
  placeholder?: string;
  /** Outer card data-testid (e.g. "card-invoice-client-message"). */
  testId: string;
  /** Pencil button data-testid. Defaults to "button-edit-message". */
  editButtonTestId?: string;
  /** Textarea data-testid. Defaults to "textarea-message". */
  textareaTestId?: string;
  /** Save button data-testid. Defaults to "button-save-message". */
  saveButtonTestId?: string;
  /** Optional external "saving" signal. Combined with internal saving
   *  state via OR — either signal sets the button to "Saving…". */
  isSaving?: boolean;
  /** When true, the edit pencil is hidden and the card is display-only. */
  disabled?: boolean;
  /**
   * Optional default text. When provided, a "Reset to default" button
   * appears inside the edit footer that replaces the current draft with
   * this value. Omit to hide the affordance.
   */
  defaultValue?: string | null;
  /** Label for the reset action. Defaults to "Reset to default". */
  resetToDefaultLabel?: string;
}

export function EditableMessageCard({
  title,
  value,
  onSave,
  placeholder,
  testId,
  editButtonTestId = "button-edit-message",
  textareaTestId = "textarea-message",
  saveButtonTestId = "button-save-message",
  isSaving = false,
  disabled = false,
  defaultValue,
  resetToDefaultLabel = "Reset to default",
}: EditableMessageCardProps) {
  const { editing, draft, setDraft, isDirty, saving, enterEdit, handleCancel, handleSave } =
    useInlineEdit({ value, onSave, isSaving });

  const messageEmpty = !value || value.length === 0;
  const compactCollapsed = messageEmpty && !editing;

  const resetSlot =
    typeof defaultValue === "string" && defaultValue.length > 0 && draft !== defaultValue ? (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 mr-auto text-xs text-slate-500"
        onClick={() => setDraft(defaultValue)}
        disabled={saving}
        data-testid="button-reset-to-default-message"
      >
        {resetToDefaultLabel}
      </Button>
    ) : null;

  return (
    <div
      className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card"
      data-testid={testId}
    >
      <CardSectionHeader
        title={title}
        right={!editing && !disabled ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={enterEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
            data-testid={editButtonTestId}
          >
            <Pencil className="h-3.5 w-3.5 text-slate-400" />
          </Button>
        ) : null}
      />
      {!compactCollapsed && (
        <div className="p-4">
          {editing ? (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                className="min-h-[88px] resize-y text-helper leading-relaxed text-foreground"
                autoFocus
                data-testid={textareaTestId}
              />
              <InlineEditFooter
                onCancel={handleCancel}
                onSave={() => void handleSave()}
                saving={saving}
                isDirty={isDirty}
                cancelTestId={undefined}
                saveTestId={saveButtonTestId}
                leftSlot={resetSlot}
              />
            </>
          ) : (
            <p
              className="m-0 text-helper leading-relaxed whitespace-pre-wrap text-foreground"
              data-testid={`${testId}-display`}
            >
              {value}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
