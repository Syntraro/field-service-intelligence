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
import { useState, useMemo, useCallback, useEffect } from "react";
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
  Clock, Package, Tag, Building2, AlertTriangle, Archive, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, Check,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
// 2026-04-26: Routed through the canonical CreateNewDialog (Job tab). The
// `preselectedLocationId` contract maps one-for-one onto CreateNewDialog's
// `jobPreselectedLocationId`, so the client-scoped create still keeps its
// location prefill.
import { CreateNewDialog } from "@/components/CreateNewDialog";
import { NewQuoteModal } from "@/components/NewQuoteModal";
import LocationFormModal from "@/components/LocationFormModal";
import NotesPanel, { type NotesPanelRef } from "@/components/NotesPanel";
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
  STANDARD_CONTACT_ROLES,
  type ContactScope,
  type ContactModalLocation,
  type ContactModalAssignment,
} from "@/components/ContactFormDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { AddEquipmentDialog } from "@/components/AddEquipmentDialog";
import { EquipmentDetailModal } from "@/components/EquipmentDetailModal";
import LocPricingTab from "@/components/LocPricingTab";
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
import { UNPAID_INVOICE_STATUSES } from "@shared/invoiceStatus";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Scope model: company overview or a specific location */
type ScopeType = "company" | "location";

/** Workspace tabs — operational only. Contacts / Notes / Billing live
 *  in the right utility rail, not here (drift correction 2026-04-18). */
type WorkspaceTab =
  | "active"
  | "jobs"
  | "invoices"
  | "quotes"
  | "equipment"
  | "pm"
  | "parts"
  | "pricing";

/** Utility-rail tabs in the right sidebar (Contacts / Notes / Billing).
 *  2026-05-02 layout simplification: the "fields" tab (canonical
 *  Reference-Fields surface from Phase 2b) was removed from this rail.
 *  Reference-field DATA and APIs are untouched — the section is no
 *  longer surfaced in this right-side panel, but is still readable /
 *  writable from any other Reference-Fields mount in the app. */
type UtilityTab = "contacts" | "notes" | "billing";

// ContactScope type and STANDARD_CONTACT_ROLES imported from @/components/ContactFormDialog

/** Normalize a contact record into a consistent shape for rendering.
 *  2026-05-02 honorific split: surfaces `title` (honorific) and
 *  `jobTitle` (professional role) separately so cards can render them
 *  as a single combined display name + a subtitle row. */
function normalizeContact(c: ClientContact): {
  id: string;
  displayName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  scope: ContactScope;
  locationId: string | null;
  isPrimary: boolean;
} {
  const honorific = (c.title ?? "").trim();
  const baseName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed";
  return {
    id: c.id,
    displayName: honorific ? `${honorific} ${baseName}` : baseName,
    jobTitle: ((c as any).jobTitle ?? "").trim() || null,
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

interface EnrichedQuote extends Quote {
  location?: { id: string; companyName: string };
}

interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

/** 2026-05-02 layout refactor: a single uniform tab list across both
 *  scopes. Equipment / Parts are inherently location-scoped data, so
 *  in company ("All Locations") scope they render an empty-state row
 *  nudging the user to pick a location from the scope selector — but
 *  the tab itself is always present so the bar shape doesn't change
 *  when the user toggles scope. PM is location-only and only listed
 *  in `LOCATION_TABS`. */
const COMPANY_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "active", label: "Active Work" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "equipment", label: "Equipment" },
  { key: "parts", label: "Parts" },
  // 2026-05-02: Pricing tab. The endpoint is location-keyed, so this
  // company-scope position renders ScopeRequiredEmpty (same pattern as
  // Equipment / Parts). Listed here only so the tab bar shape stays
  // stable across scope toggles.
  { key: "pricing", label: "Pricing" },
];

const LOCATION_TABS: { key: WorkspaceTab; label: string }[] = [
  { key: "active", label: "Active Work" },
  { key: "jobs", label: "Jobs" },
  { key: "invoices", label: "Invoices" },
  { key: "quotes", label: "Quotes" },
  { key: "equipment", label: "Equipment" },
  { key: "pm", label: "PM" },
  { key: "parts", label: "Parts" },
  { key: "pricing", label: "Pricing" },
];

const WORKSPACE_TAB_KEYS = new Set(LOCATION_TABS.map(t => t.key));

// ─── Currency formatter ──────────────────────────────────────────────────────
const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compact label for a scope-bar shortcut pill. Short single-word
 *  names (≤ 8 chars) render verbatim — `Office`, `Shop`. Multi-word
 *  names collapse to leading-letter initials with non-letter tokens
 *  filtered out — `Yonge & Finch` → `YF`,
 *  `Toronto General Hospital` → `TGH`. Single long words get a
 *  3-letter prefix as a last resort. The full name is always set as
 *  the pill's `title` so hovering reveals it. */
function locationShortName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  if (trimmed.length <= 8 && !trimmed.includes(" ")) return trimmed;
  const wordTokens = trimmed
    .split(/\s+/)
    .filter((w) => w && /[A-Za-z0-9]/.test(w[0]!));
  if (wordTokens.length >= 2) {
    return wordTokens.slice(0, 4).map((w) => w[0]!.toUpperCase()).join("");
  }
  return trimmed.slice(0, 3).toUpperCase();
}

function locationDisplayName(loc: Client): string {
  return loc.location?.trim()
    || (loc.address ? `${loc.address}${loc.city ? `, ${loc.city}` : ""}` : null)
    || "Unnamed Location";
}

function locationAddress(loc: Client): string {
  // Address line 2 shown after line 1 when present.
  // Single-line variant — used by the compact left-rail location list
  // where multi-line would break the truncation behavior.
  return [loc.address, loc.address2, loc.city, loc.province, loc.postalCode].filter(Boolean).join(", ");
}

/**
 * 2026-05-01: Multi-line variant of {@link locationAddress} — produced
 * to MATCH `billingAddressLines` (defined in the page body for the
 * parent company billing block) so the dual-address card shows
 * Service Address and Billing Address with the same line shape:
 *   Line 1: street
 *   Line 2: street2 (when present)
 *   Line 3: "City, Province, Postal"
 * Returns an array of non-empty strings; consumers map to <p> per line.
 */
