import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { ServicePlanActionsRail } from "./ServicePlanActionsRail";
import type { ServicePlanSelectionContext } from "./ServicePlanListPanel";

interface ServicePlanRailBodyProps {
  context: ServicePlanSelectionContext;
  onDeleted?: () => void;
}

/**
 * Service plan rail adapter.
 * Wraps ServicePlanActionsRail in the canonical WorkspaceRailScrollContainer.
 * All scroll/hint/MutationObserver logic lives in the container.
 */
export function ServicePlanRailBody({ context, onDeleted }: ServicePlanRailBodyProps) {
  return (
    <WorkspaceRailScrollContainer
      contentTestId="service-plan-rail-scroll-body"
      hintTestId="service-plan-rail-scroll-hint"
    >
      <ServicePlanActionsRail context={context} onDeleted={onDeleted} />
    </WorkspaceRailScrollContainer>
  );
}
