/**
 * EntityNotesPanel — canonical orchestration component for the app's
 * notes UI (2026-05-08).
 *
 * Absorbs the prior `EntityNotesSection` (entity-owned notes:
 * job / invoice / quote / lead) and `NotesPanel` (client-scoped notes:
 * customer-company / location, with `showOnJobs / Invoices / Quotes`
 * visibility flags) under one component, parameterized by
 * `entityType`. Renders rows via direct `<RailContentCard>` slot
 * composition — the documented "Notes exception" to the descriptor-
 * driven rail architecture (see `RailPanelRenderer.tsx` header
 * comment).
 *
 * What this component owns:
 *   • Querying notes (per-entity REST endpoint dispatch)
 *   • Rendering the list as canonical RailContentCard rows
 *   • Edit/delete affordances per row
 *   • Reporting visible count to the parent via `onCountChange`
 *   • Opening the create flow when `openAddNoteSignal` bumps
 *   • Attachment lifecycle (delegates to `useFileUpload`)
 *   • Visibility-flag chips on client-scoped notes
 *
 * What this component does NOT own (panel-level concerns — owned by
 * the page via `<DetailRailTab>` props on `<DetailRightRail>`):
 *   • Panel title
 *   • Count badge in the rail icon strip
 *   • +Add button JSX (lives on `DetailRailTab.action`)
 *   • Rail tab wiring / transitions / close-X
 *   • Panel header chrome / scroll container
 *   • Outer card chrome around the panel body
 *
 * Internal architecture: a thin top-level dispatch picks one of two
 * sub-components based on `entityType`. Both subcomponents render the
 * same structural shape (`<div className="space-y-2">` of
 * `<RailContentCard>` rows) so the rail panel reads as one design
 * across all six entity types.
 *
 *   • `EntityOwnedNotesPanel` — job / invoice / quote / lead.
 *     Reuses the existing `<EntityNoteDialog>` modal for create + edit.
 *     Renders origin chips (Location / Client / Company Note) for
 *     inherited rows on job + invoice surfaces.
 *
 *   • `ClientScopedNotesPanel` — location / customer-company.
 *     Inline create + edit (no modal) so the visibility-flag
 *     checkboxes can stay co-located with the textarea. Renders
 *     `<EntityChip>` Jobs / Invoices / Quotes pills per the existing
 *     NotesPanel UX.
 *
 * Backend contract preserved verbatim — no schema or REST changes.
 * See product-decision lock in the migration prompt: lead notes do
 * not gain visibility flags; entity-owned notes do not gain an
 * internal/customer-visible toggle; lead notes do not merge inherited
 * client notes.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileIcon,
  ImageIcon,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityChip } from "@/components/ui/chip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RailContentCard,
  RailContentCardBody,
  RailContentCardFooter,
} from "@/components/detail-rail/RailContentCard";
import { DetailRightRailEmpty } from "@/components/detail-rail/DetailRightRail";
import { InlineActionRow } from "@/components/ui/form-field";
import { NoteAttachmentStrip } from "@/components/attachments/NoteAttachmentStrip";
import {
  EntityNoteDialog,
  type ExistingEntityNote,
} from "./EntityNoteDialog";
import {
  useFileUpload,
  validateFileClientSide,
} from "@/hooks/useFileUpload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { jobKeys } from "@/lib/queryKeys/jobs";
import { ACTIVITY_FEED_QUERY_KEY } from "@/components/activity-feed/useActivityFeed";
import type { ClientNote } from "@shared/schema";

// ── Public types ────────────────────────────────────────────────────

/** Entity discriminant — drives endpoint, dialog, and chip behavior. */
export type EntityNotesType =
  | "job"
  | "invoice"
  | "quote"
  | "lead"
  | "location"
  | "company";

