/**
 * ClientDetailPage — Card-based client workspace.
 *
 * Layout:
 *   [Header Card — full width]
 *   [Left Column: Rail + Workspace card | Right Column: Contacts/Notes/Activity cards]
 *
 * Scope model:
 *   scopeType = "company" | "location"
 *   When "company" → center shows company-scoped data, right shows company metadata
 *   When "location" → center shows location-scoped data, right shows location metadata
 *
 * Route: /clients/:clientId
 * URL params: ?scope=company|location&location=<id>&tab=<workspaceTab>
 */
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Briefcase, FileText, MapPin, MoreHorizontal, Search,
  Wrench, Receipt, Phone, Mail, Star, Trash2, Pencil,
  Clock, Package, StickyNote, Tag, Building2, AlertTriangle, Archive,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import LocationFormModal from "@/components/LocationFormModal";
import NotesPanel, { type NotesPanelRef } from "@/components/NotesPanel";
import PMScheduleCard from "@/components/PMScheduleCard";
import { PartsSelectorModal } from "@/components/PartsSelectorModal";
import EditTagsModal from "@/components/EditTagsModal";
import { ContactFormDialog, STANDARD_CONTACT_ROLES, type ContactScope } from "@/components/ContactFormDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type {
  Client, CustomerCompany, Job, Invoice, ClientContact, ClientTag, Quote,
  LocationEquipment, LocationPMPartTemplate,
} from "@shared/schema";
import { isJobOverdue } from "@shared/schema";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { getJobStatusDisplay } from "@/components/job/jobUtils";
import { getInvoiceStatusBadge } from "@/lib/statusBadges";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Scope model: company overview or a specific location */
type ScopeType = "company" | "location";

/** Workspace tabs — company scope has fewer tabs (no equipment/pm/parts) */
type WorkspaceTab = "overview" | "jobs" | "invoices" | "quotes" | "equipment" | "pm" | "parts";

// ContactScope type and STANDARD_CONTACT_ROLES imported from @/components/ContactFormDialog

/** Normalize a contact record into a consistent shape for rendering */
function normalizeContact(c: ClientContact): {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  scope: ContactScope;
  locationId: string | null;
  isPrimary: boolean;
} {
  return {
    id: c.id,
    displayName: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed",
    email: c.email ?? null,
    phone: c.phone ?? null,
    roles: Array.isArray(c.roles) ? c.roles : [],
    scope: c.locationId ? "location" : "company",
    locationId: c.locationId ?? null,
    isPrimary: c.isPrimary ?? false,
  };
}

type CompanyOverview = {
  company: CustomerCompany;
  locations: Client[];
  jobs: Job[];
  invoices: Invoice[];
  stats?: { totalLocations: number; openJobs: number; openInvoices: number };
};

interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string };
}

interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

/** Company scope: Overview, Jobs, Invoices, Quotes only.
 *  Location scope adds Equipment, PM, Parts (site-level assets). */
const COMPANY_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
];

const LOCATION_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "equipment", label: "Equipment" },
  { key: "pm", label: "PM" },
  { key: "parts", label: "Parts" },
];

const WORKSPACE_TAB_KEYS = new Set(LOCATION_TABS.map(t => t.key));

// ─── Currency formatter ──────────────────────────────────────────────────────
const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function locationDisplayName(loc: Client): string {
  return loc.location?.trim()
    || (loc.address ? `${loc.address}${loc.city ? `, ${loc.city}` : ""}` : null)
    || "Unnamed Location";
}

function locationAddress(loc: Client): string {
  // Address line 2 shown after line 1 when present
  return [loc.address, loc.address2, loc.city, loc.province, loc.postalCode].filter(Boolean).join(", ");
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{label}</p>;
}

/** Part C: Shared job row — single visual pattern for all job lists (company + location).
 *  Optional locationLabel shown when needed for company-wide context. */
