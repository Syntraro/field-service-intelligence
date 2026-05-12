/**
 * Right column — Details / Activity tabs for the selected conversation.
 *
 * Phase 2 contract
 * ----------------
 * The panel still renders stateless. The page owns the
 * `useResolveContact(thread.contact.phoneNumber)` query and passes the
 * `resolution` result here. We branch on `resolution.confidence`:
 *
 *   • `exact_single`     → render the matched contact (real linked data).
 *   • `multiple_matches` → show a "Multiple contacts match" notice +
 *                          a Link Contact button that opens the
 *                          conflict dialog upstream.
 *   • `unknown`          → show "Unknown contact" + a Link Contact CTA.
 *   • undefined          → fall back to the contact info on the thread
 *                          row (Phase 1 mock).
 *
 * The Link Contact action is owned upstream — the panel just emits the
 * intent so the page can mount the dialog with the right mode.
 */

import type {
  CommunicationThread,
  CommunicationTimelineEntry,
  CommunicationTimelineKind,
  ContactMatch,
  ContactResolutionResult,
} from "@shared/communicationsTypes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RailContentCardMeta } from "@/components/detail-rail/RailContentCard";
import {
  Phone,
  Mail,
  MapPin,
  Briefcase,
  FileText,
  Receipt,
  MessageSquare,
  PhoneIncoming,
  Voicemail,
  StickyNote,
  PhoneMissed,
  Link2,
  CircleAlert,
  Loader2,
} from "lucide-react";

export type DetailsLinkIntent = "unknown" | "conflict";

interface ConversationDetailsPanelProps {
  thread: CommunicationThread | null;
  timeline: readonly CommunicationTimelineEntry[];
  /**
   * Server-resolved contact for the selected thread's phone. Undefined
   * when no phone is on the thread or the lookup hasn't run yet.
   */
  resolution?: ContactResolutionResult;
  /** Whether `resolution` is still loading. */
  resolutionLoading?: boolean;
  /** Whether the resolution query failed. */
  resolutionError?: boolean;
  /** Emitted when the user clicks "Link Contact" — page mounts the dialog. */
  onRequestLink?: (intent: DetailsLinkIntent) => void;
}

const TIMELINE_ICONS: Record<CommunicationTimelineKind, React.ComponentType<{ className?: string }>> = {
  sms: MessageSquare,
  call: PhoneIncoming,
  missed_call: PhoneMissed,
  voicemail: Voicemail,
  invoice_sent: Receipt,
  quote_sent: FileText,
  internal_note: StickyNote,
};

function formatTimelineTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString();
}

interface ResolvedView {
  displayName: string;
  phone: string | null;
  email: string | null;
  customerCompanyName?: string;
  locationName?: string;
  addressLine?: string;
}

/**
 * Project the resolution result down into the shape the Contact section
 * renders. Falls back to the thread's contact ref when the lookup didn't
 * land an exact single match.
 */
function buildResolvedView(
  thread: CommunicationThread,
  resolution: ContactResolutionResult | undefined,
  primaryOverride: ContactMatch | null,
): ResolvedView {
  const exact =
    primaryOverride ??
    (resolution?.confidence === "exact_single" ? resolution.primary : null);
  if (exact) {
    return {
      displayName: exact.displayName,
      phone: exact.phone ?? thread.contact.phoneNumber ?? null,
      email: exact.email ?? thread.contact.email ?? null,
      customerCompanyName: exact.customerCompanyName,
      locationName: exact.locationName,
      addressLine: exact.addressLine ?? thread.contact.address,
    };
  }
  return {
    displayName: thread.contact.displayName,
    phone: thread.contact.phoneNumber ?? null,
    email: thread.contact.email ?? null,
    addressLine: thread.contact.address,
  };
}