function locationAddressLines(loc: Client | null | undefined): string[] {
  if (!loc) return [];
  return [
    loc.address,
    loc.address2,
    [loc.city, loc.province, loc.postalCode].filter(Boolean).join(", "),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{label}</p>;
}

/** 2026-05-02 layout refactor: empty state shown when a tab is
 *  rendered in "All Locations" scope but the underlying data is
 *  location-scoped (Equipment / Parts). Same shape as the regular
 *  EmptyState but with an icon + title + secondary description so the
 *  user understands why nothing's listed and what to do next. */
function ScopeRequiredEmpty({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="py-10 text-center" data-testid="scope-required-empty">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 mb-2">{icon}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">{description}</p>
    </div>
  );
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
          <p className="text-xs text-slate-400 truncate">{locationLabel}</p>
        )}
        {!locationLabel && job.scheduledStart && (
          <p className="text-xs text-slate-400">{format(new Date(job.scheduledStart), "MMM dd, yyyy")}</p>
        )}
      </div>
      <Badge
        variant={overdue ? "destructive" : (display.variant as any)}
        className="text-xs flex-shrink-0 ml-2"
      >
        {overdue ? "Overdue" : display.label}
      </Badge>
    </div>
  );
}

/** Filter chip row — shared UI for Jobs/Invoices/Quotes tab filters.
 *  Keeps the chip styling consistent across all workspace tabs. */
