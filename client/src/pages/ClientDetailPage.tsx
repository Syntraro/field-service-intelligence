/**
 * ClientDetailPage — Card-based client workspace.
 *
 * Layout (2026-05-02 refactor):
 *   [Header Card — full width: name + subtitle + scope-aware tag row +
 *                  KPIs + create actions + overflow]
 *   [Scope Bar — full width: "Viewing: All Locations (N) ▾" popover selector]
 *   [Body row: Workspace card (left) | Client Information rail (right)]
 *
 * The persistent left "Locations" rail was removed; switching scope
 * now flows entirely through the scope-bar popover. The right-side
 * "Client Information" panel exposes Contacts / Notes / Billing
 * (the Reference-Fields "Fields" tab was removed in the 2026-05-02
 * simplification — data + APIs are unchanged, just no longer surfaced
 * in this rail).
 *
 * Scope model:
 *   scopeType = "company" | "location"
 *   When "company" → workspace shows company-scoped data, rail title
 *                    reads "Client Information (All Locations)"
 *   When "location" → workspace filters to that location, rail title
 *                     reads "Client Information ([Location Name])"
 *
 * Route: /clients/:clientId
 * URL params: ?scope=company|location&location=<id>&tab=<workspaceTab>
 */
import { useState, useMemo, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Plus, Briefcase, FileText, MapPin, MoreHorizontal, Search,
  Receipt, Star, Trash2, Pencil,
  Clock, Package, Tag, Building2, AlertTriangle, Archive, Loader2,
  ChevronLeft, ChevronDown, Check,
  StickyNote, LayoutDashboard, X, Users,
} from "lucide-react";
import { ActionMenu, type ActionMenuItemDescriptor } from "@/components/ui/action-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Chip, FilterChip } from "@/components/ui/chip";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
// 2026-05-07: canonical right-rail primitive. Owns the icon strip +
// expandable panel chrome shared with JobDetailPage / future Invoice
// + Quote detail surfaces. Per-tab body content + the page-level
// width/resize/localStorage state stay here in the page; the primitive
// is purely presentational.
import {
  DetailRightRail,
  DetailRightRailEmpty,
  RAIL_HEADER_ACTION_CLASS,
  RAIL_WIDTH_TRANSITION,
  type DetailRailTab,
} from "@/components/detail-rail/DetailRightRail";
// 2026-05-07 RALPH — canonical rail card primitive (shared chrome:
// border / radius / padding / hover) + the rail Activity formatter
// that maps event_type + meta to user-facing copy. Replaces the ad
// hoc card chrome each rail panel had been duplicating, and stops
// the Activity panel from rendering raw UUIDs / "Note.Created".
// 2026-05-07/08 Phases 1–6 of the data-driven right-rail re-recovery
// completed the migration: every Client Detail rail panel — Parts
// (Phase 1), Maintenance (Phase 2), Activity (Phase 3), Equipment
// (Phase 4), Billing (Phase 5), Contacts (Phase 6) — now mounts
// `<RailPanelRenderer>` driven by a typed descriptor. The page no
// longer composes any rail-card slot primitive directly; the
// `RailContentCard` import is intentionally absent.
import { RailPanelRenderer } from "@/components/detail-rail/RailPanelRenderer";
import { RailContentCardMeta } from "@/components/detail-rail/RailContentCard";
import { CreateJobModal } from "@/components/CreateJobModal";
import LocationFormModal from "@/components/LocationFormModal";
import { EntityNotesPanel } from "@/components/notes/EntityNotesPanel";
import PMScheduleCard from "@/components/PMScheduleCard";
import { PartsSelectorModal } from "@/components/PartsSelectorModal";
import EditTagsModal from "@/components/EditTagsModal";
// 2026-05-02 contact unification: ContactFormDialog is now the SOLE
// add/edit/assign/role-edit modal. AssignContactDialog and
// EditAssignmentRolesDialog are no longer mounted from this page; the
// .tsx files remain on disk for now (no callers anywhere else) and
// will be deleted in a follow-up cleanup.
import {
  ContactFormDialog,
  type ContactModalLocation,
  type ContactModalAssignment,
} from "@/components/ContactFormDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
import { EquipmentDetailModal } from "@/components/EquipmentDetailModal";
import LocPricingTab from "@/components/LocPricingTab";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { quoteKeys } from "@/lib/queryKeys/quotes";
import type {
  Client, CustomerCompany, Job, Invoice, ClientContact, ClientTag, Quote,
  LocationEquipment,
} from "@shared/schema";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { getClientDisplayName } from "@shared/clientDisplayName";
import { SectionLabel } from "@/components/ui/typography";
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";
import { ClientOverviewTab } from "@/pages/ClientOverviewTab";
import { ClientKpiStrip } from "@/components/clients/ClientKpiStrip";
import { ClientJobsTab } from "./clients/ClientJobsTab";
import { ClientInvoicesTab } from "./clients/ClientInvoicesTab";
import { ClientQuotesTab } from "./clients/ClientQuotesTab";
import { ClientPaymentsTab } from "./clients/ClientPaymentsTab";
import { ClientEquipmentTab } from "./clients/ClientEquipmentTab";
import { ClientPartsTab } from "./clients/ClientPartsTab";
import { locationDisplayName, locationAddress, locationAddressLines } from "@/lib/clientHelpers";
import type { EnrichedQuote, PMPartWithItem, ClientPaymentRow } from "./clients/tabShared";
import {
  RailBillingShape,
  ClientBillingPanelBody,
  MaintenanceTemplateRow,
  buildClientMaintenancePanelDescriptor,
  ClientActivityFeedItem,
  buildClientActivityPanelDescriptor,
  ContactCard,
} from "./clients/railDescriptors";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Scope model: company overview or a specific location */
type ScopeType = "company" | "location";

/** Workspace tabs — operational only. Contacts / Notes / Billing /
 *  Equipment / Parts / Maintenance / Activity live in the right
 *  utility rail, not here. 2026-05-07 v3: dropped `equipment`, `pm`,
 *  `parts` from this union — the rail is now the canonical access
 *  point for those surfaces, and keeping center tabs for them was
 *  pure duplication. 2026-05-12: `pricing` removed — Historical
 *  Pricing is now rendered inside the Overview tab via
 *  `ClientOverviewTab` (no separate Pricing tab). */
type WorkspaceTab =
  | "overview"
  | "jobs"
  | "invoices"
  | "quotes"
  | "payments"
  | "equipment"
  | "parts";

/** Utility-rail panels in the right sidebar.
 *  2026-05-02: dropped the "fields" tab (Reference-Fields). Data + APIs
 *  unchanged — the section is just no longer surfaced here.
 *  2026-05-07: layout switched from a horizontal `<Tabs>` row to a
 *  vertical icon rail + expandable panel.
 *  2026-05-12 RALPH: consolidated from 7 tabs to 3. Summary stacks
 *  Billing + Maintenance + Activity. Equip & Parts stacks Equipment +
 *  Parts. Contacts removed from the rail (data + queries unchanged).
 *  `null` → no panel open (rail-only display). */
type UtilityTab =
  | "summary"
  | "notes"
  | "contacts";

type UtilityPanel = UtilityTab | null;

type CompanyOverview = {
  company: CustomerCompany;
  locations: Client[];
  jobs: Job[];
  invoices: Invoice[];
  stats?: { totalLocations: number; openJobs: number; openInvoices: number };
  // 2026-04-19 Fix B: server-computed aggregates over the FULL
  // invoice set. UI must prefer these over deriving totals from the
  // truncated `invoices` list (which is capped at ~100 rows).
  billingAggregates?: {
    lifetimeRevenue: string;
    paidYtd: string;
    outstanding: { count: number; total: string; overdueTotal: string };
    agingBuckets: { current: string; d30: string; d60: string; d90: string };
  } | null;
};

/** 2026-05-02 layout refactor: a single uniform tab list across both
 *  scopes. Equipment / Parts are inherently location-scoped data, so
 *  in company ("All Locations") scope they render an empty-state row
 *  nudging the user to pick a location from the scope selector — but
 *  the tab itself is always present so the bar shape doesn't change
 *  when the user toggles scope. PM is location-only and only listed
 *  in `LOCATION_TABS`. */
const COMPANY_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "payments", label: "Payments" },
];

const LOCATION_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "payments", label: "Payments" },
  { key: "equipment", label: "Equipment" },
  { key: "parts", label: "Parts" },
];

