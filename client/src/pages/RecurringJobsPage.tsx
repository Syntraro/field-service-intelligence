/**
 * Recurring Jobs Page
 *
 * Manage recurring job templates and generate future job instances.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, RefreshCw, Calendar, Clock, List, ExternalLink, Ban, SkipForward, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO, isPast, isToday } from "date-fns";
// Shared Quick Create Job dialog — used in recurring mode for new template creation
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";

// Types
interface RecurringTemplate {
  id: string;
  title: string;
  description: string | null;
  locationId: string | null;
  recurrenceKind: "weekly" | "monthly";
  interval: number;
  daysOfWeek: number[] | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  openSubStatusDefault: string | null;
  isActive: boolean;
  createdAt: string;
  /** Next computed occurrence date (YYYY-MM-DD), null if inactive or none within 1 year */
  nextOccurrence: string | null;
  /** Job type discriminator — "maintenance" = PM, anything else = recurring job */
  jobType?: string;
  /** Customer company name (joined from customer_companies) */
  clientName?: string | null;
  /** Location site name (joined from client_locations) */
  locationName?: string | null;
  /** Location address (joined from client_locations) */
  locationAddress?: string | null;
}

interface Location {
  id: string;
  companyName: string;
  address: string | null;
}

interface GenerationResult {
  templatesProcessed: number;
  instancesCreated: number;
  jobsCreated: number;
  errors: string[];
}

interface PreviewResult {
  activeTemplates: number;
  pendingInstances: number;
  newInstancesWouldCreate: number;
  jobsWouldCreate: number;
  windowDays: number;
}

interface InstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  claimedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

import { DAYS_OF_WEEK_SHORT as DAYS_OF_WEEK } from "@/lib/schedulingConstants";

