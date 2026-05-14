/**
 * Center panel for the Team Chat module.
 *
 * If a team_chat thread exists with the selected member as a participant,
 * surfaces an "Open conversation" button (page wires it to switch into
 * the Inbox module on that thread).
 *
 * Otherwise: read-only summary + "No team conversation yet" copy. The
 * previous module-stub placeholder is retired.
 */

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowRight, Mail, Phone, UsersRound } from "lucide-react";
import type { CommunicationsTeamMember } from "@/lib/communications/useCommunicationThreads";
import type { CommunicationThread } from "@shared/communicationsTypes";
import { formatPhoneForDisplay } from "@shared/phoneNormalization";
import { getInitials } from "@/lib/getInitials";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
};

interface TeamChatCenterProps {
  member: CommunicationsTeamMember | null;
  /** All visible threads. We only consider `team_chat` rows. */
  threads: readonly CommunicationThread[];
  onOpenConversation: (threadId: string) => void;
}

export function TeamChatCenter({
  member,
  threads,
  onOpenConversation,
}: TeamChatCenterProps) {
  if (!member) {
    return (
      <section
        className="flex-1 min-w-0 flex flex-col items-center justify-center bg-card text-center px-6"
        data-testid="team-chat-center-empty"
      >
        <p className="text-row text-foreground">Select a team member</p>
        <p className="text-helper text-muted-foreground mt-1">
          Pick someone from the list to see their team chat.
        </p>
      </section>
    );
  }

  const phoneDisplay = member.phone ? formatPhoneForDisplay(member.phone) || member.phone : null;
  const existingThread =
    threads.find(
      (t) =>
        t.threadType === "team_chat" &&
        t.participantUserIds.includes(member.id),
    ) ?? null;

  return (
    <section
      className="flex-1 min-w-0 flex flex-col bg-card overflow-y-auto"
      data-testid="team-chat-center"
    >
      <div className="px-6 py-6 max-w-2xl">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback className="text-row bg-muted">
              {getInitials({ fullName: member.displayName })}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 leading-snug">
            <div className="text-header text-foreground truncate">
              {member.displayName}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-helper text-muted-foreground">
              <UsersRound className="h-3 w-3" />
              {ROLE_LABEL[member.role] ?? member.role}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border/60 divide-y divide-border/60">
          {member.email && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-row text-foreground truncate">{member.email}</span>
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          {phoneDisplay && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-row text-foreground">{phoneDisplay}</span>
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          {!member.email && !phoneDisplay && (
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
              data-testid="team-chat-open-conversation"
            >
              Open conversation
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <p
              className="text-helper text-muted-foreground"
              data-testid="team-chat-no-conversation"
            >
              No team conversation yet
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
