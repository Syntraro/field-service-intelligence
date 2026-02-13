/**
 * AdminTimesheetsPage — Jobber-style admin timesheet management.
 *
 * Day view: entries grouped by Job/Visit with Travel/Work sub-rows.
 * Week view: grid totals per job per day.
 * Edit modal: start/end, type (Travel/Work), reassign, notes.
 * Add Time: manual entry creation.
 * Delete: confirmation dialog.
 *
 * Reads the same time_entries table written by the tech field app.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, addDays, parseISO } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  CalendarDays,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

interface StaffUser {
  id: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

interface TimeEntryRow {
  id: string;
  companyId: string;
  technicianId: string;
  jobId: string | null;
  type: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  billable: boolean;
  notes: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  jobType: string | null;
  locationId: string | null;
}

interface DayGroup {
  jobId: string | null;
  jobNumber: number | null;
  jobSummary: string | null;
  jobType: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  entries: TimeEntryRow[];
  travelMinutes: number;
  workMinutes: number;
  totalMinutes: number;
}

interface DayResponse {
  date: string;
  userId: string;
  groups: DayGroup[];
  totals: { totalMinutes: number; travelMinutes: number; workMinutes: number; otherMinutes: number };
}

interface WeekRow {
  jobId: string | null;
  label: string;
  days: Record<number, number>;
  weekTotal: number;
}

interface WeekResponse {
  weekStart: string;
  userId: string;
  dayLabels: string[];
  rows: WeekRow[];
  dayTotals: Record<number, number>;
  weekGrandTotal: number;
}

interface ReassignOption {
  visitId: string;
  jobId: string;
  jobNumber: number;
  jobSummary: string;
  locationName: string | null;
  label: string;
  sameDay: boolean;
}

// ============================================================================
// Helpers — NO internal enum names in UI
// ============================================================================

const TYPE_LABEL: Record<string, string> = {
  travel_to_job: "Travel",
  on_site: "Work",
  travel_to_supplier: "Travel",
  supplier_run: "Supplier",
  travel_between_jobs: "Travel",
  admin: "Admin",
  break: "Break",
  other: "Other",
};

const TYPE_COLOR: Record<string, string> = {
  travel_to_job: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  travel_between_jobs: "bg-amber-100 text-amber-800",
  travel_to_supplier: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  break: "bg-gray-100 text-gray-600",
  other: "bg-gray-100 text-gray-600",
};

function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? "Other";
}

function fmtMins(m: number | null | undefined): string {
  if (!m) return "0:00";
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${h}:${mins.toString().padStart(2, "0")}`;
}

function dateToInput(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getMonday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

function userName(u: StaffUser): string {
  return u.firstName ? `${u.firstName} ${u.lastName ?? ""}`.trim() : u.email;
}

// ============================================================================
// Main component
// ============================================================================

export default function AdminTimesheetsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedUserId, setSelectedUserId] = useState("");

  // Modals
  const [editEntry, setEditEntry] = useState<TimeEntryRow | null>(null);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [showAddTime, setShowAddTime] = useState(false);

  // Edit form
  const [editStartAt, setEditStartAt] = useState("");
  const [editEndAt, setEditEndAt] = useState("");
  const [editType, setEditType] = useState("");
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [reassignSearch, setReassignSearch] = useState("");

  // Add Time form
  const [addType, setAddType] = useState("on_site");
  const [addJobId, setAddJobId] = useState("");
  const [addStartAt, setAddStartAt] = useState("");
  const [addEndAt, setAddEndAt] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addSearch, setAddSearch] = useState("");

  const dateStr = dateToInput(selectedDate);
  const weekStartStr = dateToInput(getMonday(selectedDate));

  // ── Queries ──

  const { data: staffUsers = [] } = useQuery<StaffUser[]>({
    queryKey: ["/api/admin/timesheets/users"],
  });

  if (!selectedUserId && staffUsers.length > 0) {
    setSelectedUserId(staffUsers[0].id);
  }

  const { data: dayData, isLoading: dayLoading } = useQuery<DayResponse>({
    queryKey: ["/api/admin/timesheets/day", { userId: selectedUserId, date: dateStr }],
    queryFn: () => apiRequest(`/api/admin/timesheets/day?userId=${selectedUserId}&date=${dateStr}`),
    enabled: viewMode === "day" && !!selectedUserId,
  });

  const { data: weekData, isLoading: weekLoading } = useQuery<WeekResponse>({
    queryKey: ["/api/admin/timesheets/week", { userId: selectedUserId, weekStart: weekStartStr }],
    queryFn: () => apiRequest(`/api/admin/timesheets/week?userId=${selectedUserId}&weekStart=${weekStartStr}`),
    enabled: viewMode === "week" && !!selectedUserId,
  });

  // Reassign options — for edit modal
  const reassignSearchParam = reassignSearch ? `&search=${encodeURIComponent(reassignSearch)}` : "";
  const { data: reassignOpts = [] } = useQuery<ReassignOption[]>({
    queryKey: ["/api/admin/timesheets/visits-for-reassign", selectedUserId, dateStr, reassignSearch],
    queryFn: () =>
      apiRequest(`/api/admin/timesheets/visits-for-reassign?userId=${selectedUserId}&date=${dateStr}${reassignSearchParam}`),
    enabled: !!editEntry,
  });

  // Job options — for Add Time modal (same endpoint, different search)
  const addSearchParam = addSearch ? `&search=${encodeURIComponent(addSearch)}` : "";
  const { data: addJobOpts = [] } = useQuery<ReassignOption[]>({
    queryKey: ["/api/admin/timesheets/visits-for-reassign", selectedUserId, dateStr, addSearch, "add"],
    queryFn: () =>
      apiRequest(`/api/admin/timesheets/visits-for-reassign?userId=${selectedUserId}&date=${dateStr}${addSearchParam}`),
    enabled: showAddTime && !!selectedUserId,
  });

  // ── Mutations ──

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/timesheets/day"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/timesheets/week"] });
  };

  const editMutation = useMutation({
    mutationFn: (p: { id: string; body: Record<string, unknown> }) =>
      apiRequest(`/api/admin/timesheets/entries/${p.id}`, { method: "PATCH", body: JSON.stringify(p.body) }),
    onSuccess: () => { toast({ title: "Time entry updated" }); setEditEntry(null); invalidateAll(); },
    onError: (e: any) => { toast({ variant: "destructive", title: "Update failed", description: e.message }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/admin/timesheets/entries/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Time entry deleted" }); setDeleteEntryId(null); invalidateAll(); },
    onError: (e: any) => { toast({ variant: "destructive", title: "Delete failed", description: e.message }); },
  });

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("/api/admin/timesheets/entries", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Time entry created" });
      setShowAddTime(false);
      resetAddForm();
      invalidateAll();
    },
    onError: (e: any) => { toast({ variant: "destructive", title: "Create failed", description: e.message }); },
  });

  // ── Handlers ──

  const openEdit = (entry: TimeEntryRow) => {
    setEditEntry(entry);
    setEditStartAt(entry.startAt ? new Date(entry.startAt).toISOString().slice(0, 16) : "");
    setEditEndAt(entry.endAt ? new Date(entry.endAt).toISOString().slice(0, 16) : "");
    setEditType(entry.type);
    setEditJobId(entry.jobId);
    setEditNotes(entry.notes ?? "");
    setReassignSearch("");
  };

  const handleSaveEdit = () => {
    if (!editEntry) return;
    const body: Record<string, unknown> = {};
    const origS = editEntry.startAt ? new Date(editEntry.startAt).toISOString().slice(0, 16) : "";
    const origE = editEntry.endAt ? new Date(editEntry.endAt).toISOString().slice(0, 16) : "";
    if (editStartAt && editStartAt !== origS) body.startAt = new Date(editStartAt).toISOString();
    if (editEndAt !== origE) body.endAt = editEndAt ? new Date(editEndAt).toISOString() : null;
    if (editType !== editEntry.type) body.type = editType;
    if (editJobId !== editEntry.jobId) body.jobId = editJobId;
    if (editNotes !== (editEntry.notes ?? "")) body.notes = editNotes || null;
    if (Object.keys(body).length === 0) { setEditEntry(null); return; }
    editMutation.mutate({ id: editEntry.id, body });
  };

  const resetAddForm = () => {
    setAddType("on_site"); setAddJobId(""); setAddStartAt(""); setAddEndAt(""); setAddNotes(""); setAddSearch("");
  };

  const openAddTime = () => {
    resetAddForm();
    // Pre-fill start as current date 8:00 AM
    const d = new Date(selectedDate);
    d.setHours(8, 0, 0, 0);
    setAddStartAt(d.toISOString().slice(0, 16));
    d.setHours(9, 0, 0, 0);
    setAddEndAt(d.toISOString().slice(0, 16));
    setShowAddTime(true);
  };

  const handleAddTime = () => {
    if (!addJobId || !addStartAt || !addEndAt) {
      toast({ variant: "destructive", title: "Missing fields", description: "Job, start, and end times are required." });
      return;
    }
    const s = new Date(addStartAt);
    const e = new Date(addEndAt);
    if (e <= s) {
      toast({ variant: "destructive", title: "Invalid times", description: "End must be after start." });
      return;
    }
    addMutation.mutate({
      technicianId: selectedUserId,
      jobId: addJobId,
      type: addType,
      startAt: s.toISOString(),
      endAt: e.toISOString(),
      notes: addNotes || null,
    });
  };

  const navigateDate = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + (viewMode === "week" ? delta * 7 : delta));
    setSelectedDate(d);
  };

  const editDuration = useMemo(() => {
    if (!editStartAt || !editEndAt) return null;
    const ms = new Date(editEndAt).getTime() - new Date(editStartAt).getTime();
    return ms > 0 ? Math.round(ms / 60000) : null;
  }, [editStartAt, editEndAt]);

  const addDuration = useMemo(() => {
    if (!addStartAt || !addEndAt) return null;
    const ms = new Date(addEndAt).getTime() - new Date(addStartAt).getTime();
    return ms > 0 ? Math.round(ms / 60000) : null;
  }, [addStartAt, addEndAt]);

  const selUser = staffUsers.find((u) => u.id === selectedUserId);

  // Partition reassign options into same-day and others
  const sameDayOpts = reassignOpts.filter((o) => o.sameDay);
  const otherDayOpts = reassignOpts.filter((o) => !o.sameDay);

  // Same for add modal
  const addSameDayOpts = addJobOpts.filter((o) => o.sameDay);
  const addOtherDayOpts = addJobOpts.filter((o) => !o.sameDay);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Timesheets</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select user">{selUser ? userName(selUser) : "Select user"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {staffUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {userName(u)} <span className="ml-2 text-xs text-muted-foreground capitalize">({u.role})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "day" | "week")}>
            <TabsList>
              <TabsTrigger value="day" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Day</TabsTrigger>
              <TabsTrigger value="week" className="gap-1.5"><Clock className="h-3.5 w-3.5" />Week</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Date nav + Add Time */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="icon" onClick={() => navigateDate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={dateStr}
          onChange={(e) => setSelectedDate(new Date(e.target.value + "T12:00:00"))}
          className="w-auto"
        />
        <Button variant="outline" size="icon" onClick={() => navigateDate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>Today</Button>
        <span className="text-sm text-muted-foreground ml-1">
          {viewMode === "day"
            ? format(selectedDate, "EEEE, MMMM d, yyyy")
            : `Week of ${format(getMonday(selectedDate), "MMM d")} \u2013 ${format(addDays(getMonday(selectedDate), 6), "MMM d, yyyy")}`}
        </span>
        <div className="ml-auto">
          {viewMode === "day" && selectedUserId && (
            <Button size="sm" className="gap-1.5" onClick={openAddTime}>
              <Plus className="h-3.5 w-3.5" /> Add Time
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {!selectedUserId ? (
        <p className="text-sm text-muted-foreground text-center py-8">Select a user to view timesheets</p>
      ) : viewMode === "day" ? (
        <DayView data={dayData} isLoading={dayLoading} onEdit={openEdit} onDelete={(id) => setDeleteEntryId(id)} />
      ) : (
        <WeekView data={weekData} isLoading={weekLoading} />
      )}

      {/* ── Edit Modal ── */}
      <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Time Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="datetime-local" value={editStartAt} onChange={(e) => setEditStartAt(e.target.value)} /></div>
              <div><Label>End</Label><Input type="datetime-local" value={editEndAt} onChange={(e) => setEditEndAt(e.target.value)} /></div>
            </div>
            {editDuration != null && <p className="text-xs text-muted-foreground">Duration: {fmtMins(editDuration)}</p>}
            <div>
              <Label>Type</Label>
              <Select value={editType} onValueChange={setEditType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="travel_to_job">Travel</SelectItem>
                  <SelectItem value="on_site">Work</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reassign to Job</Label>
              <div className="relative mb-1">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search jobs..."
                  value={reassignSearch}
                  onChange={(e) => setReassignSearch(e.target.value)}
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <Select value={editJobId ?? "__none__"} onValueChange={(v) => setEditJobId(v === "__none__" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {sameDayOpts.length > 0 && <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Same Day</div>}
                  {sameDayOpts.map((o) => <SelectItem key={o.jobId + o.visitId} value={o.jobId}>{o.label}</SelectItem>)}
                  {otherDayOpts.length > 0 && <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Recent</div>}
                  {otherDayOpts.map((o) => <SelectItem key={o.jobId + o.visitId} value={o.jobId}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Note</Label><Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional note..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={editMutation.isPending}>
              {editMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Time Modal ── */}
      <Dialog open={showAddTime} onOpenChange={(o) => { if (!o) setShowAddTime(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Time Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User</Label>
              <Input value={selUser ? userName(selUser) : ""} disabled className="bg-muted" />
            </div>
            <div>
              <Label>Job <span className="text-destructive">*</span></Label>
              <div className="relative mb-1">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search jobs..." value={addSearch} onChange={(e) => setAddSearch(e.target.value)} className="pl-7 h-8 text-xs" />
              </div>
              <Select value={addJobId} onValueChange={setAddJobId}>
                <SelectTrigger><SelectValue placeholder="Select a job..." /></SelectTrigger>
                <SelectContent>
                  {addSameDayOpts.length > 0 && <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Same Day</div>}
                  {addSameDayOpts.map((o) => <SelectItem key={o.jobId + o.visitId} value={o.jobId}>{o.label}</SelectItem>)}
                  {addOtherDayOpts.length > 0 && <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Recent</div>}
                  {addOtherDayOpts.map((o) => <SelectItem key={o.jobId + o.visitId} value={o.jobId}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={addType} onValueChange={setAddType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="travel_to_job">Travel</SelectItem>
                  <SelectItem value="on_site">Work</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start <span className="text-destructive">*</span></Label><Input type="datetime-local" value={addStartAt} onChange={(e) => setAddStartAt(e.target.value)} /></div>
              <div><Label>End <span className="text-destructive">*</span></Label><Input type="datetime-local" value={addEndAt} onChange={(e) => setAddEndAt(e.target.value)} /></div>
            </div>
            {addDuration != null && <p className="text-xs text-muted-foreground">Duration: {fmtMins(addDuration)}</p>}
            <div><Label>Note</Label><Textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Optional note..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAddTime(false)}>Cancel</Button>
            <Button onClick={handleAddTime} disabled={addMutation.isPending}>
              {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deleteEntryId} onOpenChange={(o) => !o && setDeleteEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time entry?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this time entry. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteEntryId && deleteMutation.mutate(deleteEntryId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Day View — grouped by Job
// ============================================================================

function DayView({
  data,
  isLoading,
  onEdit,
  onDelete,
}: {
  data?: DayResponse;
  isLoading: boolean;
  onEdit: (e: TimeEntryRow) => void;
  onDelete: (id: string) => void;
}) {
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const groups = data?.groups ?? [];
  const hasEntries = groups.some((g) => g.entries.length > 0);

  if (!data || !hasEntries) {
    return <div className="text-center py-12 text-sm text-muted-foreground">No time entries for this date.</div>;
  }

  const t = data.totals;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm border rounded-lg px-4 py-2.5 bg-muted/30">
        <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold">{fmtMins(t.totalMinutes)}</span></div>
        <div><span className="text-muted-foreground">Work:</span> <span className="font-medium text-green-700 dark:text-green-400">{fmtMins(t.workMinutes)}</span></div>
        <div><span className="text-muted-foreground">Travel:</span> <span className="font-medium text-amber-700 dark:text-amber-400">{fmtMins(t.travelMinutes)}</span></div>
        {t.otherMinutes > 0 && <div><span className="text-muted-foreground">Other:</span> <span className="font-medium">{fmtMins(t.otherMinutes)}</span></div>}
      </div>

      {/* Grouped entries */}
      {groups.map((g, gi) => (
        <Card key={g.jobId ?? `unassigned-${gi}`}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              {g.jobId ? (
                <>
                  <span className="font-mono text-muted-foreground text-xs">#{g.jobNumber}</span>
                  <span className="font-medium">{g.jobSummary ?? "Unknown Job"}</span>
                  {g.locationName && (
                    <span className="text-xs text-muted-foreground">
                      {g.locationName}{g.locationCity ? `, ${g.locationCity}` : ""}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground italic">Unassigned</span>
              )}
              <span className="ml-auto text-xs font-mono font-semibold">{fmtMins(g.totalMinutes)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0 space-y-1.5">
            {g.entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${TYPE_COLOR[entry.type] || TYPE_COLOR.other}`}>
                    {typeLabel(entry.type)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {entry.startAt ? format(new Date(entry.startAt), "h:mm a") : "?"}
                    {" \u2192 "}
                    {entry.endAt ? format(new Date(entry.endAt), "h:mm a") : "running..."}
                  </span>
                  <span className="text-xs font-mono font-medium">{fmtMins(entry.durationMinutes)}</span>
                  {entry.notes && <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={entry.notes}>{entry.notes}</span>}
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(entry)}><Pencil className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(entry.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
            {/* Group subtotals */}
            {g.entries.length > 1 && (
              <div className="flex gap-3 text-[11px] text-muted-foreground pt-1">
                {g.workMinutes > 0 && <span>Work: {fmtMins(g.workMinutes)}</span>}
                {g.travelMinutes > 0 && <span>Travel: {fmtMins(g.travelMinutes)}</span>}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Week View
// ============================================================================

function WeekView({ data, isLoading }: { data?: WeekResponse; isLoading: boolean }) {
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data || data.rows.length === 0) return <div className="text-center py-12 text-sm text-muted-foreground">No time entries for this week.</div>;

  const dayHeaders = (data.dayLabels || []).map((d) => {
    const p = parseISO(d);
    return { date: d, label: format(p, "EEE"), dateLabel: format(p, "M/d") };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium text-muted-foreground min-w-[180px]">Job</th>
            {dayHeaders.map((h) => (
              <th key={h.date} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[60px]">
                <div>{h.label}</div><div className="text-[10px] font-normal">{h.dateLabel}</div>
              </th>
            ))}
            <th className="text-center py-2 px-2 font-semibold min-w-[70px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, idx) => (
            <tr key={row.jobId ?? `u-${idx}`} className="border-b hover:bg-muted/30">
              <td className="py-2 px-3 font-medium truncate max-w-[200px]" title={row.label}>{row.label}</td>
              {Array.from({ length: 7 }, (_, i) => (
                <td key={i} className="text-center py-2 px-2 font-mono text-xs">
                  {row.days[i] ? fmtMins(row.days[i]) : <span className="text-muted-foreground/30">&ndash;</span>}
                </td>
              ))}
              <td className="text-center py-2 px-2 font-mono font-semibold text-xs">{fmtMins(row.weekTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-2 px-3">Total</td>
            {Array.from({ length: 7 }, (_, i) => (
              <td key={i} className="text-center py-2 px-2 font-mono text-xs">
                {data.dayTotals[i] ? fmtMins(data.dayTotals[i]) : <span className="text-muted-foreground/30">&ndash;</span>}
              </td>
            ))}
            <td className="text-center py-2 px-2 font-mono font-bold text-xs">{fmtMins(data.weekGrandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
