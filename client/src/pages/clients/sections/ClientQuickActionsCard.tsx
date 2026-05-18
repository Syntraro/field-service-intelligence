import { useLocation } from "wouter";
import {
  ExternalLink,
  Wrench,
  FileText,
  Receipt,
  MapPin,
  UserPlus,
  StickyNote,
} from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import type { SelectedClientContext } from "@/lib/clientsWorkspaceConfig";

interface ClientQuickActionsCardProps {
  context: SelectedClientContext;
  onCreateJob: () => void;
}

// ── Shared button variants ────────────────────────────────────────────────────

const primaryBtn =
  "w-full flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-left text-primary-foreground hover:bg-primary/90 transition-colors";

const secondaryBtn =
  "w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left hover:bg-accent transition-colors";

const disabledBtn =
  "w-full flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-left opacity-40 cursor-not-allowed";

// ── ClientQuickActionsCard ────────────────────────────────────────────────────

/**
 * Quick-actions card for the client right rail.
 *
 * Wired actions (Phase 2):
 *   - Open Client → navigate to /clients/:primaryLocationId
 *   - Create Job → opens CreateJobModal (pre-filled with primaryLocationId)
 *   - Create Quote → navigate to /quotes/new
 *   - Create Invoice → navigate to /invoices/new
 *
 * Disabled actions (Phase 3 TODO):
 *   - Add Location → requires AddLocationModal or ClientDetailPage wire-up
 *   - Add Contact → requires ContactFormDialog or ClientDetailPage wire-up
 *   - Add Note → requires entity-type determination for client-scoped notes
 */
export function ClientQuickActionsCard({
  context,
  onCreateJob,
}: ClientQuickActionsCardProps) {
  const [, setLocation] = useLocation();

  return (
    <WorkspaceSectionCard
      title="Quick Actions"
      data-testid="client-quick-actions-card"
    >
      <div className="space-y-2">
        {/* Open Client — primary action */}
        <button
          type="button"
          className={primaryBtn}
          onClick={() => setLocation(`/clients/${context.primaryLocationId}`)}
          data-testid="action-open-client"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-row font-medium">Open Client</span>
        </button>

        {/* Create Job — pre-fills location */}
        <button
          type="button"
          className={secondaryBtn}
          onClick={onCreateJob}
          data-testid="action-create-job"
        >
          <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Create Job</span>
        </button>

        {/* Create Quote */}
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => setLocation("/quotes/new")}
          data-testid="action-create-quote"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Create Quote</span>
        </button>

        {/* Create Invoice */}
        <button
          type="button"
          className={secondaryBtn}
          onClick={() => setLocation("/invoices/new")}
          data-testid="action-create-invoice"
        >
          <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Create Invoice</span>
        </button>

        {/* Add Location — TODO Phase 3 */}
        <button
          type="button"
          className={disabledBtn}
          disabled
          title="Coming in Phase 3"
          data-testid="action-add-location"
        >
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Add Location</span>
        </button>

        {/* Add Contact — TODO Phase 3 */}
        <button
          type="button"
          className={disabledBtn}
          disabled
          title="Coming in Phase 3"
          data-testid="action-add-contact"
        >
          <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Add Contact</span>
        </button>

        {/* Add Note — TODO Phase 3 */}
        <button
          type="button"
          className={disabledBtn}
          disabled
          title="Coming in Phase 3"
          data-testid="action-add-note"
        >
          <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-row font-medium">Add Note</span>
        </button>
      </div>
    </WorkspaceSectionCard>
  );
}
