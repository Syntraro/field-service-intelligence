/**
 * Unassigned Time Review Page
 * Phase 3: Manager view for reviewing and linking orphaned time entries
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Loader2,
  DollarSign,
  Link2,
  Calendar,
  User,
  AlertTriangle,
  ExternalLink,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TimeEntryType, UnassignedTimeEntry } from "@shared/schema";

// Manager roles that can access this page
const MANAGER_ROLES = ["owner", "admin", "manager", "dispatcher"];

interface Technician {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}

// Format minutes as hours and minutes
function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// Format time entry type for display
function formatTimeEntryType(type: TimeEntryType): string {
  const typeLabels: Record<TimeEntryType, string> = {
    travel_to_job: "Travel",
    on_site: "On Site",
    travel_to_supplier: "To Supplier",
    supplier_run: "Supplier",
    travel_between_jobs: "Between Jobs",
    admin: "Admin",
    break: "Break",
    other: "Other",
  };
  return typeLabels[type] || type;
}

// Get type badge color
function getTypeBadgeClass(type: TimeEntryType): string {
  switch (type) {
    case "on_site":
      return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "travel_to_job":
    case "travel_between_jobs":
    case "travel_to_supplier":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "supplier_run":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    case "admin":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300";
    case "break":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

// Phase 9: Check if entry is locked
function isEntryLocked(entry: UnassignedTimeEntry): boolean {
  return !!(entry.lockedAt || entry.lockedByInvoiceId || entry.invoiced);
}

export default function UnassignedTimePage() {
  const { user } = useAuth();
  const { toast } = useToast();

  // State for filters
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
  const [includeRunning, setIncludeRunning] = useState(false);

  // State for link to job dialog
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<UnassignedTimeEntry | null>(null);
  const [jobIdInput, setJobIdInput] = useState("");

  // Check if user has manager access
  const isManager = !!(user && MANAGER_ROLES.includes(user.role));

  // Fetch technicians for dropdown
  const { data: technicians = [] } = useQuery<Technician[]>({
    queryKey: ["/api/technicians"],
    enabled: isManager,
  });

  // Fetch unassigned time entries
  const { data: entries = [], isLoading, error } = useQuery<UnassignedTimeEntry[]>({
    queryKey: ["/api/time/unassigned", { date: selectedDate, technicianId: selectedTechnicianId, includeRunning }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDate) params.set("date", selectedDate);
      if (selectedTechnicianId) params.set("technicianId", selectedTechnicianId);
      if (includeRunning) params.set("includeRunning", "true");

      const res = await fetch(`/api/time/unassigned?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch unassigned time entries");
      return res.json();
    },
    enabled: isManager,
  });

  // Toggle billable mutation
  const toggleBillableMutation = useMutation({
    mutationFn: async ({ id, billable }: { id: string; billable: boolean }) => {
      return apiRequest(`/api/time/entries/${id}/manager`, {
        method: "PUT",
        body: JSON.stringify({ billable }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time/unassigned"] });
      toast({
        title: "Updated",
        description: "Billable status updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update billable status",
        variant: "destructive",
      });
    },
  });

  // Link to job mutation
  const linkToJobMutation = useMutation({
    mutationFn: async ({ entryId, jobId }: { entryId: string; jobId: string }) => {
      return apiRequest(`/api/time/entries/${entryId}/link-job`, {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time/unassigned"] });
      setLinkDialogOpen(false);
      setSelectedEntry(null);
      setJobIdInput("");
      toast({
        title: "Linked",
        description: "Time entry linked to job successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to link to job",
        variant: "destructive",
      });
    },
  });

  // Handle link to job
  const handleLinkToJob = (entry: UnassignedTimeEntry) => {
    setSelectedEntry(entry);
    setJobIdInput("");
    setLinkDialogOpen(true);
  };

  const handleConfirmLink = () => {
    if (!selectedEntry || !jobIdInput.trim()) return;
    linkToJobMutation.mutate({
      entryId: selectedEntry.id,
      jobId: jobIdInput.trim(),
    });
  };

  // Show forbidden message if not a manager
  if (!isManager) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">
              You do not have permission to view this page.
              <br />
              Only managers, admins, and owners can review unassigned time entries.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4" data-testid="unassigned-time-page">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Unassigned Time Review</h1>
        <p className="text-muted-foreground">
          Review and link orphaned time entries that are not associated with any job.
        </p>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            {/* Date picker */}
            <div className="space-y-1">
              <Label htmlFor="date" className="text-xs">Date</Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-40"
                  data-testid="date-filter"
                />
              </div>
            </div>

            {/* Technician dropdown */}
            <div className="space-y-1">
              <Label htmlFor="technician" className="text-xs">Technician</Label>
              <Select
                value={selectedTechnicianId}
                onValueChange={setSelectedTechnicianId}
              >
                <SelectTrigger className="w-48" data-testid="technician-filter">
                  <SelectValue placeholder="All Technicians" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Technicians</SelectItem>
                  {technicians.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.fullName || tech.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Include running toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeRunning"
                checked={includeRunning}
                onCheckedChange={(checked) => setIncludeRunning(checked === true)}
                data-testid="include-running-filter"
              />
              <Label htmlFor="includeRunning" className="text-xs cursor-pointer">
                Include running entries
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entries List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Unassigned Entries</CardTitle>
          <CardDescription>
            {entries.length} {entries.length === 1 ? "entry" : "entries"} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-destructive">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p>Failed to load entries</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No unassigned time entries for this date.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    isEntryLocked(entry) ? "bg-muted/50 opacity-75" : "bg-background"
                  )}
                  data-testid={`entry-${entry.id}`}
                >
                  {/* Left: Type, Technician, Times */}
                  <div className="flex items-center gap-3 flex-1">
                    {/* Type badge */}
                    <span
                      className={cn(
                        "px-2 py-1 rounded text-xs font-medium whitespace-nowrap",
                        getTypeBadgeClass(entry.type)
                      )}
                    >
                      {formatTimeEntryType(entry.type)}
                    </span>

                    {/* Technician */}
                    <div className="flex items-center gap-1 text-sm">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {entry.technicianName || "Unknown"}
                      </span>
                    </div>

                    {/* Times */}
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(entry.startAt), "h:mm a")}
                      {" - "}
                      {entry.endAt ? (
                        format(new Date(entry.endAt), "h:mm a")
                      ) : (
                        <span className="text-green-600 font-medium">Running</span>
                      )}
                    </div>

                    {/* Duration */}
                    <div className="font-medium text-sm">
                      {formatMinutes(entry.durationMinutes)}
                    </div>

                    {/* Notes preview */}
                    {entry.notes && (
                      <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={entry.notes}>
                        {entry.notes}
                      </span>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-3">
                    {/* Billable toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={entry.billable}
                        onCheckedChange={(checked) =>
                          toggleBillableMutation.mutate({ id: entry.id, billable: checked })
                        }
                        disabled={isEntryLocked(entry) || toggleBillableMutation.isPending}
                        data-testid={`billable-toggle-${entry.id}`}
                      />
                      <span className={cn("text-xs", entry.billable ? "text-primary" : "text-muted-foreground")}>
                        <DollarSign className="h-3 w-3" />
                      </span>
                    </div>

                    {/* Phase 9: Locked badge with invoice info */}
                    {isEntryLocked(entry) && (
                      <Badge
                        variant="secondary"
                        className="text-xs flex items-center gap-1"
                        title={
                          entry.lockedByInvoiceId
                            ? `Locked by Invoice: ${entry.lockedByInvoiceId}`
                            : "Locked because it was invoiced"
                        }
                      >
                        <Lock className="h-3 w-3" />
                        Locked
                      </Badge>
                    )}

                    {/* Link to job button */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLinkToJob(entry)}
                      disabled={isEntryLocked(entry)}
                      data-testid={`link-job-${entry.id}`}
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Link to Job
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link to Job Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent data-testid="link-job-dialog">
          <DialogHeader>
            <DialogTitle>Link Time Entry to Job</DialogTitle>
            <DialogDescription>
              Enter the Job ID to link this time entry to a job.
            </DialogDescription>
          </DialogHeader>

          {selectedEntry && (
            <div className="space-y-4 py-4">
              {/* Entry summary */}
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-xs font-medium",
                      getTypeBadgeClass(selectedEntry.type)
                    )}
                  >
                    {formatTimeEntryType(selectedEntry.type)}
                  </span>
                  <span className="text-muted-foreground">
                    {selectedEntry.technicianName}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(selectedEntry.startAt), "MMM d, yyyy h:mm a")}
                  {" - "}
                  {selectedEntry.endAt
                    ? format(new Date(selectedEntry.endAt), "h:mm a")
                    : "Running"}
                  {selectedEntry.durationMinutes !== null &&
                    ` (${formatMinutes(selectedEntry.durationMinutes)})`}
                </div>
              </div>

              {/* Job ID input */}
              <div className="space-y-2">
                <Label htmlFor="jobId">Job ID (UUID)</Label>
                <Input
                  id="jobId"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={jobIdInput}
                  onChange={(e) => setJobIdInput(e.target.value)}
                  data-testid="job-id-input"
                />
                <p className="text-xs text-muted-foreground">
                  Tip: Copy the Job ID from the job detail page URL or use{" "}
                  <a
                    href="/jobs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Jobs <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmLink}
              disabled={!jobIdInput.trim() || linkToJobMutation.isPending}
              data-testid="confirm-link-btn"
            >
              {linkToJobMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Link to Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
