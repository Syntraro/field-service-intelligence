import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FormField,
  FormLabel,
  FormRow,
  InlineInput,
  InlineTextarea,
} from "@/components/ui/form-field";
import { TechnicianSelector } from "@/components/TechnicianSelector";
import { QuickAddSupplierDialog } from "@/components/suppliers/QuickAddSupplierDialog";
import type { Supplier, SupplierLocation, Job } from "@shared/schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeToISOString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return null;
}

function extractDateString(value: Date | string | null | undefined): string {
  const iso = safeToISOString(value);
  return iso ? iso.split("T")[0] : "";
}

/** Format a supplier location for display: "Name — Address" with fallbacks */
function formatLocationLabel(loc: SupplierLocation): string {
  const name = loc.name || "";
  const addr = (loc as any).address || "";
  const city = (loc as any).city || "";
  const province = (loc as any).province || "";
  const suffix = [city, province].filter(Boolean).join(", ");

  if (name && addr) return `${name} — ${addr}`;
  if (name && suffix) return `${name} — ${suffix}`;
  if (name) return name;
  if (addr) return addr;
  return suffix || "Unnamed location";
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskType = "GENERAL" | "SUPPLIER_VISIT";

interface SuppliersResponse {
  items: Supplier[];
  total: number;
}

/** Optional prefill data for creating a task from dispatch quick-create */
interface TaskPrefill {
  assignedToUserId?: string;
  startDate?: string;   // YYYY-MM-DD
  startTime?: string;   // HH:mm
  /** Pre-select task type from dispatch quick-create menu */
  taskType?: TaskType;
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  onChanged?: () => void;
  /** Prefill fields when creating from dispatch board quick-create */
  initialData?: TaskPrefill;
  /** 2026-04-25 CreateNewDialog embedding: when true, the parent shell owns
   *  the Dialog wrapper / title strip; this component renders only the form
   *  body + footer. Used by the tabbed `+ New` modal so a single shell can
   *  compose the canonical task form alongside the canonical job form. */
  embedded?: boolean;
  /** Lock the task type to a specific value and hide the type-toggle row.
   *  The +New modal uses `forcedType="GENERAL"` for the Task tab and
   *  `forcedType="SUPPLIER_VISIT"` for the Supplier-Visit tab so each tab
   *  is single-purpose; the user picks the kind by choosing a tab, not by
   *  toggling inside the form. */
  forcedType?: TaskType;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskDialog({ open, onOpenChange, taskId, onChanged, initialData, embedded = false, forcedType }: TaskDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isEditMode = !!taskId;

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  // 2026-04-30 (embedded compact pass): collapse the Notes textarea behind
  // a "+ Add instructions" row in embedded mode. STRICTLY scoped — non-
  // embedded edit flows always render the textarea as before.
  const [embNotesOpen, setEmbNotesOpen] = useState(false);
  // forcedType (e.g. from the +New tabbed modal) seeds the initial value AND
  // disables the in-form type toggle. Falls back to GENERAL for the legacy
  // standalone-modal entry points.
  const [type, setType] = useState<TaskType>(forcedType ?? "GENERAL");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [jobId, setJobId] = useState("");
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierLocationId, setSupplierLocationId] = useState<string | undefined>();
  const [poNumber, setPoNumber] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConflictAlert, setShowConflictAlert] = useState(false);

  // ─── Data Queries ──────────────────────────────────────────────────────────

  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}`] : ["task-empty"],
    enabled: isEditMode && open,
    staleTime: 0,
  });
  const task = taskData as any;

  const { data: supplierVisitData } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}/supplier-visit`] : ["supplier-visit-empty"],
    enabled: isEditMode && open && type === "SUPPLIER_VISIT",
    staleTime: 0,
  });

  // Job picker: load only active (open) jobs, capped at 100, sorted by most recent.
  // This is an optional "Link to Job" dropdown — full job history is not needed here.
  const { data: jobsData } = useQuery<{ data?: Job[]; items?: Job[] }>({
    queryKey: ["jobs", "picker"],
    queryFn: () => apiRequest("/api/jobs?status=open&limit=100&sortBy=jobNumber&sortOrder=desc"),
    staleTime: 2 * 60 * 1000,
  });
  const jobs = jobsData?.data ?? jobsData?.items ?? [];

  const { data: suppliersData } = useQuery<SuppliersResponse>({
    queryKey: ["/api/suppliers"],
    enabled: type === "SUPPLIER_VISIT",
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = suppliersData?.items?.filter((s) => s.isActive) || [];

  // Fetch supplier locations with explicit queryFn.
  // The default getQueryFn uses queryKey[0] as the URL, but our key is
  // composite: ["/api/suppliers", supplierId, "locations"]. An explicit
  // queryFn ensures the correct URL is always called.
  const { data: locationsRaw, isLoading: isLoadingLocations } = useQuery<SupplierLocation[]>({
    queryKey: ["supplier-locations", supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const res = await fetch(`/api/suppliers/${supplierId}/locations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
      const json = await res.json();
      // Server returns { items: SupplierLocation[] }. Normalize defensively.
      const items: SupplierLocation[] = Array.isArray(json)
        ? json
        : json?.items ?? json?.data ?? json?.locations ?? [];
      if (process.env.NODE_ENV !== "production") {
        console.log("[TASKS_DIAG] supplier locations fetched", {
          supplierId,
          count: items.length,
          first: items[0] ? { id: items[0].id, name: items[0].name } : null,
        });
      }
      return items;
    },
    enabled: Boolean(supplierId) && type === "SUPPLIER_VISIT",
    staleTime: 5 * 60 * 1000,
  });

  // Active locations only — filtered from the fetched supplier_locations rows
  const locations = useMemo(
    () => (locationsRaw || []).filter((l) => l.isActive !== false),
    [locationsRaw],
  );

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (task && isEditMode) {
      setTitle(task.title || "");
      setNotes(task.notes || "");
      setType(task.type || "GENERAL");
      setAssignedToUserId(task.assignedToUserId || "");
      setJobId(task.jobId || "");
      if (task.scheduledStartAt) {
        const dateStr = extractDateString(task.scheduledStartAt);
        if (dateStr) {
          setStartDate(dateStr);
          const d = new Date(task.scheduledStartAt);
          if (!isNaN(d.getTime())) setStartTime(d.toTimeString().slice(0, 5));
        }
      }
    } else if (!isEditMode) {
      resetForm();
      // Apply prefill from dispatch quick-create
      if (initialData) {
        if (initialData.assignedToUserId) setAssignedToUserId(initialData.assignedToUserId);
        if (initialData.startDate) setStartDate(initialData.startDate);
        if (initialData.startTime) setStartTime(initialData.startTime);
        if (initialData.taskType) setType(initialData.taskType);
      }
      // forcedType wins over initialData.taskType — the embedding shell's
      // tab choice is the explicit user intent.
      if (forcedType) setType(forcedType);
    }
  }, [task, isEditMode, open, forcedType]);

  useEffect(() => {
    if (supplierVisitData && isEditMode && type === "SUPPLIER_VISIT") {
      const sv = supplierVisitData as any;
      setSupplierId(sv.supplierId || undefined);
      setSupplierLocationId(sv.supplierLocationId || undefined);
      setPoNumber(sv.poNumber || "");
    }
  }, [supplierVisitData, isEditMode, type]);

  const resetForm = () => {
    setTitle("");
    setNotes("");
    // Honor a forced type when resetting so the embedded shell never bounces
    // back to GENERAL after a successful create on the Supplier Visit tab.
    setType(forcedType ?? "GENERAL");
    setAssignedToUserId("");
    setStartDate("");
    setStartTime("08:00");
    setJobId("");
    setSupplierId(undefined);
    setSupplierLocationId(undefined);
    setPoNumber("");
    setSaveError(null);
  };

  // ─── Validation ────────────────────────────────────────────────────────────

  // 2026-05-01 — when the user has explicitly enabled the supplier-visit
  // section in the merged Task tab (or arrived via legacy
  // `forcedType="SUPPLIER_VISIT"`), require a supplier selection. Title
  // is always required. Location is intentionally NOT required to honor
  // the prior "techs may fill in later" rule for cases where the
  // dispatcher knows the supplier but the location is decided on-site.
  const canSubmit = useMemo(() => {
    if (title.trim().length === 0) return false;
    if (type === "SUPPLIER_VISIT" && !supplierId) return false;
    return true;
  }, [title, type, supplierId]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveError(null);

      // Build scheduled dates
      let scheduledStartAt: string | undefined;
      let scheduledEndAt: string | undefined;

      let hasConflict = false;
      if (startDate && startDate.trim()) {
        const time = startTime && startTime.trim() ? startTime : "08:00";
        scheduledStartAt = safeToISOString(startDate + "T" + time) ?? undefined;

        // Conflict detection — save at requested time, flag if overlap
        if (scheduledStartAt && assignedToUserId) {
          const taskDuration = 60;
          const proposedEnd = new Date(new Date(scheduledStartAt).getTime() + taskDuration * 60000);
          hasConflict = await detectScheduleConflict(
            assignedToUserId, startDate,
            scheduledStartAt, proposedEnd.toISOString(),
            taskDuration,
            isEditMode ? taskId : undefined,
          );
        }
      }

      const payload: any = {
        title: title.trim(),
        type,
        status: "pending" as const,
      };
      if (notes.trim()) payload.notes = notes.trim();
      if (assignedToUserId) payload.assignedToUserId = assignedToUserId;
      if (scheduledStartAt) payload.scheduledStartAt = scheduledStartAt;
      if (scheduledEndAt) payload.scheduledEndAt = scheduledEndAt;
      if (jobId) payload.jobId = jobId;

      // Supplier visit payload: supplierId, supplierLocationId, poNumber
      const svPayload =
        type === "SUPPLIER_VISIT"
          ? {
              supplierId: supplierId || null,
              supplierLocationId: supplierLocationId || null,
              poNumber: poNumber.trim() || null,
            }
          : null;

      if (isEditMode) {
        const updated = await apiRequest(`/api/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (svPayload) {
          await apiRequest(`/api/tasks/${taskId}/supplier-visit`, {
            method: "PATCH",
            body: JSON.stringify(svPayload),
          });
        }
        return { task: updated, hasConflict };
      } else {
        const created = await apiRequest<any>("/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (svPayload && created?.id) {
          await apiRequest(`/api/tasks/${created.id}/supplier-visit`, {
            method: "PATCH",
            body: JSON.stringify(svPayload),
          });
        }
        return { task: created, hasConflict };
      }
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/tasks");
        },
      });
      if (result?.hasConflict) {
        // Show conflict alert — defer close/reset until user acknowledges
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
        resetForm();
      }
      onChanged?.();
    },
    onError: (error: any) => {
      const msg = error?.message || "Unknown error";
      setSaveError(`Failed to ${isEditMode ? "update" : "create"} task: ${msg}`);
      if (process.env.NODE_ENV !== "production") {
        console.warn("[TASKS_DIAG] save error:", { status: error?.status, message: msg });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("No task ID");
      return apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/tasks");
        },
      });
      onOpenChange(false);
      onChanged?.();
    },
    onError: (error: any) => {
      setSaveError(`Failed to delete task: ${error?.message || "Unknown error"}`);
    },
  });

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteMutation.mutate();
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  // 2026-04-25: in embedded mode the parent shell (CreateNewDialog) renders
  // the Dialog wrapper + title strip + tab-aware sizing; we render only the
  // form body + footer. The supplier quick-add nested dialog and the conflict
  // alert stay live in both modes — neither is part of the visual chrome.
  const body = (
    <>
          {isLoadingTask && isEditMode ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading task...
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Row 1: Title.
                  2026-05-01: the legacy "Type" toggle row (General /
                  Supplier Visit buttons) was removed. Embedded callers
                  always pass `forcedType="GENERAL"` and use the inline
                  "+ Add supplier visit" expandable below to opt into
                  supplier-visit mode. Non-embedded edit flows on
                  TasksPanel also pass an effective type via taskData
                  (see useEffect line 195) so the toggle is no longer
                  needed there either — the type is inferred from the
                  edited task. */}
              <InlineInput
                id={embedded ? "task-title-embedded" : "task-title"}
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  embedded
                    ? type === "SUPPLIER_VISIT"
                      ? "Brief description of the supplier visit"
                      : "Brief description of the task"
                    : "Task title"
                }
              />

              {/* Row 2: Notes (full width).
                  2026-04-30 (embedded compact pass): collapsed behind a
                  "+ Add instructions" row in embedded mode; auto-expands
                  when there's already content. Non-embedded keeps the
                  always-visible Notes textarea. */}
              {embedded ? (
                (embNotesOpen || notes.length > 0) ? (
                  <div className="rounded-md bg-muted/30 p-2">
                    <div className="flex items-center justify-between mb-1">
                      {/* Visual section tag — not a form input label */}
                      <span className="text-xs font-medium">Instructions</span>
                      {notes.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setEmbNotesOpen(false)}
                          className="text-helper text-muted-foreground hover:text-foreground"
                          data-testid="emb-task-notes-collapse"
                        >
                          −
                        </button>
                      )}
                    </div>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add notes or instructions for the team..."
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEmbNotesOpen(true)}
                    className="text-helper font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 py-1"
                    data-testid="emb-task-notes-expand"
                  >
                    + Add instructions
                  </button>
                )
              ) : (
                <InlineTextarea
                  id="task-notes"
                  label="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details"
                  rows={2}
                />
              )}

              {/* Row 3: Assigned To | Start Date | Start Time */}
              <FormRow className="grid-cols-2 sm:grid-cols-4">
                <FormField>
                  <FormLabel>Assigned To</FormLabel>
                  <TechnicianSelector
                    mode="single"
                    value={assignedToUserId || null}
                    onChange={(id) => setAssignedToUserId(id ?? "")}
                    placeholder="Select..."
                  />
                </FormField>

                <FormField>
                  <FormLabel>Start Date</FormLabel>
                  <CanonicalDatePicker
                    value={startDate}
                    onChange={(next) => setStartDate(next ?? "")}
                    className="w-full text-sm"
                  />
                </FormField>

                <FormField>
                  <FormLabel htmlFor="task-start-time">Start Time</FormLabel>
                  <Input
                    id="task-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={!startDate}
                    className="text-sm"
                  />
                </FormField>

              </FormRow>

              {/* Row 4: Link to Job (full width) */}
              <FormField>
                <FormLabel>Link to Job (Optional)</FormLabel>
                <div className="flex gap-1">
                  <Select value={jobId || undefined} onValueChange={setJobId}>
                    <SelectTrigger className="text-sm flex-1">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {jobs.map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          #{job.jobNumber} - {job.summary}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {jobId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setJobId("")}
                      className="px-2"
                    >
                      ×
                    </Button>
                  )}
                </div>
              </FormField>

              {/* Row 5: Supplier Visit Details.
                  2026-05-01 — embedded callers (the merged Task tab in
                  CreateNewDialog) gate this entire section behind a
                  "+ Add supplier visit" expandable. Non-embedded edit
                  flows on TasksPanel keep the always-visible behavior
                  driven by `type === "SUPPLIER_VISIT"`. */}
              {embedded && type !== "SUPPLIER_VISIT" && (
                <button
                  type="button"
                  onClick={() => setType("SUPPLIER_VISIT")}
                  className="text-helper font-medium text-muted-foreground hover:text-foreground flex w-full justify-start items-center gap-1 py-1.5 px-2 rounded"
                  data-testid="emb-task-supplier-expand"
                >
                  + Add supplier visit
                </button>
              )}
              {type === "SUPPLIER_VISIT" && (
                <div
                  className={
                    embedded
                      ? "space-y-3 rounded-md border-l-2 border-[#76B054] bg-[#76B054]/5 pl-3 pr-2 py-2"
                      : "space-y-3 rounded-md border p-3 bg-muted/30"
                  }
                  data-testid="task-supplier-visit-section"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-helper font-semibold tracking-wide uppercase text-muted-foreground">
                      Supplier Visit Details
                    </div>
                    {embedded && (
                      <button
                        type="button"
                        onClick={() => {
                          // 2026-05-01 — Remove supplier visit: revert
                          // task type AND clear all supplier-visit state
                          // so a subsequent submit doesn't carry stale
                          // supplier/location/PO into the next task.
                          setType("GENERAL");
                          setSupplierId(undefined);
                          setSupplierLocationId(undefined);
                          setPoNumber("");
                        }}
                        className="text-helper font-medium text-muted-foreground hover:text-foreground"
                        data-testid="emb-task-supplier-collapse"
                      >
                        Remove supplier visit
                      </button>
                    )}
                  </div>

                  {/* Supplier + Location side-by-side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Supplier */}
                    <FormField>
                      <FormLabel>Supplier</FormLabel>
                      <div className="flex gap-1">
                        <Select
                          value={supplierId || undefined}
                          onValueChange={(v) => {
                            if (v === "add_new") {
                              setQuickAddOpen(true);
                            } else {
                              setSupplierId(v);
                              setSupplierLocationId(undefined);
                            }
                          }}
                        >
                          <SelectTrigger className="text-sm flex-1">
                            <SelectValue placeholder="Select supplier..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value="add_new"
                              className="text-primary font-medium"
                            >
                              + Add New Supplier
                            </SelectItem>
                            {suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {supplierId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSupplierId(undefined);
                              setSupplierLocationId(undefined);
                            }}
                            className="px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </FormField>

                    {/* Location — always rendered when supplier selected */}
                    <FormField>
                      <FormLabel>Location</FormLabel>
                      <div className="flex gap-1">
                        <Select
                          value={supplierLocationId || undefined}
                          onValueChange={setSupplierLocationId}
                          disabled={!supplierId || isLoadingLocations}
                        >
                          <SelectTrigger className="text-sm flex-1">
                            <SelectValue
                              placeholder={
                                !supplierId
                                  ? "Select supplier first"
                                  : isLoadingLocations
                                    ? "Loading..."
                                    : locations.length === 0
                                      ? "No locations"
                                      : "Select location..."
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((loc) => (
                              <SelectItem key={loc.id} value={loc.id}>
                                {formatLocationLabel(loc)}
                                {loc.isPrimary && " ★"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {supplierLocationId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSupplierLocationId(undefined)}
                            className="px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </FormField>
                  </div>

                  {/* PO Number (full width) */}
                  <InlineInput
                    id="task-po-number"
                    label="PO Number (Optional)"
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="e.g. PO-12345"
                  />
                </div>
              )}
            </div>
          )}

          {/* Inline error banner */}
          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mt-2">
              {saveError}
            </div>
          )}

          {/* 2026-04-26 polish v4: natural-flow footer (was sticky with
              `-mx-6 px-6`, which overflowed the embedded `px-5` wrapper and
              caused a horizontal scrollbar at the bottom of the shell). */}
          <DialogFooter className="pt-2 flex justify-between items-center">
            {isEditMode ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Delete
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canSubmit || saveMutation.isPending}
                size="sm"
                data-testid="task-submit"
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : isEditMode
                    ? "Update"
                    : embedded
                      ? "Create Task"
                      : "Create"}
              </Button>
            </div>
          </DialogFooter>
    </>
  );

  return (
    <>
      {embedded ? (
        // 2026-04-26 polish v4: tighter padding + space-y to match the Job
        // tab. Footer is sticky inside `body`. overflow-y-auto stays as a
        // safety net for the Supplier-Visit subsection on small viewports.
        <div className="px-5 pt-3 pb-3 flex-1 min-h-0 overflow-y-auto" data-testid="embedded-task-dialog">
          {body}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-3xl p-5">
            <DialogHeader className="pb-2">
              <DialogTitle>{isEditMode ? "Edit Task" : "New Task"}</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      <QuickAddSupplierDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onSuccess={(supplier) => setSupplierId(supplier.id)}
      />

      <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scheduling conflict detected</AlertDialogTitle>
            <AlertDialogDescription>
              This item overlaps another scheduled item. Please review the dispatch board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); resetForm(); }}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
