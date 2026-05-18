import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { InvoiceActionsRail } from "./InvoiceActionsRail";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

export type SelectedReceivablesContext = {
  customerCompanyId: string | null;
  selectedInvoiceIds: string[];
  selectedPaymentId?: string | null;
  followUpAt?: string | null;
  invoiceNumber?: string | null;
  clientName?: string | null;
  dueDate?: string | null;
  balance?: string | null;
  locationId?: string | null;
};

interface InvoiceRailBodyProps {
  context: SelectedReceivablesContext;
  activeView: InvoiceView;
}

/**
 * Invoice-domain rail adapter.
 * Wraps InvoiceActionsRail in the canonical WorkspaceRailScrollContainer.
 * All scroll/hint/MutationObserver logic lives in the container.
 */
export function InvoiceRailBody({ context, activeView }: InvoiceRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="invoice-rail-scroll-body"
      hintTestId="invoice-rail-scroll-hint"
    >
      <InvoiceActionsRail context={context} activeView={activeView} />
    </WorkspaceRailScrollContainer>
  );
}
