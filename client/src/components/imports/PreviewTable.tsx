/**
 * PreviewTable — canonical per-row preview. One vocabulary
 * (`created / matched / skipped / failed`) used for every entity.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Download } from "lucide-react";
import type { ValidatedRow, PreviewResponse } from "./types";
import type { RowDisposition } from "@shared/importPipeline/terminology";
import { ROW_DISPOSITION_LABELS } from "@shared/importPipeline/terminology";

type Filter = "all" | "created" | "matched" | "skipped" | "failed";

interface PreviewTableProps<T = any, D = any> {
  preview: PreviewResponse<T, D>;
  renderDetails?: (row: ValidatedRow<T, D>) => React.ReactNode;
}

const DISPOSITION_BADGES: Record<RowDisposition, string> = {
  created: "bg-emerald-100 text-emerald-800 border-emerald-200",
  matched: "bg-blue-100 text-blue-800 border-blue-200",
  skipped: "bg-slate-100 text-slate-700 border-slate-200",
  failed: "bg-red-100 text-red-800 border-red-200",
};

export function PreviewTable<T, D>({ preview, renderDetails }: PreviewTableProps<T, D>) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return preview.rows;
    return preview.rows.filter((r) => r.disposition === filter);
  }, [preview.rows, filter]);

  const counts: Record<Filter, number> = useMemo(() => {
    const c: Record<Filter, number> = { all: preview.rows.length, created: 0, matched: 0, skipped: 0, failed: 0 };
    for (const r of preview.rows) c[r.disposition]++;
    return c;
  }, [preview.rows]);

  // 2026-04-22: de-duplicate the top warning legend against the row table.
  // Every row warning already renders inline in the row table's
  // "Details / warnings" cell, so the legend was doubling up as a second
  // copy — noisy on imports where each row carries its own warning (e.g.
  // "Job #X not found — invoice imported unlinked"). Keep the legend only
  // for warnings that apply to MULTIPLE rows, i.e. genuinely systemic
  // issues (same parse failure on many rows, same fallback behavior
  // across the batch). Single-row warnings stay in the row table only.
  const systemicLegendEntries = useMemo(() => {
    if (!preview.warningLegend) return [] as Array<[string, string]>;
    const codeCounts = new Map<number, number>();
    for (const row of preview.rows) {
      for (const code of row.warningCodes ?? []) {
        codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
      }
    }
    return Object.entries(preview.warningLegend).filter(
      ([code]) => (codeCounts.get(Number(code)) ?? 0) > 1,
    );
  }, [preview.warningLegend, preview.rows]);

  const exportErrors = () => {
    const failedRows = preview.rows.filter((r) => r.disposition === "failed");
    if (failedRows.length === 0) return;
    const lines = ["Row #,Error"];
    for (const r of failedRows) {
      const errs = r.errors.map((e) => `${e.field}: ${e.message}`).join("; ").replace(/"/g, '""');
      lines.push(`${r.rowIndex + 2},"${errs}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="All" active={filter === "all"} count={counts.all} onClick={() => setFilter("all")} />
        <FilterChip label="Created" active={filter === "created"} count={counts.created} onClick={() => setFilter("created")} tone="emerald" />
        <FilterChip label="Matched" active={filter === "matched"} count={counts.matched} onClick={() => setFilter("matched")} tone="blue" />
        <FilterChip label="Skipped" active={filter === "skipped"} count={counts.skipped} onClick={() => setFilter("skipped")} tone="slate" />
        <FilterChip label="Failed" active={filter === "failed"} count={counts.failed} onClick={() => setFilter("failed")} tone="red" />
        <div className="flex-1" />
        {counts.failed > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={exportErrors}>
            <Download className="h-3.5 w-3.5" />
            Export errors
          </Button>
        )}
      </div>

      {systemicLegendEntries.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="font-semibold mb-1">Warning legend</div>
          <div className="space-y-0.5">
            {systemicLegendEntries.map(([code, msg]) => (
              <div key={code}>
                <span className="font-mono text-[10px] bg-amber-200 px-1 rounded mr-2">W{code}</span>
                {msg}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-[#e2e8f0] rounded-md overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-[11px] font-semibold text-[#4b5563]">
                <th className="px-3 py-2 w-14">Row</th>
                <th className="px-3 py-2 w-28">Status</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Details / warnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-xs text-slate-500 italic">
                    No rows match this filter.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={
                      row.disposition === "failed"
                        ? "bg-red-50/40"
                        : row.warnings.length > 0
                          ? "bg-amber-50/30"
                          : undefined
                    }
                  >
                    <td className="px-3 py-2 tabular-nums text-[#4b5563]">{row.rowIndex + 2}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={DISPOSITION_BADGES[row.disposition]}>
                        {row.disposition === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                        {row.disposition === "created" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {row.disposition === "matched" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {row.disposition === "skipped" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {ROW_DISPOSITION_LABELS[row.disposition]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-[#111827] truncate">
                      {row.matchLabel ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[#4b5563]">
                      {row.errors.length > 0 && (
                        <ul className="space-y-0.5">
                          {row.errors.map((e, i) => (
                            <li key={i} className="text-red-700">
                              {e.field}: {e.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.warnings.length > 0 && (
                        <ul className="space-y-0.5">
                          {row.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                      {renderDetails ? <div className="mt-1">{renderDetails(row)}</div> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "emerald" | "blue" | "slate" | "red";
}) {
  const toneClasses = tone && active
    ? tone === "emerald" ? "bg-emerald-600 text-white border-emerald-600"
      : tone === "blue" ? "bg-blue-600 text-white border-blue-600"
      : tone === "red" ? "bg-red-600 text-white border-red-600"
      : "bg-slate-600 text-white border-slate-600"
    : active
      ? "bg-[#111827] text-white border-[#111827]"
      : "bg-white text-[#4b5563] border-[#e2e8f0] hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium border transition-colors ${toneClasses}`}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
