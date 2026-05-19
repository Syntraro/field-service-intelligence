/**
 * Client Detail right-rail descriptor builders.
 *
 * Pure functions only — no hooks, no queries, no page state.
 * Each builder accepts plain data and returns a typed descriptor object
 * consumed by `<RailPanelRenderer>`.
 */
import { Star, Phone, Mail, MapPin, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/formatters";
import { RailPanelRenderer } from "@/components/detail-rail/RailPanelRenderer";
import type {
  RailPanelDescriptor,
  RailCardDescriptor,
  RailTitleTrailing,
  RailMetaItem,
  RailMetaRowDescriptor,
} from "@/components/detail-rail/railTypes";
import { formatRailActivity } from "@/components/activity-feed/formatRailActivity";
import type { ClientContact } from "@shared/schema";
import type { ContactScope } from "@/components/ContactFormDialog";

// ── Billing ───────────────────────────────────────────────────────────

export interface RailBillingShape {
  lifetimeRevenue: number;
  paidYtd: number;
  outstanding: { count: number; total: number; overdueTotal: number };
  aging: { current: number; d30: number; d60: number; d90: number };
}

interface ClientBillingPanelBodyProps {
  billing: RailBillingShape;
  paymentTermsDays: number | null;
  billingStreet: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
}

export function buildClientBillingPanelDescriptor(
  billing: RailBillingShape,
  paymentTermsDays: number | null,
  billingStreet: string | null,
  billingCity: string | null,
  billingProvince: string | null,
  billingPostalCode: string | null,
): RailPanelDescriptor {
  const termsLabel =
    paymentTermsDays === null
      ? "Use company default"
      : paymentTermsDays === 0
        ? "Due on receipt"
        : `Net ${paymentTermsDays}`;

  // Address-line accumulator. Empty / whitespace-only fields filtered before
  // join so we never emit "City, , Postal" rows with stray commas.
  const addressLines: string[] = [];
  const line1 = billingStreet?.trim() || null;
  if (line1) addressLines.push(line1);
  const line2 =
    [billingCity, billingProvince, billingPostalCode]
      .filter((v) => v && v.trim().length > 0)
      .join(", ") || null;
  if (line2) addressLines.push(line2);

  return {
    kind: "single",
    card: {
      key: "billing",
      testId: "client-billing-panel-body",
      fields: [
        { label: "Payment terms", value: termsLabel },
        {
          label: "Outstanding",
          value: formatCurrency(billing.outstanding.total),
        },
        {
          label: "Lifetime revenue",
          value: formatCurrency(billing.lifetimeRevenue),
        },
        { label: "Paid YTD", value: formatCurrency(billing.paidYtd) },
      ],
      footer: {
        kind: "block",
        label: "Billing address",
        lines: addressLines,
        fallback: "No billing address on file.",
      },
    },
  };
}

export function ClientBillingPanelBody({
  billing,
  paymentTermsDays,
  billingStreet,
  billingCity,
  billingProvince,
  billingPostalCode,
}: ClientBillingPanelBodyProps) {
  return (
    <RailPanelRenderer
      panel={buildClientBillingPanelDescriptor(
        billing,
        paymentTermsDays,
        billingStreet,
        billingCity,
        billingProvince,
        billingPostalCode,
      )}
      testIdPrefix="client-side"
    />
  );
}

// ── Maintenance ───────────────────────────────────────────────────────

// One row from the recurring-templates feed (full row + joined
// client/location names + computed `nextOccurrence`).
export interface MaintenanceTemplateRow {
  id: string;
  title: string;
  description: string | null;
  clientId: string | null;
  locationId: string | null;
  isActive: boolean;
  jobType: string;
  recurrenceKind: string;
  interval: number;
  startDate: string | null;
  endDate: string | null;
  serviceWindowDaysBefore: number | null;
  serviceWindowDaysAfter: number | null;
  pmBillingModel: string | null;
  pmBillingLabel: string | null;
  pmContractAmount: string | null;
  clientName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  nextOccurrence: string | null;
}

export function buildClientMaintenancePanelDescriptor(
  matching: MaintenanceTemplateRow[],
): RailPanelDescriptor {
  if (matching.length === 0) {
    return {
      kind: "list",
      cards: [],
      testId: "client-maintenance-panel-body",
      empty: {
        message: "No maintenance plans yet.",
        hint: "Add a maintenance plan to schedule recurring service for this client.",
      },
    };
  }

  const cards: RailCardDescriptor[] = matching.map((t) => {
    const cadence =
      t.recurrenceKind === "weekly"
        ? `Every ${t.interval > 1 ? `${t.interval} weeks` : "week"}`
        : t.recurrenceKind === "monthly"
          ? `Every ${t.interval > 1 ? `${t.interval} months` : "month"}`
          : t.recurrenceKind;
    const billingLine =
      t.pmBillingLabel ||
      (t.pmBillingModel ? t.pmBillingModel.replaceAll("_", " ") : null);
    const serviceWindow =
      t.serviceWindowDaysBefore !== null && t.serviceWindowDaysAfter !== null
        ? `${t.serviceWindowDaysBefore} days before — ${t.serviceWindowDaysAfter} days after`
        : null;
    const locationLine =
      [t.locationName, t.locationAddress]
        .filter((s): s is string => !!s && s.trim().length > 0)
        .join(" · ") || null;
    const description =
      t.description && t.description.trim().length > 0 ? t.description : null;

    const fields: NonNullable<RailCardDescriptor["fields"]> = [
      {
        label: "Frequency",
        value: cadence,
        testId: "client-maintenance-card-row-frequency",
      },
    ];
    if (t.nextOccurrence) {
      fields.push({
        label: "Next due",
        value: t.nextOccurrence,
        valueClassName: "font-medium",
        testId: "client-maintenance-card-row-next-due",
      });
    }
    if (t.startDate) {
      fields.push({
        label: "Started",
        value: t.startDate,
        testId: "client-maintenance-card-row-started",
      });
    }
    if (serviceWindow) {
      fields.push({
        label: "Window",
        value: serviceWindow,
        testId: "client-maintenance-card-row-window",
      });
    }
    if (billingLine) {
      fields.push({
        label: "Billing",
        value: billingLine,
        valueClassName: "capitalize",
        testId: "client-maintenance-card-row-billing",
      });
    }
    if (locationLine) {
      fields.push({
        label: "Location",
        value: locationLine,
        valueClassName: "line-clamp-2 break-words",
        testId: "client-maintenance-card-row-location",
      });
    }

    return {
      key: t.id,
      testId: "client-maintenance-card",
      title: {
        text: t.title,
        // Disable the canonical title `truncate` so long plan names wrap.
        className: "break-words whitespace-normal",
        chip: {
          text: t.isActive ? "Active" : "Paused",
          variant: t.isActive ? "success" : "neutral",
          testId: "client-maintenance-card-status",
        },
      },
      fields,
      body: description ?? undefined,
      bodyClamp: description ? 3 : undefined,
      footer: {
        kind: "link",
        href: `/pm/${t.id}`,
        label: "View / Edit in Maintenance",
        icon: ChevronRight,
        ariaLabel: `View or edit maintenance plan ${t.title}`,
        title: "View / Edit in Maintenance",
        testId: "client-maintenance-card-action",
      },
    };
  });

  return {
    kind: "list",
    cards,
    testId: "client-maintenance-panel-body",
  };
}

// ── Activity ──────────────────────────────────────────────────────────

// One row in the rail Activity feed. `summary` is intentionally NOT
// rendered — server emitters historically interpolated raw UUIDs into
// it. Per-row copy is rebuilt from `eventType` + `meta` via
// `formatRailActivity`.
export interface ClientActivityFeedItem {
  id: string;
  eventType: string;
  summary: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export function buildClientActivityPanelDescriptor(
  items: ClientActivityFeedItem[],
): RailPanelDescriptor {
  if (items.length === 0) {
    return {
      kind: "list",
      cards: [],
      testId: "client-activity-panel-body",
      spacing: "compact",
      empty: { message: "No activity yet." },
    };
  }

  const cards: RailCardDescriptor[] = items.map((it) => {
    const display = formatRailActivity({
      eventType: it.eventType,
      summary: it.summary,
      meta: it.meta,
    });
    const timestamp = format(new Date(it.createdAt), "MMM d, yyyy h:mm a");
    const metaLine = display.locationName
      ? `${timestamp} · ${display.locationName}`
      : timestamp;
    return {
      key: it.id,
      testId: "client-activity-row",
      title: {
        text: display.title,
        as: "span",
        testId: "client-activity-row-title",
      },
      body: display.body ?? undefined,
      bodyClamp: display.body ? 2 : undefined,
      bodyTestId: "client-activity-row-body",
      meta: metaLine,
      metaTestId: "client-activity-row-meta",
    };
  });

  return {
    kind: "list",
    cards,
    testId: "client-activity-panel-body",
    spacing: "compact",
  };
}

// ── Contacts ──────────────────────────────────────────────────────────

function normalizeContact(c: ClientContact): {
  id: string;
  displayName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  scope: ContactScope;
  locationId: string | null;
  isPrimary: boolean;
} {
  const honorific = (c.title ?? "").trim();
  const baseName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed";
  return {
    id: c.id,
    displayName: honorific ? `${honorific} ${baseName}` : baseName,
    jobTitle: ((c as any).jobTitle ?? "").trim() || null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    roles: Array.isArray(c.roles) ? c.roles : [],
    scope: c.locationId ? "location" : "company",
    locationId: c.locationId ?? null,
    isPrimary: c.isPrimary ?? false,
  };
}

export function buildClientContactDescriptor({
  contact,
  onEdit,
  showScope,
  assignedLocationNames,
}: {
  contact: ClientContact;
  onEdit?: (c: ClientContact) => void;
  showScope?: boolean;
  assignedLocationNames?: string[];
}): RailCardDescriptor {
  const nc = normalizeContact(contact);

  // Format location names: "Oakville, RBC Plaza" or "+1 more". Cap at 2 visible.
  const MAX_VISIBLE_LOCATIONS = 2;
  const locationLabel =
    assignedLocationNames && assignedLocationNames.length > 0
      ? assignedLocationNames.length <= MAX_VISIBLE_LOCATIONS
        ? assignedLocationNames.join(", ")
        : `${assignedLocationNames.slice(0, MAX_VISIBLE_LOCATIONS).join(", ")} +${assignedLocationNames.length - MAX_VISIBLE_LOCATIONS} more`
      : null;

  // Title trailing — Star (primary indicator) then Company chip when applicable.
  const trailing: RailTitleTrailing[] = [];
  if (nc.isPrimary) {
    trailing.push({ kind: "icon", icon: Star, ariaLabel: "Primary" });
  }
  if (showScope && nc.scope === "company") {
    trailing.push({ kind: "chip", chip: { text: "Company" } });
  }

  // Phone + Email as a single meta row with two icon-prefixed items.
  const phoneEmailItems: RailMetaItem[] = [];
  if (nc.phone) phoneEmailItems.push({ icon: Phone, text: nc.phone });
  if (nc.email) phoneEmailItems.push({ icon: Mail, text: nc.email, truncate: true });

  const metaRows: RailMetaRowDescriptor[] = [];
  if (phoneEmailItems.length > 0) {
    metaRows.push({ items: phoneEmailItems });
  }
  if (locationLabel) {
    metaRows.push({
      items: [{ icon: MapPin, text: locationLabel, truncate: true }],
    });
  }

  return {
    key: contact.id,
    onClick: onEdit ? () => onEdit(contact) : undefined,
    testId: onEdit ? "contact-card-edit" : "contact-card",
    ariaLabel: onEdit ? `Edit contact ${nc.displayName}` : undefined,
    title: {
      text: nc.displayName,
      as: "span",
      secondary: nc.jobTitle ? `(${nc.jobTitle})` : undefined,
      trailing: trailing.length > 0 ? trailing : undefined,
    },
    metaRows: metaRows.length > 0 ? metaRows : undefined,
    chipRow:
      nc.roles.length > 0
        ? nc.roles.map((r) => ({ text: r, className: "capitalize" }))
        : undefined,
  };
}

export interface ContactCardProps {
  contact: ClientContact;
  onEdit?: (c: ClientContact) => void;
  showScope?: boolean;
  /** Location names this person is assigned to (company cards only) */
  assignedLocationNames?: string[];
}

export function ContactCard({
  contact,
  onEdit,
  showScope = false,
  assignedLocationNames,
}: ContactCardProps) {
  return (
    <RailPanelRenderer
      panel={{
        kind: "single",
        card: buildClientContactDescriptor({
          contact,
          onEdit,
          showScope,
          assignedLocationNames,
        }),
      }}
      testIdPrefix="client-side"
    />
  );
}
