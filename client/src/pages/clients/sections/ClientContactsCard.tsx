import { Phone, Mail } from "lucide-react";
import { WorkspaceSectionCard } from "@/components/workspace/WorkspaceSectionCard";
import { cn } from "@/lib/utils";

export interface ClientContact {
  id: string;
  firstName: string;
  lastName: string;
  title?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean | null;
}

interface ClientContactsCardProps {
  contacts: ClientContact[];
  loading?: boolean;
}

function fullName(c: ClientContact): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

/**
 * Client contacts card for the right rail.
 * Primary contact is surfaced first. Each contact shows name, role,
 * phone, and email as divided rows inside an inset-surface card.
 */
export function ClientContactsCard({ contacts, loading }: ClientContactsCardProps) {
  // Primary contact first, then alphabetical by name
  const sorted = [...contacts].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return fullName(a).localeCompare(fullName(b));
  });

  return (
    <WorkspaceSectionCard
      title="Contacts"
      loading={loading}
      empty={!loading && contacts.length === 0}
      emptyText="No contacts on file."
      data-testid="client-contacts-card"
    >
      <div className="rounded-md border border-border bg-inset-surface divide-y divide-border overflow-hidden">
        {sorted.map((contact, i) => (
          <div
            key={contact.id}
            className={cn("px-3 py-2.5 space-y-0.5", i === 0 && "pt-2.5")}
            data-testid={`client-contact-${contact.id}`}
          >
            <div className="flex items-center gap-1.5">
              <p className="text-row font-medium text-foreground truncate">
                {fullName(contact)}
              </p>
              {contact.isPrimary && (
                <span className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1 py-px shrink-0">
                  Primary
                </span>
              )}
            </div>

            {contact.jobTitle && (
              <p className="text-helper text-muted-foreground">{contact.jobTitle}</p>
            )}

            {contact.phone && (
              <div className="flex items-center gap-1.5 pt-0.5">
                <Phone className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                <p className="text-helper text-muted-foreground">{contact.phone}</p>
              </div>
            )}

            {contact.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                <p className="text-helper text-muted-foreground truncate">{contact.email}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </WorkspaceSectionCard>
  );
}
