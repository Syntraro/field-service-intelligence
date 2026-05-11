/**
 * Canonical inline-edit renderer system (2026-05-10).
 *
 * Eliminates the duplicated edit-state management, Save/Cancel row, and
 * click-to-edit affordance that previously appeared independently in
 * EditableMessageCard, DraftNotesCard, and QuoteDescriptionCard.
 *
 * Exports:
 *   useInlineEdit        — state machine hook (editing, draft, save, cancel)
 *   InlineEditFooter     — Save/Cancel button row (dirty-check, saving, leftSlot)
 *   InlineEditableText   — full click-to-edit widget (view + edit + footer)
 *
 * Typography contract (Phase H1 semantic tokens):
 *   view text:        text-helper leading-relaxed whitespace-pre-wrap text-foreground
 *   view empty:       text-helper italic text-muted-foreground
 *   edit textarea:    min-h-[88px] resize-y text-helper leading-relaxed text-foreground
 *   footer row:       mt-2 flex items-center justify-end gap-2
 *   cancel button:    variant="ghost" size="sm" h-7 text-xs
 *   save button:      variant="outline" size="sm" h-7 text-xs
 *
 * Async/sync save detection:
 *   onSave returns Promise → hook sets localSaving, awaits, exits edit on resolve,
 *   stays open on error. onSave returns void → hook exits edit immediately.
 *   External isSaving OR localSaving → combined `saving` flag returned.
 *
 * Architecture:
 *   useInlineEdit is the state machine only — no JSX.
 *   InlineEditFooter owns button rendering — no state.
 *   InlineEditableText composes both + adds the click-to-edit view mode.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ── useInlineEdit ─────────────────────────────────────────────────────────────

export interface UseInlineEditParams {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  /** External saving signal (e.g. TanStack Query mutation `isPending`).
   *  ORed with internal localSaving — either sets the combined `saving` flag. */
  isSaving?: boolean;
}

export interface UseInlineEditReturn {
  editing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  /** True when draft !== value. */
  isDirty: boolean;
  /** True when isSaving OR localSaving. Use this for button disabled / label. */
  saving: boolean;
  /** Enter edit mode with draft reset to current value. */
  enterEdit: () => void;
  /** Exit edit mode, reset draft. */
  handleCancel: () => void;
  /** Save draft if dirty. Async onSave → localSaving; sync onSave → exits immediately.
   *  Stays in edit mode on async error so user can retry or cancel. */
  handleSave: () => Promise<void>;
}

export function useInlineEdit({
  value,
  onSave,
  isSaving = false,
}: UseInlineEditParams): UseInlineEditReturn {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localSaving, setLocalSaving] = useState(false);

  // Resync draft from parent value when it changes outside edit mode.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const isDirty = draft !== value;
  const saving = isSaving || localSaving;

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
    const result = onSave(draft);
    if (result instanceof Promise) {
      setLocalSaving(true);
      try {
        await result;
        setEditing(false);
      } catch {
        // Consumer surfaces its own error toast; stay in edit for retry.
      } finally {
        setLocalSaving(false);
      }
    } else {
      setEditing(false);
    }
  };

  return { editing, draft, setDraft, isDirty, saving, enterEdit, handleCancel, handleSave };
}

// ── InlineEditFooter ──────────────────────────────────────────────────────────

export interface InlineEditFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  isDirty: boolean;
  cancelTestId?: string;
  saveTestId?: string;
  /** Rendered at the left end of the footer row (e.g. a "Reset to default" button). */
  leftSlot?: ReactNode;
}

export function InlineEditFooter({
  onCancel,
  onSave,
  saving,
  isDirty,
  cancelTestId,
  saveTestId,
  leftSlot,
}: InlineEditFooterProps) {
  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      {leftSlot}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={onCancel}
        disabled={saving}
        data-testid={cancelTestId}
      >
        Cancel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={onSave}
        disabled={saving || !isDirty}
        data-testid={saveTestId}
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

// ── InlineEditableText ────────────────────────────────────────────────────────

export interface InlineEditableTextProps {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  /** External saving signal, passed to useInlineEdit. */
  isSaving?: boolean;
  /** Textarea placeholder (shown inside the textarea when editing and draft is empty). */
  placeholder?: string;
  /** Text shown in the click-to-edit affordance when value is empty. */
  emptyLabel?: string;
  /** textarea rows prop. */
  rows?: number;
  /** When true, Cmd+Enter / Ctrl+Enter submits the form. Default: false. */
  submitOnCmdEnter?: boolean;
  viewTestId?: string;
  textareaTestId?: string;
  cancelTestId?: string;
  saveTestId?: string;
}

export function InlineEditableText({
  value,
  onSave,
  isSaving,
  placeholder,
  emptyLabel = "Click to add…",
  rows,
  submitOnCmdEnter = false,
  viewTestId,
  textareaTestId,
  cancelTestId,
  saveTestId,
}: InlineEditableTextProps) {
  const { editing, draft, setDraft, isDirty, saving, enterEdit, handleCancel, handleSave } =
    useInlineEdit({ value, onSave, isSaving });

  const isEmpty = !value || value.trim() === "";

  if (editing) {
    return (
      <div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          autoFocus
          disabled={saving}
          className="min-h-[88px] resize-y text-helper leading-relaxed text-foreground"
          onKeyDown={(e) => {
            if (submitOnCmdEnter && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            } else if (e.key === "Escape") {
              handleCancel();
            }
          }}
          data-testid={textareaTestId}
        />
        <InlineEditFooter
          onCancel={handleCancel}
          onSave={() => void handleSave()}
          saving={saving}
          isDirty={isDirty}
          cancelTestId={cancelTestId}
          saveTestId={saveTestId}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={enterEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enterEdit();
        }
      }}
      className="group flex items-start gap-1.5 cursor-pointer"
      data-testid={viewTestId}
    >
      {isEmpty ? (
        <p className="text-helper italic text-muted-foreground group-hover:text-foreground transition-colors">
          {emptyLabel}
        </p>
      ) : (
        <p className="text-helper leading-relaxed whitespace-pre-wrap flex-1 min-w-0 text-foreground group-hover:text-foreground/80 transition-colors">
          {value}
        </p>
      )}
      <Pencil className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0 mt-0.5" />
    </div>
  );
}
