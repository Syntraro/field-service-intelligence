/**
 * Client CSV Import Wizard — Settings > Import Clients (v2 — Production Hardened)
 *
 * Five-step wizard:
 *   1. Upload CSV
 *   2. Map columns to Syntraro fields
 *   3. Preview & validate (with dedup detection + action badges)
 *   4. Execute import
 *   5. View results (with created vs matched counts)
 *
 * v2: Normalized matching, location/contact dedup, billing conflict warnings,
 *     within-CSV duplicate detection, per-row transaction safety.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  FileSpreadsheet,
  Building2,
  MapPin,
  CreditCard,
  User,
  Download,
  RotateCcw,
} from "lucide-react";
import type {
  ColumnMapping,
  ValidatedRow,
  ImportPreviewResponse,
  ImportExecuteResponse,
  ClientImportRow,
  ImportEntityAction,
} from "@shared/clientImportTypes";
import { IMPORT_FIELD_DEFS } from "@shared/clientImportTypes";
import { parseCSV } from "@shared/csvParser";

// ============================================================================
// Types
// ============================================================================

type WizardStep = "upload" | "map" | "preview" | "execute" | "results";

const GROUP_ICONS: Record<string, React.ReactNode> = {
  company: <Building2 className="h-3.5 w-3.5" />,
  billing: <CreditCard className="h-3.5 w-3.5" />,
  location: <MapPin className="h-3.5 w-3.5" />,
  contact: <User className="h-3.5 w-3.5" />,
};

const GROUP_LABELS: Record<string, string> = {
  company: "Company",
  billing: "Billing Address",
  location: "Primary Location",
  contact: "Primary Contact",
};

// ============================================================================
// Action Badge — shows create/match/skip for each entity
// ============================================================================

function ActionBadge({ action }: { action?: ImportEntityAction }) {
  if (action === "create") return <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-[10px] px-1">new</Badge>;
  if (action === "match") return <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[10px] px-1">exists</Badge>;
  if (action === "skip") return <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-500 text-[10px] px-1">skip</Badge>;
  return null; // undefined action — don't render badge
}

// ============================================================================
// Step 1: Upload
// ============================================================================

function UploadStep({ onUpload }: { onUpload: (text: string, fileName: string) => void }) {
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && !file.type.includes("csv") && !file.type.includes("text")) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) onUpload(text, file.name);
    };
    reader.readAsText(file);
  }, [onUpload]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Upload CSV File</CardTitle>
        <CardDescription>
          Each row imports one client package: one company, one location, and one optional contact.
          Duplicate companies, locations, and contacts are automatically detected and skipped.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".csv,text/csv";
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-sm font-medium">Drop a CSV file here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">Maximum 500 rows, 5MB</p>
        </div>
        <div className="mt-4 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground space-y-1">
          <p>Re-importing the same CSV is safe — duplicates are automatically detected and skipped.</p>
          <p>Company matching is case-insensitive. Locations are matched by address. Contacts are matched by email or name+phone.</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Step 2: Map Columns
// ============================================================================

function MapStep({
  headers,
  mappings,
  sampleRows,
  onMappingsChange,
}: {
  headers: string[];
  mappings: ColumnMapping[];
  sampleRows: string[][];
  onMappingsChange: (mappings: ColumnMapping[]) => void;
}) {
  const fieldsByGroup = useMemo(() => {
    const groups: Record<string, typeof IMPORT_FIELD_DEFS> = {};
    for (const f of IMPORT_FIELD_DEFS) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    }
    return groups;
  }, []);

  const usedFields = useMemo(
    () => new Set(mappings.filter((m) => m.targetField).map((m) => m.targetField!)),
    [mappings]
  );

  const hasCompanyName = usedFields.has("companyName");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map CSV Columns</CardTitle>
        <CardDescription>
          Match your CSV headers to Syntraro fields. "Company Name" is required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasCompanyName && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            "Company Name" must be mapped to proceed.
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">CSV Header</TableHead>
                <TableHead className="w-[250px]">Map To</TableHead>
                <TableHead>Sample Values</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((mapping, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium text-sm">{mapping.csvHeader}</TableCell>
                  <TableCell>
                    <Select
                      value={mapping.targetField ?? "__ignore__"}
                      onValueChange={(val) => {
                        const next = [...mappings];
                        next[idx] = { ...next[idx], targetField: val === "__ignore__" ? null : val as keyof ClientImportRow };
                        onMappingsChange(next);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ignore__">
                          <span className="text-muted-foreground">— Ignore —</span>
                        </SelectItem>
                        {Object.entries(fieldsByGroup).map(([group, fields]) => (
                          <div key={group}>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                              {GROUP_ICONS[group]}
                              {GROUP_LABELS[group]}
                            </div>
                            {fields.map((f) => (
                              <SelectItem
                                key={f.key}
                                value={f.key}
                                disabled={usedFields.has(f.key) && mapping.targetField !== f.key}
                              >
                                {f.label}{f.required ? " *" : ""}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                    {sampleRows.slice(0, 3).map((row) => row[mapping.csvIndex] ?? "").filter(Boolean).join(" | ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Step 3: Preview & Validate
// ============================================================================

type PreviewFilter = "all" | "errors" | "warnings" | "clean";

function PreviewStep({ preview }: { preview: ImportPreviewResponse }) {
  const { summary, rows, warningLegend } = preview;
  const [filter, setFilter] = useState<PreviewFilter>("all");

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "errors") return rows.filter(r => r.status === "blocked");
    if (filter === "warnings") return rows.filter(r => r.status === "warning");
    return rows.filter(r => r.status === "valid");
  }, [rows, filter]);

  // CSV export helpers
  const exportCSV = useCallback((filename: string, targetRows: ValidatedRow[]) => {
    const csvRows = ["Row,Status,Company,Location,Contact,Errors,Warnings"];
    for (const r of targetRows) {
      const errors = (r.errors ?? []).map(e => e.message).join("; ");
      const warns = (r.warningCodes ?? []).map(c => `W${c}`).join(", ") || (r.warnings ?? []).join("; ");
      csvRows.push([
        r.rowIndex + 1,
        r.status,
        `"${(r.normalized.companyName || "").replace(/"/g, '""')}"`,
        `"${(r.normalized.locationName || r.normalized.companyName || "").replace(/"/g, '""')}"`,
        `"${[r.normalized.contactFirstName, r.normalized.contactLastName].filter(Boolean).join(" ").replace(/"/g, '""')}"`,
        `"${errors.replace(/"/g, '""')}"`,
        `"${warns.replace(/"/g, '""')}"`,
      ].join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const errorRows = useMemo(() => rows.filter(r => r.status === "blocked"), [rows]);
  const warningRows = useMemo(() => rows.filter(r => r.status === "warning"), [rows]);

  return (
    <div className="space-y-4">
      {/* Within-CSV duplicate warning */}
      {(summary.withinCsvDuplicates ?? 0) > 0 && (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {summary.withinCsvDuplicates ?? 0} duplicate row{(summary.withinCsvDuplicates ?? 0) !== 1 ? "s" : ""} detected within the CSV (same company + address). Duplicate locations will be skipped.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Rows" value={summary.totalRows} />
        <SummaryCard label="Valid" value={summary.validRows} variant="green" />
        <SummaryCard label="Warnings" value={summary.warningRows} variant="yellow" />
        <SummaryCard label="Blocked" value={summary.blockedRows} variant="red" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="New Companies" value={summary.newCompanies} variant="blue" />
        <SummaryCard label="Existing Companies" value={summary.matchedExistingCompanies} />
        <SummaryCard label="Locations Matched" value={summary.locationsMatched ?? 0} />
        <SummaryCard label="Contacts Matched" value={summary.contactsMatched ?? 0} />
      </div>

      {/* Warning legend (compact indexed reference) */}
      {warningLegend && Object.keys(warningLegend).length > 0 && (
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Warning Legend</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5">
              {Object.entries(warningLegend).map(([code, msg]) => (
                <div key={code} className="flex items-start gap-1.5 text-xs">
                  <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-[9px] px-1 py-0 shrink-0 font-mono">W{code}</Badge>
                  <span className="text-muted-foreground">{msg}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row table with filtering and export */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Row Preview</CardTitle>
            {/* Filter buttons */}
            <div className="flex items-center gap-1 ml-2">
              {([
                { key: "all", label: "All", count: rows.length },
                { key: "errors", label: "Errors", count: errorRows.length },
                { key: "warnings", label: "Warnings", count: warningRows.length },
                { key: "clean", label: "Clean", count: summary.validRows },
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    filter === f.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
          </div>
          {/* Export buttons */}
          <div className="flex items-center gap-1.5">
            {errorRows.length > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => exportCSV("import-errors.csv", errorRows)}>
                <Download className="h-3 w-3 mr-1" />Errors
              </Button>
            )}
            {warningRows.length > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => exportCSV("import-warnings.csv", warningRows)}>
                <Download className="h-3 w-3 mr-1" />Warnings
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => exportCSV("import-preview.csv", rows)}>
              <Download className="h-3 w-3 mr-1" />All
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="w-16">Status</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="w-[200px]">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.rowIndex} className={row.status === "blocked" ? "bg-destructive/5" : ""}>
                    <TableCell className="text-[10px] text-muted-foreground py-1.5">{row.rowIndex + 1}</TableCell>
                    <TableCell className="py-1.5"><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-xs py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[140px]">{row.normalized.companyName || "—"}</span>
                        <ActionBadge action={row.companyAction} />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[120px]">{row.normalized.locationName || row.normalized.companyName || "—"}</span>
                        <ActionBadge action={row.locationAction} />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="truncate max-w-[100px]">{[row.normalized.contactFirstName, row.normalized.contactLastName].filter(Boolean).join(" ") || "—"}</span>
                        <ActionBadge action={row.contactAction} />
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px] py-1.5">
                      {(row.errors?.length ?? 0) > 0 && (
                        <div className="text-destructive">{(row.errors ?? []).map((e) => e.message).join("; ")}</div>
                      )}
                      {(row.warningCodes?.length ?? 0) > 0 && (
                        <span className="text-yellow-600 font-mono">{(row.warningCodes ?? []).map(c => `W${c}`).join(" ")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">No rows match the selected filter.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, variant }: { label: string; value: number; variant?: "green" | "yellow" | "red" | "blue" }) {
  const colors: Record<string, string> = {
    green: "text-green-700 bg-green-50 border-green-200",
    yellow: "text-yellow-700 bg-yellow-50 border-yellow-200",
    red: "text-red-700 bg-red-50 border-red-200",
    blue: "text-blue-700 bg-blue-50 border-blue-200",
  };
  const cls = variant ? colors[variant] : "text-foreground bg-muted/50 border-border";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "valid") return <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-0.5" />Valid</Badge>;
  if (status === "warning") return <Badge variant="outline" className="border-yellow-300 bg-yellow-50 text-yellow-700 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />Warn</Badge>;
  return <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px]"><XCircle className="h-3 w-3 mr-0.5" />Blocked</Badge>;
}

// ============================================================================
// Step 5: Results
// ============================================================================

function ResultsStep({ results }: { results: ImportExecuteResponse }) {
  const { summary, results: rowResults } = results;
  const failedRows = rowResults.filter((r) => !r.success);

  const handleDownloadErrors = useCallback(() => {
    if (failedRows.length === 0) return;
    const lines = ["Row,Error"];
    for (const r of failedRows) {
      lines.push(`${r.rowIndex + 1},"${(r.error ?? "Unknown error").replace(/"/g, '""')}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [failedRows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {summary.failedRows === 0
              ? <><CheckCircle2 className="h-5 w-5 text-green-600" />Import Complete</>
              : <><AlertTriangle className="h-5 w-5 text-yellow-600" />Import Completed with Errors</>
            }
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Imported" value={summary.importedRows} variant="green" />
            <SummaryCard label="Failed" value={summary.failedRows} variant={summary.failedRows > 0 ? "red" : undefined} />
            <SummaryCard label="Companies Created" value={summary.companiesCreated} variant="blue" />
            <SummaryCard label="Companies Matched" value={summary.companiesMatched} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <SummaryCard label="Locations Created" value={summary.locationsCreated ?? 0} variant="green" />
            <SummaryCard label="Locations Matched" value={summary.locationsMatched ?? 0} />
            <SummaryCard label="Contacts Created" value={summary.contactsCreated ?? 0} variant="green" />
            <SummaryCard label="Contacts Matched" value={summary.contactsMatched ?? 0} />
          </div>
        </CardContent>
      </Card>

      {failedRows.length > 0 && (
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Failed Rows ({failedRows.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={handleDownloadErrors}>
              <Download className="h-3.5 w-3.5 mr-1" />Export Errors
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Row</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedRows.map((r) => (
                  <TableRow key={r.rowIndex}>
                    <TableCell className="text-xs">{r.rowIndex + 1}</TableCell>
                    <TableCell className="text-sm text-destructive">{r.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Main Wizard Component
// ============================================================================

export default function ClientImportPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [results, setResults] = useState<ImportExecuteResponse | null>(null);

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async (payload: { csvText: string; mappings?: ColumnMapping[] }) =>
      apiRequest("/api/client-import/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }) as Promise<ImportPreviewResponse>,
    onSuccess: (data) => {
      setPreview(data);
      if (step === "upload") {
        // First call — set up mappings from auto-suggestion
        setParsedHeaders(data.headers);
        setMappings(data.suggestedMappings);
        // Use server-parsed sample rows if available, otherwise parse
        // client-side with the shared quote-aware CSV parser.
        // Never use naive String.split(",") — it breaks on quoted fields
        // containing commas (e.g. "Jan, May, Sep" or multi-email fields).
        const samples = data.sampleData?.length
          ? data.sampleData
          : parseCSV(csvText).slice(1, 6);
        setSampleRows(samples);
        setStep("map");
      } else {
        setStep("preview");
      }
    },
    onError: (err: Error) => {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: async (rows: ClientImportRow[]) =>
      apiRequest("/api/client-import/execute", {
        method: "POST",
        body: JSON.stringify({ rows }),
      }) as Promise<ImportExecuteResponse>,
    onSuccess: (data) => {
      setResults(data);
      setStep("results");
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-companies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  // Handlers
  const handleUpload = useCallback((text: string, name: string) => {
    setCsvText(text);
    setFileName(name);
    previewMutation.mutate({ csvText: text });
  }, [previewMutation]);

  const handleValidate = useCallback(() => {
    previewMutation.mutate({ csvText, mappings });
  }, [csvText, mappings, previewMutation]);

  const handleExecute = useCallback(() => {
    if (!preview) return;
    // Send only non-blocked rows
    const importableRows = preview.rows
      .filter((r) => r.status !== "blocked")
      .map((r) => r.normalized);
    if (importableRows.length === 0) {
      toast({ title: "No rows to import", description: "All rows are blocked.", variant: "destructive" });
      return;
    }
    setStep("execute");
    executeMutation.mutate(importableRows);
  }, [preview, executeMutation, toast]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setCsvText("");
    setFileName("");
    setMappings([]);
    setParsedHeaders([]);
    setSampleRows([]);
    setPreview(null);
    setResults(null);
  }, []);

  const hasCompanyNameMapped = mappings.some((m) => m.targetField === "companyName");
  const importableCount = preview?.rows.filter((r) => r.status !== "blocked").length ?? 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Import Clients</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import clients from a CSV file. Duplicates are automatically detected and skipped for safe re-imports.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: "upload", label: "Upload" },
          { key: "map", label: "Map Fields" },
          { key: "preview", label: "Preview" },
          { key: "execute", label: "Import" },
          { key: "results", label: "Results" },
        ].map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-border" />}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              step === s.key ? "bg-primary text-primary-foreground" :
              (["upload","map","preview","execute","results"].indexOf(step) > i ? "text-green-700 bg-green-50" : "text-muted-foreground bg-muted/50")
            }`}>
              {["upload","map","preview","execute","results"].indexOf(step) > i && <CheckCircle2 className="h-3 w-3" />}
              {s.label}
            </div>
          </div>
        ))}
        {fileName && <span className="ml-auto text-xs text-muted-foreground">{fileName}</span>}
      </div>

      {/* Step content */}
      {step === "upload" && <UploadStep onUpload={handleUpload} />}

      {step === "map" && (
        <>
          {preview?.columnCountWarnings && preview.columnCountWarnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-800">Column count mismatch detected</p>
                    <p className="text-xs text-amber-700">
                      Some rows have more columns than the header row. This typically happens when a field
                      (like E-mails) contains unquoted commas, which shifts all subsequent columns.
                      Verify the sample values below match the expected data for each field.
                    </p>
                    <details className="text-xs text-amber-600">
                      <summary className="cursor-pointer">Details ({preview.columnCountWarnings.length} rows affected)</summary>
                      <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                        {preview.columnCountWarnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                        {preview.columnCountWarnings.length > 5 && <li>... and {preview.columnCountWarnings.length - 5} more</li>}
                      </ul>
                    </details>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          <MapStep
            headers={parsedHeaders}
            mappings={mappings}
            sampleRows={sampleRows}
            onMappingsChange={setMappings}
          />
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleReset}>
              <ArrowLeft className="h-4 w-4 mr-1" />Start Over
            </Button>
            <Button
              onClick={handleValidate}
              disabled={!hasCompanyNameMapped || previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-1" />}
              Validate & Preview
            </Button>
          </div>
        </>
      )}

      {step === "preview" && preview && (
        <>
          <PreviewStep preview={preview} />
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep("map")}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back to Mapping
            </Button>
            <div className="flex items-center gap-3">
              {preview.summary.blockedRows > 0 && (
                <span className="text-sm text-muted-foreground">
                  {preview.summary.blockedRows} blocked row{preview.summary.blockedRows !== 1 ? "s" : ""} will be skipped
                </span>
              )}
              <Button
                onClick={handleExecute}
                disabled={importableCount === 0 || executeMutation.isPending}
              >
                {executeMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Import {importableCount} Row{importableCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === "execute" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm font-medium">Importing clients...</p>
            <p className="text-xs text-muted-foreground mt-1">This may take a moment for large imports.</p>
          </CardContent>
        </Card>
      )}

      {step === "results" && results && (
        <>
          <ResultsStep results={results} />
          <div className="flex justify-center">
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1" />Import Another File
            </Button>
          </div>
        </>
      )}

      {/* Loading overlay for initial parse */}
      {step === "upload" && previewMutation.isPending && (
        <Card>
          <CardContent className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm text-muted-foreground">Parsing CSV...</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
