/**
 * ColumnMapper — canonical column → field assignment UI.
 *
 * 2026-04-22 Phase 2b: multi-entity custom-field targeting.
 * 2026-05-13: Visual-only polish — compact rows, inline sample preview,
 * status summary bar, sticky column header, single page scroll.
 * Rows render in original plan order (plan array is the sole source of truth).
 *
 * Driven by `ColumnPlan[]` (see `importPlan.ts`):
 *   - ignore          : column excluded from backend + custom fields
 *   - map_existing    : column maps to a built-in entity field (backend)
 *   - create_custom   : column creates a Reference-Fields custom field on
 *                       commit. Phase 2b routes each entry to one of the
 *                       targets in `config.customFieldEntities`.
 */

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Minus,
  Tag,
} from "lucide-react";
import { CustomFieldConfigForm } from "./CustomFieldConfigForm";
import type { ImportWizardConfig, ImportFieldDef, CustomFieldEntityId } from "./types";
import type { ColumnPlan } from "./importPlan";
import { deriveCustomFieldLabel, defaultEntityForHeader } from "./importPlan";

interface ColumnMapperProps {
  config: ImportWizardConfig;
  headers: string[];
  sampleData: string[][];
  plans: ColumnPlan[];
  onChange: (plans: ColumnPlan[]) => void;
  /**
   * 2026-04-22 Phase 2b: set of "{entity}::{normalizedLabel}" keys that
   * already exist as tenant-scoped definitions. Used to show the "Will
   * reuse existing field" hint inline.
   */
  existingDefinitionKeys?: ReadonlySet<string>;
}

const IGNORE_VALUE = "__ignore__";
const CREATE_CUSTOM_VALUE = "__create_custom__";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function getSampleValues(sampleData: string[][], csvIndex: number): string[] {
  return sampleData.map((r) => (r[csvIndex] ?? "").trim()).filter(Boolean);
}

function hasPopulatedSamples(sampleData: string[][], csvIndex: number): boolean {
  return sampleData.some((r) => !!(r[csvIndex] ?? "").trim());
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SamplePreview({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="italic text-slate-400">—</span>;
  }
  const shown = values.slice(0, 2);
  const extra = values.length - shown.length;
  return (
    <span className="truncate">
      {shown.join(", ")}
      {extra > 0 && <span className="text-slate-400 ml-1">+{extra}</span>}
    </span>
  );
}

function RowStatusIcon({
  plan,
  isPopulatedIgnore,
}: {
  plan: ColumnPlan;
  isPopulatedIgnore: boolean;
}) {
  if (plan.action.kind === "map_existing") {
    return <Check className="h-3.5 w-3.5 text-emerald-500" aria-label="Mapped" />;
  }
  if (plan.action.kind === "create_custom") {
    return <Tag className="h-3.5 w-3.5 text-violet-400" aria-label="Custom field" />;
  }
  if (isPopulatedIgnore) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-label="Ignored — has data" />;
  }
  return <Minus className="h-3.5 w-3.5 text-slate-300" aria-label="Ignored" />;
}

