/**
 * LinkContactDialog — Phase 2 UI shell.
 *
 * Surfaces the manual-linking entry points for an unknown phone number
 * OR a multi-match conflict. Phase 2 establishes the surface contract;
 * the actual write actions are deferred — every "Confirm" click is a
 * documented TODO so a follow-up PR can wire the mutation without UI
 * churn.
 *
 * Three branches:
 *
 *   • props.mode === "unknown"           — phone not on file at all.
 *     Offers: link to existing contact, link to existing client/location,
 *     create new contact (placeholder).
 *
 *   • props.mode === "conflict"          — multiple matches; user picks one.
 *
 *   • not rendered when confidence === "exact_single".
 *
 * No write to the database. No provider names anywhere.
 */

import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User,
  Building2,
  MapPin,
  UsersRound,
  CircleAlert,
  Plus,
  Search,
  Loader2,
} from "lucide-react";
import type {
  ContactMatch,
  ContactMatchType,
} from "@shared/communicationsTypes";
import { formatPhoneForDisplay } from "@shared/phoneNormalization";
import {
  useContactCandidates,
  type ContactCandidate,
  type LinkContactTargetKind,
} from "@/lib/communications/useCommunicationThreads";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { PickerShell } from "@/components/ui/picker-shell";

type LinkContactDialogMode = "unknown" | "conflict";

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LinkContactDialogMode;
  phone: string;
  /** Conflict mode — the candidate matches to choose between. */
  candidates?: readonly ContactMatch[];
  /** Currently-selected match (conflict mode only). */
  selectedSourceId?: string | null;
  onSelectMatch?: (m: ContactMatch) => void;
  /**
   * Phase 4: every primary action delegates here with the chosen intent.
   * The page wires the actual mutation in `handleLinkIntent`.
   */
  onIntent?: (intent: LinkIntent) => void;
  /** True while the link mutation is in flight — disables Confirm. */
  linking?: boolean;
}

export type LinkIntent =
  | { kind: "create-new-contact" }
  | {
      kind: "select-match";
      sourceId: string;
      matchType: ContactMatchType;
    }
  | {
      // Unknown-mode: user picked a candidate from the search picker.
      // The page calls the link API with this exact { kind, id } pair.
      kind: "pick-candidate";
      candidateKind: LinkContactTargetKind;
      candidateId: string;
    };

const MATCH_TYPE_ICON: Record<ContactMatchType, React.ComponentType<{ className?: string }>> = {
  team_user: UsersRound,
  contact_person: User,
  customer_company: Building2,
  client_location: MapPin,
};

const MATCH_TYPE_LABEL: Record<ContactMatchType, string> = {
  team_user: "Team member",
  contact_person: "Contact",
  customer_company: "Client",
  client_location: "Location",
};

const CANDIDATE_KIND_ICON: Record<LinkContactTargetKind, React.ComponentType<{ className?: string }>> = {
  team_user: UsersRound,
  contact_person: User,
  customer_company: Building2,
  client_location: MapPin,
};

