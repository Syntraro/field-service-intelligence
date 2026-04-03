/** Technician PWA — Visit outcome selection modal */

import type { Outcome } from "../types";

const OUTCOME_OPTIONS: { key: Outcome; label: string; desc: string; color: string }[] = [
  { key: "completed", label: "Completed", desc: "Work finished successfully", color: "border-green-200 hover:bg-green-50 dark:hover:bg-green-950/20" },
  { key: "needs_parts", label: "Needs Parts", desc: "Waiting on parts to continue", color: "border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/20" },
  { key: "needs_followup", label: "Needs Follow-Up", desc: "Additional visit required", color: "border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/20" },
  { key: "on_hold", label: "On Hold", desc: "Cannot proceed — blocked", color: "border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20" },
];

export function OutcomeModal({ onSelect, onCancel }: { onSelect: (outcome: Outcome) => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-t-2xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold">Visit Outcome</h2>
        <p className="text-xs text-muted-foreground">How did this visit end?</p>
        <div className="space-y-2 pt-2">
          {OUTCOME_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onSelect(opt.key)}
              className={`w-full text-left p-4 rounded-xl border ${opt.color} transition-colors active:scale-[0.98]`}
            >
              <p className="text-sm font-semibold">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="w-full h-10 text-sm text-muted-foreground font-medium">Cancel</button>
      </div>
    </div>
  );
}
