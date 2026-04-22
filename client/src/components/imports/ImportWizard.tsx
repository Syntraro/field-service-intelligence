/**
 * ImportWizard — canonical 5-step wizard shared by every entity import.
 *
 * Steps:
 *   1. Upload CSV (with template download)
 *   2. Map columns
 *   3. Preview (validation + dedup)
 *   4. Confirm commit (irreversibility warning)
 *   5. Results summary
 *
 * All per-entity behavior lives in the `config` prop. This component
 * contains ZERO entity-specific switches.
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { parseCSV } from "@shared/csvParser";
import { UploadStep } from "./UploadStep";
import { ColumnMapper } from "./ColumnMapper";
import { PreviewTable } from "./PreviewTable";
import { SummaryCards, SummaryIcons, type SummaryItem } from "./SummaryCards";
import type { ColumnMapping, ImportWizardConfig, PreviewResponse, CommitResponse, ValidatedRow } from "./types";

type Step = "upload" | "map" | "preview" | "results";

interface ImportWizardProps {
  config: ImportWizardConfig;
}

export function ImportWizard({ config }: ImportWizardProps) {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState<string>("");
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [preview, setPreview] = useState<PreviewResponse<any, any> | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const headersPreview = useMemo(() => {
    if (!csvText) return { headers: [] as string[], sample: [] as string[][] };
    try {
      const parsed = parseCSV(csvText);
      return {
        headers: parsed[0]?.map((h) => h.trim()) ?? [],
        sample: parsed.slice(1, 4),
      };
    } catch {
      return { headers: [], sample: [] };
    }
  }, [csvText]);

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------

  const previewMutation = useMutation({
    mutationFn: async (opts: { csvText: string; mappings?: ColumnMapping[] }) =>
      apiRequest<PreviewResponse<any, any>>(`/api/imports/${config.entity}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setMappings(data.mappings);
      setStep("preview");
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (rows: any[]) =>
      apiRequest<CommitResponse>(`/api/imports/${config.entity}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
    onSuccess: (data) => {
      setCommit(data);
      setStep("results");
      setConfirmOpen(false);
    },
    onError: () => {
      setConfirmOpen(false);
    },
  });

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleFile = (text: string) => {
    setCsvText(text);
    setPreview(null);
    setCommit(null);
    // Seed mappings from auto-suggest by calling preview WITHOUT user
    // mappings — the backend returns suggested mappings we can edit.
    setStep("map");
    // Trigger the preview so the user can see suggested mappings on Map step.
    previewMutation.mutate(
      { csvText: text },
      {
        onSuccess: (data) => {
          setPreview(data);
          setMappings(data.mappings);
          // Stay on "map" step for user confirmation — preview data is hidden until they hit Continue.
          setStep("map");
        },
      },
    );
  };

  const handleContinueFromMap = () => {
    previewMutation.mutate({ csvText, mappings });
  };

  const commitRows = useMemo(() => {
    if (!preview) return [] as any[];
    // Only rows whose disposition is `created` or `matched` get committed —
    // `skipped` rows are intentional duplicates, `failed` rows are blocked.
    return preview.rows
      .filter((r) => r.disposition === "created" || r.disposition === "matched")
      .map((r) => r.normalized);
  }, [preview]);

  const handleCommitRequest = () => setConfirmOpen(true);
  const handleCommitConfirm = () => commitMutation.mutate(commitRows);

  const handleReset = () => {
    setStep("upload");
    setCsvText("");
    setMappings([]);
    setPreview(null);
    setCommit(null);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const Icon = config.icon;

  return (
    <div className="min-h-screen bg-[#F4F8F4]">
      <main className="mx-auto max-w-6xl px-4 sm:px-5 lg:px-6 py-6 space-y-5">
        <header className="flex items-start justify-between gap-4 pb-3 border-b border-[#e5e7eb]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-white border border-[#e2e8f0]">
              <Icon className="h-5 w-5 text-[#76B054]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#111827] tracking-tight">{config.title}</h1>
              <p className="text-xs text-[#4b5563] mt-0.5">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setLocation("/settings")}>
              Back to Settings
            </Button>
            {step !== "upload" && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                Start over
              </Button>
            )}
          </div>
        </header>

        <StepIndicator step={step} />

        {step === "upload" && <UploadStep config={config} onFile={handleFile} />}

        {step === "map" && (
          <MapStage
            config={config}
            headers={headersPreview.headers}
            sampleData={headersPreview.sample}
            mappings={mappings}
            setMappings={setMappings}
            onBack={handleReset}
            onContinue={handleContinueFromMap}
            loading={previewMutation.isPending}
            error={previewMutation.error instanceof Error ? previewMutation.error.message : null}
          />
        )}

        {step === "preview" && preview && (
          <PreviewStage
            config={config}
            preview={preview}
            onBack={() => setStep("map")}
            onCommit={handleCommitRequest}
            commitLoading={commitMutation.isPending}
            commitError={commitMutation.error instanceof Error ? commitMutation.error.message : null}
            commitableCount={commitRows.length}
          />
        )}

        {step === "results" && commit && (
          <ResultsStage
            config={config}
            commit={commit}
            onReset={handleReset}
            onDone={() => setLocation("/settings")}
          />
        )}
      </main>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import {commitRows.length} {config.rowNoun}?</DialogTitle>
            <DialogDescription>
              {config.commitBanner ?? "This will write records directly to your account. Skipped duplicate rows won't be committed; failed rows are excluded automatically."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCommitConfirm} disabled={commitMutation.isPending}>
              {commitMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Confirm import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step indicator
// ----------------------------------------------------------------------------

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map" },
    { key: "preview", label: "Preview" },
    { key: "results", label: "Done" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const isDone = i < activeIndex;
        const isActive = i === activeIndex;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                isActive
                  ? "bg-[#76B054] text-white"
                  : isDone
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-xs font-medium ${isActive ? "text-[#111827]" : "text-[#4b5563]"}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-[#e2e8f0]" />}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Map stage
// ----------------------------------------------------------------------------

function MapStage({
  config, headers, sampleData, mappings, setMappings, onBack, onContinue, loading, error,
}: {
  config: ImportWizardConfig;
  headers: string[];
  sampleData: string[][];
  mappings: ColumnMapping[];
  setMappings: (m: ColumnMapping[]) => void;
  onBack: () => void;
  onContinue: () => void;
  loading: boolean;
  error: string | null;
}) {
  const missingRequired = config.fieldDefs
    .filter((f) => f.required)
    .filter((f) => !mappings.some((m) => m.targetField === f.key));

  return (
    <div className="space-y-4">
      <ColumnMapper
        config={config}
        headers={headers}
        sampleData={sampleData}
        mappings={mappings}
        onChange={setMappings}
      />
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-[#e2e8f0]">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button onClick={onContinue} disabled={missingRequired.length > 0 || loading}>
          {loading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Validate & preview
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Preview stage
// ----------------------------------------------------------------------------

function PreviewStage({
  config, preview, onBack, onCommit, commitLoading, commitError, commitableCount,
}: {
  config: ImportWizardConfig;
  preview: PreviewResponse<any, any>;
  onBack: () => void;
  onCommit: () => void;
  commitLoading: boolean;
  commitError: string | null;
  commitableCount: number;
}) {
  const summaryItems: SummaryItem[] = [
    { label: "Total rows", value: preview.summary.totalRows, icon: SummaryIcons.ListChecks },
    { label: "Created", value: preview.summary.toCreate, icon: SummaryIcons.CheckCircle2, tone: "emerald" },
    { label: "Matched", value: preview.summary.toMatch, icon: SummaryIcons.CheckCircle2, tone: "blue" },
    { label: "Skipped", value: preview.summary.toSkip, icon: SummaryIcons.AlertTriangle, tone: "slate" },
    { label: "Blocked", value: preview.summary.blockedRows, icon: SummaryIcons.XCircle, tone: "red" },
    { label: "Duplicates in CSV", value: preview.summary.withinCsvDuplicates, icon: SummaryIcons.AlertTriangle, tone: "amber" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#111827]">Preview</h2>
        <p className="text-sm text-[#4b5563] mt-1">
          Review how each row will be committed. Blocked rows are never imported; skipped rows are duplicates of earlier rows in this CSV.
        </p>
      </div>

      {preview.columnCountWarnings?.map((msg, i) => (
        <Alert key={i}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{msg}</AlertDescription>
        </Alert>
      ))}

      <SummaryCards items={summaryItems} />
      <PreviewTable preview={preview} />

      {commitError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{commitError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-[#e2e8f0]">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to mapping
        </Button>
        <Button onClick={onCommit} disabled={commitableCount === 0 || commitLoading} size="lg">
          {commitLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Import {commitableCount} {config.rowNoun}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Results stage
// ----------------------------------------------------------------------------

function ResultsStage({
  config, commit, onReset, onDone,
}: {
  config: ImportWizardConfig;
  commit: CommitResponse;
  onReset: () => void;
  onDone: () => void;
}) {
  const items: SummaryItem[] = [
    { label: "Total", value: commit.summary.totalRows, icon: SummaryIcons.ListChecks },
    { label: "Created", value: commit.summary.created, icon: SummaryIcons.CheckCircle2, tone: "emerald" },
    { label: "Matched", value: commit.summary.matched, icon: SummaryIcons.CheckCircle2, tone: "blue" },
    { label: "Skipped", value: commit.summary.skipped, icon: SummaryIcons.AlertTriangle, tone: "slate" },
    { label: "Failed", value: commit.summary.failed, icon: SummaryIcons.XCircle, tone: "red" },
  ];
  const failedRows = commit.results.filter((r) => r.disposition === "failed");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {commit.summary.failed === 0 ? (
          <>
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <h2 className="text-lg font-semibold text-[#111827]">Import complete</h2>
          </>
        ) : (
          <>
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            <h2 className="text-lg font-semibold text-[#111827]">Import completed with errors</h2>
          </>
        )}
      </div>
      <SummaryCards items={items} />

      {failedRows.length > 0 && (
        <div className="rounded-md border border-red-200 overflow-hidden">
          <div className="px-3 py-2 bg-red-50 text-xs font-semibold text-red-800">
            Failed rows ({failedRows.length})
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-[#4b5563] bg-slate-50">
                  <th className="px-3 py-1.5 w-14">Row</th>
                  <th className="px-3 py-1.5">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {failedRows.map((r) => (
                  <tr key={r.rowIndex}>
                    <td className="px-3 py-1.5 tabular-nums">{r.rowIndex + 2}</td>
                    <td className="px-3 py-1.5 text-red-700">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-[#e2e8f0]">
        <Button variant="outline" onClick={onReset}>
          Import another file
        </Button>
        <Button onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