export interface EntityNotesPanelProps {
  entityType: EntityNotesType;
  /**
   * Primary entity id used to scope the read endpoint:
   *   - "job"      → /api/jobs/:entityId/notes
   *   - "invoice"  → /api/invoices/:entityId/notes
   *   - "quote"    → /api/quotes/:entityId/notes
   *   - "lead"     → /api/leads/:entityId/notes
   *   - "company"  → /api/customer-companies/:entityId/notes
   *   - "location" → /api/locations/:entityId/notes
   */
  entityId: string;
  /**
   * Tenant id companion for `entityType="location"` writes — preserved
   * for parity with the prior `<NotesPanel>` API that accepted both a
   * `companyId` and `locationId`. Optional on every other entity type.
   */
  companyId?: string;
  /**
   * When true, suppresses the component's internal "+ Add" button so
   * the page-level rail tab header can own the affordance via
   * `<DetailRailTab>.action`. Defaults to `true` because this is the
   * canonical rail-mounted usage; set to `false` only on legacy non-
   * rail consumers (none after this migration).
   */
  hideAddButton?: boolean;
  /**
   * Page-driven trigger to open the create flow. Bump the number to
   * fire — useful for wiring a `<DetailRailTab>.action` button to
   * the create dialog/inline editor without an imperative ref handle.
   */
  openAddNoteSignal?: number;
  /** Notification when the visible row count changes. */
  onCountChange?: (count: number) => void;
  /**
   * Controls how the note list is rendered.
   * - `"cards"` (default) — each note in its own `RailContentCard` with
   *   border, shadow, and rounded corners.
   * - `"unified"` — all notes inside one shared content area separated
   *   by `divide-y` lines; no per-note card chrome. Use this when the
   *   parent already provides the card container.
   * - `"activity"` — self-contained activity-feed card (`bg-inset-surface`,
   *   `border-border`, no shadow) with a green dot + `text-row` body per
   *   row, matching the `InvoiceActivityCard` visual system exactly. The
   *   component owns its outer card chrome in this mode.
   */
  listStyle?: "cards" | "unified" | "activity";
  /**
   * Called when the user clicks the "Add note" CTA inside the activity-
   * mode empty state. Only used when `listStyle="activity"`. Has no
   * effect in other modes.
   */
  onAddNote?: () => void;
}

// ── Top-level dispatch ─────────────────────────────────────────────

const CLIENT_SCOPED_TYPES: ReadonlyArray<EntityNotesType> = [
  "location",
  "company",
];

export function EntityNotesPanel(props: EntityNotesPanelProps) {
  if (CLIENT_SCOPED_TYPES.includes(props.entityType)) {
    return <ClientScopedNotesPanel {...props} />;
  }
  return <EntityOwnedNotesPanel {...props} />;
}

export default EntityNotesPanel;

// ════════════════════════════════════════════════════════════════════
// Entity-owned notes (job / invoice / quote / lead)
// ════════════════════════════════════════════════════════════════════

type EntityOwnedType = "job" | "invoice" | "quote" | "lead";

type NoteOrigin =
  | "job"
  | "invoice"
  | "quote"
  | "lead"
  | "client_location"
  | "client_company"
  | "client_tenant";

interface EntityOwnedNoteAttachment {
  id: string;
  noteId: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  storageProvider?: string | null;
  status?: string | null;
}

interface EntityOwnedNote {
  id: string;
  noteText: string;
  createdAt: string;
  updatedAt: string | null;
  userName: string;
  user: {
    id: string;
    email: string | null;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  attachments?: EntityOwnedNoteAttachment[];
  origin?: NoteOrigin;
  editable?: boolean;
}

function originChipLabel(origin: NoteOrigin | undefined): string | null {
  switch (origin) {
    case "client_location":
      return "Location Note";
    case "client_company":
      return "Client Note";
    case "client_tenant":
      return "Company Note";
    default:
      return null;
  }
}

function resolveEntityOwnedReadEndpoint(
  entityType: EntityOwnedType,
  entityId: string,
) {
  if (entityType === "quote") {
    return {
      url: `/api/quotes/${entityId}/notes`,
      queryKey: ["/api/quotes", entityId, "notes"] as const,
    };
  }
  if (entityType === "invoice") {
    return {
      url: `/api/invoices/${entityId}/notes`,
      queryKey: ["/api/invoices", entityId, "notes"] as const,
    };
  }
  if (entityType === "lead") {
    return {
      url: `/api/leads/${entityId}/notes`,
      queryKey: ["/api/leads", entityId, "notes"] as const,
    };
  }
  return {
    url: `/api/jobs/${entityId}/notes`,
    queryKey: jobKeys.notes(entityId),
  };
}

/** Owned-on-this-surface predicate. Inherited `client_*` rows are
 *  read-only; the surface-owned rows match the entity tag. */
function isOwnedRowEditable(
  note: EntityOwnedNote,
  entityType: EntityOwnedType,
): boolean {
  if (note.editable === false) return false;
  if (entityType === "quote") return note.origin === "quote";
  if (entityType === "invoice") return note.origin === "invoice";
  if (entityType === "lead") return note.origin === "lead";
  return note.origin === "job";
}

function EntityOwnedNotesPanel({
  entityType,
  entityId,
  hideAddButton = true,
  openAddNoteSignal,
  onCountChange,
  listStyle = "cards",
  onAddNote,
}: EntityNotesPanelProps) {
  // Narrow to entity-owned types — the dispatch above guarantees this.
  const ownedType = entityType as EntityOwnedType;

  // Single dialog instance for both create (note=null) and edit modes.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ExistingEntityNote | null>(
    null,
  );

