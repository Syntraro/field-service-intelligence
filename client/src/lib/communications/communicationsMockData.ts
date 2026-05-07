/**
 * Communications Hub — Phase 1 mock data.
 *
 * IMPORTANT: This file is the ONLY mock surface. Components consume the
 * shared types (`CommunicationThread`, `CommunicationMessage`, etc.) from
 * `@shared/communicationsTypes` so that when Phase 2 lands real fetching,
 * we replace this module with TanStack Query hooks WITHOUT touching any
 * presentational component.
 *
 * The mock deliberately includes:
 *   • client_sms threads, some assigned to specific technicians;
 *   • a team_chat thread (office-only);
 *   • an unknown-number thread for the inbound-from-stranger UX;
 *   • unread + read mixes;
 *   • a thread the technician "Solomon" can see (to validate the
 *     role-aware filter actually narrows the list).
 */

import type {
  CommunicationCall,
  CommunicationMessage,
  CommunicationThread,
  CommunicationTimelineEntry,
} from "@shared/communicationsTypes";

const TENANT = "tenant_mock";

/** Stable mock user ids — also used by the role-aware visibility tests. */
export const MOCK_USER_IDS = {
  techSolomon: "user_tech_solomon",
  techMikel: "user_tech_mikel",
  officeSarah: "user_office_sarah",
  officeNadeem: "user_office_nadeem",
} as const;

// ────────────────────────────────────────────────────────────────────
// Threads (left list)
// ────────────────────────────────────────────────────────────────────

export const MOCK_THREADS: CommunicationThread[] = [
  {
    id: "thr_jane",
    tenantId: TENANT,
    threadType: "client_sms",
    scope: "office",
    contact: {
      id: "contact_jane",
      displayName: "Jane Smith",
      phoneNumber: "+1 (416) 555-0142",
      email: "jane@cardsareus.com",
      address: "210 Yonge St, Toronto, ON M5B 1N8",
      type: "client",
      linkedClientId: "client_cards_are_us",
      linkedJobId: "job_1023",
      linkedJobTitle: "Walk-in cooler PM",
      linkedInvoiceId: "inv_10012",
      linkedInvoiceNumber: "INV-10012",
    },
    lastMessageAt: "2026-05-07T14:32:00Z",
    lastMessagePreview: "Hi, I wanted to confirm our appointment tomorrow at 10am.",
    unreadCount: 2,
    participantUserIds: [],
    assignedTechnicianIds: [],
  },
  {
    id: "thr_solomon_kelseys",
    tenantId: TENANT,
    threadType: "client_sms",
    scope: "tech_visible",
    contact: {
      id: "contact_kelseys",
      displayName: "Kelsey's (Aurora)",
      phoneNumber: "+1 (905) 555-0163",
      email: "manager@kelseys-aurora.com",
      type: "client",
      linkedClientId: "client_kelseys",
      linkedJobId: "job_108132",
      linkedJobTitle: "Middle line fridge not temping",
    },
    lastMessageAt: "2026-05-07T13:58:00Z",
    lastMessagePreview: "On my way, ETA 10 minutes.",
    unreadCount: 0,
    participantUserIds: [],
    assignedTechnicianIds: [MOCK_USER_IDS.techSolomon],
  },
  {
    id: "thr_mikel_freezer",
    tenantId: TENANT,
    threadType: "client_sms",
    scope: "tech_visible",
    contact: {
      id: "contact_1463385",
      displayName: "1463385 Ontario Inc",
      phoneNumber: "+1 (905) 555-0177",
      type: "client",
      linkedClientId: "client_1463385",
      linkedJobId: "job_1463385",
      linkedJobTitle: "Outdoor freezer",
    },
    lastMessageAt: "2026-05-07T13:42:00Z",
    lastMessagePreview: "Parts arrived — heading over now.",
    unreadCount: 1,
    participantUserIds: [],
    assignedTechnicianIds: [MOCK_USER_IDS.techMikel],
  },
  {
    id: "thr_team_workies",
    tenantId: TENANT,
    threadType: "team_chat",
    scope: "office",
    contact: {
      id: "contact_team_workies",
      displayName: "Workies Team",
      type: "team",
    },
    lastMessageAt: "2026-05-07T13:10:00Z",
    lastMessagePreview: "Sarah: dispatch board updated for tomorrow.",
    unreadCount: 0,
    participantUserIds: [
      MOCK_USER_IDS.officeSarah,
      MOCK_USER_IDS.officeNadeem,
    ],
    assignedTechnicianIds: [],
  },
  {
    id: "thr_unknown_callback",
    tenantId: TENANT,
    threadType: "unknown",
    scope: "office",
    contact: {
      id: "contact_unknown_8814",
      displayName: "+1 (647) 555-8814",
      phoneNumber: "+1 (647) 555-8814",
      type: "unknown",
    },
    lastMessageAt: "2026-05-07T12:05:00Z",
    lastMessagePreview: "Missed call",
    unreadCount: 1,
    participantUserIds: [],
    assignedTechnicianIds: [],
  },
  {
    id: "thr_michael",
    tenantId: TENANT,
    threadType: "client_sms",
    scope: "office",
    contact: {
      id: "contact_michael",
      displayName: "Michael Johnson",
      phoneNumber: "+1 (416) 555-0118",
      email: "michael@themanor.example",
      type: "client",
      linkedClientId: "client_the_manor",
      linkedQuoteId: "quote_10091",
      linkedQuoteNumber: "10091",
    },
    lastMessageAt: "2026-05-06T22:12:00Z",
    lastMessagePreview: "Thanks — we'll review the quote and get back to you.",
    unreadCount: 0,
    participantUserIds: [],
    assignedTechnicianIds: [],
  },
];

