/**
 * Activity Feed Registry — Canonical operational event_type set + category
 * grouping for the global Activity Feed drawer.
 *
 * Persistence model
 * -----------------
 * The user's preference is stored as a list of `event_type` strings on
 * `activity_feed_preferences.enabled_event_types`. The UI no longer
 * surfaces per-event toggles — it shows ONE toggle per CATEGORY (e.g.
 * "Visit Updates"). Toggling a category writes/clears every event_type
 * in that category as a unit. The category↔events mapping below is the
 * single source of truth for that bundling.
 *
 * STABILITY: The string values in `ACTIVITY_FEED_EVENT_TYPES` are PERSISTED
 * (in `activity_feed_preferences.enabled_event_types`) and they MATCH the
 * `events.event_type` strings written by `server/lib/events.ts`. Renaming a
 * key requires a SQL migration AND a coordinated update at every emitter
 * site. Adding a new key is safe; deleting is not.
 *
 * EXCLUSIONS (deliberate, do NOT add): job.scheduled, job.unscheduled,
 * job.reassigned, quote.sent, invoice.sent, invoice.created,
 * client.created, client.updated, reviews, marketing.
 */

export const ACTIVITY_FEED_EVENT_TYPES = [
  "visit.started",
  "visit.completed",
  "visit.on_route",
  "tech.arrived",
  "job.created",
  "quote.created",
  "quote.approved",
  "quote.declined",
  "invoice.viewed",
  "invoice.paid",
  "invoice.partial_paid",
  "payment.failed",
  "timesheet.clocked_in",
  "timesheet.clocked_out",
  "note.created",
] as const;

export type ActivityFeedEventType = (typeof ACTIVITY_FEED_EVENT_TYPES)[number];

// ────────────────────────────────────────────────────────────────────
// Categories — the toggle unit surfaced in the Customize view
// ────────────────────────────────────────────────────────────────────

export type ActivityFeedCategory =
  | "visit_updates"
  | "technician_updates"
  | "job_updates"
  | "quote_updates"
  | "invoice_updates"
  | "payment_updates"
  | "notes";

export interface ActivityFeedCategoryDefinition {
  key: ActivityFeedCategory;
  label: string;
  /** Short helper text shown under the category label in the customize view. */
  description: string;
  /** Event types this category controls (enable/disable as a unit). */
  eventTypes: ActivityFeedEventType[];
  /** Category enabled by default for users with no saved preferences. */
  defaultEnabled: boolean;
  /** Display order in the customize view (smaller = top). */
  order: number;
}

/**
 * Canonical category list. The UI walks this in `order` and renders ONE
 * toggle per entry. Changes here are user-visible.
 */
export const ACTIVITY_FEED_CATEGORIES: readonly ActivityFeedCategoryDefinition[] = [
  {
    key: "visit_updates",
    label: "Visit Updates",
    description: "Visits started or completed",
    eventTypes: ["visit.started", "visit.completed"],
    defaultEnabled: true,
    order: 10,
  },
  {
    key: "technician_updates",
    label: "Technician Updates",
    description: "On route, arrivals, and clock in / out",
    eventTypes: [
      "visit.on_route",
      "tech.arrived",
      "timesheet.clocked_in",
      "timesheet.clocked_out",
    ],
    defaultEnabled: true,
    order: 20,
  },
  {
    key: "job_updates",
    label: "Job Updates",
    description: "New jobs created",
    eventTypes: ["job.created"],
    defaultEnabled: true,
    order: 35,
  },
  {
    key: "quote_updates",
    label: "Quote Updates",
    description: "New quotes, approvals, and declines",
    eventTypes: ["quote.created", "quote.approved", "quote.declined"],
    defaultEnabled: true,
    order: 40,
  },
  {
    key: "invoice_updates",
    label: "Invoice Updates",
    description: "Customer views and full payments",
    eventTypes: ["invoice.viewed", "invoice.paid"],
    defaultEnabled: true,
    order: 50,
  },
  {
    key: "payment_updates",
    label: "Payment Updates",
    description: "Partial payments and failures",
    eventTypes: ["invoice.partial_paid", "payment.failed"],
    defaultEnabled: true,
    order: 60,
  },
  {
    key: "notes",
    label: "Notes",
    description: "New notes added to jobs, clients, or locations",
    eventTypes: ["note.created"],
    defaultEnabled: false,
    order: 70,
  },
];

const EVENT_TYPE_TO_CATEGORY: Map<ActivityFeedEventType, ActivityFeedCategory> = (() => {
  const m = new Map<ActivityFeedEventType, ActivityFeedCategory>();
  for (const cat of ACTIVITY_FEED_CATEGORIES) {
    for (const t of cat.eventTypes) m.set(t, cat.key);
  }
  return m;
})();

export function getCategoryForEventType(eventType: string): ActivityFeedCategory | undefined {
  return EVENT_TYPE_TO_CATEGORY.get(eventType as ActivityFeedEventType);
}

/**
 * Default-enabled event_types — derived from the category defaults so
 * there is exactly one source of truth. A new event_type added to a
 * default-enabled category is automatically default-on.
 */
export const DEFAULT_ENABLED_EVENT_TYPES: ActivityFeedEventType[] = ACTIVITY_FEED_CATEGORIES
  .filter((c) => c.defaultEnabled)
  .flatMap((c) => c.eventTypes);

