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

/**
 * Safely convert a Date, string, or nullish value to an ISO string.
 * Returns null if the value cannot be converted.
 */
function safeToISOString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return null;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

/**
 * Extract YYYY-MM-DD date string from a Date or ISO string.
 * Returns empty string if invalid.
 */
function extractDateString(value: Date | string | null | undefined): string {
  const iso = safeToISOString(value);
  if (!iso) return "";
  return iso.split("T")[0];
}

type TaskType = "GENERAL" | "SUPPLIER_VISIT";

interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

interface Client {
  id: string;
  companyName: string;
  location?: string;
}

interface SuppliersResponse {
  items: Supplier[];
  total: number;
}

interface LocationsResponse {
  items: SupplierLocation[];
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string; // If provided, we're editing; if not, we're creating
  onChanged?: () => void;
}

export function TaskDialog({ open, onOpenChange, taskId, onChanged }: TaskDialogProps) {
  const { user } = useAuth();
  const isEditMode = !!taskId;

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [type, setType] = useState<TaskType>("GENERAL");
  const [assignedToUserId, setAssignedToUserId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [jobId, setJobId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [supplierLocationId, setSupplierLocationId] = useState<string | undefined>();
  const [poNumber, setPoNumber] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Fetch task details if editing
  // Note: queryKey[0] is used as the URL by the default query function,
  // so we must include the full URL with taskId as the first element
  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}`] : ["task-empty"],
    enabled: isEditMode && open,
    staleTime: 0,
  });

  const task = taskData as any;

  // Fetch supplier visit details if editing a supplier visit
  // Note: queryKey[0] is used as the URL by the default query function
  const { data: supplierVisitData } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}/supplier-visit`] : ["supplier-visit-empty"],
    enabled: isEditMode && open && type === "SUPPLIER_VISIT",
    staleTime: 0,
  });

  // Populate form when task loads
  useEffect(() => {
    if (task && isEditMode) {
      setTitle(task.title || "");
      setNotes(task.notes || "");
      setType(task.type || "GENERAL");
      setAssignedToUserId(task.assignedToUserId || "");
      setJobId(task.jobId || "");
      setClientId(task.clientId || "");
      setAllDay(task.allDay || false);

      // Parse scheduled times
      if (task.scheduledStartAt) {
        const dateStr = extractDateString(task.scheduledStartAt);
        if (dateStr) {
          setStartDate(dateStr);
          if (!task.allDay) {
            const date = new Date(task.scheduledStartAt);
            if (!isNaN(date.getTime())) {
              setStartTime(date.toTimeString().slice(0, 5));
            }
          }
        }
      }
    } else if (!isEditMode) {
      // Reset form for create mode
      resetForm();
    }
  }, [task, isEditMode, open]);

  // Populate supplier visit fields when data loads
  useEffect(() => {
    if (supplierVisitData && isEditMode && type === "SUPPLIER_VISIT") {
      const svData = supplierVisitData as any;
      setSupplierId(svData.supplierId || undefined);
      setSupplierLocationId(svData.supplierLocationId || undefined);
      setPoNumber(svData.poNumber || "");
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
    setClientId("");
    setSupplierId(undefined);
    setSupplierLocationId(undefined);
    setPoNumber("");
  };

  const canSubmit = useMemo(() => title.trim().length > 0, [title]);

  // Fetch team members
  const { teamMembers, isLoading: isLoadingTeam } = useTechniciansDirectory();

  // Fetch jobs
  const { data: jobsData } = useQuery<{ items: Job[] }>({
    // Phase 5 E2: canonical family key
    queryKey: ["jobs"],
    queryFn: () => apiRequest("/api/jobs"),
    staleTime: 2 * 60 * 1000,
  });
  const jobs = jobsData?.items || [];

  // Fetch clients
  const { data: clientsData } = useQuery<{ items: Client[] }>({
    queryKey: ["/api/clients"],
    staleTime: 5 * 60 * 1000,
  });
  const clients = clientsData?.items || [];

  // Fetch suppliers
  const { data: suppliersData } = useQuery<SuppliersResponse>({
    queryKey: ["/api/suppliers"],
    enabled: type === "SUPPLIER_VISIT",
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = suppliersData?.items?.filter(s => s.isActive) || [];

  // Fetch supplier locations
  const { data: locationsData } = useQuery<LocationsResponse>({
    queryKey: ["/api/suppliers", supplierId, "locations"],
    enabled: Boolean(supplierId),
    staleTime: 5 * 60 * 1000,
  });
  const locations = locationsData?.items?.filter(l => l.isActive) || [];

  // Create or Update mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      let scheduledStartAt: string | undefined;
      let scheduledEndAt: string | undefined;

      // Only process dates if we have a valid startDate
      if (startDate && typeof startDate === 'string' && startDate.trim() !== "") {
        try {
          if (allDay) {
            // For all-day tasks
            const startIso = safeToISOString(startDate + "T00:00:00");
            const endIso = safeToISOString(startDate + "T23:59:59");

            if (startIso && endIso) {
              scheduledStartAt = startIso;
              scheduledEndAt = endIso;
            }
          } else if (startTime && typeof startTime === 'string' && startTime.trim() !== "") {
            // Combine date and time
            const iso = safeToISOString(startDate + "T" + startTime);
            if (iso) {
              scheduledStartAt = iso;
            }
          } else {
            // Date only, no specific time - treat as all-day
            const iso = safeToISOString(startDate + "T00:00:00");
            if (iso) {
              scheduledStartAt = iso;
            }
          }
        } catch (error) {
          console.error("Date parsing error:", error);
          throw new Error("Invalid date or time format");
        }
      }

      // Build payload, only including fields with actual values
      const payload: any = {
        title: title.trim(),
        type: type,
        status: "pending" as const,
      };

      // Only add optional fields if they have values
      if (notes && notes.trim()) payload.notes = notes.trim();
      if (assignedToUserId) payload.assignedToUserId = assignedToUserId;
      if (scheduledStartAt) payload.scheduledStartAt = scheduledStartAt;
      if (scheduledEndAt) payload.scheduledEndAt = scheduledEndAt;
      if (allDay) payload.allDay = allDay;
      if (jobId) payload.jobId = jobId;
      if (clientId) payload.clientId = clientId;

      if (isEditMode) {
        // Update existing task
        const updatedTask = await apiRequest(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // Update supplier visit details if needed
        if (type === "SUPPLIER_VISIT") {
          await apiRequest(`/api/tasks/${taskId}/supplier-visit`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              supplierId: supplierId || null,
              supplierLocationId: supplierLocationId || null,
              poNumber: poNumber.trim() || null,
            }),
          });
        }

        return updatedTask;
      } else {
        // Create new task
        const newTask = await apiRequest<any>("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // Create supplier visit details if needed
        if (type === "SUPPLIER_VISIT") {
          await apiRequest(`/api/tasks/${newTask.id}/supplier-visit`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              supplierId: supplierId || null,
              supplierLocationId: supplierLocationId || null,
              poNumber: poNumber.trim() || null,
            }),
          });
        }

        return newTask;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/tasks');
      }});
      onOpenChange(false);
      resetForm();
      onChanged?.();
    },
    onError: (error: any) => {
      alert(`Failed to ${isEditMode ? 'update' : 'create'} task: ${error?.message || "Unknown error"}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("No task ID");
      return apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/tasks');
      }});
      onOpenChange(false);
      onChanged?.();
    },
    onError: (error: any) => {
      alert(`Failed to delete task: ${error?.message || "Unknown error"}`);
    },
  });

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteMutation.mutate();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto p-3">
          <DialogHeader className="pb-1">
            <DialogTitle>{isEditMode ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>

          {isLoadingTask && isEditMode ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading task...</div>
          ) : (
            <div className="space-y-2">
              {/* Title */}
              <div className="space-y-1">
                <Label className="text-xs">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="h-8" />
              </div>

              {/* Type */}
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <div className="flex gap-2">
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

              {/* Notes */}
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

              {/* Two-column layout for compact fields */}
              <div className="grid grid-cols-2 gap-3">
                {/* Assigned To */}
                <div className="space-y-1">
                  <Label className="text-xs">Assigned To</Label>
                  <div className="flex gap-1">
                    <Select value={assignedToUserId || undefined} onValueChange={setAssignedToUserId}>
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder={isLoadingTeam ? "Loading..." : "Select..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.fullName}
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
                        className="h-8 px-2"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>

                {/* Start Date */}
                <div className="space-y-1">
                  <Label className="text-xs">Start Date</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                {/* Start Time */}
                <div className="space-y-1">
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={allDay || !startDate}
                    className="h-8 text-sm"
                  />
                </div>

                {/* All Day Checkbox */}
                <div className="flex items-end pb-1">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="allDay"
                      checked={allDay}
                      onCheckedChange={(checked) => {
                        setAllDay(checked as boolean);
                        if (checked) setStartTime("");
                      }}
                      disabled={!startDate}
                    />
                    <Label htmlFor="allDay" className="text-xs font-normal cursor-pointer">
                      All day
                    </Label>
                  </div>
                </div>
              </div>

              {/* Link to Job/Client - Two columns */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Link to Job (Optional)</Label>
                  <div className="flex gap-1">
                    <Select value={jobId || undefined} onValueChange={setJobId}>
                      <SelectTrigger className="h-8 text-sm flex-1">
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
                        className="h-8 px-2"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Link to Client (Optional)</Label>
                  <div className="flex gap-1">
                    <Select value={clientId || undefined} onValueChange={setClientId}>
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.companyName}{client.location ? ` - ${client.location}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {clientId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setClientId("")}
                        className="h-8 px-2"
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Supplier Visit Details */}
              {type === "SUPPLIER_VISIT" && (
                <div className="space-y-2 rounded border p-2 bg-muted/30">
                  <div className="text-xs font-medium">Supplier Visit Details</div>

                  <div className="space-y-1">
                    <Label className="text-xs">Supplier</Label>
                    <div className="flex gap-1">
                      <Select value={supplierId || undefined} onValueChange={(value) => {
                        if (value === "add_new") {
                          setQuickAddOpen(true);
                        } else {
                          setSupplierId(value);
                          setSupplierLocationId(undefined);
                        }
                      }}>
                        <SelectTrigger className="h-8 text-sm flex-1">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="add_new" className="text-primary font-medium">
                            + Add New Supplier
                          </SelectItem>
                          {suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
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
                          className="h-8 px-2"
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  </div>

                  {supplierId && locations.length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-xs">Location</Label>
                      <div className="flex gap-1">
                        <Select value={supplierLocationId || undefined} onValueChange={setSupplierLocationId}>
                          <SelectTrigger className="h-8 text-sm flex-1">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.name}
                                {location.isPrimary && " (Primary)"}
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
                            className="h-8 px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs">PO Number (Optional)</Label>
                    <Input
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="e.g. PO-12345"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="pt-2 flex justify-between items-center">
            {/* Left side - Delete button (only for existing tasks) */}
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
              <div /> // Spacer for create mode
            )}

            {/* Right side - Cancel and Submit */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canSubmit || saveMutation.isPending}
                size="sm"
              >
                {isEditMode ? "Update" : "Create"}
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