// ────────────────────────────────────────────────────────────────────
// Messages (per thread)
// ────────────────────────────────────────────────────────────────────

const MESSAGES_BY_THREAD: Record<string, CommunicationMessage[]> = {
  thr_jane: [
    {
      id: "msg_jane_1",
      threadId: "thr_jane",
      direction: "inbound",
      channel: "sms",
      body: "Hi, I wanted to confirm our appointment tomorrow at 10am.",
      status: "delivered",
      createdAt: "2026-05-07T14:32:00Z",
      fromNumber: "+1 (416) 555-0142",
    },
    {
      id: "msg_jane_2",
      threadId: "thr_jane",
      direction: "outbound",
      channel: "sms",
      body: "Yes, we are all set for tomorrow at 10am.",
      status: "sent",
      createdAt: "2026-05-07T14:34:00Z",
      senderUserId: MOCK_USER_IDS.officeSarah,
      senderDisplayName: "Sarah",
      toNumber: "+1 (416) 555-0142",
    },
    {
      id: "msg_jane_3",
      threadId: "thr_jane",
      direction: "inbound",
      channel: "sms",
      body: "Perfect, see you then. The walk-in cooler is making the noise again.",
      status: "delivered",
      createdAt: "2026-05-07T14:36:00Z",
    },
  ],
  thr_solomon_kelseys: [
    {
      id: "msg_sk_1",
      threadId: "thr_solomon_kelseys",
      direction: "inbound",
      channel: "sms",
      body: "Hey, the middle line fridge is reading 48F again.",
      status: "delivered",
      createdAt: "2026-05-07T13:55:00Z",
    },
    {
      id: "msg_sk_2",
      threadId: "thr_solomon_kelseys",
      direction: "outbound",
      channel: "sms",
      body: "On my way, ETA 10 minutes.",
      status: "delivered",
      createdAt: "2026-05-07T13:58:00Z",
      senderUserId: MOCK_USER_IDS.techSolomon,
      senderDisplayName: "Solomon",
    },
  ],
  thr_mikel_freezer: [
    {
      id: "msg_mf_1",
      threadId: "thr_mikel_freezer",
      direction: "outbound",
      channel: "sms",
      body: "Parts arrived — heading over now.",
      status: "delivered",
      createdAt: "2026-05-07T13:42:00Z",
      senderUserId: MOCK_USER_IDS.techMikel,
      senderDisplayName: "Mikel",
    },
  ],
  thr_team_workies: [
    {
      id: "msg_tw_1",
      threadId: "thr_team_workies",
      direction: "inbound",
      channel: "team_chat",
      body: "Dispatch board updated for tomorrow — please double-check the 8am visits.",
      status: "delivered",
      createdAt: "2026-05-07T13:10:00Z",
      senderUserId: MOCK_USER_IDS.officeSarah,
      senderDisplayName: "Sarah",
    },
  ],
  thr_unknown_callback: [
    {
      id: "msg_unk_1",
      threadId: "thr_unknown_callback",
      direction: "inbound",
      channel: "voicemail",
      body: "Missed call — no voicemail left.",
      status: "delivered",
      createdAt: "2026-05-07T12:05:00Z",
    },
  ],
  thr_michael: [
    {
      id: "msg_mj_1",
      threadId: "thr_michael",
      direction: "outbound",
      channel: "sms",
      body: "Quote #10091 attached — let me know if anything looks off.",
      status: "delivered",
      createdAt: "2026-05-06T21:55:00Z",
      senderUserId: MOCK_USER_IDS.officeNadeem,
      senderDisplayName: "Nadeem",
    },
    {
      id: "msg_mj_2",
      threadId: "thr_michael",
      direction: "inbound",
      channel: "sms",
      body: "Thanks — we'll review the quote and get back to you.",
      status: "delivered",
      createdAt: "2026-05-06T22:12:00Z",
    },
  ],
};

