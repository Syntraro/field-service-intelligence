import { useQuery } from "@tanstack/react-query";
import { WorkspaceRailEmptyState } from "@/components/workspace/WorkspaceRailEmptyState";
import { QuoteWarningsCard } from "./sections/QuoteWarningsCard";
import { QuoteFollowUpCard } from "./sections/QuoteFollowUpCard";
import { QuoteApprovalCard } from "./sections/QuoteApprovalCard";
import { QuoteConversionCard } from "./sections/QuoteConversionCard";
import { QuoteClientCommunicationCard } from "./sections/QuoteClientCommunicationCard";
import { QuoteQuickActionsCard } from "./sections/QuoteQuickActionsCard";
import { QuoteSummaryCard } from "./sections/QuoteSummaryCard";
import { QuoteTimelineCard } from "./sections/QuoteTimelineCard";
import type { Quote, QuoteLine, QuoteNote } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectedQuoteContext {
  quoteId: string;
}

interface QuoteDetails {
  quote: Quote;
  lines: QuoteLine[];
  location: { id: string; companyName: string; address: string | null; city: string | null } | null;
  customerCompany: { id: string; name: string } | null;
  isExpired: boolean;
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" data-testid="quote-actions-rail">
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
        customerCompany={customerCompany}
        loading={loading}
      />
      <QuoteTimelineCard notes={notes} loading={notesLoading} />
    </div>
  );
}
