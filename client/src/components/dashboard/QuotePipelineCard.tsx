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
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";

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

  // 2026-05-07 Card canonicalization (Tier 1): outer chrome + header band
  // routed through CardShell + CardShellHeader. Bucket internals (preview
  // rows, smart-fill, "+N more" link) are intentionally untouched.
  return (
    <CardShell
      className={`flex flex-col ${className}`}
      data-testid="quote-pipeline-card"
    >
      <CardShellHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CardShellTitle icon={FileText} iconColor="text-teal-600">
            Quote Pipeline
          </CardShellTitle>
          {hasAny && (
            <span className="text-helper text-muted-foreground tabular-nums shrink-0">
              {totalCount} open
            </span>
          )}
        </div>
        <CardShellAction>
          <button
            type="button"
            onClick={() => setLocation("/quotes")}
            className="text-helper font-semibold text-primary hover:underline"
            data-testid="quote-pipeline-view-all"
          >
            View all quotes
          </button>
        </CardShellAction>
      </CardShellHeader>

      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 text-helper text-muted-foreground">Loading quote pipeline…</div>
        ) : !hasAny ? (
          <div className="px-4 py-6 text-center">
            <p className="text-helper text-muted-foreground">No quote actions right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {visibleBuckets.map((b) => {
              const Icon = b.icon;
              const remaining = b.count - b.visible.length;
              return (
                <section key={b.key} data-testid={`quote-bucket-${b.key}`}>
                  <button
                    type="button"
                    onClick={() => setLocation(b.destination)}
                    className="w-full flex items-center justify-between px-4 pt-2 pb-1.5 text-left hover:bg-primary/5 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${b.iconColor}`} />
                      <span className="text-helper font-semibold uppercase tracking-wide text-muted-foreground truncate">
                        {b.label}
                      </span>
                      <span className="text-helper text-foreground font-bold tabular-nums shrink-0">
                        {b.count}
                      </span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
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
                          className="w-full text-left px-4 py-1 text-helper text-primary hover:underline"
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
    </CardShell>
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
        className="w-full flex items-center justify-between gap-2 px-4 py-1.5 hover:bg-primary/5 transition-colors group"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-helper font-semibold text-foreground truncate">
              {quote.customerName ?? "Unknown customer"}
            </span>
            {quote.total > 0 && (
              <span className="text-helper text-muted-foreground tabular-nums shrink-0">
                · {money(quote.total)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-helper text-muted-foreground min-w-0">
            <span className="truncate">{displayLabel}</span>
            {timingCopy && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="shrink-0">{timingCopy}</span>
              </>
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-0.5 text-helper font-semibold text-primary shrink-0 group-hover:underline">
          {ctaLabel}
          <ChevronRight className="h-3 w-3" />
        </span>
      </button>
    </li>
  );
}
