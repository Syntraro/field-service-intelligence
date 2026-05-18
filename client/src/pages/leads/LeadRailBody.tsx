import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { LeadActionsRail, type SelectedLeadContext } from "./LeadActionsRail";

interface LeadRailBodyProps {
  context: SelectedLeadContext;
}

/**
 * Lead-domain rail adapter.
 * Wraps LeadActionsRail in the canonical WorkspaceRailScrollContainer.
 */
export function LeadRailBody({ context }: LeadRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="lead-rail-scroll-body"
      hintTestId="lead-rail-scroll-hint"
    >
      <LeadActionsRail context={context} />
    </WorkspaceRailScrollContainer>
  );
}
