/**
 * Mock data for Operations Queue preview.
 * Generates actionable queue items from the existing client workspace mock data.
 */
import { MOCK_LOCATIONS, type MockLocation } from "./previewClientWorkspaceMockData";

export type QueueCategory = "invoices" | "jobs" | "quotes" | "pm";

export type QueueItem = {
  id: string;
  category: QueueCategory;
  locationId: number;
  locationName: string;
  clientName: string;
  signal: string;
  urgency: number; // lower = more urgent
  /** Which tab to focus in detail pane */
  detailTab: string;
};

const CLIENT_NAME = "Freeman Service Group";

/** Second client for variety */
const ALT_CLIENTS: Record<number, string> = {
  3: "NorthStar Foods",
  7: "NorthStar Foods",
  11: "Apex Property Management",
  15: "Apex Property Management",
  20: "City of Toronto",
};

function clientFor(loc: MockLocation): string {
  return ALT_CLIENTS[loc.id] ?? CLIENT_NAME;
}

export function buildQueueItems(): QueueItem[] {
  const items: QueueItem[] = [];

  for (const loc of MOCK_LOCATIONS) {
    const client = clientFor(loc);

    // Overdue invoices (urgency 1)
    const overdue = loc.invoices.filter(i => i.status === "overdue");
    if (overdue.length > 0) {
      items.push({
        id: `inv-overdue-${loc.id}`,
        category: "invoices",
        locationId: loc.id,
        locationName: loc.name,
        clientName: client,
        signal: overdue.length === 1
          ? `1 Overdue Invoice — $${overdue[0].amount.toLocaleString()}`
          : `${overdue.length} Overdue Invoices — $${overdue.reduce((s, i) => s + i.amount, 0).toLocaleString()}`,
        urgency: 1,
        detailTab: "Invoices",
      });
    }

    // Active jobs (urgency 2)
    const active = loc.jobs.filter(j => j.status === "In Progress" || j.status === "Scheduled" || j.status === "Needs Review");
    if (active.length > 0) {
      items.push({
        id: `job-active-${loc.id}`,
        category: "jobs",
        locationId: loc.id,
        locationName: loc.name,
        clientName: client,
        signal: active.length === 1
          ? `#${active[0].number} — ${active[0].title} (${active[0].status})`
          : `${active.length} Active Jobs`,
        urgency: 2,
        detailTab: "Jobs",
      });
    }

    // Quotes pending/unapproved (urgency 3)
    const pending = loc.quotes.filter(q => q.status === "pending" || q.status === "unapproved");
    if (pending.length > 0) {
      items.push({
        id: `quote-pending-${loc.id}`,
        category: "quotes",
        locationId: loc.id,
        locationName: loc.name,
        clientName: client,
        signal: pending.length === 1
          ? `Quote #${pending[0].number} — $${pending[0].amount.toLocaleString()} (${pending[0].status === "unapproved" ? "Needs Approval" : "Pending"})`
          : `${pending.length} Quotes Awaiting Action`,
        urgency: 3,
        detailTab: "Quotes",
      });
    }

    // PM due (urgency 4)
    if (loc.pmNextDue) {
      items.push({
        id: `pm-due-${loc.id}`,
        category: "pm",
        locationId: loc.id,
        locationName: loc.name,
        clientName: client,
        signal: `${loc.pmSchedule ?? "PM"} — Due ${loc.pmNextDue}`,
        urgency: 4,
        detailTab: "PM",
      });
    }
  }

  // Sort by urgency then location name
  items.sort((a, b) => a.urgency - b.urgency || a.locationName.localeCompare(b.locationName));
  return items;
}

/** All queue items, pre-built */
export const QUEUE_ITEMS = buildQueueItems();
