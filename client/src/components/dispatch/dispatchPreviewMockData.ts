/**
 * Mock data for the Dispatch Board preview.
 * Realistic HVAC visit data for 6 technicians across a day.
 */
import type { Technician, DispatchVisit } from "./dispatchPreviewTypes";

export const MOCK_TECHNICIANS: Technician[] = [
  { id: "tech-1", name: "Marcus Johnson", initials: "MJ", color: "#3b82f6", status: "on_job" },
  { id: "tech-2", name: "Sarah Chen", initials: "SC", color: "#8b5cf6", status: "available" },
  { id: "tech-3", name: "David Park", initials: "DP", color: "#f59e0b", status: "on_job" },
  { id: "tech-4", name: "Emily Torres", initials: "ET", color: "#10b981", status: "available" },
  { id: "tech-5", name: "James Wilson", initials: "JW", color: "#ef4444", status: "off" },
  { id: "tech-6", name: "Priya Sharma", initials: "PS", color: "#ec4899", status: "available" },
];

// Helper to build ISO datetime for "today" at a given hour/minute
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const MOCK_SCHEDULED_VISITS: DispatchVisit[] = [
  // Marcus — busy day
  {
    id: "v-101", visitNumber: 1, jobNumber: 10482, jobId: "j-1",
    summary: "Quarterly PM — RTU inspection", status: "in_progress",
    locationName: "Ocean View Road", customerName: "Freeman Service Group",
    technicianId: "tech-1", technicianIds: ["tech-1"], scheduledStart: todayAt(7, 0), scheduledEnd: todayAt(9, 0),
    durationMinutes: 120, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-102", visitNumber: 2, jobNumber: 10485, jobId: "j-2",
    summary: "Chiller overhaul — phase 2", status: "scheduled",
    locationName: "Hillcrest Mall", customerName: "Freeman Service Group",
    technicianId: "tech-1", technicianIds: ["tech-1"], scheduledStart: todayAt(10, 0), scheduledEnd: todayAt(13, 0),
    durationMinutes: 180, isAllDay: false, priority: "high", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-103", visitNumber: 1, jobNumber: 10490, jobId: "j-3",
    summary: "VRF commissioning", status: "scheduled",
    locationName: "Richmond Hill", customerName: "Freeman Service Group",
    technicianId: "tech-1", technicianIds: ["tech-1"], scheduledStart: todayAt(14, 0), scheduledEnd: todayAt(16, 0),
    durationMinutes: 120, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },

  // Sarah
  {
    id: "v-201", visitNumber: 1, jobNumber: 10492, jobId: "j-4",
    summary: "Fan belt replacement", status: "dispatched",
    locationName: "Bayview Station", customerName: "Freeman Service Group",
    technicianId: "tech-2", technicianIds: ["tech-2"], scheduledStart: todayAt(8, 0), scheduledEnd: todayAt(9, 30),
    durationMinutes: 90, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-202", visitNumber: 1, jobNumber: 10495, jobId: "j-5",
    summary: "Filter change-out — AHU-2", status: "scheduled",
    locationName: "Dundas Square", customerName: "Freeman Service Group",
    technicianId: "tech-2", technicianIds: ["tech-2"], scheduledStart: todayAt(10, 30), scheduledEnd: todayAt(12, 0),
    durationMinutes: 90, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-203", visitNumber: 1, jobNumber: 10498, jobId: "j-6",
    summary: "Refrigerant leak repair", status: "scheduled",
    locationName: "Yonge & Finch", customerName: "Freeman Service Group",
    technicianId: "tech-2", technicianIds: ["tech-2"], scheduledStart: todayAt(13, 0), scheduledEnd: todayAt(15, 30),
    durationMinutes: 150, isAllDay: false, priority: "urgent", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },

  // David
  {
    id: "v-301", visitNumber: 1, jobNumber: 10501, jobId: "j-7",
    summary: "Thermostat upgrade — 20 units", status: "en_route",
    locationName: "Liberty Village", customerName: "Freeman Service Group",
    technicianId: "tech-3", technicianIds: ["tech-3"], scheduledStart: todayAt(7, 30), scheduledEnd: todayAt(12, 0),
    durationMinutes: 270, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-302", visitNumber: 1, jobNumber: 10503, jobId: "j-8",
    summary: "Chiller plant startup", status: "scheduled",
    locationName: "Harbourfront Centre", customerName: "Freeman Service Group",
    technicianId: "tech-3", technicianIds: ["tech-3"], scheduledStart: todayAt(13, 30), scheduledEnd: todayAt(16, 30),
    durationMinutes: 180, isAllDay: false, priority: "high", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },

  // Emily
  {
    id: "v-401", visitNumber: 1, jobNumber: 10504, jobId: "j-9",
    summary: "BAS programming", status: "on_site",
    locationName: "Harbourfront Centre", customerName: "Freeman Service Group",
    technicianId: "tech-4", technicianIds: ["tech-4"], scheduledStart: todayAt(8, 0), scheduledEnd: todayAt(11, 0),
    durationMinutes: 180, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-402", visitNumber: 3, jobNumber: 10471, jobId: "j-10",
    summary: "Compressor follow-up check", status: "scheduled",
    locationName: "Twin Lane", customerName: "Freeman Service Group",
    technicianId: "tech-4", technicianIds: ["tech-4"], scheduledStart: todayAt(12, 0), scheduledEnd: todayAt(13, 0),
    durationMinutes: 60, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-403", visitNumber: 1, jobNumber: 10496, jobId: "j-11",
    summary: "Damper repair", status: "scheduled",
    locationName: "Dundas Square", customerName: "Freeman Service Group",
    technicianId: "tech-4", technicianIds: ["tech-4"], scheduledStart: todayAt(14, 0), scheduledEnd: todayAt(16, 0),
    durationMinutes: 120, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },

  // Priya
  {
    id: "v-601", visitNumber: 1, jobNumber: 10510, jobId: "j-14",
    summary: "Quarterly kitchen ventilation PM", status: "scheduled",
    locationName: "Yorkdale North", customerName: "Freeman Service Group",
    technicianId: "tech-6", technicianIds: ["tech-6"], scheduledStart: todayAt(9, 0), scheduledEnd: todayAt(11, 0),
    durationMinutes: 120, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-602", visitNumber: 1, jobNumber: 10511, jobId: "j-15",
    summary: "Annual cooling tower service", status: "scheduled",
    locationName: "Scarborough Town Centre", customerName: "Freeman Service Group",
    technicianId: "tech-6", technicianIds: ["tech-6"], scheduledStart: todayAt(12, 0), scheduledEnd: todayAt(15, 0),
    durationMinutes: 180, isAllDay: false, priority: "normal", version: 1, kind: "visit", visitId: "v-MOCK", jobStatus: "open", jobOpenSubStatus: null,
  },
];

