import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { ClientActionsRail } from "./ClientActionsRail";
import type { SelectedClientContext } from "@/lib/clientsWorkspaceConfig";

interface ClientRailBodyProps {
  context: SelectedClientContext;
}

/**
 * Client-domain rail adapter.
 * Wraps ClientActionsRail in the canonical WorkspaceRailScrollContainer.
 * All scroll/hint/MutationObserver logic lives in the container.
 */
export function ClientRailBody({ context }: ClientRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="client-rail-scroll-body"
      hintTestId="client-rail-scroll-hint"
    >
      <ClientActionsRail context={context} />
    </WorkspaceRailScrollContainer>
  );
}
