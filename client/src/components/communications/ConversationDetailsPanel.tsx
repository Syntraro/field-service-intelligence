/**
 * Right column — Details / Activity tabs for the selected conversation.
 *
 * Stateless: receives the thread + the timeline rows from the page.
 * Activity tab is a Phase 1 placeholder; structure is in place so Phase
 * 2 can drop dispatch / status events in without UI changes.
 */

import type {
  CommunicationThread,
  CommunicationTimelineEntry,
} from "@shared/communicationsTypes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import type { CommunicationTimelineKind } from "@shared/communicationsTypes";

interface ConversationDetailsPanelProps {
  thread: CommunicationThread | null;
  timeline: readonly CommunicationTimelineEntry[];
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

export function ConversationDetailsPanel({ thread, timeline }: ConversationDetailsPanelProps) {
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
            <div className="space-y-4">
              {/* Contact */}
              <section data-testid="details-section-contact">
                <h3 className="text-label text-muted-foreground mb-1.5">Contact</h3>
                <div className="rounded-md border border-border/60 divide-y divide-border/60">
                  <DetailRow icon={Briefcase} label={thread.contact.displayName} />
                  {thread.contact.phoneNumber && (
                    <DetailRow icon={Phone} label={thread.contact.phoneNumber} />
                  )}
                  {thread.contact.email && (
                    <DetailRow icon={Mail} label={thread.contact.email} />
                  )}
                  {thread.contact.address && (
                    <DetailRow icon={MapPin} label={thread.contact.address} />
                  )}
                </div>
              </section>

              {/* Linked to */}
              {(thread.contact.linkedJobId ||
                thread.contact.linkedClientId ||
                thread.contact.linkedInvoiceId ||
                thread.contact.linkedQuoteId) && (
                <section data-testid="details-section-linked">
                  <h3 className="text-label text-muted-foreground mb-1.5">Linked To</h3>
                  <div className="rounded-md border border-border/60 divide-y divide-border/60">
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
                    <div className="px-2.5 py-2 text-helper text-muted-foreground">
                      No history yet.
                    </div>
                  ) : (
                    timeline.map((entry) => {
                      const Icon = TIMELINE_ICONS[entry.kind];
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-2 px-2.5 py-2"
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

function DetailRow({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
      <span className="text-row text-foreground truncate">{label}</span>
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}
