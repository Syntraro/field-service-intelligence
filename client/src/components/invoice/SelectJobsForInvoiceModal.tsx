/**
 * SelectJobsForInvoiceModal — presentational job picker for the
 * `/invoices/new` builder.
 *
 * Pure presentational. The page owns the jobs query
 * (`GET /api/jobs?locationId=…`) and any downstream side effects
 * (preview hydration, mirror updates). The modal just emits the
 * user's selection via `onConfirm` / `onSkip`.
 *
 * 2026-05-03 polish pass: bigger modal (max-w-3xl), crisp table
 * layout (Status / Job / Address / Subtotal columns), simpler header
 * + footer copy, smaller status pill, compact rows. Visual style
 * mirrors the app's table-style modals (e.g. Action Required) instead
 * of the previous bubbly card-row layout.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModalStateBody } from "@/components/ui/modal";
import { formatCurrency } from "@/lib/formatters";

export interface SelectableJob {
  id: string;
  jobNumber: number;
  summary: string;
  status: string;
  scheduledStart: string | null;
  /** Service-address line + city — sourced from `JobFeedItem.locationAddress`
   *  / `locationCity` on the canonical jobs feed. Either may be null. */
  locationAddress?: string | null;
  locationCity?: string | null;
  /** Optional estimated subtotal. The basic jobs feed does not return
   *  one today, so the column falls back to "$0.00" — preserved as
   *  optional so a future feed expansion can populate it without a
   *  type change. */
  estimatedSubtotal?: string | null;
  /** Canonical "this job already has an invoice" signal. The page
   *  filters jobs with `invoiceCount > 0` out of the list before the
   *  modal sees them, but the field is part of the canonical jobs
   *  feed response and surfaced here for completeness. */
  invoiceCount?: number;
}

/** Canonical job-status enum. Mirrors `shared/schema.ts:jobStatusEnum`
 *  (`open` / `completed` / `invoiced` / `archived`). Tones are kept
 *  subtle — single-tone backgrounds, no oversized pills. */
function statusTone(status: string): { label: string; bg: string; text: string } {
  switch (status) {
    case "completed": return { label: "Ready",     bg: "bg-emerald-50", text: "text-emerald-700" };
    case "open":      return { label: "Open",      bg: "bg-teal-50",    text: "text-teal-700" };
    case "invoiced":  return { label: "Invoiced",  bg: "bg-stone-100",  text: "text-stone-700" };
    case "archived":  return { label: "Archived",  bg: "bg-stone-100",  text: "text-stone-500" };
    default:          return { label: status,      bg: "bg-stone-100",  text: "text-stone-700" };
  }
}

export interface SelectJobsForInvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: SelectableJob[];
  isLoading: boolean;
  /** User clicked the primary Continue button. Receives the chosen
   *  job ids in the order they appear in `jobs`. */
  onConfirm: (jobIds: string[]) => void;
  /** User clicked "Continue without job". The page drops the user
   *  into the editor with no preview lines. */
  onSkip: () => void;
}

export function SelectJobsForInvoiceModal({
  open,
  onOpenChange,
  jobs,
  isLoading,
  onConfirm,
  onSkip,
}: SelectJobsForInvoiceModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection whenever the modal re-opens or the underlying job
  // list changes (e.g. user changed locations and we re-queried).
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open, jobs]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const orderedSelectedIds = useMemo(
    () => jobs.filter((j) => selected.has(j.id)).map((j) => j.id),
    [jobs, selected],
  );

  const renderAddress = (job: SelectableJob) => {
    const line = [job.locationAddress, job.locationCity].filter(Boolean).join(", ");
    return line || <span className="text-slate-400">—</span>;
  };

  const renderSubtotal = (job: SelectableJob) => {
    const value = job.estimatedSubtotal && parseFloat(job.estimatedSubtotal) > 0
      ? job.estimatedSubtotal
      : "0.00";
    return formatCurrency(value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select jobs to invoice</DialogTitle>
          <DialogDescription>
            Choose jobs to include, or continue without a job.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[480px] overflow-y-auto overflow-x-auto rounded-md border border-card-border bg-card">
          {/* 2026-05-09: loading/empty replaced with canonical ModalStateBody */}
          {isLoading ? (
            <ModalStateBody
              variant="loading"
              message="Loading jobs…"
              data-testid="select-jobs-loading"
            />
          ) : jobs.length === 0 ? (
            <ModalStateBody
              variant="empty"
              message="No open jobs found."
              data-testid="select-jobs-empty"
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-card-border">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Job
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Address
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const isChecked = selected.has(job.id);
                  const tone = statusTone(job.status);
                  return (
                    <tr
                      key={job.id}
                      onClick={() => toggle(job.id)}
                      className={`border-b border-card-border last:border-b-0 cursor-pointer transition-colors ${
                        isChecked ? "bg-slate-50" : "hover:bg-slate-50"
                      }`}
                      data-testid={`row-select-job-${job.id}`}
                    >
                      <td className="w-10 px-3 py-2 align-middle">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggle(job.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select job #${job.jobNumber}`}
                        />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.text}`}
                          data-testid={`pill-status-${job.id}`}
                        >
                          {tone.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="text-[13px] text-slate-900 min-w-0">
                          <span className="tabular-nums font-medium">
                            #{job.jobNumber}
                          </span>{" "}
                          <span className="text-slate-700">
                            {job.summary || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle text-[13px] text-slate-600">
                        {renderAddress(job)}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-[13px] tabular-nums text-slate-900">
                        {renderSubtotal(job)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            variant="ghost"
            onClick={onSkip}
            disabled={isLoading}
            data-testid="button-jobs-skip"
          >
            Continue without job
          </Button>
          <Button
            onClick={() => onConfirm(orderedSelectedIds)}
            disabled={isLoading || orderedSelectedIds.length === 0}
            data-testid="button-jobs-confirm"
          >
            {orderedSelectedIds.length === 0
              ? "Continue"
              : `Continue with ${orderedSelectedIds.length} selected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
