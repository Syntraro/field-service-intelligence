/**
 * DispatchDetailPanel — Right-side Sheet for visit/job context on calendar.
 *
 * Dispatch Board UI — Side Panel (2026-03-06)
 *
 * Opens instead of JobDetailDialog when clicking a visit event on the calendar.
 * Compact, dispatch-first layout with quick actions:
 *   - Reschedule (date/time picker)
 *   - Unschedule (remove from calendar)
 *   - Add follow-up visit
 *   - Open full job detail (escape hatch)
 *   - Technician display + reassignment
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  MapPin,
  Clock,
  User,
  CalendarIcon,
  ExternalLink,
  CalendarPlus,
  XCircle,
  CheckCircle2,
  Package,
  RotateCcw,
  Loader2,
  Save,
  History,
  Pencil,
  StickyNote,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getMemberDisplayName } from "@/lib/displayName";
import { AddVisitDialog } from "@/components/AddVisitDialog";
import { formatTimeFromMinutes, VISIT_STATUS_STYLES, VISIT_OUTCOME_STYLES } from "./calendarUtils";

// ============================================================================
// Types
// ============================================================================

export interface DispatchPanelData {
  /** The raw assignment/event passed from Calendar click handler */
  assignment: any;
  /** The client/location */
  client: any;
}

interface DispatchDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DispatchPanelData | null;
  technicians: any[];
  /** Open full JobDetailDialog as escape hatch */
  onOpenFullDetail?: () => void;
  /** Technician reassignment callback from useCalendarDnD */
  onAssignTechnicians?: (assignmentId: string, technicianIds: string[]) => void;
  timeFormat?: "12h" | "24h";
}

// ============================================================================
// Helpers
// ============================================================================

function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Resolve visit status label from shared config */
function getVisitStatusLabel(status?: string): string {
  return VISIT_STATUS_STYLES[status || ""]?.label || status || "—";
}

/** Resolve outcome label from shared config */
function getOutcomeLabel(outcome?: string): string {
  return VISIT_OUTCOME_STYLES[outcome || ""]?.label || "";
}

// ============================================================================
// Component
// ============================================================================

