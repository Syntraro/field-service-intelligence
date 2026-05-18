/**
 * ShiftManagementPage — Phase 3 Shift Management UI.
 *
 * Feature-gated by technician_shift_management entitlement.
 * Shows a weekly grid of technician shifts (Work / On Call / Unavailable).
 * Dispatchers and managers can create, edit, and delete shifts.
 *
 * Architecture invariants:
 *  - Frontend never computes recurrence or availability.
 *  - Resolved shifts come from GET /api/shift-management/availability.
 *  - All CRUD goes through /api/shift-management/shifts.
 *  - Time-off terminology replaced by "Unavailable" in all UI labels.
 */
import { useState, useMemo } from "react";
import { startOfWeek, addWeeks, addDays, format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConfirmModal,
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { apiRequest } from "@/lib/queryClient";
import { shiftKeys } from "@/lib/queryKeys";
import type { DispatchShiftEntry } from "@/components/dispatch/dispatchPreviewTypes";
import TechnicianScheduleGrid from "@/components/shift-management/TechnicianScheduleGrid";
import ShiftFormModal from "@/components/shift-management/ShiftFormModal";

type DeleteScope = "occurrence" | "future" | "series";

const DELETE_SCOPE_OPTIONS: { value: DeleteScope; label: string; description: string }[] = [
  { value: "occurrence", label: "This shift only", description: "Cancel just this occurrence; the series continues." },
  { value: "future", label: "This and future shifts", description: "Remove this occurrence and all following ones." },
  { value: "series", label: "Entire repeating schedule", description: "Delete all occurrences permanently." },
];

// ── Feature-disabled state ───────────────────────────────────────────

function FeatureDisabledState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-24 text-center"
      data-testid="shift-management-disabled"
    >
      <CalendarRange className="h-10 w-10 text-slate-300" />
      <div>
        <p className="font-medium text-slate-700">Shift Management is not available</p>
        <p className="text-helper text-muted-foreground mt-1">
          Upgrade your plan to manage technician schedules and availability.
        </p>
      </div>
    </div>
  );
}

// ── Delete scope modal for recurring shifts ──────────────────────────

interface DeleteShiftScopeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: DispatchShiftEntry;
  isPending: boolean;
  deleteScope: DeleteScope;
  onScopeChange: (scope: DeleteScope) => void;
  onConfirm: () => void;
}

