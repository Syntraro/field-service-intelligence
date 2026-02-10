import { useState, useMemo, useRef } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Phone,
  Mail,
  Plus,
  Star,
  Pencil,
  Briefcase,
  FileText,
  ChevronRight,
  ChevronDown,
  Link as LinkIcon,
  AlertTriangle,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import NotesPanel, { type NotesPanelRef } from "@/components/NotesPanel";
import EditTagsModal from "@/components/EditTagsModal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { Client, CustomerCompany, Job, Invoice, ClientContact, ClientTag } from "@shared/schema";
import { isJobOverdue, isJobScheduled } from "@shared/schema";

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

// Orphan location suggestion type
type UnlinkedSuggestion = {
  id: string;
  companyName: string;
  location: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  createdAt: string;
  suggestedCustomerCompanyId: string | null;
  suggestedCustomerCompanyName: string | null;
};

type UnlinkedSuggestionsResponse = {
  suggestions: UnlinkedSuggestion[];
  count: number;
  customerCompany: {
    id: string;
    name: string;
  };
};

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Person-level grouping types (hoisted before state so PersonGroup can be used in useState)
  type Assoc = {
    scope: "company" | "location";
    locationId?: string;
    locationName: string;
    roles: string[];
    isPrimary: boolean;
    id: string;
  };
  type PersonGroup = {
    key: string;
    name: string;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    associations: Assoc[];
    companyWide: boolean;
    locationNames: string[];
    primaryAssociationId: string;
  };

  const [overviewTab, setOverviewTab] = useState<OverviewTab>("activeWork");
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [preselectedLocationId, setPreselectedLocationId] = useState<string | undefined>();
  const [notesOpen, setNotesOpen] = useState(true);
  const notesPanelRef = useRef<NotesPanelRef>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  // Phase 5: Per-location roles — each association carries its own billing/scheduling flags
  type RoleFlags = { billing: boolean; scheduling: boolean };
  type AssociationState =
    | { type: "company"; companyRoles: RoleFlags }
    | { type: "locations"; locationRolesById: Record<string, RoleFlags> };
  type ContactForm = {
    firstName: string; lastName: string; phone: string; email: string;
    association: AssociationState;
  };
  const emptyContactForm: ContactForm = {
    firstName: "", lastName: "", phone: "", email: "",
    association: { type: "company", companyRoles: { billing: false, scheduling: false } },
  };
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactModalMode, setContactModalMode] = useState<"add" | "edit">("add");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingPersonGroup, setEditingPersonGroup] = useState<PersonGroup | null>(null);
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContactForm);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  // Accordion expand state for unified contact rows
  const [openContactKey, setOpenContactKey] = useState<string | null>(null);

  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({
    location: "",
    address: "",
    city: "",
    province: "",
    postalCode: "",
    contactName: "",
    phone: "",
    email: "",
  });

  const {
    data: client,
    isLoading: clientLoading,
    error: clientError,
  } = useQuery<Client>({
    queryKey: ["/api/clients", clientId],
    queryFn: async () => {
      // Try client_locations first, then fall back to customer_companies
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

  /**
   * Unified overview endpoint - server normalizes legacy IDs into Model A.
   * Uses /api/clients/:id/overview
   */
  const { data: overview } = useQuery<CompanyOverview>({
    queryKey: ["/api/clients", clientId, "overview"],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // Try client_locations overview first
      const res = await fetch(`/api/clients/${clientId}/overview`, {
        credentials: "include",
      });
      if (res.ok) return res.json();

      // Fallback to customer_companies overview
      if (res.status === 404) {
        const companyRes = await fetch(`/api/customer-companies/${clientId}/overview`, {
          credentials: "include",
        });
        if (companyRes.ok) return companyRes.json();
      }
      throw new Error("Failed to fetch client overview");
    },
    enabled: Boolean(clientId),
  });

  const parentCompany = overview?.company;
  const companyId = parentCompany?.id;

  // Phase 1 Client Tags: fetch tags for this customer company
  const [editTagsOpen, setEditTagsOpen] = useState(false);
  const { data: companyTags = [] } = useQuery<ClientTag[]>({
    queryKey: ["/api/customer-companies", companyId, "tags"],
    queryFn: () => apiRequest(`/api/customer-companies/${companyId}/tags`),
    enabled: Boolean(companyId),
  });

  // Phase 4: Fetch contacts for the customer company (company-level + all locations)
  const { data: contactsData } = useQuery<{ companyContacts: ClientContact[]; locationContacts: ClientContact[] }>({
    queryKey: ["/api/customer-companies", companyId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${companyId}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: Boolean(companyId),
  });

  const companyContacts = contactsData?.companyContacts ?? [];
  const locationContacts = contactsData?.locationContacts ?? [];

  // Keep your existing variable names so the UI doesn't change.
  const unsortedLocations: Client[] = overview?.locations ?? [];
  // Sort locations: primary first, then by createdAt for deterministic order
  const locations: Client[] = [...unsortedLocations].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const jobs: Job[] = overview?.jobs ?? [];
  const invoices: Invoice[] = overview?.invoices ?? [];

  /**
   * Jobs roll up by locationId (not clientId)
   */
  const companyJobs = jobs.filter((job) => {
    if (locations.length) return locations.some((loc) => loc.id === job.locationId);
    return job.locationId === clientId;
  });

  // Use canonical isJobOverdue predicate
  const overdueJobs = companyJobs.filter((j) => isJobOverdue(j));

  const overdueJobIds = new Set(overdueJobs.map((j) => j.id));
  const activeJobs = companyJobs.filter(
    // Active = open + (scheduled OR in_progress)
    // Use canonical isJobScheduled predicate for scheduled check
    (j) => j.status === "open" &&
           (isJobScheduled(j) || j.openSubStatus === "in_progress") &&
           !overdueJobIds.has(j.id)
  );

  /**
   * ✅ MODEL A FIX:
   * Add Location must attach to customerCompanies (parent) — not to /api/clients/:id/locations.
   */
  const createLocationMutation = useMutation({
    mutationFn: async (locationData: typeof newLocationForm) => {
      if (!companyId) {
        throw new Error("Company not loaded yet. Please refresh and try again.");
      }
      return await apiRequest(`/api/customer-companies/${companyId}/locations`, {
        method: "POST",
        body: JSON.stringify(locationData),
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
      setNewLocationForm({
        location: "",
        address: "",
        city: "",
        province: "",
        postalCode: "",
        contactName: "",
        phone: "",
        email: "",
      });
      toast({ title: "Location added", description: "The new property/location has been created." });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to add location.";
      toast({
        title: "Error",
        description: errorMessage.includes("SUBSCRIPTION_LIMIT")
          ? "You've reached your location limit. Please upgrade your plan to add more locations."
          : errorMessage,
        variant: "destructive",
      });
    },
  });

  // Query for unlinked location suggestions (orphan locations that match this company)
  const { data: unlinkedData, isLoading: unlinkedLoading } = useQuery<UnlinkedSuggestionsResponse>({
    queryKey: ["/api/customer-companies", companyId, "unlinked-suggestions"],
    queryFn: async () => {
      const res = await fetch(`/api/customer-companies/${companyId}/unlinked-suggestions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch unlinked suggestions");
      return res.json();
    },
    enabled: Boolean(companyId),
  });

  const unlinkedSuggestions = unlinkedData?.suggestions ?? [];

  // Mutation to link an orphan location to this customer company
  const linkLocationMutation = useMutation({
    mutationFn: async (locationId: string) => {
      if (!companyId) {
        throw new Error("Company not loaded yet");
      }
      return await apiRequest(`/api/customer-companies/${companyId}/link-location`, {
        method: "POST",
        body: JSON.stringify({ locationId }),
      });
    },
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "locations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "unlinked-suggestions"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/orphan-locations"] });

      toast({
        title: "Location linked",
        description: "The location has been linked to this client successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to link location.",
        variant: "destructive",
      });
    },
  });

  // Contact CRUD mutations
  const contactsQueryKey = ["/api/customer-companies", companyId, "contacts"];

  // Invalidate both company-level and all location-level contact caches
  const invalidateAllContacts = () => {
    queryClient.invalidateQueries({ queryKey: contactsQueryKey });
    // Also refresh any cached LocationDetailPage contact queries
    locations.forEach((loc) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", loc.id, "contacts"] });
    });
  };

  // Phase 5: Convert RoleFlags to roles string array
  const buildRolesFromFlags = (flags: RoleFlags): string[] => {
    const roles: string[] = [];
    if (flags.billing) roles.push("billing");
    if (flags.scheduling) roles.push("scheduling");
    return roles;
  };

  const createContactMutation = useMutation({
    mutationFn: async (form: ContactForm) => {
      if (!companyId) throw new Error("Company not loaded yet");
      const assoc = form.association;
      // Phase 5: Build payload with per-association roles
      const base = {
        firstName: form.firstName, lastName: form.lastName,
        phone: form.phone || null, email: form.email || null,
      };
      if (assoc.type === "company") {
        return apiRequest(`/api/customer-companies/${companyId}/contacts`, {
          method: "POST",
          body: JSON.stringify({ ...base, roles: buildRolesFromFlags(assoc.companyRoles), association: { type: "company" } }),
        });
      }
      // Locations mode: send per-location roles
      return apiRequest(`/api/customer-companies/${companyId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          ...base,
          association: {
            type: "locations",
            locations: Object.entries(assoc.locationRolesById).map(([locId, flags]) => ({
              locationId: locId, roles: buildRolesFromFlags(flags),
            })),
          },
        }),
      });
    },
    onSuccess: () => {
      invalidateAllContacts();
      setContactModalOpen(false);
      setContactForm(emptyContactForm);
      toast({ title: "Contact added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to add contact.", variant: "destructive" });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ form, primaryContactId, personAssociations }: {
      form: ContactForm; primaryContactId: string; personAssociations: Assoc[];
    }) => {
      if (!companyId) throw new Error("Company not loaded yet");
      // Collect all existing DB row IDs for this person so backend can replace them atomically
      const existingContactIds = personAssociations.map((a) => a.id);
      const base = {
        firstName: form.firstName, lastName: form.lastName,
        phone: form.phone || null, email: form.email || null,
      };
      // Build association payload matching the backend schema
      const association = form.association.type === "company"
        ? { type: "company" as const, roles: buildRolesFromFlags(form.association.companyRoles) }
        : {
            type: "locations" as const,
            locations: Object.entries(
              (form.association as { type: "locations"; locationRolesById: Record<string, RoleFlags> }).locationRolesById
            ).map(([locId, flags]) => ({ locationId: locId, roles: buildRolesFromFlags(flags) })),
          };
      return apiRequest(`/api/customer-companies/${companyId}/contacts/${primaryContactId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...base, association, existingContactIds }),
      });
    },
    onSuccess: async () => {
      invalidateAllContacts();
      // Await refetch to ensure fresh data before UI renders
      await queryClient.refetchQueries({ queryKey: contactsQueryKey });
      setContactModalOpen(false);
      setEditingContactId(null);
      setEditingPersonGroup(null);
      setContactForm(emptyContactForm);
      toast({ title: "Contact updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to update contact.", variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      if (!companyId) throw new Error("Company not loaded yet");
      return apiRequest(`/api/customer-companies/${companyId}/contacts/${contactId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      invalidateAllContacts();
      setDeleteContactId(null);
      toast({ title: "Contact deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to delete contact.", variant: "destructive" });
    },
  });

  // Validation: name present + (phone or email); for "locations" mode require at least one location
  const selectedLocationCount = contactForm.association.type === "locations"
    ? Object.keys(contactForm.association.locationRolesById).length : 0;
  const isContactFormValid =
    (contactForm.firstName.trim() || contactForm.lastName.trim()) &&
    (contactForm.phone.trim() || contactForm.email.trim()) &&
    (contactForm.association.type === "company" || selectedLocationCount > 0);

  // Helpers to open the unified modal
  const openAddContact = () => {
    setContactModalMode("add");
    setEditingContactId(null);
    setEditingPersonGroup(null);
    setContactForm(emptyContactForm);
    setContactModalOpen(true);
  };
  // Phase 5: Edit prefill uses PersonGroup to populate per-location roles
  const openEditContact = (pg: PersonGroup) => {
    const primary = companyContacts.find(x => x.id === pg.primaryAssociationId)
      || locationContacts.find(x => x.id === pg.primaryAssociationId);
    if (!primary) return;
    setContactModalMode("edit");
    setEditingContactId(pg.primaryAssociationId);
    setEditingPersonGroup(pg);
    const association: AssociationState = pg.companyWide
      ? {
          type: "company",
          companyRoles: {
            billing: pg.associations.find(a => a.scope === "company")?.roles.includes("billing") ?? false,
            scheduling: pg.associations.find(a => a.scope === "company")?.roles.includes("scheduling") ?? false,
          },
        }
      : {
          type: "locations",
          locationRolesById: Object.fromEntries(
            pg.associations
              .filter(a => a.scope === "location" && a.locationId)
              .map(a => [a.locationId!, {
                billing: a.roles.includes("billing"),
                scheduling: a.roles.includes("scheduling"),
              }])
          ),
        };
    setContactForm({
      firstName: primary.firstName || "",
      lastName: primary.lastName || "",
      phone: primary.phone || "",
      email: primary.email || "",
      association,
    });
    setContactModalOpen(true);
  };

  const locationNameById = useMemo(() => {
    const m = new Map<string, string>();
    locations.forEach((l) => m.set(l.id, l.location || l.companyName || "Location"));
    return m;
  }, [locations]);

  const peopleGroups = useMemo<PersonGroup[]>(() => {
    const byKey = new Map<string, PersonGroup>();

    const makeKey = (c: ClientContact) => {
      const email = (c.email || "").trim().toLowerCase();
      if (email) return `e:${email}`;
      const phone = (c.phone || "").replace(/\D/g, "");
      if (phone) return `p:${phone}`;
      const fn = (c.firstName || "").trim().toLowerCase();
      const ln = (c.lastName || "").trim().toLowerCase();
      if (fn || ln) return `n:${fn}|${ln}`;
      return `id:${c.id}`;
    };

    const upsert = (c: ClientContact, assoc: Omit<Assoc, "id">) => {
      const key = makeKey(c);
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Unnamed";
      const id = c.id;

      let g = byKey.get(key);
      if (!g) {
        g = {
          key, name,
          phone: c.phone || null, email: c.email || null,
          isPrimary: Boolean(c.isPrimary),
          associations: [], companyWide: false, locationNames: [],
          primaryAssociationId: id,
        };
        byKey.set(key, g);
      }
      // Merge base fields — pick first non-empty
      if (g.name === "Unnamed" && name !== "Unnamed") g.name = name;
      if (!g.phone && c.phone) g.phone = c.phone;
      if (!g.email && c.email) g.email = c.email;
      if (c.isPrimary) g.isPrimary = true;

      g.associations.push({ ...assoc, id });
      // Prefer company-wide record for edit/delete
      if (assoc.scope === "company") g.primaryAssociationId = id;
    };

    companyContacts.forEach((c) =>
      upsert(c, { scope: "company", locationName: "Company", roles: [...c.roles], isPrimary: Boolean(c.isPrimary) })
    );
    locationContacts.forEach((c) =>
      upsert(c, {
        scope: "location", locationId: c.locationId ?? undefined,
        locationName: locationNameById.get(c.locationId ?? "") || "Location",
        roles: [...c.roles], isPrimary: Boolean(c.isPrimary),
      })
    );

    const result = Array.from(byKey.values()).map((g) => {
      const companyWide = g.associations.some((a) => a.scope === "company");
      const locs = Array.from(new Set(
        g.associations.filter((a) => a.scope === "location").map((a) => a.locationName)
      )).sort();
      // Sort associations: company first, then locations alphabetically
      g.associations.sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === "company" ? -1 : 1;
        return a.locationName.localeCompare(b.locationName);
      });
      return { ...g, companyWide, locationNames: locs };
    });

    // Primary contacts first, then alphabetical by name
    result.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
    return result;
  }, [companyContacts, locationContacts, locationNameById]);

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
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/clients")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Client List
          </Button>
        </div>
      </div>
    );
  }

  // Robust fallback chain — client may be a Client (.companyName) or CustomerCompany (.name)
  // depending on which query branch resolved. Never store in state so it can't stale out.
  const companyName =
    parentCompany?.name ||
    (client as any)?.companyName ||
    (client as any)?.name ||
    (client as any)?.displayName ||
    "Unnamed Client";
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
              onClick={() => setLocation("/clients")}
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
          {/* Tag pills */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {companyTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setEditTagsOpen(true)}
              className="inline-flex items-center rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3 mr-0.5" />
              {companyTags.length === 0 ? "Add Tag" : "Edit"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditDialogOpen(true)} data-testid="button-edit-client">
            <Pencil className="h-4 w-4 mr-2" />
            Edit Company
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
          {/* Properties / Locations */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-sm font-semibold">Properties / Locations</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddLocationDialogOpen(true)}
                data-testid="button-add-location"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Location
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {locations.length === 0 ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left hover-elevate"
                    onClick={() => handleGoToLocation(clientId!)}
                    data-testid={`row-location-${clientId}`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                      <span className="font-medium">{client.location || "Primary Location"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {client.address || `${client.city}, ${client.province}`}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </button>
                ) : (
                  locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left hover-elevate"
                      onClick={() => handleGoToLocation(loc.id)}
                      data-testid={`row-location-${loc.id}`}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        {loc.isPrimary && (
                          <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                        )}
                        <span className="font-medium">{loc.location || loc.companyName}</span>
                        {loc.inactive && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {loc.address || `${loc.city}, ${loc.province}`}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Unlinked Locations Section - Only show if there are suggestions */}
          {unlinkedSuggestions.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <CardTitle className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                    Unlinked Locations ({unlinkedSuggestions.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-500">
                  These locations appear to belong to this client but are not linked. Click "Link" to connect them.
                </p>
                <div className="divide-y">
                  {unlinkedSuggestions.map((orphan) => (
                    <div
                      key={orphan.id}
                      className="flex items-center justify-between px-4 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {orphan.location || orphan.companyName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {orphan.address || `${orphan.city || ""}, ${orphan.province || ""}`.trim().replace(/^,|,$/g, "")}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-2 shrink-0"
                        onClick={() => linkLocationMutation.mutate(orphan.id)}
                        disabled={linkLocationMutation.isPending}
                      >
                        <LinkIcon className="h-3 w-3 mr-1" />
                        Link
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
                            job.status === "completed" || job.status === "invoiced"
                              ? "default"
                              : job.openSubStatus === "in_progress"
                              ? "default"
                              : isJobScheduled(job)
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {job.openSubStatus === "in_progress" ? "In Progress" :
                           isJobScheduled(job) ? "Scheduled" :
                           job.status === "completed" ? "Completed" :
                           job.status === "invoiced" ? "Invoiced" :
                           job.status === "archived" ? "Archived" : "Open"}
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
          {/* Contacts — one row per person, accordion expand for associations */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Contacts ({peopleGroups.length})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-auto p-0 text-primary"
                onClick={openAddContact}
                disabled={!companyId}
              >
                + Add Contact
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {peopleGroups.length === 0 ? (
                <div className="text-muted-foreground text-sm py-2">No contacts yet.</div>
              ) : (
                <div className="divide-y">
                  {peopleGroups.map((p) => {
                    const isOpen = openContactKey === p.key;
                    const firstLoc = p.locationNames[0];
                    const extra = p.locationNames.length - 1;

                    return (
                      <div key={p.key} className="py-2">
                        {/* Row header */}
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="flex items-start gap-2 text-left min-w-0 flex-1"
                            onClick={() => setOpenContactKey((prev) => (prev === p.key ? null : p.key))}
                          >
                            <ChevronRight className={`h-4 w-4 mt-0.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-sm">{p.name}</span>
                                {p.isPrimary && (
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">Primary</Badge>
                                )}
                                {p.companyWide && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">Company</Badge>
                                )}
                                {p.locationNames.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {extra > 0 ? `${firstLoc} +${extra}` : firstLoc}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                                {p.phone && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />{p.phone}
                                  </span>
                                )}
                                {p.email && (
                                  <span className="flex items-center gap-1 min-w-0">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate max-w-[220px]">{p.email}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>

                          {/* Kebab menu — outside the toggle button */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditContact(p)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteContactId(p.primaryAssociationId)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Expanded: all associations with per-association roles */}
                        {isOpen && (
                          <div className="mt-2 ml-6">
                            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                              Associations
                            </div>
                            <div className="space-y-2">
                              {p.associations.map((a) => (
                                <div key={a.id} className="flex items-center gap-2 text-xs">
                                  <span className="min-w-[70px] text-muted-foreground">{a.locationName}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {a.roles.map((r) => (
                                      <Badge key={r} variant="secondary" className="text-[10px] px-1 py-0 capitalize">{r}</Badge>
                                    ))}
                                    {a.roles.length === 0 && (
                                      <span className="text-muted-foreground">No roles</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes — uses reusable NotesPanel with attachments + visibility flags */}
          <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover-elevate" data-testid="trigger-notes">
                  <span className="text-sm font-semibold">Notes</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto p-0 text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNotesOpen(true);
                        notesPanelRef.current?.startAdding();
                      }}
                      data-testid="button-add-note"
                    >
                      + Add
                    </Button>
                    {notesOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t px-4 pb-4 pt-3">
                  <NotesPanel ref={notesPanelRef} scope="company" companyId={companyId || ""} hideAddButton />
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>

      {/* Dialogs */}
      <QuickAddJobDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        preselectedLocationId={preselectedLocationId}
      />

      {client && (
        <EditClientDialog
          client={client}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
            queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
            if (companyId) {
              queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "locations"] });
              queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
            }
            setEditDialogOpen(false);
          }}
        />
      )}

      {/* Edit Tags Modal */}
      {companyId && (
        <EditTagsModal
          open={editTagsOpen}
          onOpenChange={setEditTagsOpen}
          entityType="customerCompany"
          entityId={companyId}
          currentTags={companyTags}
        />
      )}

      {/* Add Location Dialog */}
      <Dialog open={addLocationDialogOpen} onOpenChange={setAddLocationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Property / Location</DialogTitle>
            <DialogDescription>Add a new property or location under {companyName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="location-name">Location Name</Label>
              <Input
                id="location-name"
                placeholder="e.g., Downtown Office, Warehouse #2"
                value={newLocationForm.location}
                onChange={(e) => setNewLocationForm((prev) => ({ ...prev, location: e.target.value }))}
                data-testid="input-location-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-address">Address</Label>
              <Input
                id="location-address"
                placeholder="Street address"
                value={newLocationForm.address}
                onChange={(e) => setNewLocationForm((prev) => ({ ...prev, address: e.target.value }))}
                data-testid="input-location-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location-city">City</Label>
                <Input
                  id="location-city"
                  value={newLocationForm.city}
                  onChange={(e) => setNewLocationForm((prev) => ({ ...prev, city: e.target.value }))}
                  data-testid="input-location-city"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-province">Province</Label>
                <Input
                  id="location-province"
                  value={newLocationForm.province}
                  onChange={(e) => setNewLocationForm((prev) => ({ ...prev, province: e.target.value }))}
                  data-testid="input-location-province"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-postal">Postal Code</Label>
              <Input
                id="location-postal"
                value={newLocationForm.postalCode}
                onChange={(e) => setNewLocationForm((prev) => ({ ...prev, postalCode: e.target.value }))}
                data-testid="input-location-postal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-contact">Contact Name</Label>
              <Input
                id="location-contact"
                value={newLocationForm.contactName}
                onChange={(e) => setNewLocationForm((prev) => ({ ...prev, contactName: e.target.value }))}
                data-testid="input-location-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location-phone">Phone</Label>
                <Input
                  id="location-phone"
                  value={newLocationForm.phone}
                  onChange={(e) => setNewLocationForm((prev) => ({ ...prev, phone: e.target.value }))}
                  data-testid="input-location-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-email">Email</Label>
                <Input
                  id="location-email"
                  type="email"
                  value={newLocationForm.email}
                  onChange={(e) => setNewLocationForm((prev) => ({ ...prev, email: e.target.value }))}
                  data-testid="input-location-email"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddLocationDialogOpen(false)}
              data-testid="button-cancel-location"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createLocationMutation.mutate(newLocationForm)}
              disabled={createLocationMutation.isPending}
              data-testid="button-save-location"
            >
              {createLocationMutation.isPending ? "Saving..." : "Save Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Unified Add/Edit Contact Dialog */}
      <Dialog open={contactModalOpen} onOpenChange={(open) => {
        if (!open) { setContactModalOpen(false); setEditingContactId(null); setContactForm(emptyContactForm); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{contactModalMode === "add" ? "Add Contact" : "Edit Contact"}</DialogTitle>
            <DialogDescription>
              {contactModalMode === "add" ? `Add a contact for ${companyName}` : "Update contact information"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>First Name</Label>
                <Input
                  placeholder="First"
                  value={contactForm.firstName}
                  onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Last Name</Label>
                <Input
                  placeholder="Last"
                  value={contactForm.lastName}
                  onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                placeholder="Phone number"
                value={contactForm.phone}
                onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="Email address"
                value={contactForm.email}
                onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            {/* Phase 5: Association selector with per-association role toggles */}
            <div className="space-y-2 border-t pt-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Applies to</Label>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="association"
                    checked={contactForm.association.type === "company"}
                    onChange={() => setContactForm((p) => ({
                      ...p,
                      association: { type: "company", companyRoles: { billing: false, scheduling: false } },
                    }))}
                    className="accent-primary"
                  />
                  Company (all locations)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="association"
                    checked={contactForm.association.type === "locations"}
                    onChange={() => setContactForm((p) => ({
                      ...p,
                      association: { type: "locations", locationRolesById: {} },
                    }))}
                    className="accent-primary"
                  />
                  Specific location(s)
                </label>
              </div>

              {/* Company-wide roles */}
              {contactForm.association.type === "company" && (
                <div className="ml-5 flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={contactForm.association.companyRoles.billing}
                      onChange={(e) => setContactForm((p) => {
                        if (p.association.type !== "company") return p;
                        return { ...p, association: { ...p.association, companyRoles: { ...p.association.companyRoles, billing: e.target.checked } } };
                      })}
                      className="rounded border-input"
                    />
                    Billing
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={contactForm.association.companyRoles.scheduling}
                      onChange={(e) => setContactForm((p) => {
                        if (p.association.type !== "company") return p;
                        return { ...p, association: { ...p.association, companyRoles: { ...p.association.companyRoles, scheduling: e.target.checked } } };
                      })}
                      className="rounded border-input"
                    />
                    Scheduling
                  </label>
                </div>
              )}

              {/* Per-location roles */}
              {contactForm.association.type === "locations" && locations.length > 0 && (
                <div className="ml-5 space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                  {locations.map((loc) => {
                    const locId = loc.id;
                    const isChecked = contactForm.association.type === "locations" && locId in contactForm.association.locationRolesById;
                    const locRoles = contactForm.association.type === "locations" ? contactForm.association.locationRolesById[locId] : undefined;
                    return (
                      <div key={locId}>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              setContactForm((p) => {
                                if (p.association.type !== "locations") return p;
                                const next = { ...p.association.locationRolesById };
                                if (e.target.checked) {
                                  next[locId] = { billing: false, scheduling: false };
                                } else {
                                  delete next[locId];
                                }
                                return { ...p, association: { ...p.association, locationRolesById: next } };
                              });
                            }}
                            className="rounded border-input"
                          />
                          {loc.location || loc.companyName || "Unnamed"}
                          {loc.isPrimary && <Badge variant="secondary" className="text-[9px] px-1 py-0">Primary</Badge>}
                        </label>
                        {isChecked && locRoles && (
                          <div className="ml-6 flex gap-3 mt-1 mb-1">
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={locRoles.billing}
                                onChange={(e) => setContactForm((p) => {
                                  if (p.association.type !== "locations") return p;
                                  const cur = p.association.locationRolesById[locId] ?? { billing: false, scheduling: false };
                                  return { ...p, association: { ...p.association, locationRolesById: { ...p.association.locationRolesById, [locId]: { ...cur, billing: e.target.checked } } } };
                                })}
                                className="rounded border-input"
                              />
                              Billing
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={locRoles.scheduling}
                                onChange={(e) => setContactForm((p) => {
                                  if (p.association.type !== "locations") return p;
                                  const cur = p.association.locationRolesById[locId] ?? { billing: false, scheduling: false };
                                  return { ...p, association: { ...p.association, locationRolesById: { ...p.association.locationRolesById, [locId]: { ...cur, scheduling: e.target.checked } } } };
                                })}
                                className="rounded border-input"
                              />
                              Scheduling
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {contactForm.association.type === "locations" && locations.length === 0 && (
                <p className="ml-5 text-xs text-muted-foreground">No locations available.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (contactModalMode === "add") {
                  createContactMutation.mutate(contactForm);
                } else if (editingContactId) {
                  updateContactMutation.mutate({
                    form: contactForm,
                    primaryContactId: editingContactId,
                    personAssociations: editingPersonGroup?.associations ?? [],
                  });
                }
              }}
              disabled={!isContactFormValid || createContactMutation.isPending || updateContactMutation.isPending}
            >
              {(createContactMutation.isPending || updateContactMutation.isPending) ? "Saving..." : "Save Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Contact Confirmation */}
      <AlertDialog open={!!deleteContactId} onOpenChange={(open) => { if (!open) setDeleteContactId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteContactId && deleteContactMutation.mutate(deleteContactId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}