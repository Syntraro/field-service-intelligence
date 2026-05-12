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

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { parseCSV } from "@shared/csvParser";
import { Info } from "lucide-react";
import { UploadStep } from "./UploadStep";
import { ColumnMapper } from "./ColumnMapper";
import { PreviewTable } from "./PreviewTable";
import { SummaryCards, SummaryIcons, type SummaryItem } from "./SummaryCards";
import { CustomFieldPlanSummary } from "./CustomFieldPlanSummary";
import type { ColumnMapping, ImportWizardConfig, PreviewResponse, CommitResponse, ValidatedRow, CustomFieldEntityId } from "./types";
import type { SourceId, ProviderPreset } from "./presets/types";
import { applyPresetMappings } from "./presets";
import {
  columnPlansFromMappings,
  customFieldPlansFromPlan,
  mappingsFromPlan,
  mergeBackendMappings,
  validatePlan,
  type ColumnPlan,
  type CustomFieldPlan,
} from "./importPlan";

export type Step = "upload" | "map" | "preview" | "results";

/**
 * Headers-only CSV parse, resilient to malformed content (returns empty
 * arrays rather than throwing). Used when applying an explicit preset
 * to the uploaded file's headers.
 */
function safeParseHeaders(csvText: string): { headers: string[] } {
  if (!csvText) return { headers: [] };
  try {
    const parsed = parseCSV(csvText);
    return { headers: parsed[0]?.map((h) => h.trim()) ?? [] };
  } catch {
    return { headers: [] };
  }
}

/**
 * Full CSV parse with the header row stripped — rows only. Used by the
 * Phase-2a post-commit value-write stage to look up the source cell for
 * each imported entity's custom-field values.
 */
function safeParseRows(csvText: string): string[][] {
  if (!csvText) return [];
  try {
    const parsed = parseCSV(csvText);
    return parsed.slice(1);
  } catch {
    return [];
  }
}

/**
 * 2026-04-22 Phase 2b: resolve the canonical entity id to target for a
 * given custom-field plan entity, given a commit-response row outcome.
 * Prefers the adapter-populated `relatedEntities` payload, falls back to
 * `entityId` when the adapter only exposes a single write target (Jobs,
 * Products today).
 */
function resolveEntityId(
  entity: "job" | "customer_company" | "client_location" | "item",
  outcome: { entityId?: string; relatedEntities?: Record<string, string | undefined> },
): string | undefined {
  const rel = outcome.relatedEntities ?? {};
  switch (entity) {
    case "job":              return rel.jobId ?? outcome.entityId;
    case "customer_company": return rel.customerCompanyId ?? outcome.entityId;
    case "client_location":  return rel.locationId;
    case "item":             return rel.itemId ?? outcome.entityId;
    default:                 return undefined;
  }
}

/**
 * Look up the preset for a given (source, entity). Generic CSV always
 * returns null (no preset). Jobber / Housecall Pro / other providers
 * return a preset if one is registered on the entity's config, else null
 * (triggers the "preset not yet available" fallback notice).
 */
function findPresetFor(
  config: ImportWizardConfig,
  source: SourceId,
): ProviderPreset | null {
  if (source === "generic_csv") return null;
  return (config.presets ?? []).find((p) => p.source === source) ?? null;
}

interface ImportWizardProps {
  config: ImportWizardConfig;
  /**
   * "standalone" (default) — renders the full-page wrapper + header, used
   * when the wizard is the route's sole content (the legacy per-entity
   * pages). "embedded" — renders only the step indicator + active step +
   * dialogs. The host page (e.g. ImportCenterPage) owns the page chrome
   * and the header. No behavior differences — the body is identical.
   */
  variant?: "standalone" | "embedded";
  /**
   * 2026-04-23: when true, the wizard does NOT render its own step
   * indicator inline. Hosts that want the step strip at a different
   * position on the page (e.g. ImportCenterPage renders it above the
   * entity chooser) set this true and render `<StepIndicator step={...} />`
   * themselves, using the step reported via `onStepChange`.
   */
  hideStepIndicator?: boolean;
  /**
   * 2026-04-23: callback fired whenever the wizard advances to a new
   * step. Hosts opt in by passing this prop and can use it to drive a
   * hoisted step indicator (see `hideStepIndicator`).
   */
  onStepChange?: (step: Step) => void;
}

