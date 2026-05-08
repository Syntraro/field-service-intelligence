/**
 * ContactDetailsPanel — right-panel projection for a selected contact.
 *
 * Phase 4E: dedicated component (not a "mode" of `ConversationDetailsPanel`)
 * because the surface diverges materially from the conversation panel:
 *
 *   • Section taxonomy is different — Client + Location + Primary Contact
 *     + Open Jobs vs Conversation's Contact + Linked To + Comm History.
 *   • No Activity tab — only Details. The spec is explicit.
 *   • Empty copy is bound to a contact selection, not to a thread —
 *     the conversation panel's prompt about picking a conversation is
 *     the wrong fit for this surface.
 *
 * Width / shell match `ConversationDetailsPanel` exactly (340–360 px,
 * `xl:flex` breakpoint, white card, left border) so swapping panels
 * doesn't shift layout when the user moves between modules.
 *
 * Empty-section rules
 * -------------------
 * Each section renders ONLY when the underlying payload has at least
 * one non-blank field. Blank cards never render — the spec says "If no
 * client/location exists, do not show blank sections."
 *
 * Phase H2 (2026-05-07) typography migration
 * ------------------------------------------
 * Local `*_CLASS` typography constants were removed; rows now compose the
 * canonical `EntityName` / `EntityMeta` / `SectionLabel` primitives from
 * `@/components/ui/typography`. Secondary-tier metadata renders through
 * `EntityMeta` (13px helper token) rather than the 14px tabular tier so
 * the panel reads at the same density as the Contacts list rail.
 */

import { Link } from "wouter";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  Briefcase,
  Building2,
  Mail,
  MapPin,
  Phone,
  User,
  UsersRound,
  Loader2,
} from "lucide-react";
import type {
  ContactDetail,
  ContactDetailJobRef,
  ContactDetailKind,
} from "@shared/communicationsTypes";
import { formatPhoneForDisplay } from "@shared/phoneNormalization";
import { getInitials } from "@/lib/getInitials";
import { cn } from "@/lib/utils";
import {
  ENTITY_LINK_CLASS,
  ENTITY_META_CLASS,
  ENTITY_NAME_CLASS,
  EntityMeta,
  EntityName,
  SectionLabel,
} from "@/components/ui/typography";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
};

interface ContactDetailsPanelProps {
  selection: { kind: ContactDetailKind; id: string } | null;
  detail?: ContactDetail;
  loading?: boolean;
  error?: boolean;
}

export function ContactDetailsPanel({
  selection,
  detail,
  loading = false,
  error = false,
}: ContactDetailsPanelProps) {
  return (
    <aside
      className="hidden xl:flex w-[340px] max-w-[360px] shrink-0 flex-col bg-card border-l border-border min-h-0"
      data-testid="communications-contact-details-panel"
    >
      {/* Header — single tab "Details". No Activity tab in Contacts. */}
      <div className="flex items-center px-3 h-12 border-b border-border shrink-0">
        <h2
          className={cn(ENTITY_NAME_CLASS, "text-foreground")}
          data-testid="contact-details-tab-only"
        >
          Details
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 m-0">
        {!selection ? (
          <p
            className="text-helper text-muted-foreground text-center py-8"
            data-testid="contact-details-empty"
          >
            Select a contact to see details.
          </p>
        ) : loading ? (
          <div
            className="flex items-center justify-center py-12 text-muted-foreground"
            data-testid="contact-details-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-helper">Loading contact…</span>
          </div>
        ) : error ? (
          <div
            className="rounded-md border border-destructive/40 px-3 py-2 text-helper text-destructive"
            data-testid="contact-details-error"
          >
            Couldn't load contact details.
          </div>
        ) : !detail ? (
          <p className="text-helper text-muted-foreground text-center py-8">
            Contact not found.
          </p>
        ) : (
          <DetailBody detail={detail} />
        )}
      </div>
    </aside>
  );
}

