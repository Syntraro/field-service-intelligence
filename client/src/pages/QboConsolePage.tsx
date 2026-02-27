import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  CloudUpload,
  CloudDownload,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  FileText,
  Users,
  Filter,
  Settings,
  Save,
  ChevronDown,
  ChevronUp,
  ListTodo,
  Play,
  RotateCcw,
  Trash2,
  Plus,
  Power,
  Zap,
  TestTube2,
  Shield,
  Wifi,
  Webhook,
  Bell,
  ExternalLink,
  Info,
  Download,
  Link2,
  Package,
  Copy,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ============================================================
// TYPES
// ============================================================

interface MappingConfigStatus {
  configured: boolean;
  hasItemMappings: boolean;
  hasTaxMappings: boolean;
  missingItemMappings: string[];
  missingTaxMappings: string[];
  warnings: string[];
}

interface QboStatusResponse {
  customerCompanies: Record<string, number>;
  invoices: Record<string, number>;
  recentFailures: QboSyncEvent[];
  mappingStatus: MappingConfigStatus;
}

interface QboSyncEvent {
  id: string;
  eventType: string;
  result: string;
  customerCompanyId: string | null;
  clientLocationId: string | null;
  invoiceId: string | null;
  qboEntityId: string | null;
  qboSyncToken: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  createdAt: string;
}

interface QboEventsResponse {
  events: QboSyncEvent[];
  limit: number;
}

interface QboMappingConfig {
  serviceItemId?: string;
  materialItemId?: string;
  feeItemId?: string;
  discountItemId?: string;
  laborItemId?: string;
  miscItemId?: string;
  taxableCode?: string;
  nonTaxableCode?: string;
}

interface QboMappingConfigResponse {
  config: QboMappingConfig;
  status: MappingConfigStatus;
}

interface QboQueueJob {
  id: string;
  companyId: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  lastErrorCode: string | null;
  qboEntityId: string | null;
  enqueuedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
}

interface QboQueueStats {
  queued: number;
  running: number;
  failed: number;
  succeeded: number;
  retriable: number;
}

interface QboQueueResponse {
  jobs: QboQueueJob[];
  stats: QboQueueStats;
  limit: number;
}

interface ProcessQueueResult {
  processed: number;
  succeeded: number;
  failed: number;
  willRetry: number;
  jobs: Array<{
    jobId: string;
    entityType: string;
    entityId: string;
    action: string;
    success: boolean;
    error?: string;
    willRetry: boolean;
    attempts: number;
    maxAttempts: number;
  }>;
}

interface PreflightResult {
  qboEnabled: boolean;
  qboEnvironment: string;
  tokensConfigured: boolean;
  mappingStatus: MappingConfigStatus;
  connectivityCheck: {
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
  queueStats: QboQueueStats;
  readyToSync: boolean;
  blockers: string[];
}

interface DryRunInvoiceResult {
  success: boolean;
  invoiceId: string;
  wouldSync: boolean;
  skipReason?: string;
  payload?: Record<string, unknown>;
  validation: {
    hasCustomerRef: boolean;
    mappingValid: boolean;
    mappingWarnings: string[];
  };
  error?: string;
}

interface DryRunQueueResult {
  dryRun: boolean;
  wouldProcess: {
    queued: number;
    retriable: number;
    total: number;
  };
  queuedJobs: Array<{
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    attempts: number;
    maxAttempts: number;
  }>;
  retriableJobs: Array<{
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
  }>;
  stats: QboQueueStats;
}

interface QboWebhookEvent {
  id: string;
  realmId: string;
  qboEntityType: string;
  qboEntityId: string;
  operation: string;
  status: string;
  actionTaken: string | null;
  relatedInvoiceId: string | null;
  queueJobId: string | null;
  verificationError: string | null;
  processingError: string | null;
  receivedAt: string;
  processedAt: string | null;
}

interface QboWebhooksResponse {
  events: QboWebhookEvent[];
  limit: number;
}

interface WebhookProcessResult {
  processed: number;
  driftAlertsCreated: number;
  reconcileJobsEnqueued: number;
  ignored: number;
  errors: number;
  events: Array<{
    eventId: string;
    status: string;
    actionTaken?: string;
    error?: string;
  }>;
}

interface DriftAlert {
  invoiceId: string;
  invoiceNumber: string | null;
  qboInvoiceId: string | null;
  qboEntityId: string;
  operation: string;
  lastUpdated: string | null;
  webhookEventId: string;
  status: "pending" | "reconciled" | "ignored";
}

interface DriftAlertsResponse {
  alerts: DriftAlert[];
}

// QBO Item types
interface ParsedQBOItem {
  id: string;
  name: string;
  description?: string;
  type: string;
  active: boolean;
  unitPrice?: number;
  purchaseCost?: number;
  taxable?: boolean;
  sku?: string;
  syncToken: string;
}

interface QboItemsResponse {
  success: boolean;
  items: ParsedQBOItem[];
  totalCount?: number;
  error?: string;
}

interface LocalItem {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  sku: string | null;
  type: string;
  unitPrice: string | null;
  cost: string | null;
  isActive: boolean;
  isTaxable: boolean;
  qboItemId: string | null;
  qboSyncStatus: string;
  qboSyncError: string | null;
}

interface LocalItemsResponse {
  success: boolean;
  items: LocalItem[];
  count: number;
}

// Run aggregation types
interface SyncRun {
  syncRunId: string;
  startedAt: string;
  completedAt: string;
  eventCount: number;
  successCount: number;
  failureCount: number;
  queueJobCount: number;
  queueSuccessCount: number;
  queueFailedCount: number;
  webhookEventCount: number;
  webhookProcessedCount: number;
}

interface SyncRunsResponse {
  success: boolean;
  runs: SyncRun[];
  count: number;
}

interface SyncRunDetailResponse {
  success: boolean;
  syncRunId: string;
  stats: {
    totalEvents: number;
    successEvents: number;
    failureEvents: number;
    totalQueueJobs: number;
    successQueueJobs: number;
    failedQueueJobs: number;
    totalWebhookEvents: number;
    processedWebhookEvents: number;
  };
  events: QboSyncEvent[];
  queueJobs: QboQueueJob[];
  webhookEvents: QboWebhookEvent[];
}

// Customer import result type (mirrors server response)
interface ImportedRecord {
  qboCustomerId: string;
  displayName: string;
  type: "parent" | "child";
  action: "create" | "update" | "restore" | "skip";
  localId?: string;
  parentQboId?: string | null;
}

interface CustomerImportResult {
  success: boolean;
  dryRun: boolean;
  totals: { fetched: number; parents: number; children: number; inactiveSkipped: number };
  wouldCreate: { customerCompanies: number; clientLocations: number };
  wouldUpdate: { customerCompanies: number; clientLocations: number };
  wouldRestore: { customerCompanies: number; clientLocations: number };
  created: { customerCompanies: number; clientLocations: number };
  updated: { customerCompanies: number; clientLocations: number };
  restored: { customerCompanies: number; clientLocations: number };
  sample: ImportedRecord[];
  warnings: string[];
  error?: string;
}

// Import preflight types
interface ImportPreflightCheck { name: string; ok: boolean; detail: string }
interface ImportPreflightResult { ok: boolean; environment: string; globalReadOnly: boolean; importReadOnly: boolean; importAllowed: boolean; checks: ImportPreflightCheck[] }
interface ReadOnlyStatusResult { readOnly: boolean; importReadOnly: boolean; environment: string; importAllowed: boolean }

/** Lightweight connection check result for Step 1 */
interface ConnectionStatusResult { connected: boolean; environment: string; readOnlyMode: boolean; message: string }

/** Company info from QBO CompanyInfo API */
interface QboCompanyInfo { companyName: string; realmId: string; environment: string }

/** QBO Item for mapping dropdowns */
interface QboItem { id: string; name: string; type: string; active: boolean }

/** QBO TaxCode for mapping dropdowns */
interface QboTaxCode { id: string; name: string; taxable: boolean }

/** OAuth setup info — self-reported config and computed redirect URI */
interface OAuthSetupInfo {
  oauthConfigured: boolean;
  missing: string[];
  detectedAppOrigin: string;
  requiredRedirectUri: string;
  environment: string;
  nextSteps: string[];
}

// Error category type for suggested actions
type ErrorCategory = "auth" | "rate_limit" | "validation" | "mapping" | "conflict" | "server" | "network" | "unknown";

// ============================================================
// CONSTANTS & HELPERS
// ============================================================

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All Event Types" },
  { value: "CUSTOMER_CREATE", label: "Customer Create" },
  { value: "CUSTOMER_UPDATE", label: "Customer Update" },
  { value: "INVOICE_CREATE", label: "Invoice Create" },
  { value: "INVOICE_UPDATE", label: "Invoice Update" },
  { value: "INVOICE_READ", label: "Invoice Read" },
  { value: "PAYMENT_READ", label: "Payment Read" },
  { value: "RECONCILE_DRY_RUN", label: "Reconcile (Dry Run)" },
  { value: "RECONCILE_APPLY", label: "Reconcile (Apply)" },
  { value: "PAYMENT_CREATED_FROM_QBO", label: "Payment from QBO" },
  { value: "CUSTOMER_IMPORT", label: "Customer Import" },
];