function FilterChips<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap mb-2" data-testid="workspace-filter-chips">
      {options.map(opt => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
            value === opt.key
              ? "bg-[#76B054] text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
          )}
        >
          {opt.label}
          {typeof opt.count === "number" && (
            <span className={cn(
              "tabular-nums",
              value === opt.key ? "text-white/80" : "text-slate-400",
            )}>
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

type JobFilter = "active" | "all" | "completed";
type InvoiceFilter = "all" | "draft" | "awaiting" | "paid" | "overdue";
type QuoteFilter = "all" | "draft" | "sent" | "approved";

function isJobActive(j: Job): boolean { return j.status === "open"; }
function isJobCompleted(j: Job): boolean { return j.status === "completed" || j.status === "invoiced"; }

function matchInvoiceFilter(inv: Invoice, f: InvoiceFilter): boolean {
  if (f === "all") return inv.status !== "voided";
  if (f === "draft") return inv.status === "draft";
  if (f === "paid") return inv.status === "paid";
  if (f === "awaiting") return inv.status === "awaiting_payment" || inv.status === "sent" || inv.status === "partial_paid";
  // overdue
  if (inv.status === "paid" || inv.status === "voided" || inv.status === "draft") return false;
  return Boolean(inv.dueDate && new Date(inv.dueDate) < new Date());
}

function matchQuoteFilter(q: EnrichedQuote, f: QuoteFilter): boolean {
  if (f === "all") return true;
  if (f === "draft") return q.status === "draft";
  if (f === "sent") return q.status === "sent";
  if (f === "approved") return q.status === "approved" || q.status === "converted";
  return true;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // ── Scope state ──
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("active");
  const [utilityTab, setUtilityTab] = useState<UtilityTab>("contacts");
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
  // Reuses the same localStorage keys as DetailPageShell so preferences
  // carry over between this page and Job / Invoice / Quote detail pages.
  // Implementation inlined here rather than forked into a new primitive
  // to keep this pass surgical — the shared key contract is the canonical
  // part that matters for UX. TODO: consolidate with DetailPageShell's
  // inline copy in a follow-up extraction.
  const RAIL_DEFAULT_WIDTH = 400;
  const RAIL_MIN_WIDTH = 300;
  const RAIL_MAX_WIDTH_PX = 520;
  const RAIL_MAX_WIDTH_RATIO = 0.45;
  const RAIL_COLLAPSED_TAB_WIDTH = 32;
  const LS_RAIL_WIDTH_KEY = "syntraro.detail.rail.width";
  const LS_RAIL_COLLAPSED_KEY = "syntraro.detail.rail.collapsed";

  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
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
      const rawCollapsed = localStorage.getItem(LS_RAIL_COLLAPSED_KEY);
      if (rawCollapsed === "1" || rawCollapsed === "true") setRightRailCollapsed(true);
    } catch { /* noop */ }
    setRightRailHydrated(true);
  }, []);
  useEffect(() => {
    if (!rightRailHydrated) return;
    try { localStorage.setItem(LS_RAIL_WIDTH_KEY, String(rightRailWidth)); } catch { /* noop */ }
  }, [rightRailWidth, rightRailHydrated]);
  useEffect(() => {
    if (!rightRailHydrated) return;
    try { localStorage.setItem(LS_RAIL_COLLAPSED_KEY, rightRailCollapsed ? "1" : "0"); } catch { /* noop */ }
  }, [rightRailCollapsed, rightRailHydrated]);

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

  // Push URL state when scope/tab changes. "active" (Active Work) is the
  // default tab as of the 2026-04-18 refinement.
  const updateUrlParams = useCallback((scope: ScopeType, locId: string | null, tab: WorkspaceTab) => {
    const params = new URLSearchParams();
    if (scope === "location" && locId) params.set("location", locId);
    if (tab !== "active") params.set("tab", tab);
    const qs = params.toString();
    const newUrl = `/clients/${clientId}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [clientId]);

  const handleSelectCompany = useCallback(() => {
    setScopeType("company");
    setSelectedLocationId(null);
    setWorkspaceTab("active");
    updateUrlParams("company", null, "active");
  }, [updateUrlParams]);

  const handleSelectLocation = useCallback((locId: string) => {
    setScopeType("location");
    setSelectedLocationId(locId);
    setWorkspaceTab("active");
    updateUrlParams("location", locId, "active");
  }, [updateUrlParams]);

  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    updateUrlParams(scopeType, selectedLocationId, tab);
  }, [scopeType, selectedLocationId, updateUrlParams]);

  // ── Dialogs ──
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
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

  return (
    <div className="flex h-full flex-col bg-app-bg" data-testid="client-detail-root">

      {/* ═══ PAGE HEADER: IDENTITY + CREATE ACTIONS + KPI + OVERFLOW ═══
           Create actions (Job / Quote / Invoice) live directly under the
           client name/subtitle — not in a detached top-right row. The
           info block (name + subtitle) and the action row are visually
           separated by extra spacing + a hairline divider so they read
           as two distinct header sections. Add Location lives in the
           overflow dropdown so it doesn't visually dominate. */}
      <div className="bg-white border-b border-slate-200 px-6 pt-4 pb-5">
        <div className="flex items-start gap-4">
          {/* Left block: name, subtitle, create actions */}
          <div className="min-w-0 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900 truncate">{companyName}</h1>
              {parentCompany?.isActive === false && (
                <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-1.5 py-0">Inactive</Badge>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {isSingleLocation && soleLocation
                ? (locationAddress(soleLocation) || locationDisplayName(soleLocation))
                : `${locations.length} location${locations.length !== 1 ? "s" : ""}`}
            </p>

            {/* 2026-05-02: scope-aware tag row. In `All Locations`
                scope shows the customer-company tags; in a specific
                location's scope shows that location's tags. The Edit
                affordance routes through the canonical
                `EditTagsModal` (the same modal the More-overflow
                menu uses) — no parallel tag system, no new endpoint.
                Hidden entirely when there are no tags AND no Edit
                affordance is rendered (e.g. before companyId
                resolves), to avoid an empty tag strip. */}
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
                {/* Edit / add affordance — only rendered when an
                    underlying entity id is resolvable (otherwise the
                    canonical modal has nothing to write against). */}
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

            {/* Create-actions row — distinct from the info block above.
                `mt-4 pt-3 border-t border-slate-100` separates it with
                a hairline divider + 28px of vertical breathing room so
                the client info and the actions read as two sections.
                The More (overflow) menu lives in this cluster, not at
                the far-right page edge. */}
            <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-slate-100">
              <Button size="sm" className="h-8 text-xs" onClick={() => setJobDialogOpen(true)} data-testid="header-create-job">
                <Plus className="mr-1 h-3 w-3" />Create Job
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setQuoteDialogOpen(true)} data-testid="header-create-quote">
                <Plus className="mr-1 h-3 w-3" />Create Quote
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLocation("/invoices/new")} data-testid="header-create-invoice">
                <Plus className="mr-1 h-3 w-3" />Create Invoice
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="header-overflow">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setAddLocationDialogOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-2" /> Add Location
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditClientDialogOpen(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Client
                  </DropdownMenuItem>
                  {scopeType === "company" && companyId && (
                    <DropdownMenuItem onClick={() => setEditClientTagsOpen(true)}>
                      <Tag className="h-3.5 w-3.5 mr-2" /> Edit Client Tags
                    </DropdownMenuItem>
                  )}
                  {scopeType === "location" && selectedLoc && (
                    <>
                      <DropdownMenuItem onClick={() => setEditLocationModalOpen(true)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit Location
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditLocationTagsOpen(true)}>
                        <Tag className="h-3.5 w-3.5 mr-2" /> Edit Location Tags
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

          {/* KPI block — fills remaining space; vertically centered */}
          <div className="flex-1 flex justify-start items-center pl-12 pt-1">
            <div className="flex items-center gap-5 rounded-md border border-slate-200 bg-slate-50/80 px-5 py-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-xs">Active Jobs</span>
                <span className="font-bold text-[#76B054] text-base tabular-nums">{activeJobsCount}</span>
              </div>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-xs">Lifetime Revenue</span>
                <span className="font-bold text-slate-900 text-base">{fmt.format(lifetimeRevenue)}</span>
              </div>
              <div className="h-5 w-px bg-slate-200" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-slate-600 text-xs">Outstanding</span>
                <span className="font-bold text-slate-900 text-base">{fmt.format(outstandingInvoices.total)}</span>
              </div>
              {outstandingInvoices.overdueTotal > 0 && (
                <>
                  <div className="h-5 w-px bg-red-200" />
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-red-500 text-xs font-medium">Overdue</span>
                    <span className="font-bold text-red-600 text-base">{fmt.format(outstandingInvoices.overdueTotal)}</span>
                  </div>
                </>
              )}
            </div>
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
              <button
                type="button"
                onClick={handleSelectCompany}
                data-testid="client-scope-pill-all"
                title="All Locations"
                className={cn(
                  "h-6 px-2 rounded-full border text-[11px] font-medium transition-colors flex-shrink-0",
                  scopeType === "company"
                    ? "bg-[#76B054] text-white border-[#76B054]"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
                )}
              >
                All
              </button>
              {displayed.map((loc) => {
                const isActive = scopeType === "location" && selectedLocationId === loc.id;
                const fullName = locationDisplayName(loc);
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => handleSelectLocation(loc.id)}
                    title={fullName}
                    data-testid={`client-scope-pill-${loc.id}`}
                    className={cn(
                      "h-6 px-2 rounded-full border text-[11px] font-medium transition-colors flex-shrink-0",
                      "max-w-[80px] truncate",
                      isActive
                        ? "bg-[#76B054] text-white border-[#76B054]"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
                    )}
                  >
                    {locationShortName(fullName)}
                  </button>
                );
              })}
              {/* Overflow indicator — clicking opens the canonical
                  dropdown so the user can reach any location not on
                  the pill row. Only rendered when something is
                  actually hidden. */}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setScopePopoverOpen(true)}
                  title={`${hiddenCount} more location${hiddenCount === 1 ? "" : "s"}`}
                  data-testid="client-scope-pill-overflow"
                  className="inline-flex h-6 px-2 rounded-full border border-dashed border-slate-300 text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors flex-shrink-0"
                >
                  +{hiddenCount}
                </button>
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

      {/* ═══ BODY — workspace (main) | right rail (Client Information) ═══
           Two-column layout. Left column is the unified workspace card
           (tabs: Active Work / Jobs / Invoices / Quotes / Equipment /
           PM / Parts). Right column is the utility rail. The persistent
           left "Locations" rail was removed on 2026-05-02; navigation
           between scopes now goes through the scope bar above. */}
      <div className="flex-1 min-h-0 flex lg:flex-row flex-col overflow-hidden" data-testid="client-detail-body">

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
                        {workspaceTab === "active" && (
                          <ActiveWorkTab
                            jobs={companyJobs}
                            invoices={allInvoices}
                            quotes={clientQuotes}
                            locations={locations}
                            scopeType="company"
                            onNavigate={setLocation}
                          />
                        )}
                        {workspaceTab === "jobs" && <ClientAllJobsTab jobs={companyJobs} locations={locations} onNavigate={setLocation} />}
                        {workspaceTab === "invoices" && <ClientAllInvoicesTab invoices={allInvoices} locations={locations} onNavigate={setLocation} />}
                        {workspaceTab === "quotes" && <ClientAllQuotesTab quotes={clientQuotes} locations={locations} onNavigate={setLocation} />}
                        {/* 2026-05-02: Equipment + Parts are inherently
                            location-scoped — surface a nudge to pick a
                            specific location rather than fabricating a
                            cross-location aggregate. The scope selector
                            is the canonical place to switch. */}
                        {workspaceTab === "equipment" && (
                          <ScopeRequiredEmpty
                            icon={<Wrench className="h-5 w-5 text-slate-400" />}
                            title="Equipment is per-location"
                            description="Pick a specific location from the scope selector above to view or add equipment."
                          />
                        )}
                        {workspaceTab === "parts" && (
                          <ScopeRequiredEmpty
                            icon={<Package className="h-5 w-5 text-slate-400" />}
                            title="Parts templates are per-location"
                            description="Pick a specific location from the scope selector above to manage PM parts."
                          />
                        )}
                        {workspaceTab === "pricing" && (
                          <ScopeRequiredEmpty
                            icon={<Receipt className="h-5 w-5 text-slate-400" />}
                            title="Pricing history is per-location"
                            description="Pick a specific location from the scope selector above to view its invoice and quote pricing history."
                          />
                        )}
                      </>
                    ) : selectedLoc ? (
                      <>
                        {workspaceTab === "active" && (
                          <ActiveWorkTab
                            jobs={locJobs}
                            invoices={locInvoices}
                            quotes={locQuotes}
                            locations={locations}
                            scopeType="location"
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
                        {workspaceTab === "pricing" && (
                          <LocPricingTab locationId={selectedLocationId!} onNavigate={setLocation} />
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-12">Select a location from the scope selector above.</p>
                    )}
                  </div>
                </div>

                {/* ═══ RECENT ACTIVITY CARD (below workspace) ═══
                    Activity feed is company-scoped; always shows parent
                    company activity regardless of scopeType. */}
                {companyId && (
                  <div className="rounded-md border border-slate-200 bg-white p-4" data-testid="client-recent-activity">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">Recent Activity</h3>
                      <Clock className="h-3 w-3 text-slate-400" />
                    </div>
                    <ClientActivityCompact companyId={companyId} />
                  </div>
                )}
        </div>

      {/* ═══ DRAG-RESIZE HANDLE (between center workspace and right rail) ═══
           Desktop only, hidden when the rail is collapsed. Width control
           is a vertical line with a wider invisible hit target for
           forgiving drags. Keyboard accessibility via arrow keys. */}
      {!rightRailCollapsed && (
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
           Width and collapse state persist via the canonical
           `syntraro.detail.rail.{width,collapsed}` localStorage keys —
           same keys used by DetailPageShell, so preferences carry over
           between Client Detail and Job / Invoice / Quote detail pages. */}
      <aside
        className={cn(
          "relative lg:shrink-0 lg:h-full flex flex-col bg-white",
          "border-t lg:border-t-0 lg:border-l border-slate-200",
        )}
        style={{
          width: rightRailCollapsed
            ? `${RAIL_COLLAPSED_TAB_WIDTH}px`
            : undefined,
          // Inline width via style so we don't need arbitrary Tailwind
          // class values for every possible pixel count.
          ...(rightRailCollapsed
            ? {}
            : { ["--client-rail-width" as any]: `${rightRailWidth}px` }),
        }}
        data-testid="client-right-column"
        data-collapsed={rightRailCollapsed ? "true" : "false"}
      >
        {/* Below lg: rail stacks under the left column; always show full
            content regardless of the desktop collapse flag. */}
        <div className="lg:hidden">
          <UtilityRail
            utilityTab={utilityTab}
            setUtilityTab={setUtilityTab}
            scopeType={scopeType}
            companyId={companyId}
            selectedLoc={selectedLoc}
            selectedLocationId={selectedLocationId}
            clientLevelContacts={clientLevelContacts}
            allLocationContacts={allLocationContacts}
            locations={locations}
            locContacts={locContacts}
            locCompanyContacts={locCompanyContacts}
            ownerCompanyId={client.companyId || ""}
            scopeLabel={scopeEntityName}
            billing={{
              lifetimeRevenue,
              paidYtd,
              outstanding: outstandingInvoices,
              aging: agingBuckets,
            }}
          />
        </div>

        {/* Desktop: either the expand-edge-tab (collapsed) or the
            full rail content + collapse button (expanded). */}
        {rightRailCollapsed ? (
          <button
            type="button"
            onClick={() => setRightRailCollapsed(false)}
            className={cn(
              "hidden lg:flex h-full w-full flex-col items-center justify-center gap-2",
              "text-slate-700 hover:bg-slate-50 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-inset",
            )}
            aria-label="Expand utility rail"
            title="Expand"
            data-testid="client-right-column-expand"
          >
            <ChevronLeft className="h-4 w-4" />
            <span
              className="select-none text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Details
            </span>
          </button>
        ) : (
          <div
            className="hidden lg:flex h-full w-[var(--client-rail-width)] flex-col relative"
          >
            <button
              type="button"
              onClick={() => setRightRailCollapsed(true)}
              className={cn(
                "absolute top-1.5 right-1.5 z-20",
                "h-6 w-6 flex items-center justify-center rounded-md",
                "text-slate-700 hover:text-slate-950",
                "bg-white/95 hover:bg-white border border-slate-300 hover:border-slate-400",
                "shadow-sm backdrop-blur-[1px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
              )}
              aria-label="Collapse utility rail"
              title="Collapse"
              data-testid="client-right-column-collapse"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <UtilityRail
              utilityTab={utilityTab}
              setUtilityTab={setUtilityTab}
              scopeType={scopeType}
              companyId={companyId}
              selectedLoc={selectedLoc}
              selectedLocationId={selectedLocationId}
              clientLevelContacts={clientLevelContacts}
              allLocationContacts={allLocationContacts}
              locations={locations}
              locContacts={locContacts}
              locCompanyContacts={locCompanyContacts}
              ownerCompanyId={client.companyId || ""}
              scopeLabel={scopeEntityName}
              billing={{
                lifetimeRevenue,
                paidYtd,
                outstanding: outstandingInvoices,
                aging: agingBuckets,
              }}
            />
          </div>
        )}
      </aside>

      </div>
      {/* ═══ /BODY ═══ */}

      {/* ── Dialogs ── */}
      <CreateNewDialog
        open={jobDialogOpen}
        onOpenChange={setJobDialogOpen}
        defaultTab="job"
        jobPreselectedLocationId={scopeType === "location" ? selectedLocationId ?? undefined : undefined}
      />

      {/* Create Quote — canonical NewQuoteModal. Modal has its own
          location picker; client pre-selection is not supported by the
          canonical API, so users pick inside the dialog. */}
      <NewQuoteModal open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen} />

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
            <p className="text-xs text-muted-foreground pt-1 border-t">Primary site contact summary — manage full contacts from the Contacts tab after creating.</p>
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
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">{title}</h3>
      </div>
      {children}
    </div>
  );
}


/** Compact company contacts for metadata panel — full CRUD.
 *  2026-05-02 unification: edit / add both go through the canonical
 *  ContactFormDialog. Roles are managed inside the modal's right-column
 *  Locations & Roles picker — no separate roles modal is mounted. */
function CompanyContactsCompact({
  companyContacts, locationContacts, locations, companyId,
}: {
  companyContacts: (ClientContact & { assignmentCount?: number })[];
  locationContacts: ClientContact[];
  locations: Client[];
  companyId?: string;
}) {
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

  return (
    <div className="space-y-2">
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
      {companyContacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contacts yet.</p>
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
}

/** Location contacts — shows contacts linked to the selected location.
 *  2026-05-02 unification: Add / Edit both open the canonical
 *  ContactFormDialog. Add pre-selects the current location; Edit loads
 *  the contact's full identity + every assignment so the right-column
 *  picker can pre-check every site they're already linked to. The
 *  legacy "Assign Existing" picker is gone — to add an existing
 *  company contact to this location, edit the contact (or its
 *  duplicate-detection cascade matches by email/name on Add). */
function LocContactsCompact({
  locationContacts, companyContacts, locationId, parentCompanyId,
  locations, allLocationContacts,
}: {
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
}) {
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

  return (
    <div className="space-y-2">
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
      {locationContacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No contacts assigned.</p>
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Rail — right-side card with Contacts / Notes / Billing tabs
// ═══════════════════════════════════════════════════════════════════════════════
// Reuses canonical CompanyContactsCompact, LocContactsCompact, NotesPanel.
// Billing aggregates are derived in the parent page from already-loaded
// invoices (no new queries).

type UtilityRailProps = {
  utilityTab: UtilityTab;
  setUtilityTab: (t: UtilityTab) => void;
  scopeType: ScopeType;
  companyId?: string;
  selectedLoc: Client | null;
  selectedLocationId: string | null;
  clientLevelContacts: (ClientContact & { assignmentCount?: number })[];
  allLocationContacts: ClientContact[];
  locations: Client[];
  locContacts: (ClientContact & { contactPersonId?: string })[];
  locCompanyContacts: ClientContact[];
  ownerCompanyId: string;
  // 2026-05-02 layout refactor: short label rendered next to "Client
  // Information" in the rail header, e.g. "All Locations" or the
  // selected location's display name.
  scopeLabel: string;
  billing: {
    lifetimeRevenue: number;
    paidYtd: number;
    outstanding: { count: number; total: number; overdueTotal: number };
    aging: { current: number; d30: number; d60: number; d90: number };
  };
};

function UtilityRail(props: UtilityRailProps) {
  const {
    utilityTab, setUtilityTab, scopeType, companyId,
    selectedLoc, selectedLocationId, clientLevelContacts,
    allLocationContacts, locations, locContacts, locCompanyContacts,
    ownerCompanyId, scopeLabel, billing,
  } = props;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white" data-testid="client-utility-rail">
      {/* 2026-05-02 layout refactor: title bar identifying the rail as
          the right-side "Client Information" panel. Includes the
          current scope so the user always knows whether they're
          looking at company-level info or location-specific info. */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex-shrink-0">Client Information</span>
        <span className="text-[11px] text-slate-500 truncate" data-testid="client-info-scope-label">({scopeLabel})</span>
      </div>
      <Tabs value={utilityTab} onValueChange={(v) => setUtilityTab(v as UtilityTab)} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="w-full h-auto bg-slate-50 rounded-none border-b border-slate-200 p-0 justify-start">
          {(["contacts", "notes", "billing"] as UtilityTab[]).map(k => (
            <TabsTrigger
              key={k}
              value={k}
              className="flex-1 rounded-none px-2 py-1.5 text-xs font-medium capitalize data-[state=active]:bg-white data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-[#76B054] data-[state=active]:text-[#76B054]"
              data-testid={`utility-tab-${k}`}
            >
              {k}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="contacts" className="m-0 p-3">
          {scopeType === "company" ? (
            <CompanyContactsCompact
              companyContacts={clientLevelContacts}
              locationContacts={allLocationContacts}
              locations={locations}
              companyId={companyId}
            />
          ) : selectedLoc && selectedLocationId ? (
            <LocContactsCompact
              locationContacts={locContacts}
              companyContacts={locCompanyContacts}
              locationId={selectedLocationId}
              parentCompanyId={companyId}
              locations={locations}
              allLocationContacts={allLocationContacts}
            />
          ) : (
            <p className="text-xs text-slate-400">No contacts.</p>
          )}
        </TabsContent>

        <TabsContent value="notes" className="m-0 p-3">
          {scopeType === "company" && companyId ? (
            <NotesPanel scope="company" companyId={companyId} hideAddButton={false} />
          ) : scopeType === "location" && selectedLocationId ? (
            <NotesPanel scope="location" companyId={ownerCompanyId} locationId={selectedLocationId} hideAddButton={false} />
          ) : (
            <p className="text-xs text-slate-400">No notes.</p>
          )}
        </TabsContent>

        {/* Billing — derived from already-loaded invoices; same data in both scopes. */}
        <TabsContent value="billing" className="m-0 p-3">
          <BillingSummary billing={billing} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-700 truncate text-right">{value}</dd>
    </div>
  );
}

function BillingSummary({ billing }: { billing: UtilityRailProps["billing"] }) {
  const { outstanding, lifetimeRevenue, paidYtd, aging } = billing;
  return (
    <div className="text-xs space-y-3">
      <dl className="space-y-2">
        <DetailRow label="Outstanding" value={
          <span className="tabular-nums font-semibold text-slate-900">{fmt.format(outstanding.total)}</span>
        } />
        {outstanding.overdueTotal > 0 && (
          <DetailRow label="Overdue" value={
            <span className="tabular-nums font-semibold text-red-600">{fmt.format(outstanding.overdueTotal)}</span>
          } />
        )}
        <DetailRow label="Paid YTD" value={
          <span className="tabular-nums text-slate-700">{fmt.format(paidYtd)}</span>
        } />
        <DetailRow label="Lifetime Revenue" value={
          <span className="tabular-nums text-slate-700">{fmt.format(lifetimeRevenue)}</span>
        } />
      </dl>
      {outstanding.count > 0 && (
        <div className="pt-1.5 border-t border-slate-100">
          <dt className="text-slate-500 mb-1.5">Aging</dt>
          <div className="space-y-1">
            <AgingRow label="Current" amount={aging.current} />
            <AgingRow label="1–30d" amount={aging.d30} />
            <AgingRow label="31–60d" amount={aging.d60} />
            <AgingRow label="60d+" amount={aging.d90} danger />
          </div>
        </div>
      )}
      {outstanding.count === 0 && (
        <p className="text-slate-400 text-xs text-center pt-1">No open balances.</p>
      )}
    </div>
  );
}

function AgingRow({ label, amount, danger }: { label: string; amount: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-slate-500", danger && amount > 0 && "text-red-500")}>{label}</span>
      <span className={cn("tabular-nums", danger && amount > 0 ? "text-red-600 font-medium" : "text-slate-600")}>
        {fmt.format(amount)}
      </span>
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

  if (!companyId) return <p className="text-xs text-muted-foreground/60">—</p>;
  if (isLoading) return <Skeleton className="h-5 w-24" />;
  if (activity.length === 0) return <p className="text-xs text-muted-foreground/60">No activity yet.</p>;

  return (
    <div className="space-y-1.5">
      {activity.slice(0, 8).map((evt: any, i: number) => (
        <div key={evt.id || i} className="flex items-start gap-2 text-xs">
          <div className="h-1.5 w-1.5 rounded-full bg-slate-300 flex-shrink-0 mt-1.5" />
          <div className="flex-1 min-w-0">
            <p className="text-foreground truncate">{evt.description || evt.action || "Event"}</p>
            <p className="text-muted-foreground text-xs">
              {evt.createdAt ? format(new Date(evt.createdAt), "MMM dd, h:mm a") : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Active Work — cross-entity operational view (2026-04-18 refinement)
// ═══════════════════════════════════════════════════════════════════════════════
// Aggregates the "what needs action right now" view across Jobs,
// Invoices, and Quotes for the current scope. All data comes from the
// already-loaded canonical datasets in ClientDetailPage — no new
// queries, no fabricated statuses.
//
// Sections (only rendered when that section has items):
//   - Active Jobs         = status === "open" (overdue shown first)
//   - Unpaid Invoices     = awaiting_payment / sent / partial_paid, and
//                           any invoice past its due date
//   - Open Quotes         = draft (not yet sent) and sent (awaiting
//                           client response)

function ActiveWorkTab({
  jobs, invoices, quotes, locations, scopeType, onNavigate,
}: {
  jobs: Job[];
  invoices: Invoice[];
  quotes: EnrichedQuote[];
  locations: Client[];
  scopeType: ScopeType;
  onNavigate: (p: string) => void;
}) {
  const locMap = useMemo(
    () => new Map(locations.map(l => [l.id, locationDisplayName(l)])),
    [locations],
  );

  // ── Active jobs (status === "open"), overdue first, then most recent ──
  const activeJobs = useMemo(() => {
    return jobs
      .filter(isJobActive)
      .sort((a, b) => {
        const oa = isJobOverdue(a) ? 0 : 1;
        const ob = isJobOverdue(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        const pa = getJobStatusDisplay(a).priority;
        const pb = getJobStatusDisplay(b).priority;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt ?? b.createdAt).getTime()
             - new Date(a.updatedAt ?? a.createdAt).getTime();
      });
  }, [jobs]);

  // ── Unpaid invoices: awaiting + overdue; overdue first ──
  const unpaidInvoices = useMemo(() => {
    const list = invoices.filter(inv =>
      matchInvoiceFilter(inv, "awaiting") || matchInvoiceFilter(inv, "overdue"),
    );
    return list.sort((a, b) => {
      const oa = matchInvoiceFilter(a, "overdue") ? 0 : 1;
      const ob = matchInvoiceFilter(b, "overdue") ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db;
    });
  }, [invoices]);

  // ── Open quotes: draft (not sent) and sent (awaiting approval) ──
  const openQuotes = useMemo(() => {
    const list = quotes.filter(q => q.status === "draft" || q.status === "sent");
    return list.sort((a, b) =>
      new Date(b.updatedAt ?? b.createdAt).getTime()
      - new Date(a.updatedAt ?? a.createdAt).getTime(),
    );
  }, [quotes]);

  const totalCount = activeJobs.length + unpaidInvoices.length + openQuotes.length;
  if (totalCount === 0) {
    return <EmptyState label="No active work — everything is current." />;
  }

  const showLocation = scopeType === "company";

  return (
    <div className="space-y-4" data-testid="active-work-tab">
      {activeJobs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">
              Active Jobs
            </h3>
            <span className="text-xs text-slate-400">{activeJobs.length}</span>
          </div>
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
            {activeJobs.map(j => (
              <JobRow
                key={j.id}
                job={j}
                locationLabel={showLocation ? locMap.get(j.locationId) : undefined}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </section>
      )}

      {unpaidInvoices.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">
              Unpaid Invoices
            </h3>
            <span className="text-xs text-slate-400">{unpaidInvoices.length}</span>
          </div>
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
            {unpaidInvoices.map(inv => {
              const badge = getInvoiceStatusBadge(inv.status, false);
              const overdue = matchInvoiceFilter(inv, "overdue");
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => onNavigate(`/invoices/${inv.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-700">
                      INV #{inv.invoiceNumber || inv.id.slice(0, 6)}
                    </span>
                    <span className="text-slate-500 ml-2">
                      {fmt.format(Number(inv.total ?? 0))}
                    </span>
                    {showLocation && locMap.get(inv.locationId) && (
                      <p className="text-slate-400 text-xs truncate">{locMap.get(inv.locationId)}</p>
                    )}
                    {inv.dueDate && (
                      <p className={cn("text-xs", overdue ? "text-red-500" : "text-slate-400")}>
                        Due {format(new Date(inv.dueDate), "MMM dd, yyyy")}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={overdue ? "destructive" : badge.variant}
                    className="text-xs flex-shrink-0 ml-2"
                  >
                    {overdue ? "Overdue" : badge.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {openQuotes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">
              Open Quotes
            </h3>
            <span className="text-xs text-slate-400">{openQuotes.length}</span>
          </div>
          <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
            {openQuotes.map(q => (
              <div
                key={q.id}
                className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => onNavigate(`/quotes/${q.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-700">
                    {(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}
                  </span>
                  {q.title && <span className="text-slate-500 ml-1">— {q.title}</span>}
                  <span className="text-slate-500 ml-2">{fmt.format(Number(q.total ?? 0))}</span>
                  {showLocation && q.locationId && locMap.get(q.locationId) && (
                    <p className="text-slate-400 text-xs truncate">{locMap.get(q.locationId)}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-xs capitalize flex-shrink-0 ml-2">
                  {q.status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Location-Scope Workspace Tab Components
// ═══════════════════════════════════════════════════════════════════════════════

{/* Part C: Unified job rows via shared JobRow component */}
function LocJobsTab({ jobs, onNavigate }: { jobs: Job[]; onNavigate: (p: string) => void }) {
  // Default filter is "all" — Active Work has its own dedicated tab
  // (2026-04-18 refinement).
  const [filter, setFilter] = useState<JobFilter>("all");
  const counts = useMemo(() => ({
    active: jobs.filter(isJobActive).length,
    all: jobs.length,
    completed: jobs.filter(isJobCompleted).length,
  }), [jobs]);
  const filtered = useMemo(() => {
    if (filter === "active") return jobs.filter(isJobActive);
    if (filter === "completed") return jobs.filter(isJobCompleted);
    return jobs;
  }, [jobs, filter]);

  if (jobs.length === 0) return <EmptyState label="No jobs for this location" />;
  return (
    <div>
      <FilterChips<JobFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "active", label: "Active", count: counts.active },
          { key: "all", label: "All", count: counts.all },
          { key: "completed", label: "Complete", count: counts.completed },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No jobs in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(j => (
            <JobRow key={j.id} job={j} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function LocInvoicesTab({ invoices, onNavigate }: { invoices: Invoice[]; onNavigate: (p: string) => void }) {
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const counts = useMemo(() => ({
    all: invoices.filter(i => matchInvoiceFilter(i, "all")).length,
    draft: invoices.filter(i => matchInvoiceFilter(i, "draft")).length,
    awaiting: invoices.filter(i => matchInvoiceFilter(i, "awaiting")).length,
    paid: invoices.filter(i => matchInvoiceFilter(i, "paid")).length,
    overdue: invoices.filter(i => matchInvoiceFilter(i, "overdue")).length,
  }), [invoices]);
  const filtered = useMemo(() => invoices.filter(i => matchInvoiceFilter(i, filter)), [invoices, filter]);

  if (invoices.length === 0) return <EmptyState label="No invoices for this location" />;
  return (
    <div>
      <FilterChips<InvoiceFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "awaiting", label: "Awaiting", count: counts.awaiting },
          { key: "paid", label: "Paid", count: counts.paid },
          { key: "overdue", label: "Overdue", count: counts.overdue },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No invoices in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(inv => (
            <div key={inv.id} className="flex items-center justify-between py-2 px-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => onNavigate(`/invoices/${inv.id}`)}>
              <div>
                <div className="font-medium text-slate-700">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</div>
                <div className="text-slate-400 text-xs">{inv.issueDate ? format(new Date(inv.issueDate), "MMM dd, yyyy") : ""}</div>
              </div>
              <div className="text-right">
                {(() => {
                  const badge = getInvoiceStatusBadge(inv.status, false);
                  return <Badge variant={badge.variant} className="text-xs flex-shrink-0">{badge.label}</Badge>;
                })()}
                <p className="text-slate-500 text-xs">{fmt.format(Number(inv.total ?? 0))}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LocQuotesTab({ quotes, onNavigate }: { quotes: EnrichedQuote[]; onNavigate: (p: string) => void }) {
  const [filter, setFilter] = useState<QuoteFilter>("all");
  const counts = useMemo(() => ({
    all: quotes.length,
    draft: quotes.filter(q => matchQuoteFilter(q, "draft")).length,
    sent: quotes.filter(q => matchQuoteFilter(q, "sent")).length,
    approved: quotes.filter(q => matchQuoteFilter(q, "approved")).length,
  }), [quotes]);
  const filtered = useMemo(() => quotes.filter(q => matchQuoteFilter(q, filter)), [quotes, filter]);

  if (quotes.length === 0) return <EmptyState label="No quotes for this location" />;
  return (
    <div>
      <FilterChips<QuoteFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "sent", label: "Sent", count: counts.sent },
          { key: "approved", label: "Approved", count: counts.approved },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No quotes in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(q => (
            <div key={q.id} className="flex items-center justify-between py-2 px-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => onNavigate(`/quotes/${q.id}`)}>
              <div>
                <div className="font-medium text-slate-700">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}{q.title ? ` — ${q.title}` : ""}</div>
                <div className="text-slate-400 text-xs">{q.updatedAt ? format(new Date(q.updatedAt), "MMM dd, yyyy") : ""}</div>
              </div>
              <div className="text-right">
                <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{q.status}</Badge>
                <p className="text-slate-500 text-xs">{fmt.format(Number(q.total ?? 0))}</p>
              </div>
            </div>
          ))}
        </div>
      )}
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
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">Equipment</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{equipment.length} units</span>
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onAdd}>
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
                  <div className="text-slate-400 text-xs">{eq.equipmentType || "—"}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(eq.id); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {eq.manufacturer || ""} {eq.modelNumber || ""} {(eq.manufacturer || eq.modelNumber) && eq.serialNumber ? "•" : ""} S/N: {eq.serialNumber || "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Show archived toggle */}
      <button onClick={() => setShowArchived(v => !v)}
        className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors">
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
                  <div className="text-slate-400 text-xs">{eq.equipmentType || "—"}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs px-1 py-0">Archived</Badge>
                  <Button variant="outline" size="sm" className="h-5 text-xs px-2"
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
        <p className="text-xs text-slate-400 mt-1">No archived equipment</p>
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
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-slate-600">PM Parts</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{pmParts.length} items</span>
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onAdd}>
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
                {p.itemSku && <div className="text-slate-400 text-xs">{p.itemSku}</div>}
              </div>
              <span className="text-slate-500 font-medium text-xs">x{p.quantityPerVisit}</span>
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

/** Company-wide Jobs tab with Active/All/Complete filters (2026-04-18).
 *  Default filter is "all" — Active Work has its own dedicated tab. */
function ClientAllJobsTab({ jobs, locations, onNavigate }: { jobs: Job[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const [filter, setFilter] = useState<JobFilter>("all");
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  const nonArchived = useMemo(() => jobs.filter(j => j.status !== "archived"), [jobs]);
  const counts = useMemo(() => ({
    active: nonArchived.filter(isJobActive).length,
    all: nonArchived.length,
    completed: nonArchived.filter(isJobCompleted).length,
  }), [nonArchived]);
  const filtered = useMemo(() => {
    if (filter === "active") return nonArchived.filter(isJobActive);
    if (filter === "completed") return nonArchived.filter(isJobCompleted);
    return nonArchived;
  }, [nonArchived, filter]);

  if (jobs.length === 0) return <EmptyState label="No jobs for this client" />;
  return (
    <div>
      <FilterChips<JobFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "active", label: "Active", count: counts.active },
          { key: "all", label: "All", count: counts.all },
          { key: "completed", label: "Complete", count: counts.completed },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No jobs in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(j => (
            <JobRow key={j.id} job={j} locationLabel={locMap.get(j.locationId)} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientAllInvoicesTab({ invoices, locations, onNavigate }: { invoices: Invoice[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  const counts = useMemo(() => ({
    all: invoices.filter(i => matchInvoiceFilter(i, "all")).length,
    draft: invoices.filter(i => matchInvoiceFilter(i, "draft")).length,
    awaiting: invoices.filter(i => matchInvoiceFilter(i, "awaiting")).length,
    paid: invoices.filter(i => matchInvoiceFilter(i, "paid")).length,
    overdue: invoices.filter(i => matchInvoiceFilter(i, "overdue")).length,
  }), [invoices]);
  const filtered = useMemo(() => invoices.filter(i => matchInvoiceFilter(i, filter)), [invoices, filter]);

  if (invoices.length === 0) return <EmptyState label="No invoices for this client" />;
  return (
    <div>
      <FilterChips<InvoiceFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "awaiting", label: "Awaiting", count: counts.awaiting },
          { key: "paid", label: "Paid", count: counts.paid },
          { key: "overdue", label: "Overdue", count: counts.overdue },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No invoices in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(inv => (
            <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => onNavigate(`/invoices/${inv.id}`)}>
              <div>
                <span className="font-medium text-slate-700">INV #{inv.invoiceNumber || inv.id.slice(0, 6)}</span>
                <span className="text-slate-500 ml-2">{fmt.format(Number(inv.total ?? 0))}</span>
                <p className="text-slate-400 text-xs">{locMap.get(inv.locationId) || ""}</p>
              </div>
              {(() => {
                const badge = getInvoiceStatusBadge(inv.status, false);
                return <Badge variant={badge.variant} className="text-xs flex-shrink-0">{badge.label}</Badge>;
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientAllQuotesTab({ quotes, locations, onNavigate }: { quotes: EnrichedQuote[]; locations: Client[]; onNavigate: (p: string) => void }) {
  const [filter, setFilter] = useState<QuoteFilter>("all");
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, locationDisplayName(l)])), [locations]);
  const counts = useMemo(() => ({
    all: quotes.length,
    draft: quotes.filter(q => matchQuoteFilter(q, "draft")).length,
    sent: quotes.filter(q => matchQuoteFilter(q, "sent")).length,
    approved: quotes.filter(q => matchQuoteFilter(q, "approved")).length,
  }), [quotes]);
  const filtered = useMemo(() => quotes.filter(q => matchQuoteFilter(q, filter)), [quotes, filter]);

  if (quotes.length === 0) return <EmptyState label="No quotes for this client" />;
  return (
    <div>
      <FilterChips<QuoteFilter>
        value={filter}
        onChange={setFilter}
        options={[
          { key: "all", label: "All", count: counts.all },
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "sent", label: "Sent", count: counts.sent },
          { key: "approved", label: "Approved", count: counts.approved },
        ]}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No quotes in this filter</p>
      ) : (
        <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
          {filtered.map(q => (
            <div key={q.id} className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => onNavigate(`/quotes/${q.id}`)}>
              <div>
                <span className="font-medium text-slate-700">{(q as any).quoteNumber || `Q-${q.id.slice(0, 6)}`}</span>
                {q.title && <span className="text-slate-500 ml-1">— {q.title}</span>}
                <span className="text-slate-500 ml-2">{fmt.format(Number(q.total ?? 0))}</span>
                <p className="text-slate-400 text-xs">{q.locationId ? locMap.get(q.locationId) || "" : ""}</p>
              </div>
              <Badge variant="outline" className="text-xs capitalize flex-shrink-0">{q.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════════════════

/** Contact card — compact layout. Hierarchy: name (primary) →
 *  jobTitle (subtitle) → phone/email (secondary) → location labels /
 *  role badges (tertiary). Primary shown as a star icon.
 *  2026-05-03: the entire card is now the click target. The
 *  hover-revealed Pencil button was removed; users tap (or focus +
 *  Enter/Space) the card itself to open the canonical
 *  ContactFormDialog. Native `<button>` semantics provide both
 *  accessible keyboard activation and discoverability. When `onEdit`
 *  is omitted, the card renders as a plain `<div>` (no interactivity). */
function ContactCard({
  contact, onEdit, showScope = false, assignedLocationNames,
}: {
  contact: ClientContact;
  onEdit?: (c: ClientContact) => void;
  showScope?: boolean;
  /** Location names this person is assigned to (company cards only) */
  assignedLocationNames?: string[];
}) {
  const nc = normalizeContact(contact);

  // Format location names for display: "Oakville, RBC Plaza" or "Oakville, RBC Plaza +1 more"
  const MAX_VISIBLE_LOCATIONS = 2;
  const locationLabel = assignedLocationNames && assignedLocationNames.length > 0
    ? assignedLocationNames.length <= MAX_VISIBLE_LOCATIONS
      ? assignedLocationNames.join(", ")
      : `${assignedLocationNames.slice(0, MAX_VISIBLE_LOCATIONS).join(", ")} +${assignedLocationNames.length - MAX_VISIBLE_LOCATIONS} more`
    : null;

  // Body is identical between the interactive and read-only render
  // paths; we just swap the wrapper element. No nested interactive
  // elements, so the wrapping <button> stays HTML-valid.
  const body = (
    <>
      {/* Row 1: Name (+ "(jobTitle)") + primary star + scope badge.
          2026-05-03: jobTitle moved inline next to the name in
          parentheses to recover the vertical space the previous
          subtitle row took. The combined text shares one truncate
          line so very long names + long job titles still fit
          gracefully. */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-slate-900 truncate min-w-0">
          {nc.displayName}
          {nc.jobTitle && (
            <span className="font-normal text-slate-500"> ({nc.jobTitle})</span>
          )}
        </span>
        {nc.isPrimary && (
          <Star
            className="h-2.5 w-2.5 text-amber-500 fill-amber-500 flex-shrink-0"
            aria-label="Primary"
          />
        )}
        {showScope && nc.scope === "company" && (
          <Badge variant="secondary" className="text-xs px-1 py-0 flex-shrink-0">Company</Badge>
        )}
      </div>
      {/* Row 2: Phone / Email — compact inline. */}
      {(nc.phone || nc.email) && (
        <div className="flex items-center gap-3 text-muted-foreground mt-1">
          {nc.phone && <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5 text-slate-400" />{nc.phone}</span>}
          {nc.email && <span className="flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5 text-slate-400" />{nc.email}</span>}
        </div>
      )}
      {/* Row 3a: Assigned location labels (company cards) */}
      {locationLabel && (
        <div className="flex items-center gap-1 text-muted-foreground mt-1">
          <MapPin className="h-2.5 w-2.5 text-slate-400 flex-shrink-0" />
          <span className="truncate">{locationLabel}</span>
        </div>
      )}
      {/* Row 3b: Role chips — only if roles exist. */}
      {nc.roles.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {nc.roles.map(r => (
            <span
              key={r}
              className="text-xs px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 capitalize"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const baseClasses = "text-xs px-2 py-1.5 border border-slate-200 rounded-md transition-colors";

  if (!onEdit) {
    return <div className={baseClasses}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onEdit(contact)}
      title="Edit contact"
      data-testid="contact-card-edit"
      className={cn(
        baseClasses,
        "block w-full text-left cursor-pointer hover:bg-slate-50/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B054]/40 focus-visible:border-[#76B054]/60",
      )}
    >
      {body}
    </button>
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
