/**
 * PMScheduleCard — Collapsible card for the Location Detail right column.
 *
 * Fetches recurring templates for the location, identifies the PM template
 * (jobType=maintenance with monthsOfYear set), and displays either a
 * "No schedule" state or a summary with Edit/Pause/Resume/Preview/Delete actions.
 *
 * Generation is scoped to current month only (windowDays to end of month).
 * After generation, surfaces existing job link when no new jobs are needed.
 * Cross-template discovery: when 0 jobs created, searches PM templates for this
 * location (isPmTemplate filter + current-month check, including archived) for
 * instances with linked jobs — handles archive→recreate flow.
 *
 * Delete UX:
 * - Default "Remove" = soft delete (sets isActive=false). Schedule disappears
 *   from PM card but can be restored via recurring templates admin page.
 * - "Delete permanently" = hard delete (?hard=true). Cascades to instances
 *   only; jobs/invoices are NOT affected. Gated to owner/admin + typed confirmation.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, Pause, Play, Eye, Pencil, Zap, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import PMSetupModal from "./PMSetupModal";
import type { RecurringJobTemplate } from "@shared/schema";
import { format } from "date-fns";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Job type constant used for PM template identification */
const PM_JOB_TYPE = "maintenance" as const;

/** Roles allowed to permanently delete PM schedules */
const HARD_DELETE_ROLES = ["owner", "admin"];

/**
 * Determine if a template is a PM template for the given location.
 * Primary: jobType=maintenance + locationId match + monthsOfYear configured.
 * Fallback (legacy): title starts with "PM" + locationId match + monthsOfYear configured.
 */
function isPmTemplate(t: RecurringJobTemplate, locationId: string): boolean {
  if (t.locationId !== locationId) return false;
  const hasMonths = Array.isArray(t.monthsOfYear) && t.monthsOfYear.length > 0;
  if (t.jobType === PM_JOB_TYPE && hasMonths) return true;
  // Legacy fallback: title prefix "PM" + months configured
  if (t.title.toUpperCase().startsWith("PM") && hasMonths) return true;
  return false;
}

/** Shape returned by GET /api/recurring-templates/:id/instances (InstanceWithJob) */
interface InstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

/**
 * Compute windowDays so generation only covers through end of current month.
 * Adds a +2 day buffer for safety, capped at 35.
 */
function computeCurrentMonthWindowDays(): number {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msPerDay = 86_400_000;
  const daysRemaining = Math.ceil((endOfMonth.getTime() - now.getTime()) / msPerDay) + 1;
  return Math.min(Math.max(daysRemaining + 2, 1), 35);
}

/** Get YYYY-MM-DD for first and last day of current month */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

interface PMScheduleCardProps {
  locationId: string;
  locationName: string;
  companyId: string;
  clientId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Identify the active PM template for this location from the full template list.
 * Uses isPmTemplate for matching, filters to isActive=true so archived schedules are hidden.
 * Returns the most recently updated match.
 */
function findPMTemplate(templates: RecurringJobTemplate[], locationId: string): RecurringJobTemplate | undefined {
  const mostRecent = (a: RecurringJobTemplate, b: RecurringJobTemplate) => {
    const aDate = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt).getTime();
    const bDate = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt).getTime();
    return bDate - aDate;
  };
  return templates
    .filter((t) => t.isActive && isPmTemplate(t, locationId))
    .sort(mostRecent)[0];
}

