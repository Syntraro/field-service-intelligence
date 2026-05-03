/**
 * ContactFormDialog — Canonical Add/Edit Contact modal (compact v2).
 *
 * 2026-05-02 v2 layout: replaces the long-scroll per-location list with
 * a dropdown-driven right column. The user picks ONE location at a time
 * from a select, toggles whether the contact is linked to it, and taps
 * role pills. A compact summary list at the bottom shows every location
 * with its current link state and assigned roles; clicking a row
 * switches the dropdown.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Add Contact                                            [X]   │
 *   ├──────────────────────────────────┬───────────────────────────┤
 *   │ [Title▼][First name][Last name]  │ [Location ▼]              │
 *   │ [Job title (full width)       ]  │ ☑ Linked to this location │
 *   │ [Phone     ][Email            ]  │ Roles for {Office}        │
 *   │ ☐ Mark as primary contact         │ [Billing][Scheduling]…   │
 *   │                                  │ ── Linked Locations ──    │
 *   │                                  │ ✓ Office  [billing][site] │
 *   │                                  │ ○ Shop    —               │
 *   ├──────────────────────────────────┴───────────────────────────┤
 *   │ [Delete]                            [Cancel] [Save Contact]  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Data shape, save logic, and recipient routing are unchanged from v1
 * — only the right-column UI moves from a tall scrolling list to a
 * dropdown + summary. The pills still write into the same
 * `form.selected: Record<locId, Set<role>>` state and the diff-based
 * save path on edit (POST /assign + PATCH + DELETE) is untouched.
 *
 * Roles drive recipient routing in
 * `server/services/recipientResolverStrategies.ts`. Hover a pill for
 * a tooltip describing what mail each role triggers — there is
 * intentionally NO separate Communication Preferences section.
 *
 * APIs (canonical, no new endpoints):
 *   - Create:  POST   /api/customer-companies/:companyId/contacts
 *              body: { firstName, lastName, title, jobTitle, phone,
 *                      email, isPrimary,
 *                      association: { type:"locations",
 *                        locations:[{locationId, roles}] } }
 *   - Edit identity: PATCH /api/customer-companies/:companyId/contacts/:id
 *   - Diff assignments on edit:
 *       new (in selection, not in current)         → POST /contacts/:id/assign
 *       removed (in current, not in selection)     → DELETE /assignments/:id
 *       roles changed (in both, roles differ)      → PATCH /assignments/:id
 *   - Delete: DELETE /api/customer-companies/:companyId/contacts/:id
 */
import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ClientContact } from "@shared/schema";
import {
  INVALID_EMAIL_MESSAGE,
  isValidOptionalEmail,
} from "@shared/lib/emailValidation";

/** Contact scope — preserved for legacy callers. */
export type ContactScope = "company" | "location";

/** Canonical role list (2026-05-02 simplification). The system was
 *  previously carrying nine overlapping role labels; the recipient
 *  resolver in `server/services/recipientResolverStrategies.ts` only
 *  reads four signal-bearing categories, so the UI now matches that.
 *
 *  Legacy roles (`operations`, `manager`, `owner`, `after-hours`,
 *  `primary`, `site`, etc.) remain valid in the database — old
 *  assignment rows still carry them — but the UI no longer exposes
 *  them as togglable pills. See `filterCanonicalRoles` below for the
 *  save-time strip rule that prevents legacy roles from being
 *  re-emitted when the user actively edits an assignment, while
 *  preserving them on no-op saves (no DB churn from just opening
 *  + closing a contact). */
export const STANDARD_CONTACT_ROLES = [
  "billing", "scheduling", "site_contact", "maintenance",
] as const;

/** Display labels — `site_contact` snake-case can't be styled via the
 *  `capitalize` CSS class without producing "Site_contact", so we
 *  carry an explicit map. */
const ROLE_LABELS: Record<string, string> = {
  billing: "Billing",
  scheduling: "Scheduling",
  site_contact: "Site Contact",
  maintenance: "Maintenance",
};