function JobRow({ job, locationLabel, onNavigate }: {
  job: Job;
  locationLabel?: string;
  onNavigate: (p: string) => void;
}) {
  const display = getJobStatusDisplay(job);
  const overdue = isJobOverdue(job);
  return (
    <div
      className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
      onClick={() => onNavigate(`/jobs/${job.id}`)}
    >
      <div className="min-w-0 flex-1">
        <span className="font-medium">#{job.jobNumber}</span> — {job.summary}
        {locationLabel && (
          <p className="text-[10px] text-muted-foreground/70 truncate">{locationLabel}</p>
        )}
        {!locationLabel && job.scheduledStart && (
          <p className="text-[10px] text-muted-foreground">{format(new Date(job.scheduledStart), "MMM dd, yyyy")}</p>
        )}
      </div>
      <Badge
        variant={overdue ? "destructive" : (display.variant as any)}
        className="text-[10px] flex-shrink-0 ml-2"
      >
        {overdue ? "Overdue" : display.label}
      </Badge>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // ── Scope state ──
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");
  const [locationSearch, setLocationSearch] = useState("");

  // Read URL query params for deep-linking
  const routerSearch = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(routerSearch);
    const locParam = params.get("location");
    const tabParam = params.get("tab");
    const scopeParam = params.get("scope");
    if (locParam) {
      setSelectedLocationId(locParam);
      setScopeType("location");
    } else if (scopeParam === "company" || !locParam) {
      setScopeType("company");
    }
    if (tabParam && WORKSPACE_TAB_KEYS.has(tabParam as WorkspaceTab)) {
      setWorkspaceTab(tabParam as WorkspaceTab);
    }
  }, [routerSearch]);

  // Push URL state when scope/tab changes
  const updateUrlParams = useCallback((scope: ScopeType, locId: string | null, tab: WorkspaceTab) => {
    const params = new URLSearchParams();
    if (scope === "location" && locId) params.set("location", locId);
    if (tab !== "overview") params.set("tab", tab);
    const qs = params.toString();
    const newUrl = `/clients/${clientId}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [clientId]);

  const handleSelectCompany = useCallback(() => {
    setScopeType("company");
    setSelectedLocationId(null);
    // Reset to overview — company scope doesn't have equipment/pm/parts tabs
    setWorkspaceTab("overview");
    updateUrlParams("company", null, "overview");
  }, [updateUrlParams]);

  const handleSelectLocation = useCallback((locId: string) => {
    setScopeType("location");
    setSelectedLocationId(locId);
    setWorkspaceTab("overview");
    updateUrlParams("location", locId, "overview");
  }, [updateUrlParams]);

  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    updateUrlParams(scopeType, selectedLocationId, tab);
  }, [scopeType, selectedLocationId, updateUrlParams]);

  // ── Dialogs ──
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [editClientDialogOpen, setEditClientDialogOpen] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({
    location: "", address: "", address2: "", city: "", province: "", postalCode: "",
    contactName: "", phone: "", email: "",
  });

  // Location edit/tags modals (lifted from LocationDetailPane)
  const [editLocationModalOpen, setEditLocationModalOpen] = useState(false);
  const [editLocationTagsOpen, setEditLocationTagsOpen] = useState(false);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  const [newEquipmentData, setNewEquipmentData] = useState({
    name: "", equipmentType: "", manufacturer: "", modelNumber: "", serialNumber: "",
  });

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"company" | "location">("company");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteEligibility, setDeleteEligibility] = useState<{
    canHardDelete: boolean; reasons: string[]; isLastLocation?: boolean; locationCount?: number;
  } | null>(null);
  const [deleteCheckLoading, setDeleteCheckLoading] = useState(false);

  // ── Data queries ──
  const { data: client, isLoading: clientLoading, error: clientError } = useQuery<Client>({
    queryKey: ["/api/clients", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}`, { credentials: "include" });
      if (res.ok) return res.json();
      if (res.status === 404) {
        const companyRes = await fetch(`/api/customer-companies/${clientId}`, { credentials: "include" });
        if (companyRes.ok) return companyRes.json();
      }
      throw new Error("Failed to fetch client");
    },
    enabled: Boolean(clientId),
  });

  const { data: overview } = useQuery<CompanyOverview>({
    queryKey: ["/api/clients", clientId, "overview"],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/overview`, { credentials: "include" });
      if (res.ok) return res.json();
      if (res.status === 404) {
        const companyRes = await fetch(`/api/customer-companies/${clientId}/overview`, { credentials: "include" });
        if (companyRes.ok) return companyRes.json();
      }
      throw new Error("Failed to fetch client overview");
    },
    enabled: Boolean(clientId),
  });

  const parentCompany = overview?.company;
  const companyId = parentCompany?.id;
  const companyName = parentCompany?.name || client?.companyName || "Client";

  // Locations sorted: primary first, then by creation date
  const locations: Client[] = useMemo(() => {
    const raw = overview?.locations ?? [];
    return [...raw].sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [overview?.locations]);

  const allJobs: Job[] = overview?.jobs ?? [];
  const allInvoices: Invoice[] = overview?.invoices ?? [];

  // Company-scoped quotes
  const { data: clientQuotes = [] } = useQuery<EnrichedQuote[]>({
    queryKey: ["/api/quotes/list", { customerCompanyId: companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/list?customerCompanyId=${companyId}&limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: Boolean(companyId),
  });

  // Company-wide contacts
  const { data: companyContactsData } = useQuery<{ companyContacts: ClientContact[]; locationContacts: ClientContact[] }>({
    queryKey: ["/api/customer-companies", companyId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${companyId}/contacts`, { credentials: "include" });
      if (!res.ok) return { companyContacts: [], locationContacts: [] };
      return res.json();
    },
    enabled: Boolean(companyId),
  });
  const clientLevelContacts = companyContactsData?.companyContacts ?? [];
  const allLocationContacts = companyContactsData?.locationContacts ?? [];

  // Company tags
  const { data: companyTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/customer-companies", companyId, "tags"],
    queryFn: () => apiRequest(`/api/customer-companies/${companyId}/tags`),
    enabled: Boolean(companyId),
  });

  // ── Location-scoped queries (lifted from LocationDetailPane) ──
  const { data: locationEquipment = [] } = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", selectedLocationId, "equipment"],
    queryFn: () => apiRequest(`/api/clients/${selectedLocationId}/equipment`),
    enabled: scopeType === "location" && Boolean(selectedLocationId),
  });

  const { data: locationTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/locations", selectedLocationId, "tags"],
    queryFn: () => apiRequest(`/api/locations/${selectedLocationId}/tags`),
    enabled: scopeType === "location" && Boolean(selectedLocationId),
  });

  const { data: locationContactsData } = useQuery<{ companyContacts: ClientContact[]; locationContacts: ClientContact[] }>({
    queryKey: ["/api/clients", selectedLocationId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${selectedLocationId}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: scopeType === "location" && Boolean(selectedLocationId),
  });
  const locContacts = locationContactsData?.locationContacts ?? [];
  const locCompanyContacts = locationContactsData?.companyContacts ?? [];

  const { data: pmParts = [] } = useQuery<PMPartWithItem[]>({
    queryKey: ["/api/locations", selectedLocationId, "pm-parts"],
    queryFn: () => apiRequest(`/api/locations/${selectedLocationId}/pm-parts`),
    enabled: scopeType === "location" && Boolean(selectedLocationId),
  });

  // ── Derived metrics for header ──
  const companyJobs = useMemo(() => {
    if (!locations.length) return allJobs.filter(j => j.locationId === clientId);
    const locIds = new Set(locations.map(l => l.id));
    return allJobs.filter(j => locIds.has(j.locationId));
  }, [allJobs, locations, clientId]);

  const activeJobsCount = companyJobs.filter(j => j.status === "open").length;
  const overdueInvoicesCount = allInvoices.filter(i =>
    i.status !== "paid" && i.status !== "voided" && i.dueDate && new Date(i.dueDate) < new Date()
  ).length;
  const pendingQuotesCount = clientQuotes.filter(q =>
    q.status === "draft" || q.status === "sent"
  ).length;

  // ── Mutations ──
  const createLocationMutation = useMutation({
    mutationFn: async (locationData: typeof newLocationForm) => {
      if (!companyId) throw new Error("Company not loaded yet.");
      return await apiRequest(`/api/customer-companies/${companyId}/locations`, {
        method: "POST", body: JSON.stringify(locationData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "locations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setAddLocationDialogOpen(false);
      setNewLocationForm({ location: "", address: "", address2: "", city: "", province: "", postalCode: "", contactName: "", phone: "", email: "" });
      toast({ title: "Location added", description: "The new location has been created." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message?.includes("SUBSCRIPTION_LIMIT")
          ? "You've reached your location limit. Please upgrade your plan."
          : error?.message || "Failed to add location.",
        variant: "destructive",
      });
    },
  });

  // Location-scoped equipment mutations (lifted from LocationDetailPane)
  const createEquipmentMutation = useMutation({
    mutationFn: async (data: typeof newEquipmentData) => {
      return await apiRequest(`/api/clients/${selectedLocationId}/equipment`, {
        method: "POST", body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedLocationId, "equipment"] });
      setEquipmentModalOpen(false);
      setNewEquipmentData({ name: "", equipmentType: "", manufacturer: "", modelNumber: "", serialNumber: "" });
      toast({ title: "Equipment added" });
    },
    onError: () => toast({ title: "Error", description: "Failed to add equipment.", variant: "destructive" }),
  });

  const deleteEquipmentMutation = useMutation({
    mutationFn: async (equipmentId: string) => {
      await apiRequest(`/api/clients/${selectedLocationId}/equipment/${equipmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedLocationId, "equipment"] });
      toast({ title: "Equipment removed" });
    },
    onError: () => toast({ title: "Error", description: "Failed to remove equipment.", variant: "destructive" }),
  });

  // ── Delete / Archive handlers ──
  const openDeleteDialog = useCallback(async (target: "company" | "location") => {
    setDeleteTarget(target);
    setDeleteConfirmText("");
    setDeleteEligibility(null);
    setDeleteCheckLoading(true);
    setDeleteDialogOpen(true);

    try {
      const targetId = target === "company" ? companyId : selectedLocationId;
      if (!targetId) throw new Error("No entity selected");
      const url = target === "company"
        ? `/api/customer-companies/${targetId}/delete-check`
        : `/api/clients/${targetId}/delete-check`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || `Server returned ${res.status}`);
      }
      setDeleteEligibility(await res.json());
    } catch (err: any) {
      setDeleteEligibility({ canHardDelete: false, reasons: [err?.message || "Failed to check eligibility"] });
    } finally {
      setDeleteCheckLoading(false);
    }
  }, [companyId, selectedLocationId]);

  const executeDelete = useMutation({
    mutationFn: async () => {
      if (deleteTarget === "company") {
        if (deleteEligibility?.canHardDelete) {
          await apiRequest(`/api/customer-companies/${companyId}`, {
            method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }),
          });
        } else {
          await apiRequest(`/api/customer-companies/${companyId}/archive`, { method: "POST" });
        }
      } else {
        if (deleteEligibility?.canHardDelete && !deleteEligibility?.isLastLocation) {
          await apiRequest(`/api/clients/${selectedLocationId}`, {
            method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }),
          });
        } else {
          await apiRequest(`/api/clients/${selectedLocationId}`, { method: "DELETE" });
        }
      }
    },
    onSuccess: () => {
      const isHard = deleteEligibility?.canHardDelete;
      setDeleteDialogOpen(false);
      if (deleteTarget === "company") {
        toast({ title: isHard ? "Client deleted" : "Client archived" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setLocation("/clients");
      } else {
        toast({ title: isHard ? "Location deleted" : "Location archived" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
        // Switch to company scope after location deletion
        setScopeType("company");
        setSelectedLocationId(null);
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Delete failed", variant: "destructive" });
    },
  });

  // ── Filtered locations for left rail ──
  const filteredLocations = useMemo(() => {
    if (!locationSearch.trim()) return locations;
    const q = locationSearch.toLowerCase();
    return locations.filter(l =>
      locationDisplayName(l).toLowerCase().includes(q) ||
      (l.address || "").toLowerCase().includes(q) ||
      (l.city || "").toLowerCase().includes(q)
    );
  }, [locations, locationSearch]);

  // ── Location-scoped data maps ──
  const jobsByLocation = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of allJobs) {
      const arr = map.get(j.locationId) ?? [];
      arr.push(j);
      map.set(j.locationId, arr);
    }
    return map;
  }, [allJobs]);

  const invoicesByLocation = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of allInvoices) {
      const arr = map.get(inv.locationId) ?? [];
      arr.push(inv);
      map.set(inv.locationId, arr);
    }
    return map;
  }, [allInvoices]);

  const quotesByLocation = useMemo(() => {
    const map = new Map<string, EnrichedQuote[]>();
    for (const q of clientQuotes) {
      if (!q.locationId) continue;
      const arr = map.get(q.locationId) ?? [];
      arr.push(q);
      map.set(q.locationId, arr);
    }
    return map;
  }, [clientQuotes]);

  const selectedLoc = locations.find(l => l.id === selectedLocationId) ?? null;

  // Derived data for location scope
  const locJobs = selectedLocationId ? jobsByLocation.get(selectedLocationId) ?? [] : [];
  const locInvoices = selectedLocationId ? invoicesByLocation.get(selectedLocationId) ?? [] : [];
  const locQuotes = selectedLocationId ? quotesByLocation.get(selectedLocationId) ?? [] : [];
  const locOverdueJobs = locJobs.filter(j => isJobOverdue(j));
  const locActiveJobs = locJobs.filter(j => j.status === "open" && !locOverdueJobs.some(o => o.id === j.id));

  // ── Loading / Error states ──
  if (clientLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (clientError || !client) {
    return (
      <div className="p-6 text-center py-16">
        <h2 className="text-lg font-semibold text-destructive">Client not found</h2>
        <p className="text-muted-foreground mt-2">The client you're looking for doesn't exist.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/clients")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Clients
        </Button>
      </div>
    );
  }

  // Active scope entity name and tags for workspace header
  const scopeEntityName = scopeType === "company"
    ? companyName
    : (selectedLoc ? locationDisplayName(selectedLoc) : "");
  const scopeTags = scopeType === "company" ? companyTags : locationTags;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* ── Step 1: Top Header Card — full-width card container ── */}
      <div className="p-4 pb-0">
        <div className="rounded-lg border border-border/80 bg-primary/[0.09] px-5 py-4 mb-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLocation("/clients")}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Back to Clients"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <h1 className="text-lg font-bold text-foreground truncate">{companyName}</h1>
                {parentCompany?.isActive !== false && (
                  <Badge className="bg-emerald-100 text-emerald-700 text-[10px] hover:bg-emerald-100">Active</Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs ml-6">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3 w-3" /><strong className="text-foreground">{locations.length}</strong> Locations
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Briefcase className="h-3 w-3" /><strong className="text-foreground">{activeJobsCount}</strong> Active Jobs
                </span>
                {overdueInvoicesCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600">
                    <Receipt className="h-3 w-3" /><strong>{overdueInvoicesCount}</strong> Overdue
                  </span>
                )}
                {pendingQuotesCount > 0 && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <FileText className="h-3 w-3" /><strong>{pendingQuotesCount}</strong> Quotes Pending
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" className="h-7 text-xs" onClick={() => setJobDialogOpen(true)}>
                <Plus className="mr-1 h-3 w-3" />Create Job
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAddLocationDialogOpen(true)}>
                <Plus className="mr-1 h-3 w-3" />Add Location
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditClientDialogOpen(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Client
                  </DropdownMenuItem>
                  {scopeType === "location" && selectedLoc && (
                    <>
                      <DropdownMenuItem onClick={() => setEditLocationModalOpen(true)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Location
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditLocationTagsOpen(true)}>
                        <Tag className="h-3.5 w-3.5 mr-2" /> Edit Tags
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {scopeType === "location" && selectedLoc && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => openDeleteDialog("location")}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Location
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => openDeleteDialog("company")}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Client
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* ── Two-Column Layout: unified Locations+Workspace card | right sidebar ── */}
      <div className="flex flex-1 overflow-hidden px-4 pb-4 gap-4">
        {/* Unified card: Locations rail (left) + Active Work workspace (right), single border, vertical divider only */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
          {/* ── WORKSPACE HEADER: single control strip — title left | search + tabs right ── */}
          <div className="border-b px-4 py-2.5">
            <div className="flex items-start justify-between gap-4">
              {/* Left: selected entity title + address */}
              <div className="min-w-0 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold truncate">{scopeEntityName}</h2>
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                    {scopeType === "company" ? "Company" : "Location"}
                  </span>
                  {selectedLoc?.isPrimary && scopeType === "location" && (
                    <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  )}
                  {scopeTags.length > 0 && scopeTags.map(tag => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {scopeType === "location" && selectedLoc && (
                    <button
                      onClick={() => setEditLocationTagsOpen(true)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit tags"
                    >
                      <Tag className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {scopeType === "location" && selectedLoc && (
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-[11px] text-muted-foreground">{locationAddress(selectedLoc)}</p>
                    {selectedLoc.roofLadderCode && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        Site Code: <span className="text-foreground">{selectedLoc.roofLadderCode}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: search + tabs in one horizontal strip */}
              <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                {locations.length > 3 && (
                  <div className="relative flex-shrink-0 w-40">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search locations..."
                      value={locationSearch}
                      onChange={e => setLocationSearch(e.target.value)}
                      className="h-7 pl-7 text-[11px]"
                    />
                  </div>
                )}
                <div className="flex gap-0.5 overflow-x-auto whitespace-nowrap">
                  {(scopeType === "company" ? COMPANY_TABS : LOCATION_TABS).map(t => (
                    <button key={t.key} onClick={() => handleTabChange(t.key)}
                      className={`whitespace-nowrap px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                        workspaceTab === t.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-slate-100"
                      }`}>{t.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── WORKSPACE BODY: left nav column | right content area ── */}
          <div className="flex flex-1 overflow-hidden">
            {/* LEFT NAV: Overview row + Locations list */}
            <div className="flex w-56 flex-shrink-0 flex-col border-r overflow-hidden">
              {/* Overview nav row — styled as sibling to location rows */}
              <button
                onClick={handleSelectCompany}
                className={`w-full text-left px-3 py-2 border-b flex items-center gap-1.5 transition-colors ${
                  scopeType === "company"
                    ? "bg-blue-50/60 border-l-2 border-l-primary text-primary"
                    : "hover:bg-slate-50 border-l-2 border-l-transparent text-foreground"
                }`}
              >
                <Building2 className="h-3 w-3 flex-shrink-0" />
                <span className="text-xs font-medium truncate">Overview</span>
              </button>

              {/* Locations section label */}
              <div className="px-3 pt-3 pb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Locations</p>
              </div>

              {/* Location rows */}
              <div className="flex-1 overflow-y-auto">
                {filteredLocations.length > 0 ? filteredLocations.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => handleSelectLocation(loc.id)}
                    className={`w-full text-left px-3 py-2 border-b transition-colors ${
                      scopeType === "location" && selectedLocationId === loc.id
                        ? "bg-blue-50/60 border-l-2 border-l-primary"
                        : "hover:bg-slate-50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-medium truncate">{locationDisplayName(loc)}</span>
                      {loc.isPrimary && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
                    </div>
                  </button>
                )) : (
                  <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                    {locationSearch ? "No match." : (
                      <div className="space-y-2">
                        <p>No locations yet.</p>
                        <Button variant="outline" size="sm" className="h-5 text-[10px]" onClick={() => setAddLocationDialogOpen(true)}>
                          <Plus className="mr-1 h-3 w-3" />Add Location
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Active tab content only */}
            <div className="flex-1 overflow-y-auto p-4">
              {scopeType === "company" ? (
                <>
                  {workspaceTab === "overview" && (
                    <CompanyOverviewTab
                      jobs={companyJobs}
                      invoices={allInvoices}
                      quotes={clientQuotes}
                      locations={locations}
                      onNavigate={setLocation}
                    />
                  )}
                  {workspaceTab === "jobs" && <ClientAllJobsTab jobs={companyJobs} locations={locations} onNavigate={setLocation} />}
                  {workspaceTab === "invoices" && <ClientAllInvoicesTab invoices={allInvoices} locations={locations} onNavigate={setLocation} />}
                  {workspaceTab === "quotes" && <ClientAllQuotesTab quotes={clientQuotes} locations={locations} onNavigate={setLocation} />}
                </>
              ) : selectedLoc ? (
                <>
                  {workspaceTab === "overview" && (
                    <LocOverviewTab
                      activeJobs={locActiveJobs}
                      overdueJobs={locOverdueJobs}
                      equipment={locationEquipment}
                      location={selectedLoc}
                      onNavigate={setLocation}
                    />
                  )}
                  {workspaceTab === "jobs" && <LocJobsTab jobs={locJobs} onNavigate={setLocation} />}
                  {workspaceTab === "invoices" && <LocInvoicesTab invoices={locInvoices} onNavigate={setLocation} />}
                  {workspaceTab === "quotes" && <LocQuotesTab quotes={locQuotes} onNavigate={setLocation} />}
                  {workspaceTab === "equipment" && (
                    <LocEquipmentTab
                      equipment={locationEquipment}
                      onAdd={() => setEquipmentModalOpen(true)}
                      onDelete={(eqId) => deleteEquipmentMutation.mutate(eqId)}
                    />
                  )}
                  {workspaceTab === "pm" && (
                    <PMScheduleCard
                      locationId={selectedLocationId!}
                      locationName={locationDisplayName(selectedLoc)}
                      companyId={client.companyId || ""}
                      clientId={companyId || undefined}
                      open={true}
                      onOpenChange={() => {}}
                    />
                  )}
                  {workspaceTab === "parts" && (
                    <LocPartsTab pmParts={pmParts} onAdd={() => setPartsModalOpen(true)} />
                  )}
                </>
              ) : (
                <EmptyState label="Select a location from the left rail" />
              )}
            </div>
          </div>

        </div>{/* end unified Locations + Workspace card */}

        {/* Step 3: Right column — Contacts, Notes, Activity in separate cards */}
        <div className="w-80 flex-shrink-0 overflow-y-auto space-y-4">
          {scopeType === "company" ? (
            <>
              {/* Contacts card */}
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <MetadataSection title="Contacts">
                  <CompanyContactsCompact
                    companyContacts={clientLevelContacts}
                    locationContacts={allLocationContacts}
                    locations={locations}
                    companyId={companyId}
                  />
                </MetadataSection>
              </div>

              {/* Notes card */}
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <MetadataSection title="Notes">
                  <NotesPanel scope="company" companyId={companyId || ""} hideAddButton={false} />
                </MetadataSection>
              </div>

              {/* Activity card */}
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <MetadataSection title="Activity">
                  <ClientActivityCompact companyId={companyId} />
                </MetadataSection>
              </div>
            </>
          ) : selectedLoc && selectedLocationId ? (
            <>
              {/* Contacts card */}
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <MetadataSection title="Contacts">
                  <LocContactsCompact
                    locationContacts={locContacts}
                    companyContacts={locCompanyContacts}
                    locationId={selectedLocationId}
                    parentCompanyId={companyId}
                  />
                </MetadataSection>
              </div>

              {/* Notes card */}
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <MetadataSection title="Notes">
                  <NotesPanel scope="location" companyId={client.companyId || ""} locationId={selectedLocationId} hideAddButton={false} />
                </MetadataSection>
              </div>

              {/* Site Info card — Part E: unified "Site Code" terminology */}
              {(selectedLoc.roofLadderCode || selectedLoc.notes) && (
                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <MetadataSection title="Site Info">
                    <div className="text-xs space-y-2">
                      {selectedLoc.roofLadderCode && (
                        <div>
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Site Code</p>
                          <p>{selectedLoc.roofLadderCode}</p>
                        </div>
                      )}
                      {selectedLoc.notes && (
                        <div>
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Site Notes</p>
                          <p>{selectedLoc.notes}</p>
                        </div>
                      )}
                    </div>
                  </MetadataSection>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* ── Dialogs ── */}
      <QuickAddJobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        preselectedLocationId={scopeType === "location" ? selectedLocationId ?? undefined : undefined}
      />

      {/* Delete / Archive Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {deleteEligibility?.canHardDelete ? (
                <><AlertTriangle className="h-5 w-5 text-destructive" /> Delete {deleteTarget === "company" ? "Client" : "Location"}</>
              ) : (
                <><Archive className="h-5 w-5 text-amber-500" /> Archive {deleteTarget === "company" ? "Client" : "Location"}</>
              )}
            </DialogTitle>
            <DialogDescription>
              {deleteCheckLoading ? "Checking dependencies..." :
                deleteEligibility?.canHardDelete
                  ? deleteTarget === "company"
                    ? `This will permanently remove "${companyName}" and all associated locations and contacts. This cannot be undone.`
                    : deleteEligibility?.isLastLocation
                      ? "This is the only location for this client. Delete the client instead."
                      : `This will permanently remove "${selectedLoc ? locationDisplayName(selectedLoc) : "this location"}". This cannot be undone.`
                  : `Cannot permanently delete — ${(deleteEligibility?.reasons ?? []).join(", ")}. You can archive instead, which hides it from lists while preserving historical records.`
              }
            </DialogDescription>
          </DialogHeader>

          {!deleteCheckLoading && deleteEligibility && (
            <div className="space-y-4 py-2">
              {!deleteEligibility.canHardDelete && deleteEligibility.reasons.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm">
                  <p className="font-medium text-amber-800 mb-1">Blocking dependencies:</p>
                  <ul className="list-disc pl-5 text-amber-700 space-y-0.5">
                    {deleteEligibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {deleteEligibility.canHardDelete && !(deleteTarget === "location" && deleteEligibility.isLastLocation) && (
                <div className="space-y-2">
                  <Label>Type <span className="font-mono font-bold">DELETE</span> to confirm</Label>
                  <Input
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoFocus
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            {deleteEligibility?.canHardDelete && !(deleteTarget === "location" && deleteEligibility.isLastLocation) ? (
              <Button
                variant="destructive"
                onClick={() => executeDelete.mutate()}
                disabled={deleteConfirmText !== "DELETE" || executeDelete.isPending}
              >
                {executeDelete.isPending ? "Deleting..." : "Permanently Delete"}
              </Button>
            ) : deleteEligibility && !(deleteTarget === "location" && deleteEligibility?.isLastLocation) ? (
              <Button
                variant="default"
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => executeDelete.mutate()}
                disabled={executeDelete.isPending}
              >
                {executeDelete.isPending ? "Archiving..." : "Archive"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Client Dialog — canonical component */}
      <EditCompanyDialog
        open={editClientDialogOpen}
        onOpenChange={setEditClientDialogOpen}
        companyId={companyId}
        parentCompany={parentCompany}
        clientId={clientId}
      />

      {/* Add Location Dialog */}
      <Dialog open={addLocationDialogOpen} onOpenChange={setAddLocationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Location Name *</Label>
              <Input placeholder="e.g., Main Office, Warehouse A" value={newLocationForm.location}
                onChange={e => setNewLocationForm(f => ({ ...f, location: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input placeholder="Street address" value={newLocationForm.address}
                onChange={e => setNewLocationForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Address Line 2</Label>
              <Input placeholder="Suite, Unit, Floor (optional)" value={newLocationForm.address2}
                onChange={e => setNewLocationForm(f => ({ ...f, address2: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={newLocationForm.city}
                  onChange={e => setNewLocationForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Input value={newLocationForm.province}
                  onChange={e => setNewLocationForm(f => ({ ...f, province: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Postal Code</Label>
                <Input value={newLocationForm.postalCode}
                  onChange={e => setNewLocationForm(f => ({ ...f, postalCode: e.target.value }))} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1 border-t">Primary site contact summary — manage full contacts from the Contacts tab after creating.</p>
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input value={newLocationForm.contactName}
                onChange={e => setNewLocationForm(f => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={newLocationForm.phone}
                  onChange={e => setNewLocationForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={newLocationForm.email}
                  onChange={e => setNewLocationForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLocationDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createLocationMutation.mutate(newLocationForm)}
              disabled={!newLocationForm.location.trim() || createLocationMutation.isPending}
            >
              {createLocationMutation.isPending ? "Adding..." : "Add Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location Edit Modal */}
      {selectedLoc && (
        <LocationFormModal
          open={editLocationModalOpen}
          onOpenChange={setEditLocationModalOpen}
          location={selectedLoc}
          locationId={selectedLocationId!}
          companyId={client.companyId || ""}
          parentCompanyId={companyId}
          onSuccess={() => {
            setEditLocationModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedLocationId] });
            queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
          }}
        />
      )}

      {/* Parts Selector */}
      {selectedLocationId && (
        <PartsSelectorModal open={partsModalOpen} onOpenChange={setPartsModalOpen} locationId={selectedLocationId} existingParts={pmParts} />
      )}

      {/* Edit Tags (location scope) */}
      {selectedLocationId && (
        <EditTagsModal
          open={editLocationTagsOpen}
          onOpenChange={setEditLocationTagsOpen}
          entityType="location"
          entityId={selectedLocationId}
          currentTags={locationTags}
        />
      )}

      {/* Add Equipment Dialog */}
      <Dialog open={equipmentModalOpen} onOpenChange={setEquipmentModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Equipment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input placeholder="e.g., RTU #1" value={newEquipmentData.name}
                onChange={e => setNewEquipmentData(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Equipment Type</Label>
              <Input placeholder="e.g., RTU, Furnace" value={newEquipmentData.equipmentType}
                onChange={e => setNewEquipmentData(d => ({ ...d, equipmentType: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Manufacturer</Label>
              <Input placeholder="e.g., Carrier, Trane" value={newEquipmentData.manufacturer}
                onChange={e => setNewEquipmentData(d => ({ ...d, manufacturer: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Model Number</Label>
                <Input value={newEquipmentData.modelNumber}
                  onChange={e => setNewEquipmentData(d => ({ ...d, modelNumber: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Serial Number</Label>
                <Input value={newEquipmentData.serialNumber}
                  onChange={e => setNewEquipmentData(d => ({ ...d, serialNumber: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEquipmentModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createEquipmentMutation.mutate(newEquipmentData)}
              disabled={!newEquipmentData.name.trim() || createEquipmentMutation.isPending}
            >
              {createEquipmentMutation.isPending ? "Adding..." : "Add Equipment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Metadata Panel Components
// ═══════════════════════════════════════════════════════════════════════════════

function MetadataSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{title}</h3>
      {children}
    </div>
  );
}


/** Compact company contacts for metadata panel — full CRUD */
function CompanyContactsCompact({
  companyContacts, locationContacts, locations, companyId,
}: {
  companyContacts: ClientContact[];
  locationContacts: ClientContact[];
  locations: Client[];
  companyId?: string;
}) {
  const { toast } = useToast();
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);

  const handleRefresh = useCallback(() => {
    if (companyId) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "contacts"] });
    }
  }, [companyId]);

  const deleteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      if (!companyId) throw new Error("Company not loaded");
      return apiRequest(`/api/customer-companies/${companyId}/contacts/${contactId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      handleRefresh();
      toast({ title: "Contact removed" });
    },
    onError: () => toast({ title: "Error", description: "Failed to remove contact.", variant: "destructive" }),
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{companyContacts.length} contact{companyContacts.length !== 1 ? "s" : ""}</span>
        <Button variant="outline" size="sm" className="h-5 text-[10px] px-2" onClick={() => {
          setEditingContact(null);
          setContactDialogOpen(true);
        }}>
          <Plus className="mr-0.5 h-2.5 w-2.5" />Add
        </Button>
      </div>
      {companyContacts.length === 0 && locationContacts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-1 text-center">No contacts yet.</p>
      ) : (
        <div className="space-y-1">
          {companyContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => { setEditingContact(ct); setContactDialogOpen(true); }}
              onDelete={(ct) => deleteMutation.mutate(ct.id)}
            />
          ))}
          {locationContacts.length > 0 && (
            <p className="text-[10px] text-muted-foreground">+ {locationContacts.length} at locations</p>
          )}
        </div>
      )}
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        companyId={companyId}
        contact={editingContact}
        associationType="company"
        onSuccess={handleRefresh}
      />
    </div>
  );
}

/** Compact location contacts for metadata panel — location contacts only (no company-wide).
 *  Company-wide contacts are only shown in Company Overview scope. */
function LocContactsCompact({
  locationContacts, companyContacts, locationId, parentCompanyId,
}: {
  locationContacts: ClientContact[];
  companyContacts: ClientContact[];
  locationId: string;
  parentCompanyId?: string;
}) {
  const { toast } = useToast();
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "contacts"] });
    if (parentCompanyId) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "contacts"] });
    }
  }, [locationId, parentCompanyId]);

  const deleteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      if (!parentCompanyId) throw new Error("Company not loaded");
      return apiRequest(`/api/customer-companies/${parentCompanyId}/contacts/${contactId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      handleRefresh();
      toast({ title: "Contact removed" });
    },
    onError: () => toast({ title: "Error", description: "Failed to remove contact.", variant: "destructive" }),
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{locationContacts.length} contact{locationContacts.length !== 1 ? "s" : ""}</span>
        <Button variant="outline" size="sm" className="h-5 text-[10px] px-2" onClick={() => {
          setEditingContact(null);
          setContactDialogOpen(true);
        }}>
          <Plus className="mr-0.5 h-2.5 w-2.5" />Add
        </Button>
      </div>
      {locationContacts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-1 text-center">No site contacts.</p>
      ) : (
        <div className="space-y-1">
          {locationContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => { setEditingContact(ct); setContactDialogOpen(true); }}
              onDelete={(ct) => deleteMutation.mutate(ct.id)}
            />
          ))}
        </div>
      )}
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        companyId={parentCompanyId}
        contact={editingContact}
        associationType="location"
        locationId={locationId}
        onSuccess={handleRefresh}
      />
    </div>
  );
}

/** Compact activity for metadata panel */
function ClientActivityCompact({ companyId }: { companyId?: string }) {
  const { data: activity = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/activity", "customer_company", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/activity/customer_company/${companyId}?limit=10`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      return normalizeActivityPayload(json);
    },
    enabled: Boolean(companyId),
  });

  if (!companyId) return <p className="text-[11px] text-muted-foreground">Not available</p>;
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (activity.length === 0) return <p className="text-[11px] text-muted-foreground">No activity yet.</p>;

  return (
    <div className="space-y-1.5">
      {activity.slice(0, 8).map((evt: any, i: number) => (
        <div key={evt.id || i} className="flex items-start gap-2 text-[11px]">
          <div className="h-1.5 w-1.5 rounded-full bg-slate-300 flex-shrink-0 mt-1.5" />
          <div className="flex-1 min-w-0">
            <p className="text-foreground truncate">{evt.description || evt.action || "Event"}</p>
            <p className="text-muted-foreground text-[10px]">
              {evt.createdAt ? format(new Date(evt.createdAt), "MMM dd, h:mm a") : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Company-Scope Workspace Tabs
// ═══════════════════════════════════════════════════════════════════════════════

/** Company overview — Active list (excludes archived) sorted by status priority.
 *  Uses canonical getJobStatusDisplay().priority for ordering.
 *  Bug fix: archived jobs (status='archived') excluded from Active list. */
function CompanyOverviewTab({
  jobs, invoices, quotes, locations, onNavigate,
}: {
  jobs: Job[]; invoices: Invoice[]; quotes: EnrichedQuote[];
  locations: Client[]; onNavigate: (p: string) => void;
}) {
  // Filter out archived jobs from Active display
  const activeJobs = useMemo(() => jobs.filter(j => j.status !== "archived"), [jobs]);
  // Single sorted list: overdue (priority 0) → in-progress (1) → scheduled (2) → open (3) → completed (4+)
  const sortedJobs = useMemo(() => {
    return [...activeJobs]
      .sort((a, b) => {
        const pa = getJobStatusDisplay(a).priority;
        const pb = getJobStatusDisplay(b).priority;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
      })
      .slice(0, 25);
  }, [activeJobs]);
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Active ({sortedJobs.length})</h3>
        {sortedJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No jobs across locations.</p>
        ) : (
          <div className="divide-y border-t">
            {sortedJobs.map(j => (
              <JobRow key={j.id} job={j} locationLabel={locMap.get(j.locationId)} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Location-Scope Workspace Tab Components
// ═══════════════════════════════════════════════════════════════════════════════

function LocOverviewTab({
  activeJobs, overdueJobs, equipment, location, onNavigate,
}: {
  activeJobs: Job[]; overdueJobs: Job[]; equipment: LocationEquipment[];
  location: Client; onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Part C: Unified job rows via shared JobRow component */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Active Work</h3>
        {activeJobs.length === 0 && overdueJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active work</p>
        ) : (
          <div className="divide-y border-t">
            {overdueJobs.map(j => (
              <JobRow key={j.id} job={j} onNavigate={onNavigate} />
            ))}
            {activeJobs.map(j => (
              <JobRow key={j.id} job={j} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {equipment.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Equipment ({equipment.length})</h3>
          <div className="space-y-1">
            {equipment.slice(0, 3).map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                <span className="font-medium">{e.name} {e.equipmentType && <span className="text-muted-foreground font-normal">· {e.equipmentType}</span>}</span>
                <span className="text-muted-foreground">{e.manufacturer || ""}</span>
              </div>
            ))}
            {equipment.length > 3 && <p className="text-[11px] text-muted-foreground">+{equipment.length - 3} more</p>}
          </div>
        </div>
      )}
    </div>
  );
}

{/* Part C: Unified job rows via shared JobRow component */}
function LocJobsTab({ jobs, onNavigate }: { jobs: Job[]; onNavigate: (p: string) => void }) {
  if (jobs.length === 0) return <EmptyState label="No jobs for this location" />;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Total: {jobs.length}</p>
      <div className="divide-y border-t">
        {jobs.map(j => (
          <JobRow key={j.id} job={j} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function LocInvoicesTab({ invoices, onNavigate }: { invoices: Invoice[]; onNavigate: (p: string) => void }) {
  if (invoices.length === 0) return <EmptyState label="No invoices for this location" />;
  const statusCls = (s: string) => {
    const map: Record<string, string> = {
      paid: "bg-emerald-100 text-emerald-700",
      sent: "bg-blue-100 text-blue-700",
      draft: "bg-slate-100 text-slate-700",
      voided: "bg-slate-100 text-slate-500",
    };
    return map[s] ?? "bg-red-100 text-red-700";
  };
  return (
    <div className="space-y-1">
      {invoices.map(inv => (
        <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0 text-xs cursor-pointer hover:bg-slate-50 rounded px-1"
          onClick={() => onNavigate(`/invoices/${inv.id}`)}>
          <div>
            <div className="font-medium">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</div>
            <div className="text-muted-foreground">{inv.issueDate ? format(new Date(inv.issueDate), "MMM dd, yyyy") : ""}</div>
          </div>
          <div className="text-right">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls(inv.status)}`}>{inv.status}</span>
            <p className="text-muted-foreground mt-0.5">{fmt.format(Number(inv.total ?? 0))}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LocQuotesTab({ quotes, onNavigate }: { quotes: EnrichedQuote[]; onNavigate: (p: string) => void }) {
  if (quotes.length === 0) return <EmptyState label="No quotes for this location" />;
  const statusCls = (s: string) => {
    const map: Record<string, string> = {
      approved: "bg-emerald-100 text-emerald-700",
      sent: "bg-blue-100 text-blue-700",
      draft: "bg-slate-100 text-slate-700",
      declined: "bg-red-100 text-red-700",
      converted: "bg-purple-100 text-purple-700",
    };
    return map[s] ?? "bg-slate-100 text-slate-600";
  };
  return (
    <div className="space-y-1">
      {quotes.map(q => (
        <div key={q.id} className="flex items-center justify-between py-2 border-b last:border-0 text-xs cursor-pointer hover:bg-slate-50 rounded px-1"
          onClick={() => onNavigate(`/quotes/${q.id}`)}>
          <div>
            <div className="font-medium">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}{q.title ? ` — ${q.title}` : ""}</div>
            <div className="text-muted-foreground">{q.updatedAt ? format(new Date(q.updatedAt), "MMM dd, yyyy") : ""}</div>
          </div>
          <div className="text-right">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls(q.status)}`}>{q.status}</span>
            <p className="text-muted-foreground mt-0.5">{fmt.format(Number(q.total ?? 0))}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LocEquipmentTab({
  equipment, onAdd, onDelete,
}: {
  equipment: LocationEquipment[];
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Total: {equipment.length}</p>
        <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={onAdd}>
          <Plus className="mr-1 h-3 w-3" />Add Equipment
        </Button>
      </div>
      {equipment.length === 0 ? <EmptyState label="No equipment" /> : (
        <div className="space-y-2">
          {equipment.map(eq => (
            <div key={eq.id} className="border-b last:border-0 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{eq.name}</div>
                  <div className="text-muted-foreground">{eq.equipmentType || "—"}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(eq.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {eq.manufacturer || ""} {eq.modelNumber || ""} {(eq.manufacturer || eq.modelNumber) && eq.serialNumber ? "•" : ""} S/N: {eq.serialNumber || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocPartsTab({ pmParts, onAdd }: { pmParts: PMPartWithItem[]; onAdd: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">Total: {pmParts.length}</p>
        <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={onAdd}>
          <Plus className="mr-1 h-3 w-3" />Add Parts
        </Button>
      </div>
      {pmParts.length === 0 ? (
        <EmptyState label="No PM parts configured" />
      ) : (
        <div className="divide-y">
          {pmParts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 text-xs">
              <div>
                <div className="font-medium">{p.itemName || "Unknown Part"}</div>
                {p.itemSku && <div className="text-muted-foreground">{p.itemSku}</div>}
              </div>
              <span className="text-muted-foreground">x{p.quantityPerVisit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Client-Wide Tab Components (used by company scope)
// ═══════════════════════════════════════════════════════════════════════════════

{/* Part C: Unified job rows via shared JobRow component */}
/** Bug fix: split jobs into Active and Archived groups on company Jobs tab */
function ClientAllJobsTab({ jobs, locations, onNavigate }: { jobs: Job[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  const activeJobs = useMemo(() => jobs.filter(j => j.status !== "archived"), [jobs]);
  const archivedJobs = useMemo(() => jobs.filter(j => j.status === "archived"), [jobs]);
  if (jobs.length === 0) return <EmptyState label="No jobs for this client" />;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Active ({activeJobs.length})</h3>
        {activeJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active jobs.</p>
        ) : (
          <div className="divide-y border-t">
            {activeJobs.map(j => (
              <JobRow key={j.id} job={j} locationLabel={locMap.get(j.locationId)} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
      {archivedJobs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Archived ({archivedJobs.length})</h3>
          <div className="divide-y border-t">
            {archivedJobs.map(j => (
              <JobRow key={j.id} job={j} locationLabel={locMap.get(j.locationId)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClientAllInvoicesTab({ invoices, locations, onNavigate }: { invoices: Invoice[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  if (invoices.length === 0) return <EmptyState label="No invoices for this client" />;
  return (
    <div className="divide-y">
      {invoices.map(inv => (
        <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-50"
          onClick={() => onNavigate(`/invoices/${inv.id}`)}>
          <div>
            <span className="font-medium">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</span>
            <span className="text-muted-foreground ml-2">{fmt.format(Number(inv.total ?? 0))}</span>
            <p className="text-muted-foreground mt-0.5">{locMap.get(inv.locationId) || ""}</p>
          </div>
          {(() => {
            const badge = getInvoiceStatusBadge(inv.status, false);
            return <Badge variant={badge.variant} className="text-[10px] flex-shrink-0">{badge.label}</Badge>;
          })()}
        </div>
      ))}
    </div>
  );
}

function ClientAllQuotesTab({ quotes, locations, onNavigate }: { quotes: EnrichedQuote[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  if (quotes.length === 0) return <EmptyState label="No quotes for this client" />;
  return (
    <div className="divide-y">
      {quotes.map(q => (
        <div key={q.id} className="flex items-center justify-between px-3 py-2.5 text-xs cursor-pointer hover:bg-slate-50"
          onClick={() => onNavigate(`/quotes/${q.id}`)}>
          <div>
            <span className="font-medium">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}</span>
            {q.title && <span className="text-muted-foreground ml-1">— {q.title}</span>}
            <span className="text-muted-foreground ml-2">{fmt.format(Number(q.total ?? 0))}</span>
            <p className="text-muted-foreground mt-0.5">{q.locationId ? locMap.get(q.locationId) || "" : ""}</p>
          </div>
          <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">{q.status}</Badge>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════════

/** Contact card — compact layout: Name + Primary → Phone/Email → Role badges.
 *  Hierarchy: identity first, contact info second, roles third. */
function ContactCard({
  contact, onEdit, onDelete, showScope = false,
}: {
  contact: ClientContact;
  onEdit?: (c: ClientContact) => void;
  onDelete?: (c: ClientContact) => void;
  showScope?: boolean;
}) {
  const nc = normalizeContact(contact);
  const initials = [contact.firstName, contact.lastName].filter(Boolean).map(n => n![0]).join("");
  return (
    <div className="text-xs p-1.5 border rounded group">
      {/* Row 1: Name + Primary badge + actions */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-medium text-slate-600 flex-shrink-0">
            {initials || "?"}
          </div>
          <span className="font-medium truncate">{nc.displayName}</span>
          {nc.isPrimary && (
            <Badge className="bg-yellow-100 text-yellow-700 text-[9px] px-1 py-0 flex-shrink-0 hover:bg-yellow-100">Primary</Badge>
          )}
          {showScope && nc.scope === "company" && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 flex-shrink-0">Company</Badge>
          )}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onEdit && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onEdit(contact)}>
                <Pencil className="h-2.5 w-2.5" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => onDelete(contact)}>
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      {/* Row 2: Phone / Email — compact inline */}
      {(nc.phone || nc.email) && (
        <div className="flex items-center gap-3 text-muted-foreground pl-[26px] mt-0.5">
          {nc.phone && <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{nc.phone}</span>}
          {nc.email && <span className="flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5" />{nc.email}</span>}
        </div>
      )}
      {/* Row 3: Role badges — only if roles exist */}
      {nc.roles.length > 0 && (
        <div className="flex flex-wrap gap-0.5 pl-[26px] mt-0.5">
          {nc.roles.map(r => (
            <Badge key={r} variant="outline" className="text-[9px] px-1 py-0 capitalize">{r}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ContactFormDialog extracted to @/components/ContactFormDialog.tsx (2026-03-22)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize activity response — handles array, paginated object, null, undefined */
function normalizeActivityPayload(payload: unknown): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.events)) return obj.events;
  }
  return [];
}
