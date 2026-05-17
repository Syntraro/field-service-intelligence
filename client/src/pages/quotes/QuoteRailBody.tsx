import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { QuoteActionsRail } from "./QuoteActionsRail";
import type { SelectedQuoteContext } from "./QuoteActionsRail";

interface QuoteRailBodyProps {
  context: SelectedQuoteContext;
}

/**
 * Quote-domain rail adapter.
 * Wraps QuoteActionsRail in the canonical WorkspaceRailScrollContainer.
 * All scroll/hint/MutationObserver logic lives in the container.
 */
export function QuoteRailBody({ context }: QuoteRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="quote-rail-scroll-body"
      hintTestId="quote-rail-scroll-hint"
    >
      <QuoteActionsRail context={context} />
    </WorkspaceRailScrollContainer>
  );
}
