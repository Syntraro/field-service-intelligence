import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  onChanged?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskDialog({ open, onOpenChange, taskId, onChanged }: TaskDialogProps) {
  const { user } = useAuth();
  const isEditMode = !!taskId;

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [type, setType] = useState<TaskType>("GENERAL");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [jobId, setJobId] = useState("");
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierLocationId, setSupplierLocationId] = useState<string | undefined>();
  const [poNumber, setPoNumber] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const { teamMembers, isLoading: isLoadingTeam } = useTechniciansDirectory();

  const { data: jobsData } = useQuery<{ data?: Job[]; items?: Job[] }>({
    queryKey: ["jobs"],
    queryFn: () => apiRequest("/api/jobs"),
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
      setAllDay(task.allDay || false);
      if (task.scheduledStartAt) {
        const dateStr = extractDateString(task.scheduledStartAt);
        if (dateStr) {
          setStartDate(dateStr);
          if (!task.allDay) {
            const d = new Date(task.scheduledStartAt);
            if (!isNaN(d.getTime())) setStartTime(d.toTimeString().slice(0, 5));
          }
        }
      }
    } else if (!isEditMode) {
      resetForm();
    }
  }, [task, isEditMode, open]);

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
    setType("GENERAL");
    setAssignedToUserId("");
    setStartDate("");
    setStartTime("");
    setAllDay(false);
    setJobId("");
    setSupplierId(undefined);
    setSupplierLocationId(undefined);
    setPoNumber("");
    setSaveError(null);
  };

  // ─── Validation ────────────────────────────────────────────────────────────

  // Allow task creation without a supplier — techs may fill it in later.
  // Title is the only hard requirement.
  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveError(null);

      // Build scheduled dates
      let scheduledStartAt: string | undefined;
      let scheduledEndAt: string | undefined;

      if (startDate && startDate.trim()) {
        if (allDay) {
          scheduledStartAt = safeToISOString(startDate + "T00:00:00") ?? undefined;
          scheduledEndAt = safeToISOString(startDate + "T23:59:59") ?? undefined;
        } else if (startTime && startTime.trim()) {
          scheduledStartAt = safeToISOString(startDate + "T" + startTime) ?? undefined;
        } else {
          scheduledStartAt = safeToISOString(startDate + "T00:00:00") ?? undefined;
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
      if (allDay) payload.allDay = allDay;
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
        return updated;
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
        return created;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/tasks");
        },
      });
      onOpenChange(false);
      resetForm();
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl p-5">
          <DialogHeader className="pb-2">
            <DialogTitle>{isEditMode ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>

          {isLoadingTask && isEditMode ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading task...
            </div>
          ) : (
            <div className="space-y-3">
              {/* Row 1: Title + Type */}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={type === "GENERAL" ? "default" : "outline"}
                      onClick={() => setType("GENERAL")}
                    >
                      General
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={type === "SUPPLIER_VISIT" ? "default" : "outline"}
                      onClick={() => setType("SUPPLIER_VISIT")}
                    >
                      Supplier Visit
                    </Button>
                  </div>
                </div>
              </div>

              {/* Row 2: Notes (full width) */}
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details"
                  rows={2}
                  className="text-sm"
                />
              </div>

              {/* Row 3: Assigned To | Start Date | Start Time | All Day */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Assigned To</Label>
                  <div className="flex gap-1">
                    <Select
                      value={assignedToUserId || undefined}
                      onValueChange={setAssignedToUserId}
                    >
                      <SelectTrigger className="h-9 text-sm flex-1">
                        <SelectValue
                          placeholder={isLoadingTeam ? "Loading..." : "Select..."}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignedToUserId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssignedToUserId("")}
                        className="h-9 px-2"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={allDay || !startDate}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="flex items-end pb-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="allDay"
                      checked={allDay}
                      onCheckedChange={(c) => {
                        setAllDay(c as boolean);
                        if (c) setStartTime("");
                      }}
                      disabled={!startDate}
                    />
                    <Label htmlFor="allDay" className="text-xs font-normal cursor-pointer">
                      All day
                    </Label>
                  </div>
                </div>
              </div>

              {/* Row 4: Link to Job (full width) */}
              <div className="space-y-1">
                <Label className="text-xs">Link to Job (Optional)</Label>
                <div className="flex gap-1">
                  <Select value={jobId || undefined} onValueChange={setJobId}>
                    <SelectTrigger className="h-9 text-sm flex-1">
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
                      className="h-9 px-2"
                    >
                      ×
                    </Button>
                  )}
                </div>
              </div>

              {/* Row 5: Supplier Visit Details */}
              {type === "SUPPLIER_VISIT" && (
                <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                  <div className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                    Supplier Visit Details
                  </div>

                  {/* Supplier + Location side-by-side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Supplier */}
                    <div className="space-y-1">
                      <Label className="text-xs">Supplier</Label>
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
                          <SelectTrigger className="h-9 text-sm flex-1">
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
                            className="h-9 px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Location — always rendered when supplier selected */}
                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <div className="flex gap-1">
                        <Select
                          value={supplierLocationId || undefined}
                          onValueChange={setSupplierLocationId}
                          disabled={!supplierId || isLoadingLocations}
                        >
                          <SelectTrigger className="h-9 text-sm flex-1">
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
                            className="h-9 px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* PO Number (full width) */}
                  <div className="space-y-1">
                    <Label className="text-xs">PO Number (Optional)</Label>
                    <Input
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="e.g. PO-12345"
                      className="h-9 text-sm"
                    />
                  </div>
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

          <DialogFooter className="pt-3 flex justify-between items-center">
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
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : isEditMode
                    ? "Update"
                    : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickAddSupplierDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onSuccess={(supplier) => setSupplierId(supplier.id)}
      />
    </>
  );
}
