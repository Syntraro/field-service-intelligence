import { RailContentCard } from "@/components/detail-rail/RailContentCard";

export interface ContactPerson {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface InvoiceContactsCardProps {
  contacts: ContactPerson[];
  loading: boolean;
  "data-testid"?: string;
}

/**
 * Displays billing contacts for the selected invoice's customer company.
 * Receives pre-fetched contacts from InvoiceActionsRail (rail-root query).
 * Content-only — no section label or outer card; both live in InvoiceActionsRail.
 */
export function InvoiceContactsCard({
  contacts,
  loading,
  "data-testid": testId,
}: InvoiceContactsCardProps) {
  if (loading) {
    return (
      <p className="text-helper text-muted-foreground" data-testid={testId ?? "receivables-contacts-section"}>
        Loading…
      </p>
    );
  }
  if (contacts.length === 0) {
    return (
      <p className="text-helper text-muted-foreground" data-testid={testId ?? "receivables-contacts-section"}>
        No client contacts.
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid={testId ?? "receivables-contacts-list"}>
      {contacts.map((c) => (
        <RailContentCard
          key={c.id}
          className="bg-inset-surface border-border shadow-none"
          testId={`receivables-contact-${c.id}`}
        >
          <p className="text-row font-medium text-foreground">
            {[c.firstName, c.lastName].filter(Boolean).join(" ")}
          </p>
          {c.jobTitle && (
            <p className="text-helper text-muted-foreground">{c.jobTitle}</p>
          )}
          {c.phone && (
            <p className="text-helper text-muted-foreground">{c.phone}</p>
          )}
          {c.email && (
            <p className="text-helper text-muted-foreground truncate">{c.email}</p>
          )}
        </RailContentCard>
      ))}
    </div>
  );
}
