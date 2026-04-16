/**
 * HelpPanel (2026-04-15)
 *
 * Global Help dropdown panel rendered inside the header Popover.
 * Mirrors the structural conventions of TasksPanel (380px card,
 * white bg, 1px border, rounded-md, flex column with internal
 * scroll region) so both utility popovers read as part of the
 * same system.
 *
 * Scope is intentionally narrow: static quick-help entries and
 * two footer actions that both funnel into the existing
 * FeedbackDialog — the audit confirmed FeedbackDialog is the
 * canonical support UX in this app, so we reuse it instead of
 * inventing a new support backend. No article search, no AI,
 * no activity feed.
 *
 * The search input is a UI stub for a future content pass; it
 * filters the static quick-help list client-side so the control
 * is honest rather than decorative, but there is no network
 * call behind it.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HelpCircle,
  X,
  Search,
  Mail,
  MessageCircle,
  ChevronRight,
} from "lucide-react";

type QuickHelpItem = { id: string; label: string };

// Static list — first-pass content foundation. Real article
// routing/content is out of scope for this panel; keeping the
// labels here means future work only needs to wire each id to
// a destination.
const QUICK_HELP: QuickHelpItem[] = [
  { id: "setup-maintenance", label: "Set up maintenance" },
  { id: "dispatch-settings", label: "Dispatch settings" },
  { id: "scheduling-jobs", label: "Scheduling jobs" },
  { id: "creating-invoices", label: "Creating invoices" },
  { id: "managing-technicians", label: "Managing technicians" },
  { id: "quotes-approvals", label: "Quotes and approvals" },
];

export interface HelpPanelProps {
  onRequestClose?: () => void;
  onEmailSupport?: () => void;
  onProvideFeedback?: () => void;
}

export function HelpPanel({
  onRequestClose,
  onEmailSupport,
  onProvideFeedback,
}: HelpPanelProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QUICK_HELP;
    return QUICK_HELP.filter((i) => i.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <div
      className="w-[380px] bg-[#ffffff] dark:bg-gray-900 rounded-md border border-[#e2e8f0] flex flex-col"
      style={{ maxHeight: "70vh", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="help-panel"
    >
      {/* Header row — mirrors TasksPanel header rhythm */}
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 rounded-t-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-[#4b5563] dark:text-gray-300" />
            <span className="text-sm font-semibold text-[#111827] dark:text-gray-100">
              Help
            </span>
          </div>
          {onRequestClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRequestClose}
              title="Close"
              className="h-8 w-8 rounded-md text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
              data-testid="button-help-panel-close"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search — stubbed; filters the static list only */}
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#4b5563]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help..."
            className="h-8 pl-8 text-xs bg-[#ffffff] border-[#e2e8f0] text-[#111827] dark:bg-gray-700 dark:border-gray-600"
            data-testid="input-help-search"
          />
        </div>
      </div>

      {/* Quick Help list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 pt-3 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#4b5563]">
            Quick help
          </span>
        </div>
        {filtered.length === 0 ? (
          <div
            className="text-center py-6 text-xs text-muted-foreground"
            data-testid="help-panel-empty"
          >
            No results
          </div>
        ) : (
          <div className="pb-2">
            {filtered.map((item, index) => {
              const isLast = index === filtered.length - 1;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full px-4 py-2 flex items-center justify-between gap-2 text-left hover:bg-[#F0F5F0] transition-colors ${
                    !isLast ? "border-b border-[#e2e8f0]" : ""
                  }`}
                  data-testid={`help-item-${item.id}`}
                >
                  <span className="text-xs text-[#111827]">{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-[#4b5563] shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer actions — both reuse the canonical FeedbackDialog */}
      <div className="border-t border-[#e2e8f0] dark:border-gray-600 p-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEmailSupport}
          className="flex-1 h-8 justify-start text-xs text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
          data-testid="button-help-email-support"
        >
          <Mail className="h-3.5 w-3.5 mr-2" />
          Email support
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onProvideFeedback}
          className="flex-1 h-8 justify-start text-xs text-[#4b5563] hover:text-[#111827] hover:bg-[#F0F5F0]"
          data-testid="button-help-provide-feedback"
        >
          <MessageCircle className="h-3.5 w-3.5 mr-2" />
          Provide feedback
        </Button>
      </div>
    </div>
  );
}
