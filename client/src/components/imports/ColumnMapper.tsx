/**
 * ColumnMapper — canonical column → field assignment UI.
 *
 * 2026-04-22 Phase 2b: multi-entity custom-field targeting.
 *
 * Driven by `ColumnPlan[]` (see `importPlan.ts`):
 *   - ignore          : column is excluded from both backend + custom fields
 *   - map_existing    : column maps to a built-in entity field (backend)
 *   - create_custom   : column creates a new Reference-Fields custom field
 *                       on commit AND writes its value per row. Phase 2b
 *                       routes each `create_custom` entry to one of the
 *                       targets listed in `config.customFieldEntities`
 *                       (Job | Client | Location | Product). Default is
 *                       chosen via column-name heuristics.
 *
 * The "Create custom field" option only appears when the import config
 * lists at least one entity target (`customFieldEntities`).
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
import { AlertCircle } from "lucide-react";
import { CustomFieldConfigForm } from "./CustomFieldConfigForm";
import type { ImportWizardConfig, CustomFieldEntityId } from "./types";
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
   * reuse existing field" hint inline. Supplied by ImportWizard.
   */
  existingDefinitionKeys?: ReadonlySet<string>;
}

const IGNORE_VALUE = "__ignore__";
const CREATE_CUSTOM_VALUE = "__create_custom__";

export function ColumnMapper({
  config,
  headers,
  sampleData,
  plans,
  onChange,
  existingDefinitionKeys,
}: ColumnMapperProps) {
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

  // ── Per-row action change ────────────────────────────────────────────
  const setAction = (index: number, selectValue: string) => {
    const next = plans.map((p, i) => {
      if (i !== index) {
        // Clear another row's `map_existing` if it had the same field.
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
    const next = plans.map((p, i) => {
      if (i !== index) return p;
      if (p.action.kind !== "create_custom") return p;
      return { ...p, action: { ...p.action, label } };
    });
    onChange(next);
  };

  const setCustomEntity = (index: number, entity: CustomFieldEntityId) => {
    const next = plans.map((p, i) => {
      if (i !== index) return p;
      if (p.action.kind !== "create_custom") return p;
      return { ...p, action: { ...p.action, entity } };
    });
    onChange(next);
  };

  // ── Validation ───────────────────────────────────────────────────────
  const missingRequired = config.fieldDefs
    .filter((f) => f.required)
    .filter(
      (f) => !plans.some((p) => p.action.kind === "map_existing" && p.action.targetField === f.key),
    );

  // Per-row custom-field errors — duplicates are scoped per target entity
  // (Phase 2b), so two columns can both use "Notes" if one targets Client
  // and the other targets Location.
  const customErrorByIndex = useMemo(() => {
    const seenByEntity = new Map<CustomFieldEntityId, Map<string, number>>();
    const errors = new Map<number, string>();
    plans.forEach((p, i) => {
      if (p.action.kind !== "create_custom") return;
      const trimmed = p.action.label.trim();
      if (!trimmed) {
        errors.set(i, "Label is required.");
        return;
      }
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

  // ── Grouping for the UX recommendation ──────────────────────────────
  const unmappedCount = plans.filter((p) => p.action.kind === "ignore").length;
  const customCount = plans.filter((p) => p.action.kind === "create_custom").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#111827]">Map your columns</h2>
        <p className="text-sm text-[#4b5563] mt-1">
          For each source column pick an action: map to an existing field, create a custom field
          {customFieldsEnabled ? "" : " (not available for this import type)"}, or ignore.
          Columns marked <span className="text-red-600">*</span> are required.
        </p>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-[#4b5563]">
          <span>{plans.length - unmappedCount - customCount} mapped</span>
          <span className="text-slate-300">·</span>
          <span>{customCount} new custom {customCount === 1 ? "field" : "fields"}</span>
          <span className="text-slate-300">·</span>
          <span>{unmappedCount} ignored</span>
        </div>
      </div>

      {missingRequired.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Map these required fields before continuing:{" "}
            <span className="font-medium">{missingRequired.map((f) => f.label).join(", ")}</span>
          </AlertDescription>
        </Alert>
      )}

      <div className="border border-[#e2e8f0] rounded-md divide-y divide-[#e2e8f0]">
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-4 px-4 py-2 bg-slate-50 text-xs font-semibold text-[#4b5563]">
          <div>CSV column</div>
          <div>Sample values</div>
          <div>Action</div>
        </div>
        {plans.map((plan, i) => {
          const customError = customErrorByIndex.get(i) ?? null;
          return (
            <div
              key={`${plan.csvHeader}-${i}`}
              className="grid grid-cols-[1fr_1fr_1fr] gap-4 px-4 py-2 items-start"
            >
              <div className="text-sm font-medium text-[#111827] truncate pt-1">{plan.csvHeader}</div>
              <div className="text-xs text-[#4b5563] truncate space-y-0.5 pt-1">
                {sampleData.slice(0, 3).map((row, idx) => (
                  <div key={idx} className="truncate">
                    {row[plan.csvIndex] ?? <span className="italic text-slate-400">(empty)</span>}
                  </div>
                ))}
              </div>
              <div>
                <Select value={selectValueFor(plan)} onValueChange={(v) => setAction(i, v)}>
                  <SelectTrigger className="h-8" data-testid={`column-action-${i}`}>
                    <SelectValue placeholder="— Ignore —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE_VALUE}>— Ignore —</SelectItem>
                    {customFieldsEnabled && (
                      <SelectItem value={CREATE_CUSTOM_VALUE} data-testid={`column-action-${i}-create-custom`}>
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
                            {f.required && <span className="text-red-600 ml-1">*</span>}
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
                    willReuseExisting={
                      existingDefinitionKeys?.has(
                        `${plan.action.entity}::${plan.action.label.trim().toLowerCase()}`,
                      )
                    }
                    error={customError}
                    testId={`custom-field-config-${i}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