function DetailBody({ detail }: { detail: ContactDetail }) {
  return (
    // 2026-05-07 Phase 4G typography tighten: section spacing dropped
    // from space-y-4 → space-y-3 for operational density. Row padding
    // (px-2.5 py-1.5) is unchanged; the gap between sections was the
    // dominant whitespace.
    <div className="space-y-3">
      {/* Identity card — always present. EntityName + EntityMeta keep
          the displayName / role chip in lockstep with the Contacts list. */}
      <div className="flex items-start gap-3" data-testid="contact-details-identity">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className="text-row bg-muted">
            {getInitials({ fullName: detail.primaryContact.displayName })}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-snug">
          <EntityName>{detail.primaryContact.displayName}</EntityName>
          <EntityMeta className="mt-0.5 inline-flex items-center gap-1">
            {detail.kind === "team_user" ? (
              <>
                <UsersRound className="h-3 w-3" />
                {detail.teamRole ? (ROLE_LABEL[detail.teamRole] ?? detail.teamRole) : "Team member"}
              </>
            ) : (
              <>
                <User className="h-3 w-3" />
                Contact
              </>
            )}
          </EntityMeta>
        </div>
      </div>

      {/* CLIENT section — contact_person only.
          Client NAME is a primary entity link. Address / phone / email
          rows stay secondary metadata (EntityMeta) — they're metadata,
          not destinations. */}
      {detail.client && (
        <Section label="Client" testid="contact-details-section-client">
          <ValueRow
            icon={Building2}
            value={detail.client.name}
            href={`/clients/${detail.client.customerCompanyId}`}
            testid="contact-details-client-name-link"
            variant="primary"
          />
          {detail.client.phone && (
            <ValueRow
              icon={Phone}
              value={formatPhoneForDisplay(detail.client.phone) || detail.client.phone}
            />
          )}
          {detail.client.email && <ValueRow icon={Mail} value={detail.client.email} />}
          {detail.client.addressLine && (
            <ValueRow icon={MapPin} value={detail.client.addressLine} />
          )}
        </Section>
      )}

      {/* LOCATION section — contact_person only when an assignment exists.
          The address row navigates to /clients/:locationId so the user
          lands on the right detail page. The location-name line is
          rendered ONLY when the row has a distinct site label (Phase 4F:
          no fallback to companyName). */}
      {detail.location && (
        <Section label="Location" testid="contact-details-section-location">
          {detail.location.name && (
            <ValueRow
              icon={MapPin}
              value={detail.location.name}
              href={`/clients/${detail.location.locationId}`}
              testid="contact-details-location-name-link"
              variant="primary"
            />
          )}
          {detail.location.addressLine && (
            // Address line is the navigation hook when there's no name,
            // but it stays in the secondary typography tier so it
            // visually recedes behind primary entity names.
            <ValueRow
              icon={MapPin}
              value={detail.location.addressLine}
              href={`/clients/${detail.location.locationId}`}
              testid="contact-details-location-address-link"
            />
          )}
          {detail.location.phone && (
            <ValueRow
              icon={Phone}
              value={formatPhoneForDisplay(detail.location.phone) || detail.location.phone}
            />
          )}
        </Section>
      )}

      {/* PRIMARY CONTACT section — the selected person's reachables.
          The contact's display name links to the parent client when
          available (contact_persons have no dedicated detail route);
          for team users the name is plain. */}
      {(detail.primaryContact.phone || detail.primaryContact.email) && (
        <Section
          label={detail.kind === "team_user" ? "Team Member" : "Primary Contact"}
          testid="contact-details-section-primary"
        >
          <ValueRow
            icon={User}
            value={detail.primaryContact.displayName}
            href={
              detail.kind === "contact_person" && detail.client?.customerCompanyId
                ? `/clients/${detail.client.customerCompanyId}`
                : undefined
            }
            testid="contact-details-primary-name"
            variant="primary"
          />
          {detail.primaryContact.phone && (
            <ValueRow
              icon={Phone}
              value={
                formatPhoneForDisplay(detail.primaryContact.phone) ||
                detail.primaryContact.phone
              }
            />
          )}
          {detail.primaryContact.email && (
            <ValueRow icon={Mail} value={detail.primaryContact.email} />
          )}
        </Section>
      )}

      {/* OPEN JOBS section — every row is a Link to /jobs/:id. */}
      {detail.openJobs && detail.openJobs.length > 0 && (
        <Section label="Open Jobs" testid="contact-details-section-jobs">
          {detail.openJobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  testid,
  children,
}: {
  label: string;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testid}>
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      <div className="rounded-md border border-border/60 divide-y divide-border/60">
        {children}
      </div>
    </section>
  );
}

/**
 * Phase H2 typography contract:
 *
 *   • Primary rows (`variant="primary"`) — render through `EntityName`
 *     so the primary-name token / brand-link styling stays in lockstep
 *     with the Contacts list column. `href` is forwarded.
 *   • Secondary rows (default) — render through `EntityMeta` (text-helper,
 *     muted). When a secondary row IS a navigation hook (e.g. the location
 *     address row), it's wrapped in a wouter `<Link>` that composes the
 *     canonical meta + brand-link tokens via `cn()` — twMerge picks the
 *     brand color over the muted color so the row reads as actionable.
 *
 * Default is `secondary` — a row without an explicit variant prop stays
 * in the recessed metadata tier.
 */
type ValueRowVariant = "primary" | "secondary";

function ValueRow({
  icon: Icon,
  value,
  href,
  testid,
  variant = "secondary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  /** When set, renders the value as a wouter `<Link>` with brand-green styling. */
  href?: string;
  testid?: string;
  variant?: ValueRowVariant;
}) {
  const valueText =
    variant === "primary" ? (
      <EntityName href={href} data-testid={testid}>
        {value}
      </EntityName>
    ) : href ? (
      <Link
        href={href}
        className={cn(ENTITY_META_CLASS, ENTITY_LINK_CLASS)}
        data-testid={testid}
      >
        {value}
      </Link>
    ) : (
      <EntityMeta data-testid={testid}>{value}</EntityMeta>
    );
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      {valueText}
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </div>
  );
}

function JobRow({ job }: { job: ContactDetailJobRef }) {
  // Whole row is a link target — clicking anywhere navigates. The outer
  // `Link` carries the row layout + testid; the job number text composes
  // the canonical entity-name + brand-link tokens via `cn()` so we don't
  // nest a second `<a>` and don't lose the brand-green styling. Summary
  // line uses `EntityMeta` for the recessed secondary tier.
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover-elevate active-elevate-2 transition-colors"
      data-testid={`contact-details-job-row-${job.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className={cn(ENTITY_NAME_CLASS, ENTITY_LINK_CLASS)}>
          Job #{job.jobNumber}
        </div>
        <EntityMeta>{job.summary}</EntityMeta>
      </div>
      <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    </Link>
  );
}
