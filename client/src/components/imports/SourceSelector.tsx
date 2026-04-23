/**
 * SourceSelector (2026-04-22)
 *
 * Explicit "Where is this file from?" picker shown at the start of the
 * Upload step. The user must pick a source before the file dropzone is
 * shown. No auto-detection, no guessing, no silent switching — if the
 * user picks wrong, that's a user-correctable mistake.
 *
 * Three sources are offered for every entity today:
 *   - Jobber             (preset mapping)
 *   - Housecall Pro      (preset mapping when one exists for the entity)
 *   - Generic CSV        (manual mapping + backend header suggestions)
 *
 * When the user picks a provider that has no preset for the current
 * entity yet (e.g. Housecall Pro before we ship HCP presets), the
 * parent wizard shows a non-blocking notice on the Map step and falls
 * back to manual mapping. This component does not enforce that — it
 * just surfaces the three options.
 */

import type { LucideIcon } from "lucide-react";
import { Briefcase, Check, FileSpreadsheet, Wrench } from "lucide-react";
import type { SourceId } from "./presets/types";

// ---------------------------------------------------------------------------
// Option catalog — same three options for every entity.
// ---------------------------------------------------------------------------

interface SourceOption {
  id: SourceId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    id: "jobber",
    label: "Jobber",
    description: "Use preset mapping for a faster setup.",
    icon: Briefcase,
  },
  {
    id: "housecall_pro",
    label: "Housecall Pro",
    description: "Use preset mapping for a faster setup.",
    icon: Wrench,
  },
  {
    id: "generic_csv",
    label: "Generic CSV",
    description: "Map fields manually. Use when exporting from a tool we don't have a preset for.",
    icon: FileSpreadsheet,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SourceSelectorProps {
  /** Currently picked source, or null when the user hasn't chosen yet. */
  value: SourceId | null;
  onChange: (next: SourceId) => void;
}

/**
 * 2026-04-22 live-testing fix: demoted from 3 big cards to a compact
 * inline segmented picker. Record-type choice (on ImportCenterPage) is
 * the primary decision — source is a secondary detail about this
 * specific file. Keeping this surface small signals that hierarchy.
 */
export function SourceSelector({ value, onChange }: SourceSelectorProps) {
  return (
    <section className="space-y-2" data-testid="source-selector">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold text-[#4b5563] uppercase tracking-wider">
          Source
        </h2>
        <p className="text-xs text-[#6b7280]">
          Which tool produced this CSV?
        </p>
      </div>

      <div
        className="inline-flex flex-wrap gap-1.5 rounded-md bg-[#F4F8F4] p-1 border border-[#e2e8f0]"
        role="radiogroup"
        aria-label="Source of the CSV file"
      >
        {SOURCE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.id)}
              data-testid={`source-option-${option.id}`}
              title={option.description}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#76B054]/40 ${
                isActive
                  ? "bg-white text-[#111827] shadow-sm border border-[#76B054]"
                  : "text-[#4b5563] hover:bg-white hover:text-[#111827]"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${isActive ? "text-[#76B054]" : "text-[#6b7280]"}`} />
              <span>{option.label}</span>
              {isActive && <Check className="h-3.5 w-3.5 text-[#76B054]" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact chip — shown on the Map step so the selected source stays
// visually persistent during the rest of the wizard. Includes a "Change"
// button that resets source + kicks the wizard back to the Upload step.
// ---------------------------------------------------------------------------

interface SourceChipProps {
  source: SourceId;
  /** Called when the user clicks "Change". The wizard should reset state + return to Upload. */
  onChange: () => void;
}

export function SourceChip({ source, onChange }: SourceChipProps) {
  const option = SOURCE_OPTIONS.find((o) => o.id === source);
  if (!option) return null;
  const Icon = option.icon;
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[#76B054]/40 bg-[#F0F5F0] text-xs font-medium text-[#111827]"
      data-testid="source-chip"
    >
      <Icon className="h-3.5 w-3.5 text-[#76B054]" />
      <span>
        Source: <span className="font-semibold">{option.label}</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="ml-1 text-[11px] font-semibold text-[#76B054] hover:underline"
        data-testid="source-change-trigger"
      >
        Change
      </button>
    </div>
  );
}
