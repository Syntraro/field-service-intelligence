/**
 * CustomFieldPlanSummary (2026-04-22 Phase 2b)
 *
 * Rendered on the Preview step above the row table. Gives the user a
 * last-chance look at the custom fields that will be created or reused
 * before they click Import.
 *
 * Phase 2b extensions:
 *   - Groups plans by target entity so the user sees "2 client fields",
 *     "1 location field" etc. rather than a flat mixed list.
 *   - Shows a reuse count alongside the create count when the wizard
 *     matched existing tenant-scoped definitions.
 */

import { Sparkles, Recycle } from "lucide-react";
import type { CustomFieldPlan } from "./importPlan";
import type { CustomFieldEntityId } from "./types";

interface CustomFieldPlanSummaryProps {
  plans: CustomFieldPlan[];
  /** Human labels per entity id — sourced from the ImportWizardConfig. */
  entityLabels: Record<CustomFieldEntityId, string>;
}

function entityOrder(id: CustomFieldEntityId): number {
  // Stable display order: Client → Location → Job → Product
  switch (id) {
    case "customer_company": return 0;
    case "client_location":  return 1;
    case "job":              return 2;
    case "item":             return 3;
    default:                 return 99;
  }
}

export function CustomFieldPlanSummary({ plans, entityLabels }: CustomFieldPlanSummaryProps) {
  if (plans.length === 0) return null;

  const creating = plans.filter((p) => !p.reusedExisting);
  const reusing = plans.filter((p) => p.reusedExisting);

  const countsByEntity = new Map<CustomFieldEntityId, { create: number; reuse: number }>();
  for (const p of plans) {
    const bucket = countsByEntity.get(p.entity) ?? { create: 0, reuse: 0 };
    if (p.reusedExisting) bucket.reuse += 1;
    else bucket.create += 1;
    countsByEntity.set(p.entity, bucket);
  }

  const summaryLines = Array.from(countsByEntity.entries())
    .sort(([a], [b]) => entityOrder(a) - entityOrder(b))
    .map(([entity, counts]) => {
      const parts: string[] = [];
      if (counts.create > 0) {
        parts.push(`${counts.create} new ${counts.create === 1 ? "field" : "fields"}`);
      }
      if (counts.reuse > 0) {
        parts.push(`${counts.reuse} reused`);
      }
      return `${entityLabels[entity] ?? entity}: ${parts.join(" · ")}`;
    });

  return (
    <div
      className="rounded-md border border-[#76B054]/30 bg-[#F0F5F0] p-3 space-y-2"
      data-testid="custom-field-plan-summary"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#76B054]" />
        <h3 className="text-sm font-semibold text-[#111827]">
          {creating.length > 0 && (
            <>
              {creating.length} custom field{creating.length === 1 ? "" : "s"} will be created
            </>
          )}
          {creating.length > 0 && reusing.length > 0 && <span> · </span>}
          {reusing.length > 0 && (
            <>
              {reusing.length} existing field{reusing.length === 1 ? "" : "s"} reused
            </>
          )}
        </h3>
      </div>

      {summaryLines.length > 0 && (
        <div className="text-[11px] text-[#4b5563]">{summaryLines.join("  ·  ")}</div>
      )}

      <ul className="text-xs text-[#4b5563] space-y-1">
        {plans.map((p, i) => (
          <li
            key={`${p.csvIndex}-${i}`}
            className="flex items-center gap-2"
            data-testid={`custom-field-plan-row-${i}`}
          >
            {p.reusedExisting ? (
              <Recycle className="h-3 w-3 text-[#76B054]" />
            ) : (
              <Sparkles className="h-3 w-3 text-[#76B054]" />
            )}
            <span className="font-semibold text-[#111827]">{p.label}</span>
            <span className="text-slate-400">·</span>
            <span>{entityLabels[p.entity] ?? p.entity}</span>
            <span className="text-slate-400">·</span>
            <span className="uppercase tracking-wider text-[10px] text-slate-500">{p.type}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500 italic">from "{p.csvHeader}"</span>
            {p.reusedExisting && (
              <span className="text-[10px] text-[#76B054] font-semibold ml-1">reuse</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