export function ImportWizard({
  config,
  variant = "standalone",
  hideStepIndicator = false,
  onStepChange,
}: ImportWizardProps) {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("upload");

  // 2026-04-23: report step transitions to the host when it asked to
  // drive the indicator itself. Fires on mount + every step change so
  // the hoisted indicator lands on the right state on first paint.
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);
  const [csvText, setCsvText] = useState<string>("");
  // 2026-04-22 Phase 2a: columns carry actions (ignore / map_existing /
  // create_custom), not just target fields. Backend sees only the
  // map_existing subset via `mappingsFromPlan`; custom-field plans are
  // orchestrated on commit. See `importPlan.ts`.
  const [plans, setPlans] = useState<ColumnPlan[]>([]);
  const [preview, setPreview] = useState<PreviewResponse<any, any> | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Orchestration stage during commit with custom-field plans. */
  const [commitStage, setCommitStage] = useState<
    "idle" | "creating_fields" | "importing_rows" | "writing_values"
  >("idle");
  /** Last post-commit failure surfaced to the user (definition creation or value-write). */
  const [commitError, setCommitError] = useState<string | null>(null);
  // 2026-04-22 explicit-source imports: the user MUST pick a source
  // before uploading — no auto-detection, no silent switching. `null`
  // means "not yet chosen" and the Upload step shows only the
  // SourceSelector until the user picks one.
  const [source, setSource] = useState<SourceId | null>(null);

  // Derived views of `plans` used across render + mutation call sites.
  const mappings = useMemo(() => mappingsFromPlan(plans), [plans]);

  // 2026-04-22 Phase 2b: existing tenant-scoped reference-field definitions.
  // Fetched once when the wizard reaches the Map step so we can annotate
  // create_custom plans as "reuse existing" before commit, and skip
  // duplicate-definition POSTs during Stage 1 of the commit.
  const { data: existingDefsData } = useQuery<{ definitions: Array<{
    id: string;
    label: string;
    appliesToJobs: boolean;
    appliesToQuotes: boolean;
    appliesToInvoices: boolean;
    appliesToCustomers: boolean;
    appliesToLocations: boolean;
    appliesToProducts: boolean;
    active: boolean;
  }> }>({
    queryKey: ["/api/reference-fields", "active"],
    queryFn: () => apiRequest("/api/reference-fields?active=true"),
    enabled: (config.customFieldEntities ?? []).length > 0 && step !== "upload",
    staleTime: 30_000,
  });

  // Build a map of `"{entity}::{normalizedLabel}"` → existing definition id
  // across all 4 supported import entities. Filters to active defs only.
  const existingDefinitionsByEntityLabel = useMemo(() => {
    const map = new Map<string, string>();
    if (!existingDefsData?.definitions) return map;
    for (const def of existingDefsData.definitions) {
      if (!def.active) continue;
      const norm = def.label.trim().toLowerCase();
      if (def.appliesToJobs)      map.set(`job::${norm}`, def.id);
      if (def.appliesToCustomers) map.set(`customer_company::${norm}`, def.id);
      if (def.appliesToLocations) map.set(`client_location::${norm}`, def.id);
      if (def.appliesToProducts)  map.set(`item::${norm}`, def.id);
    }
    return map;
  }, [existingDefsData]);

  const existingDefinitionKeys = useMemo(
    () => new Set(existingDefinitionsByEntityLabel.keys()),
    [existingDefinitionsByEntityLabel],
  );

  // Raw list of custom-field plans (entity is carried per-column in Phase 2b).
  // `reusedExisting` is filled in during commit based on the fetched defs.
  const customFieldPlans: CustomFieldPlan[] = useMemo(
    () => ((config.customFieldEntities ?? []).length > 0 ? customFieldPlansFromPlan(plans) : []),
    [plans, config.customFieldEntities],
  );

  // Plans annotated with reuse state for the Preview summary.
  const annotatedCustomFieldPlans: CustomFieldPlan[] = useMemo(
    () => customFieldPlans.map((p) => ({
      ...p,
      reusedExisting: existingDefinitionsByEntityLabel.has(
        `${p.entity}::${p.label.trim().toLowerCase()}`,
      ),
    })),
    [customFieldPlans, existingDefinitionsByEntityLabel],
  );

  // Label lookup for the Preview summary — built from the active config.
  const entityLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const opt of config.customFieldEntities ?? []) {
      map[opt.id] = opt.label;
    }
    return map as Record<CustomFieldEntityId, string>;
  }, [config.customFieldEntities]);

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
    // Default onSuccess intentionally omitted — every call-site passes its
    // own onSuccess so plan merge semantics stay explicit (first-load
    // overwrites; mid-session keeps user-set create_custom actions).
  });

  /**
   * Phase 2b custom-field-aware commit mutation. Runs three sequential
   * stages when customFieldPlans is non-empty:
   *   1. `creating_fields` — for each plan, if a matching tenant-scoped
   *      definition already exists (same normalized label + entity scope),
   *      reuse its id. Otherwise create via POST /api/reference-fields with
   *      the correct `appliesTo<Entity>` flag. Fail-closed: any definition
   *      creation failure aborts before touching entity rows.
   *   2. `importing_rows`  — POST /api/imports/:entity/commit as today.
   *   3. `writing_values`  — per successful result row, resolve the correct
   *      write-target entity id per custom-field plan (from `relatedEntities`
   *      when the adapter populated it, else fall back to `entityId`), group
   *      values by target entity, and PUT /api/reference-fields/entities/
   *      :entityType/:entityId once per group.
   *
   * Empty customFieldPlans short-circuits to stage 2 only — behavior
   * identical to pre-Phase-2 commits.
   */
  const commitMutation = useMutation({
    mutationFn: async (input: {
      rows: any[];
      plans: CustomFieldPlan[];
      csvText: string;
    }): Promise<CommitResponse> => {
      const { rows, plans: fieldPlans, csvText: csv } = input;

      // ── Stage 1: resolve or create definitions ──────────────────────
      const resolvedPlans: CustomFieldPlan[] = [];
      if (fieldPlans.length > 0) {
        setCommitStage("creating_fields");
        for (const plan of fieldPlans) {
          const key = `${plan.entity}::${plan.label.trim().toLowerCase()}`;
          const existingId = existingDefinitionsByEntityLabel.get(key);
          if (existingId) {
            resolvedPlans.push({ ...plan, createdDefinitionId: existingId, reusedExisting: true });
            continue;
          }
          const created = await apiRequest<{ definition: { id: string } }>(
            "/api/reference-fields",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                label: plan.label,
                // Backend auto-derives `key` from label; no need to send.
                appliesToJobs:      plan.entity === "job",
                appliesToCustomers: plan.entity === "customer_company",
                appliesToLocations: plan.entity === "client_location",
                appliesToProducts:  plan.entity === "item",
                searchable: true,
              }),
            },
          );
          resolvedPlans.push({ ...plan, createdDefinitionId: created.definition.id });
        }
      }

      // ── Stage 2: import entity rows ─────────────────────────────────
      setCommitStage("importing_rows");
      const response = await apiRequest<CommitResponse>(
        `/api/imports/${config.entity}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        },
      );

      // ── Stage 3: write per-row values per entity target ─────────────
      if (resolvedPlans.length > 0 && response.results.length > 0) {
        setCommitStage("writing_values");
        const csvRows = safeParseRows(csv);

        for (const outcome of response.results) {
          if (outcome.disposition === "failed") continue;
          if (!outcome.entityId && !outcome.relatedEntities) continue;
          const csvRow = csvRows[outcome.rowIndex];
          if (!csvRow) continue;

          // Group resolved plans by target entity so we make one PUT per
          // (entity, entityId) pair rather than one per custom field.
          const valuesByEntity = new Map<
            CustomFieldEntityId,
            Array<{ definitionId: string; textValue: string }>
          >();
          for (const cf of resolvedPlans) {
            const textValue = (csvRow[cf.csvIndex] ?? "").trim();
            if (!textValue) continue;
            const list = valuesByEntity.get(cf.entity) ?? [];
            list.push({ definitionId: cf.createdDefinitionId!, textValue });
            valuesByEntity.set(cf.entity, list);
          }
          if (valuesByEntity.size === 0) continue;

          for (const [entity, values] of Array.from(valuesByEntity.entries())) {
            const targetId = resolveEntityId(entity, outcome);
            if (!targetId) continue;
            try {
              await apiRequest(
                `/api/reference-fields/entities/${entity}/${targetId}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ values }),
                },
              );
            } catch (err) {
              // Best-effort: one row's value-write failure does not abort the
              // whole post-commit pass. The row's entity is already created;
              // the user can add missing custom-field values manually from the
              // entity detail page.
              console.error("[import] custom-field value write failed", {
                entity, targetId, err,
              });
            }
          }
        }
      }

      setCommitStage("idle");
      return response;
    },
    onSuccess: (data) => {
      setCommit(data);
      setCommitError(null);
      setStep("results");
      setConfirmOpen(false);
    },
    onError: (err: unknown) => {
      setCommitStage("idle");
      setCommitError(err instanceof Error ? err.message : "Import failed.");
      setConfirmOpen(false);
    },
  });

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  /**
   * File uploaded. Source is already picked (the UploadStep gates the
   * file picker behind source selection). Behavior by source:
   *   - Generic CSV → ask backend for header suggestions (existing flow).
   *   - Jobber / Housecall Pro (preset present) → apply preset mappings
   *     client-side, skip the round-trip. User lands on Map step with
   *     columns pre-mapped.
   *   - Jobber / Housecall Pro (no preset for this entity yet, e.g. HCP)
   *     → fall through to backend suggestions. The Map step shows a
   *     non-blocking notice so the user knows preset mapping isn't
   *     available for that pick.
   */
  const handleFile = (text: string) => {
    setCsvText(text);
    setPreview(null);
    setCommit(null);
    setStep("map");

    if (!source) return; // defensive — UploadStep should never call us before source is picked

    const preset = findPresetFor(config, source);
    if (preset) {
      const { headers } = safeParseHeaders(text);
      const presetMappings = applyPresetMappings(headers, preset);
      setPlans(columnPlansFromMappings(presetMappings));
      return; // no round-trip — user will Continue from Map
    }

    // Generic CSV, OR a provider we don't yet have a preset for on this
    // entity → backend header suggestions (existing behavior).
    previewMutation.mutate(
      { csvText: text },
      {
        onSuccess: (data) => {
          setPreview(data);
          // Initial load: overwrite plans from backend mappings. User has
          // not yet set any create_custom actions, so mergeBackendMappings
          // would be equivalent but plain overwrite is clearer here.
          setPlans(columnPlansFromMappings(data.mappings));
          setStep("map");
        },
      },
    );
  };

  const handleSelectSource = (next: SourceId) => {
    setSource(next);
  };

  /**
   * User clicked "Change" on the source chip in the Upload step. Reset
   * source + any state derived from it, return to the source-picker UI.
   */
  const handleResetSource = () => {
    setSource(null);
    setCsvText("");
    setPlans([]);
    setPreview(null);
  };

  const handleContinueFromMap = () => {
    // Send only the map_existing subset — backend doesn't know about
    // custom-field columns yet; they're orchestrated on commit.
    previewMutation.mutate(
      { csvText, mappings: mappingsFromPlan(plans) },
      {
        onSuccess: (data) => {
          setPreview(data);
          // Mid-session preview round-trip: preserve user's create_custom
          // actions via mergeBackendMappings.
          setPlans(mergeBackendMappings(plans, data.mappings));
          setStep("preview");
        },
      },
    );
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
  const handleCommitConfirm = () =>
    commitMutation.mutate({ rows: commitRows, plans: customFieldPlans, csvText });

  const handleReset = () => {
    setStep("upload");
    setCsvText("");
    setPlans([]);
    setPreview(null);
    setCommit(null);
    setSource(null);
    setCommitStage("idle");
    setCommitError(null);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const Icon = config.icon;

  // Body — identical in both variants; the shell wrapping it differs.
  // 2026-04-23: the step indicator is suppressed when the host opted to
  // hoist it to a different page position.
  const body = (
    <>
      {!hideStepIndicator && <StepIndicator step={step} />}

      {step === "upload" && (
        <UploadStep
          config={config}
          source={source}
          onSelectSource={handleSelectSource}
          onResetSource={handleResetSource}
          onFile={handleFile}
        />
      )}

      {step === "map" && (
        <>
          <MapStepNotice source={source} preset={source ? findPresetFor(config, source) : null} />
          <MapStage
            config={config}
            headers={headersPreview.headers}
            sampleData={headersPreview.sample}
            plans={plans}
            setPlans={setPlans}
            existingDefinitionKeys={existingDefinitionKeys}
            onBack={handleReset}
            onContinue={handleContinueFromMap}
            loading={previewMutation.isPending}
            error={previewMutation.error instanceof Error ? previewMutation.error.message : null}
          />
        </>
      )}

      {step === "preview" && preview && (
        <PreviewStage
          config={config}
          preview={preview}
          customFieldPlans={annotatedCustomFieldPlans}
          entityLabels={entityLabels}
          onBack={() => setStep("map")}
          onCommit={handleCommitRequest}
          commitLoading={commitMutation.isPending}
          commitStage={commitStage}
          commitError={commitError ?? (commitMutation.error instanceof Error ? commitMutation.error.message : null)}
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
    </>
  );

  if (variant === "embedded") {
    // Host page owns the shell + header. Expose "Start over" as a compact
    // right-aligned action so the user can reset without leaving the page.
    return (
      <div className="space-y-5" data-testid={`import-wizard-${config.entity}`}>
        {step !== "upload" && (
          <div className="flex items-center justify-end">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Start over
            </Button>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <main className="mx-auto max-w-6xl px-4 sm:px-5 lg:px-6 py-6 space-y-5" data-testid={`import-wizard-${config.entity}`}>
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

        {body}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Map-step notice — surfaces preset status inline above the ColumnMapper.
// Three states:
//   - Preset applied (Jobber / HCP with a preset): emerald note listing
//     what happened + the preset's limitations.
//   - Source picked but no preset for this entity (e.g. Housecall Pro on
//     Jobs before we ship HCP presets): slate note, non-blocking, tells
//     the user to map manually.
//   - Generic CSV: no note (column mapper itself is sufficient affordance).
// ----------------------------------------------------------------------------

function MapStepNotice({
  source,
  preset,
}: {
  source: SourceId | null;
  preset: ProviderPreset | null;
}) {
  // Generic CSV or no source yet — nothing to say.
  if (source == null || source === "generic_csv") return null;

  if (preset) {
    return (
      <Alert variant="success" className="p-3 space-y-2" data-testid="preset-applied-notice">
        <AlertDescription>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0 text-sm">
              <div className="font-semibold">Preset applied: {preset.label}</div>
              <div className="text-xs mt-0.5">{preset.description}</div>
            </div>
          </div>
          {preset.limitations && preset.limitations.length > 0 && (
            <ul className="text-[11px] text-slate-600 list-disc list-inside space-y-0.5 pl-6">
              {preset.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Source picked but no preset for this (source, entity) yet.
  const sourceLabel = source === "housecall_pro" ? "Housecall Pro" : "Jobber";
  return (
    <Alert variant="neutral" className="p-3" data-testid="preset-unavailable-notice">
      <AlertDescription className="flex items-start gap-2">
        <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        <div className="text-sm">
          <span className="font-semibold">Preset mapping for {sourceLabel} is not available yet for this import type.</span>{" "}
          Continue with manual mapping below — your file will still import normally.
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ----------------------------------------------------------------------------
// Step indicator
// ----------------------------------------------------------------------------

export function StepIndicator({ step }: { step: Step }) {
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
  config, headers, sampleData, plans, setPlans, existingDefinitionKeys, onBack, onContinue, loading, error,
}: {
  config: ImportWizardConfig;
  headers: string[];
  sampleData: string[][];
  plans: ColumnPlan[];
  setPlans: (p: ColumnPlan[]) => void;
  existingDefinitionKeys: ReadonlySet<string>;
  onBack: () => void;
  onContinue: () => void;
  loading: boolean;
  error: string | null;
}) {
  const requiredKeys = config.fieldDefs.filter((f) => f.required).map((f) => f.key);
  const planErrors = validatePlan(plans, requiredKeys);

  return (
    <div className="space-y-4">
      <ColumnMapper
        config={config}
        headers={headers}
        sampleData={sampleData}
        plans={plans}
        onChange={setPlans}
        existingDefinitionKeys={existingDefinitionKeys}
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
        <Button onClick={onContinue} disabled={planErrors.length > 0 || loading}>
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
  config, preview, customFieldPlans, entityLabels, onBack, onCommit, commitLoading, commitStage, commitError, commitableCount,
}: {
  config: ImportWizardConfig;
  preview: PreviewResponse<any, any>;
  customFieldPlans: CustomFieldPlan[];
  entityLabels: Record<CustomFieldEntityId, string>;
  onBack: () => void;
  onCommit: () => void;
  commitLoading: boolean;
  commitStage: "idle" | "creating_fields" | "importing_rows" | "writing_values";
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
        <h2 className="text-modal-title text-[#111827]">Preview</h2>
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

      {/* 2026-04-22 Phase 2b: show any custom fields that will be created
          or reused on commit. Only renders when the plan has create_custom
          actions. Per-entity counts surface the "2 client fields + 1 new
          location field" breakdown the brief asked for. */}
      <CustomFieldPlanSummary
        plans={customFieldPlans}
        entityLabels={entityLabels}
      />

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
        <div className="flex items-center gap-3">
          {commitLoading && commitStage !== "idle" && (
            <span className="text-xs text-[#4b5563]" data-testid="commit-stage-label">
              {commitStage === "creating_fields" && "Creating custom fields…"}
              {commitStage === "importing_rows" && "Importing rows…"}
              {commitStage === "writing_values" && "Saving custom-field values…"}
            </span>
          )}
          <Button onClick={onCommit} disabled={commitableCount === 0 || commitLoading} size="lg">
            {commitLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Import {commitableCount} {config.rowNoun}
          </Button>
        </div>
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
            <h2 className="text-modal-title text-[#111827]">Import complete</h2>
          </>
        ) : (
          <>
            <AlertTriangle className="h-6 w-6 text-amber-600" />
            <h2 className="text-modal-title text-[#111827]">Import completed with errors</h2>
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
