/**
 * SummaryCards — canonical count grid for preview and post-commit surfaces.
 * Uses the canonical disposition vocabulary (`created / matched / skipped
 * / failed`) — no per-entity variants.
 */

import type { LucideIcon } from "lucide-react";
import { CheckCircle2, AlertTriangle, XCircle, ListChecks } from "lucide-react";

export interface SummaryItem {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  tone?: "neutral" | "emerald" | "blue" | "slate" | "red" | "amber";
}

export function SummaryCards({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      {items.map((item) => {
        const Icon = item.icon ?? ListChecks;
        const toneClasses = toneToClass(item.tone);
        return (
          <div
            key={item.label}
            className={`rounded-md border px-3 py-3 ${toneClasses}`}
          >
            <div className="flex items-center gap-2 text-xs font-medium opacity-80">
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </div>
            <div className="mt-1 text-display tabular-nums">{item.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function toneToClass(tone: SummaryItem["tone"]): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50 border-emerald-200 text-emerald-800";
    case "blue":
      return "bg-blue-50 border-blue-200 text-blue-800";
    case "slate":
      return "bg-slate-50 border-slate-200 text-slate-800";
    case "red":
      return "bg-red-50 border-red-200 text-red-800";
    case "amber":
      return "bg-amber-50 border-amber-200 text-amber-800";
    default:
      return "bg-white border-[#e2e8f0] text-[#111827]";
  }
}

export const SummaryIcons = {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ListChecks,
};
