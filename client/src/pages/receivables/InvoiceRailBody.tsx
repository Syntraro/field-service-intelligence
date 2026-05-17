import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { InvoiceActionsRail } from "./InvoiceActionsRail";
import type { SelectedReceivablesContext } from "./InvoicesWorkspaceTab";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

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
