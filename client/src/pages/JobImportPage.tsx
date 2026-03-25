/**
 * Job CSV Import Wizard — Settings > Import Jobs
 *
 * Five-step wizard:
 *   1. Upload CSV
 *   2. Map columns to Syntraro job fields
 *   3. Preview & validate (company matching, location matching/creation, job # dedup)
 *   4. Execute import
 *   5. View results
 *
 * All imported jobs are created as archived historical records.
 * Companies must already exist (import clients first).
 * Locations may be auto-created under matched companies with sufficient address data.
 */

import { useState, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Briefcase,
  Building2,
  MapPin,
  CreditCard,
  Calendar,
  Tag,
  DollarSign,
  RotateCcw,
  Archive,
  Info,
} from "lucide-react";
import { JOB_IMPORT_FIELD_DEFS } from "@shared/jobImportTypes";
import type { JobColumnMapping, JobImportRow } from "@shared/jobImportTypes";
import { parseCSV } from "@shared/csvParser";

// ============================================================================
// Types
// ============================================================================

type WizardStep = "upload" | "map" | "preview" | "execute" | "results";

interface JobPreviewResponse {
  totalRows: number;
  importableRows: number;
  warningRows: number;
  blockedRows: number;
  conflictRows: number;
  companyMatches: number;
  locationMatches: number;
  locationsToCreate: number;
  duplicateJobNumbers: number;
  existingJobNumbers: number;
  mappings: JobColumnMapping[];
  rows: JobValidatedRow[];
  notice: string;
}

interface JobValidatedRow {
  rowIndex: number;
  row: JobImportRow;
  status: "valid" | "warning" | "blocked";
  errors: string[];
  warnings: string[];
  companyAction: "match" | "blocked";
  companyName?: string;
  locationAction: "match" | "create" | "blocked";
  locationLabel?: string;
  jobNumberParsed?: number;
}

interface JobExecuteResponse {
  imported: number;
  locationsCreated: number;
  skipped: number;
  blocked: number;
  errors: number;
  results: Array<{
    rowIndex: number;
    success: boolean;
    jobId?: string;
    jobNumber?: number;
    locationCreated?: boolean;
    error?: string;
  }>;
  counterReset: { newNextJobNumber: number } | null;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  job: <Briefcase className="h-3.5 w-3.5" />,
  client: <Building2 className="h-3.5 w-3.5" />,
  billing: <CreditCard className="h-3.5 w-3.5" />,
  location: <MapPin className="h-3.5 w-3.5" />,
  dates: <Calendar className="h-3.5 w-3.5" />,
  metadata: <Tag className="h-3.5 w-3.5" />,
  financial: <DollarSign className="h-3.5 w-3.5" />,
};

const GROUP_LABELS: Record<string, string> = {
  job: "Job",
  client: "Client",
  billing: "Billing Address",
  location: "Service Location",
  dates: "Dates",
  metadata: "Metadata",
  financial: "Financial",
};

// ============================================================================
// Summary Card
// ============================================================================

