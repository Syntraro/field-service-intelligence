import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
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

// Types
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

// Error category type for suggested actions
type ErrorCategory = "auth" | "rate_limit" | "validation" | "mapping" | "conflict" | "server" | "network" | "unknown";

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

/**
 * Get suggested action based on error category
 */
function getSuggestedAction(errorCategory?: ErrorCategory, errorMessage?: string): { message: string; action: string } | null {
  if (!errorCategory && !errorMessage) return null;

  // Detect category from error message if not provided
  const detectedCategory = errorCategory || detectErrorCategory(errorMessage || "");

  switch (detectedCategory) {
    case "auth":
      return {
        message: "Authentication failed - QBO tokens may have expired",
        action: "Re-authenticate with QuickBooks Online",
      };
    case "rate_limit":
      return {
        message: "Rate limit exceeded - too many API calls",
        action: "Wait and retry later, or reduce sync batch size",
      };
    case "validation":
      return {
        message: "Data validation error - required fields missing or invalid",
        action: "Review the entity data and fix validation issues",
      };
    case "mapping":
      return {
        message: "QBO mapping error - item or customer not found in QBO",
        action: "Configure QBO item mappings in Settings below",
      };
    case "conflict":
      return {
        message: "Stale data conflict - entity was modified in QBO",
        action: "Run Reconcile to sync latest data from QBO",
      };
    case "server":
      return {
        message: "QBO server error - temporary outage",
        action: "Retry in a few minutes",
      };
    case "network":
      return {
        message: "Network error - connection issue",
        action: "Check network connectivity and retry",
      };
    default:
      return null;
  }
}

/**
 * Detect error category from error message
 */
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