// James (tech-5) has no scheduled visits — he's off today.

export const MOCK_UNSCHEDULED_VISITS: DispatchVisit[] = [
  {
    id: "v-u1", visitNumber: 1, jobNumber: 10512, jobId: "j-u1",
    summary: "Boiler annual inspection", status: "scheduled",
    locationName: "Lakeside Heights", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 90, isAllDay: false, priority: "normal", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-u2", visitNumber: 1, jobNumber: 10513, jobId: "j-u2",
    summary: "Condensing unit diagnostic", status: "scheduled",
    locationName: "Eglinton Crossing", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 60, isAllDay: false, priority: "high", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-u3", visitNumber: 2, jobNumber: 10475, jobId: "j-u3",
    summary: "Boiler repair — follow-up", status: "scheduled",
    locationName: "Lakeside Heights", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 120, isAllDay: false, priority: "urgent", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-u4", visitNumber: 1, jobNumber: 10514, jobId: "j-u4",
    summary: "ERV unit seasonal startup", status: "scheduled",
    locationName: "King West Lofts", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 60, isAllDay: false, priority: "normal", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-u5", visitNumber: 1, jobNumber: 10515, jobId: "j-u5",
    summary: "Warehouse heater PM", status: "scheduled",
    locationName: "Weston Industrial Park", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 90, isAllDay: false, priority: "normal", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
  {
    id: "v-u6", visitNumber: 1, jobNumber: 10516, jobId: "j-u6",
    summary: "Ductless split service call", status: "scheduled",
    locationName: "Bloor Street West", customerName: "Freeman Service Group",
    technicianId: null, technicianIds: [], scheduledStart: null, scheduledEnd: null,
    durationMinutes: 45, isAllDay: false, priority: "normal", version: 1, kind: "backlog", visitId: null, jobStatus: "open", jobOpenSubStatus: null,
  },
];
