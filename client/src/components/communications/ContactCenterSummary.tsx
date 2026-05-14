/**
 * Center panel for the Contacts module — simple read-only contact summary.
 *
 * When an existing communication thread is found for the selected
 * contact's phone, surfaces an "Open conversation" CTA that flips the
 * page to the Inbox module and selects that thread.
 *
 * No placeholder copy — Phase 4B retires the previous module-stub state.
 */

import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Phone,
  Mail,
  Building2,
  MapPin,
  User,
  UsersRound,
  ArrowRight,
} from "lucide-react";
import type {
  ContactCandidate,
  LinkContactTargetKind,
} from "@/lib/communications/useCommunicationThreads";
import type { CommunicationThread } from "@shared/communicationsTypes";
import { phonesMatch, formatPhoneForDisplay } from "@shared/phoneNormalization";
import { getInitials } from "@/lib/getInitials";

interface ContactCenterSummaryProps {
  contact: ContactCandidate | null;
  /** All visible threads — used to find an existing conversation for this contact's phone. */
  threads: readonly CommunicationThread[];
  onOpenConversation: (threadId: string) => void;
}

const KIND_LABEL: Record<LinkContactTargetKind, string> = {
  contact_person: "Contact",
  customer_company: "Client",
  client_location: "Location",
  team_user: "Team member",
};

const KIND_ICON: Record<LinkContactTargetKind, React.ComponentType<{ className?: string }>> = {
  contact_person: User,
  customer_company: Building2,
  client_location: MapPin,
  team_user: UsersRound,
};

export function ContactCenterSummary({
  contact,
  threads,
  onOpenConversation,
}: ContactCenterSummaryProps) {
  if (!contact) {
    return (
      <section
        className="flex-1 min-w-0 flex flex-col items-center justify-center bg-card text-center px-6"
        data-testid="contact-center-empty"
      >
        <p className="text-row text-foreground">Select a contact</p>
        <p className="text-helper text-muted-foreground mt-1">
          Pick a contact from the list to see their details.
        </p>
      </section>
    );
  }

  const Icon = KIND_ICON[contact.kind];
  const phoneDisplay = contact.phone ? formatPhoneForDisplay(contact.phone) || contact.phone : null;
  const existingThread = contact.phone
    ? threads.find((t) => phonesMatch(t.contact.phoneNumber, contact.phone)) ?? null
    : null;

  return (
    <section
      className="flex-1 min-w-0 flex flex-col bg-card overflow-y-auto"
      data-testid="contact-center-summary"
    >
      <div className="px-6 py-6 max-w-2xl">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback className="text-row bg-muted">
              {getInitials({ fullName: contact.displayName })}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 leading-snug">
            <div className="text-header text-foreground truncate">
              {contact.displayName}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-helper text-muted-foreground">
              <Icon className="h-3 w-3" />
              {KIND_LABEL[contact.kind]}
              {contact.subline ? ` · ${contact.subline}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border/60 divide-y divide-border/60">
          {phoneDisplay && (
            <div
              className="flex items-center justify-between gap-2 px-3 py-2"
              data-testid="contact-summary-phone"
            >
              <span className="text-row text-foreground">{phoneDisplay}</span>
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          {contact.email && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-row text-foreground truncate">{contact.email}</span>
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          {!phoneDisplay && !contact.email && (
            <div className="px-3 py-2 text-helper text-muted-foreground">
              No phone or email on file.
            </div>
          )}
        </div>

        <div className="mt-4">
          {existingThread ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenConversation(existingThread.id)}
              className="h-8 gap-1.5 px-3"
              data-testid="contact-summary-open-conversation"
            >
              Open conversation
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <p
              className="text-helper text-muted-foreground"
              data-testid="contact-summary-no-conversation"
            >
              No conversation yet
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