export function ConversationDetailsPanel({
  thread,
  timeline,
  resolution,
  resolutionLoading,
  resolutionError,
  onRequestLink,
}: ConversationDetailsPanelProps) {
  return (
    <aside
      className="hidden xl:flex w-[340px] max-w-[360px] shrink-0 flex-col bg-card border-l border-border min-h-0"
      data-testid="communications-details-panel"
    >
      <Tabs defaultValue="details" className="flex flex-col flex-1 min-h-0">
        <TabsList className="mx-3 mt-2 mb-1 h-8 shrink-0">
          <TabsTrigger value="details" className="text-helper px-3" data-testid="details-tab-details">
            Details
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-helper px-3" data-testid="details-tab-activity">
            Activity
          </TabsTrigger>
        </TabsList>

        {/* DETAILS */}
        <TabsContent value="details" className="flex-1 overflow-y-auto px-3 py-2 m-0">
          {!thread ? (
            <p className="text-helper text-muted-foreground text-center py-8">
              Select a conversation to see contact details.
            </p>
          ) : (
            <DetailsBody
              thread={thread}
              timeline={timeline}
              resolution={resolution}
              resolutionLoading={resolutionLoading}
              resolutionError={resolutionError}
              onRequestLink={onRequestLink}
            />
          )}
        </TabsContent>

        {/* ACTIVITY (placeholder) */}
        <TabsContent value="activity" className="flex-1 overflow-y-auto px-3 py-2 m-0">
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
            <p className="text-row text-foreground">Activity coming soon</p>
            <p className="text-helper text-muted-foreground mt-1">
              System events, dispatch updates, technician notes, and status
              changes will surface here.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

interface DetailsBodyProps extends Omit<ConversationDetailsPanelProps, "timeline"> {
  thread: CommunicationThread;
  timeline: readonly CommunicationTimelineEntry[];
}

function DetailsBody({
  thread,
  timeline,
  resolution,
  resolutionLoading,
  resolutionError,
  onRequestLink,
}: DetailsBodyProps) {
  const view = buildResolvedView(thread, resolution, null);
  const confidence = resolution?.confidence;

  return (
    <div className="space-y-4">
      {/* Resolution banner — only when the lookup ran and yielded a non-exact result. */}
      {confidence === "unknown" && (
        <ResolutionBanner
          icon={CircleAlert}
          tone="amber"
          title="Unknown contact"
          subtitle="This number isn't linked to anyone in your system yet."
          actionLabel="Link Contact"
          actionTestId="details-link-contact-unknown"
          onAction={() => onRequestLink?.("unknown")}
        />
      )}
      {confidence === "multiple_matches" && (
        <ResolutionBanner
          icon={CircleAlert}
          tone="amber"
          title="Multiple contacts match"
          subtitle={`${resolution?.matches.length ?? 0} possible matches — pick the right one.`}
          actionLabel="Link Contact"
          actionTestId="details-link-contact-conflict"
          onAction={() => onRequestLink?.("conflict")}
        />
      )}
      {resolutionLoading && (
        <div className="rounded-md border border-border/60 px-3 py-2 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-helper text-muted-foreground">Looking up contact…</span>
        </div>
      )}
      {resolutionError && (
        <div className="rounded-md border border-destructive/40 px-3 py-2 text-helper text-destructive">
          Couldn't load contact details.
        </div>
      )}

      {/* Contact */}
      <section data-testid="details-section-contact">
        <h3 className="text-label text-muted-foreground mb-1.5">Contact</h3>
        <div className="rounded-md border border-border/60 divide-y divide-border/60">
          <DetailRow icon={Briefcase} label={view.displayName} />
          {view.phone && <DetailRow icon={Phone} label={view.phone} />}
          {view.email && <DetailRow icon={Mail} label={view.email} />}
          {view.addressLine && <DetailRow icon={MapPin} label={view.addressLine} />}
        </div>
      </section>

      {/* Linked to */}
      {(thread.contact.linkedJobId ||
        thread.contact.linkedClientId ||
        thread.contact.linkedInvoiceId ||
        thread.contact.linkedQuoteId ||
        view.customerCompanyName ||
        view.locationName) && (
        <section data-testid="details-section-linked">
          <h3 className="text-label text-muted-foreground mb-1.5">Linked To</h3>
          <div className="rounded-md border border-border/60 divide-y divide-border/60">
            {view.customerCompanyName && (
              <DetailRow
                icon={Briefcase}
                label={`Client · ${view.customerCompanyName}`}
              />
            )}
            {view.locationName && (
              <DetailRow icon={MapPin} label={`Location · ${view.locationName}`} />
            )}
            {thread.contact.linkedJobId && (
              <DetailRow
                icon={Briefcase}
                label={
                  thread.contact.linkedJobTitle
                    ? `Job · ${thread.contact.linkedJobTitle}`
                    : "Job"
                }
              />
            )}
            {thread.contact.linkedInvoiceId && (
              <DetailRow
                icon={Receipt}
                label={`Invoice ${thread.contact.linkedInvoiceNumber ?? ""}`.trim()}
              />
            )}
            {thread.contact.linkedQuoteId && (
              <DetailRow
                icon={FileText}
                label={`Quote #${thread.contact.linkedQuoteNumber ?? ""}`.trim()}
              />
            )}
          </div>
        </section>
      )}

      {/* Communication history */}
      <section data-testid="details-section-history">
        <h3 className="text-label text-muted-foreground mb-1.5">Communication History</h3>
        <div className="rounded-md border border-border/60 divide-y divide-border/60">
          {timeline.length === 0 ? (
            <RailContentCardMeta className="px-2.5 py-2">
              No history yet.
            </RailContentCardMeta>
          ) : (
            timeline.map((entry) => {
              const Icon = TIMELINE_ICONS[entry.kind];
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                  data-testid={`timeline-entry-${entry.kind}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-row text-foreground truncate">
                      {entry.label}
                    </span>
                  </div>
                  <span className="shrink-0 text-helper text-muted-foreground">
                    {formatTimelineTime(entry.createdAt)}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-helper"
            data-testid="details-view-full-timeline"
          >
            View Full Timeline
          </Button>
        </div>
      </section>
    </div>
  );
}

interface ResolutionBannerProps {
  icon: React.ComponentType<{ className?: string }>;
  tone: "amber" | "blue";
  title: string;
  subtitle: string;
  actionLabel: string;
  actionTestId: string;
  onAction: () => void;
}

function ResolutionBanner({
  icon: Icon,
  tone,
  title,
  subtitle,
  actionLabel,
  actionTestId,
  onAction,
}: ResolutionBannerProps) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-50 ring-amber-100 text-amber-700"
      : "bg-blue-50 ring-blue-100 text-blue-700";
  return (
    <div
      className={`rounded-md ring-1 px-3 py-2 ${toneClass}`}
      data-testid="details-resolution-banner"
    >
      <div className="flex items-start gap-2">
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-row-emphasis">{title}</div>
          <div className="text-helper opacity-90">{subtitle}</div>
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-helper gap-1.5"
          onClick={onAction}
          data-testid={actionTestId}
        >
          <Link2 className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-row text-foreground truncate">{label}</span>
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}
