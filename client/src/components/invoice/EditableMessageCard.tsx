/**
 * EditableMessageCard — canonical "tap pencil → edit textarea → Save /
 * Cancel" card pattern used by the invoice detail page's Client message
 * surface and reused by the new-invoice draft builder for both Client
 * message and Internal notes.
 *
 * Extracted from `InvoiceDetailPage.tsx` (the inline Client message
 * card at ~L1875–1933). The primitive matches that JSX byte-for-byte:
 * same chrome, same compact-collapsed-when-empty rule, same Pencil icon
 * affordance, same Cancel/Save footer.
 *
 * Two consumption modes:
 *   • Live: pass an async `onSave(next)` that performs a mutation and
 *     resolves on success. Component shows "Saving…" while the promise
 *     is pending and exits edit on resolve. The InvoiceDetailPage call
 *     site uses `mutateAsync(...)`.
 *   • Draft: pass a sync `onSave(next)` that updates local state. The
 *     component exits edit immediately. The /invoices/new builder uses
 *     this path so the draft text is captured locally and submitted on
 *     Save Invoice.
 *
 * No mutations live inside this component. The consumer's `onSave` is
 * the only commit path.
 */
import { useEffect, useState } from "react";
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
  /** Optional external "saving" signal. Useful when the consumer holds
   *  the in-flight state itself (e.g. a TanStack Query mutation already
   *  exposes `isPending`). Combined with the internal saving state via
   *  OR — either signal sets the button to "Saving…". */
  isSaving?: boolean;
  /** 2026-05-03: when true, the edit pencil is hidden and the card is
   *  display-only. Used by /invoices/new before a client/location is
   *  picked so the card renders in its canonical position but cannot
   *  be entered. */
  disabled?: boolean;
  /**
   * 2026-05-05: optional default text. When provided, an additional
   * "Reset to default" button appears inside the edit footer that
   * replaces the current draft with this value. Used by the invoice
   * detail page to give operators a one-click path back to the tenant
   * Default Client Message. Omit to hide the affordance — every
   * non-tenant consumer (e.g. internal-notes editor) leaves it off.
   */
  defaultValue?: string | null;
  /** Optional label for the reset action. Defaults to "Reset to default". */
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localSaving, setLocalSaving] = useState(false);

  // Resync draft from value whenever the parent-controlled value moves
  // (post-save the parent updates its prop; we mirror). Skip the resync
  // while the user has the editor open so we don't clobber typed text.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const messageEmpty = !value || value.length === 0;
  const compactCollapsed = messageEmpty && !editing;
  const isDirty = draft !== value;
  const showSavingLabel = isSaving || localSaving;

  const handleEnterEdit = () => {
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
    const result = onSave(draft);
    if (result instanceof Promise) {
      setLocalSaving(true);
      try {
        await result;
        setEditing(false);
      } catch {
        // Consumer's mutation surfaces its own error toast; stay in
        // edit so the user can retry or cancel.
      } finally {
        setLocalSaving(false);
      }
    } else {
      setEditing(false);
    }
  };

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
            onClick={handleEnterEdit}
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
                className="min-h-[88px] resize-y text-sm leading-relaxed text-slate-700"
                data-testid={textareaTestId}
              />
              <div className="mt-2 flex justify-end gap-2">
                {typeof defaultValue === "string" && defaultValue.length > 0 && draft !== defaultValue && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 mr-auto text-xs text-slate-500"
                    onClick={() => setDraft(defaultValue)}
                    disabled={showSavingLabel}
                    data-testid="button-reset-to-default-message"
                  >
                    {resetToDefaultLabel}
                  </Button>
                )}
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
                  data-testid={saveButtonTestId}
                >
                  {showSavingLabel ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          ) : (
            <p
              className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
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
