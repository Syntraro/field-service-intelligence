/**
 * ContactPickerPopover (2026-04-14)
 *
 * Searchable dropdown of system contacts for the Send Invoice modal's
 * To / CC fields. Data source is `/api/invoices/:id/email-contacts`,
 * which reuses the canonical `clientContactRepository` (getLocationContacts
 * + getCompanyDirectory). Contacts already selected are hidden. Clicking
 * a row emits the email via `onSelect`; the parent adds it as a chip.
 *
 * Purely presentation — no selection state lives here; the caller owns
 * the list of currently-selected emails.
 */

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface ContactOption {
  name: string;
  email: string;
  roles: string[];
  source: "location" | "company";
}

interface ContactPickerPopoverProps {
  /** Invoice id — drives the endpoint. */
  invoiceId: string;
  /** Lowercased emails already chosen (hidden from the list). */
  selectedEmails: readonly string[];
  onSelect: (email: string) => void;
  /** Optional free-form draft shown by the parent; used to filter the list. */
  filterText?: string;
}

export function ContactPickerPopover({
  invoiceId,
  selectedEmails,
  onSelect,
  filterText = "",
}: ContactPickerPopoverProps) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContacts([]);
    apiRequest<{ contacts: ContactOption[] }>(
      `/api/invoices/${invoiceId}/email-contacts`,
    )
      .then((res) => {
        if (!cancelled) setContacts(res.contacts ?? []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        // Treat 404 as an empty result (stale route / invoice not found),
        // not as an error — the user just gets the neutral empty state.
        // Any other failure is a real fetch error worth surfacing.
        const status = Number(err?.status);
        if (status === 404) {
          setContacts([]);
        } else {
          setError(err?.message ?? "Could not load contacts");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  const selectedSet = useMemo(
    () => new Set(selectedEmails.map((e) => e.toLowerCase())),
    [selectedEmails],
  );

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return contacts.filter((c) => {
      if (selectedSet.has(c.email)) return false;
      if (!q) return true;
      return (
        c.email.includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.roles.some((r) => r.toLowerCase().includes(q))
      );
    });
  }, [contacts, filterText, selectedSet]);

  // 2026-05-03 polish: when the resolved list is empty (no contacts at all
  // OR none match the current filter) and we're not loading or in an error
  // state, hide the popover entirely instead of rendering an empty-state row.
  // The empty card felt noisy in the compact modal — there's nothing to pick.
  if (!loading && !error && filtered.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover shadow-md overflow-hidden"
      data-testid="contact-picker-popover"
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading contacts…</div>
        ) : error ? (
          <div className="px-3 py-2 text-xs text-destructive">{error}</div>
        ) : (
          filtered.map((c) => {
            const isBilling = c.roles.some((r) => r.toLowerCase() === "billing");
            return (
              <button
                key={`${c.source}:${c.email}`}
                type="button"
                onMouseDown={(e) => {
                  // mousedown beats the input's onBlur so the click registers
                  // before the popover unmounts.
                  e.preventDefault();
                  onSelect(c.email);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                data-testid={`contact-option-${c.email}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                </div>
                {isBilling && (
                  <span className="text-xs rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-medium">
                    Billing
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {c.source === "location" ? "Location" : "Company"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