  // Ref attached to the root div so we can detect whether this instance is
  // inside a display:none container. All detail pages render two
  // DetailRightRail instances (one for mobile via lg:hidden, one for desktop
  // via hidden lg:flex). Both mount EntityOwnedNotesPanel simultaneously;
  // without this guard, both fire the signal effect and both open dialogs via
  // portals — the hidden-rail dialog escapes display:none and stays visible
  // after the visible-rail dialog closes, creating the "modal immediately
  // reopens" bug.
  const containerRef = useRef<HTMLDivElement>(null);

  // Tracks the last signal value this instance has consumed. Initialized to
  // the current prop value so a remounted instance (e.g. after tab-switching
  // away and back while notesAddSignal is already > 0) does not re-open the
  // dialog for the same signal.
  const lastConsumedSignalRef = useRef(openAddNoteSignal ?? 0);

  const { url: fetchUrl, queryKey } = resolveEntityOwnedReadEndpoint(
    ownedType,
    entityId,
  );

  const { data: notes = [], isLoading } = useQuery<EntityOwnedNote[]>({
    queryKey: queryKey as unknown as readonly unknown[],
    queryFn: async () => {
      const res = await fetch(fetchUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
  });

  useEffect(() => {
    onCountChange?.(notes.length);
  }, [notes.length, onCountChange]);

  // Page-driven create-dialog opener — edge-triggered, consumed exactly once.
  useEffect(() => {
    if (!openAddNoteSignal || openAddNoteSignal <= lastConsumedSignalRef.current) return;
    // Skip the hidden-breakpoint rail instance: offsetParent is null whenever
    // an ancestor has display:none. Only the visible rail should open the dialog.
    if (containerRef.current && containerRef.current.offsetParent === null) return;
    lastConsumedSignalRef.current = openAddNoteSignal;
    setEditingNote(null);
    setDialogOpen(true);
  }, [openAddNoteSignal]);

  const openCreate = () => {
    setEditingNote(null);
    setDialogOpen(true);
  };

  const openEdit = (note: EntityOwnedNote) => {
    setEditingNote({
      id: note.id,
      noteText: note.noteText,
      attachments: (note.attachments ?? []).map((a) => ({
        id: a.id,
        noteId: a.noteId,
        fileId: a.fileId,
        originalName: a.originalName,
        mimeType: a.mimeType,
        size: a.size,
      })),
    });
    setDialogOpen(true);
  };

  return (
    <>
      {listStyle === "activity" ? (
        // ── Activity-feed card — owns its own outer chrome ──────────────
        // Matches InvoiceActivityCard visual system exactly:
        // bg-inset-surface, border-border, p-3, no shadow, green dot rows.
        <div
          ref={containerRef}
          className="rounded-md border border-border bg-inset-surface p-3 overflow-hidden"
          data-testid={`card-${ownedType}-notes`}
        >
          {isLoading ? (
            <p className="text-helper text-muted-foreground">Loading…</p>
          ) : notes.length === 0 ? (
            <div className="text-center py-2 space-y-2">
              <p
                className="text-helper text-muted-foreground"
                data-testid={`${ownedType}-notes-panel-empty`}
              >
                No notes yet.
              </p>
              {onAddNote && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onAddNote}
                    data-testid="button-add-note-empty"
                  >
                    Add note
                  </Button>
                </div>
              )}
            </div>
          ) : (
            notes.map((note, index) => {
              const isFirst = index === 0;
              const isLast = index === notes.length - 1;
              const canEdit = isOwnedRowEditable(note, ownedType);
              const chipLabel = originChipLabel(note.origin);
              const showAttachments =
                note.attachments && note.attachments.length > 0;

              const metaParts = [
                format(new Date(note.createdAt), "MMM d 'at' h:mm a"),
                note.userName,
                ...(note.updatedAt && note.updatedAt !== note.createdAt
                  ? ["edited"]
                  : []),
                ...(chipLabel ? [chipLabel] : []),
              ];

              const rowContent = (
                <>
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-helper text-muted-foreground">
                      {metaParts.join(" · ")}
                    </p>
                    <p
                      className="text-row text-foreground leading-relaxed whitespace-pre-wrap break-words"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {note.noteText}
                    </p>
                    {showAttachments && (
                      <div
                        className="mt-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NoteAttachmentStrip attachments={note.attachments!} />
                      </div>
                    )}
                  </div>
                </>
              );

              const rowClass = cn(
                "flex gap-2.5 py-3",
                isFirst && "pt-0",
                isLast && "pb-0",
                !isFirst && "border-t border-border",
              );

              return canEdit ? (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => openEdit(note)}
                  aria-label="Edit note"
                  data-testid={`note-${note.id}`}
                  className={cn(
                    rowClass,
                    // -mx-3 px-3 expands the button to the card edges so the
                    // hover background covers full width despite the p-3 outer
                    // container; overflow-hidden on the card clips to border-radius.
                    "w-full text-left -mx-3 px-3 hover:bg-black/[0.02] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#76B054]/40",
                  )}
                >
                  {rowContent}
                </button>
              ) : (
                <div
                  key={note.id}
                  data-testid={`note-${note.id}`}
                  className={rowClass}
                >
                  {rowContent}
                </div>
              );
            })
          )}
        </div>
      ) : (
        // ── cards / unified modes — parent provides outer card chrome ───
        <div ref={containerRef} data-testid={`card-${ownedType}-notes`}>
          {!hideAddButton && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={openCreate}
                className="text-helper text-brand font-medium hover:underline"
                data-testid="button-add-note"
              >
                + Add Note
              </button>
            </div>
          )}

          {isLoading ? (
            <p className="text-helper text-text-muted px-2 py-3">
              Loading notes...
            </p>
          ) : notes.length === 0 ? (
            <DetailRightRailEmpty
              message="No notes yet."
              testIdPrefix={`${ownedType}-notes`}
            />
          ) : listStyle === "unified" ? (
            <div className="divide-y divide-border">
              {notes.map((note) => {
                const canEdit = isOwnedRowEditable(note, ownedType);
                const chipLabel = originChipLabel(note.origin);
                const showAttachments =
                  note.attachments && note.attachments.length > 0;

                const noteBody = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-helper text-text-muted">
                        <span className="font-semibold text-text-primary">
                          {note.userName}
                        </span>
                        {" · "}
                        {format(new Date(note.createdAt), "MMM d, h:mm a")}
                        {note.updatedAt &&
                          note.updatedAt !== note.createdAt && (
                            <span className="ml-1 text-helper text-text-muted">
                              (edited)
                            </span>
                          )}
                      </span>
                      {chipLabel && (
                        <span
                          className="text-label uppercase font-medium px-1.5 py-0.5 rounded bg-slate-100 text-text-secondary shrink-0"
                          data-testid={`note-origin-${note.id}`}
                        >
                          {chipLabel}
                        </span>
                      )}
                    </div>
                    <RailContentCardBody>{note.noteText}</RailContentCardBody>
                    {showAttachments && (
                      <div
                        className="mt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NoteAttachmentStrip attachments={note.attachments!} />
                      </div>
                    )}
                  </>
                );

                return canEdit ? (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => openEdit(note)}
                    aria-label="Edit note"
                    data-testid={`note-${note.id}`}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#76B054]/40"
                  >
                    {noteBody}
                  </button>
                ) : (
                  <div
                    key={note.id}
                    data-testid={`note-${note.id}`}
                    className="px-4 py-3"
                  >
                    {noteBody}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {notes.map((note) => {
                const canEdit = isOwnedRowEditable(note, ownedType);
                const chipLabel = originChipLabel(note.origin);
                const showAttachments =
                  note.attachments && note.attachments.length > 0;

                const noteBody = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-helper text-text-muted">
                        <span className="font-semibold text-text-primary">
                          {note.userName}
                        </span>
                        {" · "}
                        {format(new Date(note.createdAt), "MMM d, h:mm a")}
                        {note.updatedAt &&
                          note.updatedAt !== note.createdAt && (
                            <span className="ml-1 text-helper text-text-muted">
                              (edited)
                            </span>
                          )}
                      </span>
                      {chipLabel && (
                        <span
                          className="text-label uppercase font-medium px-1.5 py-0.5 rounded bg-slate-100 text-text-secondary shrink-0"
                          data-testid={`note-origin-${note.id}`}
                        >
                          {chipLabel}
                        </span>
                      )}
                    </div>
                    <RailContentCardBody>{note.noteText}</RailContentCardBody>
                    {showAttachments && (
                      <div
                        className="mt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NoteAttachmentStrip attachments={note.attachments!} />
                      </div>
                    )}
                  </>
                );

                return canEdit ? (
                  <RailContentCard
                    key={note.id}
                    onClick={() => openEdit(note)}
                    testId={`note-${note.id}`}
                    ariaLabel="Edit note"
                  >
                    {noteBody}
                  </RailContentCard>
                ) : (
                  <RailContentCard
                    key={note.id}
                    testId={`note-${note.id}`}
                  >
                    {noteBody}
                  </RailContentCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      <EntityNoteDialog
        entityType={ownedType}
        entityId={entityId}
        note={editingNote}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingNote(null);
        }}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Client-scoped notes (location / customer-company)
// ════════════════════════════════════════════════════════════════════

type ClientScopedType = "location" | "company";

interface ClientScopedAttachment {
  id: string;
  fileId: string;
  originalName: string | null;
  mimeType: string | null;
  size: number | null;
  storageProvider?: string | null;
  status?: string | null;
}

interface ClientScopedNote extends ClientNote {
  attachments?: ClientScopedAttachment[];
  createdByName?: string;
}

interface PendingFile {
  file: File;
  preview?: string;
}

function clientScopedApiBase(
  scope: ClientScopedType,
  entityId: string,
): string {
  return scope === "location"
    ? `/api/locations/${entityId}/notes`
    : `/api/customer-companies/${entityId}/notes`;
}

function clientScopedQueryKey(
  scope: ClientScopedType,
  entityId: string,
): readonly unknown[] {
  return scope === "location"
    ? (["/api/locations", entityId, "notes"] as const)
    : (["/api/customer-companies", entityId, "notes"] as const);
}

function isImage(mime: string | null) {
  return !!mime && mime.startsWith("image/");
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ClientScopedNotesPanel({
  entityType,
  entityId,
  hideAddButton = true,
  openAddNoteSignal,
  onCountChange,
}: EntityNotesPanelProps) {
  const scope = entityType as ClientScopedType;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  // Ref attached to the root div so we can detect whether this instance is
  // inside a display:none container — same guard as EntityOwnedNotesPanel.
  // ClientDetailPage mounts two DetailRightRail instances simultaneously
  // (lg:hidden + hidden lg:flex); without this guard both respond to the
  // openAddNoteSignal and both open their inline create form.
  const containerRef = useRef<HTMLDivElement>(null);
  // Tracks the last signal value consumed. Initialized to the current prop
  // value so a remount after tab-switch does not re-fire a stale signal.
  const lastConsumedSignalRef = useRef(openAddNoteSignal ?? 0);

  // Create form state
  const [isAdding, setIsAdding] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showOnJobs, setShowOnJobs] = useState(false);
  const [showOnInvoices, setShowOnInvoices] = useState(false);
  const [showOnQuotes, setShowOnQuotes] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  // Edit form state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editShowOnJobs, setEditShowOnJobs] = useState(false);
  const [editShowOnInvoices, setEditShowOnInvoices] = useState(false);
  const [editShowOnQuotes, setEditShowOnQuotes] = useState(false);
  const [editExistingAttachments, setEditExistingAttachments] = useState<
    ClientScopedAttachment[]
  >([]);
  const [editMarkedForRemoval, setEditMarkedForRemoval] = useState<Set<string>>(
    new Set(),
  );
  const [editPendingFiles, setEditPendingFiles] = useState<PendingFile[]>([]);
  const [isEditSaving, setIsEditSaving] = useState(false);

  // Delete confirmation
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);

  const apiBase = clientScopedApiBase(scope, entityId);
  const qk = clientScopedQueryKey(scope, entityId);

  const { data: notes = [], isLoading } = useQuery<ClientScopedNote[]>({
    queryKey: qk,
    queryFn: () => apiRequest<ClientScopedNote[]>(apiBase),
    enabled: Boolean(entityId),
  });

  useEffect(() => {
    onCountChange?.(notes.length);
  }, [notes.length, onCountChange]);

  // Page-driven create-form opener — edge-triggered, consumed exactly once.
  // Mirrors the EntityOwnedNotesPanel guard: skip when this instance sits
  // inside a display:none ancestor (the hidden breakpoint-rail counterpart).
  useEffect(() => {
    if (!openAddNoteSignal || openAddNoteSignal <= lastConsumedSignalRef.current) return;
    if (!containerRef.current || containerRef.current.offsetParent === null) return;
    lastConsumedSignalRef.current = openAddNoteSignal;
    setIsAdding(true);
  }, [openAddNoteSignal]);

  // ── Mutations / upload lifecycle ───────────────────────────────────

  const { upload: uploadAttachment, isUploading: isAttachmentUploading } =
    useFileUpload();

  const createNoteMutation = useMutation({
    mutationFn: async (payload: {
      noteText: string;
      showOnJobs: boolean;
      showOnInvoices: boolean;
      showOnQuotes: boolean;
    }) =>
      apiRequest<{ id: string }>(apiBase, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) =>
      apiRequest(`${apiBase}/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      setDeleteNoteId(null);
      toast({ title: "Note deleted" });
    },
    onError: () =>
      toast({
        title: "Error",
        description: "Failed to delete note.",
        variant: "destructive",
      }),
  });

  // ── Helpers ────────────────────────────────────────────────────────

  const resetCreateForm = useCallback(() => {
    setIsAdding(false);
    setNoteText("");
    setShowOnJobs(false);
    setShowOnInvoices(false);
    setShowOnQuotes(false);
    pendingFiles.forEach((pf) => pf.preview && URL.revokeObjectURL(pf.preview));
    setPendingFiles([]);
  }, [pendingFiles]);

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: PendingFile[] = Array.from(fileList).map((f) => ({
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const pf = prev[idx];
      if (pf.preview) URL.revokeObjectURL(pf.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleCreate = async () => {
    const text = noteText.trim();
    if (!text) return;

    try {
      // Step 1 — persist the note to obtain a noteId for attachment placement.
      const note = await createNoteMutation.mutateAsync({
        noteText: text,
        showOnJobs,
        showOnInvoices,
        showOnQuotes,
      });

      // Step 2 — upload staged attachments via the canonical R2 lifecycle.
      // Each successful finalize inserts the note_attachments join row.
      for (const pf of pendingFiles) {
        const err = validateFileClientSide(pf.file);
        if (err) {
          toast({
            title: "File rejected",
            description: err,
            variant: "destructive",
          });
          continue;
        }
        try {
          await uploadAttachment(pf.file, {
            entityType: "client_note",
            entityId: note.id,
          });
        } catch (e: any) {
          toast({
            title: "Upload failed",
            description: e?.message || "File failed to upload.",
            variant: "destructive",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: qk });
      queryClient.invalidateQueries({ queryKey: ACTIVITY_FEED_QUERY_KEY });
      resetCreateForm();
    } catch {
      toast({
        title: "Error",
        description: "Failed to add note.",
        variant: "destructive",
      });
    }
  };

  const startEdit = (note: ClientScopedNote) => {
    // Revoke any object URLs from a prior open-edit session so we
    // don't leak them when the user switches edit targets without
    // hitting Cancel first.
    editPendingFiles.forEach(
      (pf) => pf.preview && URL.revokeObjectURL(pf.preview),
    );
    setEditingNoteId(note.id);
    setEditText(note.noteText);
    setEditShowOnJobs(note.showOnJobs ?? false);
    setEditShowOnInvoices(note.showOnInvoices ?? false);
    setEditShowOnQuotes(note.showOnQuotes ?? false);
    setEditExistingAttachments(note.attachments ?? []);
    setEditMarkedForRemoval(new Set());
    setEditPendingFiles([]);
  };

  const cancelEdit = () => {
    editPendingFiles.forEach(
      (pf) => pf.preview && URL.revokeObjectURL(pf.preview),
    );
    setEditingNoteId(null);
    setEditExistingAttachments([]);
    setEditMarkedForRemoval(new Set());
    setEditPendingFiles([]);
  };

  const toggleMarkForRemoval = (attachmentId: string) => {
    setEditMarkedForRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  };

  const handleEditFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: PendingFile[] = Array.from(fileList).map((f) => ({
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setEditPendingFiles((prev) => [...prev, ...newFiles]);
  };

  const removeEditPendingFile = (idx: number) => {
    setEditPendingFiles((prev) => {
      const pf = prev[idx];
      if (pf.preview) URL.revokeObjectURL(pf.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleEditSave = async (noteId: string) => {
    const text = editText.trim();
    if (!text) return;
    setIsEditSaving(true);
    try {
      // 1) PATCH text + visibility flags. PATCH does not touch
      //    attachments, so text-only saves cannot duplicate or drop
      //    files. Direct `apiRequest` call instead of a mutation hook
      //    so we can batch invalidation across the three steps below.
      await apiRequest(`${apiBase}/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({
          noteText: text,
          showOnJobs: editShowOnJobs,
          showOnInvoices: editShowOnInvoices,
          showOnQuotes: editShowOnQuotes,
        }),
      });

      // 2) Detach any attachments the user marked for removal.
      for (const attachmentId of Array.from(editMarkedForRemoval)) {
        try {
          await apiRequest(
            `/api/notes/${noteId}/attachments/${attachmentId}`,
            { method: "DELETE" },
          );
        } catch (e: any) {
          toast({
            title: "Remove failed",
            description: e?.message || "Failed to remove attachment.",
            variant: "destructive",
          });
        }
      }

      // 3) Upload any newly staged files. The R2 lifecycle's
      //    ensureAttachment is idempotent, so a retried upload will
      //    not double-insert the note_attachments join row.
      for (const pf of editPendingFiles) {
        const err = validateFileClientSide(pf.file);
        if (err) {
          toast({
            title: "File rejected",
            description: err,
            variant: "destructive",
          });
          continue;
        }
        try {
          await uploadAttachment(pf.file, {
            entityType: "client_note",
            entityId: noteId,
          });
        } catch (e: any) {
          toast({
            title: "Upload failed",
            description: e?.message || "File failed to upload.",
            variant: "destructive",
          });
        }
      }

      // 4) One invalidation at the end — refetches the list including
      //    updated attachment metadata.
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Note updated" });
      cancelEdit();
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "Failed to update note.",
        variant: "destructive",
      });
    } finally {
      setIsEditSaving(false);
    }
  };

  const isCreateBusy =
    createNoteMutation.isPending || isAttachmentUploading;

  if (isLoading) {
    return (
      <p className="text-helper text-text-muted px-2 py-3">
        Loading notes...
      </p>
    );
  }

  return (
    <>
      <div ref={containerRef} className="space-y-2">
        {/* In-component +Add affordance — only shown when caller opts
            in via `hideAddButton={false}`. Canonical rail mounts have
            this hidden because the rail tab header owns the button. */}
        {!hideAddButton && !isAdding && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-auto p-0 text-primary"
              onClick={() => setIsAdding(true)}
              data-testid="button-add-note"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Note
            </Button>
          </div>
        )}

        {/* ── Inline create form ───────────────────────────────────── */}
        {isAdding && (
          <div className="space-y-3 p-4 border rounded-md bg-muted/30">
            <Textarea
              placeholder="Enter your note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              data-testid="textarea-new-note"
            />

            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={showOnJobs}
                  onCheckedChange={(v) => setShowOnJobs(v === true)}
                />
                Show on Jobs
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={showOnInvoices}
                  onCheckedChange={(v) => setShowOnInvoices(v === true)}
                />
                Show on Invoices
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={showOnQuotes}
                  onCheckedChange={(v) => setShowOnQuotes(v === true)}
                />
                Show on Quotes
              </label>
            </div>

            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Attach Files
              </Button>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((pf, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background"
                    >
                      {pf.preview ? (
                        <img
                          src={pf.preview}
                          alt=""
                          className="h-6 w-6 rounded object-cover"
                        />
                      ) : (
                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="max-w-[120px] truncate">
                        {pf.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <InlineActionRow>
              <Button
                variant="outline"
                size="sm"
                onClick={resetCreateForm}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!noteText.trim() || isCreateBusy}
              >
                {isCreateBusy && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Note
              </Button>
            </InlineActionRow>
          </div>
        )}

        {/* ── Notes list ──────────────────────────────────────────── */}
        {notes.length === 0 && !isAdding ? (
          <DetailRightRailEmpty
            message="No notes yet."
            testIdPrefix={`${scope}-notes`}
          />
        ) : (
          notes.map((note) => (
            <RailContentCard key={note.id} testId={`note-${note.id}`}>
              {editingNoteId === note.id ? (
                /* ── Inline edit ──────────────────────────────────── */
                <div className="space-y-3">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    data-testid="textarea-edit-note"
                  />
                  <div className="flex flex-wrap gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={editShowOnJobs}
                        onCheckedChange={(v) => setEditShowOnJobs(v === true)}
                      />
                      Show on Jobs
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={editShowOnInvoices}
                        onCheckedChange={(v) =>
                          setEditShowOnInvoices(v === true)
                        }
                      />
                      Show on Invoices
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={editShowOnQuotes}
                        onCheckedChange={(v) =>
                          setEditShowOnQuotes(v === true)
                        }
                      />
                      Show on Quotes
                    </label>
                  </div>

                  {editExistingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {editExistingAttachments.map((att) => {
                        const marked = editMarkedForRemoval.has(att.id);
                        return (
                          <div
                            key={att.id}
                            className={`flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background ${marked ? "opacity-50 line-through" : ""}`}
                            data-testid={`edit-existing-attachment-${att.id}`}
                          >
                            {isImage(att.mimeType) ? (
                              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span
                              className="max-w-[140px] truncate"
                              title={att.originalName ?? "Attachment"}
                            >
                              {att.originalName ?? "Attachment"}
                            </span>
                            {att.size != null && (
                              <span className="text-muted-foreground">
                                {formatBytes(att.size)}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleMarkForRemoval(att.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={
                                marked
                                  ? "Undo remove"
                                  : `Remove ${att.originalName ?? "attachment"}`
                              }
                              data-testid={`edit-toggle-remove-${att.id}`}
                            >
                              {marked ? (
                                <Plus className="h-3 w-3" />
                              ) : (
                                <X className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-2">
                    <input
                      ref={editFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) =>
                        handleEditFilesSelected(e.target.files)
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editFileInputRef.current?.click()}
                      type="button"
                      data-testid="edit-attach-files"
                    >
                      <Paperclip className="h-3.5 w-3.5 mr-1.5" /> Attach Files
                    </Button>
                    {editPendingFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {editPendingFiles.map((pf, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 px-2 py-1 border rounded text-xs bg-background"
                          >
                            {pf.preview ? (
                              <img
                                src={pf.preview}
                                alt=""
                                className="h-6 w-6 rounded object-cover"
                              />
                            ) : (
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="max-w-[120px] truncate">
                              {pf.file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeEditPendingFile(i)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${pf.file.name}`}
                              data-testid={`edit-remove-pending-${i}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <InlineActionRow>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleEditSave(note.id)}
                      disabled={!editText.trim() || isEditSaving}
                      data-testid={`button-save-edit-${note.id}`}
                    >
                      {isEditSaving && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save
                    </Button>
                  </InlineActionRow>
                </div>
              ) : (
                /* ── Read view ────────────────────────────────────── */
                <>
                  <RailContentCardBody>{note.noteText}</RailContentCardBody>

                  {/* Visibility chips — canonical EntityChip with semantic
                      entity tones (info / success / purple). Kept on
                      single lines so source-pin tests can anchor on the
                      exact JSX shape. */}
                  {(note.showOnJobs ||
                    note.showOnInvoices ||
                    note.showOnQuotes) && (
                    <div className="flex gap-1.5 mt-2.5">
                      {note.showOnJobs && <EntityChip entity="job" size="compact">Jobs</EntityChip>}
                      {note.showOnInvoices && <EntityChip entity="invoice" size="compact">Invoices</EntityChip>}
                      {note.showOnQuotes && <EntityChip entity="quote" size="compact">Quotes</EntityChip>}
                    </div>
                  )}

                  {note.attachments && note.attachments.length > 0 && (
                    <div className="mt-2.5">
                      <NoteAttachmentStrip
                        attachments={note.attachments}
                      />
                    </div>
                  )}

                  {/* Footer: author · date on the left + edit/delete
                      actions on the right. Action buttons idle at
                      opacity-50 and reach full opacity on card hover —
                      RailContentCard bakes a `group` class that drives
                      the toggle. */}
                  <RailContentCardFooter>
                    <span className="truncate mr-2">
                      {note.createdByName || "Unknown"} ·{" "}
                      {note.createdAt &&
                        format(new Date(note.createdAt), "MMM d, h:mm a")}
                    </span>
                    <div className="flex gap-1 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => startEdit(note)}
                        data-testid={`button-edit-note-${note.id}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteNoteId(note.id)}
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </RailContentCardFooter>
                </>
              )}
            </RailContentCard>
          ))
        )}
      </div>

      <AlertDialog
        open={Boolean(deleteNoteId)}
        onOpenChange={() => setDeleteNoteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteNoteId && deleteMutation.mutate(deleteNoteId)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