/** What each role triggers in the canonical recipient resolver. Used
 *  as pill tooltip copy so the user understands roles ARE the
 *  comm-preferences. No separate notification system. */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  billing: "Receives invoices, quotes, reminders.",
  scheduling: "Handles scheduling updates.",
  site_contact: "On-site contact for jobs.",
  maintenance: "Service / maintenance contact.",
};

/** Pre-computed Set for fast `has()` checks on save. */
const CANONICAL_ROLE_SET = new Set<string>(STANDARD_CONTACT_ROLES);

/** Filter a role array down to canonical-only. Used at save time so
 *  the assignment payload never re-emits legacy roles. Diff-comparison
 *  in the edit path still uses the FULL set so a no-op save (open →
 *  close without changes) does not accidentally strip legacy roles
 *  from the DB — only an actively-edited assignment is normalized. */
function filterCanonicalRoles(roles: string[]): string[] {
  return roles.filter((r) => CANONICAL_ROLE_SET.has(r));
}

/** Honorific options. `__none__` is the empty / no-honorific row. */
const HONORIFICS = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr."] as const;
const HONORIFIC_NONE = "__none__";

/** Minimal location shape the modal needs. */
export interface ContactModalLocation {
  id: string;
  /** Display label — typically `location` or `companyName` from `Client`. */
  name: string;
  address?: string | null;
  city?: string | null;
  isPrimary?: boolean;
}

/** Existing assignment for a contact being edited. */
export interface ContactModalAssignment {
  /** `contact_assignments.id` — needed for PATCH/DELETE on edit. */
  assignmentId: string;
  locationId: string;
  roles: string[];
}

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Customer company id — required for any save. */
  companyId?: string;
  /** When set, modal is in EDIT mode. Pass the person row plus their
   *  full assignment list so the modal can diff. */
  contact?: ClientContact | null;
  assignments?: ContactModalAssignment[];
  /** All locations belonging to this client. */
  locations: ContactModalLocation[];
  /** Pre-select this location id when opening in CREATE mode. */
  preselectLocationId?: string;
  /** Called after every successful create / update / delete. */
  onSuccess: () => void;
  /** Hide the Delete button if the caller doesn't permit destructive
   *  ops at this surface. Defaults to true (delete shown when editing). */
  allowDelete?: boolean;

  // ----- Legacy props retained so existing callers keep type-checking. -----
  /** @deprecated — the unified modal always uses the location+roles picker. */
  associationType?: ContactScope;
  /** @deprecated — pass `preselectLocationId` instead. */
  locationId?: string;
}

interface FormState {
  title: string;        // HONORIFIC_NONE means none
  firstName: string;
  lastName: string;
  jobTitle: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  /** locationId → role set. Membership of a key here means "linked". */
  selected: Record<string, Set<string>>;
}

const EMPTY_FORM: FormState = {
  title: HONORIFIC_NONE,
  firstName: "",
  lastName: "",
  jobTitle: "",
  phone: "",
  email: "",
  isPrimary: false,
  selected: {},
};