export function LinkContactDialog({
  open,
  onOpenChange,
  mode,
  phone,
  candidates = [],
  selectedSourceId = null,
  onSelectMatch,
  onIntent,
  linking = false,
}: LinkContactDialogProps) {
  const phoneDisplay = phone ? formatPhoneForDisplay(phone) || phone : "this number";

  // Unknown-mode candidate search. The picker fires once the user
  // types ≥ 2 characters; selecting a row emits a `pick-candidate`
  // intent that the page wires to `useLinkCommunicationThreadContact`.
  const [unknownQuery, setUnknownQuery] = useState("");
  const candidatesQuery = useContactCandidates(mode === "unknown" ? unknownQuery : "");
  const showCandidates =
    mode === "unknown" && unknownQuery.trim().length >= 2;
  const unknownCandidates = (candidatesQuery.data ?? []) as ContactCandidate[];

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      data-testid="link-contact-dialog"
    >
      <ModalHeader>
        <ModalTitle>
          {mode === "unknown" ? "Link contact" : "Multiple contacts match"}
        </ModalTitle>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <div className="rounded-md border border-border/60 px-3 py-2 flex items-center gap-2">
          <CircleAlert className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="text-row text-foreground truncate">
            {mode === "unknown"
              ? `${phoneDisplay} isn't linked to any contact yet.`
              : `${phoneDisplay} matches more than one contact.`}
          </div>
        </div>

        {mode === "unknown" ? (
          <div className="space-y-3" data-testid="link-contact-actions">
            {/* Name-based candidate search across contact_persons /
                customer_companies / client_locations / users. Hits the
                tenant-scoped `/api/communications/contact-candidates`
                endpoint and emits `pick-candidate` on selection. */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={unknownQuery}
                onChange={(e) => setUnknownQuery(e.target.value)}
                placeholder="Search contacts, clients, locations, team…"
                className="h-8 pl-7 text-row"
                data-testid="link-contact-search-input"
                autoFocus
              />
            </div>
            {showCandidates && (
              <PickerShell
                className="border-border/60 divide-border/60 max-h-[280px]"
                data-testid="link-contact-candidate-list"
              >
                {candidatesQuery.isLoading && (
                  <div className="px-3 py-3 flex items-center gap-2 text-helper text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Searching…
                  </div>
                )}
                {!candidatesQuery.isLoading && unknownCandidates.length === 0 && (
                  <div className="px-3 py-3 text-helper text-muted-foreground">
                    No matches.
                  </div>
                )}
                {!candidatesQuery.isLoading &&
                  unknownCandidates.map((c) => {
                    const Icon = CANDIDATE_KIND_ICON[c.kind];
                    return (
                      <button
                        key={`${c.kind}:${c.id}`}
                        type="button"
                        disabled={linking}
                        onClick={() =>
                          onIntent?.({
                            kind: "pick-candidate",
                            candidateKind: c.kind,
                            candidateId: c.id,
                          })
                        }
                        data-testid={`link-contact-candidate-row-${c.id}`}
                        className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover-elevate active-elevate-2 disabled:opacity-50"
                      >
                        <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1 leading-snug">
                          <div className="text-emphasis text-foreground truncate">
                            {c.displayName}
                          </div>
                          {c.subline && (
                            <div className="text-helper text-muted-foreground truncate">
                              {c.subline}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </PickerShell>
            )}
            <LinkActionRow
              icon={Plus}
              title="Create a new contact"
              hint="Saved at the customer-company level. (Coming soon)"
              onClick={() => onIntent?.({ kind: "create-new-contact" })}
              disabled
              testid="link-contact-action-create-new"
            />
          </div>
        ) : (
          <PickerShell
            className="border-border/60 divide-border/60 max-h-[280px]"
            data-testid="link-contact-conflict-list"
          >
            {candidates.map((m) => {
              const Icon = MATCH_TYPE_ICON[m.matchType];
              const selected = m.sourceId === selectedSourceId;
              return (
                <button
                  key={`${m.matchType}:${m.sourceId}`}
                  type="button"
                  onClick={() => onSelectMatch?.(m)}
                  data-testid={`link-contact-conflict-row-${m.sourceId}`}
                  aria-pressed={selected}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
                    selected ? "bg-blue-50/60" : "hover-elevate active-elevate-2",
                  )}
                >
                  <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="text-emphasis text-foreground truncate">
                      {m.displayName}
                    </div>
                    <div className="text-helper text-muted-foreground truncate">
                      {MATCH_TYPE_LABEL[m.matchType]}
                      {m.customerCompanyName ? ` · ${m.customerCompanyName}` : ""}
                      {m.locationName ? ` · ${m.locationName}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </PickerShell>
        )}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>
          Cancel
        </ModalSecondaryAction>
        {mode === "conflict" && (
          <ModalPrimaryAction
            disabled={!selectedSourceId || linking}
            onClick={() => {
              const chosen = candidates.find((c) => c.sourceId === selectedSourceId);
              if (chosen) {
                onIntent?.({
                  kind: "select-match",
                  sourceId: chosen.sourceId,
                  matchType: chosen.matchType,
                });
              }
            }}
            data-testid="link-contact-confirm-conflict"
          >
            {linking ? "Linking…" : "Use this contact"}
          </ModalPrimaryAction>
        )}
      </ModalFooter>
    </ModalShell>
  );
}

interface LinkActionRowProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  testid: string;
}

function LinkActionRow({ icon: Icon, title, hint, onClick, disabled, testid }: LinkActionRowProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="w-full h-auto justify-start gap-3 px-3 py-2 text-left whitespace-normal"
    >
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-emphasis text-foreground">{title}</div>
        <div className="text-helper text-muted-foreground">{hint}</div>
      </div>
    </Button>
  );
}
