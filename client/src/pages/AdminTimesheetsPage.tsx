/**
 * Daily Timesheet Page — Day-level detail/edit layer for payroll.
 *
 * Shows chronological time entries for a selected technician on a selected date.
 * Accessed via day-cell drill-in from PayrollPage or direct navigation.
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO, addDays, subDays } from "date-fns";
import { useSearch, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  Lock,
  Briefcase,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import { TimeEntryModal, type TimeEntryForModal } from "@/components/time";
import type { TimeEntryType } from "@shared/schema";

const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

const TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  travel_to_job: { label: "Travel", color: "bg-blue-100 text-blue-700" },
  on_site: { label: "On Site", color: "bg-green-100 text-green-700" },
  travel_to_supplier: { label: "To Supplier", color: "bg-purple-100 text-purple-700" },
  supplier_run: { label: "Parts Pickup", color: "bg-purple-100 text-purple-700" },
  travel_between_jobs: { label: "Between Jobs", color: "bg-blue-50 text-blue-600" },
  admin: { label: "Admin", color: "bg-orange-100 text-orange-700" },
  break: { label: "Break", color: "bg-gray-100 text-gray-600" },
  other: { label: "Other", color: "bg-gray-100 text-gray-600" },
};

function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0:00";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

function formatTime(date: string | Date | null): string {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "h:mm a");
}

interface TimesheetDayEntry {
  id: string;
  technicianId: string;
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  jobType: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  lockedAt: string | null;
  lockedByInvoiceId: string | null;
  lockReason: string | null;
  invoiceId: string | null;
}

interface TimesheetDayResponse {
  date: string;
  userId: string;
  entries: TimesheetDayEntry[];
  totalMinutes: number;
}

interface TimesheetUser {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

const QK_DAY = "/api/admin/timesheets/day";
const QK_USERS = "/api/admin/timesheets/users";

export default function DailyTimesheetPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const [selectedUserId, setSelectedUserId] = useState<string>(params.get("userId") || "");
  const [selectedDate, setSelectedDate] = useState<string>(
    params.get("date") || format(new Date(), "yyyy-MM-dd")
  );

  // Entry modal state
  const [entryModal, setEntryModal] = useState<{
    open: boolean;
    mode: "create" | "edit";
    entry: TimeEntryForModal | null;
    jobId: string | null;
  }>({ open: false, mode: "create", entry: null, jobId: null });

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  const isManager = !!(user && MANAGER_ROLES.includes(user.role));

  // Fetch available users
  const { data: users = [] } = useQuery<TimesheetUser[]>({
    queryKey: [QK_USERS],
    queryFn: async () => {
      const res = await fetch("/api/admin/timesheets/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isManager,
  });

  if (!selectedUserId && users.length > 0) {
    setSelectedUserId(users[0].id);
  }

  // Fetch day data
  const { data: dayData, isLoading: dayLoading } = useQuery<TimesheetDayResponse>({
    queryKey: [QK_DAY, { userId: selectedUserId, date: selectedDate }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/timesheets/day?userId=${selectedUserId}&date=${selectedDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch day data");
      return res.json();
    },
    enabled: isManager && !!selectedUserId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (entryId: string) => {
      return apiRequest(`/api/admin/timesheets/entries/${entryId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Entry Deleted", description: "Time entry removed." });
      queryClient.invalidateQueries({ queryKey: [QK_DAY] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/weekly"] });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const goToPreviousDay = () => setSelectedDate(format(subDays(parseISO(selectedDate), 1), "yyyy-MM-dd"));
  const goToNextDay = () => setSelectedDate(format(addDays(parseISO(selectedDate), 1), "yyyy-MM-dd"));
  const goToToday = () => setSelectedDate(format(new Date(), "yyyy-MM-dd"));

  // Open create modal directly — no job picker
  const openAddEntry = useCallback(() => {
    setEntryModal({ open: true, mode: "create", entry: null, jobId: null });
  }, []);

  // Open edit modal
  const openEditEntry = useCallback((entry: TimesheetDayEntry) => {
    const modalEntry: TimeEntryForModal = {
      id: entry.id,
      technicianId: entry.technicianId,
      technicianName: null,
      type: entry.type as TimeEntryType,
      startAt: entry.startAt,
      endAt: entry.endAt,
      durationMinutes: entry.durationMinutes,
      billable: entry.billable,
      billableRateSnapshot: null,
      costRateSnapshot: null,
      notes: entry.notes,
      invoiceId: entry.invoiceId,
      invoicedAt: null,
      lockedAt: entry.lockedAt,
      lockedByInvoiceId: entry.lockedByInvoiceId,
      lockReason: entry.lockReason,
    };
    setEntryModal({ open: true, mode: "edit", entry: modalEntry, jobId: entry.jobId });
  }, []);

  const isEntryLocked = useCallback(
    (entry: TimesheetDayEntry) => !!(entry.lockedAt || entry.lockedByInvoiceId || entry.invoiceId),
    []
  );

  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">Only managers can access timesheets.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="daily-timesheet-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/settings/payroll")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Payroll
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Daily Timesheet</h1>
        </div>
        <Button size="sm" onClick={openAddEntry} disabled={!selectedUserId}>
          <Plus className="h-4 w-4 mr-1" />
          Add Entry
        </Button>
      </div>

      {/* Controls: User selector + Date navigation */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-[200px] h-8 text-sm">
                  <SelectValue placeholder="Select technician" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 min-w-[140px] justify-center">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">
                  {format(parseISO(selectedDate), "EEE, MMM d, yyyy")}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextDay}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToToday}>
                Today
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Day Summary */}
      {dayData && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-mono font-medium">{formatMinutes(dayData.totalMinutes)}</span>
          <span className="text-muted-foreground">
            ({dayData.entries.length} {dayData.entries.length === 1 ? "entry" : "entries"})
          </span>
        </div>
      )}

      {/* Entry List */}
      <Card>
        <CardContent className="py-2">
          {!selectedUserId ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Select a technician to view their timesheet.</p>
            </div>
          ) : dayLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !dayData || dayData.entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No time entries for this day.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={openAddEntry}>
                <Plus className="h-3 w-3 mr-1" />
                Add Entry
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {dayData.entries.map((entry) => {
                const typeInfo = TYPE_DISPLAY[entry.type] ?? TYPE_DISPLAY.other;
                const locked = isEntryLocked(entry);

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-start gap-3 py-3 px-1 group",
                      locked && "opacity-70"
                    )}
                  >
                    {/* Time column */}
                    <div className="w-[100px] shrink-0 text-xs font-mono text-muted-foreground">
                      <div>{formatTime(entry.startAt)}</div>
                      <div>{formatTime(entry.endAt)}</div>
                    </div>

                    {/* Type badge */}
                    <Badge variant="outline" className={cn("text-[10px] shrink-0 mt-0.5", typeInfo.color)}>
                      {typeInfo.label}
                    </Badge>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {entry.jobId ? (
                          <span className="text-xs font-medium text-foreground">
                            <Briefcase className="inline h-3 w-3 mr-0.5 text-muted-foreground" />
                            #{entry.jobNumber} {entry.jobSummary}
                            {entry.locationName && (
                              <span className="text-muted-foreground font-normal ml-1">
                                ({entry.locationName})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No job linked</span>
                        )}
                        {locked && (
                          <span title="Locked / Invoiced"><Lock className="h-3 w-3 text-amber-500 shrink-0" /></span>
                        )}
                      </div>
                      {entry.notes && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{entry.notes}</p>
                      )}
                    </div>

                    {/* Duration */}
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono font-medium">
                        {entry.durationMinutes != null ? formatMinutes(entry.durationMinutes) : (
                          <span className="text-green-600 animate-pulse">Running</span>
                        )}
                      </div>
                      {!entry.billable && (
                        <span className="text-[9px] text-muted-foreground">non-billable</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEditEntry(entry)}
                        title="Edit entry"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() =>
                            setDeleteTarget({
                              id: entry.id,
                              label: `${typeInfo.label} ${entry.durationMinutes ? formatMinutes(entry.durationMinutes) : ""}`,
                            })
                          }
                          title="Delete entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time Entry Modal */}
      <TimeEntryModal
        open={entryModal.open}
        onOpenChange={(open) => setEntryModal((prev) => ({ ...prev, open }))}
        jobId={entryModal.jobId}
        mode={entryModal.mode}
        entry={entryModal.entry}
        extraInvalidateKeys={[[QK_DAY], ["/api/payroll/weekly"]]}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: [QK_DAY] });
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this entry ({deleteTarget?.label})? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