function SummaryCard({ label, value, variant = "default" }: {
  label: string;
  value: number | string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const colors = {
    default: "bg-muted/50",
    success: "bg-green-50 text-green-800",
    warning: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-800",
    info: "bg-blue-50 text-blue-800",
  };
  return (
    <div className={`rounded-lg px-4 py-3 ${colors[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium mt-0.5">{label}</div>
    </div>
  );
}

// ============================================================================
// Step 1: Upload
// ============================================================================

function UploadStep({ onUpload }: { onUpload: (text: string, fileName: string) => void }) {
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && !file.type.includes("csv") && !file.type.includes("text")) return;
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
        <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Upload Jobber Jobs CSV</CardTitle>
        <CardDescription>
          Upload a jobs export from Jobber. Each row imports one historical job record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
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
          <p className="text-sm font-medium">Drop a Jobber jobs CSV here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">Maximum 2,000 rows, 10MB</p>
        </div>

        {/* Important product notices */}
        <Alert>
          <Archive className="h-4 w-4" />
          <AlertTitle>Historical Import</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <p>Imported jobs will be created as <strong>archived</strong> historical records. They can be reopened later through the normal job workflow.</p>
            <p>For best results, <strong>import clients first</strong>, then import jobs. Jobs are matched to existing clients only — new companies are not created by this import.</p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Step 2: Map Columns
// ============================================================================

function MapStep({
  mappings,
  sampleRows,
  onMappingsChange,
}: {
  mappings: JobColumnMapping[];
  sampleRows: string[][];
  onMappingsChange: (m: JobColumnMapping[]) => void;
}) {
  const fieldsByGroup = useMemo(() => {
    const groups: Record<string, typeof JOB_IMPORT_FIELD_DEFS> = {};
    for (const f of JOB_IMPORT_FIELD_DEFS) {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    }
    return groups;
  }, []);

  const usedFields = useMemo(
    () => new Set(mappings.filter(m => m.targetField).map(m => m.targetField!)),
    [mappings]
  );

  const requiredMapped = ["jobNumber", "clientName", "title"].every(f => usedFields.has(f as any));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map CSV Columns</CardTitle>
        <CardDescription>
          Match your CSV headers to Syntraro fields. Job #, Client Name, and Title are required.
          Unmapped optional fields will be ignored.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!requiredMapped && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            Job #, Client Name, and Title must all be mapped to proceed.
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
                        next[idx] = { ...next[idx], targetField: val === "__ignore__" ? null : val as keyof JobImportRow };
                        onMappingsChange(next);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ignore__">
                          <span className="text-muted-foreground">-- Ignore --</span>
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
                    {sampleRows.slice(0, 3).map(row => row[mapping.csvIndex] ?? "").filter(Boolean).join(" | ") || "--"}
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
// Step 3: Preview
// ============================================================================

function PreviewStep({ preview }: { preview: JobPreviewResponse }) {
  const [filter, setFilter] = useState<"all" | "blocked" | "warning" | "ok">("all");

  const filteredRows = useMemo(() => {
    if (filter === "all") return preview.rows;
    if (filter === "blocked") return preview.rows.filter(r => r.status === "blocked");
    if (filter === "warning") return preview.rows.filter(r => r.status === "warning");
    return preview.rows.filter(r => r.status === "valid");
  }, [preview.rows, filter]);

  return (
    <div className="space-y-4">
      {/* Archive notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <Archive className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-800">Archive on Import</AlertTitle>
        <AlertDescription className="text-xs text-blue-700">
          {preview.notice || "All imported jobs will be created as archived historical records."}
        </AlertDescription>
      </Alert>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total Rows" value={preview.totalRows} />
        <SummaryCard label="Importable" value={preview.importableRows} variant="success" />
        <SummaryCard label="Warnings" value={preview.warningRows} variant={preview.warningRows > 0 ? "warning" : "default"} />
        <SummaryCard label="Blocked" value={preview.blockedRows} variant={preview.blockedRows > 0 ? "danger" : "default"} />
        <SummaryCard label="Companies Matched" value={preview.companyMatches} variant="info" />
        <SummaryCard label="Locations Matched" value={preview.locationMatches} variant="info" />
      </div>

      {/* Location creation + dedup notices */}
      <div className="flex flex-wrap gap-2 text-xs">
        {preview.locationsToCreate > 0 && (
          <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
            <MapPin className="h-3 w-3 mr-1" />{preview.locationsToCreate} new location{preview.locationsToCreate !== 1 ? "s" : ""} will be created
          </Badge>
        )}
        {preview.duplicateJobNumbers > 0 && (
          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
            <XCircle className="h-3 w-3 mr-1" />{preview.duplicateJobNumbers} duplicate job #{preview.duplicateJobNumbers !== 1 ? "s" : ""} in CSV
          </Badge>
        )}
        {preview.existingJobNumbers > 0 && (
          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
            <XCircle className="h-3 w-3 mr-1" />{preview.existingJobNumbers} job #{preview.existingJobNumbers !== 1 ? "s" : ""} already exist
          </Badge>
        )}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-1.5">
        {(["all", "ok", "warning", "blocked"] as const).map(f => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFilter(f)}>
            {f === "all" ? `All (${preview.totalRows})` : f === "ok" ? `OK (${preview.importableRows - preview.warningRows})` : f === "warning" ? `Warnings (${preview.warningRows})` : `Blocked (${preview.blockedRows})`}
          </Button>
        ))}
      </div>

      {/* Row table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px] text-xs">#</TableHead>
                  <TableHead className="text-xs w-[70px]">Job #</TableHead>
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs w-[80px]">Company</TableHead>
                  <TableHead className="text-xs w-[80px]">Location</TableHead>
                  <TableHead className="text-xs w-[70px]">Status</TableHead>
                  <TableHead className="text-xs">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(r => (
                  <TableRow key={r.rowIndex} className={r.status === "blocked" ? "bg-red-50/50" : r.status === "warning" ? "bg-amber-50/50" : ""}>
                    <TableCell className="text-xs text-muted-foreground">{r.rowIndex + 1}</TableCell>
                    <TableCell className="text-xs font-mono">{r.row.jobNumber || "--"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{r.row.title || "--"}</TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate">{r.row.clientName || "--"}</TableCell>
                    <TableCell>
                      {r.companyAction === "match" ? (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[10px] px-1">matched</Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px] px-1">not found</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.locationAction === "match" ? (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[10px] px-1">matched</Badge>
                      ) : r.locationAction === "create" ? (
                        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-[10px] px-1">new</Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px] px-1">blocked</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "valid" && <Badge className="bg-green-100 text-green-700 text-[10px] px-1">OK</Badge>}
                      {r.status === "warning" && <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1">Warning</Badge>}
                      {r.status === "blocked" && <Badge className="bg-red-100 text-red-700 text-[10px] px-1">Blocked</Badge>}
                    </TableCell>
                    <TableCell className="text-[10px] text-muted-foreground max-w-[250px]">
                      {r.errors.length > 0 && <span className="text-red-600">{r.errors.join("; ")}</span>}
                      {r.warnings.length > 0 && <span className="text-amber-600">{r.warnings.join("; ")}</span>}
                      {r.errors.length === 0 && r.warnings.length === 0 && r.locationLabel && (
                        <span>{r.locationAction === "create" ? "Create: " : ""}{r.locationLabel}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Step 5: Results
// ============================================================================

function ResultsStep({ results }: { results: JobExecuteResponse }) {
  return (
    <div className="space-y-4">
      <Alert className={results.errors > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}>
        <CheckCircle2 className={`h-4 w-4 ${results.errors > 0 ? "text-amber-600" : "text-green-600"}`} />
        <AlertTitle className={results.errors > 0 ? "text-amber-800" : "text-green-800"}>
          Import Complete
        </AlertTitle>
        <AlertDescription className="text-xs">
          {results.imported} job{results.imported !== 1 ? "s" : ""} imported as archived.
          {results.locationsCreated > 0 && ` ${results.locationsCreated} new location${results.locationsCreated !== 1 ? "s" : ""} created.`}
          {results.blocked > 0 && ` ${results.blocked} row${results.blocked !== 1 ? "s" : ""} blocked.`}
          {results.errors > 0 && ` ${results.errors} error${results.errors !== 1 ? "s" : ""}.`}
          {results.counterReset && ` Next job number: ${results.counterReset.newNextJobNumber}.`}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Imported" value={results.imported} variant="success" />
        <SummaryCard label="Locations Created" value={results.locationsCreated} variant="info" />
        <SummaryCard label="Blocked" value={results.blocked} variant={results.blocked > 0 ? "danger" : "default"} />
        <SummaryCard label="Errors" value={results.errors} variant={results.errors > 0 ? "danger" : "default"} />
      </div>

      {/* Per-row results */}
      {results.results.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Row Results</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-[40px]">#</TableHead>
                    <TableHead className="text-xs w-[70px]">Job #</TableHead>
                    <TableHead className="text-xs w-[80px]">Status</TableHead>
                    <TableHead className="text-xs">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.results.map(r => (
                    <TableRow key={r.rowIndex}>
                      <TableCell className="text-xs text-muted-foreground">{r.rowIndex + 1}</TableCell>
                      <TableCell className="text-xs font-mono">{r.jobNumber || "--"}</TableCell>
                      <TableCell>
                        {r.success ? (
                          <Badge className="bg-green-100 text-green-700 text-[10px] px-1">Imported</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 text-[10px] px-1">Failed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {r.success ? (
                          <>
                            {r.locationCreated && <Badge variant="outline" className="text-[9px] mr-1 border-green-200">new location</Badge>}
                            <span className="text-muted-foreground">ID: {r.jobId?.substring(0, 8)}...</span>
                          </>
                        ) : (
                          <span className="text-red-600">{r.error}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Main Wizard
// ============================================================================

export default function JobImportPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [mappings, setMappings] = useState<JobColumnMapping[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [preview, setPreview] = useState<JobPreviewResponse | null>(null);
  const [results, setResults] = useState<JobExecuteResponse | null>(null);

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async (payload: { csvText: string; mappings?: JobColumnMapping[] }) =>
      apiRequest("/api/job-import/preview", {
        method: "POST",
        body: JSON.stringify(payload),
      }) as Promise<JobPreviewResponse>,
    onSuccess: (data) => {
      setPreview(data);
      if (step === "upload") {
        setMappings(data.mappings);
        setSampleRows(parseCSV(csvText).slice(1, 6));
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
    mutationFn: async (payload: { csvText: string; mappings: JobColumnMapping[] }) =>
      apiRequest("/api/job-import/execute", {
        method: "POST",
        body: JSON.stringify(payload),
      }) as Promise<JobExecuteResponse>,
    onSuccess: (data) => {
      setResults(data);
      setStep("results");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

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
    const importable = preview.rows.filter(r => r.status !== "blocked").length;
    if (importable === 0) {
      toast({ title: "No rows to import", description: "All rows are blocked.", variant: "destructive" });
      return;
    }
    setStep("execute");
    executeMutation.mutate({ csvText, mappings });
  }, [preview, csvText, mappings, executeMutation, toast]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setCsvText("");
    setFileName("");
    setMappings([]);
    setSampleRows([]);
    setPreview(null);
    setResults(null);
  }, []);

  const requiredMapped = ["jobNumber", "clientName", "title"].every(f =>
    mappings.some(m => m.targetField === f)
  );
  const importableCount = preview?.importableRows ?? 0;

  const steps = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map Fields" },
    { key: "preview", label: "Preview" },
    { key: "execute", label: "Import" },
    { key: "results", label: "Results" },
  ];
  const stepOrder = steps.map(s => s.key);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight">Import Jobs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import historical jobs from a Jobber CSV export. All imported jobs are created as archived records.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-border" />}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
              step === s.key ? "bg-primary text-primary-foreground" :
              (stepOrder.indexOf(step) > i ? "text-green-700 bg-green-50" : "text-muted-foreground bg-muted/50")
            }`}>
              {stepOrder.indexOf(step) > i && <CheckCircle2 className="h-3 w-3" />}
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
          <MapStep mappings={mappings} sampleRows={sampleRows} onMappingsChange={setMappings} />
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleReset}>
              <ArrowLeft className="h-4 w-4 mr-1" />Start Over
            </Button>
            <Button onClick={handleValidate} disabled={!requiredMapped || previewMutation.isPending}>
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
              {preview.blockedRows > 0 && (
                <span className="text-sm text-muted-foreground">
                  {preview.blockedRows} blocked row{preview.blockedRows !== 1 ? "s" : ""} will be skipped
                </span>
              )}
              <Button onClick={handleExecute} disabled={importableCount === 0 || executeMutation.isPending}>
                {executeMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Archive className="h-4 w-4 mr-1" />}
                Import {importableCount} Job{importableCount !== 1 ? "s" : ""} as Archived
              </Button>
            </div>
          </div>
        </>
      )}

      {step === "execute" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm font-medium">Importing jobs as archived records...</p>
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
