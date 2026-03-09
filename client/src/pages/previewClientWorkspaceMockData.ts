/**
 * Shared mock data for Client Workspace preview pages.
 * Used by both the list-based and split-pane preview variants.
 */
import type React from "react";
import {
  Send, Eye, FileText, DollarSign, CalendarDays, Mail, CheckCircle2, AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Signal = { label: string; color: "green" | "orange" | "red" | "blue" };
export type MockEquipment = { name: string; type?: string; lastService: string };
export type MockJob = { number: string; title: string; status: string };
export type MockContact = { name: string; role: string; phone: string; email?: string };
export type MockPart = { name: string; qty: number };
export type MockInvoice = { number: string; amount: number; status: "paid" | "sent" | "overdue" | "draft" };
export type MockQuote = { number: string; amount: number; status: "approved" | "pending" | "unapproved" };

export type MockLocation = {
  id: number;
  name: string;
  address: string;
  signals: Signal[];
  equipment: MockEquipment[];
  jobs: MockJob[];
  contacts: MockContact[];
  parts: MockPart[];
  invoices: MockInvoice[];
  quotes: MockQuote[];
  pmSchedule: string | null;
  pmNextDue: string | null;
  pmCadence?: string;
  notes: string[];
  tags: string[];
  accessInstructions: string | null;
  lastService?: string;
};

export type ActivityItem = { icon: React.ElementType; text: string; time: string; color?: string };

// ─── Mock Locations ──────────────────────────────────────────────────────────

export const MOCK_LOCATIONS: MockLocation[] = [
  {
    id: 1, name: "Ocean View Road", address: "0969 Ocean View Rd, Middlefield CA",
    signals: [{ label: "1 Active Job", color: "green" }, { label: "Quarterly PM", color: "orange" }],
    equipment: [{ name: "RTU-1", type: "Rooftop Unit", lastService: "2026-01-15" }, { name: "RTU-2", type: "Rooftop Unit", lastService: "2026-02-10" }, { name: "Walk-in Freezer", type: "Refrigeration", lastService: "2025-12-20" }, { name: "Ice Machine", type: "Refrigeration", lastService: "2026-01-30" }],
    jobs: [{ number: "10482", title: "Refrigeration service", status: "In Progress" }, { number: "10479", title: "PM inspection", status: "Scheduled" }],
    contacts: [{ name: "Mike Freeman", role: "Store Manager", phone: "(555) 987-6543", email: "mike@oceanview.com" }],
    parts: [{ name: "Fan motor", qty: 2 }, { name: "Contactor", qty: 4 }, { name: "Capacitor", qty: 6 }],
    invoices: [{ number: "8760", amount: 1250.00, status: "sent" }, { number: "8755", amount: 890.50, status: "paid" }],
    quotes: [{ number: "2205", amount: 3400.00, status: "pending" }],
    pmSchedule: "Quarterly refrigeration inspection", pmNextDue: "Apr 15, 2026", pmCadence: "Every 90 days",
    notes: ["Roof access through rear ladder", "Call store manager on arrival"],
    tags: ["Refrigeration", "High Priority", "After Hours Contract"],
    accessInstructions: "Roof access through rear ladder", lastService: "Mar 1, 2026",
  },
  {
    id: 2, name: "Twin Lane", address: "145 Twin Lane, Oakville ON",
    signals: [{ label: "2 Overdue Invoices", color: "red" }],
    equipment: [{ name: "Rooftop Unit A", type: "Rooftop Unit", lastService: "2025-11-05" }, { name: "Split System B", type: "Split System", lastService: "2026-01-22" }],
    jobs: [{ number: "10471", title: "Compressor replacement", status: "Completed" }],
    contacts: [{ name: "Sarah Chen", role: "Operations Mgr", phone: "(555) 321-7890" }],
    parts: [{ name: "Compressor", qty: 1 }],
    invoices: [{ number: "8701", amount: 456.66, status: "overdue" }, { number: "8698", amount: 600.00, status: "overdue" }],
    quotes: [],
    pmSchedule: null, pmNextDue: null,
    notes: ["Loading dock entrance only"], tags: ["Commercial"], accessInstructions: "Loading dock entrance only", lastService: "Jan 22, 2026",
  },
  {
    id: 3, name: "Hillcrest Mall", address: "2200 Hillcrest Blvd, Unit 12, Toronto ON",
    signals: [{ label: "1 Active Job", color: "green" }, { label: "Annual PM", color: "orange" }, { label: "1 Unapproved Quote", color: "blue" }],
    equipment: [{ name: "AHU-1", type: "Air Handler", lastService: "2026-02-28" }, { name: "Chiller", type: "Chiller", lastService: "2025-10-15" }, { name: "Cooling Tower", type: "Cooling Tower", lastService: "2025-09-01" }],
    jobs: [{ number: "10485", title: "Chiller overhaul", status: "In Progress" }, { number: "10486", title: "Filter change-out", status: "Needs Review" }],
    contacts: [{ name: "James Patel", role: "Facility Manager", phone: "(555) 444-5678", email: "jpatel@hillcrestmall.com" }],
    parts: [{ name: "Belt set", qty: 3 }, { name: "Filter pack", qty: 12 }],
    invoices: [{ number: "8742", amount: 2100.00, status: "sent" }],
    quotes: [{ number: "2201", amount: 8500.00, status: "unapproved" }],
    pmSchedule: "Annual HVAC system inspection", pmNextDue: "Jun 1, 2026", pmCadence: "Annually",
    notes: ["Security clearance required", "After-hours work only (10pm-6am)"],
    tags: ["Mall", "After Hours", "High Value"], accessInstructions: "Security clearance required at main entrance", lastService: "Feb 28, 2026",
  },
  {
    id: 4, name: "Danforth Plaza", address: "890 Danforth Ave, Suite 200, Toronto ON",
    signals: [{ label: "Quarterly PM", color: "orange" }],
    equipment: [{ name: "Furnace", type: "Gas Furnace", lastService: "2026-01-10" }, { name: "AC Unit", type: "Split System", lastService: "2025-08-20" }],
    jobs: [], contacts: [{ name: "Linda Wu", role: "Building Super", phone: "(555) 222-3344" }],
    parts: [],
    invoices: [{ number: "8730", amount: 350.00, status: "paid" }],
    quotes: [],
    pmSchedule: "Quarterly HVAC maintenance", pmNextDue: "May 1, 2026", pmCadence: "Every 90 days",
    notes: [], tags: ["Retail"], accessInstructions: null, lastService: "Jan 10, 2026",
  },
  {
    id: 5, name: "Richmond Hill", address: "55 Richmond Hill Dr, Richmond Hill ON",
    signals: [{ label: "1 Active Job", color: "green" }],
    equipment: [{ name: "VRF System", type: "VRF", lastService: "2026-03-01" }],
    jobs: [{ number: "10490", title: "VRF commissioning", status: "Scheduled" }],
    contacts: [{ name: "Tom Richards", role: "Owner", phone: "(555) 111-2233" }],
    parts: [{ name: "Refrigerant R-410A", qty: 3 }],
    invoices: [],
    quotes: [{ number: "2203", amount: 1200.00, status: "approved" }],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null, lastService: "Mar 1, 2026",
  },
  {
    id: 6, name: "Markham West", address: "320 Markham Rd W, Markham ON",
    signals: [],
    equipment: [{ name: "Rooftop Package Unit", type: "Rooftop Unit", lastService: "2025-12-15" }],
    jobs: [], contacts: [], parts: [],
    invoices: [],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 7, name: "Lakeside Heights", address: "1400 Lakeshore Blvd, Mississauga ON",
    signals: [{ label: "1 Overdue Invoice", color: "red" }, { label: "1 Unapproved Quote", color: "blue" }],
    equipment: [{ name: "Boiler", type: "Boiler", lastService: "2025-11-30" }, { name: "Hydronic System", type: "Hydronic", lastService: "2026-01-05" }],
    jobs: [{ number: "10475", title: "Boiler repair", status: "Completed" }],
    contacts: [{ name: "Angela Martin", role: "Property Manager", phone: "(555) 666-7788" }],
    parts: [{ name: "Circulator pump", qty: 1 }],
    invoices: [{ number: "8710", amount: 1056.66, status: "overdue" }],
    quotes: [{ number: "2202", amount: 4200.00, status: "unapproved" }],
    pmSchedule: null, pmNextDue: null, notes: ["Parking available in rear lot"], tags: ["Hydronic"], accessInstructions: "Parking available in rear lot",
  },
  {
    id: 8, name: "Southfield Plaza", address: "780 Southfield Dr, Brampton ON",
    signals: [],
    equipment: [{ name: "Mini Split", type: "Ductless", lastService: "2026-02-01" }],
    jobs: [], contacts: [], parts: [],
    invoices: [{ number: "8725", amount: 275.00, status: "paid" }],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 9, name: "Bayview Station", address: "99 Bayview Ave, Toronto ON",
    signals: [{ label: "1 Active Job", color: "green" }, { label: "Quarterly PM", color: "orange" }],
    equipment: [{ name: "RTU-3", type: "Rooftop Unit", lastService: "2026-02-15" }, { name: "Exhaust Fan", type: "Ventilation", lastService: "2025-12-10" }],
    jobs: [{ number: "10492", title: "Fan belt replacement", status: "Scheduled" }],
    contacts: [{ name: "Dave Cooper", role: "Maintenance Lead", phone: "(555) 333-4455" }],
    parts: [{ name: "V-Belt", qty: 4 }],
    invoices: [{ number: "8748", amount: 520.00, status: "sent" }],
    quotes: [],
    pmSchedule: "Quarterly rooftop inspection", pmNextDue: "Apr 20, 2026", pmCadence: "Every 90 days",
    notes: [], tags: ["Restaurant"], accessInstructions: null, lastService: "Feb 15, 2026",
  },
  {
    id: 10, name: "Weston Industrial Park", address: "4500 Weston Rd, Unit 8, Vaughan ON",
    signals: [],
    equipment: [{ name: "Warehouse Heater A", type: "Unit Heater", lastService: "2025-10-25" }, { name: "Warehouse Heater B", type: "Unit Heater", lastService: "2025-10-25" }],
    jobs: [], contacts: [{ name: "Paul Jensen", role: "Warehouse Mgr", phone: "(555) 888-9900" }],
    parts: [],
    invoices: [],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: ["24/7 access with gate code: 4521"], tags: ["Industrial"], accessInstructions: "Gate code: 4521",
  },
  {
    id: 11, name: "Dundas Square", address: "10 Dundas St E, Toronto ON",
    signals: [{ label: "2 Active Jobs", color: "green" }],
    equipment: [{ name: "AHU-2", type: "Air Handler", lastService: "2026-03-05" }, { name: "Chilled Water Loop", type: "Chilled Water", lastService: "2026-01-20" }],
    jobs: [{ number: "10495", title: "Filter change-out", status: "In Progress" }, { number: "10496", title: "Damper repair", status: "Scheduled" }],
    contacts: [{ name: "Rachel Kim", role: "Chief Engineer", phone: "(555) 777-1234" }],
    parts: [{ name: "MERV-13 Filter", qty: 24 }],
    invoices: [{ number: "8750", amount: 1800.00, status: "sent" }],
    quotes: [{ number: "2204", amount: 5600.00, status: "pending" }],
    pmSchedule: null, pmNextDue: null,
    notes: [], tags: ["High Rise", "Critical"], accessInstructions: null, lastService: "Mar 5, 2026",
  },
  {
    id: 12, name: "Eglinton Crossing", address: "2800 Eglinton Ave W, Toronto ON",
    signals: [{ label: "1 Overdue Invoice", color: "red" }],
    equipment: [{ name: "Condensing Unit", type: "Condensing Unit", lastService: "2025-09-15" }],
    jobs: [], contacts: [], parts: [],
    invoices: [{ number: "8705", amount: 380.00, status: "overdue" }],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 13, name: "Scarborough Town Centre", address: "300 Borough Dr, Scarborough ON",
    signals: [{ label: "Annual PM", color: "orange" }],
    equipment: [{ name: "Cooling Tower B", type: "Cooling Tower", lastService: "2025-07-20" }, { name: "AHU-3", type: "Air Handler", lastService: "2026-01-12" }],
    jobs: [], contacts: [{ name: "Victor Nguyen", role: "Facility Coord", phone: "(555) 444-0011" }],
    parts: [{ name: "Chemical treatment", qty: 5 }],
    invoices: [{ number: "8738", amount: 950.00, status: "paid" }],
    quotes: [],
    pmSchedule: "Annual cooling tower service", pmNextDue: "Jul 15, 2026", pmCadence: "Annually",
    notes: ["Coordinate with security 48hrs in advance"], tags: ["Mall"], accessInstructions: "Coordinate with security 48hrs in advance",
  },
  {
    id: 14, name: "Bloor Street West", address: "1055 Bloor St W, Toronto ON",
    signals: [],
    equipment: [{ name: "Ductless Split", type: "Ductless", lastService: "2026-02-20" }],
    jobs: [], contacts: [], parts: [],
    invoices: [],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 15, name: "Yonge & Finch", address: "5800 Yonge St, North York ON",
    signals: [{ label: "1 Active Job", color: "green" }, { label: "1 Unapproved Quote", color: "blue" }],
    equipment: [{ name: "VRF Outdoor Unit", type: "VRF", lastService: "2026-02-28" }, { name: "VRF Indoor Units (x12)", type: "VRF", lastService: "2026-02-28" }],
    jobs: [{ number: "10498", title: "Refrigerant leak repair", status: "In Progress" }],
    contacts: [{ name: "Chris Park", role: "Building Mgr", phone: "(555) 555-6677" }],
    parts: [{ name: "Flare fitting", qty: 6 }],
    invoices: [{ number: "8752", amount: 720.00, status: "sent" }],
    quotes: [{ number: "2206", amount: 2800.00, status: "unapproved" }],
    pmSchedule: null, pmNextDue: null,
    notes: [], tags: ["VRF Specialist"], accessInstructions: null, lastService: "Feb 28, 2026",
  },
  {
    id: 16, name: "Etobicoke Gateway", address: "100 The East Mall, Etobicoke ON",
    signals: [],
    equipment: [{ name: "Gas Furnace", type: "Gas Furnace", lastService: "2025-11-10" }],
    jobs: [], contacts: [], parts: [],
    invoices: [],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 17, name: "Yorkdale North", address: "3401 Dufferin St, Toronto ON",
    signals: [{ label: "Quarterly PM", color: "orange" }, { label: "1 Overdue Invoice", color: "red" }],
    equipment: [{ name: "Makeup Air Unit", type: "Makeup Air", lastService: "2026-01-18" }, { name: "Kitchen Hood Exhaust", type: "Exhaust", lastService: "2026-01-18" }],
    jobs: [], contacts: [{ name: "Maria Santos", role: "Restaurant Owner", phone: "(555) 222-8899" }],
    parts: [{ name: "Grease filter", qty: 8 }],
    invoices: [{ number: "8715", amount: 520.00, status: "overdue" }],
    quotes: [],
    pmSchedule: "Quarterly kitchen ventilation", pmNextDue: "Apr 1, 2026", pmCadence: "Every 90 days",
    notes: ["Access through kitchen back door"], tags: ["Restaurant", "Kitchen Ventilation"], accessInstructions: "Access through kitchen back door", lastService: "Jan 18, 2026",
  },
  {
    id: 18, name: "King West Lofts", address: "560 King St W, Toronto ON",
    signals: [],
    equipment: [{ name: "ERV Unit", type: "Energy Recovery", lastService: "2026-03-01" }],
    jobs: [], contacts: [], parts: [],
    invoices: [],
    quotes: [],
    pmSchedule: null, pmNextDue: null, notes: [], tags: [], accessInstructions: null,
  },
  {
    id: 19, name: "Liberty Village", address: "171 East Liberty St, Toronto ON",
    signals: [{ label: "1 Active Job", color: "green" }],
    equipment: [{ name: "Rooftop Unit", type: "Rooftop Unit", lastService: "2026-02-05" }, { name: "Baseboard Heaters (x20)", type: "Baseboard", lastService: "2025-10-01" }],
    jobs: [{ number: "10501", title: "Thermostat upgrade", status: "Scheduled" }],
    contacts: [{ name: "Alex Tran", role: "Property Manager", phone: "(555) 999-0011" }],
    parts: [{ name: "Smart thermostat", qty: 20 }],
    invoices: [{ number: "8758", amount: 4200.00, status: "draft" }],
    quotes: [{ number: "2207", amount: 9800.00, status: "approved" }],
    pmSchedule: null, pmNextDue: null,
    notes: [], tags: ["Residential", "Smart Building"], accessInstructions: null, lastService: "Feb 5, 2026",
  },
  {
    id: 20, name: "Harbourfront Centre", address: "235 Queens Quay W, Toronto ON",
    signals: [{ label: "2 Active Jobs", color: "green" }, { label: "Annual PM", color: "orange" }, { label: "3 Overdue Invoices", color: "red" }],
    equipment: [{ name: "Chiller Plant", type: "Chiller", lastService: "2025-08-15" }, { name: "AHU-4", type: "Air Handler", lastService: "2026-01-25" }, { name: "Cooling Tower C", type: "Cooling Tower", lastService: "2025-08-15" }, { name: "BAS Controller", type: "BAS", lastService: "2026-03-01" }],
    jobs: [{ number: "10503", title: "Chiller plant startup", status: "Scheduled" }, { number: "10504", title: "BAS programming", status: "In Progress" }],
    contacts: [{ name: "Diana Ross", role: "Chief Engineer", phone: "(555) 123-4567", email: "dross@harbourfront.ca" }, { name: "Ian Walsh", role: "Asst Engineer", phone: "(555) 123-4568" }],
    parts: [{ name: "Refrigerant R-134a", qty: 10 }, { name: "Sensor probe", qty: 4 }],
    invoices: [{ number: "8695", amount: 2400.00, status: "overdue" }, { number: "8700", amount: 1800.00, status: "overdue" }, { number: "8708", amount: 950.00, status: "overdue" }],
    quotes: [{ number: "2208", amount: 15000.00, status: "pending" }],
    pmSchedule: "Annual chiller plant inspection", pmNextDue: "May 15, 2026", pmCadence: "Annually",
    notes: ["High-security facility — escorts required", "Loading dock on south side"],
    tags: ["Critical", "High Value", "Government"], accessInstructions: "High-security facility — escorts required", lastService: "Mar 1, 2026",
  },
];

// ─── Client-Level Data ───────────────────────────────────────────────────────

export const MOCK_CLIENT_CONTACTS = [
  { name: "Debbie Freeman", role: "Accounts Payable", email: "debbie@freemansg.com", phone: "(555) 133-4567" },
  { name: "Kevin Scott", role: "Operations Manager", email: "kevin@freemansg.com", phone: "(555) 987-6543" },
  { name: "Patricia Lee", role: "CEO", email: "patricia@freemansg.com", phone: "(555) 100-2000" },
];

export const MOCK_CLIENT_NOTES = [
  "Billing handled through head office",
  "After-hours work requires manager approval",
  "Net-30 payment terms agreed Jan 2026",
];

export const MOCK_BILLING = {
  outstanding: 5608.98,
  overdue: 1056.66,
  openInvoices: 3,
  unapprovedQuotes: 2,
};

export const MOCK_PAYMENT_METHODS = [
  { type: "Visa", last4: "1017", label: "Default", verified: true },
  { type: "ACH / Bank Transfer", last4: null as string | null, label: "Verified", verified: true },
];

export const MOCK_ACTIVITY: ActivityItem[] = [
  { icon: Send, text: "Invoice #8754 sent to Debbie Freeman", time: "2h ago" },
  { icon: Eye, text: "Invoice #8754 viewed by client", time: "1h ago" },
  { icon: FileText, text: "Quote #2201 opened by Kevin Scott", time: "3h ago" },
  { icon: DollarSign, text: "Payment received $932.25", time: "Yesterday", color: "text-emerald-600" },
  { icon: DollarSign, text: "Deposit recorded $500.00", time: "Mar 5" },
  { icon: CalendarDays, text: "PM reminder email sent — Ocean View Road", time: "Mar 4" },
  { icon: Mail, text: "Client replied to estimate email", time: "Mar 3" },
  { icon: CheckCircle2, text: "Tech completed visit at Hillcrest Mall", time: "Mar 2", color: "text-emerald-600" },
  { icon: AlertTriangle, text: "Invoice #8701 became overdue", time: "Mar 1", color: "text-red-600" },
  { icon: Send, text: "Invoice #8701 sent to Debbie Freeman", time: "Feb 28" },
];

// ─── Computed Stats ──────────────────────────────────────────────────────────

export const TOTAL_EQUIPMENT = MOCK_LOCATIONS.reduce((s, l) => s + l.equipment.length, 0);
export const TOTAL_ACTIVE_JOBS = MOCK_LOCATIONS.reduce((s, l) => s + l.jobs.filter(j => j.status !== "Completed").length, 0);
export const TOTAL_PM = MOCK_LOCATIONS.filter(l => l.pmSchedule).length;
export const TOTAL_OVERDUE = MOCK_LOCATIONS.reduce((s, l) => s + l.invoices.filter(i => i.status === "overdue").length, 0);
export const TOTAL_UNAPPROVED_QUOTES = MOCK_LOCATIONS.reduce((s, l) => s + l.quotes.filter(q => q.status === "unapproved").length, 0);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type FilterKey = "all" | "activeWork" | "hasPM" | "overdueInvoice" | "needsAttention";

export function matchesFilter(loc: MockLocation, f: FilterKey): boolean {
  switch (f) {
    case "all": return true;
    case "activeWork": return loc.signals.some(s => s.color === "green");
    case "hasPM": return loc.pmSchedule !== null;
    case "overdueInvoice": return loc.signals.some(s => s.color === "red");
    case "needsAttention": return loc.signals.length > 0;
  }
}

export function urgencyScore(loc: MockLocation): number {
  let s = 0;
  for (const sig of loc.signals) {
    if (sig.color === "red") s += 100;
    else if (sig.color === "green") s += 50;
    else if (sig.color === "blue") s += 25;
    else if (sig.color === "orange") s += 10;
  }
  return s;
}

export function sortLocations(locs: MockLocation[], sort: string): MockLocation[] {
  switch (sort) {
    case "activeWork": return [...locs].sort((a, b) => urgencyScore(b) - urgencyScore(a));
    case "name": return [...locs].sort((a, b) => a.name.localeCompare(b.name));
    case "overdueBalance": {
      return [...locs].sort((a, b) => {
        const aRed = a.signals.filter(s => s.color === "red").length;
        const bRed = b.signals.filter(s => s.color === "red").length;
        return bRed - aRed;
      });
    }
    case "pmStatus": {
      return [...locs].sort((a, b) => {
        const aPm = a.pmSchedule ? 1 : 0;
        const bPm = b.pmSchedule ? 1 : 0;
        return bPm - aPm;
      });
    }
    default: return locs;
  }
}

export function signalClasses(color: Signal["color"]): string {
  switch (color) {
    case "green":  return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "orange": return "bg-amber-50 text-amber-700 border-amber-200";
    case "red":    return "bg-red-50 text-red-700 border-red-200";
    case "blue":   return "bg-blue-50 text-blue-700 border-blue-200";
  }
}

export function hasUrgency(loc: MockLocation): boolean {
  return loc.signals.some(s => s.color === "red");
}

export function jobStatusClasses(status: string): string {
  switch (status) {
    case "In Progress": return "bg-emerald-100 text-emerald-700";
    case "Scheduled":   return "bg-blue-100 text-blue-700";
    case "Completed":   return "bg-slate-100 text-slate-600";
    case "Needs Review": return "bg-amber-100 text-amber-700";
    default:            return "bg-slate-100 text-slate-600";
  }
}

export function invoiceStatusClasses(status: string): string {
  switch (status) {
    case "paid":    return "bg-emerald-100 text-emerald-700";
    case "sent":    return "bg-blue-100 text-blue-700";
    case "overdue": return "bg-red-100 text-red-700";
    case "draft":   return "bg-slate-100 text-slate-600";
    default:        return "bg-slate-100 text-slate-600";
  }
}

export function quoteStatusClasses(status: string): string {
  switch (status) {
    case "approved":   return "bg-emerald-100 text-emerald-700";
    case "pending":    return "bg-amber-100 text-amber-700";
    case "unapproved": return "bg-red-100 text-red-700";
    default:           return "bg-slate-100 text-slate-600";
  }
}

export function getSubtitle(loc: MockLocation): string | null {
  if (loc.pmNextDue) return `Next PM: ${loc.pmNextDue}`;
  if (loc.lastService) return `Last service: ${loc.lastService}`;
  return null;
}

// ─── Stable Preview Identity Registry ──────────────────────────────────────
// Source of truth for preview clients, locations, and slugs.
// CommandPalette results reference these slugs for deterministic navigation.

export type PreviewClient = {
  slug: string;
  name: string;
  /** Location IDs belonging to this client */
  locationIds: number[];
};

/** All mock preview clients with their assigned location IDs */
export const PREVIEW_CLIENTS: PreviewClient[] = [
  {
    slug: "freeman-service-group",
    name: "Freeman Service Group",
    locationIds: [1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19],
  },
  {
    slug: "northstar-foods",
    name: "NorthStar Foods",
    locationIds: [3, 7],
  },
  {
    slug: "apex-property-management",
    name: "Apex Property Management",
    locationIds: [11, 15],
  },
  {
    slug: "city-of-toronto",
    name: "City of Toronto",
    locationIds: [20],
  },
];

/** Look up a client by slug */
export function findPreviewClient(slug: string): PreviewClient | undefined {
  return PREVIEW_CLIENTS.find(c => c.slug === slug);
}

/** Look up which client owns a location ID */
export function findClientForLocation(locationId: number): PreviewClient | undefined {
  return PREVIEW_CLIENTS.find(c => c.locationIds.includes(locationId));
}

/** Get the default location for a client (first in list) */
export function getDefaultLocationForClient(clientSlug: string): number | undefined {
  const client = findPreviewClient(clientSlug);
  return client?.locationIds[0];
}
