import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Briefcase, FileText, Trash2, ChevronDown, ChevronRight, Star } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import LocationFormModal from "@/components/LocationFormModal";
import { PartsSelectorModal } from "@/components/PartsSelectorModal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Client, CustomerCompany, ClientNote, Job, LocationPMPartTemplate, LocationEquipment } from "@shared/schema";
import { isJobOverdue, isJobScheduled } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function LocationDetailPage() {
  // Support both:
  // - Nested route: /clients/:id/locations/:locationId
  // - Direct route: /locations/:locationId (id will be undefined)
  const { id, locationId } = useParams<{ id?: string; locationId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [newEquipmentData, setNewEquipmentData] = useState({
    name: "",
    equipmentType: "",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
  });

  // Collapsible states
  const [pmOpen, setPmOpen] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [billingOpen, setBillingOpen] = useState(false);

  type OverviewTab = "activeWork" | "jobs" | "invoices";
  const [overviewTab, setOverviewTab] = useState<OverviewTab>("activeWork");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deleteLocationDialogOpen, setDeleteLocationDialogOpen] = useState(false);

  const { data: location, isLoading: locationLoading, error: locationError } = useQuery<Client>({
    queryKey: ["/api/clients", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${locationId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch location");
      return res.json();
    },
    enabled: Boolean(locationId),
  });

  const { data: parentClient } = useQuery<Client>({
    queryKey: ["/api/clients", id],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch parent client");
      return res.json();
    },
    enabled: Boolean(id),
  });

  const effectiveParentCompanyId = useMemo(() => {
    // Prefer real parentCompanyId on the location row.
    // Fallback to route param `id` (company route id) when legacy rows aren't linked.
    return location?.parentCompanyId || id;
  }, [location?.parentCompanyId, id]);

  const { data: parentCompany } = useQuery<CustomerCompany>({
    queryKey: ["/api/customer-companies", effectiveParentCompanyId],
    enabled: Boolean(effectiveParentCompanyId),
  });

  const { data: notes = [] } = useQuery<ClientNote[]>({
    queryKey: ["/api/clients", locationId, "notes"],
    queryFn: async () => {
      return await apiRequest(`/api/clients/${locationId}/notes`);
    },
    enabled: Boolean(locationId),
  });

  const { data: equipment = [] } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", locationId, "equipment"],
    queryFn: async () => {
      return await apiRequest(`/api/clients/${locationId}/equipment`);
    },
    enabled: Boolean(locationId),
  });

  const { data: pmParts = [] } = useQuery<LocationPMPartTemplate[]>({
    queryKey: ["/api/locations", locationId, "pm-parts"],
    enabled: false,  // ✅ DISABLE - endpoint doesn't exist
  });

  const { data: partsData } = useQuery<{ items: { id: string; name: string | null; sku: string | null }[] }>({
    queryKey: ["/api/items"],
    enabled: Boolean(locationId) && pmParts.length > 0,
  });
  const allParts = partsData?.items || [];

  const { data: jobs = [] } = useQuery<{ data: Job[]; meta: { limit: number; hasMore: boolean; nextOffset?: number } }, Error, Job[]>({
    queryKey: ["/api/jobs", { offset: 0, limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/jobs?offset=0&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
    select: (response) => response.data,
    enabled: Boolean(locationId),
  });

  const locationJobs = jobs.filter(j => j.locationId === locationId);
  // Use canonical isJobOverdue predicate
  const overdueJobs = locationJobs.filter(j => isJobOverdue(j));
  const activeJobs = locationJobs.filter(j =>
    // Active = open + (scheduled OR in_progress)
    // Use canonical isJobScheduled predicate for scheduled check
    j.status === "open" &&
    (isJobScheduled(j) || j.openSubStatus === "in_progress") &&
    !overdueJobs.some(o => o.id === j.id)
  );

  const toggleBillWithParentMutation = useMutation({
    mutationFn: async (billWithParent: boolean) => {
      return await apiRequest(`/api/clients/${locationId}`, {
        method: "PATCH",
        body: JSON.stringify({ billWithParent }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId] });
      toast({ title: "Billing updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update billing.", variant: "destructive" });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/clients/${locationId}/set-primary`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId] });
      // refresh company overview + locations list if applicable
      queryClient.invalidateQueries({ queryKey: ["/api/clients", id, "overview"] });
      if (effectiveParentCompanyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", effectiveParentCompanyId, "overview"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", effectiveParentCompanyId, "locations"] });
      }
      toast({ title: "Primary location updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to set as primary.", variant: "destructive" });
    },
  });

  const createNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      return await apiRequest(`/api/clients/${locationId}/notes`, {
        method: "POST",
        body: JSON.stringify({ noteText }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "notes"] });
      setNewNoteContent("");
      setIsAddingNote(false);
      toast({ title: "Note added" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add note.", variant: "destructive" });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, noteText }: { noteId: string; noteText: string }) => {
      return await apiRequest(`/api/clients/${locationId}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify({ noteText }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "notes"] });
      setEditingNoteId(null);
      setEditNoteContent("");
      toast({ title: "Note updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update note.", variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest(`/api/clients/${locationId}/notes/${noteId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "notes"] });
      setDeleteNoteId(null);
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/clients/${locationId}`, {
        method: "PATCH",
        body: JSON.stringify({ inactive: true }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setDeleteLocationDialogOpen(false);
      toast({ title: "Location deleted", description: "The location has been marked as inactive." });
      // Navigate to parent company if available, otherwise to clients list
      setLocation(effectiveParentCompanyId ? `/clients/${effectiveParentCompanyId}` : "/clients");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete location.", variant: "destructive" });
    },
  });

  const createEquipmentMutation = useMutation({
    mutationFn: async (data: typeof newEquipmentData) => {
      return await apiRequest(`/api/clients/${locationId}/equipment`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] });
      setEquipmentModalOpen(false);
      setNewEquipmentData({ name: "", equipmentType: "", manufacturer: "", modelNumber: "", serialNumber: "" });
      toast({ title: "Equipment added" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add equipment.", variant: "destructive" });
    },
  });

  const deleteEquipmentMutation = useMutation({
    mutationFn: async (equipmentId: string) => {
      await apiRequest(`/api/clients/${locationId}/equipment/${equipmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] });
      toast({ title: "Equipment removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove equipment.", variant: "destructive" });
    },
  });

  if (locationLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (locationError || !location) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-destructive">Location not found</h2>
          <p className="text-muted-foreground mt-2">The location you're looking for doesn't exist.</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation(id ? `/clients/${id}` : "/clients")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {id ? "Back to Client" : "Back to Clients"}
          </Button>
        </div>
      </div>
    );
  }

  const companyName = parentCompany?.name || parentClient?.companyName || location?.companyName || "Client";
  const locationName =
    location.location?.trim() ||
    (location.address ? `${location.address}${location.city ? `, ${location.city}` : ""}` : null) ||
    "Unnamed Location";

  const isActive = !location.inactive;
  const billParent = location.billWithParent ?? true;

  const canShowSetPrimary = !location.isPrimary && Boolean(effectiveParentCompanyId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-50 text-green-700 hover:bg-green-50">Completed</Badge>;
      case "in_progress":
        return <Badge variant="default">In Progress</Badge>;
      case "scheduled":
        return <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">Scheduled</Badge>;
      case "overdue":
        return <Badge variant="destructive">Overdue</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm" data-testid="breadcrumb">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <button
              type="button"
              className="font-medium text-primary hover:text-primary/80 hover:underline transition-colors"
              onClick={() => setLocation(effectiveParentCompanyId ? `/clients/${effectiveParentCompanyId}` : "/clients")}
              data-testid="breadcrumb-client"
            >
              {companyName}
            </button>
          </li>
          <li className="flex items-center">
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="font-medium text-foreground">{locationName}</span>
          </li>
        </ol>
      </nav>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold" data-testid="text-location-name">
              {locationName}
            </h1>
            {location.isPrimary && <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {location.address}, {location.city} {location.province} {location.postalCode}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant={isActive ? "default" : "secondary"}
              className={isActive ? "bg-blue-50 text-blue-700 hover:bg-blue-50" : ""}
            >
              {isActive ? "Active" : "Inactive"}
            </Badge>
            {location.isPrimary && (
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                Primary
              </Badge>
            )}
            <span className="text-muted-foreground">
              Bill Parent: <span className="font-medium">{billParent ? "Yes" : "No"}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canShowSetPrimary && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrimaryMutation.mutate()}
              disabled={setPrimaryMutation.isPending}
              data-testid="button-set-primary"
            >
              <Star className="h-3.5 w-3.5 mr-1.5" />
              Set as Primary
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditModalOpen(true)}
            data-testid="button-edit-location"
          >
            Edit Location
          </Button>

          <Button size="sm" onClick={() => setJobDialogOpen(true)} data-testid="button-create-job">
            <Briefcase className="h-3.5 w-3.5 mr-1.5" />
            Create Job
          </Button>

          <Button variant="outline" size="sm" data-testid="button-create-invoice">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Create Invoice
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteLocationDialogOpen(true)}
            data-testid="button-delete-location"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </header>

      {/* Main 2-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-[3fr,2fr] flex-1 min-h-0">
        {/* LEFT: Overview */}
        <div className="flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Overview</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0">
              <div className="border-b mb-4">
                <nav className="-mb-px flex flex-wrap gap-4">
                  {[
                    { value: "activeWork", label: "Active Work" },
                    { value: "jobs", label: "Jobs" },
                    { value: "invoices", label: "Invoices" },
                  ].map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setOverviewTab(tab.value as OverviewTab)}
                      className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                        overviewTab === tab.value
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                      }`}
                      data-testid={`tab-overview-${tab.value}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 min-h-0">
                {overviewTab === "activeWork" && (
                  <div className="space-y-4">
                    {activeJobs.length === 0 && overdueJobs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active jobs for this location.</p>
                    ) : (
                      <>
                        {overdueJobs.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-medium text-destructive uppercase">
                              Overdue ({overdueJobs.length})
                            </h4>
                            {overdueJobs.map((job) => (
                              <div
                                key={job.id}
                                className="flex items-center justify-between p-3 border rounded-lg hover-elevate cursor-pointer"
                                onClick={() => setLocation(`/jobs/${job.id}`)}
                                data-testid={`row-job-${job.id}`}
                              >
                                <div>
                                  <p className="font-medium text-sm text-primary hover:underline">
                                    #{job.jobNumber} • {job.summary}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {job.scheduledStart
                                      ? format(new Date(job.scheduledStart), "MMM dd, yyyy")
                                      : "Not scheduled"}
                                  </p>
                                </div>
                                <Badge variant="destructive">Overdue</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                        {activeJobs.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase">
                              Active ({activeJobs.length})
                            </h4>
                            {activeJobs.map((job) => (
                              <div
                                key={job.id}
                                className="flex items-center justify-between p-3 border rounded-lg hover-elevate cursor-pointer"
                                onClick={() => setLocation(`/jobs/${job.id}`)}
                                data-testid={`row-job-${job.id}`}
                              >
                                <div>
                                  <p className="font-medium text-sm text-primary hover:underline">
                                    #{job.jobNumber} • {job.summary}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {job.scheduledStart
                                      ? format(new Date(job.scheduledStart), "MMM dd, yyyy")
                                      : "Not scheduled"}
                                  </p>
                                </div>
                                <Badge variant={job.openSubStatus === "in_progress" ? "default" : "secondary"}>
                                  {job.openSubStatus === "in_progress" ? "In Progress" : "Scheduled"}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {overviewTab === "jobs" && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground mb-3">Total jobs: {locationJobs.length}</p>
                    {locationJobs.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No jobs yet for this location.</p>
                    ) : (
                      locationJobs.map((job) => {
                        const isOverdue =
                          job.scheduledStart &&
                          new Date(job.scheduledStart) < new Date() &&
                          job.status !== "completed" &&
                          job.status !== "cancelled";
                        return (
                          <div
                            key={job.id}
                            className="flex items-center justify-between rounded-lg border p-3 text-sm hover-elevate cursor-pointer"
                            onClick={() => setLocation(`/jobs/${job.id}`)}
                            data-testid={`row-job-${job.id}`}
                          >
                            <div>
                              <div className="font-medium text-primary hover:underline">
                                #{job.jobNumber} • {job.summary}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {job.scheduledStart
                                  ? format(new Date(job.scheduledStart), "MMM dd, yyyy")
                                  : "Not scheduled"}
                              </div>
                            </div>
                            {isOverdue ? <Badge variant="destructive">Overdue</Badge> : getStatusBadge(job.status)}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {overviewTab === "invoices" && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">No invoices yet for this location.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT column unchanged below */}
        {/* ... keep your existing right-column cards exactly as before ... */}
        <div className="space-y-3">
          {/* PM Schedule */}
          <Collapsible open={pmOpen} onOpenChange={setPmOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-pm-schedule">
                  <span className="text-sm font-semibold">Preventive Maintenance Schedule</span>
                  {pmOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3 space-y-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">PM Type</div>
                    <Select defaultValue="quarterly">
                      <SelectTrigger>
                        <SelectValue placeholder="Select PM type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quarterly">Quarterly PM</SelectItem>
                        <SelectItem value="biannual">Bi-Annual PM</SelectItem>
                        <SelectItem value="annual">Annual PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Scheduled Months</div>
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs text-muted-foreground">Not configured</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Last PM: <span className="font-medium text-foreground">—</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Next PM: <span className="font-medium text-foreground">—</span></span>
                      {overdueJobs.length > 0 && (
                        <Badge variant="destructive" className="text-xs">Overdue</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Equipment */}
          <Collapsible open={equipmentOpen} onOpenChange={setEquipmentOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-equipment">
                  <span className="text-sm font-semibold">Equipment</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto p-0 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEquipmentModalOpen(true);
                      }}
                      data-testid="button-add-equipment"
                    >
                      + Add
                    </Button>
                    {equipmentOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3 max-h-48 overflow-y-auto space-y-2">
                  {equipment.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No equipment added yet for this location.
                    </p>
                  ) : (
                    equipment.map((eq) => (
                      <div key={eq.id} className="rounded-lg border p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{eq.name}</div>
                            <div className="text-xs text-muted-foreground">{eq.equipmentType || "—"}</div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteEquipmentMutation.mutate(eq.id)}
                            data-testid={`button-delete-equipment-${eq.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {eq.manufacturer || ""} {eq.modelNumber || ""} {(eq.manufacturer || eq.modelNumber) && eq.serialNumber ? "•" : ""} S/N: {eq.serialNumber || "—"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* PM Parts */}
          <Collapsible open={partsOpen} onOpenChange={setPartsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-parts">
                  <span className="text-sm font-semibold">Location Parts</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto p-0 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPartsModalOpen(true);
                      }}
                      data-testid="button-add-parts"
                    >
                      + Add
                    </Button>
                    {partsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3 max-h-48 overflow-y-auto">
                  {pmParts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No PM parts configured. Add filters, belts, and other recurring parts.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {pmParts.map((pmPart) => {
                        const part = allParts.find(p => p.id === pmPart.productId);
                        return (
                          <div key={pmPart.id} className="flex items-center justify-between text-sm rounded-lg border p-2">
                            <div>
                              <div className="font-medium">{part?.name || "Unknown Part"}</div>
                              <div className="text-xs text-muted-foreground">{part?.sku || ""}</div>
                            </div>
                            <span className="text-xs text-muted-foreground">x{pmPart.quantityPerVisit}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Notes */}
          <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-notes">
                  <span className="text-sm font-semibold">Notes</span>
                  <div className="flex items-center gap-2">
                    {!isAddingNote && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-auto p-0 text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNotesOpen(true);
                          setIsAddingNote(true);
                        }}
                        data-testid="button-add-note"
                      >
                        + Add
                      </Button>
                    )}
                    {notesOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3 max-h-48 overflow-y-auto space-y-2">
                  {isAddingNote && (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Enter note..."
                        value={newNoteContent}
                        onChange={(e) => setNewNoteContent(e.target.value)}
                        className="min-h-[60px]"
                        data-testid="textarea-new-note"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => createNoteMutation.mutate(newNoteContent.trim())}
                          disabled={!newNoteContent.trim() || createNoteMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setIsAddingNote(false); setNewNoteContent(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {notes.length === 0 && !isAddingNote && (
                    <p className="text-xs text-muted-foreground">
                      No notes yet. Use notes to record access info, landlord details, etc.
                    </p>
                  )}

                  {notes.map((note) => (
                    <div key={note.id} className="p-2 border rounded-lg text-sm" data-testid={`card-note-${note.id}`}>
                      <p className="text-xs text-muted-foreground mb-1">
                        {format(new Date(note.createdAt), "MMM dd, yyyy")}
                      </p>
                      <p className="whitespace-pre-wrap text-xs">{note.noteText}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Billing */}
          <Collapsible open={billingOpen} onOpenChange={setBillingOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-billing">
                  <span className="text-sm font-semibold">Billing Settings</span>
                  {billingOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Bill with Parent</p>
                      <p className="text-xs text-muted-foreground">
                        {billParent ? "Invoices go to parent company" : "Invoices go directly to this location"}
                      </p>
                    </div>
                    <Switch
                      checked={billParent}
                      onCheckedChange={(checked) => toggleBillWithParentMutation.mutate(checked)}
                      disabled={toggleBillWithParentMutation.isPending}
                      data-testid="switch-bill-with-parent"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>

      {/* Dialogs */}
      <QuickAddJobDialog open={jobDialogOpen} onOpenChange={setJobDialogOpen} preselectedLocationId={locationId} />

      <PartsSelectorModal open={partsModalOpen} onOpenChange={setPartsModalOpen} locationId={locationId!} existingParts={pmParts} />

      <LocationFormModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        location={location}
        locationId={locationId}
        companyId={location?.companyId || ""}
        parentCompanyId={effectiveParentCompanyId || undefined}
        onSuccess={() => {
          setEditModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId] });
          queryClient.invalidateQueries({ queryKey: ["/api/clients", id, "overview"] });
          if (effectiveParentCompanyId) {
            queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", effectiveParentCompanyId, "locations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", effectiveParentCompanyId, "overview"] });
          }
        }}
      />

      <AlertDialog open={deleteLocationDialogOpen} onOpenChange={setDeleteLocationDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this location? The location will be marked as inactive and hidden from the active locations list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteLocationMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteLocationMutation.isPending}
            >
              {deleteLocationMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={equipmentModalOpen} onOpenChange={setEquipmentModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Equipment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="eq-name">Name *</Label>
              <Input
                id="eq-name"
                placeholder="e.g., RTU #1, Walk-in Freezer"
                value={newEquipmentData.name}
                onChange={(e) => setNewEquipmentData({ ...newEquipmentData, name: e.target.value })}
                data-testid="input-equipment-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq-type">Equipment Type</Label>
              <Input
                id="eq-type"
                placeholder="e.g., RTU, Furnace, Freezer"
                value={newEquipmentData.equipmentType}
                onChange={(e) => setNewEquipmentData({ ...newEquipmentData, equipmentType: e.target.value })}
                data-testid="input-equipment-type"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eq-manufacturer">Manufacturer</Label>
              <Input
                id="eq-manufacturer"
                placeholder="e.g., Carrier, Trane"
                value={newEquipmentData.manufacturer}
                onChange={(e) => setNewEquipmentData({ ...newEquipmentData, manufacturer: e.target.value })}
                data-testid="input-equipment-manufacturer"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-model">Model Number</Label>
                <Input
                  id="eq-model"
                  placeholder="Model #"
                  value={newEquipmentData.modelNumber}
                  onChange={(e) => setNewEquipmentData({ ...newEquipmentData, modelNumber: e.target.value })}
                  data-testid="input-equipment-model"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-serial">Serial Number</Label>
                <Input
                  id="eq-serial"
                  placeholder="Serial #"
                  value={newEquipmentData.serialNumber}
                  onChange={(e) => setNewEquipmentData({ ...newEquipmentData, serialNumber: e.target.value })}
                  data-testid="input-equipment-serial"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEquipmentModalOpen(false);
                setNewEquipmentData({ name: "", equipmentType: "", manufacturer: "", modelNumber: "", serialNumber: "" });
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createEquipmentMutation.mutate(newEquipmentData)}
              disabled={!newEquipmentData.name.trim() || createEquipmentMutation.isPending}
              data-testid="button-save-equipment"
            >
              {createEquipmentMutation.isPending ? "Adding..." : "Add Equipment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}