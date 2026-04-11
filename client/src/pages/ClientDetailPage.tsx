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
  Clock, Package, StickyNote, Tag, Building2, AlertTriangle, Archive, PanelRightClose, PanelRightOpen, Loader2,
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
import { AssignContactDialog } from "@/components/AssignContactDialog";
import { EditAssignmentRolesDialog } from "@/components/EditAssignmentRolesDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
import { EquipmentDetailModal } from "@/components/EquipmentDetailModal";
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
import { getClientDisplayName } from "@shared/clientDisplayName";

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
      className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
      onClick={() => onNavigate(`/jobs/${job.id}`)}
    >
      <div className="min-w-0 flex-1">
        <span className="font-medium text-slate-500 tabular-nums">#{job.jobNumber}</span>
        <span className="text-slate-300 mx-1">—</span>
        <span className="font-medium text-slate-700">{job.summary}</span>
        {locationLabel && (
          <p className="text-[10px] text-slate-400 truncate">{locationLabel}</p>
        )}
        {!locationLabel && job.scheduledStart && (
          <p className="text-[10px] text-slate-400">{format(new Date(job.scheduledStart), "MMM dd, yyyy")}</p>
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

/** Canonical active-work section — single owner of filter + sort + render.
 *  Used by both CompanyOverviewTab and LocOverviewTab. */
function ActiveWorkSection({ jobs, locationMap, emptyLabel, onNavigate, limit = 25 }: {
  jobs: Job[];
  locationMap?: Map<string, string>;
  emptyLabel?: string;
  onNavigate: (p: string) => void;
  limit?: number;
}) {
  const sorted = useMemo(() => {
    return jobs
      .filter(j => j.status === "open")
      .sort((a, b) => {
        const pa = getJobStatusDisplay(a).priority;
        const pb = getJobStatusDisplay(b).priority;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime();
      })
      .slice(0, limit);
  }, [jobs, limit]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Active Work</h3>
        <span className="text-[10px] text-slate-400">{sorted.length} jobs</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">{emptyLabel || "No active work"}</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {sorted.map(j => (
            <JobRow key={j.id} job={j} locationLabel={locationMap?.get(j.locationId)} onNavigate={onNavigate} />
          ))}
        </div>
      )}
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

  // Right rail collapse state (page-local UI only)
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);

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
  const companyName = parentCompany ? getClientDisplayName(parentCompany) : (client?.companyName || "Client");

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
  // locJobs passed directly to LocOverviewTab → ActiveWorkSection (canonical filter owner)

  // ── KPI metrics derived from already-loaded data ──
  // These useMemo hooks MUST be above the early returns to preserve hook order.
  // Lifetime revenue: all-time paid invoices
  const lifetimeRevenue = useMemo(() => {
    return allInvoices
      .filter(i => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
  }, [allInvoices]);

  // Outstanding: excludes drafts and voided — matches canonical UNPAID_INVOICE_STATUSES
  const outstandingInvoices = useMemo(() => {
    const UNPAID = ["awaiting_payment", "sent", "partial_paid"];
    const outstanding = allInvoices.filter(i => UNPAID.includes(i.status));
    const overdueTotal = outstanding
      .filter(i => i.dueDate && new Date(i.dueDate) < new Date())
      .reduce((sum, i) => sum + Number(i.balance ? Number(i.balance) : Number(i.total || 0)), 0);
    return { count: outstanding.length, total: outstanding.reduce((s, i) => s + Number(i.balance ? Number(i.balance) : Number(i.total || 0)), 0), overdueTotal };
  }, [allInvoices]);

  // Active jobs per location for location list badges
  const activeJobCountByLocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of companyJobs) {
      if (j.status === "open") m.set(j.locationId, (m.get(j.locationId) ?? 0) + 1);
    }
    return m;
  }, [companyJobs]);

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
    ? "All Locations"
    : (selectedLoc ? locationDisplayName(selectedLoc) : "");
  const scopeTags = scopeType === "company" ? companyTags : locationTags;

  return (
    <div className="flex h-full flex-col bg-[#F4F8F4]">

      {/* ═══ PAGE HEADER: TITLE + ACTIONS + KPI ═══ */}
      <div className="bg-white border-b border-slate-200 px-6 pt-3 pb-3">
        {/* Row 1: Actions top-right */}
        <div className="flex items-center justify-end mb-1">
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-8 text-xs" onClick={() => setJobDialogOpen(true)}>
              <Plus className="mr-1 h-3 w-3" />Create Job
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAddLocationDialogOpen(true)}>
              <Plus className="mr-1 h-3 w-3" />Add Location
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
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
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openDeleteDialog("location")}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Location
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openDeleteDialog("company")}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Client
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Row 2: Company title left + KPI block centered over workspace */}
        <div className="flex items-end">
          {/* Company identity */}
          <div className="min-w-0 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900 truncate">{companyName}</h1>
              {parentCompany?.isActive === false && (
                <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-[10px] px-1.5 py-0">Inactive</Badge>
              )}
              {companyTags.length > 0 && companyTags.map(tag => (
                <span key={tag.id} className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{locations.length} location{locations.length !== 1 ? "s" : ""}</p>
          </div>

          {/* KPI positioned left-of-center in remaining space */}
          <div className="flex-1 flex justify-start pl-12">
            {/* Contained KPI block */}
            <div className="flex items-center gap-5 rounded-md border border-slate-200 bg-slate-50/80 px-5 py-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-[11px]">Active Jobs</span>
                <span className="font-bold text-[#76B054] text-base tabular-nums">{activeJobsCount}</span>
              </div>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-[11px]">Lifetime Revenue</span>
                <span className="font-bold text-slate-900 text-base">{fmt.format(lifetimeRevenue)}</span>
              </div>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-[11px]">Outstanding</span>
                <span className="font-bold text-slate-900 text-base">{fmt.format(outstandingInvoices.total)}</span>
              </div>
              {outstandingInvoices.overdueTotal > 0 && (
                <>
                  <div className="h-5 w-px bg-red-200" />
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-red-500 text-[11px] font-medium">Overdue</span>
                    <span className="font-bold text-red-600 text-base">{fmt.format(outstandingInvoices.overdueTotal)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 3-COLUMN MASTER-DETAIL WORKSPACE ═══ */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">

        {/* ── LEFT: LOCATION INDEX ── */}
        <div className="w-[256px] flex-shrink-0 rounded-md border border-slate-200 bg-white flex flex-col overflow-hidden">
          {/* Search / label */}
          <div className="px-3 py-2 border-b border-slate-100">
            {locations.length > 3 ? (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search locations..."
                  value={locationSearch}
                  onChange={e => setLocationSearch(e.target.value)}
                  className="h-7 pl-7 text-[11px] bg-slate-50/80 border-slate-200 focus:bg-white"
                />
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Locations</span>
                <span className="text-[10px] text-slate-500 tabular-nums">{locations.length}</span>
              </div>
            )}
          </div>

          {/* Company overview row */}
          <button
            onClick={handleSelectCompany}
            className={`w-full text-left px-3 py-2 border-b border-slate-100 flex items-center gap-2.5 transition-colors ${
              scopeType === "company"
                ? "bg-[rgba(118,176,84,0.08)] border-l-2 border-l-[#76B054]"
                : "hover:bg-slate-50 border-l-2 border-l-transparent"
            }`}
          >
            <Building2 className={`h-3.5 w-3.5 flex-shrink-0 ${scopeType === "company" ? "text-[#76B054]" : "text-slate-400"}`} />
            <span className={`text-xs font-medium truncate ${scopeType === "company" ? "text-[#5F9442]" : "text-slate-700"}`}>All Locations</span>
          </button>

          {/* Location rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredLocations.length > 0 ? filteredLocations.map(loc => {
              const isSelected = scopeType === "location" && selectedLocationId === loc.id;
              const locActiveCount = activeJobCountByLocation.get(loc.id) ?? 0;
              return (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-100/80 transition-colors ${
                    isSelected
                      ? "bg-[rgba(118,176,84,0.08)] border-l-2 border-l-[#76B054]"
                      : "hover:bg-slate-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className={`text-xs font-medium truncate ${isSelected ? "text-[#5F9442]" : "text-slate-800"}`}>
                          {locationDisplayName(loc)}
                        </span>
                        {loc.isPrimary && <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
                      </div>
                      {loc.address && (
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {[loc.address, loc.city].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    {locActiveCount > 0 && (
                      <span className={`text-[10px] font-medium px-1.5 py-0 rounded flex-shrink-0 ${
                        isSelected ? "bg-[#C2E974] text-[#5F9442]" : "bg-slate-100 text-slate-500"
                      }`}>
                        {locActiveCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            }) : (
              <div className="px-3 py-6 text-center text-[11px] text-slate-400">
                {locationSearch ? `No match for "${locationSearch}"` : (
                  <div className="space-y-2">
                    <p>No locations yet</p>
                    <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setAddLocationDialogOpen(true)}>
                      <Plus className="mr-1 h-3 w-3" />Add Location
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: WORKSPACE ── */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0 rounded-md border border-slate-200 bg-white">
          {/* Workspace header + tabs */}
          <div className="border-b border-slate-200 px-5 pt-2.5 pb-0">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {scopeType === "company" && (
                  <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                )}
                {scopeType === "location" && (
                  <MapPin className="h-3.5 w-3.5 text-[#76B054] flex-shrink-0" />
                )}
                <h2 className="text-base font-bold text-slate-900 truncate">{scopeEntityName}</h2>
                {selectedLoc?.isPrimary && scopeType === "location" && (
                  <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] px-1.5 py-0 hover:bg-amber-50">Primary</Badge>
                )}
                {scopeTags.length > 0 && scopeTags.map(tag => (
                  <span key={tag.id} className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>
                ))}
                {scopeType === "location" && selectedLoc && (
                  <button onClick={() => setEditLocationTagsOpen(true)} className="text-slate-400 hover:text-slate-600" title="Edit tags">
                    <Tag className="h-3 w-3" />
                  </button>
                )}
              </div>
              {scopeType === "location" && selectedLoc && (
                <Button variant="ghost" size="sm" className="h-6 text-[11px] text-slate-500" onClick={() => setEditLocationModalOpen(true)}>
                  <Pencil className="mr-1 h-3 w-3" />Edit
                </Button>
              )}
            </div>
            {scopeType === "location" && selectedLoc ? (
              <div className="mb-1 pl-6">
                <p className="text-[11px] text-slate-700 mt-1">{locationAddress(selectedLoc)}</p>
                {selectedLoc.roofLadderCode && (
                  <p className="text-[11px] font-medium text-slate-700 mt-0.5">Site Code: {selectedLoc.roofLadderCode}</p>
                )}
              </div>
            ) : scopeType === "company" ? (
              <p className="text-[11px] text-slate-600 mb-1 pl-6">{companyName} &middot; Across {locations.length} location{locations.length !== 1 ? "s" : ""}</p>
            ) : null}
            {/* Tab bar */}
            <div className="flex -mb-px">
              {(scopeType === "company" ? COMPANY_TABS : LOCATION_TABS).map(t => (
                <button key={t.key} onClick={() => handleTabChange(t.key)}
                  className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                    workspaceTab === t.key
                      ? "text-[#76B054] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#76B054]"
                      : "text-slate-500 hover:text-slate-700"
                  }`}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Tab content */}
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
                    jobs={locJobs}
                    equipment={locationEquipment}
                    onNavigate={setLocation}
                  />
                )}
                {workspaceTab === "jobs" && <LocJobsTab jobs={locJobs} onNavigate={setLocation} />}
                {workspaceTab === "invoices" && <LocInvoicesTab invoices={locInvoices} onNavigate={setLocation} />}
                {workspaceTab === "quotes" && <LocQuotesTab quotes={locQuotes} onNavigate={setLocation} />}
                {workspaceTab === "equipment" && (
                  <LocEquipmentTab
                    equipment={locationEquipment}
                    locationId={selectedLocationId!}
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
              <p className="text-sm text-slate-400 text-center py-12">Select a location from the list</p>
            )}
          </div>
        </div>

        {/* ── RIGHT: SUPPORT SIDEBAR ── */}
        <div className={`flex-shrink-0 rounded-md border border-slate-200 bg-white transition-[width] duration-150 overflow-hidden ${
          rightRailCollapsed ? "w-10" : "w-[320px]"
        }`}>
          {rightRailCollapsed ? (
            <div className="flex flex-col items-center pt-2.5">
              <button
                onClick={() => setRightRailCollapsed(false)}
                className="flex items-center justify-center h-6 w-6 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="Expand sidebar"
              >
                <PanelRightOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Collapse toggle — top-right of rail */}
              <div className="flex justify-end px-1.5 pt-1.5 pb-0">
                <button
                  onClick={() => setRightRailCollapsed(true)}
                  className="flex items-center justify-center h-5 w-5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
                  title="Collapse sidebar"
                >
                  <PanelRightClose className="h-3 w-3" />
                </button>
              </div>
              {/* Rail content */}
              <div className="overflow-y-auto flex-1">
                {scopeType === "company" ? (
                  <>
                    <div className="px-4 pt-2.5 pb-2 border-b border-slate-100">
                      <CompanyContactsCompact
                        companyContacts={clientLevelContacts}
                        locationContacts={allLocationContacts}
                        locations={locations}
                        companyId={companyId}
                      />
                    </div>
                    <div className="px-4 pt-2.5 pb-2 border-b border-slate-100">
                      <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Notes</h3>
                      <NotesPanel scope="company" companyId={companyId || ""} hideAddButton={false} />
                    </div>
                    <div className="px-4 pt-2.5 pb-2">
                      <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Activity</h3>
                      <ClientActivityCompact companyId={companyId} />
                    </div>
                  </>
                ) : selectedLoc && selectedLocationId ? (
                  <>
                    <div className="px-4 pt-2.5 pb-2 border-b border-slate-100">
                      <LocContactsCompact
                        locationContacts={locContacts}
                        companyContacts={locCompanyContacts}
                        locationId={selectedLocationId}
                        parentCompanyId={companyId}
                      />
                    </div>
                    <div className="px-4 pt-2.5 pb-2 border-b border-slate-100">
                      <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Notes</h3>
                      <NotesPanel scope="location" companyId={client.companyId || ""} locationId={selectedLocationId} hideAddButton={false} />
                    </div>
                    {(selectedLoc.roofLadderCode || selectedLoc.notes) && (
                      <div className="px-4 pt-2.5 pb-2">
                        <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Site Info</h3>
                        <div className="text-xs space-y-1">
                          {selectedLoc.roofLadderCode && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Site Code</span>
                              <span className="font-medium text-slate-700">{selectedLoc.roofLadderCode}</span>
                            </div>
                          )}
                          {selectedLoc.notes && (
                            <p className="text-slate-500 leading-snug">{selectedLoc.notes}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}
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

      {/* Add Equipment Dialog — uses shared canonical creation component */}
      {selectedLocationId && (
        <AddEquipmentDialog
          locationId={selectedLocationId}
          open={equipmentModalOpen}
          onOpenChange={setEquipmentModalOpen}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Metadata Panel Components
// ═══════════════════════════════════════════════════════════════════════════════

function MetadataSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">{title}</h3>
      </div>
      {children}
    </div>
  );
}


/** Compact company contacts for metadata panel — full CRUD */
function CompanyContactsCompact({
  companyContacts, locationContacts, locations, companyId,
}: {
  companyContacts: (ClientContact & { assignmentCount?: number })[];
  locationContacts: ClientContact[];
  locations: Client[];
  companyId?: string;
}) {
  const { toast } = useToast();
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);

  // Build person ID → assigned location names for company contact cards
  const personLocationNames = useMemo(() => {
    const locMap = new Map<string, string>();
    locations.forEach(l => locMap.set(l.id, l.location || l.address || l.city || "Location"));
    const result = new Map<string, string[]>();
    locationContacts.forEach(lc => {
      const personId = (lc as any).contactPersonId;
      if (!personId || !lc.locationId) return;
      const names = result.get(personId) ?? [];
      const name = locMap.get(lc.locationId) ?? "Location";
      if (!names.includes(name)) names.push(name);
      result.set(personId, names);
    });
    return result;
  }, [locationContacts, locations]);

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700">Contacts</h3>
        <button
          className="flex items-center gap-0.5 text-[11px] text-primary hover:text-primary/80 transition-colors"
          onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
        >
          <Plus className="h-3.5 w-3.5" /><span>Add</span>
        </button>
      </div>
      {companyContacts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No contacts yet.</p>
      ) : (
        <div className="space-y-1">
          {companyContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => { setEditingContact(ct); setContactDialogOpen(true); }}
              onDelete={(ct) => deleteMutation.mutate(ct.id)}
              assignedLocationNames={personLocationNames.get(c.id) ?? []}
            />
          ))}
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

/** Location contacts — shows assigned contacts with unassign action.
 *  "Add & Assign" creates a new company person and auto-assigns to this location.
 *  "Assign Existing" picks from the company directory. */
function LocContactsCompact({
  locationContacts, companyContacts, locationId, parentCompanyId,
}: {
  locationContacts: (ClientContact & { contactPersonId?: string })[];
  companyContacts: ClientContact[];
  locationId: string;
  parentCompanyId?: string;
}) {
  const { toast } = useToast();
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);
  // Edit assignment roles dialog state
  const [editRolesTarget, setEditRolesTarget] = useState<{
    assignmentId: string; contactName: string; currentRoles: string[];
  } | null>(null);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "contacts"] });
    if (parentCompanyId) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "contacts"] });
    }
  }, [locationId, parentCompanyId]);

  // Unassign = delete the assignment row, NOT the person
  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      if (!parentCompanyId) throw new Error("Company not loaded");
      return apiRequest(`/api/customer-companies/${parentCompanyId}/assignments/${assignmentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      handleRefresh();
      toast({ title: "Contact unassigned from location" });
    },
    onError: () => toast({ title: "Error", description: "Failed to unassign contact.", variant: "destructive" }),
  });

  // Person IDs already assigned (for the assign dialog to filter)
  const assignedPersonIds = locationContacts.map(c => (c as any).contactPersonId || c.id).filter(Boolean);
  const hasUnassigned = companyContacts.some(c => !assignedPersonIds.includes(c.id));

  // For editing person identity: location contacts carry contactPersonId — use that as the person ID for PATCH
  const handleEditFromLocation = (locContact: ClientContact) => {
    const personId = (locContact as any).contactPersonId || locContact.id;
    setEditingContact({ ...locContact, id: personId } as ClientContact);
    setContactDialogOpen(true);
  };

  // For editing assignment roles: use the assignment ID (locContact.id) and current roles
  const handleEditRoles = (locContact: ClientContact) => {
    const nc = normalizeContact(locContact);
    setEditRolesTarget({
      assignmentId: locContact.id,
      contactName: nc.displayName,
      currentRoles: nc.roles,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700">Contacts</h3>
        <div className="flex items-center gap-2">
          {parentCompanyId && hasUnassigned && (
            <button className="text-[11px] text-primary hover:text-primary/80 transition-colors" onClick={() => setAssignDialogOpen(true)}>
              Assign
            </button>
          )}
          <button
            className="flex items-center gap-0.5 text-[11px] text-primary hover:text-primary/80 transition-colors"
            onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /><span>Add</span>
          </button>
        </div>
      </div>
      {locationContacts.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No contacts assigned.</p>
      ) : (
        <div className="space-y-1">
          {locationContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => handleEditFromLocation(ct)}
              onEditRoles={(ct) => handleEditRoles(ct)}
              onDelete={(ct) => unassignMutation.mutate(ct.id)}
              deleteLabel="Unassign"
            />
          ))}
        </div>
      )}
      {/* Add & Assign (null contact) or Edit person (editingContact set) */}
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={(v) => { setContactDialogOpen(v); if (!v) setEditingContact(null); }}
        companyId={parentCompanyId}
        contact={editingContact}
        associationType={editingContact ? "company" : "location"}
        locationId={editingContact ? undefined : locationId}
        onSuccess={handleRefresh}
      />
      {/* Assign existing company contact to this location */}
      {parentCompanyId && (
        <AssignContactDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          customerCompanyId={parentCompanyId}
          locationId={locationId}
          assignedPersonIds={assignedPersonIds}
          onSuccess={handleRefresh}
        />
      )}
      {/* Edit assignment roles for a specific location contact */}
      {parentCompanyId && editRolesTarget && (
        <EditAssignmentRolesDialog
          open={Boolean(editRolesTarget)}
          onOpenChange={(v) => { if (!v) setEditRolesTarget(null); }}
          customerCompanyId={parentCompanyId}
          assignmentId={editRolesTarget.assignmentId}
          contactName={editRolesTarget.contactName}
          currentRoles={editRolesTarget.currentRoles}
          onSuccess={handleRefresh}
        />
      )}
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

  if (!companyId) return <p className="text-[11px] text-muted-foreground/60">—</p>;
  if (isLoading) return <Skeleton className="h-5 w-24" />;
  if (activity.length === 0) return <p className="text-[11px] text-muted-foreground/60">No activity yet.</p>;

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

/** Company overview — delegates to shared ActiveWorkSection. */
function CompanyOverviewTab({
  jobs, locations, onNavigate,
}: {
  jobs: Job[]; invoices: Invoice[]; quotes: EnrichedQuote[];
  locations: Client[]; onNavigate: (p: string) => void;
}) {
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  return (
    <ActiveWorkSection
      jobs={jobs}
      locationMap={locMap}
      emptyLabel="No active jobs across locations"
      onNavigate={onNavigate}
    />
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Location-Scope Workspace Tab Components
// ═══════════════════════════════════════════════════════════════════════════════

function LocOverviewTab({
  jobs, equipment, onNavigate,
}: {
  jobs: Job[]; equipment: LocationEquipment[];
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <ActiveWorkSection
        jobs={jobs}
        emptyLabel="No active work at this location"
        onNavigate={onNavigate}
      />

      {/* Equipment summary */}
      {equipment.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Equipment</h3>
            <span className="text-[10px] text-slate-400">{equipment.length} units</span>
          </div>
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
            {equipment.slice(0, 5).map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs px-3 py-2">
                <span className="font-medium text-slate-700">{e.name} {e.equipmentType && <span className="text-slate-400 font-normal">· {e.equipmentType}</span>}</span>
                <span className="text-slate-400 text-[11px]">{e.manufacturer || ""}</span>
              </div>
            ))}
            {equipment.length > 5 && (
              <p className="text-[10px] text-slate-400 py-1.5 text-center">+{equipment.length - 5} more</p>
            )}
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
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Jobs</h3>
        <span className="text-[10px] text-slate-400">{jobs.length} total</span>
      </div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
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
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Invoices</h3>
        <span className="text-[10px] text-slate-400">{invoices.length} total</span>
      </div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
        {invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between py-2 px-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => onNavigate(`/invoices/${inv.id}`)}>
            <div>
              <div className="font-medium text-slate-700">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</div>
              <div className="text-slate-400 text-[10px]">{inv.issueDate ? format(new Date(inv.issueDate), "MMM dd, yyyy") : ""}</div>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls(inv.status)}`}>{inv.status}</span>
              <p className="text-slate-500 text-[11px]">{fmt.format(Number(inv.total ?? 0))}</p>
            </div>
          </div>
        ))}
      </div>
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
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Quotes</h3>
        <span className="text-[10px] text-slate-400">{quotes.length} total</span>
      </div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
        {quotes.map(q => (
          <div key={q.id} className="flex items-center justify-between py-2 px-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => onNavigate(`/quotes/${q.id}`)}>
            <div>
              <div className="font-medium text-slate-700">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}{q.title ? ` — ${q.title}` : ""}</div>
              <div className="text-slate-400 text-[10px]">{q.updatedAt ? format(new Date(q.updatedAt), "MMM dd, yyyy") : ""}</div>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls(q.status)}`}>{q.status}</span>
              <p className="text-slate-500 text-[11px]">{fmt.format(Number(q.total ?? 0))}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocEquipmentTab({
  equipment, locationId, onAdd, onDelete,
}: {
  equipment: LocationEquipment[];
  locationId: string;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const { toast } = useToast();
  const [detailEquipment, setDetailEquipment] = useState<LocationEquipment | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const confirmTarget = confirmDeleteId ? equipment.find(e => e.id === confirmDeleteId) : null;

  // Fetch archived equipment only when toggle is on
  const archivedQuery = useQuery<LocationEquipment[]>({
    queryKey: ["/api/clients", locationId, "equipment", "archived"],
    queryFn: () => apiRequest(`/api/clients/${locationId}/equipment/archived`),
    enabled: showArchived,
  });

  const restoreMutation = useMutation({
    mutationFn: (equipmentId: string) =>
      apiRequest(`/api/clients/${locationId}/equipment/${equipmentId}/restore`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "equipment", "archived"] });
      toast({ title: "Equipment restored" });
      setConfirmRestoreId(null);
    },
    onError: () => toast({ title: "Error", description: "Failed to restore equipment.", variant: "destructive" }),
  });

  const archivedList = archivedQuery.data ?? [];
  const restoreTarget = confirmRestoreId ? archivedList.find(e => e.id === confirmRestoreId) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Equipment</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{equipment.length} units</span>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={onAdd}>
            <Plus className="mr-1 h-3 w-3" />Add
          </Button>
        </div>
      </div>
      {equipment.length === 0 && !showArchived ? (
        <p className="text-xs text-slate-400 py-4 text-center">No equipment registered</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {equipment.map(eq => (
            <div key={eq.id} className="px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => setDetailEquipment(eq)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-700">{eq.name}</div>
                  <div className="text-slate-400 text-[10px]">{eq.equipmentType || "—"}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(eq.id); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {eq.manufacturer || ""} {eq.modelNumber || ""} {(eq.manufacturer || eq.modelNumber) && eq.serialNumber ? "•" : ""} S/N: {eq.serialNumber || "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Show archived toggle */}
      <button onClick={() => setShowArchived(v => !v)}
        className="mt-2 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
        {showArchived ? "Hide archived" : "Show archived"}
      </button>

      {/* Archived equipment list */}
      {showArchived && archivedList.length > 0 && (
        <div className="mt-1.5 border border-slate-200 rounded bg-slate-50 divide-y divide-slate-100">
          {archivedList.map(eq => (
            <div key={eq.id} className="px-3 py-2 text-xs opacity-60">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-500">{eq.name}</div>
                  <div className="text-slate-400 text-[10px]">{eq.equipmentType || "—"}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">Archived</Badge>
                  <Button variant="outline" size="sm" className="h-5 text-[10px] px-2"
                    onClick={() => setConfirmRestoreId(eq.id)}>
                    Restore
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showArchived && archivedList.length === 0 && !archivedQuery.isLoading && (
        <p className="text-[10px] text-slate-400 mt-1">No archived equipment</p>
      )}

      {/* Delete confirmation dialog */}
      {confirmTarget && (
        <Dialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Delete this equipment?</DialogTitle>
              <DialogDescription>
                This will remove <span className="font-medium text-foreground">{confirmTarget.name}</span> from
                the active equipment list for this location. Service history and related notes will be preserved.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { onDelete(confirmDeleteId!); setConfirmDeleteId(null); }}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Restore confirmation dialog */}
      {restoreTarget && (
        <Dialog open={!!confirmRestoreId} onOpenChange={(open) => { if (!open) setConfirmRestoreId(null); }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Restore this equipment?</DialogTitle>
              <DialogDescription>
                This will make <span className="font-medium text-foreground">{restoreTarget.name}</span> active
                again and return it to the active equipment list.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setConfirmRestoreId(null)}>Cancel</Button>
              <Button onClick={() => restoreMutation.mutate(confirmRestoreId!)}
                disabled={restoreMutation.isPending}>
                {restoreMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Restore
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <EquipmentDetailModal
        open={!!detailEquipment}
        onOpenChange={(open) => { if (!open) setDetailEquipment(null); }}
        equipment={detailEquipment}
      />
    </div>
  );
}

function LocPartsTab({ pmParts, onAdd }: { pmParts: PMPartWithItem[]; onAdd: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">PM Parts</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">{pmParts.length} items</span>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={onAdd}>
            <Plus className="mr-1 h-3 w-3" />Add
          </Button>
        </div>
      </div>
      {pmParts.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No PM parts configured</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {pmParts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 px-3 text-xs">
              <div>
                <div className="font-medium text-slate-700">{p.itemName || "Unknown Part"}</div>
                {p.itemSku && <div className="text-slate-400 text-[10px]">{p.itemSku}</div>}
              </div>
              <span className="text-slate-500 font-medium text-[11px]">x{p.quantityPerVisit}</span>
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
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Active</h3>
          <span className="text-[10px] text-slate-400">{activeJobs.length} jobs</span>
        </div>
        {activeJobs.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No active jobs</p>
        ) : (
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
            {activeJobs.map(j => (
              <JobRow key={j.id} job={j} locationLabel={locMap.get(j.locationId)} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
      {archivedJobs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Archived</h3>
            <span className="text-[10px] text-slate-400">{archivedJobs.length} jobs</span>
          </div>
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
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
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Invoices</h3>
        <span className="text-[10px] text-slate-400">{invoices.length} total</span>
      </div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
        {invoices.map(inv => (
          <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => onNavigate(`/invoices/${inv.id}`)}>
            <div>
              <span className="font-medium text-slate-700">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</span>
              <span className="text-slate-500 ml-2">{fmt.format(Number(inv.total ?? 0))}</span>
              <p className="text-slate-400 text-[10px]">{locMap.get(inv.locationId) || ""}</p>
            </div>
            {(() => {
              const badge = getInvoiceStatusBadge(inv.status, false);
              return <Badge variant={badge.variant} className="text-[10px] flex-shrink-0">{badge.label}</Badge>;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientAllQuotesTab({ quotes, locations, onNavigate }: { quotes: EnrichedQuote[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  if (quotes.length === 0) return <EmptyState label="No quotes for this client" />;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Quotes</h3>
        <span className="text-[10px] text-slate-400">{quotes.length} total</span>
      </div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
        {quotes.map(q => (
          <div key={q.id} className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => onNavigate(`/quotes/${q.id}`)}>
            <div>
              <span className="font-medium text-slate-700">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}</span>
              {q.title && <span className="text-slate-500 ml-1">— {q.title}</span>}
              <span className="text-slate-500 ml-2">{fmt.format(Number(q.total ?? 0))}</span>
              <p className="text-slate-400 text-[10px]">{q.locationId ? locMap.get(q.locationId) || "" : ""}</p>
            </div>
            <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">{q.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════════

/** Contact card — compact layout: Name + Primary → Phone/Email → Location labels / Role badges.
 *  Hierarchy: identity first, contact info second, locations/roles third. */
function ContactCard({
  contact, onEdit, onEditRoles, onDelete, showScope = false, assignedLocationNames, deleteLabel,
}: {
  contact: ClientContact;
  onEdit?: (c: ClientContact) => void;
  onEditRoles?: (c: ClientContact) => void;
  onDelete?: (c: ClientContact) => void;
  showScope?: boolean;
  /** Location names this person is assigned to (company cards only) */
  assignedLocationNames?: string[];
  deleteLabel?: string;
}) {
  const nc = normalizeContact(contact);
  const initials = [contact.firstName, contact.lastName].filter(Boolean).map(n => n![0]).join("");

  // Format location names for display: "Oakville, RBC Plaza" or "Oakville, RBC Plaza +1 more"
  const MAX_VISIBLE_LOCATIONS = 2;
  const locationLabel = assignedLocationNames && assignedLocationNames.length > 0
    ? assignedLocationNames.length <= MAX_VISIBLE_LOCATIONS
      ? assignedLocationNames.join(", ")
      : `${assignedLocationNames.slice(0, MAX_VISIBLE_LOCATIONS).join(", ")} +${assignedLocationNames.length - MAX_VISIBLE_LOCATIONS} more`
    : null;

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
        {(onEdit || onEditRoles || onDelete) && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onEditRoles && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onEditRoles(contact)} title="Edit roles">
                <Tag className="h-2.5 w-2.5" />
              </Button>
            )}
            {onEdit && (
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onEdit(contact)} title="Edit contact">
                <Pencil className="h-2.5 w-2.5" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => onDelete(contact)} title={deleteLabel || "Delete"}>
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
      {/* Row 3a: Assigned location labels (company cards) */}
      {locationLabel && (
        <div className="flex items-center gap-1 text-muted-foreground pl-[26px] mt-0.5">
          <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">{locationLabel}</span>
        </div>
      )}
      {/* Row 3b: Role badges — only if roles exist */}
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
