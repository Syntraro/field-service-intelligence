import { useState, useEffect } from "react";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Phone,
  Mail,
  Plus,
  Star,
  Pencil,
  Trash2,
  Briefcase,
  FileText,
  ChevronRight,
  Settings,
} from "lucide-react";
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
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import EditClientDialog from "@/components/EditClientDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Client, CustomerCompany, ClientNote, Job, Invoice } from "@shared/schema";

type OverviewTab = "activeWork" | "jobs" | "invoices";

type CompanyOverview = {
  company: CustomerCompany;
  locations: Client[];
  jobs: Job[];
  invoices: Invoice[];
  stats?: {
    totalLocations: number;
    openJobs: number;
    openInvoices: number;
  };
};

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [overviewTab, setOverviewTab] = useState<OverviewTab>("activeWork");
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [preselectedLocationId, setPreselectedLocationId] = useState<string | undefined>();
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const {
    data: client,
    isLoading: clientLoading,
    error: clientError,
  } = useQuery<Client>({
    queryKey: ["/api/clients", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch client");
      return res.json();
    },
    enabled: Boolean(clientId),
  });

  const { data: parentCompany } = useQuery<CustomerCompany>({
    queryKey: [`/api/customer-companies/${client?.parentCompanyId}`],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${client?.parentCompanyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch parent company");
      return res.json();
    },
    enabled: Boolean(client?.parentCompanyId),
  });

  /**
   * ✅ LONG-TERM FIX:
   * Replace separate /locations, /jobs?clientId, /invoices?clientId with ONE canonical call:
   *   GET /api/customer-companies/:parentCompanyId/overview
   *
   * Backend should roll up jobs+invoices via locationIds (schema-correct).
   */
  const { data: overview } = useQuery<CompanyOverview>({
    queryKey: ["/api/customer-companies", client?.parentCompanyId, "overview"],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${client?.parentCompanyId}/overview`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch company overview");
      return res.json();
    },
    enabled: Boolean(client?.parentCompanyId),
  });

  // Keep your existing variable names so the UI doesn’t change.
  const locations: Client[] = overview?.locations ?? [];
  const jobs: Job[] = overview?.jobs ?? [];
  const invoices: Invoice[] = overview?.invoices ?? [];

  const { data: notes = [] } = useQuery<ClientNote[]>({
    queryKey: ["/api/client-notes", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/client-notes?clientId=${clientId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
    enabled: Boolean(clientId),
  });

  /**
   * ✅ IMPORTANT FIX:
   * Jobs do NOT have job.clientId in your schema model.
   * Rollups must match on job.locationId.
   */
  const companyJobs = jobs.filter((job) => {
    // If overview returned locations, only include jobs that belong to those locations
    if (locations.length) return locations.some((loc) => loc.id === job.locationId);

    // If locations didn’t load for any reason, treat the current "clientId" as a location id
    return job.locationId === clientId;
  });

  const overdueJobs = companyJobs.filter((j) => {
    if (!j.scheduledStart) return false;
    const isPastDue = new Date(j.scheduledStart) < new Date();
    const isOpenStatus = j.status !== "completed" && j.status !== "invoiced" && j.status !== "cancelled";
    return isPastDue && isOpenStatus;
  });

  const overdueJobIds = new Set(overdueJobs.map((j) => j.id));
  const activeJobs = companyJobs.filter(
    (j) => (j.status === "in_progress" || j.status === "scheduled") && !overdueJobIds.has(j.id)
  );

  const createNoteMutation = useMutation({
    mutationFn: async (noteText: string) => {
      const res = await apiRequest(`/api/client-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, noteText }),
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-notes", clientId] });
      setNewNoteContent("");
      setIsAddingNote(false);
      toast({ title: "Note added", description: "The note has been added successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add note.", variant: "destructive" });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, noteText }: { noteId: string; noteText: string }) => {
      const res = await apiRequest(`/api/client-notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText }),
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-notes", clientId] });
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
      await apiRequest(`/api/client-notes/${noteId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-notes", clientId] });
      setDeleteNoteId(null);
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete note.", variant: "destructive" });
    },
  });

  const handleCreateJob = (locationId?: string) => {
    setPreselectedLocationId(locationId || clientId);
    setJobDialogOpen(true);
  };

  const handleGoToLocation = (targetLocationId: string) => {
    setLocation(`/clients/${clientId}/locations/${targetLocationId}`);
  };

  if (clientLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Skeleton className="h-64" />
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-lg font-semibold text-destructive">Client not found</h2>
          <p className="text-muted-foreground mt-2">
            The client you're looking for doesn't exist or you don't have access.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/?tab=clients")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Client List
          </Button>
        </div>
      </div>
    );
  }

  const companyName = parentCompany?.name || client.companyName;
  const clientType = "Corporate Client";
  const isActive = !client.inactive;
  const billParent = client.billWithParent ?? true;

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm" data-testid="breadcrumb">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <button
              type="button"
              className="font-medium text-primary hover:text-primary/80 hover:underline transition-colors"
              onClick={() => setLocation("/?tab=clients")}
              data-testid="breadcrumb-clients"
            >
              Clients
            </button>
          </li>
          <li className="flex items-center">
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="font-medium text-foreground">{companyName}</span>
          </li>
        </ol>
      </nav>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-client-name">
            {companyName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>{clientType}</span>
            <span>•</span>
            <Badge variant={isActive ? "default" : "secondary"} className="text-xs">
              {isActive ? "Active" : "Inactive"}
            </Badge>
            <span>•</span>
            <span>
              Bill Parent: <span className="font-medium">{billParent ? "Yes" : "No"}</span>
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditDialogOpen(true)} data-testid="button-edit-client">
            <Pencil className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button onClick={() => handleCreateJob()} data-testid="button-create-job">
            <Briefcase className="h-4 w-4 mr-2" />
            Create Job
          </Button>
          <Link href={`/invoices/new?clientId=${clientId}`}>
            <Button variant="outline" data-testid="button-create-invoice">
              <FileText className="h-4 w-4 mr-2" />
              Create Invoice
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Grid: Properties + Overview (2fr) | Contact + Notes (1fr) */}
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        {/* LEFT COLUMN: Properties + Overview */}
        <div className="space-y-4">
          {/* Properties */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Properties</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {locations.length === 0 ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover-elevate"
                    onClick={() => handleGoToLocation(clientId!)}
                    data-testid={`row-location-${clientId}`}
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        <span>{client.location || "Primary Location"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {client.city}, {client.province} {client.postalCode}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ) : (
                  locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover-elevate"
                      onClick={() => handleGoToLocation(loc.id)}
                      data-testid={`row-location-${loc.id}`}
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {loc.id === clientId && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />}
                          <span>{loc.location || loc.companyName}</span>
                          {loc.inactive && (
                            <Badge variant="secondary" className="text-xs">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {loc.city}, {loc.province} {loc.postalCode}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Overview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Overview</CardTitle>
            </CardHeader>
            <CardContent>
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

              <div className="max-h-72 overflow-y-auto pr-1">
                {overviewTab === "activeWork" && (
                  <div className="space-y-4">
                    {activeJobs.length === 0 && overdueJobs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active jobs for this client.</p>
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
                                    {locations.find((l) => l.id === job.locationId)?.location || "Location"}
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
                                    {locations.find((l) => l.id === job.locationId)?.location || "Location"}
                                  </p>
                                </div>
                                <Badge variant={job.status === "in_progress" ? "default" : "secondary"}>
                                  {job.status === "in_progress" ? "In Progress" : "Scheduled"}
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
                    <p className="text-sm text-muted-foreground">Total jobs: {companyJobs.length}</p>
                    {companyJobs.slice(0, 5).map((job) => (
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
                            {locations.find((l) => l.id === job.locationId)?.location || "Location"}
                          </p>
                        </div>
                        <Badge
                          variant={
                            job.status === "completed"
                              ? "default"
                              : job.status === "in_progress"
                              ? "default"
                              : job.status === "scheduled"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>
                    ))}
                    {companyJobs.length > 5 && (
                      <p className="text-xs text-muted-foreground">+ {companyJobs.length - 5} more jobs</p>
                    )}
                  </div>
                )}

                {overviewTab === "invoices" &&
                  (invoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No invoices yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {invoices.slice(0, 5).map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between p-3 border rounded-lg hover-elevate cursor-pointer"
                          onClick={() => setLocation(`/invoices/${inv.id}`)}
                          data-testid={`row-invoice-${inv.id}`}
                        >
                          <div>
                            <p className="font-medium text-sm text-primary hover:underline">
                              {inv.invoiceNumber || `INV-${inv.id.slice(0, 6).toUpperCase()}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {inv.issueDate ? format(new Date(inv.issueDate), "MMM d, yyyy") : "—"} • Due:{" "}
                              {inv.dueDate ? format(new Date(inv.dueDate), "MMM d, yyyy") : "—"}
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge
                              variant={
                                inv.status === "paid"
                                  ? "default"
                                  : inv.status === "sent"
                                  ? "secondary"
                                  : inv.status === "draft"
                                  ? "outline"
                                  : "destructive"
                              }
                            >
                              {inv.status}
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
                                Number(inv.total ?? 0)
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                      {invoices.length > 5 && (
                        <p className="text-xs text-muted-foreground">+ {invoices.length - 5} more invoices</p>
                      )}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Contact + Notes */}
        <div className="space-y-4">
          {/* Contact Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact Name</span>
                <span data-testid="text-contact-name">{client.contactName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                {client.phone ? (
                  <a href={`tel:${client.phone}`} className="hover:text-primary" data-testid="link-contact-phone">
                    {client.phone}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="hover:text-primary" data-testid="link-contact-email">
                    {client.email}
                  </a>
                ) : (
                  <span>—</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes Card */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Notes</CardTitle>
              {!isAddingNote && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto p-0 text-primary"
                  onClick={() => setIsAddingNote(true)}
                  data-testid="button-add-note"
                >
                  + Add Note
                </Button>
              )}
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto space-y-3">
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
                      data-testid="button-save-note"
                    >
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsAddingNote(false);
                        setNewNoteContent("");
                      }}
                      data-testid="button-cancel-note"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {notes.length === 0 && !isAddingNote && (
                <p className="text-xs text-muted-foreground">
                  No notes yet. Use "Add Note" to record client-wide information.
                </p>
              )}

              {notes.map((note) => (
                <div key={note.id} className="p-2 border rounded-lg text-sm" data-testid={`card-note-${note.id}`}>
                  {editingNoteId === note.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editNoteContent}
                        onChange={(e) => setEditNoteContent(e.target.value)}
                        className="min-h-[60px]"
                        data-testid="textarea-edit-note"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            updateNoteMutation.mutate({ noteId: note.id, noteText: editNoteContent.trim() })
                          }
                          disabled={!editNoteContent.trim() || updateNoteMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingNoteId(null);
                            setEditNoteContent("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive ml-auto"
                          onClick={() => setDeleteNoteId(note.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer"
                      onClick={() => {
                        setEditingNoteId(note.id);
                        setEditNoteContent(note.noteText);
                      }}
                    >
                      <p className="text-xs text-muted-foreground mb-1">
                        {note.createdAt ? format(new Date(note.createdAt), "MMM dd, yyyy") : "—"}
                      </p>
                      <p className="whitespace-pre-wrap">{note.noteText}</p>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <QuickAddJobDialog open={jobDialogOpen} onOpenChange={setJobDialogOpen} preselectedLocationId={preselectedLocationId} />

      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => !open && setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this note? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNoteId && deleteNoteMutation.mutate(deleteNoteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {client && (
        <EditClientDialog
          client={client}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
            queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", client.parentCompanyId, "locations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", client.parentCompanyId, "overview"] });
            setEditDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}
