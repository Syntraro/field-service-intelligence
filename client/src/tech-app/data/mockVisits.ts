/** Technician PWA — Mock visit data (UI prototype only)
 *  2026-04-03: Added jobType, parts, technicianId fields + team mock data. */

import type { MockVisit, MockTechnician } from "../types";

/** Mock technician roster for team schedule view */
export const MOCK_TECHNICIANS: MockTechnician[] = [
  { id: "t1", name: "Mike Thompson", color: "#3b82f6" },
  { id: "t2", name: "Sarah Chen", color: "#8b5cf6" },
  { id: "t3", name: "James Wilson", color: "#f59e0b" },
  { id: "t4", name: "Raj Patel", color: "#10b981" },
];

/** Current user's visits (My Schedule) */
export const INITIAL_VISITS: MockVisit[] = [
  {
    id: "v1",
    company: "Basil Box — King West",
    jobTitle: "Quarterly PM — RTU inspection",
    address: "456 King St W, Toronto",
    status: "scheduled",
    scheduledTime: "8:00 AM",
    scheduledEnd: "9:30 AM",
    visitNumber: 1,
    timerRunning: false,
    jobType: "pm",
    technicianId: "t1",
    notes: [],
    parts: [],
    description: "Routine quarterly preventive maintenance on rooftop unit. Inspect belts, filters, refrigerant levels, and electrical connections.",
    instructions: "Access via rear alley door — ask front staff to buzz you in. Roof access ladder is behind the kitchen. Hard hat required on roof.",
    equipment: [
      { id: "eq1", name: "RTU-1 Carrier 48TC", model: "48TC-D16", serial: "2819A44301" },
    ],
  },
  {
    id: "v2",
    company: "Metro Grocery — Dundas",
    jobTitle: "Walk-in cooler repair",
    address: "789 Dundas St W, Toronto",
    status: "scheduled",
    scheduledTime: "10:30 AM",
    scheduledEnd: "12:00 PM",
    visitNumber: 1,
    timerRunning: false,
    jobType: "service",
    technicianId: "t1",
    notes: [],
    parts: [],
    description: "Walk-in cooler not maintaining temperature. Store manager reports temps rising above 5°C overnight. Check compressor, evaporator fan, and door gasket.",
    instructions: "Enter through receiving dock at rear. Walk-in is at back of store past the dairy section. Ask for Mike (store manager).",
    equipment: [
      { id: "eq2", name: "Walk-in Cooler Compressor", model: "Copeland ZB26", serial: "C41905773" },
    ],
  },
  {
    id: "v3",
    company: "Pita Land — Bloor",
    jobTitle: "AC unit not cooling — service call",
    address: "222 Bloor St W, Toronto",
    status: "scheduled",
    scheduledTime: "1:00 PM",
    scheduledEnd: "2:30 PM",
    visitNumber: 1,
    timerRunning: false,
    jobType: "urgent",
    technicianId: "t1",
    notes: [],
    parts: [],
    description: "AC unit blowing warm air. Customer reports issue started yesterday afternoon. Unit is a wall-mount split system in the dining area.",
    instructions: "Front entrance. Outdoor condenser unit is on the west side of the building behind the fence. Gate code: 4421.",
    equipment: [],
  },
  {
    id: "v4",
    company: "Tim Hortons — Queen",
    jobTitle: "Exhaust fan replacement",
    address: "100 Queen St E, Toronto",
    status: "scheduled",
    scheduledTime: "3:30 PM",
    scheduledEnd: "4:30 PM",
    visitNumber: 1,
    timerRunning: false,
    jobType: "install",
    technicianId: "t1",
    notes: [],
    parts: [],
    description: "Replace exhaust fan motor in kitchen hood. Old motor is seized. Replacement part was pre-ordered and should be in your van.",
    instructions: "Use staff entrance on the east side. Kitchen access — coordinate with shift supervisor.",
    equipment: [
      { id: "eq3", name: "Kitchen Exhaust Fan", model: "Dayton 4C661", serial: "EF-2024-0187" },
    ],
  },
];

/** Team visits for multi-tech schedule view (mock data for other technicians) */
export const TEAM_VISITS: MockVisit[] = [
  ...INITIAL_VISITS,
  {
    id: "tv1", company: "Starbucks — Bay St", jobTitle: "HVAC filter replacement",
    address: "100 Bay St, Toronto", status: "scheduled",
    scheduledTime: "8:30 AM", scheduledEnd: "10:00 AM",
    visitNumber: 1, timerRunning: false, jobType: "pm", technicianId: "t2",
    notes: [], parts: [], equipment: [], description: "Replace HVAC filters on 3 rooftop units.",
  },
  {
    id: "tv2", company: "Pizza Nova — Yonge", jobTitle: "Walk-in freezer alarm",
    address: "340 Yonge St, Toronto", status: "scheduled",
    scheduledTime: "11:00 AM", scheduledEnd: "1:00 PM",
    visitNumber: 1, timerRunning: false, jobType: "urgent", technicianId: "t2",
    notes: [], parts: [], equipment: [], description: "Freezer temperature alarm triggered overnight.",
  },
  {
    id: "tv3", company: "Shoppers Drug Mart — College", jobTitle: "PM — Pharmacy HVAC",
    address: "505 College St, Toronto", status: "scheduled",
    scheduledTime: "9:00 AM", scheduledEnd: "11:30 AM",
    visitNumber: 1, timerRunning: false, jobType: "pm", technicianId: "t3",
    notes: [], parts: [], equipment: [], description: "Semi-annual PM on pharmacy climate control.",
  },
  {
    id: "tv4", company: "Loblaws — Lakeshore", jobTitle: "Compressor replacement",
    address: "11 Lakeshore Blvd, Toronto", status: "scheduled",
    scheduledTime: "1:00 PM", scheduledEnd: "4:00 PM",
    visitNumber: 1, timerRunning: false, jobType: "install", technicianId: "t3",
    notes: [], parts: [], equipment: [], description: "Install new compressor unit for produce cooler.",
  },
  {
    id: "tv5", company: "Popeyes — Spadina", jobTitle: "Grease trap service",
    address: "280 Spadina Ave, Toronto", status: "scheduled",
    scheduledTime: "8:00 AM", scheduledEnd: "9:30 AM",
    visitNumber: 1, timerRunning: false, jobType: "service", technicianId: "t4",
    notes: [], parts: [], equipment: [], description: "Quarterly grease trap cleaning and inspection.",
  },
  {
    id: "tv6", company: "A&W — Ossington", jobTitle: "AC install — new unit",
    address: "72 Ossington Ave, Toronto", status: "scheduled",
    scheduledTime: "10:00 AM", scheduledEnd: "2:00 PM",
    visitNumber: 1, timerRunning: false, jobType: "install", technicianId: "t4",
    notes: [], parts: [], equipment: [], description: "New AC unit install for dining area expansion.",
  },
];
