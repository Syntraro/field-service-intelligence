/**
 * EquipmentDetailModal — compact, iPad-friendly equipment detail view.
 *
 * 2026-04-30 redesign: two-section layout matching the design spec —
 *   1. Equipment Details card (manufacturer / model / serial as 3-col
 *      grid with vertical dividers; optional Notes row from
 *      `equipment.notes`).
 *   2. Service History card (read-only flattened rows: date/time +
 *      job#/technician + note text).
 *
 * Header carries the equipment name + type pill on the left and the
 * canonical edit pencil on the right (next to shadcn's built-in close
 * `<X>`). No footer action bar.
 *
 * Data sources (unchanged):
 *   - GET /api/equipment/:equipmentId/history (canonical job_notes SSoT,
 *     returns `HistoryJobGroup[]` with per-note `text`, `createdAt`,
 *     `author`).
 *   - Equipment record (passed in via prop, refreshed in place when the
 *     edit dialog reports a saved record).
 *
 * Edit affordance reuses `AddEquipmentDialog` in `mode="edit"` —
 * unchanged from the previous pass; canonical PATCH endpoint, canonical
 * query invalidation. Per-note edit/delete affordances were removed in
 * this redesign — the same mutations remain reachable on the Job Detail
 * surface via the canonical `EntityNotesSection` / `EntityNoteDialog`.
 *
 * Shared by Job Detail and Location Detail equipment surfaces.
 */
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Wrench, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { LocationEquipment } from "@shared/schema";
// 2026-04-30: edit affordance reuses the canonical AddEquipmentDialog
// in `mode="edit"`. No parallel edit form is created on this surface.
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
// 2026-05-01: capability-based gate. Reads the user's effective
// permission set from the canonical `/api/me/permissions` feed. Returns
// `boolean | undefined` — undefined while loading.
import { useHasPermission } from "@/hooks/useEffectivePermissions";

// ── Types — match the server contract in
//    server/services/equipmentHistory.ts (groupHistoryByJob output) ──

interface HistoryNote {
  id: string;
  text: string;
  createdAt: string | null;
  author: string | null;
}

interface HistoryJobGroup {
  jobId: string;
  jobNumber: number;
  jobDate: string | null;
  notes: HistoryNote[];
}

/** Flattened per-note row for the Service History list. */
interface ServiceRow {
  noteId: string;
  noteText: string;
  /** Per-note timestamp — the canonical "when this service event was
   *  logged". Falls back to the parent job date when the note timestamp
   *  is missing. */
  timestamp: string | null;
  authorName: string | null;
  jobId: string;
  jobNumber: number;
}

interface EquipmentDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: LocationEquipment | null;
  /** When the modal is opened from a job context, this is forwarded to
   *  AddEquipmentDialog so the job-equipment query is also invalidated
   *  on save. */
  jobId?: string;
}

// ── Formatting helpers ──