export function ContactFormDialog({
  open, onOpenChange, companyId, contact, assignments = [],
  locations, preselectLocationId, onSuccess, allowDelete = true,
  // legacy props
  associationType, locationId,
}: ContactFormDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [emailTouched, setEmailTouched] = useState(false);

  // Resolve the effective preselect: explicit prop wins, else legacy
  // `locationId` (the old modal accepted this).
  const effectivePreselect = preselectLocationId
    ?? (associationType === "location" ? locationId : undefined);

  /** Seed the form when the modal opens. */
  useEffect(() => {
    if (!open) return;
    if (contact) {
      const seeded: Record<string, Set<string>> = {};
      for (const a of assignments) {
        seeded[a.locationId] = new Set(a.roles ?? []);
      }
      setForm({
        title: contact.title ?? HONORIFIC_NONE,
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        jobTitle: (contact as any).jobTitle || "",
        phone: contact.phone || "",
        email: contact.email || "",
        isPrimary: contact.isPrimary || false,
        selected: seeded,
      });
    } else {
      const seeded: Record<string, Set<string>> = {};
      if (effectivePreselect) {
        seeded[effectivePreselect] = new Set();
      }
      setForm({ ...EMPTY_FORM, selected: seeded });
    }
    setEmailTouched(false);
  }, [open, contact, assignments, effectivePreselect]);

  const emailValid = isValidOptionalEmail(form.email);
  const showEmailError = emailTouched && !emailValid;
  const canSave = form.firstName.trim().length > 0 && emailValid;

  /** Diff selected vs. existing assignments on edit. */
  const diffAssignments = useMemo(() => {
    if (!contact) return null;
    const existingByLoc = new Map<string, ContactModalAssignment>();
    for (const a of assignments) existingByLoc.set(a.locationId, a);

    const toCreate: { locationId: string; roles: string[] }[] = [];
    const toUpdate: { assignmentId: string; roles: string[] }[] = [];
    const toDelete: string[] = [];

    for (const [locId, roleSet] of Object.entries(form.selected)) {
      const existing = existingByLoc.get(locId);
      const nextRoles = Array.from(roleSet).sort();
      if (!existing) {
        toCreate.push({ locationId: locId, roles: nextRoles });
      } else {
        const prev = [...(existing.roles ?? [])].sort();
        if (prev.join("|") !== nextRoles.join("|")) {
          toUpdate.push({ assignmentId: existing.assignmentId, roles: nextRoles });
        }
      }
    }
    for (const a of assignments) {
      if (!form.selected[a.locationId]) toDelete.push(a.assignmentId);
    }
    return { toCreate, toUpdate, toDelete };
  }, [contact, assignments, form.selected]);

  /** Build the `association.locations[]` shape for the create endpoint.
   *  Canonical-only filter applied so legacy roles never enter a
   *  fresh assignment row. */
  const buildAssociation = (): { type: "company" | "locations"; locations: { locationId: string; roles: string[] }[] } => {
    const rows = Object.entries(form.selected).map(([id, roles]) => ({
      locationId: id,
      roles: filterCanonicalRoles(Array.from(roles)),
    }));
    if (rows.length === 0) return { type: "company", locations: [] };
    return { type: "locations", locations: rows };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Company not loaded");

      const identity = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || null,
        title: form.title === HONORIFIC_NONE ? null : (form.title.trim() || null),
        jobTitle: form.jobTitle.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        isPrimary: form.isPrimary,
      };

      if (contact) {
        await apiRequest(`/api/customer-companies/${companyId}/contacts/${contact.id}`, {
          method: "PATCH",
          body: JSON.stringify(identity),
        });
        const diff = diffAssignments!;
        // 2026-05-02: every PATCH/POST emitting roles strips legacy
        // labels (anything outside STANDARD_CONTACT_ROLES) so an
        // actively-touched assignment normalizes to the canonical set.
        // No-op saves don't reach this branch (diff is empty) so
        // untouched legacy roles stay in the DB.
        for (const c of diff.toCreate) {
          await apiRequest(`/api/customer-companies/${companyId}/contacts/${contact.id}/assign`, {
            method: "POST",
            body: JSON.stringify({ locationId: c.locationId, roles: filterCanonicalRoles(c.roles) }),
          });
        }
        for (const u of diff.toUpdate) {
          await apiRequest(`/api/customer-companies/${companyId}/assignments/${u.assignmentId}`, {
            method: "PATCH",
            body: JSON.stringify({ roles: filterCanonicalRoles(u.roles) }),
          });
        }
        for (const d of diff.toDelete) {
          await apiRequest(`/api/customer-companies/${companyId}/assignments/${d}`, {
            method: "DELETE",
          });
        }
        return;
      }

      const body = { ...identity, association: buildAssociation() };
      await apiRequest(`/api/customer-companies/${companyId}/contacts`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      onSuccess();
      onOpenChange(false);
      toast({ title: contact ? "Contact updated" : "Contact added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to save contact.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!companyId || !contact) throw new Error("No contact to delete");
      await apiRequest(`/api/customer-companies/${companyId}/contacts/${contact.id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      onSuccess();
      onOpenChange(false);
      toast({ title: "Contact deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to delete contact.", variant: "destructive" });
    },
  });

  // ── Per-location helpers (2026-05-03 inline-list redesign) ──────────
  /** Toggle a single location's link state. Empty role set seeded on
   *  link; entire entry deleted on unlink so the diff/save logic sees
   *  it as "removed". */
  const toggleLocationLink = (locId: string, linked: boolean) => {
    setForm((f) => {
      const next = { ...f.selected };
      if (linked) {
        if (!next[locId]) next[locId] = new Set();
      } else {
        delete next[locId];
      }
      return { ...f, selected: next };
    });
  };

  /** Toggle a role on a SPECIFIC location. Roles are per-location —
   *  the source of truth is `form.selected[locId]: Set<role>`. */
  const toggleRole = (locId: string, role: string) => {
    setForm((f) => {
      const next = { ...f.selected };
      // Defensive: only mutate roles for already-linked rows. The UI
      // never renders the pill row for unlinked rows so this is just
      // belt-and-suspenders.
      if (!next[locId]) return f;
      const set = new Set(next[locId]);
      if (set.has(role)) set.delete(role); else set.add(role);
      next[locId] = set;
      return { ...f, selected: next };
    });
  };

  const isSaving = saveMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const linkedCount = Object.keys(form.selected).length;

  /** Three-way state for the "Select all locations" checkbox.
   *  - `true`            ⇒ every location is linked
   *  - `false`           ⇒ no location is linked
   *  - `"indeterminate"` ⇒ some are linked, some aren't (Radix
   *                        Checkbox supports this state directly) */
  const selectAllState: boolean | "indeterminate" =
    locations.length === 0 || linkedCount === 0
      ? false
      : linkedCount === locations.length
        ? true
        : "indeterminate";

  /** Select-all click: link every location (empty role set each) when
   *  going from any non-checked state to checked, unlink every
   *  location otherwise. */
  const handleSelectAll = (checkedRequest: boolean) => {
    setForm((f) => {
      if (!checkedRequest) {
        return { ...f, selected: {} };
      }
      const next: Record<string, Set<string>> = {};
      for (const loc of locations) {
        // Preserve existing role sets so toggling Select-all on doesn't
        // clobber per-location roles the user already configured.
        next[loc.id] = new Set(f.selected[loc.id] ?? []);
      }
      return { ...f, selected: next };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3 border-b border-slate-200">
          <DialogTitle data-testid="contact-modal-title">
            {contact ? "Edit Contact" : "Add Contact"}
          </DialogTitle>
        </DialogHeader>

        {/* ── BODY ─────────────────────────────────────────────────────
            2026-05-03 redesign: single-column. Identity fields stay
            static at the top; the locations area below is the only
            scrolling region. Footer (DialogFooter, sibling) stays
            visible regardless of how many locations the client has. */}
        <div className="flex flex-col min-h-0 max-h-[70vh]">
          {/* ── Contact identity (placeholder-only, tight grid) ── */}
          <div className="px-3 py-2.5 space-y-1.5 border-b border-slate-200">
            {/* Row 1: Title | First | Last — grouped tightly */}
            <div className="grid grid-cols-[80px_1fr_1fr] gap-1.5">
              <Select
                value={form.title || HONORIFIC_NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, title: v }))}
              >
                <SelectTrigger className="h-8 text-xs px-2" data-testid="contact-modal-title-select">
                  <SelectValue placeholder="Title" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HONORIFIC_NONE}>—</SelectItem>
                  {HONORIFICS.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="First name"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="h-8 text-xs"
                data-testid="contact-modal-firstname"
              />
              <Input
                placeholder="Last name"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="h-8 text-xs"
                data-testid="contact-modal-lastname"
              />
            </div>

            {/* Row 2: Job title — full width */}
            <Input
              placeholder="Job title"
              value={form.jobTitle}
              onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
              className="h-8 text-xs"
              data-testid="contact-modal-jobtitle"
            />

            {/* Row 3: Phone | Email */}
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="h-8 text-xs"
                data-testid="contact-modal-phone"
              />
              <div className="space-y-0.5">
                <Input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onBlur={() => setEmailTouched(true)}
                  aria-invalid={showEmailError || undefined}
                  className={cn("h-8 text-xs", showEmailError && "border-destructive focus-visible:ring-destructive/30")}
                  data-testid="contact-modal-email"
                />
                {showEmailError && (
                  <p className="text-[11px] text-destructive" data-testid="contact-modal-email-error">
                    {INVALID_EMAIL_MESSAGE}
                  </p>
                )}
              </div>
            </div>

            {/* Row 4: Primary toggle */}
            <label className="flex items-center gap-2 cursor-pointer pt-0.5">
              <Checkbox
                checked={form.isPrimary}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isPrimary: !!v }))}
                data-testid="contact-modal-isprimary"
              />
              <span className="text-xs text-slate-700">Mark as primary contact for this client</span>
            </label>
          </div>

          {/* ── Locations & Roles (inline list — direct linking) ── */}
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Locations</p>
              <span
                className="text-[11px] text-slate-500"
                data-testid="contact-modal-loc-count"
              >
                {linkedCount} of {locations.length} linked
              </span>
            </div>

            {locations.length === 0 ? (
              <div className="text-xs text-slate-400 py-6 px-3 text-center">
                This client has no locations yet. The contact will be saved
                at the company level.
              </div>
            ) : (
              <>
                {/* Select-all row — separates from the per-location list
                    with a hairline so the global control reads as
                    distinct from individual rows. Tri-state via Radix
                    `checked="indeterminate"`. */}
                <label className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-50 border-b border-slate-100">
                  <Checkbox
                    checked={selectAllState}
                    onCheckedChange={(v) => handleSelectAll(v === true)}
                    data-testid="contact-modal-select-all"
                  />
                  <span className="text-xs font-medium text-slate-700">Select all locations</span>
                </label>

                {/* The inline list is the only scrolling region inside
                    the modal body — keeps Cancel / Save visible no
                    matter how many locations the client has. */}
                <div
                  className="flex-1 min-h-0 overflow-y-auto px-2 py-1"
                  data-testid="contact-modal-loc-list"
                >
                  {locations.map((loc) => {
                    const isLinked = !!form.selected[loc.id];
                    const roles = form.selected[loc.id];
                    return (
                      <div
                        key={loc.id}
                        className={cn(
                          "rounded-md transition-colors",
                          isLinked && "bg-[rgba(118,176,84,0.05)]",
                        )}
                        data-testid={`contact-modal-loc-row-${loc.id}`}
                      >
                        <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer">
                          <Checkbox
                            checked={isLinked}
                            onCheckedChange={(v) => toggleLocationLink(loc.id, !!v)}
                            data-testid={`contact-modal-loc-toggle-${loc.id}`}
                          />
                          <span className={cn("text-xs truncate", isLinked ? "font-medium text-slate-800" : "text-slate-700")}>
                            {loc.name}
                          </span>
                        </label>
                        {/* Role pills — visible ONLY when the row is
                            linked. Indented so the relationship is
                            visually clear; toggling a pill only
                            affects this row. */}
                        {isLinked && (
                          <div className="flex flex-wrap gap-1 px-2 pl-8 pb-1.5">
                            {STANDARD_CONTACT_ROLES.map((role) => {
                              const active = roles?.has(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => toggleRole(loc.id, role)}
                                  title={ROLE_DESCRIPTIONS[role] ?? ""}
                                  data-testid={`contact-modal-role-${loc.id}-${role}`}
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                                    active
                                      ? "bg-[#76B054] text-white border-[#76B054]"
                                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400",
                                  )}
                                >
                                  {ROLE_LABELS[role] ?? role}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t border-slate-200 sm:justify-between gap-2 bg-slate-50/50">
          <div className="flex-1 flex justify-start">
            {contact && allowDelete && (
              <Button
                variant="ghost"
                onClick={() => deleteMutation.mutate()}
                disabled={isDeleting || isSaving}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                data-testid="contact-modal-delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isDeleting ? "Deleting…" : "Delete Contact"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving || isDeleting}
              data-testid="contact-modal-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || isSaving || isDeleting}
              data-testid="contact-modal-save"
            >
              {isSaving ? "Saving…" : contact ? "Save Contact" : "Add Contact"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
