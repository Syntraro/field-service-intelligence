/**
 * CustomFieldConfigForm (2026-04-22 Phase 2b)
 *
 * Inline per-row form that appears when the user picks "Create custom
 * field" on a column in the Map step. Small and unobtrusive — it sits
 * directly in the column's row, not a modal.
 *
 * Phase 2b changes:
 *   - Entity target is now selectable when the import config exposes more
 *     than one option (Clients = Client | Location). A single-option
 *     import (Jobs, Products) still shows it read-only.
 *   - Reuse indicator — when a matching existing tenant-scoped definition
 *     was detected, the form shows "Will reuse existing field" instead of
 *     "New custom field".
 *
 * Scope: type is still locked to `text` — the canonical Reference-Fields
 * system is text-only.
 */

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Recycle } from "lucide-react";
import type { CustomFieldEntityId } from "./types";

interface CustomFieldConfigFormProps {
  /** User-editable label (what they want this custom field to be called). */
  label: string;
  onChangeLabel: (next: string) => void;
  /** Currently selected target entity. */
  entity: CustomFieldEntityId;
  onChangeEntity: (next: CustomFieldEntityId) => void;
  /**
   * Full list of available targets from the import config. Length 1 → the
   * target is locked and shown as a read-only pill; length > 1 → a Select.
   */
  entityOptions: ReadonlyArray<{ id: CustomFieldEntityId; label: string }>;
  /**
   * Phase 2b reuse hint — when a matching tenant-scoped definition exists,
   * we show the user that no new field will be created. Computed by the
   * parent after a GET /api/reference-fields match.
   */
  willReuseExisting?: boolean;
  /**
   * Per-row validation — surfaces a duplicate-label or empty-label
   * warning right below the input. Parent (ColumnMapper / ImportWizard)
   * computes this once per plan.
   */
  error?: string | null;
  testId?: string;
}

export function CustomFieldConfigForm({
  label,
  onChangeLabel,
  entity,
  onChangeEntity,
  entityOptions,
  willReuseExisting,
  error,
  testId,
}: CustomFieldConfigFormProps) {
  const multipleTargets = entityOptions.length > 1;
  const activeOption = entityOptions.find((o) => o.id === entity) ?? entityOptions[0];

  return (
    <div
      className="mt-2 p-2.5 rounded-md border border-[#76B054]/30 bg-[#F0F5F0] space-y-1.5"
      data-testid={testId}
    >
      <div className="text-[11px] font-semibold text-[#111827] flex items-center gap-1">
        {willReuseExisting ? (
          <>
            <Recycle className="h-3 w-3 text-[#76B054]" />
            Will reuse existing field
          </>
        ) : (
          <>
            <Info className="h-3 w-3 text-[#76B054]" />
            New custom field
          </>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
        <Input
          value={label}
          onChange={(e) => onChangeLabel(e.target.value)}
          placeholder="Field name"
          className="h-7 text-xs"
          data-testid={testId ? `${testId}-label` : undefined}
        />
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Target</span>
        {multipleTargets ? (
          <Select value={entity} onValueChange={(v) => onChangeEntity(v as CustomFieldEntityId)}>
            <SelectTrigger
              className="h-7 text-[11px] w-auto min-w-[110px]"
              data-testid={testId ? `${testId}-entity` : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entityOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-[11px] font-semibold text-[#111827] bg-white border border-[#e2e8f0] rounded px-2 py-0.5">
            {activeOption?.label ?? "—"}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">Type: <span className="font-semibold">Text</span></span>
        {error && (
          <span className="text-[10px] text-red-600 font-medium" data-testid={testId ? `${testId}-error` : undefined}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