function DeleteShiftScopeModal({
  open,
  onOpenChange,
  shift,
  isPending,
  deleteScope,
  onScopeChange,
  onConfirm,
}: DeleteShiftScopeModalProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-md"
      data-testid="delete-shift-scope-modal"
    >
      <ModalHeader>
        <ModalTitle>Delete recurring shift?</ModalTitle>
        <ModalDescription>
          This is a recurring shift. Choose which occurrences to remove — deleting all occurrences cannot be undone.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-3">
        <div role="radiogroup" aria-label="Delete scope" data-testid="delete-scope-group" className="flex flex-col gap-2">
          {DELETE_SCOPE_OPTIONS.map(({ value, label, description }) => (
            <label key={value} className="flex items-start gap-2 cursor-pointer rounded border border-slate-200 p-3 hover:border-slate-300">
              <input
                type="radio"
                name="delete-scope"
                value={value}
                checked={deleteScope === value}
                onChange={() => onScopeChange(value)}
                disabled={isPending}
                data-testid={`delete-scope-${value}`}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-helper font-medium">{label}</span>
                <span className="text-helper text-muted-foreground">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </ModalSecondaryAction>
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={onConfirm}
          data-testid="delete-shift-scope-confirm"
        >
          {isPending ? "Deleting…" : "Delete"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}

// ── Main page ────────────────────────────────────────────────────────

export default function ShiftManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEnabled = useFeatureEnabled("technician_shift_management");

  // Week navigation — start on Monday
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const weekEnd = addDays(weekStart, 6);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editShift, setEditShift] = useState<DispatchShiftEntry | null>(null);
  const [defaultTechId, setDefaultTechId] = useState<string | undefined>();
  const [defaultDate, setDefaultDate] = useState<string | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<DispatchShiftEntry | null>(null);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>("occurrence");

  // Technician directory
  const { teamMembers, isLoading: techLoading } = useTechniciansDirectory();
  const technicians = useMemo(
    () =>
      teamMembers
        .filter((m) => m.isSchedulable !== false)
        .map((m) => ({ id: m.id, fullName: m.fullName, color: m.color })),
    [teamMembers],
  );

  // Shift data for the visible week
  const startISO = weekStart.toISOString();
  const endISO = addDays(weekEnd, 1).toISOString(); // exclusive end

  const shiftsQuery = useQuery<{ shifts: DispatchShiftEntry[]; timezone: string }>({
    queryKey: shiftKeys.availability(startISO, endISO),
    queryFn: () =>
      apiRequest(`/api/shift-management/availability?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`),
    staleTime: 30_000,
    enabled: isEnabled === true,
  });

  const shifts = shiftsQuery.data?.shifts ?? [];
  const timezone = shiftsQuery.data?.timezone;

  // Delete entire series (hard delete base)
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/shift-management/shifts/${id}`, {
        method: "DELETE",
        credentials: "include",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete shift", description: err.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  // Cancel a single occurrence (POST exception with isCancelled: true)
  const cancelOccurrenceMutation = useMutation({
    mutationFn: ({ baseShiftId, occurrenceDate }: { baseShiftId: string; occurrenceDate: string }) =>
      apiRequest(`/api/shift-management/shifts/${baseShiftId}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ occurrenceDate, isCancelled: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Shift occurrence cancelled" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to cancel occurrence", description: err.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  // Truncate series: PATCH base recurrenceEndDate to day before occurrenceDate
  const truncateSeriesMutation = useMutation({
    mutationFn: ({ baseShiftId, occurrenceDate }: { baseShiftId: string; occurrenceDate: string }) => {
      const d = new Date(occurrenceDate + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      const endDate = d.toISOString().slice(0, 10);
      return apiRequest(`/api/shift-management/shifts/${baseShiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recurrenceEndDate: endDate }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      toast({ title: "Future occurrences removed" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update shift", description: err.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const isDeletePending =
    deleteMutation.isPending ||
    cancelOccurrenceMutation.isPending ||
    truncateSeriesMutation.isPending;

  // ── Handlers ──────────────────────────────────────────────────────

  function handleAddShift(techId?: string, date?: string) {
    setEditShift(null);
    setDefaultTechId(techId);
    setDefaultDate(date);
    setFormOpen(true);
  }

  function handleEditShift(shift: DispatchShiftEntry) {
    setEditShift(shift);
    setDefaultTechId(undefined);
    setDefaultDate(undefined);
    setFormOpen(true);
  }

  function handleDeleteShift(shift: DispatchShiftEntry) {
    setDeleteTarget(shift);
    setDeleteScope("occurrence");
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.occurrenceDate) {
      // Recurring occurrence: branch by scope
      if (deleteScope === "occurrence") {
        cancelOccurrenceMutation.mutate({
          baseShiftId: deleteTarget.baseShiftId,
          occurrenceDate: deleteTarget.occurrenceDate,
        });
      } else if (deleteScope === "future") {
        truncateSeriesMutation.mutate({
          baseShiftId: deleteTarget.baseShiftId,
          occurrenceDate: deleteTarget.occurrenceDate,
        });
      } else if (deleteScope === "series") {
        deleteMutation.mutate(deleteTarget.baseShiftId);
      }
    } else {
      // Non-recurring: always hard delete
      deleteMutation.mutate(deleteTarget.baseShiftId);
    }
  }

  // ── Loading / disabled states ─────────────────────────────────────

  if (isEnabled === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEnabled === false) {
    return (
      <div className="flex flex-col gap-0 h-full">
        <PageHeader onAdd={() => handleAddShift()} addDisabled />
        <FeatureDisabledState />
      </div>
    );
  }

  const isLoading = techLoading || shiftsQuery.isLoading;

  return (
    <div className="flex flex-col gap-0 h-full" data-testid="shift-management-page">
      <PageHeader onAdd={() => handleAddShift()} />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TechnicianScheduleGrid
            weekStart={weekStart}
            technicians={technicians}
            shifts={shifts}
            onPrevWeek={() => setWeekStart((w) => addWeeks(w, -1))}
            onNextWeek={() => setWeekStart((w) => addWeeks(w, 1))}
            onAddShift={handleAddShift}
            onEditShift={handleEditShift}
            onDeleteShift={handleDeleteShift}
            timezone={timezone}
          />
        )}
      </div>

      {/* Create / Edit modal */}
      <ShiftFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editShift={editShift}
        technicians={technicians}
        defaultTechnicianId={defaultTechId}
        defaultDate={defaultDate}
        timezone={timezone}
      />

      {/* Delete confirmation — non-recurring shifts */}
      <ConfirmModal
        open={!!deleteTarget && !deleteTarget.occurrenceDate}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete shift?"
        description="This shift will be permanently deleted."
        emphasis="This action cannot be undone."
        confirmLabel="Delete shift"
        variant="destructive"
        isPending={isDeletePending}
        onConfirm={confirmDelete}
        testIdPrefix="delete-shift"
      />

      {/* Delete scope modal — recurring shift occurrences */}
      {deleteTarget?.occurrenceDate && (
        <DeleteShiftScopeModal
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          shift={deleteTarget}
          isPending={isDeletePending}
          deleteScope={deleteScope}
          onScopeChange={setDeleteScope}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

// ── Page header ──────────────────────────────────────────────────────

interface PageHeaderProps {
  onAdd: () => void;
  addDisabled?: boolean;
}

function PageHeader({ onAdd, addDisabled }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-5 w-5 text-slate-500" />
        <h1 className="text-header font-semibold text-slate-900">Shift Management</h1>
      </div>
      <Button
        size="sm"
        onClick={onAdd}
        disabled={addDisabled}
        data-testid="add-shift-button"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add shift
      </Button>
    </div>
  );
}
