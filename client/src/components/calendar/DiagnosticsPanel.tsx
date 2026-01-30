/**
 * Calendar Diagnostics Panel
 *
 * Collapsible panel showing diagnostic entries for calendar debugging.
 * Toggle via:
 * - Development mode (NODE_ENV !== 'production')
 * - Query param: ?diag=1
 */

import { useState, useSyncExternalStore, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Trash2,
  Wrench,
  X,
  AlertTriangle,
  CheckCircle2,
  MousePointer,
  Move,
  Send,
  Download,
  Upload,
} from "lucide-react";
import {
  isDiagnosticsEnabled,
  getEntries,
  clearEntries,
  subscribe,
  copyReportToClipboard,
  DiagEntry,
  DiagEntryType,
} from "@/lib/calendarDiagnostics";

// ============================================================================
// Entry Type Styling
// ============================================================================

const ENTRY_TYPE_CONFIG: Record<
  DiagEntryType,
  { icon: React.ReactNode; color: string; bgColor: string }
> = {
  "mutation-request": {
    icon: <Upload className="h-3 w-3" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  "mutation-response": {
    icon: <Download className="h-3 w-3" />,
    color: "text-green-600",
    bgColor: "bg-green-50",
  },
  "mutation-error": {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "text-red-600",
    bgColor: "bg-red-50",
  },
  "client-validation-error": {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
  },
  "hover-enter": {
    icon: <MousePointer className="h-3 w-3" />,
    color: "text-gray-500",
    bgColor: "bg-gray-50",
  },
  "hover-leave": {
    icon: <MousePointer className="h-3 w-3" />,
    color: "text-gray-400",
    bgColor: "bg-gray-50",
  },
  click: {
    icon: <MousePointer className="h-3 w-3" />,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
  },
  "drag-start": {
    icon: <Move className="h-3 w-3" />,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
  },
  "drag-end": {
    icon: <Move className="h-3 w-3" />,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
  },
  "invariant-fail": {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "text-red-700",
    bgColor: "bg-red-100",
  },
  info: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: "text-gray-600",
    bgColor: "bg-gray-50",
  },
};

// ============================================================================
// DiagEntry Row Component
// ============================================================================

function DiagEntryRow({ entry }: { entry: DiagEntry }) {
  const [expanded, setExpanded] = useState(false);
  const config = ENTRY_TYPE_CONFIG[entry.type];
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Extract raw error fields for mutation-error entries
  const isMutationError = entry.type === 'mutation-error';
  const rawErrorCode = isMutationError ? (entry.data.rawErrorCode as string | undefined) : undefined;
  const rawErrorMessage = isMutationError ? (entry.data.rawErrorMessage as string | undefined) : undefined;
  const clientMappedMessage = isMutationError ? (entry.data.clientMappedMessage as string | undefined) : undefined;
  const messageWasMapped = isMutationError ? (entry.data.messageWasMapped as boolean | undefined) : undefined;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <div
          className={`flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/50 border-b text-xs ${
            entry.isFail ? "bg-red-50 border-l-4 border-l-red-500" : ""
          }`}
        >
          <span className="text-muted-foreground font-mono shrink-0">
            {time}
          </span>
          <span className={`shrink-0 ${config.color}`}>{config.icon}</span>
          <span className="flex-1 truncate">{entry.summary}</span>
          {entry.networkRequestSent !== undefined && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1 ${
                entry.networkRequestSent
                  ? "border-blue-300 text-blue-600"
                  : "border-orange-300 text-orange-600"
              }`}
            >
              {entry.networkRequestSent ? "Server" : "Client"}
            </Badge>
          )}
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-2 bg-muted/30 text-xs overflow-x-auto space-y-2">
          {/* Show raw error fields prominently for mutation errors */}
          {isMutationError && (
            <div className="bg-red-100 border border-red-300 rounded p-2 space-y-1">
              <div className="font-semibold text-red-800">🔴 RAW SERVER RESPONSE:</div>
              <div className="font-mono">
                <span className="text-red-700">code:</span>{" "}
                <span className="font-bold">{rawErrorCode || "(none)"}</span>
              </div>
              <div className="font-mono">
                <span className="text-red-700">message:</span>{" "}
                <span className="font-bold">&quot;{rawErrorMessage || "(none)"}&quot;</span>
              </div>
              {messageWasMapped && (
                <div className="font-mono text-orange-700">
                  <span>⚠️ Client mapped to:</span>{" "}
                  <span className="font-bold">&quot;{clientMappedMessage}&quot;</span>
                </div>
              )}
            </div>
          )}
          {/* Full data dump */}
          <pre className="whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// DiagnosticsPanel Component
// ============================================================================

export function DiagnosticsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Subscribe to diagnostics store
  const entries = useSyncExternalStore(subscribe, getEntries, getEntries);

  const handleCopy = useCallback(async () => {
    const success = await copyReportToClipboard();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, []);

  const handleClear = useCallback(() => {
    clearEntries();
  }, []);

  // Don't render if diagnostics not enabled
  if (!isDiagnosticsEnabled()) {
    return null;
  }

  const failCount = entries.filter((e) => e.isFail).length;

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="fixed bottom-4 right-4 z-50 shadow-lg"
        onClick={() => setIsOpen(true)}
      >
        <Wrench className="h-4 w-4 mr-1" />
        Diagnostics
        {failCount > 0 && (
          <Badge variant="destructive" className="ml-2 h-5 px-1.5">
            {failCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[500px] max-h-[60vh] bg-background border rounded-lg shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          <span className="font-semibold text-sm">Calendar Diagnostics</span>
          <Badge variant="secondary" className="text-xs">
            {entries.length} entries
          </Badge>
          {failCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {failCount} FAIL
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={handleCopy}
            title="Copy report to clipboard"
          >
            {copySuccess ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <Clipboard className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={handleClear}
            title="Clear all entries"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setIsOpen(false)}
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Entry List */}
      <ScrollArea className="flex-1 min-h-0">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No diagnostic entries yet. Interact with the calendar to see events.
          </div>
        ) : (
          entries.map((entry) => <DiagEntryRow key={entry.id} entry={entry} />)
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t bg-muted/30 text-xs text-muted-foreground">
        Enable via <code className="bg-muted px-1 rounded">?diag=1</code> or dev
        mode
      </div>
    </div>
  );
}

export default DiagnosticsPanel;