export default function PMScheduleCard({ locationId, locationName, companyId, clientId, open, onOpenChange }: PMScheduleCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState("");
  // Cross-template job discovery: stores a job found from ANY template for this location
  // (including archived ones), so the "This month" row can display it as a fallback
  const [discoveredJob, setDiscoveredJob] = useState<{ id: string; jobNumber: number; summary: string; status: string } | null>(null);

  const canHardDelete = HARD_DELETE_ROLES.includes(user?.role ?? "");

  // Fetch all templates for the company (filtered client-side for this location)
  const { data: templates = [] } = useQuery<RecurringJobTemplate[]>({
    queryKey: ["/api/recurring-templates"],
  });

  const pmTemplate = useMemo(() => findPMTemplate(templates, locationId), [templates, locationId]);

  // Current month metadata
  const currentMonth = new Date().getMonth() + 1; // 1-indexed
  const currentMonthIncluded = pmTemplate?.monthsOfYear?.includes(currentMonth) ?? false;
  const { from: monthFrom, to: monthTo } = useMemo(currentMonthRange, []);

  // Current month instances — always fetched when template exists to power the "This month" row
  const { data: currentMonthInstances = [] } = useQuery<InstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", pmTemplate?.id, "instances", "current-month"],
    queryFn: () =>
      apiRequest(`/api/recurring-templates/${pmTemplate!.id}/instances?from=${monthFrom}&to=${monthTo}&limit=10`),
    enabled: Boolean(pmTemplate?.id),
  });

  // Find the generated job for this month — prefer current template's instances,
  // fall back to cross-template discovery (e.g. job created by an archived template)
  const thisMonthJob = useMemo(() => {
    const withJob = currentMonthInstances.find((inst) => inst.job?.id);
    return withJob?.job ?? discoveredJob;
  }, [currentMonthInstances, discoveredJob]);

  // Preview query — fetch upcoming 6 occurrences across next 12 months
  const { data: previewInstances = [], isLoading: previewLoading } = useQuery<InstanceWithJob[]>({
    queryKey: ["/api/recurring-templates", pmTemplate?.id, "instances", "preview"],
    queryFn: () => {
      const today = new Date().toISOString().split("T")[0];
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      return apiRequest(`/api/recurring-templates/${pmTemplate!.id}/instances?from=${today}&to=${future}&limit=6`);
    },
    enabled: Boolean(pmTemplate?.id) && previewOpen,
  });

  // Toggle isActive (pause/resume)
  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      if (!pmTemplate) return;
      return apiRequest(`/api/recurring-templates/${pmTemplate.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !pmTemplate.isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: pmTemplate?.isActive ? "PM schedule paused" : "PM schedule resumed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Soft delete (archive) — sets isActive=false via the default DELETE endpoint
  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!pmTemplate) return;
      return apiRequest(`/api/recurring-templates/${pmTemplate.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      setArchiveDialogOpen(false);
      toast({ title: "PM schedule removed", description: "Existing PM jobs remain and must be removed manually." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Hard delete — permanently removes the template + instances (jobs unaffected)
  const hardDeleteMutation = useMutation({
    mutationFn: async () => {
      if (!pmTemplate) return;
      return apiRequest(`/api/recurring-templates/${pmTemplate.id}?hard=true`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      setHardDeleteDialogOpen(false);
      setHardDeleteConfirmText("");
      toast({ title: "PM schedule permanently deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Generate current month only — scoped windowDays to end of this month
  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!pmTemplate) return;
      const windowDays = computeCurrentMonthWindowDays();
      return apiRequest<{ jobsCreated?: number }>(`/api/recurring-templates/${pmTemplate.id}/generate?windowDays=${windowDays}`, {
        method: "POST",
      });
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Always refresh "This month" row after any generate attempt
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", pmTemplate?.id, "instances", "current-month"] });

      const created = result?.jobsCreated ?? 0;

      if (created > 0) {
        setDiscoveredJob(null); // Clear stale cross-template discovery
        toast({ title: `PM job created for ${MONTH_LABELS[currentMonth - 1]}` });
        return;
      }

      // 0 jobs created — search PM templates for this location (including archived)
      // to find an existing job. The job may have been created by an older template.
      const pmTemplatesForLocation = templates.filter(
        (t) => isPmTemplate(t, locationId) && t.monthsOfYear?.includes(currentMonth)
      );
      let existingJob: InstanceWithJob["job"] | null = null;

      for (const tpl of pmTemplatesForLocation) {
        try {
          const instances = await apiRequest<InstanceWithJob[]>(
            `/api/recurring-templates/${tpl.id}/instances?from=${monthFrom}&to=${monthTo}&limit=10`
          );
          const found = instances.find((inst) => inst.job?.id)?.job ?? null;
          if (found) {
            existingJob = found;
            break;
          }
        } catch {
          // Template may have been hard-deleted mid-loop; skip it
        }
      }

      if (existingJob) {
        setDiscoveredJob(existingJob);
        toast({
          title: `PM job for ${MONTH_LABELS[currentMonth - 1]} already exists`,
          description: `#${existingJob.jobNumber} — ${existingJob.summary}`,
        });
      } else {
        // No job found anywhere — surface clear "none found" message + dev diagnostics
        if (process.env.NODE_ENV !== "production") {
          console.warn("[PM] Generate returned 0 jobs and no existing job found.", {
            templateId: pmTemplate?.id,
            locationId,
            from: monthFrom,
            to: monthTo,
            windowDays: computeCurrentMonthWindowDays(),
            generateResponse: JSON.stringify(result),
            pmTemplatesSearched: pmTemplatesForLocation.map((t) => t.id),
          });
        }
        toast({
          title: `Nothing generated for ${MONTH_LABELS[currentMonth - 1]}`,
          description: "No existing PM job found. Verify generation mode and day-of-month settings.",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Summary helpers
  const monthNames = pmTemplate?.monthsOfYear?.map((m) => MONTH_LABELS[m - 1]).join(", ") ?? "—";
  const generationLabel =
    pmTemplate?.generationMode === "day_of_month"
      ? `Day ${pmTemplate.generationDayOfMonth} of month`
      : pmTemplate?.generationMode === "period_start"
        ? "Start of month"
        : "Phase-based";
  const schedulingLabel = pmTemplate?.autoSchedule
    ? `Auto (${pmTemplate.scheduledTimeLocal ?? "09:00"}, ${pmTemplate.defaultDurationMinutes ?? 120} min)`
    : "Manual";
  const partsLabel = pmTemplate?.includeLocationPmParts ? "Included" : "Not included";

  return (
    <>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-pm-schedule">
              <span className="text-sm font-semibold">Preventive Maintenance Schedule</span>
              <div className="flex items-center gap-2">
                {pmTemplate && (
                  <Badge
                    variant={pmTemplate.isActive ? "default" : "secondary"}
                    className={pmTemplate.isActive ? "bg-green-50 text-green-700 hover:bg-green-50 text-[10px] px-1.5 py-0" : "text-[10px] px-1.5 py-0"}
                  >
                    {pmTemplate.isActive ? "Active" : "Paused"}
                  </Badge>
                )}
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t px-4 pb-4 pt-3 space-y-3 text-sm">
              {!pmTemplate ? (
                <div className="text-center py-2 space-y-3">
                  <p className="text-muted-foreground text-xs">No PM schedule configured for this location.</p>
                  <Button
                    size="sm"
                    onClick={() => { setEditMode(false); setSetupModalOpen(true); }}
                    data-testid="pm-create-btn"
                  >
                    Create PM Schedule
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Months</span>
                      <span className="font-medium">{monthNames}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Job creation</span>
                      <span className="font-medium">{generationLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Scheduling</span>
                      <span className="font-medium">{schedulingLabel}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Parts</span>
                      <span className="font-medium">{partsLabel}</span>
                    </div>
                  </div>

                  {/* This month generated job status row */}
                  {currentMonthIncluded && (
                    <div className="flex items-center justify-between text-xs border rounded-lg px-2.5 py-2 bg-muted/30">
                      <span className="text-muted-foreground">
                        {MONTH_LABELS[currentMonth - 1]} job
                      </span>
                      {thisMonthJob ? (
                        <button
                          type="button"
                          className="font-medium text-primary hover:underline"
                          onClick={() => navigate(`/jobs/${thisMonthJob.id}`)}
                          data-testid="pm-this-month-job-link"
                        >
                          #{thisMonthJob.jobNumber} — {thisMonthJob.status}
                        </button>
                      ) : (
                        <span className="font-medium text-muted-foreground">Not generated</span>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {pmTemplate.isActive && currentMonthIncluded && (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => generateMutation.mutate()}
                        disabled={generateMutation.isPending}
                        data-testid="pm-generate-btn"
                      >
                        <Zap className="h-3 w-3 mr-1" />
                        {generateMutation.isPending ? "Generating..." : "Generate This Month"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => { setEditMode(true); setSetupModalOpen(true); }}
                      data-testid="pm-edit-btn"
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => toggleActiveMutation.mutate()}
                      disabled={toggleActiveMutation.isPending}
                      data-testid="pm-toggle-btn"
                    >
                      {pmTemplate.isActive ? (
                        <><Pause className="h-3 w-3 mr-1" />Pause</>
                      ) : (
                        <><Play className="h-3 w-3 mr-1" />Resume</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPreviewOpen(true)}
                      data-testid="pm-preview-btn"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Preview
                    </Button>
                    {/* Default delete = soft delete (archive) */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setArchiveDialogOpen(true)}
                      data-testid="pm-delete-btn"
                    >
                      <Archive className="h-3 w-3 mr-1" />
                      Remove
                    </Button>
                  </div>

                  {/* Permanent delete link — owner/admin only */}
                  {canHardDelete && (
                    <div className="pt-0.5">
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => setHardDeleteDialogOpen(true)}
                        data-testid="pm-hard-delete-btn"
                      >
                        Delete permanently...
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Setup / Edit Modal */}
      <PMSetupModal
        open={setupModalOpen}
        onOpenChange={setSetupModalOpen}
        locationId={locationId}
        locationName={locationName}
        companyId={companyId}
        clientId={clientId}
        existing={editMode ? pmTemplate : null}
      />

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Upcoming PM Occurrences</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {previewLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : previewInstances.length === 0 ? (
              <p className="text-xs text-muted-foreground">No upcoming occurrences found in the next 12 months.</p>
            ) : (
              previewInstances.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between text-sm border rounded-lg p-2">
                  <span>{format(new Date(inst.instanceDate), "MMM dd, yyyy")}</span>
                  <div className="flex items-center gap-1.5">
                    {inst.job ? (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline font-medium"
                        onClick={() => { setPreviewOpen(false); navigate(`/jobs/${inst.job!.id}`); }}
                      >
                        #{inst.job.jobNumber}
                      </button>
                    ) : null}
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {inst.job ? inst.job.status : inst.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive (soft delete) confirmation */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove PM Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the schedule going forward. No new PM jobs will be generated. Any PM jobs already generated will remain and must be removed manually if you don't want them. The schedule can be restored from the recurring templates page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? "Removing..." : "Remove Schedule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard delete confirmation — requires typing DELETE */}
      <Dialog open={hardDeleteDialogOpen} onOpenChange={(v) => { setHardDeleteDialogOpen(v); if (!v) setHardDeleteConfirmText(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete PM Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              This will permanently delete the PM schedule and all its instance records. Previously generated jobs and invoices are <span className="font-medium text-foreground">not affected</span>.
            </p>
            <p className="text-muted-foreground">
              This action cannot be undone. Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm.
            </p>
            <Input
              value={hardDeleteConfirmText}
              onChange={(e) => setHardDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="font-mono"
              data-testid="pm-hard-delete-confirm-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHardDeleteDialogOpen(false); setHardDeleteConfirmText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => hardDeleteMutation.mutate()}
              disabled={hardDeleteConfirmText !== "DELETE" || hardDeleteMutation.isPending}
              data-testid="pm-hard-delete-confirm-btn"
            >
              {hardDeleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
