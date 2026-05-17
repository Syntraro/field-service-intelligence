import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { JobActionsRail, type SelectedJobContext } from "./JobActionsRail";

interface JobRailBodyProps {
  context: SelectedJobContext;
}

/**
 * Jobs-domain rail adapter.
 * Wraps JobActionsRail in the canonical WorkspaceRailScrollContainer.
 * All scroll/hint/MutationObserver logic lives in the container.
 */
export function JobRailBody({ context }: JobRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="job-rail-scroll-body"
      hintTestId="job-rail-scroll-hint"
    >
      <JobActionsRail context={context} />
    </WorkspaceRailScrollContainer>
  );
}