// ────────────────────────────────────────────────────────────────────
// Per-event display metadata — icon + tone for the round badge
// ────────────────────────────────────────────────────────────────────

/**
 * Icon tone — maps to a Tailwind color band on the round badge in the feed.
 * Names are deliberately abstract (not raw hex) so we stay token-aligned.
 */
export type ActivityFeedTone =
  | "green"
  | "blue"
  | "amber"
  | "red"
  | "purple"
  | "gray";

/**
 * lucide-react icon name. Client maps each to the actual component.
 */
export type ActivityFeedIcon =
  | "play"
  | "check-circle-2"
  | "navigation"
  | "map-pin"
  | "briefcase"
  | "file-plus"
  | "file-check-2"
  | "file-x-2"
  | "eye"
  | "dollar-sign"
  | "circle-dollar-sign"
  | "alert-triangle"
  | "log-in"
  | "log-out"
  | "sticky-note";

export interface ActivityFeedEventDefinition {
  eventType: ActivityFeedEventType;
  /** The category this event_type rolls up into for toggling. */
  category: ActivityFeedCategory;
  icon: ActivityFeedIcon;
  tone: ActivityFeedTone;
}

export const ACTIVITY_FEED_EVENT_DEFINITIONS: readonly ActivityFeedEventDefinition[] = [
  // Visit Updates
  { eventType: "visit.started",        category: "visit_updates",      icon: "play",                tone: "green" },
  { eventType: "visit.completed",      category: "visit_updates",      icon: "check-circle-2",      tone: "green" },
  // Technician Updates
  { eventType: "visit.on_route",       category: "technician_updates", icon: "navigation",          tone: "amber" },
  { eventType: "tech.arrived",         category: "technician_updates", icon: "map-pin",             tone: "blue" },
  { eventType: "timesheet.clocked_in", category: "technician_updates", icon: "log-in",              tone: "blue" },
  { eventType: "timesheet.clocked_out",category: "technician_updates", icon: "log-out",             tone: "blue" },
  // Job Updates
  { eventType: "job.created",          category: "job_updates",        icon: "briefcase",           tone: "blue" },
  // Quote Updates
  { eventType: "quote.created",        category: "quote_updates",      icon: "file-plus",           tone: "purple" },
  { eventType: "quote.approved",       category: "quote_updates",      icon: "file-check-2",        tone: "purple" },
  { eventType: "quote.declined",       category: "quote_updates",      icon: "file-x-2",            tone: "red" },
  // Invoice Updates
  { eventType: "invoice.viewed",       category: "invoice_updates",    icon: "eye",                 tone: "blue" },
  { eventType: "invoice.paid",         category: "invoice_updates",    icon: "dollar-sign",         tone: "green" },
  // Payment Updates
  { eventType: "invoice.partial_paid", category: "payment_updates",    icon: "circle-dollar-sign",  tone: "amber" },
  { eventType: "payment.failed",       category: "payment_updates",    icon: "alert-triangle",      tone: "red" },
  // Notes
  { eventType: "note.created",         category: "notes",              icon: "sticky-note",         tone: "gray" },
];

const DEFINITION_BY_TYPE: Map<ActivityFeedEventType, ActivityFeedEventDefinition> = new Map(
  ACTIVITY_FEED_EVENT_DEFINITIONS.map((d) => [d.eventType, d]),
);

export function getActivityEventDefinition(eventType: string): ActivityFeedEventDefinition | undefined {
  return DEFINITION_BY_TYPE.get(eventType as ActivityFeedEventType);
}

export function isCanonicalActivityEventType(eventType: string): eventType is ActivityFeedEventType {
  return DEFINITION_BY_TYPE.has(eventType as ActivityFeedEventType);
}

// ────────────────────────────────────────────────────────────────────
// Category state helpers — used by the Customize view to project
// stored event_type lists ↔ category toggle state.
// ────────────────────────────────────────────────────────────────────

/**
 * Project a stored event_type set into per-category enabled flags.
 * A category is considered enabled if ANY of its event_types are present
 * in `enabledTypes`. (See spec note D — older data with partial enables
 * normalizes to "enabled" on read; saves re-write the full set.)
 */
export function categoriesFromEventTypes(
  enabledTypes: readonly string[],
): Record<ActivityFeedCategory, boolean> {
  const enabledSet = new Set(enabledTypes);
  const out = {} as Record<ActivityFeedCategory, boolean>;
  for (const cat of ACTIVITY_FEED_CATEGORIES) {
    out[cat.key] = cat.eventTypes.some((t) => enabledSet.has(t));
  }
  return out;
}

/**
 * Project a per-category toggle state into the canonical event_type list.
 * Each enabled category contributes ALL its event_types to the output
 * (normalize-on-save). Result is in canonical registry order so the
 * server response stays stable regardless of toggle order.
 */
export function eventTypesFromCategories(
  categoryState: Partial<Record<ActivityFeedCategory, boolean>>,
): ActivityFeedEventType[] {
  const out = new Set<ActivityFeedEventType>();
  for (const cat of ACTIVITY_FEED_CATEGORIES) {
    if (categoryState[cat.key]) {
      for (const t of cat.eventTypes) out.add(t);
    }
  }
  return ACTIVITY_FEED_EVENT_TYPES.filter((t) => out.has(t));
}