export function getMockMessagesForThread(threadId: string): CommunicationMessage[] {
  return MESSAGES_BY_THREAD[threadId] ?? [];
}

// ────────────────────────────────────────────────────────────────────
// Communication-history timeline (right Details panel)
// ────────────────────────────────────────────────────────────────────

const TIMELINE_BY_THREAD: Record<string, CommunicationTimelineEntry[]> = {
  thr_jane: [
    { id: "tl_jane_1", kind: "sms", label: "SMS · Jane Smith", detail: "10:36 AM", createdAt: "2026-05-07T14:36:00Z" },
    { id: "tl_jane_2", kind: "invoice_sent", label: "Invoice sent", detail: "INV-10012", createdAt: "2026-05-07T11:02:00Z" },
    { id: "tl_jane_3", kind: "call", label: "Call · 4 min", detail: "Sarah", createdAt: "2026-05-06T16:14:00Z" },
  ],
  thr_solomon_kelseys: [
    { id: "tl_sk_1", kind: "sms", label: "SMS", detail: "Solomon", createdAt: "2026-05-07T13:58:00Z" },
    { id: "tl_sk_2", kind: "missed_call", label: "Missed call", createdAt: "2026-05-07T11:22:00Z" },
  ],
  thr_mikel_freezer: [
    { id: "tl_mf_1", kind: "sms", label: "SMS", detail: "Mikel", createdAt: "2026-05-07T13:42:00Z" },
  ],
  thr_team_workies: [
    { id: "tl_tw_1", kind: "internal_note", label: "Team chat", detail: "Sarah", createdAt: "2026-05-07T13:10:00Z" },
  ],
  thr_unknown_callback: [
    { id: "tl_unk_1", kind: "missed_call", label: "Missed call", createdAt: "2026-05-07T12:05:00Z" },
  ],
  thr_michael: [
    { id: "tl_mj_1", kind: "sms", label: "SMS", detail: "Michael", createdAt: "2026-05-06T22:12:00Z" },
    { id: "tl_mj_2", kind: "quote_sent", label: "Quote sent", detail: "10091", createdAt: "2026-05-06T21:55:00Z" },
  ],
};

export function getMockTimelineForThread(threadId: string): CommunicationTimelineEntry[] {
  return TIMELINE_BY_THREAD[threadId] ?? [];
}

// ────────────────────────────────────────────────────────────────────
// Calls — used by the Call History module placeholder
// ────────────────────────────────────────────────────────────────────

export const MOCK_CALLS: CommunicationCall[] = [
  {
    id: "call_1",
    threadId: "thr_jane",
    direction: "outbound",
    fromNumber: "+1 (416) 555-0001",
    toNumber: "+1 (416) 555-0142",
    status: "completed",
    durationSeconds: 240,
    createdAt: "2026-05-06T16:14:00Z",
  },
  {
    id: "call_2",
    threadId: "thr_unknown_callback",
    direction: "inbound",
    fromNumber: "+1 (647) 555-8814",
    toNumber: "+1 (416) 555-0001",
    status: "missed",
    createdAt: "2026-05-07T12:05:00Z",
  },
];
