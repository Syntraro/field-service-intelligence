import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { SectionLabel } from "@/components/ui/typography";
import { formatCurrency } from "@/lib/formatters";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import { StatusChip } from "@/components/ui/chip";
import { WorkspaceRailEmptyState } from "@/components/workspace/WorkspaceRailEmptyState";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { QuoteWarningsCard } from "./sections/QuoteWarningsCard";
import { QuoteFollowUpCard } from "./sections/QuoteFollowUpCard";
import { QuoteApprovalCard } from "./sections/QuoteApprovalCard";
import { QuoteConversionCard } from "./sections/QuoteConversionCard";
import { QuoteClientCommunicationCard } from "./sections/QuoteClientCommunicationCard";
import { QuoteQuickActionsCard } from "./sections/QuoteQuickActionsCard";
import { QuoteSummaryCard } from "./sections/QuoteSummaryCard";
import { QuoteTimelineCard } from "./sections/QuoteTimelineCard";
import type { Quote, QuoteLine, QuoteNote, QuoteStatus } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedQuoteContext {
  quoteId: string;
  quoteNumber?: string | null;
  clientName?: string | null;
  locationId?: string | null;
  customerCompanyId?: string | null;
  total?: string | null;
  expiryDate?: string | null;
  status?: string | null;
}

interface QuoteDetails {
  quote: Quote;
  lines: QuoteLine[];
  location: { id: string; companyName: string; address: string | null; city: string | null } | null;
  customerCompany: { id: string; name: string } | null;
}

interface QuoteActionsRailProps {
  context: SelectedQuoteContext | null;
}

/**
 * Quote right rail — assembly-only.
 *
 * Query ownership:
 * - GET /api/quotes/:id/details  — quote, lines, location, customerCompany
 * - GET /api/quotes/:id/notes    — timeline notes
 *
 * Section cards receive data via props; they own only their own mutations.
 * No modal state here — section cards own their modal state.
 */
export function QuoteActionsRail({ context }: QuoteActionsRailProps) {
  const [, setLocation] = useLocation();
  const quoteId = context?.quoteId ?? null;

  // ── Shared rail-root fetches ───────────────────────────────────────────────

  const { data: details, isLoading: detailsLoading } = useQuery<QuoteDetails>({
    queryKey: ["quote", quoteId, "details"],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/details`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load quote details");
      return res.json();
    },
    enabled: !!quoteId,
    staleTime: 30_000,
  });

  const { data: notes = [], isLoading: notesLoading } = useQuery<QuoteNote[]>({
    queryKey: ["quote", quoteId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load quote notes");
      return res.json();
    },
    enabled: !!quoteId,
    staleTime: 30_000,
  });

  // ── No selection ──────────────────────────────────────────────────────────

  if (!context) {
    return (
      <WorkspaceRailEmptyState
        message="Select a quote to see actions"
        data-testid="quote-actions-rail-empty"
      />
    );
  }

  const quote = details?.quote;
  const lines = details?.lines ?? [];
  const location = details?.location;
  const customerCompany = details?.customerCompany;
  const loading = detailsLoading;

  // ── Entity card derivations ───────────────────────────────────────────────

  const clientHref = context.locationId
    ? `/clients/${context.locationId}`
    : context.customerCompanyId
      ? `/clients/${context.customerCompanyId}`
      : null;

  const statusMeta = context.status
    ? getQuoteStatusMeta(context.status as QuoteStatus)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" data-testid="quote-actions-rail">

      {/* ── Quote / Client entity card ── */}
      <div>
        <SectionLabel className="mb-2">Quote</SectionLabel>
        <WorkspaceRailEntityCard
          icon={FileText}
          entityLabel={
            <button
              type="button"
              className="text-row text-brand hover:underline cursor-pointer text-left truncate block w-full"
              onClick={() => setLocation(`/quotes/${context.quoteId}`)}
              data-testid="rail-quote-number-link"
            >
              {context.quoteNumber ? `Quote #${context.quoteNumber}` : "Quote"}
            </button>
          }
          clientName={
            context.clientName ? (
              <button
                type="button"
                className="text-subheader font-semibold text-foreground hover:underline cursor-pointer text-left truncate block w-full mt-0.5"
                onClick={() => clientHref && setLocation(clientHref)}
                data-testid="rail-quote-client-name-link"
              >
                {context.clientName}
              </button>
            ) : null
          }
          action={
            <button
              type="button"
              className="shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors mt-0.5"
              onClick={() => setLocation(`/quotes/${context.quoteId}`)}
              aria-label="Open quote detail"
              data-testid="rail-quote-open-button"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          }
          meta={[
            {
              label: "Status",
              value: statusMeta
                ? <StatusChip tone={statusMeta.tone}>{statusMeta.label}</StatusChip>
                : "—",
            },
            {
              label: "Total",
              value: formatCurrency(context.total ?? null),
            },
            {
              label: "Expires",
              value: context.expiryDate
                ? format(parseISO(context.expiryDate), "MMM d, yyyy")
                : "—",
            },
          ]}
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      {/* ── Domain section cards ── */}
      <QuoteWarningsCard quote={quote} lines={lines} loading={loading} />
      <QuoteFollowUpCard quote={quote} loading={loading} />
      <QuoteApprovalCard quote={quote} loading={loading} />
      <QuoteConversionCard quote={quote} loading={loading} />
      <QuoteClientCommunicationCard
        quote={quote}
        location={location}
        customerCompany={customerCompany}
        loading={loading}
      />
      <QuoteQuickActionsCard quote={quote} loading={loading} />
      <QuoteSummaryCard
        quote={quote}
        location={location}
        loading={loading}
      />
      <QuoteTimelineCard notes={notes} loading={notesLoading} />
    </div>
  );
}