const RESULT_OPTIONS = [
  { value: "all", label: "All Results" },
  { value: "SUCCESS", label: "Success" },
  { value: "FAILURE", label: "Failure" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "NO_CHANGES", label: "No Changes" },
];

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    NOT_SYNCED: { variant: "outline", icon: <Clock className="h-3 w-3 mr-1" /> },
    SYNCED: { variant: "default", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
    PENDING: { variant: "secondary", icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" /> },
    ERROR: { variant: "destructive", icon: <XCircle className="h-3 w-3 mr-1" /> },
  };
  const { variant, icon } = config[status] || { variant: "outline", icon: null };
  return (
    <Badge variant={variant} className="whitespace-nowrap">
      {icon}
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function ResultBadge({ result }: { result: string }) {
  const variant = result === "SUCCESS" ? "default" : result === "FAILURE" ? "destructive" : "secondary";
  return <Badge variant={variant}>{result}</Badge>;
}

function getSuggestedAction(errorCategory?: ErrorCategory, errorMessage?: string): { message: string; action: string } | null {
  if (!errorCategory && !errorMessage) return null;
  const detectedCategory = errorCategory || detectErrorCategory(errorMessage || "");
  switch (detectedCategory) {
    case "auth": return { message: "Authentication failed - QBO tokens may have expired", action: "Re-authenticate with QuickBooks Online" };
    case "rate_limit": return { message: "Rate limit exceeded - too many API calls", action: "Wait and retry later, or reduce sync batch size" };
    case "validation": return { message: "Data validation error - required fields missing or invalid", action: "Review the entity data and fix validation issues" };
    case "mapping": return { message: "QBO mapping error - item or customer not found in QBO", action: "Configure QBO item mappings in Settings below" };
    case "conflict": return { message: "Stale data conflict - entity was modified in QBO", action: "Run Reconcile to sync latest data from QBO" };
    case "server": return { message: "QBO server error - temporary outage", action: "Retry in a few minutes" };
    case "network": return { message: "Network error - connection issue", action: "Check network connectivity and retry" };
    default: return null;
  }
}

function detectErrorCategory(errorMessage: string): ErrorCategory {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("token") || msg.includes("auth") || msg.includes("401")) return "auth";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) return "rate_limit";
  if (msg.includes("not found") || msg.includes("customer") || msg.includes("item")) return "mapping";
  if (msg.includes("required") || msg.includes("invalid") || msg.includes("validation")) return "validation";
  if (msg.includes("stale") || msg.includes("conflict")) return "conflict";
  if (msg.includes("500") || msg.includes("server")) return "server";
  if (msg.includes("network") || msg.includes("connection")) return "network";
  return "unknown";
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function QboConsolePage() {
  const { toast } = useToast();
  const searchString = useSearch();

  // --- State: Setup flow ---
  const [mappingConfig, setMappingConfig] = useState<QboMappingConfig>({});
  const [customerImportResult, setCustomerImportResult] = useState<CustomerImportResult | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importConfirmText, setImportConfirmText] = useState("");
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);
  const [copiedSetup, setCopiedSetup] = useState(false);

  // --- State: Advanced section ---
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showMappingConfig, setShowMappingConfig] = useState(false);
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const [dryRunInvoiceId, setDryRunInvoiceId] = useState("");
  const [showEnableConfirm, setShowEnableConfirm] = useState(false);
  const [webhookStatusFilter, setWebhookStatusFilter] = useState("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [localItemsSyncStatus, setLocalItemsSyncStatus] = useState("all");
  const [selectedItemForLink, setSelectedItemForLink] = useState<LocalItem | null>(null);
  const [showItemLinkDialog, setShowItemLinkDialog] = useState(false);
  const [itemLinkQboId, setItemLinkQboId] = useState("");

  // ============================================================
  // QUERIES: DEFAULT (always loaded)
  // ============================================================

  // Mapping config — needed for Step 2 card
  const { data: mappingConfigData, isLoading: mappingConfigLoading } = useQuery<QboMappingConfigResponse>({
    queryKey: ["/api/qbo/mapping-config"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/mapping-config", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch mapping config");
      const data = await response.json();
      setMappingConfig(data.config || {});
      return data;
    },
  });

  // Connection status — lightweight check for Step 1 (connect card)
  const { data: connectionStatus, isLoading: connectionStatusLoading, refetch: refetchConnectionStatus } = useQuery<ConnectionStatusResult>({
    queryKey: ["/api/qbo/connection-status"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/connection-status", { credentials: "include" });
      if (!response.ok) throw new Error("Connection check failed");
      return response.json();
    },
  });

  // OAuth setup info — gates the Connect button and provides setup checklist
  const { data: oauthSetup, refetch: refetchOauthSetup } = useQuery<OAuthSetupInfo>({
    queryKey: ["/api/qbo/oauth/setup-info"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/oauth/setup-info", { credentials: "include" });
      if (!response.ok) return { oauthConfigured: false, missing: [], detectedAppOrigin: "", requiredRedirectUri: "", environment: "sandbox", nextSteps: [] };
      return response.json();
    },
  });

  // QBO company info — shows company name + realmId when connected
  const { data: companyInfo, isLoading: companyInfoLoading } = useQuery<QboCompanyInfo>({
    queryKey: ["/api/qbo/company-info"],
    enabled: connectionStatus?.connected === true,
  });

  // QBO items — for Step 2 mapping dropdowns (distinct from Advanced qboItemsData)
  const { data: mappingItems, isLoading: mappingItemsLoading } = useQuery<QboItem[]>({
    queryKey: ["/api/qbo/items"],
    enabled: connectionStatus?.connected === true,
  });

  // QBO tax codes — for Step 2 mapping dropdowns
  const { data: mappingTaxCodes, isLoading: mappingTaxCodesLoading } = useQuery<QboTaxCode[]>({
    queryKey: ["/api/qbo/taxcodes"],
    enabled: connectionStatus?.connected === true,
  });

  // Import preflight — needed for Step 3 (import gate)
  const { data: importPreflight, isLoading: importPreflightLoading, refetch: refetchImportPreflight } = useQuery<ImportPreflightResult>({
    queryKey: ["/api/qbo/preflight/import-customers"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/preflight/import-customers", { credentials: "include" });
      if (!response.ok) throw new Error("Preflight check failed");
      return response.json();
    },
  });

  // Read-only status — small, needed for safety display
  const { data: readOnlyStatus } = useQuery<ReadOnlyStatusResult>({
    queryKey: ["/api/qbo/read-only-status"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/read-only-status", { credentials: "include" });
      if (!response.ok) return { readOnly: true, importReadOnly: true, environment: "sandbox", importAllowed: true };
      return response.json();
    },
  });

  // ============================================================
  // QUERIES: ADVANCED (lazy-loaded only when section opened)
  // ============================================================

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<QboStatusResponse>({
    queryKey: ["/api/qbo/status"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/status", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch QBO status");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const eventsQueryKey = ["/api/qbo/events", eventTypeFilter, resultFilter];
  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<QboEventsResponse>({
    queryKey: eventsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (eventTypeFilter && eventTypeFilter !== "all") params.set("entityType", eventTypeFilter);
      if (resultFilter && resultFilter !== "all") params.set("result", resultFilter);
      const response = await fetch(`/api/qbo/events?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch QBO events");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const { data: preflight, isLoading: preflightLoading, refetch: refetchPreflight } = useQuery<PreflightResult>({
    queryKey: ["/api/qbo/preflight"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/preflight", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch preflight status");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const webhooksQueryKey = ["/api/qbo/webhooks", webhookStatusFilter];
  const { data: webhooksData, isLoading: webhooksLoading, refetch: refetchWebhooks } = useQuery<QboWebhooksResponse>({
    queryKey: webhooksQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (webhookStatusFilter && webhookStatusFilter !== "all") params.set("status", webhookStatusFilter);
      const response = await fetch(`/api/qbo/webhooks?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch webhooks");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const { data: driftAlertsData, isLoading: driftAlertsLoading, refetch: refetchDriftAlerts } = useQuery<DriftAlertsResponse>({
    queryKey: ["/api/qbo/drift-alerts"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/drift-alerts", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch drift alerts");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<SyncRunsResponse>({
    queryKey: ["/api/qbo/runs"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/runs?limit=20", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch runs");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const { data: runDetailData, isLoading: runDetailLoading } = useQuery<SyncRunDetailResponse>({
    queryKey: ["/api/qbo/runs", selectedRunId],
    queryFn: async () => {
      const response = await fetch(`/api/qbo/runs/${selectedRunId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch run detail");
      return response.json();
    },
    enabled: advancedOpen && !!selectedRunId,
  });

  const { data: qboItemsData, isLoading: qboItemsLoading, refetch: refetchQboItems } = useQuery<QboItemsResponse>({
    queryKey: ["/api/qbo/items", itemSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (itemSearchQuery) params.set("q", itemSearchQuery);
      const response = await fetch(`/api/qbo/items?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch QBO items");
      return response.json();
    },
    enabled: false, // Only fetch on demand
  });

  const { data: localItemsData, isLoading: localItemsLoading, refetch: refetchLocalItems } = useQuery<LocalItemsResponse>({
    queryKey: ["/api/qbo/items/local", localItemsSyncStatus],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (localItemsSyncStatus && localItemsSyncStatus !== "all") params.set("syncStatus", localItemsSyncStatus);
      const response = await fetch(`/api/qbo/items/local?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch local items");
      return response.json();
    },
    enabled: advancedOpen,
  });

  const queueQueryKey = ["/api/qbo/queue", queueStatusFilter];
  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<QboQueueResponse>({
    queryKey: queueQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (queueStatusFilter && queueStatusFilter !== "all") params.set("status", queueStatusFilter);
      const response = await fetch(`/api/qbo/queue?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch queue");
      return response.json();
    },
    enabled: advancedOpen,
  });

  // ============================================================
  // OAuth callback detection — refetch status after returning from Intuit
  // ============================================================

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const connected = params.get("connected");
    if (connected === "1") {
      toast({ title: "QuickBooks connected", description: "Your QuickBooks account has been linked." });
      refetchConnectionStatus();
      refetchImportPreflight();
      // Clean up URL params
      window.history.replaceState({}, "", window.location.pathname);
    } else if (connected === "0") {
      const error = params.get("error") || "Unknown error";
      toast({ title: "Connection failed", description: error, variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — run once on mount

  // ============================================================
  // MUTATIONS: OAuth
  // ============================================================

  const connectMutation = useMutation({
    mutationFn: async () => {
      const data = await apiRequest<{ url: string }>("/api/qbo/oauth/start");
      return data;
    },
    onSuccess: (data) => {
      // Redirect to Intuit authorization page
      window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Unable to start QuickBooks connection", description: "Please try again or contact support.", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      return apiRequest<{ ok: boolean }>("/api/qbo/oauth/disconnect", { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "QuickBooks disconnected" });
      setShowDisconnectConfirm(false);
      refetchConnectionStatus();
      refetchImportPreflight();
    },
    onError: (err: Error) => {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  // ============================================================
  // MUTATIONS: Setup flow
  // ============================================================

  const customerImportMutation = useMutation({
    mutationFn: async (payload: { dryRun: boolean; includeInactive?: boolean }) => {
      return apiRequest<CustomerImportResult>("/api/qbo/import/customers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      setCustomerImportResult(data);
      if (data.dryRun) {
        toast({ title: "Preview complete", description: `Found ${data.totals.fetched} customers in QuickBooks` });
      } else {
        const created = data.created.customerCompanies + data.created.clientLocations;
        const updated = data.updated.customerCompanies + data.updated.clientLocations;
        const restored = data.restored.customerCompanies + data.restored.clientLocations;
        toast({
          title: "Import complete",
          description: `Created ${created}, updated ${updated}, restored ${restored} records`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/qbo/events"] });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMappingConfigMutation = useMutation({
    mutationFn: async (config: QboMappingConfig) => {
      const response = await fetch("/api/qbo/mapping-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to save config");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping configuration saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/mapping-config"] });
      refetchImportPreflight();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // ============================================================
  // MUTATIONS: Advanced section
  // ============================================================

  const toggleEnabledMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean; environment?: string }) => {
      const response = await fetch("/api/qbo/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update QBO enabled status");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.qboEnabled ? "QBO sync enabled" : "QBO sync disabled",
        description: data.qboEnabled ? `Environment: ${data.qboEnvironment}` : "QBO sync has been disabled",
      });
      refetchPreflight();
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    },
  });

  const connectivityTestMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/connectivity-test", { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Connectivity test failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection successful" : "Connection failed",
        description: data.success ? `Latency: ${data.latencyMs}ms` : data.error || "Could not connect to QBO",
        variant: data.success ? "default" : "destructive",
      });
      refetchPreflight();
    },
    onError: (err: Error) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  const dryRunInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/dry-run/invoice/${id}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Dry-run failed");
      }
      return response.json() as Promise<DryRunInvoiceResult>;
    },
    onSuccess: (data) => {
      toast({
        title: data.wouldSync ? "Would sync successfully" : "Would not sync",
        description: data.wouldSync ? `Invoice ${data.invoiceId} would be synced to QBO` : data.skipReason || "See validation details",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Dry-run failed", description: err.message, variant: "destructive" });
    },
  });

  const dryRunQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/dry-run/queue/process", { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Dry-run failed");
      }
      return response.json() as Promise<DryRunQueueResult>;
    },
    onSuccess: (data) => {
      toast({
        title: "Queue dry-run complete",
        description: `Would process ${data.wouldProcess.total} jobs (${data.wouldProcess.queued} queued, ${data.wouldProcess.retriable} retriable)`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Dry-run failed", description: err.message, variant: "destructive" });
    },
  });

  const linkItemMutation = useMutation({
    mutationFn: async ({ itemId, qboItemId }: { itemId: string; qboItemId: string }) => {
      const response = await fetch("/api/qbo/items/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ itemId, qboItemId }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Link failed");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Item linked", description: "Local item linked to QBO item successfully" });
      refetchLocalItems();
      setShowItemLinkDialog(false);
      setSelectedItemForLink(null);
      setItemLinkQboId("");
    },
    onError: (err: Error) => {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    },
  });

  const createItemInQboMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetch(`/api/qbo/items/create/${itemId}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Create failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({ title: "Item created in QBO", description: `QBO Item ID: ${data.qboItemId}` });
      refetchLocalItems();
    },
    onError: (err: Error) => {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkCreateItemsMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      const response = await fetch("/api/qbo/items/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ itemIds }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Bulk create failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Items enqueued for sync",
        description: `${data.enqueuedCount} items queued, ${data.alreadySyncedCount} already synced`,
      });
      refetchLocalItems();
      refetchQueue();
    },
    onError: (err: Error) => {
      toast({ title: "Bulk create failed", description: err.message, variant: "destructive" });
    },
  });

  const processWebhooksMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/webhook/process", { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Process failed");
      }
      return response.json() as Promise<WebhookProcessResult>;
    },
    onSuccess: (data) => {
      toast({
        title: "Webhooks processed",
        description: `Processed ${data.processed}: ${data.reconcileJobsEnqueued} reconcile jobs, ${data.driftAlertsCreated} alerts, ${data.ignored} ignored`,
      });
      refetchWebhooks();
      refetchDriftAlerts();
      refetchQueue();
    },
    onError: (err: Error) => {
      toast({ title: "Process failed", description: err.message, variant: "destructive" });
    },
  });

  const reconcileDriftAlertMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const response = await fetch(`/api/qbo/drift-alerts/${eventId}/reconcile`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Reconcile failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Reconcile job enqueued",
        description: `Job ${data.jobId} created for invoice ${data.invoiceId}`,
      });
      refetchDriftAlerts();
      refetchQueue();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to enqueue reconcile", description: err.message, variant: "destructive" });
    },
  });

  const processQueueMutation = useMutation({
    mutationFn: async (limit: number = 20) => {
      const response = await fetch(`/api/qbo/queue/process?limit=${limit}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Process failed");
      }
      return response.json() as Promise<ProcessQueueResult>;
    },
    onSuccess: (data) => {
      toast({
        title: "Queue processed",
        description: `Processed ${data.processed} jobs: ${data.succeeded} succeeded, ${data.failed} failed, ${data.willRetry} will retry`,
      });
      refetchQueue();
      refetchStatus();
      refetchEvents();
    },
    onError: (err: Error) => {
      toast({ title: "Process failed", description: err.message, variant: "destructive" });
    },
  });

  const replayJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/qbo/queue/${jobId}/replay`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Replay failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Job succeeded" : "Job failed",
        description: data.success ? `Entity synced: ${data.qboEntityId || "N/A"}` : data.error || "Unknown error",
        variant: data.success ? "default" : "destructive",
      });
      refetchQueue();
      refetchStatus();
      refetchEvents();
    },
    onError: (err: Error) => {
      toast({ title: "Replay failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/qbo/queue/${jobId}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Delete failed");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Job deleted" });
      refetchQueue();
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const enqueueJobMutation = useMutation({
    mutationFn: async (payload: { entityType: string; entityId: string; action: string }) => {
      const response = await fetch("/api/qbo/queue/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Enqueue failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Job enqueued" : "Enqueue failed",
        description: data.success ? `Job ID: ${data.jobId}` : data.error,
        variant: data.success ? "default" : "destructive",
      });
      refetchQueue();
    },
    onError: (err: Error) => {
      toast({ title: "Enqueue failed", description: err.message, variant: "destructive" });
    },
  });

  const syncInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/sync/invoice/${id}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Sync failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Invoice synced" : "Sync failed",
        description: data.error || "Operation completed",
        variant: data.success ? "default" : "destructive",
      });
      refetchStatus();
      refetchEvents();
    },
    onError: (err: Error) => {
      toast({ title: "Sync error", description: err.message, variant: "destructive" });
    },
  });

  const syncWithDepsMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/sync/invoice-with-deps/${id}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Sync failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const summary = data.success
        ? `Customer: ${data.customerCompanyResult?.action || "N/A"}, Location: ${data.clientLocationResult?.action || "N/A"}, Invoice: ${data.invoiceResult?.action || "N/A"}`
        : data.error || "Operation failed";
      toast({
        title: data.success ? "Sync completed" : "Sync failed",
        description: summary,
        variant: data.success ? "default" : "destructive",
      });
      refetchStatus();
      refetchEvents();
    },
    onError: (err: Error) => {
      toast({ title: "Sync error", description: err.message, variant: "destructive" });
    },
  });

  const reconcileDryRunMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/reconcile/invoice/${id}`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Reconcile failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        const { hasDiscrepancy, balanceDifference, missingPayments, totalMissingAmount } = data.data;
        toast({
          title: hasDiscrepancy ? "Discrepancy found" : "No discrepancy",
          description: hasDiscrepancy
            ? `Balance diff: $${balanceDifference.toFixed(2)}, Missing payments: ${missingPayments.length} ($${totalMissingAmount.toFixed(2)})`
            : "Local and QBO data are in sync",
        });
      } else {
        toast({
          title: "Reconcile result",
          description: data.skipReason || data.error || "Check complete",
          variant: data.success ? "default" : "destructive",
        });
      }
      refetchEvents();
    },
    onError: (err: Error) => {
      toast({ title: "Reconcile error", description: err.message, variant: "destructive" });
    },
  });

  const reconcileApplyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/reconcile/invoice/${id}/apply`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Apply failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Payments applied" : "Apply failed",
        description: data.success
          ? `Created ${data.paymentsCreated} payment(s), total: $${data.totalAmountApplied.toFixed(2)}`
          : data.errors?.join(", ") || data.skipReason || "Operation failed",
        variant: data.success ? "default" : "destructive",
      });
      refetchStatus();
      refetchEvents();
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Apply error", description: err.message, variant: "destructive" });
    },
  });

  // ============================================================
  // DERIVED STATE
  // ============================================================

  // Step 1 uses connection-status; Step 3 uses import preflight for full gate
  const isConnected = connectionStatus?.connected ?? false;
  const isMappingConfigured = mappingConfigData?.status?.configured ?? false;
  const canImport = isConnected && isMappingConfigured && (importPreflight?.ok ?? false);
  const isProduction = connectionStatus?.environment === "production";
  const isAnyMutationPending = syncInvoiceMutation.isPending || syncWithDepsMutation.isPending || reconcileDryRunMutation.isPending || reconcileApplyMutation.isPending;

  const handleApplyConfirm = () => {
    setShowApplyConfirm(false);
    reconcileApplyMutation.mutate(invoiceId);
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings/integrations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">QuickBooks Online</h1>
          <p className="text-sm text-muted-foreground">Connect QuickBooks, map items & tax, import customers.</p>
        </div>
      </div>

      {/* How Sync Works */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">How Sync Works</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CloudUpload className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong>One-way sync:</strong> Data flows from this app to QuickBooks, not the other way.</span>
            </li>
            <li className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong>Source of truth:</strong> Make edits to invoices and customers in this app, then sync to QuickBooks.</span>
            </li>
            <li className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong>Payments:</strong> Payment status in QuickBooks does not automatically update invoices here. Use reconciliation tools below if needed.</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* SETUP SECTION — 2-column grid */}
      {/* ============================================================ */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Setup</h2>
        <div className="grid gap-4 md:grid-cols-2">

          {/* Card 1 — Step 1: Connect QuickBooks (uses /api/qbo/connection-status + OAuth setup-info) */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi className="h-4 w-4" />
                  Step 1: Connect QuickBooks
                </CardTitle>
                {connectionStatusLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : isConnected ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                ) : oauthSetup?.oauthConfigured ? (
                  <Badge variant="outline" className="text-blue-600 border-blue-300">
                    Ready
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    Setup needed
                  </Badge>
                )}
              </div>
              <CardDescription>
                Connect your QuickBooks Online account to enable syncing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Connection status message from server */}
              {connectionStatus?.message && (
                <p className="text-sm text-muted-foreground">{connectionStatus.message}</p>
              )}

              {isConnected ? (
                /* ── Connected state ── */
                <div className="space-y-3">
                  {/* QBO company details */}
                  {companyInfoLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading company info...
                    </div>
                  ) : companyInfo ? (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                      <p className="text-sm font-medium">{companyInfo.companyName}</p>
                      <p className="text-xs text-muted-foreground font-mono">Realm ID: {companyInfo.realmId}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">Connected but unable to fetch company info — token may be expired.</p>
                  )}
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {connectionStatus?.environment || "sandbox"}
                    </Badge>
                    <span>environment</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => { refetchConnectionStatus(); refetchOauthSetup(); }} disabled={connectionStatusLoading}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${connectionStatusLoading ? "animate-spin" : ""}`} />
                      Re-check
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => setShowDisconnectConfirm(true)} disabled={disconnectMutation.isPending}>
                      <Power className="h-3 w-3 mr-1" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : oauthSetup?.oauthConfigured ? (
                /* ── Config ready, not yet connected ── */
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                    {connectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4 mr-2" />
                    )}
                    Connect QuickBooks
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { refetchConnectionStatus(); refetchOauthSetup(); }} disabled={connectionStatusLoading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${connectionStatusLoading ? "animate-spin" : ""}`} />
                    Re-check
                  </Button>
                </div>
              ) : (
                /* ── Not configured ── */
                <div className="space-y-3">
                  <p className="text-sm text-amber-600">
                    QuickBooks connection is not available yet. Please contact your administrator or follow the setup guide below.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Connect QuickBooks
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { refetchConnectionStatus(); refetchOauthSetup(); setCopiedSetup(false); }} disabled={connectionStatusLoading}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${connectionStatusLoading ? "animate-spin" : ""}`} />
                      Re-check
                    </Button>
                  </div>

                  {/* Admin-only setup checklist (collapsible) */}
                  {oauthSetup && (
                    <Collapsible open={setupPanelOpen} onOpenChange={setSetupPanelOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Settings className="h-3 w-3" />
                            Setup QuickBooks Connection
                          </span>
                          {setupPanelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="rounded-md border bg-muted/30 p-3 mt-2 space-y-3 text-sm">
                          {/* Detected app info */}
                          <div>
                            <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Your App URL</p>
                            <code className="block text-xs bg-background rounded px-2 py-1 break-all">{oauthSetup.detectedAppOrigin}</code>
                          </div>
                          <div>
                            <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Required Redirect URI</p>
                            <code className="block text-xs bg-background rounded px-2 py-1 break-all">{oauthSetup.requiredRedirectUri}</code>
                          </div>

                          {/* Missing secrets */}
                          {oauthSetup.missing.length > 0 && (
                            <div>
                              <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Missing Secrets</p>
                              <ul className="list-disc pl-4 text-xs space-y-0.5">
                                {oauthSetup.missing.map((k) => <li key={k}><code>{k}</code></li>)}
                              </ul>
                            </div>
                          )}

                          {/* Step-by-step checklist */}
                          <div>
                            <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Setup Steps</p>
                            <ol className="list-decimal pl-4 text-xs space-y-1 text-muted-foreground">
                              <li>Create an app at <a href="https://developer.intuit.com" target="_blank" rel="noopener noreferrer" className="underline text-foreground">developer.intuit.com</a> — select <strong>QuickBooks Online Accounting</strong> scope.</li>
                              <li>In your Intuit app's Redirect URIs, add:<br /><code className="text-[11px] bg-background rounded px-1">{oauthSetup.requiredRedirectUri}</code></li>
                              <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from Intuit into Replit Secrets as <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code>.</li>
                              <li>Set <code>QBO_OAUTH_REDIRECT_URI</code> in Replit Secrets to:<br /><code className="text-[11px] bg-background rounded px-1">{oauthSetup.requiredRedirectUri}</code></li>
                              <li>Click <strong>Re-check</strong> above to verify configuration.</li>
                            </ol>
                          </div>

                          {/* Copy setup block */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              const block = [
                                "Required Redirect URI:",
                                oauthSetup.requiredRedirectUri,
                                "",
                                "Replit Secrets to set:",
                                `QBO_CLIENT_ID=<paste from Intuit>`,
                                `QBO_CLIENT_SECRET=<paste from Intuit>`,
                                `QBO_OAUTH_REDIRECT_URI=${oauthSetup.requiredRedirectUri}`,
                                "",
                                "Notes:",
                                "- Redirect URI must match your Intuit app settings exactly.",
                                `- Environment: ${oauthSetup.environment} (default: sandbox).`,
                              ].join("\n");
                              navigator.clipboard.writeText(block);
                              setCopiedSetup(true);
                              toast({ title: "Setup info copied to clipboard" });
                            }}
                          >
                            {copiedSetup ? (
                              <ClipboardCheck className="h-3 w-3 mr-1" />
                            ) : (
                              <Copy className="h-3 w-3 mr-1" />
                            )}
                            {copiedSetup ? "Copied!" : "Copy Setup Info"}
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2 — Step 2: Items & Tax Mapping */}
          <Card className={!isConnected ? "opacity-60 pointer-events-none" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Step 2: Items & Tax
                </CardTitle>
                {isMappingConfigured ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Complete
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    Required
                  </Badge>
                )}
              </div>
              <CardDescription>
                Map your line item types and tax codes to QuickBooks items.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Items mapping — dropdown selectors from QBO Items API */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Mapping</p>
                {mappingItemsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading QBO items...
                  </div>
                ) : !mappingItems?.length ? (
                  <p className="text-xs text-amber-600">No items found in QBO — create items in QuickBooks first.</p>
                ) : (
                  <div className="grid gap-2">
                    {([
                      { key: "serviceItemId", label: "Service" },
                      { key: "laborItemId", label: "Labor" },
                      { key: "materialItemId", label: "Material" },
                      { key: "feeItemId", label: "Fee" },
                      { key: "discountItemId", label: "Discount" },
                      { key: "miscItemId", label: "Misc" },
                    ] as { key: keyof QboMappingConfig; label: string }[]).map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Label className="w-20 text-xs text-right shrink-0">{label}</Label>
                        <Select
                          value={mappingConfig[key] || ""}
                          onValueChange={(val) => setMappingConfig(prev => ({ ...prev, [key]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder={`Select ${label.toLowerCase()} item`} />
                          </SelectTrigger>
                          <SelectContent>
                            {mappingItems.map((item) => (
                              <SelectItem key={item.id} value={item.id} className="text-xs">
                                {item.name} <span className="text-muted-foreground ml-1">({item.type})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {mappingConfig[key] ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : (
                          <div className="h-3.5 w-3.5 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Tax mapping — dropdown selectors from QBO TaxCode API */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tax Codes</p>
                {mappingTaxCodesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading QBO tax codes...
                  </div>
                ) : !mappingTaxCodes?.length ? (
                  <p className="text-xs text-amber-600">No tax codes found in QBO.</p>
                ) : (
                  <div className="grid gap-2">
                    {([
                      { key: "taxableCode", label: "Taxable" },
                      { key: "nonTaxableCode", label: "Non-taxable" },
                    ] as { key: keyof QboMappingConfig; label: string }[]).map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Label className="w-20 text-xs text-right shrink-0">{label}</Label>
                        <Select
                          value={mappingConfig[key] || ""}
                          onValueChange={(val) => setMappingConfig(prev => ({ ...prev, [key]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder={`Select ${label.toLowerCase()} code`} />
                          </SelectTrigger>
                          <SelectContent>
                            {mappingTaxCodes.map((tc) => (
                              <SelectItem key={tc.id} value={tc.id} className="text-xs">
                                {tc.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {mappingConfig[key] ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : (
                          <div className="h-3.5 w-3.5 shrink-0" />
                        )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              {/* Missing items warning */}
              {mappingConfigData?.status && !mappingConfigData.status.configured && (
                <p className="text-xs text-amber-600">
                  Missing: {[...mappingConfigData.status.missingItemMappings, ...mappingConfigData.status.missingTaxMappings].join(", ")}
                </p>
              )}
              <Button
                size="sm"
                onClick={() => saveMappingConfigMutation.mutate(mappingConfig)}
                disabled={saveMappingConfigMutation.isPending}
              >
                {saveMappingConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Mapping
              </Button>
            </CardContent>
          </Card>

          {/* Card 3 — Step 3: Import Customers */}
          <Card className={!canImport && !customerImportResult ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Step 3: Import Customers
                </CardTitle>
                {importPreflight?.importReadOnly && (
                  <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">
                    <Shield className="h-3 w-3 mr-1" />
                    Read-only
                  </Badge>
                )}
              </div>
              <CardDescription>
                Pull customers from QuickBooks into your account. Parent customers become companies; sub-customers become locations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Gating messages */}
              {!isConnected && (
                <p className="text-sm text-muted-foreground">Connect QuickBooks first to enable import.</p>
              )}
              {isConnected && !isMappingConfigured && (
                <p className="text-sm text-amber-600">Finish Items & Tax setup to enable customer import.</p>
              )}
              {isProduction && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Import Blocked</AlertTitle>
                  <AlertDescription>Customer import is disabled in the production environment.</AlertDescription>
                </Alert>
              )}

              {/* Action buttons */}
              {canImport && !isProduction && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => customerImportMutation.mutate({ dryRun: true })}
                    disabled={customerImportMutation.isPending}
                  >
                    {customerImportMutation.isPending && customerImportMutation.variables?.dryRun ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube2 className="h-4 w-4 mr-2" />
                    )}
                    Preview Import
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => { setImportConfirmText(""); setShowImportConfirm(true); }}
                    disabled={customerImportMutation.isPending}
                  >
                    {customerImportMutation.isPending && !customerImportMutation.variables?.dryRun ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Run Import
                  </Button>
                </div>
              )}

              {/* Import Results */}
              {customerImportResult && (
                <div className="space-y-3 pt-2">
                  <Alert variant={customerImportResult.success ? "default" : "destructive"}>
                    <AlertTitle>
                      {customerImportResult.dryRun ? "Preview Results" : "Import Complete"}
                    </AlertTitle>
                    <AlertDescription>
                      <div className="mt-2 space-y-1 text-sm">
                        <div>Found <strong>{customerImportResult.totals.fetched}</strong> customers in QuickBooks</div>
                        <div>
                          Companies: <strong>{customerImportResult.totals.parents}</strong>{" "}
                          | Locations: <strong>{customerImportResult.totals.children}</strong>
                          {customerImportResult.totals.inactiveSkipped > 0 && (
                            <> | Inactive skipped: <strong>{customerImportResult.totals.inactiveSkipped}</strong></>
                          )}
                        </div>
                        {customerImportResult.dryRun ? (
                          <div className="mt-1">
                            Would create: <strong>{customerImportResult.wouldCreate.customerCompanies}</strong> companies, <strong>{customerImportResult.wouldCreate.clientLocations}</strong> locations
                            {" | "}Would update: <strong>{customerImportResult.wouldUpdate.customerCompanies}</strong> companies, <strong>{customerImportResult.wouldUpdate.clientLocations}</strong> locations
                            {(customerImportResult.wouldRestore.customerCompanies > 0 || customerImportResult.wouldRestore.clientLocations > 0) && (
                              <>{" | "}Would restore: <strong>{customerImportResult.wouldRestore.customerCompanies}</strong> companies, <strong>{customerImportResult.wouldRestore.clientLocations}</strong> locations</>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1">
                            Created: <strong>{customerImportResult.created.customerCompanies}</strong> companies, <strong>{customerImportResult.created.clientLocations}</strong> locations
                            {" | "}Updated: <strong>{customerImportResult.updated.customerCompanies}</strong> companies, <strong>{customerImportResult.updated.clientLocations}</strong> locations
                            {(customerImportResult.restored.customerCompanies > 0 || customerImportResult.restored.clientLocations > 0) && (
                              <>{" | "}Restored: <strong>{customerImportResult.restored.customerCompanies}</strong> companies, <strong>{customerImportResult.restored.clientLocations}</strong> locations</>
                            )}
                          </div>
                        )}
                        {customerImportResult.error && (
                          <div className="text-destructive mt-1">{customerImportResult.error}</div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>

                  {customerImportResult.warnings.length > 0 && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Warnings ({customerImportResult.warnings.length})</AlertTitle>
                      <AlertDescription>
                        <ul className="mt-1 text-xs space-y-1 list-disc pl-4">
                          {customerImportResult.warnings.slice(0, 10).map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                          {customerImportResult.warnings.length > 10 && (
                            <li>...and {customerImportResult.warnings.length - 10} more</li>
                          )}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}

                  {customerImportResult.sample.length > 0 && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerImportResult.sample.map((rec) => (
                            <TableRow key={rec.qboCustomerId}>
                              <TableCell>
                                <Badge variant={rec.type === "parent" ? "default" : "secondary"} className="text-xs">
                                  {rec.type === "parent" ? "Company" : "Location"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">{rec.displayName}</TableCell>
                              <TableCell>
                                <Badge variant={rec.action === "create" ? "default" : rec.action === "restore" ? "secondary" : "outline"} className="text-xs">
                                  {rec.action}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 4 — Step 4: Invoice Sync */}
          <Card className="opacity-80">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <CloudUpload className="h-4 w-4" />
                  Step 4: Invoice Sync
                </CardTitle>
                <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
              </div>
              <CardDescription>
                Automatically sync invoices to QuickBooks when they are marked as completed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Invoice sync is being finalized. Once enabled, completed invoices will automatically push to QuickBooks with their line items, tax, and customer references.
              </p>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ============================================================ */}
      {/* ADVANCED SECTION — Collapsed by default, lazy-loads queries */}
      {/* ============================================================ */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between py-3 px-4 text-muted-foreground hover:text-foreground">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Settings className="h-4 w-4" />
              Advanced (Support / Admin)
            </span>
            {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-2">

          {/* Refresh button for advanced data */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchStatus(); refetchEvents(); refetchPreflight(); }}
              disabled={statusLoading || eventsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${statusLoading || eventsLoading ? "animate-spin" : ""}`} />
              Refresh Advanced Data
            </Button>
          </div>

          {/* Go Live Panel */}
          <Card className={preflight?.qboEnabled ? "border-green-500/50" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  <div>
                    <CardTitle className="text-lg">QBO Go-Live Status</CardTitle>
                    <CardDescription>Requirements and controls for enabling QuickBooks sync</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchPreflight()} disabled={preflightLoading}>
                    <RefreshCw className={`h-4 w-4 ${preflightLoading ? "animate-spin" : ""}`} />
                  </Button>
                  {preflight?.qboEnabled ? (
                    <Badge variant="default" className="bg-green-600">
                      <Power className="h-3 w-3 mr-1" />
                      Enabled
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <Power className="h-3 w-3 mr-1" />
                      Disabled
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            {preflight && (
              <CardContent className="space-y-4">
                {/* Preflight Checklist */}
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="flex items-center gap-2 text-sm">
                    {preflight.tokensConfigured ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                    QBO tokens configured
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {preflight.connectivityCheck.success ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                    API connectivity {preflight.connectivityCheck.latencyMs && `(${preflight.connectivityCheck.latencyMs}ms)`}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {preflight.mappingStatus.configured ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                    Item/tax mappings configured
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Info className="h-4 w-4 text-blue-500" />
                    Environment: {preflight.qboEnvironment}
                  </div>
                </div>

                {preflight.blockers.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Blockers</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 text-xs list-disc pl-4">
                        {preflight.blockers.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => connectivityTestMutation.mutate()}
                    disabled={connectivityTestMutation.isPending}
                  >
                    {connectivityTestMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wifi className="h-4 w-4 mr-2" />}
                    Test Connection
                  </Button>
                  {preflight.qboEnabled ? (
                    <Button variant="outline" size="sm" onClick={() => toggleEnabledMutation.mutate({ enabled: false })} disabled={toggleEnabledMutation.isPending}>
                      <Power className="h-4 w-4 mr-2" />
                      Disable QBO Sync
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setShowEnableConfirm(true)} disabled={!preflight.readyToSync || toggleEnabledMutation.isPending}>
                      <Zap className="h-4 w-4 mr-2" />
                      Enable QBO Sync
                    </Button>
                  )}
                </div>

                {/* Dry-Run Section */}
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-medium">Dry-Run Testing</p>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label htmlFor="dryRunInvoiceId" className="text-xs">Invoice ID</Label>
                      <Input id="dryRunInvoiceId" placeholder="UUID" value={dryRunInvoiceId} onChange={(e) => setDryRunInvoiceId(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => dryRunInvoiceMutation.mutate(dryRunInvoiceId)} disabled={!dryRunInvoiceId || dryRunInvoiceMutation.isPending}>
                      {dryRunInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube2 className="h-4 w-4 mr-1" />}
                      Dry-Run Invoice
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => dryRunQueueMutation.mutate()} disabled={dryRunQueueMutation.isPending}>
                      {dryRunQueueMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TestTube2 className="h-4 w-4 mr-1" />}
                      Dry-Run Queue
                    </Button>
                  </div>

                  {dryRunInvoiceMutation.data && (
                    <Alert className="text-xs">
                      <AlertTitle>{dryRunInvoiceMutation.data.wouldSync ? "Would sync" : "Would not sync"}</AlertTitle>
                      <AlertDescription>
                        {dryRunInvoiceMutation.data.skipReason && <p>Reason: {dryRunInvoiceMutation.data.skipReason}</p>}
                        <p>Customer ref: {dryRunInvoiceMutation.data.validation.hasCustomerRef ? "yes" : "no"} | Mapping valid: {dryRunInvoiceMutation.data.validation.mappingValid ? "yes" : "no"}</p>
                        {dryRunInvoiceMutation.data.validation.mappingWarnings.length > 0 && (
                          <p>Warnings: {dryRunInvoiceMutation.data.validation.mappingWarnings.join(", ")}</p>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {dryRunQueueMutation.data && (
                    <Alert className="text-xs">
                      <AlertTitle>Queue Preview</AlertTitle>
                      <AlertDescription>
                        Would process: {dryRunQueueMutation.data.wouldProcess.total} ({dryRunQueueMutation.data.wouldProcess.queued} queued, {dryRunQueueMutation.data.wouldProcess.retriable} retriable)
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Mapping Configuration (expandable) */}
          {!showMappingConfig ? (
            <Button variant="outline" size="sm" onClick={() => setShowMappingConfig(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Show Mapping Configuration
            </Button>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Mapping Configuration</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowMappingConfig(false)}>Hide</Button>
                </div>
                <CardDescription>Map app line item types to QBO Item IDs and tax codes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {([
                    { key: "serviceItemId", label: "Service Item ID" },
                    { key: "laborItemId", label: "Labor Item ID" },
                    { key: "materialItemId", label: "Material Item ID" },
                    { key: "feeItemId", label: "Fee Item ID" },
                    { key: "discountItemId", label: "Discount Item ID" },
                    { key: "miscItemId", label: "Misc Item ID" },
                    { key: "taxableCode", label: "Taxable Code" },
                    { key: "nonTaxableCode", label: "Non-Taxable Code" },
                  ] as { key: keyof QboMappingConfig; label: string }[]).map(({ key, label }) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <Input
                        className="h-8 text-xs mt-1"
                        value={mappingConfig[key] || ""}
                        onChange={(e) => setMappingConfig(prev => ({ ...prev, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  onClick={() => saveMappingConfigMutation.mutate(mappingConfig)}
                  disabled={saveMappingConfigMutation.isPending}
                >
                  {saveMappingConfigMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Configuration
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Status Dashboard */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Customer Companies</CardTitle>
              </CardHeader>
              <CardContent>
                {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : status ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(status.customerCompanies).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                        <span className="font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No data</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Invoices</CardTitle>
              </CardHeader>
              <CardContent>
                {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : status ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(status.invoices).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                        <span className="font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No data</p>}
              </CardContent>
            </Card>
          </div>

          {/* Recent Failures */}
          {status?.recentFailures && status.recentFailures.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Recent Failures ({status.recentFailures.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Suggested Action</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {status.recentFailures.slice(0, 10).map((event) => {
                        const suggestion = getSuggestedAction(undefined, event.errorMessage || undefined);
                        return (
                          <TableRow key={event.id}>
                            <TableCell><Badge variant="outline" className="text-xs">{event.eventType}</Badge></TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{event.errorMessage || "Unknown"}</TableCell>
                            <TableCell className="text-xs max-w-[200px]">{suggestion?.action || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Invoice Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Invoice Sync Actions</CardTitle>
              <CardDescription>Enter an invoice ID to perform sync or reconciliation operations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label htmlFor="invoiceId">Invoice ID</Label>
                  <Input id="invoiceId" placeholder="Enter invoice ID (UUID)" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => syncInvoiceMutation.mutate(invoiceId)} disabled={!invoiceId || isAnyMutationPending}>
                  {syncInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudUpload className="h-4 w-4 mr-2" />}
                  Sync Invoice
                </Button>
                <Button variant="outline" onClick={() => syncWithDepsMutation.mutate(invoiceId)} disabled={!invoiceId || isAnyMutationPending}>
                  {syncWithDepsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudUpload className="h-4 w-4 mr-2" />}
                  Sync with Dependencies
                </Button>
                <Button variant="outline" onClick={() => reconcileDryRunMutation.mutate(invoiceId)} disabled={!invoiceId || isAnyMutationPending}>
                  {reconcileDryRunMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Reconcile (Preview)
                </Button>
                <Button variant="destructive" onClick={() => setShowApplyConfirm(true)} disabled={!invoiceId || isAnyMutationPending}>
                  {reconcileApplyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                  Reconcile (Apply)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sync Queue */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><ListTodo className="h-5 w-5" /> Sync Queue</CardTitle>
                  <CardDescription>Manage queued sync jobs</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchQueue()} disabled={queueLoading}>
                    <RefreshCw className={`h-4 w-4 ${queueLoading ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" onClick={() => processQueueMutation.mutate(20)} disabled={processQueueMutation.isPending}>
                    {processQueueMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                    Process Queue
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {queueData?.stats && (
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>Queued: <strong>{queueData.stats.queued}</strong></span>
                  <span>Running: <strong>{queueData.stats.running}</strong></span>
                  <span>Failed: <strong className="text-destructive">{queueData.stats.failed}</strong></span>
                  <span>Succeeded: <strong className="text-green-600">{queueData.stats.succeeded}</strong></span>
                  <span>Retriable: <strong>{queueData.stats.retriable}</strong></span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Select value={queueStatusFilter} onValueChange={setQueueStatusFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="succeeded">Succeeded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {queueLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : queueData?.jobs.length ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queueData.jobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-xs">{job.entityType}</Badge>
                            <div className="text-xs text-muted-foreground mt-0.5 font-mono truncate max-w-[120px]">{job.entityId}</div>
                          </TableCell>
                          <TableCell className="text-xs">{job.action}</TableCell>
                          <TableCell><StatusBadge status={job.status.toUpperCase()} /></TableCell>
                          <TableCell className="text-xs">{job.attempts}/{job.maxAttempts}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{job.lastError || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => replayJobMutation.mutate(job.id)} disabled={replayJobMutation.isPending} title="Replay">
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteJobMutation.mutate(job.id)} disabled={deleteJobMutation.isPending} title="Delete">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No queue jobs</p>}
            </CardContent>
          </Card>

          {/* Recent Runs */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Recent Sync Runs</CardTitle>
                <Button variant="outline" size="sm" onClick={() => refetchRuns()} disabled={runsLoading}>
                  <RefreshCw className={`h-4 w-4 ${runsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {runsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : runsData?.runs.length ? (
                <div className="space-y-2">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Run ID</TableHead>
                          <TableHead>Events</TableHead>
                          <TableHead>Queue Jobs</TableHead>
                          <TableHead>Started</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {runsData.runs.map((run) => (
                          <TableRow key={run.syncRunId} className={selectedRunId === run.syncRunId ? "bg-muted/50" : ""}>
                            <TableCell className="font-mono text-xs">{run.syncRunId.slice(0, 20)}...</TableCell>
                            <TableCell className="text-xs">
                              <span className="text-green-600">{run.successCount}</span> / <span className="text-destructive">{run.failureCount}</span> / {run.eventCount}
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className="text-green-600">{run.queueSuccessCount}</span> / <span className="text-destructive">{run.queueFailedCount}</span> / {run.queueJobCount}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateTime(run.startedAt)}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedRunId(selectedRunId === run.syncRunId ? null : run.syncRunId)}>
                                {selectedRunId === run.syncRunId ? "Hide" : "Details"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {selectedRunId && runDetailData && (
                    <Card className="border-dashed">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Run Detail: {selectedRunId.slice(0, 24)}...</CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div>Events: {runDetailData.stats.successEvents}/{runDetailData.stats.totalEvents}</div>
                          <div>Queue: {runDetailData.stats.successQueueJobs}/{runDetailData.stats.totalQueueJobs}</div>
                          <div>Webhooks: {runDetailData.stats.processedWebhookEvents}/{runDetailData.stats.totalWebhookEvents}</div>
                        </div>
                        {runDetailData.events.filter(e => e.result === "FAILURE").length > 0 && (
                          <div>
                            <p className="font-medium text-destructive">Failed Events:</p>
                            {runDetailData.events.filter(e => e.result === "FAILURE").map(e => {
                              const suggestion = getSuggestedAction(undefined, e.errorMessage || undefined);
                              return (
                                <div key={e.id} className="pl-2 border-l-2 border-destructive mt-1">
                                  <p>{e.eventType}: {e.errorMessage}</p>
                                  {suggestion && <p className="text-muted-foreground italic">{suggestion.action}</p>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : <p className="text-sm text-muted-foreground">No sync runs</p>}
            </CardContent>
          </Card>

          {/* Webhooks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><Webhook className="h-5 w-5" /> Webhooks</CardTitle>
                  <CardDescription>Incoming QBO webhook events</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchWebhooks()} disabled={webhooksLoading}>
                    <RefreshCw className={`h-4 w-4 ${webhooksLoading ? "animate-spin" : ""}`} />
                  </Button>
                  <Button size="sm" onClick={() => processWebhooksMutation.mutate()} disabled={processWebhooksMutation.isPending}>
                    {processWebhooksMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                    Process
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-3">
                <Select value={webhookStatusFilter} onValueChange={setWebhookStatusFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="processed">Processed</SelectItem>
                    <SelectItem value="ignored">Ignored</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {webhooksLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : webhooksData?.events.length ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Operation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {webhooksData.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="text-xs">{event.qboEntityType} {event.qboEntityId}</TableCell>
                          <TableCell className="text-xs">{event.operation}</TableCell>
                          <TableCell><Badge variant={event.status === "processed" ? "default" : event.status === "pending" ? "secondary" : "outline"} className="text-xs">{event.status}</Badge></TableCell>
                          <TableCell className="text-xs">{event.actionTaken || "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTime(event.receivedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No webhook events</p>}
            </CardContent>
          </Card>

          {/* Drift Alerts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><Bell className="h-5 w-5" /> Drift Alerts</CardTitle>
                  <CardDescription>Invoices modified in QBO that may need reconciliation</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchDriftAlerts()} disabled={driftAlertsLoading}>
                  <RefreshCw className={`h-4 w-4 ${driftAlertsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {driftAlertsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : driftAlertsData?.alerts.length ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>QBO Entity</TableHead>
                        <TableHead>Operation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driftAlertsData.alerts.map((alert) => (
                        <TableRow key={alert.webhookEventId}>
                          <TableCell className="text-xs">
                            {alert.invoiceNumber || alert.invoiceId?.slice(0, 8) || "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{alert.qboEntityId}</TableCell>
                          <TableCell className="text-xs">{alert.operation}</TableCell>
                          <TableCell>
                            <Badge variant={alert.status === "pending" ? "secondary" : alert.status === "reconciled" ? "default" : "outline"} className="text-xs">
                              {alert.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {alert.status === "pending" && (
                              <Button
                                variant="outline" size="sm" className="h-7 text-xs"
                                onClick={() => reconcileDriftAlertMutation.mutate(alert.webhookEventId)}
                                disabled={reconcileDriftAlertMutation.isPending}
                              >
                                Reconcile
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No drift alerts</p>}
            </CardContent>
          </Card>

          {/* QBO Items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2"><Package className="h-5 w-5" /> QBO Items</CardTitle>
                  <CardDescription>Link local items to QuickBooks items</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchLocalItems()} disabled={localItemsLoading}>
                  <RefreshCw className={`h-4 w-4 ${localItemsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {localItemsData?.items && (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>Total: <strong>{localItemsData.count}</strong></span>
                    <span>Synced: <strong className="text-green-600">{localItemsData.items.filter(i => i.qboSyncStatus === "SYNCED").length}</strong></span>
                    <span>Not synced: <strong>{localItemsData.items.filter(i => i.qboSyncStatus === "NOT_SYNCED").length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={localItemsSyncStatus} onValueChange={setLocalItemsSyncStatus}>
                      <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Items</SelectItem>
                        <SelectItem value="SYNCED">Synced</SelectItem>
                        <SelectItem value="NOT_SYNCED">Not Synced</SelectItem>
                        <SelectItem value="ERROR">Error</SelectItem>
                      </SelectContent>
                    </Select>
                    {localItemsData.items.filter(i => !i.qboItemId).length > 0 && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => bulkCreateItemsMutation.mutate(localItemsData.items.filter(i => !i.qboItemId).map(i => i.id))}
                        disabled={bulkCreateItemsMutation.isPending}
                      >
                        {bulkCreateItemsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        Bulk Create in QBO
                      </Button>
                    )}
                  </div>
                </>
              )}

              {localItemsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : localItemsData?.items.length ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>QBO Status</TableHead>
                        <TableHead>QBO ID</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {localItemsData.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm">{item.name}</TableCell>
                          <TableCell className="text-xs">{item.type}</TableCell>
                          <TableCell><StatusBadge status={item.qboSyncStatus} /></TableCell>
                          <TableCell className="text-xs font-mono">{item.qboItemId || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {!item.qboItemId && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Link to QBO item" onClick={() => { setSelectedItemForLink(item); setShowItemLinkDialog(true); }}>
                                    <Link2 className="h-3 w-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Create in QBO" onClick={() => createItemInQboMutation.mutate(item.id)} disabled={createItemInQboMutation.isPending}>
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No local items</p>}

              {/* Search QBO Items */}
              <div className="border-t pt-4 space-y-2">
                <p className="text-sm font-medium">Search QBO Items</p>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Search by name..."
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                  />
                  <Button variant="outline" size="sm" onClick={() => refetchQboItems()} disabled={qboItemsLoading}>
                    {qboItemsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  </Button>
                </div>
                {qboItemsData?.items && (
                  <div className="rounded-md border max-h-[200px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {qboItemsData.items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-xs font-mono">{item.id}</TableCell>
                            <TableCell className="text-xs">{item.name}</TableCell>
                            <TableCell className="text-xs">{item.type}</TableCell>
                            <TableCell className="text-xs">{item.unitPrice != null ? `$${item.unitPrice}` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Sync Events Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Sync Events</CardTitle>
                <Button variant="outline" size="sm" onClick={() => refetchEvents()} disabled={eventsLoading}>
                  <RefreshCw className={`h-4 w-4 ${eventsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                  <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={resultFilter} onValueChange={setResultFilter}>
                  <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESULT_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {eventsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : eventsData?.events.length ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>QBO Entity</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventsData.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell><Badge variant="outline" className="text-xs">{event.eventType}</Badge></TableCell>
                          <TableCell><ResultBadge result={event.result} /></TableCell>
                          <TableCell className="text-xs font-mono">{event.qboEntityId || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{event.errorMessage || "—"}</TableCell>
                          <TableCell className="text-xs">{event.durationMs ? `${event.durationMs}ms` : "—"}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="text-sm text-muted-foreground">No events</p>}
            </CardContent>
          </Card>

        </CollapsibleContent>
      </Collapsible>

      {/* ============================================================ */}
      {/* DIALOGS */}
      {/* ============================================================ */}

      {/* Apply Confirmation Dialog */}
      <AlertDialog open={showApplyConfirm} onOpenChange={setShowApplyConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply Reconciliation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create local payment records based on QBO payment data.
              This action modifies your local data and cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyConfirm}>
              Apply Payments
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enable QBO Confirmation Dialog */}
      <AlertDialog open={showEnableConfirm} onOpenChange={setShowEnableConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable QuickBooks Sync?</AlertDialogTitle>
            <AlertDialogDescription>
              This will allow syncing data from this app to QuickBooks Online.
              Make sure your item/tax mappings are configured correctly.
              {preflight?.qboEnvironment === "production" && (
                <span className="block mt-2 text-destructive font-medium">
                  Warning: You are connecting to the PRODUCTION QuickBooks environment.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowEnableConfirm(false);
              toggleEnabledMutation.mutate({ enabled: true, environment: preflight?.qboEnvironment });
            }}>
              Enable Sync to QuickBooks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Customers Confirmation Dialog — requires typing IMPORT to proceed */}
      <AlertDialog open={showImportConfirm} onOpenChange={(open) => { setShowImportConfirm(open); if (!open) setImportConfirmText(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Customers from QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will create or update Customer Companies and Locations in your account
                  based on QuickBooks customer data. No data will be written to QuickBooks.
                </p>
                {importPreflight?.environment === "production" && (
                  <p className="text-destructive font-medium">
                    Warning: Connected to production QuickBooks environment.
                  </p>
                )}
                {customerImportResult?.dryRun && customerImportResult.totals.fetched > 0 && (
                  <p>
                    Based on the preview: <strong>{customerImportResult.wouldCreate.customerCompanies + customerImportResult.wouldCreate.clientLocations}</strong> new records
                    and <strong>{customerImportResult.wouldUpdate.customerCompanies + customerImportResult.wouldUpdate.clientLocations}</strong> updates.
                  </p>
                )}
                <div>
                  <Label htmlFor="importConfirmInput" className="text-sm font-medium">
                    Type <strong>IMPORT</strong> to confirm:
                  </Label>
                  <Input
                    id="importConfirmInput"
                    value={importConfirmText}
                    onChange={(e) => setImportConfirmText(e.target.value)}
                    placeholder="IMPORT"
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={importConfirmText !== "IMPORT"}
              onClick={() => {
                setShowImportConfirm(false);
                setImportConfirmText("");
                customerImportMutation.mutate({ dryRun: false });
              }}
            >
              Import Customers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={showDisconnectConfirm} onOpenChange={setShowDisconnectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the QuickBooks connection for your account.
              Imported customers and item mappings will not be deleted.
              You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Link Item Dialog */}
      <AlertDialog open={showItemLinkDialog} onOpenChange={setShowItemLinkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link Item to QBO</AlertDialogTitle>
            <AlertDialogDescription>
              Link "{selectedItemForLink?.name}" to an existing QuickBooks Online item.
              Enter the QBO Item ID from QuickBooks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="qboItemId">QBO Item ID</Label>
            <Input
              id="qboItemId"
              placeholder="e.g., 123"
              value={itemLinkQboId}
              onChange={(e) => setItemLinkQboId(e.target.value)}
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Search for QBO items above to find the correct ID.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setItemLinkQboId("");
              setSelectedItemForLink(null);
            }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedItemForLink && itemLinkQboId) {
                  linkItemMutation.mutate({
                    itemId: selectedItemForLink.id,
                    qboItemId: itemLinkQboId,
                  });
                }
              }}
              disabled={!itemLinkQboId || linkItemMutation.isPending}
            >
              {linkItemMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Link Item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
