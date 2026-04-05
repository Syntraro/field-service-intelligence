/**
 * ProductImportPage — 5-step CSV import wizard for Products & Services.
 *
 * Follows the same UX pattern as ClientImportPage and JobImportPage:
 * Step 1: Upload CSV
 * Step 2: Map columns
 * Step 3: Preview & validate
 * Step 4: Execute import
 * Step 5: Results summary
 */

import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Download,
} from "lucide-react";
import { Link } from "wouter";
import type {
  ProductColumnMapping,
  ProductImportPreviewResponse,
  ProductImportExecuteResponse,
  ProductValidatedRow,
  ProductImportRow,
} from "@shared/productImportTypes";
import { PRODUCT_IMPORT_FIELD_DEFS } from "@shared/productImportTypes";

type Step = 1 | 2 | 3 | 4 | 5;

export default function ProductImportPage() {
  const [step, setStep] = useState<Step>(1);
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [mappings, setMappings] = useState<ProductColumnMapping[]>([]);
  const [preview, setPreview] = useState<ProductImportPreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ProductImportExecuteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<"all" | "errors" | "warnings" | "clean">("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ========================================================================
  // Step 1: File Upload
  // ========================================================================

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please select a CSV file." });
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.toLowerCase().endsWith(".csv")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please drop a CSV file." });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }, [toast]);

  // ========================================================================
  // Step 2: Preview (auto-suggest mappings on first load, or re-preview with user mappings)
  // ========================================================================

  const fetchPreview = useCallback(async (customMappings?: ProductColumnMapping[]) => {
    setIsLoading(true);
    try {
      const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
      const { csrfToken } = await csrfRes.json();

      const body: any = { csvText };
      if (customMappings) body.mappings = customMappings;

      const res = await fetch("/api/product-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Preview failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const data: ProductImportPreviewResponse = await res.json();
      setPreview(data);
      setMappings(data.suggestedMappings);
      return data;
    } catch (err: any) {
      toast({ variant: "destructive", title: "Preview failed", description: err.message });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [csvText, toast]);

  const handleStep1Next = useCallback(async () => {
    const data = await fetchPreview();
    if (data) setStep(2);
  }, [fetchPreview]);

  const handleStep2Next = useCallback(async () => {
    // Re-preview with user-adjusted mappings
    const data = await fetchPreview(mappings);
    if (data) setStep(3);
  }, [fetchPreview, mappings]);

  // ========================================================================
  // Step 4: Execute
  // ========================================================================

  const handleExecute = useCallback(async () => {
    if (!preview) return;

    // Collect non-blocked rows
    const importableRows: ProductImportRow[] = preview.rows
      .filter((r) => r.status !== "blocked" && r.itemAction === "create")
      .map((r) => r.normalized);

    if (importableRows.length === 0) {
      toast({ variant: "destructive", title: "Nothing to import", description: "No new items to create." });
      return;
    }

    setStep(4);
    setIsLoading(true);

    try {
      const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch("/api/product-import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ rows: importableRows }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Import failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const data: ProductImportExecuteResponse = await res.json();
      setExecuteResult(data);
      // Invalidate items cache
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setStep(5);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Import failed", description: err.message });
      setStep(3); // Go back to preview
    } finally {
      setIsLoading(false);
    }
  }, [preview, toast, queryClient]);

  // ========================================================================
  // Mapping helpers
  // ========================================================================

  const usedFields = useMemo(() => {
    const set = new Set<string>();
    for (const m of mappings) {
      if (m.targetField) set.add(m.targetField);
    }
    return set;
  }, [mappings]);

  const handleMappingChange = useCallback((csvIndex: number, targetField: string | null) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.csvIndex === csvIndex
          ? { ...m, targetField: (targetField === "__ignore__" ? null : targetField) as any }
          : m
      )
    );
  }, []);

  const hasRequiredMappings = useMemo(() => {
    return usedFields.has("name") && usedFields.has("type") && usedFields.has("unitPrice");
  }, [usedFields]);

  // ========================================================================
  // Preview filter
  // ========================================================================

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    switch (previewFilter) {
      case "errors": return preview.rows.filter((r) => r.status === "blocked");
      case "warnings": return preview.rows.filter((r) => r.status === "warning");
      case "clean": return preview.rows.filter((r) => r.status === "valid");
      default: return preview.rows;
    }
  }, [preview, previewFilter]);

  // ========================================================================
  // CSV export helpers
  // ========================================================================

  const exportRows = useCallback((rows: ProductValidatedRow[], label: string) => {
    const csvLines = [
      ["Row", "Name", "Type", "Unit Price", "Status", "Action", "Issues"].join(","),
      ...rows.map((r) => [
        r.rowIndex + 2,
        `"${(r.normalized.name || "").replace(/"/g, '""')}"`,
        r.normalized.type,
        r.normalized.unitPrice,
        r.status,
        r.itemAction,
        `"${[...r.errors.map(e => e.message), ...r.warnings].join("; ").replace(/"/g, '""')}"`,
      ].join(",")),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `product-import-${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ========================================================================
  // Reset
  // ========================================================================

  const handleReset = useCallback(() => {
    setStep(1);
    setCsvText("");
    setFileName("");
    setMappings([]);
    setPreview(null);
    setExecuteResult(null);
    setPreviewFilter("all");
  }, []);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Import Products & Services</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload a CSV file to bulk-import your product and service catalog.
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                s === step ? "bg-primary text-primary-foreground" :
                s < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {s < step ? <CheckCircle2 className="h-4 w-4" /> : s}
            </div>
            <span className={s === step ? "font-medium" : "text-muted-foreground"}>
              {["Upload", "Map", "Preview", "Import", "Results"][s - 1]}
            </span>
            {s < 5 && <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      {/* ================================================================ */}
      {/* Step 1: Upload */}
      {/* ================================================================ */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Upload CSV File
            </CardTitle>
            <CardDescription>
              Upload a CSV with your products and services. Required columns: Name, Category (product/service), Unit Price.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById("csv-file-input")?.click()}
            >
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              {csvText ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="h-10 w-10 mx-auto text-primary" />
                  <p className="font-medium">{fileName}</p>
                  <p className="text-sm text-muted-foreground">
                    {csvText.split("\n").length - 1} rows detected. Click to choose a different file.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="text-muted-foreground">Drag & drop a CSV file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground">Max 1,000 rows, 5MB</p>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <Button onClick={handleStep1Next} disabled={!csvText || isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Next: Map Columns
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Step 2: Map Columns */}
      {/* ================================================================ */}
      {step === 2 && preview && (
        <Card>
          <CardHeader>
            <CardTitle>Map CSV Columns</CardTitle>
            <CardDescription>
              Match your CSV columns to product fields. Required: Name, Category, Unit Price.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">CSV Column</th>
                    <th className="text-left p-2">Map To</th>
                    <th className="text-left p-2">Sample Values</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.csvIndex} className="border-b">
                      <td className="p-2 font-medium">{m.csvHeader}</td>
                      <td className="p-2">
                        <Select
                          value={m.targetField ?? "__ignore__"}
                          onValueChange={(val) => handleMappingChange(m.csvIndex, val)}
                        >
                          <SelectTrigger className="w-[200px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__ignore__">— Ignore —</SelectItem>
                            {PRODUCT_IMPORT_FIELD_DEFS.map((f) => (
                              <SelectItem
                                key={f.key}
                                value={f.key}
                                disabled={usedFields.has(f.key) && m.targetField !== f.key}
                              >
                                {f.label} {f.required ? "*" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2 text-muted-foreground text-xs">
                        {preview.sampleData.slice(0, 3).map((row, i) => (
                          <span key={i}>
                            {row[m.csvIndex]?.substring(0, 40) || "—"}
                            {i < 2 ? " | " : ""}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!hasRequiredMappings && (
              <Alert className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Please map at least: <strong>Name</strong>, <strong>Category / Type</strong>, and <strong>Unit Price</strong>.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={handleStep2Next} disabled={!hasRequiredMappings || isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Next: Preview
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Step 3: Preview & Validate */}
      {/* ================================================================ */}
      {step === 3 && preview && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-2xl font-bold">{preview.summary.totalRows}</div>
              <div className="text-xs text-muted-foreground">Total Rows</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-green-600">{preview.summary.newItems}</div>
              <div className="text-xs text-muted-foreground">New Items</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-blue-600">{preview.summary.duplicateItems}</div>
              <div className="text-xs text-muted-foreground">Duplicates (Skip)</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-red-600">{preview.summary.blockedRows}</div>
              <div className="text-xs text-muted-foreground">Blocked</div>
            </Card>
          </div>

          {preview.summary.withinCsvDuplicates > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {preview.summary.withinCsvDuplicates} duplicate(s) detected within your CSV file.
              </AlertDescription>
            </Alert>
          )}

          {preview.columnCountWarnings && preview.columnCountWarnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Column count mismatch detected in some rows. Check for unquoted commas.
              </AlertDescription>
            </Alert>
          )}

          {/* Warning legend */}
          {preview.warningLegend && Object.keys(preview.warningLegend).length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-medium mb-1">Warning Legend</div>
              <div className="space-y-0.5">
                {Object.entries(preview.warningLegend).map(([code, msg]) => (
                  <div key={code} className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-1 text-[10px] px-1">W{code}</Badge>
                    {msg}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Filter + export */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(["all", "errors", "warnings", "clean"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={previewFilter === f ? "default" : "outline"}
                  onClick={() => setPreviewFilter(f)}
                >
                  {f === "all" ? `All (${preview.rows.length})` :
                   f === "errors" ? `Blocked (${preview.summary.blockedRows})` :
                   f === "warnings" ? `Warnings (${preview.summary.warningRows})` :
                   `Clean (${preview.summary.validRows})`}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportRows(filteredRows, previewFilter)}
            >
              <Download className="h-3 w-3 mr-1" /> Export
            </Button>
          </div>

          {/* Row table */}
          <Card>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Price</th>
                    <th className="text-left p-2">Action</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.rowIndex} className="border-b hover:bg-muted/50">
                      <td className="p-2 text-muted-foreground">{row.rowIndex + 2}</td>
                      <td className="p-2 max-w-[200px] truncate">{row.normalized.name || "—"}</td>
                      <td className="p-2">{row.normalized.type}</td>
                      <td className="p-2">${row.normalized.unitPrice}</td>
                      <td className="p-2">
                        <Badge variant={row.itemAction === "create" ? "default" : "secondary"} className="text-[10px]">
                          {row.itemAction === "create" ? "new" : "exists"}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {row.status === "valid" && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                        {row.status === "warning" && <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />}
                        {row.status === "blocked" && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                      </td>
                      <td className="p-2 max-w-[250px]">
                        {row.errors.map((e, i) => (
                          <span key={i} className="text-red-600">{e.message}{i < row.errors.length - 1 ? "; " : ""}</span>
                        ))}
                        {row.warningCodes && row.warningCodes.length > 0 && (
                          <span className="text-yellow-600 ml-1">
                            {row.warningCodes.map(c => `W${c}`).join(", ")}
                          </span>
                        )}
                        {row.matchesExisting && row.existingItemName && (
                          <span className="text-blue-600 ml-1">matches "{row.existingItemName}"</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted-foreground">
                        No rows match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Mapping
            </Button>
            <Button
              onClick={handleExecute}
              disabled={preview.summary.newItems === 0}
            >
              Import {preview.summary.newItems} Item{preview.summary.newItems !== 1 ? "s" : ""}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Step 4: Executing */}
      {/* ================================================================ */}
      {step === 4 && isLoading && (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-lg font-medium">Importing products & services...</p>
            <p className="text-sm text-muted-foreground">This may take a moment.</p>
          </div>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Step 5: Results */}
      {/* ================================================================ */}
      {step === 5 && executeResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-2xl font-bold">{executeResult.summary.totalRows}</div>
              <div className="text-xs text-muted-foreground">Total Processed</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-green-600">{executeResult.summary.itemsCreated}</div>
              <div className="text-xs text-muted-foreground">Items Created</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-blue-600">{executeResult.summary.itemsSkipped}</div>
              <div className="text-xs text-muted-foreground">Duplicates Skipped</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-red-600">{executeResult.summary.failedRows}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </Card>
          </div>

          {executeResult.summary.failedRows > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Failed Rows</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Row</th>
                        <th className="text-left p-2">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executeResult.results
                        .filter((r) => !r.success)
                        .map((r) => (
                          <tr key={r.rowIndex} className="border-b">
                            <td className="p-2">{r.rowIndex + 2}</td>
                            <td className="p-2 text-red-600">{r.error}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-center">
            <Button onClick={handleReset}>
              <Upload className="h-4 w-4 mr-2" /> Import Another File
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