function formatDateLabel(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTimeLabel(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const VISIBLE_ROW_LIMIT = 5;

export function EquipmentDetailModal({ open, onOpenChange, equipment, jobId }: EquipmentDetailModalProps) {
  if (!equipment) return null;

  const [, setLocation] = useLocation();
  // 2026-05-01: gate the Edit affordance on the canonical fine
  // permission `clients.edit` instead of the role string. Reasons:
  //   - Role-string checks miss platform_admin / impersonating users
  //     and any custom role that isn't one of the four canonical
  //     strings (owner/admin/manager/dispatcher), causing the button
  //     to silently disappear for valid editors in the tech app.
  //   - The canonical permission catalog at
  //     `migrations/2026_04_21_seed_rbac_catalog.sql` does NOT define
  //     an `equipment.*` group; `equipment.update` would always be
  //     false. `clients.edit` is the canonical "modify a client/
  //     location resource" permission and is the closest semantic
  //     match (equipment is a sub-resource of `client_locations`,
  //     reached via PATCH /api/clients/:locationId/equipment/:id).
  //     Owner/admin/manager all hold it (per the role seed); tech
  //     does not — matching the intended behavior matrix.
  //   - `useHasPermission` returns `boolean | undefined`. The strict
  //     `=== true` check defaults to "no permission" while the
  //     permissions feed is still loading — safer than briefly
  //     showing the button to a user who turns out to lack it.
  const canEdit = useHasPermission("clients.edit") === true;

  // 2026-04-30: hold a local copy of the equipment record so the
  // displayed details refresh in place after an in-modal edit. The edit
  // dialog's `onSaved` callback writes here. Re-syncs whenever the
  // parent passes a different equipment id.
  const [localEquipment, setLocalEquipment] = useState<LocationEquipment>(equipment);
  useEffect(() => {
    setLocalEquipment(equipment);
  }, [equipment.id]);
  const eq = localEquipment;

  // 2026-04-30: equipment edit dialog open/close state.
  const [editEquipmentOpen, setEditEquipmentOpen] = useState(false);
  // 2026-04-30: collapsed/expanded state for the service history list.
  const [showAllHistory, setShowAllHistory] = useState(false);

  const history = useQuery<HistoryJobGroup[]>({
    queryKey: ["equipment-history", eq.id],
    queryFn: () => apiRequest(`/api/equipment/${eq.id}/history`),
    enabled: open,
  });

  // Flatten history into one row per note, sorted most-recent first.
  // Falling back to jobDate when the note has no timestamp keeps the
  // sort deterministic for legacy rows that pre-date `note.createdAt`.
  const serviceRows: ServiceRow[] = useMemo(() => {
    const rows: ServiceRow[] = [];
    for (const job of history.data ?? []) {
      for (const n of job.notes) {
        rows.push({
          noteId: n.id,
          noteText: n.text,
          timestamp: n.createdAt ?? job.jobDate,
          authorName: n.author,
          jobId: job.jobId,
          jobNumber: job.jobNumber,
        });
      }
    }
    rows.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    return rows;
  }, [history.data]);

  const visibleRows = showAllHistory
    ? serviceRows
    : serviceRows.slice(0, VISIBLE_ROW_LIMIT);
  const hasMore = serviceRows.length > VISIBLE_ROW_LIMIT;

  const navigateToJob = (jId: string) => {
    onOpenChange(false);
    setLocation(`/jobs/${jId}`);
  };

  // ── Equipment Details fields ──
  // Each column always renders; missing values show an em dash so the
  // 3-up grid stays aligned regardless of which fields are populated.
  const detailColumns: Array<{ label: string; value: string | null }> = [
    { label: "Manufacturer", value: eq.manufacturer ?? null },
    { label: "Model Number", value: eq.modelNumber ?? null },
    { label: "Serial Number", value: eq.serialNumber ?? null },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] max-h-[88vh] flex flex-col p-0 gap-0 bg-card"
        data-testid="equipment-detail-modal"
      >
        {/* ── Header — single-row layout: title (with type inline in
             muted parens) on the left, Edit button on the right, and
             shadcn's built-in close `<X>` floating absolute at
             right-4/top-4 from DialogContent. `pr-12` on the flex row
             reserves clearance so Edit can't crash into `<X>`.
             2026-05-01 layout refinement:
               - separate type pill (mt-1) merged inline with the title
                 ("Furnace (Refrigeration)") to flatten the header from
                 two rows to one
               - Edit moved out of absolute positioning into the flex
                 row so it shares vertical centering with the title
               - py-3 used in place of pt-4 pb-3 for symmetrical, tighter
                 header padding now that the second row is gone */}
        <DialogHeader className="px-6 py-3 border-b border-card-border shrink-0">
          <div className="flex items-center justify-between gap-2 pr-12">
            <DialogTitle className="m-0 leading-tight truncate min-w-0" data-testid="equipment-name">
              {eq.name || "Equipment"}
              {eq.equipmentType && (
                <span
                  // 2026-05-03 typography standardization: inline
                  // equipment type metadata drops from `text-base
                  // font-normal` (19px) to `text-xs` (15.2px) so it
                  // reads as secondary metadata next to the title
                  // rather than competing with the title's weight.
                  className="ml-2 text-xs font-normal text-muted-foreground"
                  data-testid="equipment-type-inline"
                >
                  ({eq.equipmentType})
                </span>
              )}
            </DialogTitle>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 shrink-0 text-muted-foreground hover:text-foreground"
                data-testid="button-edit-equipment"
                onClick={() => setEditEquipmentOpen(true)}
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
          <DialogDescription className="sr-only">Equipment details and service history</DialogDescription>
        </DialogHeader>

        {/* ── Body — scrollable, two stacked section cards.
             2026-04-30 spacing pass: outer py-4 → py-3, gap between
             cards space-y-4 → space-y-3. */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 bg-app-bg">
          {/* ╭ Equipment Details card ───────────────────────────────╮
               Spacing pass: section header h-10 → h-9 (tighter strip);
               grid cells py-3 → py-2.5; notes row py-3 → py-2.5,
               leading-relaxed → leading-snug, label-to-value mb-1 → mb-0.5. */}
          <section
            className="rounded-md border border-card-border bg-card overflow-hidden"
            data-testid="card-equipment-details"
          >
            <div className="flex items-center gap-2 px-4 h-9 border-b border-card-border">
              <Info className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                Equipment Details
              </h3>
            </div>
            {/* 3-column field grid with subtle vertical dividers. Each
                column always shows so the grid stays balanced; absent
                values render as a muted em dash. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 sm:divide-x sm:divide-card-border">
              {detailColumns.map(({ label, value }) => (
                <div key={label} className="px-4 py-2.5" data-testid={`equipment-detail-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted mb-0.5">
                    {label}
                  </div>
                  <div className={cn("text-[14px] font-medium", value ? "text-text-primary" : "text-text-disabled")}>
                    {value || "—"}
                  </div>
                </div>
              ))}
            </div>
            {/* Notes — only rendered when a non-empty equipment.notes
                exists. No type/name duplication: those live in the
                header. */}
            {eq.notes && eq.notes.trim().length > 0 && (
              <div className="border-t border-card-border px-4 py-2.5" data-testid="equipment-notes">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted mb-0.5">
                  Notes
                </div>
                <p className="m-0 text-[14px] leading-snug text-text-primary whitespace-pre-wrap">
                  {eq.notes}
                </p>
              </div>
            )}
          </section>

          {/* ╭ Service History card ─────────────────────────────────╮
               Spacing pass: section header h-10 → h-9; loading/empty
               vertical padding py-10 → py-8 to match the tightened
               body. Row internals tightened in `ServiceHistoryRow`. */}
          <section
            className="rounded-md border border-card-border bg-card overflow-hidden"
            data-testid="card-service-history"
          >
            <div className="flex items-center justify-between gap-2 px-4 h-9 border-b border-card-border">
              <div className="flex items-center gap-2 min-w-0">
                <Wrench className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
                  Service History
                </h3>
                {serviceRows.length > 0 && (
                  <span className="text-[12px] font-medium text-text-muted tabular-nums">
                    {serviceRows.length}
                  </span>
                )}
              </div>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="text-[12px] font-medium text-primary hover:underline focus:outline-none focus:underline"
                  data-testid="button-toggle-history"
                >
                  {showAllHistory ? "Show less" : `View all (${serviceRows.length})`}
                </button>
              )}
            </div>

            {history.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              </div>
            ) : serviceRows.length === 0 ? (
              // Empty state ONLY when there are zero records — never
              // shown alongside populated rows.
              <div className="px-4 py-8 text-center" data-testid="service-history-empty">
                <div className="text-[14px] font-medium text-text-primary">No service history yet</div>
                <div className="text-[12px] text-text-muted mt-1">
                  This equipment doesn't have any service history.
                </div>
              </div>
            ) : (
              <div className="divide-y divide-card-border" data-testid="service-history-rows">
                {visibleRows.map((row) => (
                  <ServiceHistoryRow
                    key={row.noteId}
                    row={row}
                    onJobClick={() => navigateToJob(row.jobId)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>

      {/* 2026-04-30: canonical edit surface. Reuses AddEquipmentDialog
          in `mode="edit"`, prefilled from the current equipment record.
          On save:
            - Server PATCHes /api/clients/:locationId/equipment/:id
            - Both ["/api/clients", locationId, "equipment"] and
              ["/api/jobs", jobId, "equipment"] (when this modal was
              opened from a job context) are invalidated by the dialog.
            - The dialog closes and `onSaved` updates the local copy so
              the detail modal stays open with fresh values. */}
      <AddEquipmentDialog
        mode="edit"
        existingEquipment={eq}
        locationId={eq.locationId}
        jobId={jobId}
        open={editEquipmentOpen}
        onOpenChange={setEditEquipmentOpen}
        onSaved={(updated) => setLocalEquipment(updated)}
      />
    </Dialog>
  );
}

// ── Single service-history row ───────────────────────────────────────

function ServiceHistoryRow({
  row,
  onJobClick,
}: {
  row: ServiceRow;
  onJobClick: () => void;
}) {
  const dateLabel = formatDateLabel(row.timestamp);
  const timeLabel = formatTimeLabel(row.timestamp);

  // 2026-04-30 spacing pass: row outer py-3 → py-2; column gap
  // gap-x-4 → gap-x-3; stacked-line gap mt-0.5 (kept) reads tight at
  // text-[13px]/text-[12px]; note text leading-relaxed → leading-snug.
  return (
    <div
      className="px-4 py-2 grid grid-cols-1 sm:grid-cols-[120px_minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-0.5 sm:gap-y-0 items-start"
      data-testid={`service-row-${row.noteId}`}
    >
      {/* Date + time stacked */}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-text-primary tabular-nums leading-tight">
          {dateLabel || <span className="text-text-disabled">—</span>}
        </div>
        {timeLabel && (
          <div className="text-[12px] text-text-muted tabular-nums leading-tight mt-0.5">
            {timeLabel}
          </div>
        )}
      </div>

      {/* Job # + technician stacked */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={onJobClick}
          className="text-[13px] font-semibold text-primary hover:underline focus:outline-none focus:underline truncate text-left leading-tight"
          data-testid={`service-row-job-link-${row.noteId}`}
        >
          J-{row.jobNumber}
        </button>
        <div className="text-[12px] text-text-muted truncate leading-tight mt-0.5">
          {row.authorName || "Unknown"}
        </div>
      </div>

      {/* Note / summary — wraps freely on narrow widths */}
      <div className="min-w-0 text-[13px] text-text-primary leading-snug whitespace-pre-wrap">
        {row.noteText}
      </div>
    </div>
  );
}