/** @param embedded - When true, hides page-level container/header for embedding as a tab in PM workspace */
export default function RecurringJobsPage({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [viewingTemplate, setViewingTemplate] = useState<RecurringTemplate | null>(null);
  const [lastGenerationResult, setLastGenerationResult] = useState<GenerationResult | null>(null);

  // Check if user can edit (owner, admin, dispatcher)
  const canEdit = user?.role && ["owner", "admin", "dispatcher"].includes(user.role);

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    locationId: "",
    recurrenceKind: "weekly" as "weekly" | "monthly",
    interval: 1,
    daysOfWeek: [] as number[],
    dayOfMonth: 1,
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    openSubStatusDefault: null as string | null,
  });

  // Fetch templates — when embedded in PM workspace, filter to recurring_job only (server-side)
  const queryType = embedded ? "recurring_job" : undefined;
  const { data: rawTemplates = [], isLoading } = useQuery<RecurringTemplate[]>({
    queryKey: ["/api/recurring-templates", ...(queryType ? [{ type: queryType }] : [])],
    queryFn: async () => {
      const url = queryType
        ? `/api/recurring-templates?type=${queryType}`
        : "/api/recurring-templates";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch recurring templates");
      return res.json();
    },
  });

  // Sort by next occurrence ascending — active with upcoming dates first, nulls/inactive at bottom
  const templates = useMemo(() => {
    return [...rawTemplates].sort((a, b) => {
      if (a.nextOccurrence && b.nextOccurrence) return a.nextOccurrence.localeCompare(b.nextOccurrence);
      if (a.nextOccurrence) return -1;
      if (b.nextOccurrence) return 1;
      return 0; // Both null — preserve server order
    });
  }, [rawTemplates]);

  // Fetch locations for dropdown — server returns { data: Location[], pagination }
  const { data: locationsResponse } = useQuery<{ data: Location[] }>({
    queryKey: ["/api/clients"],
  });
  const locations = locationsResponse?.data ?? [];

  // Fetch preview counts (what would be generated)
  const { data: previewData } = useQuery<PreviewResult>({
    queryKey: ["/api/recurring-templates/preview"],
    refetchInterval: 60000, // Refresh every minute
    refetchIntervalInBackground: false,
  });

  // Create template mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("/api/recurring-templates", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          locationId: data.locationId || null,
          endDate: data.endDate || null,
          daysOfWeek: data.recurrenceKind === "weekly" ? data.daysOfWeek : null,
          dayOfMonth: data.recurrenceKind === "monthly" ? data.dayOfMonth : null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Template created", description: "Recurring job template has been created." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create template",
        variant: "destructive",
      });
    },
  });

  // Update template mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      return apiRequest(`/api/recurring-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...data,
          locationId: data.locationId || null,
          endDate: data.endDate || null,
          daysOfWeek: data.recurrenceKind === "weekly" ? data.daysOfWeek : null,
          dayOfMonth: data.recurrenceKind === "monthly" ? data.dayOfMonth : null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      setEditingTemplate(null);
      resetForm();
      toast({ title: "Template updated", description: "Recurring job template has been updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update template",
        variant: "destructive",
      });
    },
  });

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/recurring-templates/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: "Template deactivated", description: "Template has been deactivated." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to deactivate template",
        variant: "destructive",
      });
    },
  });

  // Generate jobs mutation
  const generateMutation = useMutation({
    mutationFn: async (windowDays: number = 45) => {
      return apiRequest(`/api/recurring-templates/generate?windowDays=${windowDays}`, {
        method: "POST",
      });
    },
    onSuccess: (result: GenerationResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates/preview"] });
      // Phase 4 Step C5: canonical family key
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      setLastGenerationResult(result);
      toast({
        title: "Jobs generated",
        description: `Created ${result.jobsCreated} jobs from ${result.templatesProcessed} templates.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate jobs",
        variant: "destructive",
      });
    },
  });

  // Compute date range for instances (today to 60 days ahead)
  const today = new Date().toISOString().split("T")[0];
  const sixtyDaysAhead = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Fetch instances for selected template
  const { data: instances = [], isLoading: instancesLoading } = useQuery<InstanceWithJob[]>({
    queryKey: [`/api/recurring-templates/${viewingTemplate?.id}/instances`, { from: today, to: sixtyDaysAhead }],
    queryFn: async () => {
      if (!viewingTemplate) return [];
      const res = await fetch(`/api/recurring-templates/${viewingTemplate.id}/instances?from=${today}&to=${sixtyDaysAhead}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch instances");
      return res.json();
    },
    enabled: !!viewingTemplate,
  });

  // Skip instance mutation
  const skipInstanceMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      return apiRequest(`/api/recurring-templates/instances/${instanceId}/skip`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/recurring-templates/${viewingTemplate?.id}/instances`] });
      toast({ title: "Instance skipped", description: "The instance has been skipped." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to skip instance",
        variant: "destructive",
      });
    },
  });

  // Cancel instance mutation
  const cancelInstanceMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      return apiRequest(`/api/recurring-templates/instances/${instanceId}/cancel`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/recurring-templates/${viewingTemplate?.id}/instances`] });
      toast({ title: "Instance canceled", description: "The instance has been canceled." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel instance",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      locationId: "",
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [],
      dayOfMonth: 1,
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      openSubStatusDefault: null,
    });
  };

  const openEditDialog = (template: RecurringTemplate) => {
    setEditingTemplate(template);
    setFormData({
      title: template.title,
      description: template.description || "",
      locationId: template.locationId || "",
      recurrenceKind: template.recurrenceKind,
      interval: template.interval,
      daysOfWeek: template.daysOfWeek || [],
      dayOfMonth: template.dayOfMonth || 1,
      startDate: template.startDate,
      endDate: template.endDate || "",
      openSubStatusDefault: template.openSubStatusDefault,
    });
  };

  const handleSubmit = () => {
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleDayOfWeek = (day: number) => {
    setFormData((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].sort(),
    }));
  };

  const formatRecurrence = (template: RecurringTemplate) => {
    if (template.recurrenceKind === "weekly") {
      const days = (template.daysOfWeek || [])
        .map((d) => DAYS_OF_WEEK.find((day) => day.value === d)?.label)
        .filter(Boolean)
        .join(", ");
      return template.interval === 1
        ? `Weekly on ${days}`
        : `Every ${template.interval} weeks on ${days}`;
    } else {
      return template.interval === 1
        ? `Monthly on day ${template.dayOfMonth}`
        : `Every ${template.interval} months on day ${template.dayOfMonth}`;
    }
  };

  const getInstanceStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "generated":
        return "default";
      case "pending":
        return "secondary";
      case "claiming":
        return "outline";
      case "skipped":
      case "canceled":
        return "destructive";
      default:
        return "secondary";
    }
  };

  // Edit dialog only — create now uses shared QuickAddJobDialog in recurring mode
  const isEditDialogOpen = editingTemplate !== null;

  return (
    <div className={embedded ? "space-y-6" : "container mx-auto py-6 space-y-6"}>
      {/* Header — hidden when embedded as a tab in PM & Recurring Jobs workspace */}
      {!embedded && (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            {/* 2026-05-07 Service Plans rename: page heading matches the
                renamed sidebar label. The card title below
                ("Recurring Jobs") still names the listed templates
                because they ARE recurring-job records — that's
                behavior copy, not a destination label. */}
            <h1 className="text-title font-bold">Service Plans</h1>
            <p className="text-muted-foreground">
              Manage recurring job templates and generate backlog jobs automatically.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {canEdit && previewData && previewData.jobsWouldCreate > 0 && (
            <span className="text-row text-muted-foreground">
              {previewData.jobsWouldCreate} job{previewData.jobsWouldCreate !== 1 ? "s" : ""} ready to generate
            </span>
          )}
          {canEdit && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => generateMutation.mutate(45)}
                disabled={generateMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
                Generate Next 45 Days
              </Button>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </div>
          )}
        </div>
      </div>
      )}
      {/* Embedded mode: duplicate action buttons removed — workspace-level header provides New Recurring Job + New Maintenance Plan */}

      {/* Last generation result */}
      {lastGenerationResult && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4 text-row">
              <span className="font-medium">Last Generation:</span>
              <Badge variant="secondary">{lastGenerationResult.templatesProcessed} templates</Badge>
              <Badge variant="secondary">{lastGenerationResult.instancesCreated} instances</Badge>
              <Badge variant="default">{lastGenerationResult.jobsCreated} jobs created</Badge>
              {lastGenerationResult.errors.length > 0 && (
                <Badge variant="destructive">{lastGenerationResult.errors.length} errors</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recurring jobs list — when embedded, uses operational columns matching Maintenance tab structure */}
      <Card>
        {!embedded && (
          <CardHeader>
            <CardTitle>Recurring Jobs</CardTitle>
            <CardDescription>
              Active recurring jobs will generate work automatically when you run generation.
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className={embedded ? "pt-2" : ""}>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recurring jobs yet. Create one to get started.
            </div>
          ) : embedded ? (
            /* Embedded table — operational columns: Customer, Location, Recurrence, Due On, Active, Actions */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Recurrence</TableHead>
                  <TableHead>Due On</TableHead>
                  <TableHead>Active</TableHead>
                  {canEdit && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium max-w-[180px]">{template.clientName || "—"}</TableCell>
                    <TableCell>
                      <div className="max-w-[180px]">
                        {template.locationName && <div className="text-row font-medium">{template.locationName}</div>}
                        {template.locationAddress && <div className="text-row text-muted-foreground">{template.locationAddress}</div>}
                        {!template.locationName && !template.locationAddress && "—"}
                      </div>
                    </TableCell>
                    <TableCell>{formatRecurrence(template)}</TableCell>
                    <TableCell>
                      {!template.isActive ? (
                        <span className="text-row text-muted-foreground">Paused</span>
                      ) : template.nextOccurrence ? (
                        <span className={
                          isPast(parseISO(template.nextOccurrence)) && !isToday(parseISO(template.nextOccurrence))
                            ? "text-row text-destructive font-medium"
                            : isToday(parseISO(template.nextOccurrence))
                              ? "text-row text-primary font-medium"
                              : "text-row"
                        }>
                          {format(parseISO(template.nextOccurrence), "MMM d, yyyy")}
                        </span>
                      ) : (
                        <span className="text-row text-muted-foreground">None scheduled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={template.isActive ? "default" : "secondary"}>
                        {template.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" title="View Instances" onClick={() => setViewingTemplate(template)}>
                            <List className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEditDialog(template)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Deactivate" onClick={() => deleteMutation.mutate(template.id)} disabled={deleteMutation.isPending}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            /* Standalone table — original columns for standalone /recurring-jobs page */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Recurrence</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Next Occurrence</TableHead>
                  <TableHead>Active</TableHead>
                  {canEdit && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.title}</TableCell>
                    <TableCell>{formatRecurrence(template)}</TableCell>
                    <TableCell>{template.startDate}</TableCell>
                    <TableCell>
                      {!template.isActive ? (
                        <span className="text-row text-muted-foreground">Paused</span>
                      ) : template.nextOccurrence ? (
                        <span className={
                          isPast(parseISO(template.nextOccurrence)) && !isToday(parseISO(template.nextOccurrence))
                            ? "text-row text-destructive font-medium"
                            : isToday(parseISO(template.nextOccurrence))
                              ? "text-row text-primary font-medium"
                              : "text-row"
                        }>
                          {format(parseISO(template.nextOccurrence), "MMM d, yyyy")}
                        </span>
                      ) : (
                        <span className="text-row text-muted-foreground">None scheduled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={template.isActive ? "default" : "secondary"}>
                        {template.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View Instances"
                            onClick={() => setViewingTemplate(template)}
                          >
                            <List className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => openEditDialog(template)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Deactivate"
                            onClick={() => deleteMutation.mutate(template.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Shared QuickAddJobDialog in recurring mode — canonical create path for new recurring jobs */}
      <QuickAddJobDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        mode="recurring"
      />

      {/* Edit-only Dialog — retained for editing existing recurring templates */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setEditingTemplate(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Changes affect future generated jobs only; existing jobs are not modified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Monthly HVAC Maintenance"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Job description and notes"
              />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select
                value={formData.locationId}
                onValueChange={(value) => setFormData({ ...formData, locationId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.companyName} {loc.address ? `- ${loc.address}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recurrence Kind */}
            <div className="space-y-2">
              <Label>Recurrence</Label>
              <Select
                value={formData.recurrenceKind}
                onValueChange={(value: "weekly" | "monthly") =>
                  setFormData({ ...formData, recurrenceKind: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Interval */}
            <div className="space-y-2">
              <Label htmlFor="interval">
                Every {formData.interval} {formData.recurrenceKind === "weekly" ? "week(s)" : "month(s)"}
              </Label>
              <Input
                id="interval"
                type="number"
                min={1}
                max={52}
                value={formData.interval}
                onChange={(e) => setFormData({ ...formData, interval: parseInt(e.target.value) || 1 })}
              />
            </div>

            {/* Weekly: Days of week */}
            {formData.recurrenceKind === "weekly" && (
              <div className="space-y-2">
                <Label>Days of Week *</Label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day.value} className="flex items-center gap-1">
                      <Checkbox
                        id={`day-${day.value}`}
                        checked={formData.daysOfWeek.includes(day.value)}
                        onCheckedChange={() => toggleDayOfWeek(day.value)}
                      />
                      <Label htmlFor={`day-${day.value}`} className="text-row">
                        {day.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monthly: Day of month */}
            {formData.recurrenceKind === "monthly" && (
              <div className="space-y-2">
                <Label htmlFor="dayOfMonth">Day of Month</Label>
                <Input
                  id="dayOfMonth"
                  type="number"
                  min={1}
                  max={31}
                  value={formData.dayOfMonth}
                  onChange={(e) =>
                    setFormData({ ...formData, dayOfMonth: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
            )}

            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date *</Label>
              <CanonicalDatePicker
                id="startDate"
                value={formData.startDate}
                onChange={(next) => setFormData({ ...formData, startDate: next ?? "" })}
                className="w-full h-9 text-row"
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date (optional)</Label>
              <CanonicalDatePicker
                id="endDate"
                value={formData.endDate}
                onChange={(next) => setFormData({ ...formData, endDate: next ?? "" })}
                placeholder="Optional"
                clearable
                className="w-full h-9 text-row"
              />
            </div>

            {/* Default Sub-Status */}
            <div className="space-y-2">
              <Label>Default Job Sub-Status</Label>
              <Select
                value={formData.openSubStatusDefault ?? "backlog"}
                onValueChange={(value) => setFormData({ ...formData, openSubStatusDefault: value === "backlog" ? null : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog (ready for scheduling)</SelectItem>
                  <SelectItem value="on_hold">On Hold (requires reason)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-row text-muted-foreground">
                All generated jobs have status "Open". This controls the optional sub-status.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditingTemplate(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !formData.title ||
                !formData.startDate ||
                (formData.recurrenceKind === "weekly" && formData.daysOfWeek.length === 0) ||
                updateMutation.isPending
              }
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Instances Dialog */}
      <Dialog open={viewingTemplate !== null} onOpenChange={(open) => {
        if (!open) setViewingTemplate(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Instances: {viewingTemplate?.title}
            </DialogTitle>
            <DialogDescription>
              Next 60 days of scheduled instances
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {instancesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading instances...</div>
            ) : instances.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No instances scheduled for the next 60 days. Run generation to create instances.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((instance) => (
                    <TableRow key={instance.id}>
                      <TableCell className="font-medium">{instance.instanceDate}</TableCell>
                      <TableCell>
                        <Badge variant={getInstanceStatusVariant(instance.status)}>
                          {instance.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {instance.job ? (
                          <Link
                            href={`/jobs/${instance.job.id}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            #{instance.job.jobNumber}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {instance.status === "pending" ? (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Skip this instance"
                              onClick={() => skipInstanceMutation.mutate(instance.id)}
                              disabled={skipInstanceMutation.isPending || cancelInstanceMutation.isPending}
                            >
                              <SkipForward className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancel this instance"
                              onClick={() => cancelInstanceMutation.mutate(instance.id)}
                              disabled={skipInstanceMutation.isPending || cancelInstanceMutation.isPending}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : instance.status === "generated" ? (
                          <span className="text-row text-muted-foreground">Open job to modify</span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingTemplate(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