function StatusBar({
  mappedCount,
  customCount,
  warningCount,
  ignoredCount,
}: {
  mappedCount: number;
  customCount: number;
  warningCount: number;
  ignoredCount: number;
}) {
  return (
    <div
      className="flex items-center flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-md border border-[#e2e8f0] bg-slate-50"
      data-testid="mapper-status-bar"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
        <Check className="h-3 w-3" />
        {mappedCount} mapped
      </span>
      {customCount > 0 && (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-violet-600">
          <Tag className="h-3 w-3" />
          {customCount} custom {customCount === 1 ? "field" : "fields"}
        </span>
      )}
      {warningCount > 0 && (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          {warningCount} {warningCount === 1 ? "warning" : "warnings"}
        </span>
      )}
      <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Minus className="h-3 w-3" />
        {ignoredCount} ignored
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ColumnMapper({
  config,
  headers,
  sampleData,
  plans,
  onChange,
  existingDefinitionKeys,
}: ColumnMapperProps) {
  // ── Aggregate counts ─────────────────────────────────────────────────
  const { mappedCount, customCount, ignoredCount, warningCount } = useMemo(() => {
    let mapped = 0, custom = 0, ignored = 0, warnings = 0;
    for (const p of plans) {
      if (p.action.kind === "map_existing") mapped++;
      else if (p.action.kind === "create_custom") custom++;
      else {
        ignored++;
        if (hasPopulatedSamples(sampleData, p.csvIndex)) warnings++;
      }
    }
    return { mappedCount: mapped, customCount: custom, ignoredCount: ignored, warningCount: warnings };
  }, [plans, sampleData]);

  // ── Field groups for the Select dropdown ────────────────────────────
  const groupedFields = useMemo(() => {
    const groups = new Map<string, typeof config.fieldDefs>();
    for (const f of config.fieldDefs) {
      const g = f.group ?? "Fields";
      const list = groups.get(g) ?? [];
      list.push(f);
      groups.set(g, list);
    }
    return Array.from(groups.entries());
  }, [config.fieldDefs]);

  const entityOptions = config.customFieldEntities ?? [];
  const customFieldsEnabled = entityOptions.length > 0;

  // ── Action handlers (logic unchanged) ───────────────────────────────
  const setAction = (index: number, selectValue: string) => {
    const next = plans.map((p, i) => {
      if (i !== index) {
        if (
          selectValue !== IGNORE_VALUE &&
          selectValue !== CREATE_CUSTOM_VALUE &&
          p.action.kind === "map_existing" &&
          p.action.targetField === selectValue
        ) {
          return { ...p, action: { kind: "ignore" as const } };
        }
        return p;
      }
      if (selectValue === IGNORE_VALUE) {
        return { ...p, action: { kind: "ignore" as const } };
      }
      if (selectValue === CREATE_CUSTOM_VALUE) {
        return {
          ...p,
          action: {
            kind: "create_custom" as const,
            label: deriveCustomFieldLabel(p.csvHeader),
            entity: defaultEntityForHeader(p.csvHeader, entityOptions),
          },
        };
      }
      return { ...p, action: { kind: "map_existing" as const, targetField: selectValue } };
    });
    onChange(next);
  };

  const setCustomLabel = (index: number, label: string) => {
    onChange(
      plans.map((p, i) => {
        if (i !== index || p.action.kind !== "create_custom") return p;
        return { ...p, action: { ...p.action, label } };
      }),
    );
  };

  const setCustomEntity = (index: number, entity: CustomFieldEntityId) => {
    onChange(
      plans.map((p, i) => {
        if (i !== index || p.action.kind !== "create_custom") return p;
        return { ...p, action: { ...p.action, entity } };
      }),
    );
  };

  // ── Validation ───────────────────────────────────────────────────────
  const missingRequired = config.fieldDefs
    .filter((f) => f.required)
    .filter(
      (f) =>
        !plans.some(
          (p) => p.action.kind === "map_existing" && p.action.targetField === f.key,
        ),
    );

  const customErrorByIndex = useMemo(() => {
    const seenByEntity = new Map<CustomFieldEntityId, Map<string, number>>();
    const errors = new Map<number, string>();
    plans.forEach((p, i) => {
      if (p.action.kind !== "create_custom") return;
      const trimmed = p.action.label.trim();
      if (!trimmed) { errors.set(i, "Label is required."); return; }
      const norm = trimmed.toLowerCase();
      const entitySeen = seenByEntity.get(p.action.entity) ?? new Map<string, number>();
      if (entitySeen.has(norm)) {
        errors.set(i, `Another column already uses "${trimmed}" for this target.`);
      } else {
        entitySeen.set(norm, i);
        seenByEntity.set(p.action.entity, entitySeen);
      }
    });
    return errors;
  }, [plans]);

  const selectValueFor = (plan: ColumnPlan): string => {
    if (plan.action.kind === "map_existing") return plan.action.targetField;
    if (plan.action.kind === "create_custom") return CREATE_CUSTOM_VALUE;
    return IGNORE_VALUE;
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3" data-testid="column-mapper">
      <h2 className="text-modal-title text-[#111827]">Map your columns</h2>

      {missingRequired.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Map these required fields before continuing:{" "}
            <span className="font-medium">
              {missingRequired.map((f) => f.label).join(", ")}
            </span>
          </AlertDescription>
        </Alert>
      )}

      <StatusBar
        mappedCount={mappedCount}
        customCount={customCount}
        warningCount={warningCount}
        ignoredCount={ignoredCount}
      />

      {/* Mapping table — flows as page content, page scroll only. */}
      <div data-testid="column-mapper-table">
        {/* Sticky column header — sticks within the app's main scroll container. */}
        <div className="sticky top-0 z-20 grid grid-cols-[1.5fr_1.5fr_2fr_32px] bg-[#f8fafc] border-t border-b border-[#e2e8f0]">
          <div className="px-4 py-2 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
            CSV Column
          </div>
          <div className="px-4 py-2 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
            Sample Values
          </div>
          <div className="px-4 py-2 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">
            Map To
          </div>
          <div />
        </div>

        {/* Rows in original plan order — plan array is the sole source of truth. */}
        {plans.map((plan, i) => {
          const customError = customErrorByIndex.get(i) ?? null;
          const isIgnored = plan.action.kind === "ignore";
          const isPopulatedIgnore =
            isIgnored && hasPopulatedSamples(sampleData, plan.csvIndex);
          const sampleValues = getSampleValues(sampleData, plan.csvIndex);

          return (
            <div
              key={`${plan.csvHeader}-${i}`}
              className={`grid grid-cols-[1.5fr_1.5fr_2fr_32px] border-b border-[#e2e8f0] items-start ${
                isPopulatedIgnore
                  ? "bg-amber-50/50"
                  : "bg-white hover:bg-slate-50/60"
              }`}
            >
              {/* CSV Column name */}
              <div className="px-4 py-3 text-sm font-medium text-[#111827] truncate">
                {plan.csvHeader}
              </div>

              {/* Sample values — compact inline preview */}
              <div className="px-4 py-3 text-xs text-[#4b5563] min-w-0">
                <SamplePreview values={sampleValues} />
              </div>

              {/* Map To select + optional custom field form */}
              <div className="px-4 py-2.5">
                <Select
                  value={selectValueFor(plan)}
                  onValueChange={(v) => setAction(i, v)}
                >
                  <SelectTrigger
                    className="h-7 text-xs border-[#d1d5db] shadow-none"
                    data-testid={`column-action-${i}`}
                  >
                    <SelectValue placeholder="— Ignore —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE_VALUE}>— Ignore —</SelectItem>
                    {customFieldsEnabled && (
                      <SelectItem
                        value={CREATE_CUSTOM_VALUE}
                        data-testid={`column-action-${i}-create-custom`}
                      >
                        + Create custom field
                      </SelectItem>
                    )}
                    {groupedFields.map(([group, fields]) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-[10px] font-semibold text-slate-500 uppercase">
                          {group}
                        </SelectLabel>
                        {fields.map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                            {f.required && (
                              <span className="text-red-600 ml-1">*</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                {plan.action.kind === "create_custom" && (
                  <CustomFieldConfigForm
                    label={plan.action.label}
                    onChangeLabel={(next) => setCustomLabel(i, next)}
                    entity={plan.action.entity}
                    onChangeEntity={(next) => setCustomEntity(i, next)}
                    entityOptions={entityOptions}
                    willReuseExisting={existingDefinitionKeys?.has(
                      `${plan.action.entity}::${plan.action.label
                        .trim()
                        .toLowerCase()}`,
                    )}
                    error={customError}
                    testId={`custom-field-config-${i}`}
                  />
                )}
              </div>

              {/* Per-row status icon */}
              <div className="flex items-start justify-center pt-3.5">
                <RowStatusIcon
                  plan={plan}
                  isPopulatedIgnore={isPopulatedIgnore}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