const WORKSPACE_TAB_KEYS = new Set(LOCATION_TABS.map(t => t.key));

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // ── Scope state ──
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("jobs");
  // 2026-05-07: `utilityTab` now models the active SIDE PANEL — null
  // means rail-only (no panel open). Defaults to "contacts" so the
  // page reads with a meaningful initial panel rather than empty space.
  const [utilityTab, setUtilityTab] = useState<UtilityPanel>("summary");
  const [locationSearch, setLocationSearch] = useState("");

  // 2026-05-02 layout refactor: the persistent left "Locations" rail
  // was replaced with a compact scope selector in the bar above the
  // workspace card. Open-state for that selector lives below; no more
  // collapsed/hydrated/persisted state for a permanent third column.
  const [scopePopoverOpen, setScopePopoverOpen] = useState(false);

  // 2026-05-03: scope-bar shortcut pills cap by viewport. Tailwind
  // breakpoints — `md` = 768 px, `lg` = 1024 px. Caps were tuned so a
  // typical 8-location client shows ALL pills inline at desktop width
  // without overflow. Initial value reads `window.innerWidth`
  // synchronously to avoid a first-render flash on devices narrower
  // than the desktop default.
  const [scopeBp, setScopeBp] = useState<"mobile" | "tablet" | "desktop">(() => {
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    if (w < 768) return "mobile";
    if (w < 1024) return "tablet";
    return "desktop";
  });
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      if (w < 768) setScopeBp("mobile");
      else if (w < 1024) setScopeBp("tablet");
      else setScopeBp("desktop");
    };
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  const scopePillCap = scopeBp === "desktop" ? 10 : scopeBp === "tablet" ? 6 : 3;

  // ── Right rail (utility rail) collapse + resize state ──
  const RAIL_DEFAULT_WIDTH = 400;
  const RAIL_MIN_WIDTH = 300;
  const RAIL_MAX_WIDTH_PX = 520;
  const RAIL_MAX_WIDTH_RATIO = 0.45;
  // Width of the rail when no panel is open (collapsed strip).
  const RAIL_COLLAPSED_WIDTH = 48;
  const LS_RAIL_WIDTH_KEY = "syntraro.detail.rail.width";

  // 2026-05-07 v3: rail-collapsed boolean state retired alongside the
  // "DETAILS" expand strip. The rail is always visible; "collapsed"
  // now means panel-closed, expressed via `utilityTab === null`.
  const [rightRailWidth, setRightRailWidth] = useState<number>(RAIL_DEFAULT_WIDTH);
  const [rightRailHydrated, setRightRailHydrated] = useState(false);
  useEffect(() => {
    try {
      const rawWidth = localStorage.getItem(LS_RAIL_WIDTH_KEY);
      if (rawWidth !== null) {
        const parsed = parseInt(rawWidth, 10);
        if (Number.isFinite(parsed) && parsed >= RAIL_MIN_WIDTH && parsed <= RAIL_MAX_WIDTH_PX) {
          setRightRailWidth(parsed);
        }
      }
    } catch { /* noop */ }
    setRightRailHydrated(true);
  }, []);
  useEffect(() => {
    if (!rightRailHydrated) return;
    try { localStorage.setItem(LS_RAIL_WIDTH_KEY, String(rightRailWidth)); } catch { /* noop */ }
  }, [rightRailWidth, rightRailHydrated]);

  const handleRailPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightRailWidth;
    const maxByRatio = Math.floor(window.innerWidth * RAIL_MAX_WIDTH_RATIO);
    const maxW = Math.min(RAIL_MAX_WIDTH_PX, maxByRatio);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      // Rail is on the right — cursor moving right shrinks the rail.
      const delta = ev.clientX - startX;
      const next = startWidth - delta;
      const clamped = Math.max(RAIL_MIN_WIDTH, Math.min(maxW, next));
      setRightRailWidth(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [rightRailWidth]);

  const handleRailKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setRightRailWidth(w => {
        const maxByRatio = Math.floor(window.innerWidth * RAIL_MAX_WIDTH_RATIO);
        return Math.min(Math.min(RAIL_MAX_WIDTH_PX, maxByRatio), w + step);
      });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setRightRailWidth(w => Math.max(RAIL_MIN_WIDTH, w - step));
    }
  }, []);

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

  // Push URL state when scope/tab changes. "jobs" is the default tab.
  const updateUrlParams = useCallback((scope: ScopeType, locId: string | null, tab: WorkspaceTab) => {
    const params = new URLSearchParams();
    if (scope === "location" && locId) params.set("location", locId);
    if (tab !== "jobs") params.set("tab", tab);
    const qs = params.toString();
    const newUrl = `/clients/${clientId}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [clientId]);

  const handleSelectCompany = useCallback(() => {
    setScopeType("company");
    setSelectedLocationId(null);
    // Equipment / Parts are location-only — fall back to jobs when switching to company scope.
    const nextTab: WorkspaceTab = (workspaceTab === "equipment" || workspaceTab === "parts") ? "jobs" : workspaceTab;
    setWorkspaceTab(nextTab);
    updateUrlParams("company", null, nextTab);
  }, [updateUrlParams, workspaceTab]);

  const handleSelectLocation = useCallback((locId: string) => {
    setScopeType("location");
    setSelectedLocationId(locId);
    updateUrlParams("location", locId, workspaceTab);
  }, [updateUrlParams, workspaceTab]);

  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    updateUrlParams(scopeType, selectedLocationId, tab);
  }, [scopeType, selectedLocationId, updateUrlParams]);

  // ── Dialogs ──
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  // 2026-05-06: quote creation now navigates to /quotes/new instead of
  // opening a modal. The state slot is retired; the button below
  // routes via setLocation.
  const [addLocationDialogOpen, setAddLocationDialogOpen] = useState(false);
  const [editClientDialogOpen, setEditClientDialogOpen] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({
    location: "", address: "", address2: "", city: "", province: "", postalCode: "",
    contactName: "", phone: "", email: "",
  });

  // Location edit/tags modals (lifted from LocationDetailPane)
  const [editLocationModalOpen, setEditLocationModalOpen] = useState(false);
  const [editLocationTagsOpen, setEditLocationTagsOpen] = useState(false);
  // 2026-05-02 layout refinement: companion modal for company-scope
  // tag edits. Reuses the canonical EditTagsModal — no new component
  // or API; the modal already supports `entityType="customerCompany"`
  // and was just missing a UI caller from this page.
  const [editClientTagsOpen, setEditClientTagsOpen] = useState(false);
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  // 2026-05-07: page-level mount of the canonical EquipmentDetailModal
  // so the right-rail Equipment panel can open it on card click.
  // Previously this state lived inside `LocEquipmentTab` (now dead
  // code after the v3 workspace-tab refactor); lifting it here keeps
  // the modal reachable from the rail without duplicating the
  // editor.
  const [detailEquipment, setDetailEquipment] = useState<LocationEquipment | null>(null);

  // 2026-05-07 canonical rail extraction: imperative refs for rail
  // panel header `+ Add` buttons. Body components own the dialogs;
  // the panel header dispatches via these refs so there's a single
  // canonical add affordance per panel. Lifted from the prior local
  // `UtilityRail` body so the canonical `<DetailRightRail>` primitive
  // stays presentation-only.
  const companyContactsRef = useRef<ContactsCompactRef | null>(null);
  const locContactsRef = useRef<ContactsCompactRef | null>(null);
  // 2026-05-08 Tier 4 Notes canonicalization: NotesPanel's imperative
  // `notesRef.startAdding()` handle is replaced by the declarative
  // `openAddNoteSignal` contract shared with every other notes
  // consumer. The rail tab's +Add button bumps the signal counter;
  // EntityNotesPanel reacts via a useEffect.
  const [notesAddSignal, setNotesAddSignal] = useState(0);

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<"company" | "location">("company");

  // Permanent delete dialog state
  const [permDeleteDialogOpen, setPermDeleteDialogOpen] = useState(false);
  const [permDeleteTarget, setPermDeleteTarget] = useState<"company" | "location">("company");
  const [permDeleteConfirmText, setPermDeleteConfirmText] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<{
    locationCount?: number; jobs: number; visits: number; invoices: number; quotes: number;
    leads: number; servicePlans: number; recurringJobs: number; notes: number; files: number;
    maintenanceRecords: number;
  } | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleteImpactError, setDeleteImpactError] = useState<string | null>(null);

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

  // ── Single-location auto-select ──
  // When a client has exactly one location and there is no explicit
  // `?location=` URL override, auto-scope to that sole location so the
  // user gets the full LOCATION_TABS (Jobs / Invoices / Quotes /
  // Equipment / PM / Parts) instead of the reduced COMPANY_TABS set.
  // Runs only once per load (no selectedLocationId yet) — does not
  // fight manual scope changes afterward.
  useEffect(() => {
    if (locations.length !== 1) return;
    if (selectedLocationId) return;
    const params = new URLSearchParams(routerSearch);
    if (params.get("location")) return;
    if (params.get("scope") === "company") return;
    const sole = locations[0];
    setSelectedLocationId(sole.id);
    setScopeType("location");
  }, [locations, selectedLocationId, routerSearch]);

  const allJobs: Job[] = overview?.jobs ?? [];
  const allInvoices: Invoice[] = overview?.invoices ?? [];

  // Company-scoped quotes
  const { data: clientQuotes = [] } = useQuery<EnrichedQuote[]>({
    queryKey: quoteKeys.list({ customerCompanyId: companyId }),
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
  const onHoldJobsCount = companyJobs.filter(j => j.status === "open" && (j as any).openSubStatus === "on_hold").length;
  const overdueInvoicesCount = allInvoices.filter(i =>
    i.status !== "paid" && i.status !== "voided" && i.dueDate && new Date(i.dueDate) < new Date()
  ).length;
  const pendingQuotesCount = clientQuotes.filter(q =>
    q.status === "draft" || q.status === "sent"
  ).length;

  const lastServiceDate = useMemo<Date | null>(() => {
    const completed = companyJobs
      .filter(j => j.status === "completed" || j.status === "invoiced")
      .map(j => new Date(j.updatedAt ?? j.createdAt))
      .filter(d => !isNaN(d.getTime()));
    if (completed.length === 0) return null;
    return completed.reduce((max, d) => d > max ? d : max);
  }, [companyJobs]);

  // Active maintenance count — shares the canonical ["/api/recurring-templates"] cache key
  // used by ServicePlansWorkspaceTab and ServicePlanKpiStrip; React Query deduplicates.
  const { data: allTemplates = [] } = useQuery<{ clientId?: string | null; locationId?: string | null }[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: () => apiRequest("/api/recurring-templates"),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
  const activeMaintenanceCount = useMemo(
    () => allTemplates.filter(t => t.clientId === companyId).length,
    [allTemplates, companyId],
  );

  // Company payments — fetched for the Payments center tab.
  const { data: companyPayments = [] } = useQuery<ClientPaymentRow[]>({
    queryKey: ["/api/customer-companies", companyId, "payments"],
    queryFn: () => apiRequest(`/api/customer-companies/${companyId}/payments`),
    enabled: Boolean(companyId),
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  // ── Mutations ──
  const createLocationMutation = useMutation({
    mutationFn: async (locationData: typeof newLocationForm) => {
      if (!companyId) throw new Error("Company not loaded yet.");
      return await apiRequest<{ id: string }>(`/api/customer-companies/${companyId}/locations`, {
        method: "POST", body: JSON.stringify(locationData),
      });
    },
    onSuccess: (newLocation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
      if (companyId) {
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "locations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
        // 2026-05-02 contact-creation visibility fix: when the inline
        // contactName/email/phone fields are present, the canonical
        // POST /api/customer-companies/:id/locations endpoint creates
        // a `contact_persons` row in the same DB transaction (see
        // `server/routes/customer-companies.ts:115-175`,
        // `clientContactRepository.createOrGetPersonTx`). The bug
        // was purely client-side: this onSuccess invalidated only the
        // location-related queries, so the right-rail Contacts tab
        // (driven by `["/api/customer-companies", companyId, "contacts"]`,
        // see line 605 above) kept its stale "No contacts assigned"
        // payload until a hard refresh. Adding the contacts
        // invalidation here causes TanStack Query to refetch and the
        // newly created contact to appear immediately. No backend
        // change required — server-side contact creation + dedupe was
        // already correct.
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "contacts"] });
      }
      // The new location's per-location contacts query also needs to
      // refresh in case the user immediately switches scope to it.
      // Predicate-style invalidate handles unknown selectedLocationId
      // and any future-mounted location pane.
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey)
          && q.queryKey[0] === "/api/clients"
          && q.queryKey[2] === "contacts",
      });
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

  // ── Archive / Delete handlers ──
  const openArchiveDialog = useCallback((target: "company" | "location") => {
    setArchiveTarget(target);
    setArchiveDialogOpen(true);
  }, []);

  const openPermDeleteDialog = useCallback(async (target: "company" | "location") => {
    setPermDeleteTarget(target);
    setPermDeleteConfirmText("");
    setDeleteImpact(null);
    setDeleteImpactError(null);
    setDeleteImpactLoading(true);
    setPermDeleteDialogOpen(true);

    try {
      const targetId = target === "company" ? companyId : selectedLocationId;
      if (!targetId) throw new Error("No entity selected");
      const url = target === "company"
        ? `/api/customer-companies/${targetId}/delete-impact`
        : `/api/clients/${targetId}/delete-impact`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || `Server returned ${res.status}`);
      }
      setDeleteImpact(await res.json());
    } catch (err: any) {
      setDeleteImpactError(err?.message || "Failed to load affected records");
    } finally {
      setDeleteImpactLoading(false);
    }
  }, [companyId, selectedLocationId]);

  const executeArchive = useMutation({
    mutationFn: async () => {
      if (archiveTarget === "company") {
        await apiRequest(`/api/customer-companies/${companyId}/archive`, { method: "POST" });
      } else {
        await apiRequest(`/api/clients/${selectedLocationId}`, { method: "DELETE" });
      }
    },
    onSuccess: () => {
      setArchiveDialogOpen(false);
      if (archiveTarget === "company") {
        toast({ title: "Client archived" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setLocation("/clients");
      } else {
        toast({ title: "Location archived" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
        setScopeType("company");
        setSelectedLocationId(null);
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Archive failed", variant: "destructive" });
    },
  });

  const executePermanentDelete = useMutation({
    mutationFn: async () => {
      if (permDeleteTarget === "company") {
        await apiRequest(`/api/customer-companies/${companyId}`, {
          method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }),
        });
      } else {
        await apiRequest(`/api/clients/${selectedLocationId}`, {
          method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }),
        });
      }
    },
    onSuccess: () => {
      setPermDeleteDialogOpen(false);
      if (permDeleteTarget === "company") {
        toast({ title: "Client permanently deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        setLocation("/clients");
      } else {
        toast({ title: "Location permanently deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "overview"] });
        queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "overview"] });
        setScopeType("company");
        setSelectedLocationId(null);
      }
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message || "Permanent delete failed", variant: "destructive" });
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

  // ── KPI metrics derived from already-loaded data ──
  // These useMemo hooks MUST be above the early returns to preserve hook order.
  // 2026-04-19 Fix B: prefer server-computed aggregates (full invoice
  // set); fall back to client-side derivation only if the server
  // payload omitted them (e.g. legacy cached response during rollout).
  const serverAggregates = overview?.billingAggregates ?? null;

  const lifetimeRevenue = useMemo(() => {
    if (serverAggregates) return Number(serverAggregates.lifetimeRevenue);
    return allInvoices
      .filter(i => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
  }, [serverAggregates, allInvoices]);

  // Outstanding: excludes drafts and voided — matches canonical UNPAID_INVOICE_STATUSES
  const outstandingInvoices = useMemo(() => {
    if (serverAggregates) {
      return {
        count: serverAggregates.outstanding.count,
        total: Number(serverAggregates.outstanding.total),
        overdueTotal: Number(serverAggregates.outstanding.overdueTotal),
      };
    }
    const outstanding = allInvoices.filter(i => UNPAID_INVOICE_STATUSES.includes(i.status));
    const overdueTotal = outstanding
      .filter(i => i.dueDate && new Date(i.dueDate) < new Date())
      .reduce((sum, i) => sum + Number(i.balance ? Number(i.balance) : Number(i.total || 0)), 0);
    return { count: outstanding.length, total: outstanding.reduce((s, i) => s + Number(i.balance ? Number(i.balance) : Number(i.total || 0)), 0), overdueTotal };
  }, [serverAggregates, allInvoices]);

  // Active jobs per location for location list badges
  const activeJobCountByLocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of companyJobs) {
      if (j.status === "open") m.set(j.locationId, (m.get(j.locationId) ?? 0) + 1);
    }
    return m;
  }, [companyJobs]);

  // ── Layout flags (2026-04-18 redesign) ──
  // A client with exactly one location hides the left rail entirely; the
  // single location's full address becomes the header subtitle.
  const isSingleLocation = locations.length === 1;
  const soleLocation = isSingleLocation ? locations[0] : null;

  // Compare the sole location's service address to the parent company's
  // billing address. Used only in single-location view to decide whether
  // to surface both addresses explicitly (when they differ) or suppress
  // the duplicated address block entirely (when they match, or when the
  // parent company has no billing address set, which is the common case
  // where billing = service).
  const hasDistinctBillingAddress = useMemo(() => {
    if (!isSingleLocation || !soleLocation || !parentCompany) return false;
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    const service = [
      norm(soleLocation.address),
      norm(soleLocation.address2),
      norm(soleLocation.city),
      norm(soleLocation.province),
      norm(soleLocation.postalCode),
    ].join("|");
    const billing = [
      norm(parentCompany.billingStreet),
      norm(parentCompany.billingStreet2),
      norm(parentCompany.billingCity),
      norm(parentCompany.billingProvince),
      norm(parentCompany.billingPostalCode),
    ].join("|");
    // Empty billing block → treat as "bills to service address".
    if (billing.replace(/\|/g, "") === "") return false;
    return service !== billing;
  }, [isSingleLocation, soleLocation, parentCompany]);

  // Render helper for the compact dual-address block (single-loc only).
  const billingAddressLines = useMemo(() => {
    if (!parentCompany) return [] as string[];
    return [
      parentCompany.billingStreet,
      parentCompany.billingStreet2,
      [parentCompany.billingCity, parentCompany.billingProvince, parentCompany.billingPostalCode]
        .filter(Boolean)
        .join(", "),
    ].filter(Boolean) as string[];
  }, [parentCompany]);

  // ── Billing tab aggregates ──
  // 2026-04-19 Fix B: prefer server aggregate (full invoice set);
  // fall back to the truncated client derivation during rollout.
  const paidYtd = useMemo(() => {
    if (serverAggregates) return Number(serverAggregates.paidYtd);
    const year = new Date().getFullYear();
    return allInvoices
      .filter(i => i.status === "paid")
      .filter(i => {
        const d = i.issueDate ? new Date(i.issueDate) : null;
        return d && d.getFullYear() === year;
      })
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
  }, [serverAggregates, allInvoices]);

  const agingBuckets = useMemo(() => {
    // 2026-04-19 Fix B: prefer server aggregate (full invoice set).
    if (serverAggregates) {
      return {
        current: Number(serverAggregates.agingBuckets.current),
        d30: Number(serverAggregates.agingBuckets.d30),
        d60: Number(serverAggregates.agingBuckets.d60),
        d90: Number(serverAggregates.agingBuckets.d90),
      };
    }
    const UNPAID = new Set(UNPAID_INVOICE_STATUSES);
    const now = Date.now();
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const i of allInvoices) {
      if (!UNPAID.has(i.status)) continue;
      const amt = Number(i.balance ? i.balance : i.total || 0);
      if (!i.dueDate) { buckets.current += amt; continue; }
      const daysPast = Math.floor((now - new Date(i.dueDate).getTime()) / 86_400_000);
      if (daysPast <= 0) buckets.current += amt;
      else if (daysPast <= 30) buckets.d30 += amt;
      else if (daysPast <= 60) buckets.d60 += amt;
      else buckets.d90 += amt;
    }
    return buckets;
  }, [serverAggregates, allInvoices]);

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
        <h2 className="text-modal-title text-destructive">Client not found</h2>
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

  // 2026-05-07 canonical rail extraction: per-tab `+ Add` buttons share
  // a single hover/focus class so the canonical primitive's panel
  // header carries one consistent affordance. Pulled inline here (was
  // a private const inside the legacy `RailHeaderAction` component)
  // so the action JSX in `clientRailTabs` below can reuse it without
  // re-introducing a parallel component.
  // 2026-05-07: defers structural classes to the canonical
  // RAIL_HEADER_ACTION_CLASS exported from DetailRightRail. Appends the
  // canonical `text-helper` (13px regular weight — matches the corrected
  // rail-tab scale) and the muted slate-700 color this page uses for
  // neutral edit / add affordances. Replaces the prior
  // `text-row font-medium` (heavier weight + larger 14px size).
  const RAIL_ACTION_BTN_CLASS = `${RAIL_HEADER_ACTION_CLASS} text-helper text-slate-700`;

  // 2026-05-12 RALPH: rail restructured from 7 separate tabs to 3
  // consolidated tabs (Summary / Notes / Equip & Parts). Billing,
  // Maintenance, and Activity are now stacked vertically inside the
  // Summary tab. Equipment and Parts are stacked inside the Equip &
  // Parts tab. Contacts is removed from the rail (data and queries
  // are preserved unchanged).
  const ownerCompanyId = client.companyId || "";
  const billingPanelData = {
    lifetimeRevenue,
    paidYtd,
    outstanding: outstandingInvoices,
    aging: agingBuckets,
  };
  const billingFields = {
    paymentTermsDays: (parentCompany as any)?.paymentTermsDays ?? null,
    billingStreet: parentCompany?.billingStreet ?? null,
    billingCity: parentCompany?.billingCity ?? null,
    billingProvince: parentCompany?.billingProvince ?? null,
    billingPostalCode: parentCompany?.billingPostalCode ?? null,
  };
  const clientRailTabs: DetailRailTab[] = [
    {
      id: "summary",
      label: "Summary",
      icon: LayoutDashboard,
      testId: "rail-item-summary",
      content: (
        <ClientSummaryTabContent
          billing={billingPanelData}
          paymentTermsDays={billingFields.paymentTermsDays}
          billingStreet={billingFields.billingStreet}
          billingCity={billingFields.billingCity}
          billingProvince={billingFields.billingProvince}
          billingPostalCode={billingFields.billingPostalCode}
          companyId={companyId ?? null}
          locationId={selectedLocationId}
          scopeType={scopeType}
          customerCompanyId={companyId ?? null}
        />
      ),
    },
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      testId: "rail-item-notes",
      action: (
        <button
          type="button"
          onClick={() => setNotesAddSignal((n) => n + 1)}
          className={RAIL_ACTION_BTN_CLASS}
          data-testid="client-side-panel-action-add-note"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Note
        </button>
      ),
      // 2026-05-08 Tier 4 Notes canonicalization — the legacy
      // NotesPanel component was retired. Both company + location
      // scopes now flow through the canonical EntityNotesPanel
      // (entityType="company" | "location"). The rail tab header owns
      // the +Add affordance via the `action` slot above; the panel
      // reacts to the bump via `openAddNoteSignal`.
      content: scopeType === "company" && companyId ? (
        <EntityNotesPanel
          entityType="company"
          entityId={companyId}
          openAddNoteSignal={notesAddSignal}
        />
      ) : scopeType === "location" && selectedLocationId ? (
        <EntityNotesPanel
          entityType="location"
          entityId={selectedLocationId}
          companyId={ownerCompanyId}
          openAddNoteSignal={notesAddSignal}
        />
      ) : (
        <DetailRightRailEmpty
          message="No notes yet."
          hint="Add one to keep your team aligned."
          testIdPrefix="client-side"
        />
      ),
    },
    {
      id: "contacts",
      label: "Contacts",
      icon: Users,
      testId: "rail-item-contacts",
      action: (
        <button
          type="button"
          onClick={() => {
            if (scopeType === "company") companyContactsRef.current?.startAdding();
            else locContactsRef.current?.startAdding();
          }}
          className={RAIL_ACTION_BTN_CLASS}
          data-testid="client-side-panel-action-add-contact"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Contact
        </button>
      ),
      content: scopeType === "company" && companyId ? (
        <CompanyContactsCompact
          ref={companyContactsRef}
          companyContacts={clientLevelContacts}
          locationContacts={allLocationContacts}
          locations={locations}
          companyId={companyId}
          hideHeader
        />
      ) : scopeType === "location" && selectedLocationId ? (
        <LocContactsCompact
          ref={locContactsRef}
          locationContacts={locContacts}
          companyContacts={locCompanyContacts}
          locationId={selectedLocationId}
          parentCompanyId={companyId}
          locations={locations}
          allLocationContacts={allLocationContacts}
          hideHeader
        />
      ) : (
        <DetailRightRailEmpty
          message="No contacts."
          testIdPrefix="client-side"
        />
      ),
    },
  ];

  return (
    // 2026-05-07: page-level layout switches from a single vertical
    // column to an outer horizontal row so the right utility region
    // can span the full content height (top of the client header
    // card → bottom of the workspace card). Below `lg` the row
    // wraps to a column and the rail stacks under the workspace,
    // matching the prior mobile behaviour. The existing
    // collapse/expand chrome on the rail itself is preserved
    // unchanged.
    <div
      className="flex h-full flex-col lg:flex-row bg-app-bg"
      data-testid="client-detail-root"
    >
      {/* ── LEFT COLUMN: page header + scope bar + workspace body ── */}
      <div className="flex-1 min-w-0 flex flex-col lg:min-h-0 overflow-hidden">

      {/* ═══ PAGE HEADER: IDENTITY + CREATE ACTIONS + KPI + OVERFLOW ═══
           Create actions (Job / Quote / Invoice) live directly under the
           client name/subtitle — not in a detached top-right row. The
           info block (name + subtitle) and the action row are visually
           separated by extra spacing + a hairline divider so they read
           as two distinct header sections. Add Location lives in the
           overflow dropdown so it doesn't visually dominate. */}
      <div className="bg-white border-b border-slate-200 px-6 pt-4 pb-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left block: name, subtitle, tags */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-title text-slate-900 truncate">{companyName}</h1>
              {parentCompany?.isActive === false && (
                <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-1.5 py-0">Inactive</Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {isSingleLocation && soleLocation
                ? (locationAddress(soleLocation) || locationDisplayName(soleLocation))
                : `${locations.length} location${locations.length !== 1 ? "s" : ""}`}
            </p>

            {(scopeTags.length > 0 || (scopeType === "company" ? Boolean(companyId) : Boolean(selectedLocationId))) && (
              <div className="flex items-center flex-wrap gap-1.5 mt-1.5" data-testid="client-header-tags">
                {scopeTags.map(tag => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                    data-testid={`client-header-tag-${tag.id}`}
                  >
                    {tag.name}
                  </span>
                ))}
                {scopeType === "company" && companyId ? (
                  <button
                    type="button"
                    onClick={() => setEditClientTagsOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors"
                    data-testid="client-header-tags-edit"
                    title="Edit client tags"
                  >
                    {scopeTags.length === 0 ? <Plus className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                    {scopeTags.length === 0 ? "Add tag" : "Edit"}
                  </button>
                ) : scopeType === "location" && selectedLocationId ? (
                  <button
                    type="button"
                    onClick={() => setEditLocationTagsOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors"
                    data-testid="client-header-tags-edit"
                    title="Edit location tags"
                  >
                    {scopeTags.length === 0 ? <Plus className="h-3 w-3" /> : <Tag className="h-3 w-3" />}
                    {scopeTags.length === 0 ? "Add tag" : "Edit"}
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {/* Right block: primary action buttons + overflow — aligned with client name */}
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5" data-testid="header-actions">
            <Button size="sm" className="h-8 text-xs" onClick={() => setJobDialogOpen(true)} data-testid="header-create-job">
              Create Job
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLocation("/quotes/new")} data-testid="header-create-quote">
              Create Quote
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLocation("/invoices/new")} data-testid="header-create-invoice">
              Create Invoice
            </Button>
            <ActionMenu
              items={[
                {
                  id: "edit-client",
                  label: "Edit Client",
                  icon: Pencil,
                  onSelect: () => setEditClientDialogOpen(true),
                },
                {
                  id: "edit-client-tags",
                  label: "Edit Client Tags",
                  icon: Tag,
                  onSelect: () => setEditClientTagsOpen(true),
                  hidden: !(scopeType === "company" && Boolean(companyId)),
                },
                {
                  id: "archive-client",
                  label: "Archive Client",
                  icon: Archive,
                  onSelect: () => openArchiveDialog("company"),
                  separator: true,
                },
                {
                  id: "delete-client",
                  label: "Delete Client",
                  icon: Trash2,
                  onSelect: () => openPermDeleteDialog("company"),
                  tone: "destructive",
                },
              ] satisfies ActionMenuItemDescriptor[]}
              trigger={
                <Button variant="ghost" size="icon" data-testid="header-overflow">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
              align="end"
            />
          </div>

        </div>
      </div>

      {/* ═══ SCOPE BAR — compact location selector (2026-05-02 layout refactor)
           Replaces the persistent left "Locations" rail. Sits directly
           below the page header (above the body row) so it spans the
           full content width on every breakpoint. The trigger reads
           `Viewing: All Locations (N)` (or the selected location name);
           the popover lists every location with its address subtitle
           and any active-job badge, with `All Locations` and an
           `Add Location` action bookending the list. */}
      <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-2 flex items-center gap-2" data-testid="client-scope-bar">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 flex-shrink-0">Viewing</span>
        <Popover open={scopePopoverOpen} onOpenChange={setScopePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="client-scope-trigger"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 max-w-[420px]"
            >
              {scopeType === "company" ? (
                <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
              ) : (
                <MapPin className="h-3.5 w-3.5 text-[#76B054] flex-shrink-0" />
              )}
              <span className="truncate">
                {scopeType === "company"
                  ? `All Locations (${locations.length})`
                  : selectedLoc
                    ? locationDisplayName(selectedLoc)
                    : "Select a location"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[320px] p-0 overflow-hidden"
            data-testid="client-scope-popover"
          >
            {/* Search input — only when there are enough locations to
                make the list awkward to eyeball. Reuses the same
                `locationSearch` state that previously drove the left
                rail's search box, so behavior is unchanged. */}
            {locations.length > 5 && (
              <div className="p-2 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="Search locations..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="h-7 pl-7 text-xs bg-slate-50/80 border-slate-200 focus:bg-white"
                  />
                </div>
              </div>
            )}

            <div className="max-h-[360px] overflow-y-auto">
              {/* All Locations row */}
              <button
                type="button"
                onClick={() => { handleSelectCompany(); setScopePopoverOpen(false); }}
                data-testid="client-scope-option-all"
                className={cn(
                  "w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-slate-100 transition-colors",
                  scopeType === "company"
                    ? "bg-[rgba(118,176,84,0.08)]"
                    : "hover:bg-slate-50",
                )}
              >
                <Building2 className={cn("h-3.5 w-3.5 flex-shrink-0", scopeType === "company" ? "text-[#76B054]" : "text-slate-400")} />
                <span className={cn("text-xs font-medium truncate flex-1", scopeType === "company" ? "text-[#5F9442]" : "text-slate-700")}>
                  All Locations ({locations.length})
                </span>
                {scopeType === "company" && <Check className="h-3.5 w-3.5 text-[#76B054] flex-shrink-0" />}
              </button>

              {/* Per-location rows */}
              {filteredLocations.length > 0 ? filteredLocations.map((loc) => {
                const isSelected = scopeType === "location" && selectedLocationId === loc.id;
                const locActiveCount = activeJobCountByLocation.get(loc.id) ?? 0;
                const subtitle = [loc.address, loc.city].filter(Boolean).join(", ");
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => { handleSelectLocation(loc.id); setScopePopoverOpen(false); }}
                    data-testid={`client-scope-option-${loc.id}`}
                    className={cn(
                      "w-full text-left px-3 py-2 flex items-start gap-2.5 border-b border-slate-100/80 transition-colors",
                      isSelected ? "bg-[rgba(118,176,84,0.08)]" : "hover:bg-slate-50",
                    )}
                  >
                    <MapPin className={cn("h-3.5 w-3.5 flex-shrink-0 mt-0.5", isSelected ? "text-[#76B054]" : "text-slate-400")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className={cn("text-xs font-medium truncate", isSelected ? "text-[#5F9442]" : "text-slate-800")}>
                          {locationDisplayName(loc)}
                        </span>
                        {loc.isPrimary && <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
                      </div>
                      {subtitle && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>
                      )}
                    </div>
                    {locActiveCount > 0 && (
                      <span className={cn(
                        "text-[11px] font-medium px-1.5 py-0 rounded flex-shrink-0 mt-0.5",
                        isSelected ? "bg-[#C2E974] text-[#5F9442]" : "bg-slate-100 text-slate-500",
                      )}>
                        {locActiveCount}
                      </span>
                    )}
                    {isSelected && locActiveCount === 0 && (
                      <Check className="h-3.5 w-3.5 text-[#76B054] flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              }) : (
                <div className="px-3 py-4 text-center text-xs text-slate-400">
                  {locationSearch ? `No match for "${locationSearch}"` : "No locations yet"}
                </div>
              )}
            </div>

            {/* Add Location action — pinned at the bottom of the popover
                so the user can always reach it without scrolling
                through every existing location. Routes through the
                same modal the legacy left rail used. */}
            <div className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setScopePopoverOpen(false); setAddLocationDialogOpen(true); }}
                data-testid="client-scope-add-location"
                className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs font-medium text-[#5F9442] hover:bg-[rgba(118,176,84,0.08)] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Location
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* 2026-05-03 quick-jump pills — one per location next to the
            canonical Viewing dropdown. Visible at every breakpoint;
            the cap (3 / 6 / 10) is JS-driven via `scopePillCap` so we
            can guarantee the active location is always in the visible
            slice. The dropdown remains the canonical full list. */}
        {locations.length > 0 && (() => {
          // Pin the active location into the visible slice when its
          // natural index is beyond the cap. Preserves natural order
          // for the first `cap - 1` slots; bumps active into the last
          // visible slot only when needed.
          const naturalSlice = locations.slice(0, scopePillCap);
          const activeId = scopeType === "location" ? selectedLocationId : null;
          const activeInSlice = !!activeId && naturalSlice.some((l) => l.id === activeId);
          const activeRow = activeId ? locations.find((l) => l.id === activeId) : null;
          const displayed: Client[] = (
            !activeId || activeInSlice || !activeRow
              ? naturalSlice
              : [...naturalSlice.slice(0, scopePillCap - 1), activeRow]
          );
          const hiddenCount = locations.length - displayed.length;
          return (
            <div
              className="flex items-center gap-1 flex-shrink min-w-0 overflow-hidden"
              data-testid="client-scope-pills"
            >
              {/* All-Locations shortcut */}
              <FilterChip
                selected={scopeType === "company"}
                size="compact"
                onClick={handleSelectCompany}
                data-testid="client-scope-pill-all"
                title="All Locations"
                className="flex-shrink-0"
              >
                All
              </FilterChip>
              {displayed.map((loc) => {
                const isActive = scopeType === "location" && selectedLocationId === loc.id;
                const chipLabel = loc.location?.trim() || loc.address?.trim() || "Unnamed";
                const titleLabel = locationDisplayName(loc);
                return (
                  <FilterChip
                    key={loc.id}
                    selected={isActive}
                    size="compact"
                    onClick={() => handleSelectLocation(loc.id)}
                    title={titleLabel}
                    data-testid={`client-scope-pill-${loc.id}`}
                    className="flex-shrink-0 max-w-[120px] truncate"
                  >
                    {chipLabel}
                  </FilterChip>
                );
              })}
              {/* Overflow indicator — clicking opens the canonical
                  dropdown so the user can reach any location not on
                  the pill row. Only rendered when something is
                  actually hidden. */}
              {hiddenCount > 0 && (
                <Chip
                  as="button"
                  tone="neutral"
                  size="compact"
                  interactive={true}
                  onClick={() => setScopePopoverOpen(true)}
                  title={`${hiddenCount} more location${hiddenCount === 1 ? "" : "s"}`}
                  data-testid="client-scope-pill-overflow"
                  className="flex-shrink-0 border-dashed"
                >
                  +{hiddenCount}
                </Chip>
              )}
            </div>
          );
        })()}

        {/* 2026-05-03: the selected-location address used to render
            here next to the pills. Removed because the same address
            already appears in the main location header card below —
            duplicating it crowded the scope row, especially with the
            new wider pill cap. The pills + active pill state already
            tell the user which location is selected. */}
      </div>

      {/* ═══ BODY — workspace card + recent activity (LEFT-COLUMN portion only) ═══
           2026-05-07: the right utility rail was lifted to the page-
           level outer flex row above, so the body here is now a
           single-column workspace area. The rail spans the full
           page-content height (top of the client header card →
           bottom of the workspace card), no longer trapped beside
           only the lower body. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="client-detail-body">

        {/* ── WORKSPACE SCROLL AREA — workspace card + recent activity ── */}
        <div className="flex-1 min-w-0 lg:min-h-0 lg:overflow-y-auto p-4 space-y-3">
                {/* ═══ MAIN WORKSPACE CARD ═══ */}
                <div className="flex flex-col rounded-md border border-slate-200 bg-white overflow-hidden">
                  {/* Workspace header + tabs.
                      For single-location clients the page header already owns
                      the client identity + address context, so we suppress
                      the whole scope-header row and the address block here
                      to avoid duplication. The one exception is when billing
                      and service addresses differ — in that case we surface
                      a compact labeled dual-address block above the tabs. */}
                  <div className="border-b border-slate-200 px-5 pt-2.5 pb-0">
                    {!isSingleLocation && (
                      <>
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
                              <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-1.5 py-0 hover:bg-amber-50">Primary</Badge>
                            )}
                            {/* 2026-05-02 layout refinement: tags moved
                                to the scope-aware header tag row above
                                the workspace card. Keeping the inline
                                copy here would duplicate them. */}
                          </div>
                          {scopeType === "location" && selectedLoc && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500" onClick={() => setEditLocationModalOpen(true)}>
                              <Pencil className="mr-1 h-3 w-3" />Edit
                            </Button>
                          )}
                        </div>
                        {scopeType === "location" && selectedLoc ? (
                          <div className="mb-1 pl-6">
                            {/* 2026-05-01 address consistency: multi-line
                                rendering to match the Billing Address
                                block in the dual-address card below. */}
                            {(() => {
                              const lines = locationAddressLines(selectedLoc);
                              return lines.length > 0
                                ? lines.map((line, i) => (
                                    <p key={i} className="text-xs text-slate-700 leading-snug mt-1">{line}</p>
                                  ))
                                : <p className="text-xs text-slate-400 mt-1">—</p>;
                            })()}
                            {selectedLoc.roofLadderCode && (
                              <p className="text-xs font-medium text-slate-700 mt-0.5">Site Code: {selectedLoc.roofLadderCode}</p>
                            )}
                          </div>
                        ) : scopeType === "company" ? (
                          <p className="text-xs text-slate-600 mb-1 pl-6">{companyName} &middot; Across {locations.length} location{locations.length !== 1 ? "s" : ""}</p>
                        ) : null}
                      </>
                    )}
                    {isSingleLocation && hasDistinctBillingAddress && soleLocation && (
                      <div className="grid grid-cols-2 gap-4 pb-2" data-testid="single-loc-dual-address">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Service Address</p>
                          {/* 2026-05-01 address consistency: same multi-line
                              shape as the Billing Address column on the
                              right. Both use the helper-array → <p> per
                              line pattern. */}
                          {(() => {
                            const lines = locationAddressLines(soleLocation);
                            return lines.length > 0
                              ? lines.map((line, i) => (
                                  <p key={i} className="text-xs text-slate-700 leading-snug">{line}</p>
                                ))
                              : <p className="text-xs text-slate-400">—</p>;
                          })()}
                          {soleLocation.roofLadderCode && (
                            <p className="text-xs text-slate-500 mt-0.5">Site Code: {soleLocation.roofLadderCode}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">Billing Address</p>
                          {billingAddressLines.length > 0 ? (
                            billingAddressLines.map((line, i) => (
                              <p key={i} className="text-xs text-slate-700 leading-snug">{line}</p>
                            ))
                          ) : (
                            <p className="text-xs text-slate-400">—</p>
                          )}
                        </div>
                      </div>
                    )}
                    {/* Site Code alone (single-loc, same address): show compactly so the code isn't lost. */}
                    {isSingleLocation && !hasDistinctBillingAddress && soleLocation?.roofLadderCode && (
                      <p className="text-xs text-slate-500 pb-2">Site Code: <span className="font-medium text-slate-700">{soleLocation.roofLadderCode}</span></p>
                    )}
                    {/* KPI strip — compact operational summary */}
                    <ClientKpiStrip
                      openJobs={activeJobsCount}
                      outstanding={outstandingInvoices.total}
                      overdueInvoices={overdueInvoicesCount}
                      activeMaintenance={activeMaintenanceCount}
                      totalLocations={locations.length}
                      lastServiceDate={lastServiceDate}
                    />

                    {/* Tab bar */}
                    <div className="flex -mb-px overflow-x-auto">
                      {(scopeType === "company" ? COMPANY_TABS : LOCATION_TABS).map(t => (
                        <button
                          key={t.key}
                          onClick={() => handleTabChange(t.key)}
                          data-testid={`workspace-tab-${t.key}`}
                          className={`relative px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                            workspaceTab === t.key
                              ? "text-[#76B054] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#76B054]"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tab content */}
                  <div className="p-4">
                    {scopeType === "company" ? (
                      <>
                        {workspaceTab === "overview" && companyId && (
                          <ClientOverviewTab
                            customerCompanyId={companyId}
                            companyName={companyName}
                            onNavigate={setLocation}
                            activeJobsCount={activeJobsCount}
                            onHoldJobsCount={onHoldJobsCount}
                            locationId={null}
                          />
                        )}
                        {workspaceTab === "jobs" && <ClientJobsTab jobs={companyJobs} locations={locations} showLocation onNavigate={setLocation} />}
                        {workspaceTab === "invoices" && <ClientInvoicesTab invoices={allInvoices} locations={locations} showLocation onNavigate={setLocation} />}
                        {workspaceTab === "quotes" && <ClientQuotesTab quotes={clientQuotes} locations={locations} showLocation onNavigate={setLocation} />}
                        {workspaceTab === "payments" && <ClientPaymentsTab payments={companyPayments} showLocation onNavigate={setLocation} />}
                      </>
                    ) : selectedLoc ? (
                      <>
                        {workspaceTab === "overview" && companyId && (
                          <ClientOverviewTab
                            customerCompanyId={companyId}
                            companyName={companyName}
                            onNavigate={setLocation}
                            activeJobsCount={activeJobsCount}
                            onHoldJobsCount={onHoldJobsCount}
                            locationId={selectedLocationId}
                          />
                        )}
                        {workspaceTab === "jobs" && <ClientJobsTab jobs={locJobs} locations={locations} showLocation={false} onNavigate={setLocation} />}
                        {workspaceTab === "invoices" && <ClientInvoicesTab invoices={locInvoices} locations={locations} showLocation={false} onNavigate={setLocation} />}
                        {workspaceTab === "quotes" && <ClientQuotesTab quotes={locQuotes} locations={locations} showLocation={false} onNavigate={setLocation} />}
                        {workspaceTab === "payments" && <ClientPaymentsTab payments={companyPayments.filter(p => p.locationId === selectedLocationId)} showLocation={false} onNavigate={setLocation} />}
                        {workspaceTab === "equipment" && (
                          <ClientEquipmentTab
                            equipment={locationEquipment}
                            scopeType="location"
                            onAdd={() => setEquipmentModalOpen(true)}
                            onOpen={(eq) => setDetailEquipment(eq)}
                          />
                        )}
                        {workspaceTab === "parts" && <ClientPartsTab parts={pmParts} scopeType="location" onManage={() => setPartsModalOpen(true)} />}
                      </>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-12">Select a location from the scope selector above.</p>
                    )}
                  </div>
                </div>

        </div>

      </div>
      {/* ═══ /BODY (left-column workspace) ═══ */}

      </div>
      {/* ═══ /LEFT COLUMN (page header + scope bar + body) ═══ */}

      {/* ═══ DRAG-RESIZE HANDLE (between center workspace and right rail) ═══
           Desktop only. Only renders when a panel is open — there's
           nothing to resize when the rail is showing only the icon
           strip. Width control is a vertical line with a wider
           invisible hit target for forgiving drags. Keyboard
           accessibility via arrow keys. */}
      {utilityTab !== null && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize utility rail"
          tabIndex={0}
          onPointerDown={handleRailPointerDown}
          onKeyDown={handleRailKeyDown}
          className={cn(
            "hidden lg:block relative w-2 -mx-1 cursor-col-resize",
            "focus-visible:outline-none group shrink-0",
          )}
          data-testid="client-right-column-resize"
        >
          <div
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
              "bg-slate-200/70 group-hover:w-0.5 group-hover:bg-slate-400",
              "group-focus-visible:w-0.5 group-focus-visible:bg-slate-500",
              "transition-[background-color,width] duration-150",
            )}
          />
        </div>
      )}

      {/* ═══ RIGHT PAGE COLUMN — utility rail, full page-content height ═══
           Sibling of the left page column, not a child of anything in
           it. Its top edge starts at the top of the page-content area,
           so it spans [page header + body] as one continuous column.
           2026-05-07 v3: the prior "DETAILS" collapsed strip is gone —
           the icon rail itself is always visible. Aside width:
             - panel open  → user-resized `rightRailWidth` (persisted)
             - panel closed → fixed RAIL_COLLAPSED_WIDTH (compact strip only) */}
      <aside
        className={cn(
          "relative lg:shrink-0 lg:h-full flex flex-col bg-app-bg",
          "border-t lg:border-t-0 lg:border-l border-app-bg",
        )}
        style={{
          ["--client-rail-width" as any]: `${
            utilityTab === null ? RAIL_COLLAPSED_WIDTH : rightRailWidth
          }px`,
        }}
        data-testid="client-right-column"
        data-panel-open={utilityTab === null ? "false" : "true"}
      >
        {/* 2026-05-07 canonical rail extraction: both mobile (below lg)
            and desktop (lg+) mount the canonical `<DetailRightRail>`
            primitive. The outer aside still owns the resize / width
            persistence (page-specific concern); the primitive owns the
            top-tab-nav + panel chrome. `testIdPrefix="client-side"`
            preserves the rendered DOM contract: `client-side-rail`,
            `client-side-panel-${id}`, `client-side-panel-close`,
            `client-side-panel-empty` all render byte-for-byte the
            same. Per-tab `rail-item-*` testIds come from `tab.testId`. */}
        <div className="lg:hidden">
          <DetailRightRail
            tabs={clientRailTabs}
            activeTabId={utilityTab}
            onActiveTabChange={(id) => setUtilityTab(id as UtilityPanel)}
            testIdPrefix="client-side"
            ariaLabel="Client information rail"
          />
        </div>

        {/* 2026-05-07 v3: the rail is ALWAYS visible on desktop. The
            prior `rightRailCollapsed` mode (vertical "DETAILS" expand
            tab) is gone — the user keeps the seven rail items in
            view at all times. "Collapsed" now simply means no panel
            body is open (controlled by `utilityTab === null`); the
            close-X inside the panel header is the single canonical
            collapse affordance. */}
        {/* 2026-05-07 RALPH — `RAIL_WIDTH_TRANSITION` animates this
            wrapper's `width` whenever `--client-rail-width` flips
            (panel open ↔ closed, or drag-resize). Matches the close
            duration of the main-header Activity drawer (`<Sheet>`
            300ms) so the two surfaces feel consistent. The
            primitive's deferred-unmount logic keeps the panel content
            mounted long enough for this width animation to complete
            before the section disappears from the DOM. */}
        <div
          className={cn(
            "hidden lg:flex h-full w-[var(--client-rail-width)] flex-col relative",
            RAIL_WIDTH_TRANSITION,
          )}
        >
          <DetailRightRail
            tabs={clientRailTabs}
            activeTabId={utilityTab}
            onActiveTabChange={(id) => setUtilityTab(id as UtilityPanel)}
            testIdPrefix="client-side"
            ariaLabel="Client information rail"
          />
        </div>
      </aside>

      {/* ── Dialogs ── */}
      <CreateJobModal
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        preselectedLocationId={scopeType === "location" ? selectedLocationId ?? undefined : undefined}
      />

      {/* Archive Confirmation — AlertDialog per CLAUDE.md taxonomy rule #1 */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-amber-500" />
              Archive {archiveTarget === "company" ? "Client" : "Location"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget === "company"
                ? `Archiving hides "${companyName}" from active client lists while preserving all history, jobs, invoices, and records. You can restore it later.`
                : `Archiving hides "${selectedLoc ? locationDisplayName(selectedLoc) : "this location"}" from active lists while preserving all related records.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => executeArchive.mutate()}
              disabled={executeArchive.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {executeArchive.isPending ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Delete Confirmation — AlertDialog per CLAUDE.md taxonomy rule #1 */}
      <AlertDialog open={permDeleteDialogOpen} onOpenChange={setPermDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently delete this {permDeleteTarget === "company" ? "client" : "location"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately and permanently delete all jobs, visits, recurring maintenance templates, invoices, payments, quotes, leads, notes, and attached files.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            {deleteImpactLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading affected records…
              </p>
            )}
            {deleteImpactError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {deleteImpactError}
              </div>
            )}
            {!deleteImpactLoading && !deleteImpactError && deleteImpact && (
              <>
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive mb-1.5">The following will be permanently deleted:</p>
                  <ul className="space-y-0.5 text-muted-foreground list-disc pl-4">
                    {deleteImpact.jobs > 0 && <li>{deleteImpact.jobs} job{deleteImpact.jobs !== 1 ? "s" : ""}</li>}
                    {deleteImpact.visits > 0 && <li>{deleteImpact.visits} visit{deleteImpact.visits !== 1 ? "s" : ""}</li>}
                    {deleteImpact.invoices > 0 && <li>{deleteImpact.invoices} invoice{deleteImpact.invoices !== 1 ? "s" : ""}</li>}
                    {deleteImpact.quotes > 0 && <li>{deleteImpact.quotes} quote{deleteImpact.quotes !== 1 ? "s" : ""}</li>}
                    {deleteImpact.leads > 0 && <li>{deleteImpact.leads} lead{deleteImpact.leads !== 1 ? "s" : ""}</li>}
                    {deleteImpact.servicePlans > 0 && <li>{deleteImpact.servicePlans} service plan{deleteImpact.servicePlans !== 1 ? "s" : ""}</li>}
                    {deleteImpact.recurringJobs > 0 && <li>{deleteImpact.recurringJobs} recurring job series</li>}
                    {deleteImpact.notes > 0 && <li>{deleteImpact.notes} note{deleteImpact.notes !== 1 ? "s" : ""}</li>}
                    {deleteImpact.files > 0 && <li>{deleteImpact.files} attached file{deleteImpact.files !== 1 ? "s" : ""}</li>}
                    {deleteImpact.maintenanceRecords > 0 && <li>{deleteImpact.maintenanceRecords} maintenance record{deleteImpact.maintenanceRecords !== 1 ? "s" : ""}</li>}
                    {permDeleteTarget === "company"
                      ? <li>{deleteImpact.locationCount ?? 0} location{(deleteImpact.locationCount ?? 0) !== 1 ? "s" : ""}, all contacts and equipment</li>
                      : <li>All location equipment, tags, and contacts</li>
                    }
                  </ul>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="perm-delete-confirm">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm
                  </Label>
                  <Input
                    id="perm-delete-confirm"
                    value={permDeleteConfirmText}
                    onChange={e => setPermDeleteConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoFocus
                    data-testid="perm-delete-confirm-input"
                  />
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => { setPermDeleteDialogOpen(false); openArchiveDialog(permDeleteTarget); }}
                  >
                    Archive instead to keep history
                  </button>
                </div>
              </>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => executePermanentDelete.mutate()}
              disabled={
                deleteImpactLoading ||
                Boolean(deleteImpactError) ||
                permDeleteConfirmText !== "DELETE" ||
                executePermanentDelete.isPending
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="perm-delete-confirm-btn"
            >
              {executePermanentDelete.isPending ? "Deleting…" : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <p className="text-helper text-muted-foreground pt-1 border-t">Primary site contact summary — manage full contacts from the Contacts tab after creating.</p>
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

      {/* Edit Tags (client / customer-company scope). 2026-05-02:
          previously this scope had no UI mount of EditTagsModal even
          though the modal already supported it; this caller closes
          that gap so client-level tags become editable from the
          header row + More-overflow menu. Same modal, no new API. */}
      {companyId && (
        <EditTagsModal
          open={editClientTagsOpen}
          onOpenChange={setEditClientTagsOpen}
          entityType="customerCompany"
          entityId={companyId}
          currentTags={companyTags}
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

      {/* 2026-05-07: page-level Equipment Detail modal. Opened from
          the right-rail Equipment panel's card-click handler. The
          modal's edit affordance reuses AddEquipmentDialog in
          mode="edit" (see EquipmentDetailModal.tsx:22-26) — no
          parallel editor introduced. */}
      <EquipmentDetailModal
        open={!!detailEquipment}
        onOpenChange={(open) => { if (!open) setDetailEquipment(null); }}
        equipment={detailEquipment}
      />
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
        <h3 className="text-label font-semibold tracking-wider text-slate-600">{title}</h3>
      </div>
      {children}
    </div>
  );
}


/** Compact company contacts for metadata panel — full CRUD.
 *  2026-05-02 unification: edit / add both go through the canonical
 *  ContactFormDialog. Roles are managed inside the modal's right-column
 *  Locations & Roles picker — no separate roles modal is mounted. */
// 2026-05-07: ref handle so the right-rail Contacts panel header's
// "+ Add" button can imperatively open the ContactFormDialog without
// duplicating its internal state.
export interface ContactsCompactRef {
  startAdding: () => void;
}

const CompanyContactsCompact = forwardRef<ContactsCompactRef, {
  companyContacts: (ClientContact & { assignmentCount?: number })[];
  locationContacts: ClientContact[];
  locations: Client[];
  companyId?: string;
  /** 2026-05-07: when true, suppress the internal `<h3>Contacts</h3>`
   *  + Add button. The right-rail panel header owns both. */
  hideHeader?: boolean;
}>(function CompanyContactsCompact({
  companyContacts, locationContacts, locations, companyId, hideHeader,
}, ref) {
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

  // Build person ID → ContactModalAssignment[] so the canonical modal
  // can pre-check the right-column Locations & Roles state without a
  // second fetch. The shape mirrors `contact_assignments` 1:1.
  const assignmentsByPersonId = useMemo(() => {
    const result = new Map<string, ContactModalAssignment[]>();
    for (const lc of locationContacts) {
      const personId = (lc as any).contactPersonId;
      if (!personId || !lc.locationId) continue;
      const arr = result.get(personId) ?? [];
      arr.push({
        assignmentId: lc.id,
        locationId: lc.locationId,
        roles: (lc as any).roles ?? [],
      });
      result.set(personId, arr);
    }
    return result;
  }, [locationContacts]);

  // Map full Client rows → ContactModalLocation shape so the modal
  // doesn't have to know the parent schema.
  const modalLocations = useMemo<ContactModalLocation[]>(() => locations.map(l => ({
    id: l.id,
    name: locationDisplayName(l),
    address: l.address,
    city: l.city,
    isPrimary: l.isPrimary ?? false,
  })), [locations]);

  const handleRefresh = useCallback(() => {
    if (companyId) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", companyId, "contacts"] });
    }
  }, [companyId]);

  // Imperative startAdding for the right-rail panel header.
  useImperativeHandle(ref, () => ({
    startAdding: () => {
      setEditingContact(null);
      setContactDialogOpen(true);
    },
  }), []);

  return (
    <div className="space-y-2">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-700">Contacts</h3>
          <button
            className="flex items-center gap-0.5 text-xs text-primary hover:text-primary/80 transition-colors"
            onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
            data-testid="company-contacts-add"
          >
            <Plus className="h-3.5 w-3.5" /><span>Add</span>
          </button>
        </div>
      )}
      {companyContacts.length === 0 ? (
        <RailContentCardMeta className="mt-0">No contacts yet.</RailContentCardMeta>
      ) : (
        <div className="space-y-1">
          {companyContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => { setEditingContact(ct); setContactDialogOpen(true); }}
              assignedLocationNames={personLocationNames.get(c.id) ?? []}
            />
          ))}
        </div>
      )}
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={(v) => { setContactDialogOpen(v); if (!v) setEditingContact(null); }}
        companyId={companyId}
        contact={editingContact}
        assignments={editingContact ? (assignmentsByPersonId.get(editingContact.id) ?? []) : []}
        locations={modalLocations}
        onSuccess={handleRefresh}
      />
    </div>
  );
});

/** Location contacts — shows contacts linked to the selected location.
 *  2026-05-02 unification: Add / Edit both open the canonical
 *  ContactFormDialog. Add pre-selects the current location; Edit loads
 *  the contact's full identity + every assignment so the right-column
 *  picker can pre-check every site they're already linked to. The
 *  legacy "Assign Existing" picker is gone — to add an existing
 *  company contact to this location, edit the contact (or its
 *  duplicate-detection cascade matches by email/name on Add). */
const LocContactsCompact = forwardRef<ContactsCompactRef, {
  locationContacts: (ClientContact & { contactPersonId?: string })[];
  companyContacts: ClientContact[];
  locationId: string;
  parentCompanyId?: string;
  /** Full client locations — required so the modal's right column can
   *  show every site (not just this one). */
  locations: Client[];
  /** Every location-contact across this client — required so the modal
   *  can pre-check the contact's other locations on Edit. */
  allLocationContacts: ClientContact[];
  /** 2026-05-07: when true, suppress the internal `<h3>Contacts</h3>`
   *  + Add button. The right-rail panel header owns both. */
  hideHeader?: boolean;
}>(function LocContactsCompact({
  locationContacts, companyContacts, locationId, parentCompanyId,
  locations, allLocationContacts, hideHeader,
}, ref) {
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  // The contact being edited. Always a person row (id = contactPersonId).
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients", locationId, "contacts"] });
    if (parentCompanyId) {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies", parentCompanyId, "contacts"] });
    }
  }, [locationId, parentCompanyId]);

  // Map locations and assignments for the modal — same shape the
  // company-scope CompanyContactsCompact builds.
  const modalLocations = useMemo<ContactModalLocation[]>(() => locations.map(l => ({
    id: l.id,
    name: locationDisplayName(l),
    address: l.address,
    city: l.city,
    isPrimary: l.isPrimary ?? false,
  })), [locations]);

  const assignmentsByPersonId = useMemo(() => {
    const result = new Map<string, ContactModalAssignment[]>();
    for (const lc of allLocationContacts) {
      const personId = (lc as any).contactPersonId;
      if (!personId || !lc.locationId) continue;
      const arr = result.get(personId) ?? [];
      arr.push({
        assignmentId: lc.id,
        locationId: lc.locationId,
        roles: (lc as any).roles ?? [],
      });
      result.set(personId, arr);
    }
    return result;
  }, [allLocationContacts]);

  // Find the person row for a location-contact card (the location
  // DTO carries identity by value but the canonical edit must target
  // the person id, not the assignment id).
  const handleEditFromLocation = (locContact: ClientContact) => {
    const personId = (locContact as any).contactPersonId || locContact.id;
    // Pull the full person row from `companyContacts` (which has the
    // canonical identity columns including `title` / `jobTitle`).
    const person = companyContacts.find(c => c.id === personId) ?? ({ ...locContact, id: personId } as ClientContact);
    setEditingContact(person);
    setContactDialogOpen(true);
  };

  // Imperative startAdding for the right-rail panel header.
  useImperativeHandle(ref, () => ({
    startAdding: () => {
      setEditingContact(null);
      setContactDialogOpen(true);
    },
  }), []);

  return (
    <div className="space-y-2">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-700">Contacts</h3>
          <button
            className="flex items-center gap-0.5 text-xs text-primary hover:text-primary/80 transition-colors"
            onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
            data-testid="loc-contacts-add"
          >
            <Plus className="h-3.5 w-3.5" /><span>Add</span>
          </button>
        </div>
      )}
      {locationContacts.length === 0 ? (
        <p className="text-helper text-muted-foreground">No contacts assigned.</p>
      ) : (
        <div className="space-y-1">
          {locationContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={(ct) => handleEditFromLocation(ct)}
            />
          ))}
        </div>
      )}
      <ContactFormDialog
        open={contactDialogOpen}
        onOpenChange={(v) => { setContactDialogOpen(v); if (!v) setEditingContact(null); }}
        companyId={parentCompanyId}
        contact={editingContact}
        assignments={editingContact ? (assignmentsByPersonId.get(editingContact.id) ?? []) : []}
        locations={modalLocations}
        preselectLocationId={editingContact ? undefined : locationId}
        onSuccess={handleRefresh}
      />
    </div>
  );
});

// ── Rail panel bodies (hooks — stay on this page) ────────────────────

interface ClientMaintenancePanelBodyProps {
  companyId: string | null;
  locationId: string | null;
  scopeType: ScopeType;
}

function ClientMaintenancePanelBody({
  companyId,
  locationId,
  scopeType,
}: ClientMaintenancePanelBodyProps) {
  // Filter the tenant-wide recurring-templates feed client-side by
  // clientId / locationId. The `?clientId=` query param doesn't exist
  // server-side today; client-side filtering is cheap because templates
  // are at-most ~hundreds per tenant.
  const { data: templates = [], isLoading } = useQuery<MaintenanceTemplateRow[]>({
    queryKey: ["/api/recurring-templates", "for-client", companyId],
    queryFn: () => apiRequest("/api/recurring-templates"),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <RailPanelRenderer
        panel={{ kind: "loading", testId: "client-maintenance-loading" }}
        testIdPrefix="client-side"
      />
    );
  }

  const matching = templates.filter((t) => {
    if (scopeType === "location") {
      return locationId && t.locationId === locationId;
    }
    return t.clientId === companyId;
  });

  return (
    <RailPanelRenderer
      panel={buildClientMaintenancePanelDescriptor(matching)}
      testIdPrefix="client-side"
    />
  );
}

interface ClientActivityPanelBodyProps {
  scopeType: ScopeType;
  customerCompanyId: string | null;
  locationId: string | null;
}

function ClientActivityPanelBody({
  scopeType,
  customerCompanyId,
  locationId,
}: ClientActivityPanelBodyProps) {
  // entityType "client" → customer_company id; "location" → client_location id.
  // (The events table uses `entity_type IN (... 'client', 'location' ...)`.)
  const entityType: "client" | "location" =
    scopeType === "location" ? "location" : "client";
  const entityId =
    scopeType === "location" ? locationId : customerCompanyId;

  const { data: feed, isLoading } = useQuery<{
    items: ClientActivityFeedItem[];
  }>({
    queryKey: ["/api/activity", entityType, entityId, "rail"],
    queryFn: () =>
      apiRequest(`/api/activity/${entityType}/${entityId}?limit=15`),
    enabled: Boolean(entityId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <RailPanelRenderer
        panel={{ kind: "loading", testId: "client-activity-loading" }}
        testIdPrefix="client-side"
      />
    );
  }

  return (
    <RailPanelRenderer
      panel={buildClientActivityPanelDescriptor(feed?.items ?? [])}
      testIdPrefix="client-side"
    />
  );
}

// ── Summary tab — stacks Billing / Maintenance / Activity ────────────

interface ClientSummaryTabContentProps {
  billing: RailBillingShape;
  paymentTermsDays: number | null;
  billingStreet: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
  companyId: string | null;
  locationId: string | null;
  scopeType: ScopeType;
  customerCompanyId: string | null;
}

function ClientSummaryTabContent({
  billing,
  paymentTermsDays,
  billingStreet,
  billingCity,
  billingProvince,
  billingPostalCode,
  companyId,
  locationId,
  scopeType,
  customerCompanyId,
}: ClientSummaryTabContentProps) {
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-2">Billing</SectionLabel>
        <ClientBillingPanelBody
          billing={billing}
          paymentTermsDays={paymentTermsDays}
          billingStreet={billingStreet}
          billingCity={billingCity}
          billingProvince={billingProvince}
          billingPostalCode={billingPostalCode}
        />
      </div>
      <div>
        <SectionLabel className="mb-2">Maintenance</SectionLabel>
        <ClientMaintenancePanelBody
          companyId={companyId}
          locationId={locationId}
          scopeType={scopeType}
        />
      </div>
      <div>
        <SectionLabel className="mb-2">Activity</SectionLabel>
        <ClientActivityPanelBody
          scopeType={scopeType}
          customerCompanyId={customerCompanyId}
          locationId={locationId}
        />
      </div>
    </div>
  );
}


