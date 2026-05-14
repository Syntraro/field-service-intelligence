/**
 * Left column for the Team Chat module — tenant team members list.
 *
 * Stateless: page owns the data fetch via `useTeamMembers` and the
 * selection state.
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";
import type { CommunicationsTeamMember } from "@/lib/communications/useCommunicationThreads";
import { getInitials } from "@/lib/getInitials";
import { formatPhoneForDisplay } from "@shared/phoneNormalization";
import { cn } from "@/lib/utils";
import { EntityMeta, EntityName } from "@/components/ui/typography";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
};

interface TeamMembersListColumnProps {
  members: readonly CommunicationsTeamMember[];
  loading?: boolean;
  selectedUserId: string | null;
  onSelect: (member: CommunicationsTeamMember) => void;
}

export function TeamMembersListColumn({
  members,
  loading = false,
  selectedUserId,
  onSelect,
}: TeamMembersListColumnProps) {
  return (
    <aside
      className="hidden md:flex w-[340px] shrink-0 flex-col bg-card border-r border-border min-h-0"
      data-testid="communications-team-column"
    >
      <div className="flex items-center justify-between px-3 h-12 border-b border-border shrink-0">
        <h1 className="text-subheader text-foreground">Team Chat</h1>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="team-list-scroll">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-helper">Loading team…</span>
          </div>
        )}
        {!loading && members.length === 0 && (
          <div className="px-4 py-8 text-center text-helper text-muted-foreground">
            No team members yet.
          </div>
        )}
        {!loading && members.length > 0 && (
          <div className="divide-y divide-border/60">
            {members.map((m) => {
              const selected = selectedUserId === m.id;
              const phoneDisplay = m.phone ? formatPhoneForDisplay(m.phone) || m.phone : null;
              const subline =
                [
                  ROLE_LABEL[m.role] ?? m.role,
                  m.email,
                  phoneDisplay,
                ]
                  .filter(Boolean)
                  .join(" · ");
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m)}
                  data-testid={`team-row-${m.id}`}
                  aria-pressed={selected}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
                    selected ? "bg-blue-50/60" : "hover-elevate active-elevate-2",
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-helper bg-muted">
                      {getInitials({ fullName: m.displayName })}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-snug">
                    <EntityName className="min-w-0">{m.displayName}</EntityName>
                    {subline && (
                      <EntityMeta className="mt-0.5">{subline}</EntityMeta>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
