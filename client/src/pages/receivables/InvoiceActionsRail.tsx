import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { SectionLabel } from "@/components/ui/typography";
import { formatCurrency } from "@/lib/formatters";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import { WorkspaceRailEntityCard } from "@/components/workspace/WorkspaceRailEntityCard";
import { InvoiceActionsCard } from "./sections/InvoiceActionsCard";
import { InvoiceContactsCard, type ContactPerson } from "./sections/InvoiceContactsCard";
import { InvoiceActivityCard, type ReceivablesNote } from "./sections/InvoiceActivityCard";
import type { SelectedReceivablesContext } from "./InvoiceRailBody";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

interface InvoiceActionsRailProps {
  context: SelectedReceivablesContext | null;
  activeView: InvoiceView;
}

/**
 * Invoice right rail — assembly-only.
 *
 * Query ownership rules (enforced here, not in section cards):
 * - Shared fetch: receivables notes (single invoice only)
 * - Shared fetch: customer company contacts (single invoice only)
 * - Section cards receive data via props; they own only their own mutations.
 *
 * No modal state here — each section card owns its own modal state.
 * Rail closes when the user clicks the selected row again (toggle in InvoiceListPanel).
 */
export function InvoiceActionsRail({ context, activeView }: InvoiceActionsRailProps) {
  const [, setLocation] = useLocation();
  const hasSelection = context !== null && context.selectedInvoiceIds.length > 0;
  const singleInvoiceId = context?.selectedInvoiceIds.length === 1
    ? context.selectedInvoiceIds[0]
    : null;

  // ── Shared rail-root fetches ───────────────────────────────────────────────

  const { data: notes = [], isLoading: notesLoading, isError: notesError } = useQuery<ReceivablesNote[]>({
    queryKey: receivablesKeys.notes(singleInvoiceId),
    queryFn: async () => {
      const res = await fetch(
        `/api/receivables/notes?invoiceId=${encodeURIComponent(singleInvoiceId!)}&limit=50`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load receivables notes");
      return res.json();
    },
    enabled: !!singleInvoiceId,
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
    enabled: !!singleInvoiceId && !!context?.customerCompanyId,
    staleTime: 60_000,
  });

  const contacts = useMemo(() => contactsData?.companyContacts ?? [], [contactsData]);

  // ── No selection — rail is only mounted when selected; this is a safety guard ──

  if (!hasSelection) return null;

  // ── Client navigation target ──────────────────────────────────────────────

  const clientHref = context?.locationId
    ? `/clients/${context.locationId}`
    : context?.customerCompanyId
      ? `/clients/${context.customerCompanyId}`
      : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div data-testid="receivables-actions-rail">

      {/* ── Client / Invoice card (single selection only) ── */}
      {singleInvoiceId && (
        <div>
          <SectionLabel className="mb-2">Client / Invoice</SectionLabel>
          <WorkspaceRailEntityCard
            icon={FileText}
            entityLabel={
              <button
                type="button"
                className="text-row text-brand hover:underline cursor-pointer text-left truncate block w-full"
                onClick={() => setLocation(`/invoices/${singleInvoiceId}`)}
                data-testid="rail-invoice-number-link"
              >
                {context.invoiceNumber ? `Invoice #${context.invoiceNumber}` : "Invoice"}
              </button>
            }
            clientName={
              context.clientName ? (
                <button
                  type="button"
                  className="text-subheader font-semibold text-foreground hover:underline cursor-pointer text-left truncate block w-full mt-0.5"
                  onClick={() => clientHref && setLocation(clientHref)}
                  data-testid="rail-client-name-link"
                >
                  {context.clientName}
                </button>
              ) : null
            }
            action={
              <button
                type="button"
                className="shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                onClick={() => setLocation(`/invoices/${singleInvoiceId}`)}
                aria-label="Open invoice detail"
                data-testid="rail-invoice-open-button"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            }
            meta={[
              {
                label: "Due Date",
                value: context.dueDate ? format(parseISO(context.dueDate), "MMM d, yyyy") : "—",
              },
              {
                label: "Balance Due",
                value: formatCurrency(context.balance ?? null),
              },
            ]}
          />
          <div className="-mx-3 mt-3 border-t border-slate-100" />
        </div>
      )}

      {/* ── Client Communication ── */}
      <div className="pt-3">
        <SectionLabel className="mb-2">Client Communication</SectionLabel>
        <InvoiceActionsCard context={context} activeView={activeView} />
      </div>

      {/* ── Contacts (single invoice only) ── */}
      {singleInvoiceId && (
        <>
          <div className="-mx-3 mt-3 border-t border-slate-100" />
          <div className="pt-3">
            <SectionLabel className="mb-2">Contacts</SectionLabel>
            <InvoiceContactsCard contacts={contacts} loading={contactsLoading} />
          </div>
        </>
      )}

      {/* ── Activity (single invoice only) ── */}
      {singleInvoiceId && (
        <>
          <div className="-mx-3 mt-3 border-t border-slate-100" />
          <div className="pt-3">
            <SectionLabel className="mb-2">Activity</SectionLabel>
            <InvoiceActivityCard notes={notes} loading={notesLoading} error={notesError} />
          </div>
        </>
      )}

    </div>
  );
}
