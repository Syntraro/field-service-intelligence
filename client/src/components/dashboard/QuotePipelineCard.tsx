/**
 * QuotePipelineCard — actionable quote previews for the Operations Dashboard.
 *
 * Three buckets, each with a small preview list:
 *   • Awaiting Approval  (status='sent')       → Follow up
 *   • Drafts Ready to Send (status='draft')    → Send / Open draft
 *   • Approved Not Converted (status='approved', no job yet) → Convert
 *
 * Smart-fill capacity: target ~9 visible rows across buckets. Up to 3 per
 * bucket when all three are active; empty buckets release their slots to
 * active ones (greedy redistribution). Empty buckets are hidden outright —
 * we never render a dead shell.
 *
 * 2026-04-22 — created as part of the Operations Dashboard upgrade. Data
 * rides on the canonical `/api/dashboard/workflow` response already used
 * by the rest of the page. No new query, no new endpoint.
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { FileText, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";

export interface DashboardQuotePreview {
  id: string;
  quoteNumber: string | null;
  title: string | null;
  customerName: string | null;
  total: number;
  referenceAt: string | null;
}

interface QuotePipelineCardProps {
  awaitingApproval: { count: number; preview: DashboardQuotePreview[] };
  draftReadyToSend: { count: number; preview: DashboardQuotePreview[] };
  approvedNotConverted: { count: number; preview: DashboardQuotePreview[] };
  isLoading?: boolean;
  className?: string;
}

const TOTAL_CAPACITY = 9;
const PER_BUCKET_CAP = 3;

type BucketKey = "awaiting" | "draft" | "approved";

interface BucketDef {
  key: BucketKey;
  label: string;
  icon: React.ElementType;
  iconColor: string;
  cta: string;
  destination: string;
  pastCopy: (days: number | null) => string;
  count: number;
  preview: DashboardQuotePreview[];
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  return diff < 0 ? 0 : diff;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function QuotePipelineCard({
  awaitingApproval,
  draftReadyToSend,
  approvedNotConverted,
  isLoading,
  className = "",
}: QuotePipelineCardProps) {
  const [, setLocation] = useLocation();

  const buckets = useMemo<BucketDef[]>(() => [
    {
      key: "awaiting",
      label: "Awaiting approval",
      icon: Clock,
      iconColor: "text-amber-600",
      cta: "Follow up",
      destination: resolveDashboardNav("pipeline.quotesAwaitingApproval"),
      pastCopy: (d) => (d == null ? "" : d === 0 ? "sent today" : `sent ${d}d ago`),
      count: awaitingApproval.count,
      preview: awaitingApproval.preview,
    },
    {
      key: "draft",
      label: "Drafts ready to send",
      icon: FileText,
      iconColor: "text-slate-600",
      cta: "Open",
      destination: resolveDashboardNav("quotes.draft"),
      pastCopy: (d) => (d == null ? "" : d === 0 ? "edited today" : `edited ${d}d ago`),
      count: draftReadyToSend.count,
      preview: draftReadyToSend.preview,
    },
    {
      key: "approved",
      label: "Approved · not converted",
      icon: CheckCircle2,
      iconColor: "text-emerald-600",
      cta: "Convert",
      destination: resolveDashboardNav("pipeline.approvedNotConverted"),
      pastCopy: (d) => (d == null ? "" : d === 0 ? "approved today" : `approved ${d}d ago`),
      count: approvedNotConverted.count,
      preview: approvedNotConverted.preview,
    },
  ], [awaitingApproval, draftReadyToSend, approvedNotConverted]);

  // Smart-fill: non-empty buckets share the 9-row total capacity.
  // Pass 1 — each non-empty bucket claims min(PER_BUCKET_CAP, count).
  // Pass 2 — redistribute remaining slots to buckets that still have more
  // items than shown, in declared order, until capacity is exhausted.
  const visibleBuckets = useMemo(() => {
    const active = buckets.filter((b) => b.preview.length > 0);
    if (active.length === 0) return [] as Array<BucketDef & { visible: DashboardQuotePreview[] }>;

    const claimed = active.map((b) => Math.min(PER_BUCKET_CAP, b.preview.length));
    let remaining = TOTAL_CAPACITY - claimed.reduce((a, b) => a + b, 0);
    // Greedy fill: add one slot at a time to whichever bucket still has
    // un-shown items. Stops when capacity hits zero or every bucket is full.
    let progress = true;
    while (remaining > 0 && progress) {
      progress = false;
      for (let i = 0; i < active.length && remaining > 0; i++) {
        if (claimed[i] < active[i].preview.length) {
          claimed[i] += 1;
          remaining -= 1;
          progress = true;
        }
      }
    }

    return active.map((b, i) => ({ ...b, visible: b.preview.slice(0, claimed[i]) }));
  }, [buckets]);

  const totalCount =
    awaitingApproval.count + draftReadyToSend.count + approvedNotConverted.count;
  const hasAny = totalCount > 0;

  return (
    <div
      className={`bg-white rounded-md border border-[#e2e8f0] flex flex-col ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="quote-pipeline-card"
    >
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          <h3 className="text-sm font-semibold text-[#111827] truncate">Quote Pipeline</h3>
          {hasAny && (
            <span className="text-helper text-[#4b5563] tabular-nums shrink-0">
              {totalCount} open
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLocation("/quotes")}
          className="text-helper font-semibold text-[#76B054] hover:underline shrink-0"
          data-testid="quote-pipeline-view-all"
        >
          View all quotes
        </button>
      </header>

      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-[#4b5563]">Loading quote pipeline…</div>
        ) : !hasAny ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-[#4b5563]">No quote actions right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e2e8f0]">
            {visibleBuckets.map((b) => {
              const Icon = b.icon;
              const remaining = b.count - b.visible.length;
              return (
                <section key={b.key} data-testid={`quote-bucket-${b.key}`}>
                  <button
                    type="button"
                    onClick={() => setLocation(b.destination)}
                    className="w-full flex items-center justify-between px-4 pt-2 pb-1.5 text-left hover:bg-[#F0F5F0] transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${b.iconColor}`} />
                      <span className="text-helper font-semibold uppercase tracking-wide text-[#4b5563] truncate">
                        {b.label}
                      </span>
                      <span className="text-helper text-[#111827] font-bold tabular-nums shrink-0">
                        {b.count}
                      </span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8] group-hover:text-[#111827] transition-colors shrink-0" />
                  </button>
                  <ul className="pb-1.5">
                    {b.visible.map((q) => (
                      <QuotePreviewRow
                        key={q.id}
                        quote={q}
                        ctaLabel={b.cta}
                        timingCopy={b.pastCopy(daysSince(q.referenceAt))}
                        onOpen={() => setLocation(`/quotes/${q.id}`)}
                      />
                    ))}
                    {remaining > 0 && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setLocation(b.destination)}
                          className="w-full text-left px-4 py-1 text-helper text-[#76B054] hover:underline"
                        >
                          +{remaining} more →
                        </button>
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function QuotePreviewRow({
  quote,
  ctaLabel,
  timingCopy,
  onOpen,
}: {
  quote: DashboardQuotePreview;
  ctaLabel: string;
  timingCopy: string;
  onOpen: () => void;
}) {
  const displayLabel =
    quote.title?.trim() ||
    (quote.quoteNumber ? `Quote #${quote.quoteNumber}` : "Untitled quote");

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between gap-2 px-4 py-1.5 hover:bg-[#F0F5F0] transition-colors group"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-[#111827] truncate">
              {quote.customerName ?? "Unknown customer"}
            </span>
            {quote.total > 0 && (
              <span className="text-helper text-[#4b5563] tabular-nums shrink-0">
                · {money(quote.total)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-helper text-[#6b7280] min-w-0">
            <span className="truncate">{displayLabel}</span>
            {timingCopy && (
              <>
                <span className="text-[#cbd5e1]">·</span>
                <span className="shrink-0">{timingCopy}</span>
              </>
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-0.5 text-helper font-semibold text-[#76B054] shrink-0 group-hover:underline">
          {ctaLabel}
          <ChevronRight className="h-3 w-3" />
        </span>
      </button>
    </li>
  );
}