export function DispatchDetailPanel({
  open,
  onOpenChange,
  data,
  technicians,
  onOpenFullDetail,
  onAssignTechnicians,
  timeFormat = "12h",
}: DispatchDetailPanelProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Add Visit dialog state
  const [showAddVisit, setShowAddVisit] = useState(false);

  // Inline reschedule state
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [editDate, setEditDate] = useState<Date | undefined>();
  const [editTime, setEditTime] = useState("");
  const [editDuration, setEditDuration] = useState("60");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Technician edit state
  const [editingTech, setEditingTech] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState<string>("__none__");

  // Visit notes edit state (2026-03-06: dispatch notes in panel)
  const [editingNotes, setEditingNotes] = useState(false);
  const [editNotesText, setEditNotesText] = useState("");

  // Extract useful data
  const assignment = data?.assignment;
  const client = data?.client;

  const jobId = assignment?.jobId || assignment?.job_id || "";
  const visitId = assignment?.visitId || assignment?.id || "";
  const jobNumber = assignment?.jobNumber;
  const visitNumber = assignment?.visitNumber;
  const version = assignment?.version ?? 0;
  const companyName = client?.companyName || assignment?.customerCompanyName || "Unknown";
  const summary = assignment?.summary || "";
  const locationStr = client?.location || client?.address || "";
  const fullAddress = [client?.address, client?.city, client?.province, client?.postalCode]
    .filter(Boolean)
    .join(", ");

  // Schedule info
  const scheduledDate = assignment?.scheduledDate || assignment?.date || "";
  const startMinutes = assignment?.scheduledStartMinutes ?? (assignment?.scheduledHour != null ? assignment.scheduledHour * 60 + (assignment.scheduledMinute || 0) : null);
  const durationMinutes = assignment?.durationMinutes ?? 60;
  const isAllDay = assignment?.allDay || assignment?.isAllDay || false;
  const isCompleted = assignment?.completed || assignment?.status === "completed" || assignment?.visitStatus === "completed";

  // Visit-specific
  const visitStatus = assignment?.visitStatus || assignment?.status || "";
  const visitOutcome = assignment?.visitOutcome || assignment?.outcome || "";
  const outcomeNote = assignment?.outcomeNote || "";
  const visitNotes = assignment?.visitNotes || "";
  const jobDescription = assignment?.description || "";

  // Technicians
  const techIds: string[] = assignment?.assignedTechnicianIds || (assignment?.primaryTechnicianId ? [assignment.primaryTechnicianId] : []);

  const assignedTechNames = useMemo(() => {
    return techIds
      .map((tid: string) => {
        const t = technicians.find((tech: any) => tech.id === tid);
        return t ? getMemberDisplayName(t) : null;
      })
      .filter(Boolean);
  }, [techIds, technicians]);

  // Reset edit states when data changes
  useEffect(() => {
    if (open && assignment) {
      setEditingSchedule(false);
      setEditingTech(false);
      setEditingNotes(false);
      setShowAddVisit(false);
      // Pre-populate edit fields
      setEditDate(scheduledDate ? parseLocalDate(scheduledDate) : new Date());
      const h = startMinutes != null ? Math.floor(startMinutes / 60) : 9;
      const m = startMinutes != null ? startMinutes % 60 : 0;
      setEditTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      setEditDuration(String(durationMinutes));
      setSelectedTechId(techIds[0] || "__none__");
    }
  }, [open, assignment?.id, visitId]);

  // ------ MUTATIONS ------

  // Reschedule visit
  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!editDate || !editTime) throw new Error("Date and time required");
      const [hStr, mStr] = editTime.split(":");
      const h = parseInt(hStr, 10);
      const min = parseInt(mStr || "0", 10);
      const dur = parseInt(editDuration, 10) || 60;
      const startAt = new Date(editDate.getFullYear(), editDate.getMonth(), editDate.getDate(), h, min);
      const endAt = new Date(startAt.getTime() + dur * 60000);

      return apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          allDay: false,
          version,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      toast({ title: "Rescheduled", description: "Visit has been rescheduled." });
      setEditingSchedule(false);
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // Unschedule visit
  const unscheduleMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/calendar/visit/${visitId}/unschedule`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: version }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/needs-follow-up"] });
      toast({ title: "Unscheduled", description: "Visit removed from calendar." });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // Save visit notes (2026-03-06: dispatch notes in panel)
  const notesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/calendar/visit/${visitId}/reschedule`, {
        method: "PATCH",
        body: JSON.stringify({ notes: editNotesText.trim() || null, version }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      toast({ title: "Notes saved" });
      setEditingNotes(false);
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // Technician reassignment
  const handleTechSave = useCallback(() => {
    if (!onAssignTechnicians || !visitId) return;
    const newTechIds = selectedTechId === "__none__" ? [] : [selectedTechId];
    onAssignTechnicians(visitId, newTechIds);
    setEditingTech(false);
  }, [onAssignTechnicians, visitId, selectedTechId]);

  const isMutating = rescheduleMutation.isPending || unscheduleMutation.isPending || notesMutation.isPending;

  if (!data) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
        <SheetContent
          side="right"
          className="w-[380px] sm:w-[420px] p-0 flex flex-col overflow-hidden shadow-2xl"
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* HEADER */}
          <div className="px-4 pt-4 pb-3 border-b bg-muted/30 space-y-1.5">
            <SheetHeader className="space-y-0">
              <SheetTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                {companyName}
                {jobNumber != null && (
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                    Job #{jobNumber}
                  </Badge>
                )}
                {visitNumber != null && (
                  <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                    Visit #{visitNumber}
                  </Badge>
                )}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground truncate">
                {summary || "No summary"}
              </SheetDescription>
            </SheetHeader>

            {/* Status badges row — uses shared VISIT_STATUS_STYLES config */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {isCompleted && (
                <Badge variant="secondary" className={`text-[10px] gap-1 ${VISIT_STATUS_STYLES.completed.badge}`}>
                  <CheckCircle2 className="h-3 w-3" /> Completed
                </Badge>
              )}
              {visitStatus && !isCompleted && (
                <Badge variant="secondary" className={`text-[10px] gap-1 ${VISIT_STATUS_STYLES[visitStatus]?.badge || ""}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${VISIT_STATUS_STYLES[visitStatus]?.dot || "bg-gray-400"}`} />
                  {getVisitStatusLabel(visitStatus)}
                </Badge>
              )}
              {visitOutcome && visitOutcome !== "completed" && (
                <Badge variant="outline" className={`text-[10px] gap-1 ${VISIT_OUTCOME_STYLES[visitOutcome]?.badge || ""}`}>
                  {visitOutcome === "needs_parts" ? <Package className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                  {getOutcomeLabel(visitOutcome)}
                </Badge>
              )}
            </div>
          </div>

          {/* SCROLLABLE BODY */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* LOCATION */}
            {(locationStr || fullAddress) && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{fullAddress || locationStr}</span>
              </div>
            )}

            <Separator />

            {/* VISIT SCHEDULE SECTION */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</h4>
                {!isCompleted && !editingSchedule && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setEditingSchedule(true)}
                  >
                    Edit
                  </Button>
                )}
              </div>

              {!editingSchedule ? (
                /* READ-ONLY schedule display */
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>
                      {scheduledDate
                        ? format(parseLocalDate(scheduledDate), "EEE, MMM d, yyyy")
                        : "Not scheduled"}
                    </span>
                  </div>
                  {!isAllDay && startMinutes != null && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>
                        {formatTimeFromMinutes(startMinutes, timeFormat)}
                        {" – "}
                        {formatTimeFromMinutes(startMinutes + durationMinutes, timeFormat)}
                        <span className="text-muted-foreground ml-1">
                          ({durationMinutes}m)
                        </span>
                      </span>
                    </div>
                  )}
                  {isAllDay && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">All day</span>
                    </div>
                  )}
                </div>
              ) : (
                /* INLINE RESCHEDULE FORM */
                <div className="space-y-2 p-2 rounded border bg-muted/20">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Date</Label>
                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full text-xs justify-start">
                          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                          {editDate ? format(editDate, "EEE, MMM d") : "Pick date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarPicker
                          mode="single"
                          selected={editDate}
                          onSelect={(d) => { setEditDate(d); setDatePickerOpen(false); }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Time</Label>
                      <Input
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="09:00"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Duration</Label>
                      <Select value={editDuration} onValueChange={setEditDuration}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[15, 30, 45, 60, 90, 120, 180, 240].map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {d >= 60 ? `${d / 60}h` : `${d}m`}
                              {d % 60 !== 0 && d >= 60 ? ` ${d % 60}m` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => rescheduleMutation.mutate()}
                      disabled={isMutating}
                    >
                      {rescheduleMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Save className="h-3 w-3 mr-1" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEditingSchedule(false)}
                      disabled={isMutating}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <Separator />

            {/* TECHNICIANS SECTION */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Technician</h4>
                {!isCompleted && onAssignTechnicians && !editingTech && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setEditingTech(true)}
                  >
                    Change
                  </Button>
                )}
              </div>

              {!editingTech ? (
                <div className="flex items-center gap-2 text-xs">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {assignedTechNames.length > 0 ? (
                    <span>{assignedTechNames.join(", ")}</span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </div>
              ) : (
                <div className="space-y-2 p-2 rounded border bg-muted/20">
                  <Select value={selectedTechId} onValueChange={setSelectedTechId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select technician" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {technicians.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {getMemberDisplayName(t) || t.email || "Tech"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-xs flex-1" onClick={handleTechSave}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingTech(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* OUTCOME NOTE (if present) */}
            {outcomeNote && (
              <>
                <Separator />
                <section className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome Note</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{outcomeNote}</p>
                </section>
              </>
            )}

            {/* VISIT NOTES — editable dispatch/office notes (2026-03-06) */}
            <Separator />
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <StickyNote className="h-3 w-3" /> Visit Notes
                </h4>
                {!editingNotes && !isCompleted && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => { setEditNotesText(visitNotes); setEditingNotes(true); }}
                  >
                    <Pencil className="h-3 w-3 mr-0.5" /> {visitNotes ? "Edit" : "Add"}
                  </Button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-1.5">
                  <Textarea
                    value={editNotesText}
                    onChange={(e) => setEditNotesText(e.target.value)}
                    placeholder="Dispatch notes, access codes, special instructions..."
                    className="text-xs min-h-[60px] max-h-[120px] resize-y"
                    maxLength={2000}
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => notesMutation.mutate()}
                      disabled={notesMutation.isPending}
                    >
                      {notesMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingNotes(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className={`text-xs leading-relaxed ${visitNotes ? "text-foreground" : "text-muted-foreground italic"}`}>
                  {visitNotes || "No notes"}
                </p>
              )}
            </section>

            {/* JOB DESCRIPTION — read-only context from parent job */}
            {jobDescription && (
              <>
                <Separator />
                <section className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job Description</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{jobDescription}</p>
                </section>
              </>
            )}

            <Separator />

            {/* JOB CONTEXT SECTION */}
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job Context</h4>
              <div className="space-y-1 text-xs">
                {assignment?.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Job status</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{assignment.status}</Badge>
                  </div>
                )}
                {assignment?.jobType && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="capitalize">{assignment.jobType}</span>
                  </div>
                )}
                {assignment?.priority && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Priority</span>
                    <span className="capitalize">{assignment.priority}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* FOOTER ACTIONS */}
          <div className="border-t px-4 py-3 space-y-2 bg-muted/10">
            {/* Primary actions row */}
            <div className="flex gap-1.5">
              {!isCompleted && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs flex-1"
                  onClick={() => unscheduleMutation.mutate()}
                  disabled={isMutating}
                >
                  {unscheduleMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                  )}
                  Unschedule
                </Button>
              )}
              {jobId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs flex-1"
                  onClick={() => setShowAddVisit(true)}
                >
                  <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                  Add Visit
                </Button>
              )}
            </div>
            {/* Secondary actions row */}
            <div className="flex gap-1.5">
              {onOpenFullDetail && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] flex-1"
                  onClick={() => {
                    onOpenFullDetail();
                    onOpenChange(false);
                  }}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Full Details
                </Button>
              )}
              {jobId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] flex-1"
                  onClick={() => {
                    setLocation(`/jobs/${jobId}?section=visits`);
                    onOpenChange(false);
                  }}
                >
                  <History className="h-3 w-3 mr-1" />
                  Visit History
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Visit sub-dialog */}
      {jobId && (
        <AddVisitDialog
          jobId={jobId}
          jobVersion={version}
          open={showAddVisit}
          onOpenChange={setShowAddVisit}
          technicians={technicians}
          defaultTechnicianId={techIds[0] || undefined}
        />
      )}
    </>
  );
}
