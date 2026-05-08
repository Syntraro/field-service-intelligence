/**
 * Left column for the Contacts module — flat list of all tenant contacts
 * across the four canonical sources (customer_companies, contact_persons,
 * client_locations, team_users when role allows).
 *
 * Stateless: receives the already-loaded list, the active selection key,
 * and a select handler. The page owns the fetch via `useSystemContacts`
 * + the local search filter.
 */

import { useMemo, useState } from "react";
import type { ContactCandidate, LinkContactTargetKind } from "@/lib/communications/useCommunicationThreads";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Building2, MapPin, User, UsersRound, Loader2 } from "lucide-react";
import { getInitials } from "@/lib/getInitials";
import { formatPhoneForDisplay } from "@shared/phoneNormalization";
import { cn } from "@/lib/utils";
import { EntityMeta, EntityName } from "@/components/ui/typography";

type ContactFilterPill = "all" | "clients" | "team";

interface ContactsListColumnProps {
  contacts: readonly ContactCandidate[];
  loading?: boolean;
  /** "<kind>:<id>" — same shape used internally to identify a row. */
  selectedKey: string | null;
  onSelect: (contact: ContactCandidate) => void;
}

const KIND_LABEL: Record<LinkContactTargetKind, string> = {
  contact_person: "Contact",
  customer_company: "Client",
  client_location: "Location",
  team_user: "Team",
};

const KIND_ICON: Record<LinkContactTargetKind, React.ComponentType<{ className?: string }>> = {
  contact_person: User,
  customer_company: Building2,
  client_location: MapPin,
  team_user: UsersRound,
};

export function contactRowKey(c: Pick<ContactCandidate, "kind" | "id">): string {
  return `${c.kind}:${c.id}`;
}

export function ContactsListColumn({
  contacts,
  loading = false,
  selectedKey,
  onSelect,
}: ContactsListColumnProps) {
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<ContactFilterPill>("all");

  const counts = useMemo(() => {
    let team = 0;
    let clients = 0;
    for (const c of contacts) {
      if (c.kind === "team_user") team += 1;
      else clients += 1;
    }
    return { all: contacts.length, team, clients };
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      // Pill scope
      if (pill === "team" && c.kind !== "team_user") return false;
      if (pill === "clients" && c.kind === "team_user") return false;
      if (q.length === 0) return true;
      // Search matches name, subline (company name), phone, email.
      const hay =
        `${c.displayName} ${c.subline ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, query, pill]);

  const pills: { key: ContactFilterPill; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "clients", label: "Clients", count: counts.clients },
    { key: "team", label: "Team", count: counts.team },
  ];

  return (
    <aside
      className="hidden md:flex w-[340px] shrink-0 flex-col bg-card border-r border-border min-h-0"
      data-testid="communications-contacts-column"
    >
      <div className="flex items-center justify-between px-3 h-12 border-b border-border shrink-0">
        <h1 className="text-subhead text-foreground">Contacts</h1>
      </div>

      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="h-8 pl-7 text-row"
            data-testid="contacts-search-input"
          />
        </div>
      </div>

      <div
        className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto shrink-0"
        data-testid="contacts-filter-pills"
      >
        {pills.map((p) => {
          const active = pill === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPill(p.key)}
              aria-pressed={active}
              data-testid={`contacts-filter-${p.key}`}
              className={cn(
                "h-7 px-2.5 rounded-full text-helper whitespace-nowrap inline-flex items-center gap-1 transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover-elevate",
              )}
            >
              {p.label}
              {p.count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center h-4 min-w-4 rounded-full px-1 text-helper",
                    active ? "bg-background/20 text-background" : "bg-card text-foreground",
                  )}
                >
                  {p.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-border" />

      <div className="flex-1 overflow-y-auto" data-testid="contacts-list-scroll">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-helper">Loading contacts…</span>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-helper text-muted-foreground">
            {query.trim() ? "No matching contacts." : "No contacts yet."}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-border/60">
            {filtered.map((c) => {
              const Icon = KIND_ICON[c.kind];
              const key = contactRowKey(c);
              const selected = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(c)}
                  data-testid={`contact-row-${c.id}`}
                  aria-pressed={selected}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
                    selected ? "bg-blue-50/60" : "hover-elevate active-elevate-2",
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-helper bg-muted">
                      {getInitials({ fullName: c.displayName })}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="flex items-center justify-between gap-2">
                      <EntityName className="min-w-0">{c.displayName}</EntityName>
                      <span
                        className="shrink-0 inline-flex items-center gap-1 text-caption text-muted-foreground"
                        data-testid={`contact-row-kind-${c.kind}`}
                      >
                        <Icon className="h-3 w-3" />
                        {KIND_LABEL[c.kind]}
                      </span>
                    </div>
                    {(c.subline || c.phone || c.email) && (
                      <EntityMeta className="mt-0.5">
                        {[
                          c.subline,
                          c.phone ? formatPhoneForDisplay(c.phone) : null,
                          c.email,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </EntityMeta>
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
