import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink, Eye, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { SectionLabel } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { getQuoteStatusMeta } from "@/lib/statusBadges";
import { StatusChip } from "@/components/ui/chip";
import { WorkspaceRailEmptyState } from "@/components/workspace/WorkspaceRailEmptyState";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { QuoteWarningsCard } from "./sections/QuoteWarningsCard";
import { QuoteActionsCard } from "./sections/QuoteActionsCard";
import { QuoteActivityCard } from "./sections/QuoteActivityCard";
import { InvoiceContactsCard, type ContactPerson } from "@/pages/receivables/sections/InvoiceContactsCard";
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
 * - GET /api/quotes/:id/notes    — activity notes
 * - GET /api/customer-companies/:id/contacts — billing contacts
 *
 * Section cards receive data via props; they own only their own mutations.
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

  const { data: notes = [], isLoading: notesLoading, isError: notesError } = useQuery<QuoteNote[]>({
    queryKey: ["quote", quoteId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/${quoteId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load quote notes");
      return res.json();
    },
    enabled: !!quoteId,
    staleTime: 30_000,
  });

  const { data: contactsData, isLoading: contactsLoading } = useQuery<{
    companyContacts: ContactPerson[];
  }>({
    queryKey: ["customer-company", context?.customerCompanyId, "contacts"],
    queryFn: async () => {
      const res = await fetch(
        `/api/customer-companies/${context!.customerCompanyId}/contacts`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
    enabled: !!quoteId && !!context?.customerCompanyId,
    staleTime: 60_000,
  });

  const contacts = useMemo(() => contactsData?.companyContacts ?? [], [contactsData]);

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
              label: "Expires",
              value: context.expiryDate
                ? format(parseISO(context.expiryDate), "MMM d, yyyy")
                : "—",
            },
          ]}
        />
        <div className="-mx-3 mt-3 border-t border-slate-100" />
      </div>

      {/* ── Warnings (suppressed when empty) ── */}
      <QuoteWarningsCard quote={quote} lines={lines} loading={loading} />

      {/* ── Preview Quote button ── */}
      <div className="pt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 rounded-lg h-8 text-row"
          onClick={() => setLocation(`/quotes/${context.quoteId}`)}
          data-testid="rail-quote-preview"
        >
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          Preview Quote
        </Button>
      </div>

      {/* ── Actions ── */}
      <div className="pt-3">
        <QuoteActionsCard quote={quote} loading={loading} />
      </div>

      {/* ── Contacts ── */}
      {context.customerCompanyId && (
        <>
          <div className="-mx-3 mt-3 border-t border-slate-100" />
          <div className="pt-3">
            <SectionLabel className="mb-2">Contacts</SectionLabel>
            <InvoiceContactsCard contacts={contacts} loading={contactsLoading} />
          </div>
        </>
      )}

      {/* ── Activity ── */}
      <>
        <div className="-mx-3 mt-3 border-t border-slate-100" />
        <div className="pt-3">
          <SectionLabel className="mb-2">Activity</SectionLabel>
          <QuoteActivityCard
            quote={quote}
            notes={notes}
            loading={notesLoading}
            error={notesError}
          />
        </div>
      </>

    </div>
  );
}
