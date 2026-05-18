import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink, Users, FileText, MessageSquare } from "lucide-react";
import { format, parseISO } from "date-fns";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { StatusChip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/typography";
import { getLeadStatusMeta } from "@/lib/statusBadges";
import { EntityNoteDialog } from "@/components/notes/EntityNoteDialog";
import { formatCurrency } from "@/lib/formatters";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedLeadContext {
  leadId: string;
  title: string;
  status: string;
  priority: string | null;
  estimatedValue: string | null;
  locationDisplayName: string | null;
  locationId: string;
  customerCompanyId: string | null;
  convertedQuoteId: string | null;
  sourceType: string;
  createdAt: string;
}

interface LeadNote {
  id: string;
  noteText: string;
  createdAt: string;
  userFullName: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
}

interface LeadActionsRailProps {
  context: SelectedLeadContext | null;
}

// ── LeadActionsRail ───────────────────────────────────────────────────────────

/**
 * Lead right rail — assembly-only.
 *
 * Query ownership:
 * - GET /api/leads/:id/notes — recent notes for activity card
 *
 * Action ownership:
 * - EntityNoteDialog: add-note modal (POST /api/leads/:id/notes)
 */
export function LeadActionsRail({ context }: LeadActionsRailProps) {
  const [, setLocation] = useLocation();
  const leadId = context?.leadId ?? null;

  const [addNoteOpen, setAddNoteOpen] = useState(false);

  const { data: notes = [], isLoading: notesLoading } = useQuery<LeadNote[]>({
    queryKey: ["/api/leads", leadId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load lead notes");
      return res.json();
    },
    enabled: !!leadId,
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  if (!context) return null;

  const statusMeta = getLeadStatusMeta(context.status);
  const leadPath = `/leads/${context.leadId}`;
  const clientPath = context.locationId ? `/clients/${context.locationId}` : null;

  const recentNotes = notes.slice(0, 5);

  return (
    <div data-testid="leads-actions-rail">

      {/* ── Entity card ─────────────────────────────────────────────────── */}
      <div className="pb-1">
        <SectionLabel className="mb-2">Lead</SectionLabel>
        <WorkspaceRailEntityCard
          icon={Users}
          entityLabel={
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                className="text-row text-brand hover:underline cursor-pointer text-left truncate min-w-0"
                onClick={() => setLocation(leadPath)}
                data-testid="rail-lead-title-link"
              >
                {context.title}
              </button>
              <StatusChip tone={statusMeta.tone} className="shrink-0">
                {statusMeta.label}
              </StatusChip>
            </div>
          }
          clientName={
            context.locationDisplayName ? (
              <button
                type="button"
                className="text-subheader font-semibold text-foreground hover:underline cursor-pointer text-left truncate block w-full mt-0.5"
                onClick={() => clientPath && setLocation(clientPath)}
                data-testid="rail-lead-client-link"
              >
                {context.locationDisplayName}
              </button>
            ) : null
          }
          action={
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setLocation(leadPath)}
              aria-label="Open lead detail"
              data-testid="rail-lead-open-button"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          }
          meta={[
            {
              label: "Est. Value",
              value: formatCurrency(context.estimatedValue ?? null),
            },
            {
              label: "Created",
              value: context.createdAt
                ? (() => { try { return format(parseISO(context.createdAt), "MMM d, yyyy"); } catch { return "—"; } })()
                : "—",
            },
          ]}
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
      <WorkspaceSectionCard
        title="Quick Actions"
        variant="section"
        data-testid="lead-quick-actions-card"
      >
        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-left text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => setLocation(leadPath)}
            data-testid="action-open-lead"
          >
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-row font-medium">Open Lead</span>
          </button>
          {context.convertedQuoteId && (
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
              onClick={() => setLocation(`/quotes/${context.convertedQuoteId}`)}
              data-testid="action-view-quote"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-row font-medium">View Quote</span>
            </button>
          )}
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors"
            onClick={() => setAddNoteOpen(true)}
            data-testid="action-add-note"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-row font-medium">Add Note</span>
          </button>
        </div>
      </WorkspaceSectionCard>

      {/* ── Recent Notes ─────────────────────────────────────────────────── */}
      <WorkspaceSectionCard
        title="Recent Notes"
        variant="section"
        loading={notesLoading}
        empty={!notesLoading && recentNotes.length === 0}
        emptyText="No notes yet."
        data-testid="lead-notes-card"
      >
        <div className="rounded-md border border-border bg-inset-surface p-3">
          {recentNotes.map((note, index) => {
            const isFirst = index === 0;
            const isLast = index === recentNotes.length - 1;
            const dateStr = (() => { try { return format(parseISO(note.createdAt), "MMM d 'at' h:mm a"); } catch { return "—"; } })();
            const metaParts = [dateStr, note.userFullName].filter(Boolean);
            return (
              <div
                key={note.id}
                className={`flex gap-2.5 py-3${isFirst ? " pt-0" : ""}${isLast ? " pb-0" : ""}${!isFirst ? " border-t border-border" : ""}`}
                data-testid={`lead-note-${note.id}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-brand mt-1.5 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-helper text-muted-foreground">{metaParts.join(" · ")}</p>
                  <p className="text-row text-foreground line-clamp-2">{note.noteText}</p>
                </div>
              </div>
            );
          })}
        </div>
      </WorkspaceSectionCard>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {leadId && (
        <EntityNoteDialog
          entityType="lead"
          entityId={leadId}
          note={null}
          open={addNoteOpen}
          onOpenChange={setAddNoteOpen}
        />
      )}
    </div>
  );
}
