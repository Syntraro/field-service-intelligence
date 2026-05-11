/**
 * QuoteDescriptionCard — Quote Description card, shared between Quote
 * Detail (saved mode) and Create Quote (draft mode).
 *
 * Two modes:
 *   - "saved": Collapsible card (default collapsed). Click to expand →
 *     click anywhere on the body to enter inline-edit. Save calls the
 *     parent's `onSave(text)` which PATCHes notesCustomer. Mirrors the
 *     prior QuoteDetailPage description block byte-for-byte; the saved
 *     page must look identical to before the extraction.
 *   - "draft": Always-expanded textarea. Value is controlled by the
 *     parent — no mutation, no PATCH. The create page submits
 *     `notesCustomer` along with the rest of the quote payload.
 *
 * 2026-05-10: SavedDescription state machine migrated to useInlineEdit.
 * Edit mode UI (Loader2 + primary save button, Cmd+Enter, Escape) kept
 * as QDC-specific; InlineEditFooter not used here due to different
 * button variant (default/primary vs outline).
 */
import { useState } from "react";
import { ChevronDown, FileText, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInlineEdit } from "@/components/forms/InlineEditableText";

type SavedProps = {
  mode: "saved";
  /** Current saved value of `quote.notesCustomer`. */
  value: string | null | undefined;
  /**
   * Called when the user clicks Save. Parent owns the PATCH mutation.
   * Returning a Promise lets the card close edit-mode on success and
   * stay open on error.
   */
  onSave: (text: string) => void | Promise<unknown>;
  /** Pending state for the parent's PATCH mutation. */
  isSaving?: boolean;
  /** When true, renders without card chrome and Collapsible — for use
   *  inside CanonicalDetailHeader via the description prop (2026-05-08).
   *  Always expanded; click-to-edit. Default: false (standalone card). */
  inline?: boolean;
};

type DraftProps = {
  mode: "draft";
  /** Controlled draft value. */
  value: string;
  /** Fires on every keystroke. */
  onChange: (next: string) => void;
  /** Disable the textarea (e.g. while save mutation is in flight). */
  disabled?: boolean;
};

export type QuoteDescriptionCardProps = SavedProps | DraftProps;

export function QuoteDescriptionCard(props: QuoteDescriptionCardProps) {
  if (props.mode === "draft") return <DraftDescription {...props} />;
  return <SavedDescription {...props} />;
}

// ── Saved-mode body — collapsible + click-to-edit ──
function SavedDescription({ value, onSave, isSaving, inline }: SavedProps) {
  const [expanded, setExpanded] = useState(false);

  // onSave returns Promise<unknown>; useInlineEdit expects Promise<void>.
  // Cast is safe — we only await resolution/rejection, not the value.
  const { editing, draft, setDraft, saving, enterEdit, handleCancel, handleSave } =
    useInlineEdit({
      value: value ?? "",
      onSave: onSave as (text: string) => void | Promise<void>,
      isSaving,
    });

  const isEmpty = !value || value.trim() === "";

  // Shared edit mode body used in both inline and standalone card modes.
  const editBody = (
    <div className="space-y-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={inline ? 4 : 5}
        autoFocus
        disabled={saving}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void handleSave();
          } else if (e.key === "Escape") {
            handleCancel();
          }
        }}
        data-testid="input-quote-description"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={handleCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() => void handleSave()}
          data-testid="button-save-quote-description"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );

  // Shared view mode body used in both inline and standalone card modes.
  const viewBody = (
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
      data-testid="text-quote-description"
    >
      {isEmpty ? (
        <p className="text-helper italic text-muted-foreground group-hover:text-foreground transition-colors">
          Click to add description…
        </p>
      ) : (
        <p className="text-helper leading-relaxed whitespace-pre-wrap flex-1 min-w-0 text-foreground group-hover:text-foreground/80 transition-colors">
          {value}
        </p>
      )}
      <Pencil className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0 mt-0.5" />
    </div>
  );

  // ── Inline mode (inside CanonicalDetailHeader description slot) ────
  if (inline) {
    return (
      <div data-testid="card-quote-description">
        {editing ? editBody : viewBody}
      </div>
    );
  }

  // ── Standalone card mode ────────────────────────────────────────────
  return (
    <div
      className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="card-quote-description"
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full px-4 py-2.5 flex items-center justify-between transition-colors hover:bg-slate-50",
              expanded && "border-b border-slate-200",
            )}
            data-testid="trigger-quote-description"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-700">Quote Description</span>
              {!expanded && value && (
                <span className="text-xs text-slate-400 truncate max-w-[260px]">{value}</span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-slate-400 transition-transform shrink-0",
                expanded && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-3">
            {editing ? editBody : viewBody}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ── Draft-mode body — always-expanded textarea ──
function DraftDescription({ value, onChange, disabled }: DraftProps) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden"
      data-testid="card-quote-description"
    >
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm font-semibold text-slate-700">Quote Description</span>
      </div>
      <div className="px-4 py-3">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the scope of work for this quote…"
          rows={4}
          maxLength={2000}
          className="min-h-[96px] text-sm resize-y"
          disabled={disabled}
          data-testid="input-quote-description"
        />
      </div>
    </div>
  );
}