export default function QboConsolePage() {
  const { toast } = useToast();
  const [invoiceId, setInvoiceId] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showMappingConfig, setShowMappingConfig] = useState(false);
  const [mappingConfig, setMappingConfig] = useState<QboMappingConfig>({});
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

  // Fetch QBO status
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<QboStatusResponse>({
    queryKey: ["/api/qbo/status"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/status");
      if (!response.ok) {
        if (response.status === 403) throw new Error("Access denied. Admin role required.");
        throw new Error("Failed to fetch QBO status");
      }
      return response.json();
    },
  });

  // Fetch QBO events with filters
  const eventsQueryKey = ["/api/qbo/events", eventTypeFilter, resultFilter];
  const { data: eventsData, isLoading: eventsLoading, refetch: refetchEvents } = useQuery<QboEventsResponse>({
    queryKey: eventsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (eventTypeFilter && eventTypeFilter !== "all") params.set("entityType", eventTypeFilter);
      if (resultFilter && resultFilter !== "all") params.set("result", resultFilter);
      const response = await fetch(`/api/qbo/events?${params}`);
      if (!response.ok) throw new Error("Failed to fetch QBO events");
      return response.json();
    },
  });

  // Fetch mapping config
  useQuery<QboMappingConfigResponse>({
    queryKey: ["/api/qbo/mapping-config"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/mapping-config");
      if (!response.ok) throw new Error("Failed to fetch mapping config");
      const data = await response.json();
      setMappingConfig(data.config || {});
      return data;
    },
  });

  // Fetch preflight status
  const { data: preflight, isLoading: preflightLoading, refetch: refetchPreflight } = useQuery<PreflightResult>({
    queryKey: ["/api/qbo/preflight"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/preflight");
      if (!response.ok) throw new Error("Failed to fetch preflight status");
      return response.json();
    },
  });

  // Toggle QBO enabled mutation
  const toggleEnabledMutation = useMutation({
    mutationFn: async (payload: { enabled: boolean; environment?: string }) => {
      const response = await fetch("/api/qbo/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
        description: data.qboEnabled
          ? `Environment: ${data.qboEnvironment}`
          : "QBO sync has been disabled",
      });
      refetchPreflight();
      refetchStatus();
    },
    onError: (err: Error) => {
      toast({ title: "Operation failed", description: err.message, variant: "destructive" });
    },
  });

  // Connectivity test mutation
  const connectivityTestMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/connectivity-test", { method: "POST" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Connectivity test failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connection successful" : "Connection failed",
        description: data.success
          ? `Latency: ${data.latencyMs}ms`
          : data.error || "Could not connect to QBO",
        variant: data.success ? "default" : "destructive",
      });
      refetchPreflight();
    },
    onError: (err: Error) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  // Dry-run invoice sync mutation
  const dryRunInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/dry-run/invoice/${id}`, { method: "POST" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Dry-run failed");
      }
      return response.json() as Promise<DryRunInvoiceResult>;
    },
    onSuccess: (data) => {
      toast({
        title: data.wouldSync ? "Would sync successfully" : "Would not sync",
        description: data.wouldSync
          ? `Invoice ${data.invoiceId} would be synced to QBO`
          : data.skipReason || "See validation details",
        variant: "default",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Dry-run failed", description: err.message, variant: "destructive" });
    },
  });

  // Dry-run queue process mutation
  const dryRunQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/dry-run/queue/process", { method: "POST" });
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

  // Fetch webhook events
  const webhooksQueryKey = ["/api/qbo/webhooks", webhookStatusFilter];
  const { data: webhooksData, isLoading: webhooksLoading, refetch: refetchWebhooks } = useQuery<QboWebhooksResponse>({
    queryKey: webhooksQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (webhookStatusFilter && webhookStatusFilter !== "all") params.set("status", webhookStatusFilter);
      const response = await fetch(`/api/qbo/webhooks?${params}`);
      if (!response.ok) throw new Error("Failed to fetch webhooks");
      return response.json();
    },
  });

  // Fetch drift alerts
  const { data: driftAlertsData, isLoading: driftAlertsLoading, refetch: refetchDriftAlerts } = useQuery<DriftAlertsResponse>({
    queryKey: ["/api/qbo/drift-alerts"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/drift-alerts");
      if (!response.ok) throw new Error("Failed to fetch drift alerts");
      return response.json();
    },
  });

  // Fetch recent sync runs
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery<SyncRunsResponse>({
    queryKey: ["/api/qbo/runs"],
    queryFn: async () => {
      const response = await fetch("/api/qbo/runs?limit=20");
      if (!response.ok) throw new Error("Failed to fetch runs");
      return response.json();
    },
  });

  // Fetch run detail when selected
  const { data: runDetailData, isLoading: runDetailLoading } = useQuery<SyncRunDetailResponse>({
    queryKey: ["/api/qbo/runs", selectedRunId],
    queryFn: async () => {
      const response = await fetch(`/api/qbo/runs/${selectedRunId}`);
      if (!response.ok) throw new Error("Failed to fetch run detail");
      return response.json();
    },
    enabled: !!selectedRunId,
  });

  // Fetch QBO items (from QuickBooks)
  const { data: qboItemsData, isLoading: qboItemsLoading, refetch: refetchQboItems } = useQuery<QboItemsResponse>({
    queryKey: ["/api/qbo/items", itemSearchQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (itemSearchQuery) params.set("q", itemSearchQuery);
      const response = await fetch(`/api/qbo/items?${params}`);
      if (!response.ok) throw new Error("Failed to fetch QBO items");
      return response.json();
    },
    enabled: false, // Only fetch on demand
  });

  // Fetch local items with sync status
  const { data: localItemsData, isLoading: localItemsLoading, refetch: refetchLocalItems } = useQuery<LocalItemsResponse>({
    queryKey: ["/api/qbo/items/local", localItemsSyncStatus],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (localItemsSyncStatus && localItemsSyncStatus !== "all") params.set("syncStatus", localItemsSyncStatus);
      const response = await fetch(`/api/qbo/items/local?${params}`);
      if (!response.ok) throw new Error("Failed to fetch local items");
      return response.json();
    },
  });

  // Link item mutation
  const linkItemMutation = useMutation({
    mutationFn: async ({ itemId, qboItemId }: { itemId: string; qboItemId: string }) => {
      const response = await fetch("/api/qbo/items/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  // Create item in QBO mutation
  const createItemInQboMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const response = await fetch(`/api/qbo/items/create/${itemId}`, { method: "POST" });
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

  // Bulk create items mutation
  const bulkCreateItemsMutation = useMutation({
    mutationFn: async (itemIds: string[]) => {
      const response = await fetch("/api/qbo/items/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  // Process webhooks mutation
  const processWebhooksMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/qbo/webhook/process", { method: "POST" });
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

  // Enqueue reconcile for drift alert
  const reconcileDriftAlertMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const response = await fetch(`/api/qbo/drift-alerts/${eventId}/reconcile`, { method: "POST" });
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

  // Save mapping config mutation
  const saveMappingConfigMutation = useMutation({
    mutationFn: async (config: QboMappingConfig) => {
      const response = await fetch("/api/qbo/mapping-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/mapping-config"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // Fetch queue jobs
  const queueQueryKey = ["/api/qbo/queue", queueStatusFilter];
  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<QboQueueResponse>({
    queryKey: queueQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (queueStatusFilter && queueStatusFilter !== "all") params.set("status", queueStatusFilter);
      const response = await fetch(`/api/qbo/queue?${params}`);
      if (!response.ok) throw new Error("Failed to fetch queue");
      return response.json();
    },
  });

  // Process queue mutation
  const processQueueMutation = useMutation({
    mutationFn: async (limit: number = 20) => {
      const response = await fetch(`/api/qbo/queue/process?limit=${limit}`, { method: "POST" });
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

  // Replay job mutation
  const replayJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/qbo/queue/${jobId}/replay`, { method: "POST" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Replay failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.success ? "Job succeeded" : "Job failed",
        description: data.success
          ? `Entity synced: ${data.qboEntityId || "N/A"}`
          : data.error || "Unknown error",
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

  // Delete job mutation
  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/qbo/queue/${jobId}`, { method: "DELETE" });
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

  // Enqueue job mutation
  const enqueueJobMutation = useMutation({
    mutationFn: async (payload: { entityType: string; entityId: string; action: string }) => {
      const response = await fetch("/api/qbo/queue/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  // Mutations for sync actions
  const syncInvoiceMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/qbo/sync/invoice/${id}`, { method: "POST" });
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
      const response = await fetch(`/api/qbo/sync/invoice-with-deps/${id}`, { method: "POST" });
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
      const response = await fetch(`/api/qbo/reconcile/invoice/${id}`, { method: "POST" });
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
      const response = await fetch(`/api/qbo/reconcile/invoice/${id}/apply`, { method: "POST" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (err: Error) => {
      toast({ title: "Apply error", description: err.message, variant: "destructive" });
    },
  });

  const isAnyMutationPending =
    syncInvoiceMutation.isPending ||
    syncWithDepsMutation.isPending ||
    reconcileDryRunMutation.isPending ||
    reconcileApplyMutation.isPending;

  const handleApplyConfirm = () => {
    setShowApplyConfirm(false);
    reconcileApplyMutation.mutate(invoiceId);
  };

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
          <h1 className="text-xl font-semibold">QuickBooks Online Console</h1>
          <p className="text-sm text-muted-foreground">Sync status, configuration, and manual tools</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetchStatus();
            refetchEvents();
          }}
          disabled={statusLoading || eventsLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${statusLoading || eventsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchPreflight()}
                disabled={preflightLoading}
              >
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
        <CardContent className="space-y-4">
          {/* Preflight Checklist */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Preflight Checklist</h4>
            <div className="grid md:grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                {preflight?.tokensConfigured ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="text-sm">OAuth Tokens Configured</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                {preflight?.mappingStatus?.configured ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="text-sm">Item/Tax Mapping Configured</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                {preflight?.connectivityCheck?.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="text-sm">QBO Connectivity</span>
                {preflight?.connectivityCheck?.latencyMs && (
                  <span className="text-xs text-muted-foreground">({preflight.connectivityCheck.latencyMs}ms)</span>
                )}
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                {preflight?.readyToSync ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                )}
                <span className="text-sm">Ready to Sync</span>
              </div>
            </div>
          </div>

          {/* Blockers Warning */}
          {preflight?.blockers && preflight.blockers.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Blockers</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  {preflight.blockers.map((blocker, i) => (
                    <li key={i} className="text-sm">{blocker}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Environment and Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Environment:</Label>
              <Badge variant="outline">{preflight?.qboEnvironment || "sandbox"}</Badge>
            </div>

            <div className="flex-1" />

            <Button
              variant="outline"
              size="sm"
              onClick={() => connectivityTestMutation.mutate()}
              disabled={connectivityTestMutation.isPending || !preflight?.tokensConfigured}
            >
              {connectivityTestMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>

            {preflight?.qboEnabled ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => toggleEnabledMutation.mutate({ enabled: false })}
                disabled={toggleEnabledMutation.isPending}
              >
                {toggleEnabledMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-2" />
                )}
                Disable QBO Sync
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowEnableConfirm(true)}
                disabled={toggleEnabledMutation.isPending || !preflight?.readyToSync}
                title={!preflight?.readyToSync ? "Fix blockers before enabling" : ""}
              >
                {toggleEnabledMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Enable Sync to QuickBooks
              </Button>
            )}
          </div>

          {/* Dry-Run Section */}
          <div className="pt-4 border-t space-y-3">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <TestTube2 className="h-4 w-4" />
              Preview &amp; Validation
            </h4>
            <p className="text-sm text-muted-foreground">
              Preview what would be sent to QuickBooks without making any changes. Use this to validate data before syncing.
            </p>

            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="dryRunInvoiceId" className="text-sm">Invoice ID</Label>
                <Input
                  id="dryRunInvoiceId"
                  placeholder="Enter invoice ID (UUID)"
                  value={dryRunInvoiceId}
                  onChange={(e) => setDryRunInvoiceId(e.target.value)}
                  className="h-9"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dryRunInvoiceMutation.mutate(dryRunInvoiceId)}
                disabled={!dryRunInvoiceId || dryRunInvoiceMutation.isPending}
              >
                {dryRunInvoiceMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube2 className="h-4 w-4 mr-2" />
                )}
                Preview Invoice Sync
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dryRunQueueMutation.mutate()}
                disabled={dryRunQueueMutation.isPending}
              >
                {dryRunQueueMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ListTodo className="h-4 w-4 mr-2" />
                )}
                Preview Sync Activity
              </Button>
            </div>

            {/* Dry-run invoice result preview */}
            {dryRunInvoiceMutation.data && (
              <div className="mt-3 p-3 bg-muted rounded text-sm">
                <div className="flex items-center gap-2 mb-2">
                  {dryRunInvoiceMutation.data.wouldSync ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  )}
                  <span className="font-medium">
                    {dryRunInvoiceMutation.data.wouldSync ? "Would sync" : "Would NOT sync"}
                  </span>
                  {dryRunInvoiceMutation.data.skipReason && (
                    <span className="text-muted-foreground">- {dryRunInvoiceMutation.data.skipReason}</span>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex gap-4">
                    <span>Customer Ref: {dryRunInvoiceMutation.data.validation.hasCustomerRef ? "Yes" : "No"}</span>
                    <span>Mapping Valid: {dryRunInvoiceMutation.data.validation.mappingValid ? "Yes" : "No"}</span>
                  </div>
                  {dryRunInvoiceMutation.data.payload && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground">View payload preview</summary>
                      <pre className="mt-2 p-2 bg-background rounded text-xs overflow-auto max-h-48">
                        {JSON.stringify(dryRunInvoiceMutation.data.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )}

            {/* Dry-run queue result preview */}
            {dryRunQueueMutation.data && (
              <div className="mt-3 p-3 bg-muted rounded text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <ListTodo className="h-4 w-4" />
                  <span className="font-medium">
                    Would process {dryRunQueueMutation.data.wouldProcess.total} jobs
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">
                    {dryRunQueueMutation.data.wouldProcess.queued} queued, {dryRunQueueMutation.data.wouldProcess.retriable} retriable
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mapping Configuration Warning */}
      {status?.mappingStatus && status.mappingStatus.warnings.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>QBO Mapping Configuration Missing</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4 mt-2 space-y-1">
              {status.mappingStatus.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              Configure item mappings below to enable invoice sync. Without mappings, invoices will fail to sync.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Status Dashboard */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Customer Companies Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Customer Companies
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {["NOT_SYNCED", "SYNCED", "PENDING", "ERROR"].map((s) => (
                  <div key={s} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <StatusBadge status={s} />
                    <span className="font-mono text-lg">{status?.customerCompanies[s] ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoices Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {["NOT_SYNCED", "SYNCED", "PENDING", "ERROR"].map((s) => (
                  <div key={s} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <StatusBadge status={s} />
                    <span className="font-mono text-lg">{status?.invoices[s] ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Failures */}
      {status?.recentFailures && status.recentFailures.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Recent Failures
            </CardTitle>
            <CardDescription>Last 10 failed sync operations</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.recentFailures.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm">{formatDateTime(event.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{event.eventType}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {event.invoiceId || event.customerCompanyId || event.clientLocationId || "-"}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-xs truncate">
                      {event.errorMessage || event.errorCode || "Unknown error"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Mapping Configuration */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => setShowMappingConfig(!showMappingConfig)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">Item & Tax Mapping</CardTitle>
                <CardDescription>Configure QBO Item IDs for invoice line types</CardDescription>
              </div>
            </div>
            {showMappingConfig ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {showMappingConfig && (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter QBO Item IDs from your QuickBooks chart of accounts. These map invoice line types to QBO products/services.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="serviceItemId">Service Item ID</Label>
                <Input
                  id="serviceItemId"
                  placeholder="e.g., 1"
                  value={mappingConfig.serviceItemId || ""}
                  onChange={(e) => setMappingConfig({ ...mappingConfig, serviceItemId: e.target.value || undefined })}
                />
                <p className="text-xs text-muted-foreground">For "service" line items (labor, work performed)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="materialItemId">Material Item ID</Label>
                <Input
                  id="materialItemId"
                  placeholder="e.g., 2"
                  value={mappingConfig.materialItemId || ""}
                  onChange={(e) => setMappingConfig({ ...mappingConfig, materialItemId: e.target.value || undefined })}
                />
                <p className="text-xs text-muted-foreground">For "material" line items (parts, supplies)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feeItemId">Fee Item ID</Label>
                <Input
                  id="feeItemId"
                  placeholder="e.g., 3"
                  value={mappingConfig.feeItemId || ""}
                  onChange={(e) => setMappingConfig({ ...mappingConfig, feeItemId: e.target.value || undefined })}
                />
                <p className="text-xs text-muted-foreground">For "fee" line items (service call fees, etc.)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="miscItemId">Misc/Fallback Item ID</Label>
                <Input
                  id="miscItemId"
                  placeholder="e.g., 4"
                  value={mappingConfig.miscItemId || ""}
                  onChange={(e) => setMappingConfig({ ...mappingConfig, miscItemId: e.target.value || undefined })}
                />
                <p className="text-xs text-muted-foreground">Fallback for line items without specific mapping</p>
              </div>
            </div>

            <div className="border-t pt-4 mt-4">
              <h4 className="font-medium mb-2">Tax Code Mapping</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="taxableCode">Taxable Code</Label>
                  <Input
                    id="taxableCode"
                    placeholder="e.g., TAX or 1"
                    value={mappingConfig.taxableCode || ""}
                    onChange={(e) => setMappingConfig({ ...mappingConfig, taxableCode: e.target.value || undefined })}
                  />
                  <p className="text-xs text-muted-foreground">QBO TaxCode for taxable items</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nonTaxableCode">Non-Taxable Code</Label>
                  <Input
                    id="nonTaxableCode"
                    placeholder="e.g., NON or 0"
                    value={mappingConfig.nonTaxableCode || ""}
                    onChange={(e) => setMappingConfig({ ...mappingConfig, nonTaxableCode: e.target.value || undefined })}
                  />
                  <p className="text-xs text-muted-foreground">QBO TaxCode for non-taxable items</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => saveMappingConfigMutation.mutate(mappingConfig)}
                disabled={saveMappingConfigMutation.isPending}
              >
                {saveMappingConfigMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Configuration
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

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
              <Input
                id="invoiceId"
                placeholder="Enter invoice ID (UUID)"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => syncInvoiceMutation.mutate(invoiceId)}
              disabled={!invoiceId || isAnyMutationPending}
            >
              {syncInvoiceMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4 mr-2" />
              )}
              Sync Invoice
            </Button>

            <Button
              variant="outline"
              onClick={() => syncWithDepsMutation.mutate(invoiceId)}
              disabled={!invoiceId || isAnyMutationPending}
            >
              {syncWithDepsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4 mr-2" />
              )}
              Sync with Dependencies
            </Button>

            <Button
              variant="outline"
              onClick={() => reconcileDryRunMutation.mutate(invoiceId)}
              disabled={!invoiceId || isAnyMutationPending}
            >
              {reconcileDryRunMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4 mr-2" />
              )}
              Reconcile (Dry Run)
            </Button>

            <Button
              variant="default"
              onClick={() => setShowApplyConfirm(true)}
              disabled={!invoiceId || isAnyMutationPending}
            >
              {reconcileApplyMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4 mr-2" />
              )}
              Apply Reconciliation
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sync Queue */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListTodo className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">Sync Queue</CardTitle>
                <CardDescription>Manage queued sync operations with retry support</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchQueue()}
                disabled={queueLoading}
              >
                <RefreshCw className={`h-4 w-4 ${queueLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                onClick={() => processQueueMutation.mutate(20)}
                disabled={processQueueMutation.isPending || !queueData?.stats.queued}
              >
                {processQueueMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Process Queue
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Queue Stats */}
          {queueData?.stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm text-muted-foreground">Queued</span>
                <Badge variant="secondary">{queueData.stats.queued}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm text-muted-foreground">Running</span>
                <Badge variant="default">{queueData.stats.running}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm text-muted-foreground">Failed</span>
                <Badge variant="destructive">{queueData.stats.failed}</Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm text-muted-foreground">Retriable</span>
                <Badge variant="outline">{queueData.stats.retriable}</Badge>
              </div>
            </div>
          )}

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={queueStatusFilter} onValueChange={setQueueStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="QUEUED">Queued</SelectItem>
                <SelectItem value="RUNNING">Running</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="SUCCESS">Success</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Queue Jobs Table */}
          {queueLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : queueData?.jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ListTodo className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No queue jobs found</p>
              <p className="text-sm">Jobs will appear here when syncs are enqueued</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueData?.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-xs">
                          {job.entityType}
                        </Badge>
                        <div className="font-mono text-xs truncate max-w-[120px]" title={job.entityId}>
                          {job.entityId.substring(0, 8)}...
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {job.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          job.status === "SUCCESS" ? "default" :
                          job.status === "FAILED" ? "destructive" :
                          job.status === "RUNNING" ? "secondary" :
                          "outline"
                        }
                      >
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {job.status === "SUCCESS" || job.status === "FAILED" && job.attempts >= job.maxAttempts
                        ? "-"
                        : formatDateTime(job.nextRunAt)}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-[200px] truncate" title={job.lastError || undefined}>
                      {job.lastError || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {job.status === "FAILED" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => replayJobMutation.mutate(job.id)}
                            disabled={replayJobMutation.isPending}
                            title="Replay job"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteJobMutation.mutate(job.id)}
                          disabled={deleteJobMutation.isPending || job.status === "RUNNING"}
                          title="Delete job"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">Recent Sync Runs</CardTitle>
                <CardDescription>Aggregated view of sync operations by run ID</CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchRuns()}
              disabled={runsLoading}
            >
              <RefreshCw className={`h-4 w-4 ${runsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {runsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !runsData?.runs.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sync runs recorded yet.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Queue Jobs</TableHead>
                    <TableHead>Webhooks</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsData.runs.map((run) => {
                    const hasFailures = run.failureCount > 0 || run.queueFailedCount > 0;
                    return (
                      <TableRow key={run.syncRunId} className={selectedRunId === run.syncRunId ? "bg-muted/50" : ""}>
                        <TableCell className="font-mono text-xs">
                          {run.syncRunId.substring(0, 20)}...
                        </TableCell>
                        <TableCell className="text-sm">
                          {run.completedAt ? formatDateTime(run.completedAt) : run.startedAt ? formatDateTime(run.startedAt) : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant={run.failureCount > 0 ? "destructive" : "default"} className="text-xs">
                              {run.successCount}/{run.eventCount}
                            </Badge>
                            {run.failureCount > 0 && (
                              <span className="text-xs text-destructive">({run.failureCount} failed)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {run.queueJobCount > 0 ? (
                            <div className="flex items-center gap-1">
                              <Badge variant={run.queueFailedCount > 0 ? "destructive" : "default"} className="text-xs">
                                {run.queueSuccessCount}/{run.queueJobCount}
                              </Badge>
                              {run.queueFailedCount > 0 && (
                                <span className="text-xs text-destructive">({run.queueFailedCount} failed)</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {run.webhookEventCount > 0 ? (
                            <Badge variant="secondary" className="text-xs">
                              {run.webhookProcessedCount}/{run.webhookEventCount}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedRunId(selectedRunId === run.syncRunId ? null : run.syncRunId)}
                          >
                            {selectedRunId === run.syncRunId ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Run Detail Panel */}
              {selectedRunId && runDetailData && (
                <Card className="mt-4 border-dashed">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-mono">{selectedRunId}</CardTitle>
                    <CardDescription>
                      {runDetailData.stats.totalEvents} events, {runDetailData.stats.totalQueueJobs} queue jobs, {runDetailData.stats.totalWebhookEvents} webhooks
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="p-2 rounded bg-muted/50">
                        <div className="text-xs text-muted-foreground">Events</div>
                        <div className="font-medium">{runDetailData.stats.successEvents}/{runDetailData.stats.totalEvents} success</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <div className="text-xs text-muted-foreground">Queue Jobs</div>
                        <div className="font-medium">{runDetailData.stats.successQueueJobs}/{runDetailData.stats.totalQueueJobs} success</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <div className="text-xs text-muted-foreground">Webhooks</div>
                        <div className="font-medium">{runDetailData.stats.processedWebhookEvents}/{runDetailData.stats.totalWebhookEvents} processed</div>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <div className="text-xs text-muted-foreground">Failures</div>
                        <div className={`font-medium ${runDetailData.stats.failureEvents + runDetailData.stats.failedQueueJobs > 0 ? "text-destructive" : ""}`}>
                          {runDetailData.stats.failureEvents + runDetailData.stats.failedQueueJobs}
                        </div>
                      </div>
                    </div>

                    {/* Failed Events with Suggested Actions */}
                    {runDetailData.events.filter(e => e.result === "FAILURE").length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-destructive">Failed Events</h4>
                        {runDetailData.events
                          .filter(e => e.result === "FAILURE")
                          .slice(0, 5)
                          .map(event => {
                            const suggestion = getSuggestedAction(undefined, event.errorMessage || "");
                            return (
                              <Alert key={event.id} variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle className="text-sm">{event.eventType}</AlertTitle>
                                <AlertDescription className="text-xs">
                                  <div>{event.errorMessage || "Unknown error"}</div>
                                  {suggestion && (
                                    <div className="mt-2 p-2 bg-background/50 rounded">
                                      <span className="font-medium">Suggested action:</span> {suggestion.action}
                                    </div>
                                  )}
                                </AlertDescription>
                              </Alert>
                            );
                          })}
                      </div>
                    )}

                    {/* Failed Queue Jobs with Suggested Actions */}
                    {runDetailData.queueJobs.filter(j => j.status === "FAILED").length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-destructive">Failed Queue Jobs</h4>
                        {runDetailData.queueJobs
                          .filter(j => j.status === "FAILED")
                          .slice(0, 5)
                          .map(job => {
                            const suggestion = getSuggestedAction(undefined, job.lastError || "");
                            return (
                              <Alert key={job.id} variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle className="text-sm">{job.entityType} - {job.action}</AlertTitle>
                                <AlertDescription className="text-xs">
                                  <div>{job.lastError || "Unknown error"}</div>
                                  {suggestion && (
                                    <div className="mt-2 p-2 bg-background/50 rounded">
                                      <span className="font-medium">Suggested action:</span> {suggestion.action}
                                    </div>
                                  )}
                                </AlertDescription>
                              </Alert>
                            );
                          })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {runDetailLoading && selectedRunId && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Loading run details...</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Webhooks Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">QBO Webhooks</CardTitle>
                <CardDescription>Inbound webhook events from QuickBooks Online</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchWebhooks()}
                disabled={webhooksLoading}
              >
                <RefreshCw className={`h-4 w-4 ${webhooksLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                onClick={() => processWebhooksMutation.mutate()}
                disabled={processWebhooksMutation.isPending || !webhooksData?.events.some(e => e.status === "VERIFIED")}
              >
                {processWebhooksMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Process Webhooks
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Webhook Stats */}
          {webhooksData?.events && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {["RECEIVED", "VERIFIED", "PROCESSED", "REJECTED", "IGNORED"].map(status => {
                const count = webhooksData.events.filter(e => e.status === status).length;
                return (
                  <div key={status} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{status}</span>
                    <Badge variant={status === "VERIFIED" ? "default" : status === "REJECTED" ? "destructive" : "secondary"}>
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={webhookStatusFilter} onValueChange={setWebhookStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="RECEIVED">Received</SelectItem>
                <SelectItem value="VERIFIED">Verified</SelectItem>
                <SelectItem value="PROCESSED">Processed</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="IGNORED">Ignored</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Webhooks Table */}
          {webhooksLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : webhooksData?.events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Webhook className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No webhook events found</p>
              <p className="text-sm">Events will appear here when QBO sends webhooks</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooksData?.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(event.receivedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-xs">
                          {event.qboEntityType}
                        </Badge>
                        <div className="font-mono text-xs truncate max-w-[100px]" title={event.qboEntityId}>
                          {event.qboEntityId}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {event.operation}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.status === "PROCESSED" ? "default" :
                          event.status === "VERIFIED" ? "secondary" :
                          event.status === "REJECTED" ? "destructive" :
                          "outline"
                        }
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.actionTaken || "-"}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-[150px] truncate" title={event.verificationError || event.processingError || undefined}>
                      {event.verificationError || event.processingError || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Drift Alerts Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">Drift Alerts</CardTitle>
                <CardDescription>Invoices with QBO changes that need reconciliation</CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDriftAlerts()}
              disabled={driftAlertsLoading}
            >
              <RefreshCw className={`h-4 w-4 ${driftAlertsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {driftAlertsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !driftAlertsData?.alerts || driftAlertsData.alerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-50 text-green-600" />
              <p>No drift alerts</p>
              <p className="text-sm">All synced invoices are up to date</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>QBO Entity</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driftAlertsData.alerts.map((alert) => (
                  <TableRow key={alert.webhookEventId}>
                    <TableCell>
                      <div className="space-y-1">
                        {alert.invoiceNumber ? (
                          <span className="font-medium">{alert.invoiceNumber}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Unknown</span>
                        )}
                        {alert.invoiceId && (
                          <div className="font-mono text-xs truncate max-w-[100px]" title={alert.invoiceId}>
                            {alert.invoiceId.substring(0, 8)}...
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {alert.qboEntityId}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{alert.operation}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {alert.lastUpdated ? formatDateTime(alert.lastUpdated) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          alert.status === "reconciled" ? "default" :
                          alert.status === "pending" ? "secondary" :
                          "outline"
                        }
                      >
                        {alert.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {alert.status === "pending" && alert.invoiceId && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => reconcileDriftAlertMutation.mutate(alert.webhookEventId)}
                              disabled={reconcileDriftAlertMutation.isPending}
                              title="Enqueue reconcile job"
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Reconcile
                            </Button>
                          </>
                        )}
                        {alert.invoiceId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setInvoiceId(alert.invoiceId);
                              reconcileDryRunMutation.mutate(alert.invoiceId);
                            }}
                            title="Run reconcile dry-run"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* QBO Items Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <div>
                <CardTitle className="text-lg">QBO Items</CardTitle>
                <CardDescription>Manage product/service item sync with QuickBooks Online</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchLocalItems()}
                disabled={localItemsLoading}
              >
                <RefreshCw className={`h-4 w-4 ${localItemsLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const unsyncedIds = localItemsData?.items
                    .filter(i => i.qboSyncStatus === "NOT_SYNCED")
                    .map(i => i.id) || [];
                  if (unsyncedIds.length > 0) {
                    bulkCreateItemsMutation.mutate(unsyncedIds);
                  }
                }}
                disabled={bulkCreateItemsMutation.isPending || !localItemsData?.items.some(i => i.qboSyncStatus === "NOT_SYNCED")}
              >
                {bulkCreateItemsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CloudUpload className="h-4 w-4 mr-2" />
                )}
                Sync All Unsynced
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Item Stats */}
          {localItemsData?.items && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {["NOT_SYNCED", "SYNCED", "ERROR"].map(status => {
                const count = localItemsData.items.filter(i => i.qboSyncStatus === status).length;
                return (
                  <div key={status} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <span className="text-sm text-muted-foreground">{status.replace(/_/g, " ")}</span>
                    <Badge
                      variant={
                        status === "SYNCED" ? "default" :
                        status === "ERROR" ? "destructive" :
                        "secondary"
                      }
                    >
                      {count}
                    </Badge>
                  </div>
                );
              })}
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm text-muted-foreground">Total</span>
                <Badge variant="outline">{localItemsData.items.length}</Badge>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-4 items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={localItemsSyncStatus} onValueChange={setLocalItemsSyncStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="NOT_SYNCED">Not Synced</SelectItem>
                <SelectItem value="SYNCED">Synced</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Local Items Table */}
          {localItemsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !localItemsData?.items || localItemsData.items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Settings className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No items found</p>
              <p className="text-sm">Items will appear here when created in your inventory</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Sync Status</TableHead>
                  <TableHead>QBO ID</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localItemsData.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={item.description}>
                            {item.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.sku || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {item.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(2)}` : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.qboSyncStatus} />
                      {item.qboSyncError && (
                        <div className="text-xs text-destructive mt-1 truncate max-w-[100px]" title={item.qboSyncError}>
                          {item.qboSyncError}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.qboItemId || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!item.qboItemId && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => createItemInQboMutation.mutate(item.id)}
                              disabled={createItemInQboMutation.isPending}
                              title="Create in QBO"
                            >
                              <CloudUpload className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedItemForLink(item);
                                setShowItemLinkDialog(true);
                              }}
                              title="Link to existing QBO item"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {item.qboItemId && item.qboSyncStatus === "ERROR" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => createItemInQboMutation.mutate(item.id)}
                            disabled={createItemInQboMutation.isPending}
                            title="Retry sync"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Search QBO Items */}
          <div className="border-t pt-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <CloudDownload className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Search QBO Items</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Search QBO items by name..."
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="outline"
                onClick={() => refetchQboItems()}
                disabled={qboItemsLoading}
              >
                {qboItemsLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Search QBO
              </Button>
            </div>
            {qboItemsData?.items && qboItemsData.items.length > 0 && (
              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>QBO ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qboItemsData.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.id}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.unitPrice ? `$${item.unitPrice.toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell>
                          {item.active ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {qboItemsData && !qboItemsData.success && (
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{qboItemsData.error}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sync Events Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sync Events</CardTitle>
          <CardDescription>Recent QBO sync operations for your company</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Result" />
              </SelectTrigger>
              <SelectContent>
                {RESULT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Events Table */}
          {eventsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : eventsData?.events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No sync events found</p>
              <p className="text-sm">Events will appear here after sync operations are performed</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead>QBO ID</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventsData?.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(event.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {event.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ResultBadge result={event.result} />
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[120px] truncate">
                      {event.invoiceId || event.customerCompanyId || event.clientLocationId || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {event.qboEntityId || "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.durationMs ? `${event.durationMs}ms` : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-[200px] truncate">
                      {event.errorMessage || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Apply Confirmation Dialog */}
      <AlertDialog open={showApplyConfirm} onOpenChange={setShowApplyConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply Reconciliation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create local payment records for any payments found in QBO that don't exist locally.
              The invoice balance will be updated accordingly. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyConfirm}>Apply Payments</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enable QBO Confirmation Dialog */}
      <AlertDialog open={showEnableConfirm} onOpenChange={setShowEnableConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Sync to QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will enable QuickBooks Online sync for your company. All sync operations will begin
              sending data to QBO ({preflight?.qboEnvironment || "sandbox"} environment).
              <br /><br />
              Make sure you have tested with previews before enabling.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowEnableConfirm(false);
                toggleEnabledMutation.mutate({ enabled: true });
              }}
            >
              Enable Sync to QuickBooks
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
