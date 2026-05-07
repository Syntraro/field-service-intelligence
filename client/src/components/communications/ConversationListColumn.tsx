/**
 * Left column — page title, search, filter pills, conversation list.
 *
 * Stateless presentation: receives the already-filtered (role-aware)
 * thread list, the local search/filter state, and selection from its
 * parent. The page owns the persistent URL state; this column owns
 * only the search input and pill state because those reset every visit.
 */

import { useMemo, useState } from "react";
import type { CommunicationThread } from "@shared/communicationsTypes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Settings2 } from "lucide-react";
import { ConversationRow } from "./ConversationRow";
import { cn } from "@/lib/utils";

type FilterPill = "all" | "unread" | "team" | "clients";

interface ConversationListColumnProps {
  threads: readonly CommunicationThread[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Hide the "Team" pill for technicians (team_chat is gated). */
  showTeamPill: boolean;
}

export function ConversationListColumn({
  threads,
  selectedId,
  onSelect,
  showTeamPill,
}: ConversationListColumnProps) {
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<FilterPill>("all");

  const counts = useMemo(() => {
    let unread = 0;
    let team = 0;
    let clients = 0;
    for (const t of threads) {
      if (t.unreadCount > 0) unread += 1;
      if (t.threadType === "team_chat") team += 1;
      else if (t.threadType === "client_sms") clients += 1;
    }
    return { unread, team, clients };
  }, [threads]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (pill === "unread" && t.unreadCount === 0) return false;
      if (pill === "team" && t.threadType !== "team_chat") return false;
      if (pill === "clients" && t.threadType !== "client_sms") return false;
      if (needle.length === 0) return true;
      const hay =
        `${t.contact.displayName} ${t.contact.phoneNumber ?? ""} ${t.lastMessagePreview}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [threads, query, pill]);

  const pills: { key: FilterPill; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread", count: counts.unread },
    ...(showTeamPill ? [{ key: "team" as FilterPill, label: "Team", count: counts.team }] : []),
    { key: "clients", label: "Clients", count: counts.clients },
  ];

  return (
    <aside
      className="hidden md:flex w-[340px] shrink-0 flex-col bg-card border-r border-border min-h-0"
      data-testid="communications-list-column"
    >
      {/* Title */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-border shrink-0">
        <h1 className="text-subhead text-foreground">Messages</h1>
      </div>

      {/* Search */}
      <div className="px-3 py-2 flex items-center gap-1.5 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="h-8 pl-7 text-row"
            data-testid="communications-search-input"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="List settings"
          data-testid="communications-list-settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Filter pills */}
      <div
        className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto shrink-0"
        data-testid="communications-filter-pills"
      >
        {pills.map((p) => {
          const active = pill === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPill(p.key)}
              className={cn(
                "h-7 px-2.5 rounded-full text-helper whitespace-nowrap inline-flex items-center gap-1 transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover-elevate",
              )}
              data-testid={`communications-filter-${p.key}`}
              aria-pressed={active}
            >
              {p.label}
              {p.count !== undefined && p.count > 0 && (
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

      {/* List */}
      <div className="flex-1 overflow-y-auto" data-testid="communications-list-scroll">
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-helper text-muted-foreground">
            {query.trim() ? "No matching conversations." : "No conversations yet."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {visible.map((t) => (
              <ConversationRow
                key={t.id}
                thread={t}
                selected={t.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
