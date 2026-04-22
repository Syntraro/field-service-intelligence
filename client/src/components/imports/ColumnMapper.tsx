/**
 * ColumnMapper — canonical column → field assignment UI. Driven entirely
 * by the entity config's `fieldDefs`; has no per-entity switches.
 */

import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import type { ColumnMapping, ImportWizardConfig } from "./types";

interface ColumnMapperProps {
  config: ImportWizardConfig;
  headers: string[];
  sampleData: string[][];
  mappings: ColumnMapping[];
  onChange: (mappings: ColumnMapping[]) => void;
}

const IGNORE_VALUE = "__ignore__";

export function ColumnMapper({ config, headers, sampleData, mappings, onChange }: ColumnMapperProps) {
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

  const updateMapping = (index: number, targetField: string | null) => {
    const next = mappings.map((m, i) => {
      if (i === index) return { ...m, targetField };
      // Ensure the same field isn't mapped twice — clear any other column
      // that previously held this field.
      if (targetField && m.targetField === targetField) {
        return { ...m, targetField: null };
      }
      return m;
    });
    onChange(next);
  };

  const missingRequired = config.fieldDefs
    .filter((f) => f.required)
    .filter((f) => !mappings.some((m) => m.targetField === f.key));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#111827]">Map your columns</h2>
        <p className="text-sm text-[#4b5563] mt-1">
          Columns marked <span className="text-red-600">*</span> are required. Anything left unmapped is ignored.
        </p>
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
          <div>Map to field</div>
        </div>
        {mappings.map((m, i) => (
          <div key={`${m.csvHeader}-${i}`} className="grid grid-cols-[1fr_1fr_1fr] gap-4 px-4 py-2 items-center">
            <div className="text-sm font-medium text-[#111827] truncate">{m.csvHeader}</div>
            <div className="text-xs text-[#4b5563] truncate space-y-0.5">
              {sampleData.slice(0, 3).map((row, idx) => (
                <div key={idx} className="truncate">
                  {row[i] ?? <span className="italic text-slate-400">(empty)</span>}
                </div>
              ))}
            </div>
            <div>
              <Select
                value={m.targetField ?? IGNORE_VALUE}
                onValueChange={(v) => updateMapping(i, v === IGNORE_VALUE ? null : v)}
              >
                <SelectTrigger className="h-8" data-testid={`column-map-${i}`}>
                  <SelectValue placeholder="— Ignore —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE_VALUE}>— Ignore —</SelectItem>
                  {groupedFields.map(([group, fields]) => (
                    <div key={group}>
                      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-slate-500 uppercase">{group}</div>
                      {fields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                          {f.required && <span className="text-red-600 ml-1">*</span>}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
