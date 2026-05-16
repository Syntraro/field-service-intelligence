import { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types (internal to this card) ─────────────────────────────────────────────

export interface ReceivablesNote {
  id: string;
  noteType: string;
  noteText: string;
  promisedAt?: string | null;
  contactMethod?: string | null;
  outcome?: string | null;
  communicatedAt?: string | null;
  createdAt: string;
  createdBySystem?: boolean;
  user?: { id: string; fullName?: string | null; firstName?: string | null; lastName?: string | null } | null;
}

interface NoteGroup {
  communication: ReceivablesNote;
  promises: ReceivablesNote[];
}

type RenderItem =
  | { type: "group"; group: NoteGroup }
  | { type: "standalone"; note: ReceivablesNote };

// ── Display maps ──────────────────────────────────────────────────────────────

const NOTE_TYPE_LABELS: Record<string, string> = {
  general:          "Note",
  reminder:         "Reminder",
  promise_to_pay:   "Promise to Pay",
  dispute:          "Dispute",
  escalation:       "Escalation",
  payment_received: "Payment Received",
  communication:    "Communication",
};

const OUTCOME_DISPLAY: Record<string, string> = {
  spoke_with:   "Spoke with client",
  left_message: "Left message",
  no_answer:    "No answer",
  email_sent:   "Email sent",
  text_sent:    "Text sent",
  other:        "Communication",
};

const METHOD_DISPLAY: Record<string, string> = {
  phone_call:   "Phone Call",
  email:        "Email",
  text_message: "Text Message",
  in_person:    "In Person",
  other:        "Other",
};

function noteTypeLabel(type: string): string {
  return NOTE_TYPE_LABELS[type] ?? type;
}

function userDisplayName(user: ReceivablesNote["user"]): string | null {
  if (!user) return null;
  if (user.fullName) return user.fullName;
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

// ── groupNotes ────────────────────────────────────────────────────────────────

const GROUP_WINDOW_MS = 2_000;

/**
 * Groups communication notes with any promise_to_pay notes created in the
 * same DB transaction (within 2s). Two-pass to handle DESC ordering where
 * a promise_to_pay may appear before its communication anchor.
 */
export function groupNotes(notes: ReceivablesNote[]): RenderItem[] {
  const linkedPromiseIds = new Set<string>();
  const groupMap = new Map<string, ReceivablesNote[]>();

  const communicationNotes = notes.filter(
    (n) => n.noteType === "communication" && !n.createdBySystem,
  );
  const promiseNotes = notes.filter(
    (n) => n.noteType === "promise_to_pay" && !n.createdBySystem,
  );

  for (const comm of communicationNotes) {
    const tComm = new Date(comm.createdAt).getTime();
    const linked = promiseNotes.filter(
      (p) =>
        !linkedPromiseIds.has(p.id) &&
        Math.abs(new Date(p.createdAt).getTime() - tComm) <= GROUP_WINDOW_MS,
    );
    linked.forEach((p) => linkedPromiseIds.add(p.id));
    groupMap.set(comm.id, linked);
  }

  const result: RenderItem[] = [];
  for (const note of notes) {
    if (linkedPromiseIds.has(note.id)) continue;
    if (note.noteType === "communication" && !note.createdBySystem) {
      result.push({ type: "group", group: { communication: note, promises: groupMap.get(note.id) ?? [] } });
    } else {
      result.push({ type: "standalone", note });
    }
  }
  return result;
}

// ── InvoiceActivityCard ───────────────────────────────────────────────────────

interface InvoiceActivityCardProps {
  notes: ReceivablesNote[];
  loading: boolean;
  error: boolean;
  "data-testid"?: string;
}

/**
 * Unified activity feed for a single selected invoice.
 * All entries render inside one beige card separated by dividers.
 * Receives pre-fetched notes from InvoiceActionsRail.
 */
export function InvoiceActivityCard({
  notes,
  loading,
  error,
  "data-testid": testId,
}: InvoiceActivityCardProps) {
  const renderItems = useMemo(() => groupNotes(notes), [notes]);

  const cardClass = "rounded-md border border-border bg-inset-surface p-3";

  if (loading) {
    return (
      <div className={cardClass} data-testid={testId ?? "receivables-notes-section"}>
        <p className="text-helper text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className={cardClass} data-testid={testId ?? "receivables-notes-section"}>
        <p className="text-helper text-muted-foreground" data-testid="receivables-notes-error">
          Could not load activity.
        </p>
      </div>
    );
  }
  if (renderItems.length === 0) {
    return (
      <div className={cardClass} data-testid={testId ?? "receivables-notes-section"}>
        <p className="text-helper text-muted-foreground" data-testid="receivables-notes-empty">
          No activity yet.
        </p>
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid={testId ?? "receivables-notes-section"}>
      <div data-testid="receivables-notes-list">
        {renderItems.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === renderItems.length - 1;
          const itemClass = cn(
            "flex gap-2.5 py-3",
            isFirst && "pt-0",
            isLast && "pb-0",
            !isFirst && "border-t border-border",
          );

          if (item.type === "group") {
            const { communication: comm, promises } = item.group;
            const headlineText = comm.outcome
              ? (OUTCOME_DISPLAY[comm.outcome] ?? noteTypeLabel(comm.noteType))
              : noteTypeLabel(comm.noteType);
            const dateDisplay = comm.communicatedAt
              ? format(new Date(comm.communicatedAt), "MMM d 'at' h:mm a")
              : format(new Date(comm.createdAt), "MMM d 'at' h:mm a");
            const methodDisplay = comm.contactMethod
              ? (METHOD_DISPLAY[comm.contactMethod] ?? comm.contactMethod)
              : null;
            const metaParts = [dateDisplay, methodDisplay, userDisplayName(comm.user)].filter(Boolean);
            return (
              <div
                key={comm.id}
                className={cn(itemClass, comm.createdBySystem && "opacity-70")}
                data-testid={`receivables-note-${comm.id}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-helper text-muted-foreground">{metaParts.join(" · ")}</p>
                  <p className="text-row font-medium text-foreground">{headlineText}</p>
                  {comm.noteText && <p className="text-row text-foreground">{comm.noteText}</p>}
                  {promises.map((p) => (
                    <p key={p.id} className="text-helper text-muted-foreground">
                      Promise to pay: {format(new Date(p.promisedAt!), "MMM d, yyyy")}
                    </p>
                  ))}
                </div>
              </div>
            );
          }

          const { note } = item;
          const isSystem = note.createdBySystem === true;
          const isCommunication = note.noteType === "communication";
          const headlineText = isCommunication && note.outcome
            ? (OUTCOME_DISPLAY[note.outcome] ?? noteTypeLabel(note.noteType))
            : noteTypeLabel(note.noteType);
          const dateDisplay = isCommunication && note.communicatedAt
            ? format(new Date(note.communicatedAt), "MMM d 'at' h:mm a")
            : format(new Date(note.createdAt), "MMM d 'at' h:mm a");
          const methodDisplay = note.contactMethod
            ? (METHOD_DISPLAY[note.contactMethod] ?? note.contactMethod)
            : null;
          const metaParts = [dateDisplay, methodDisplay, userDisplayName(note.user)].filter(Boolean);
          return (
            <div
              key={note.id}
              className={cn(itemClass, isSystem && "opacity-70")}
              data-testid={`receivables-note-${note.id}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-helper text-muted-foreground">{metaParts.join(" · ")}</p>
                <p className="text-row font-medium text-foreground">{headlineText}</p>
                {note.noteText && <p className="text-row text-foreground">{note.noteText}</p>}
                {note.promisedAt && (
                  <p className="text-helper text-muted-foreground">
                    Promise to pay: {format(new Date(note.promisedAt), "MMM d, yyyy")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
