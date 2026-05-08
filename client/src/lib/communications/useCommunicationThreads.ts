/**
 * Communications Hub — Phase 3 API-backed query hooks.
 *
 * Replaces the Phase 1 `MOCK_THREADS` / `getMockMessagesForThread` /
 * `getMockTimelineForThread` synchronous reads with TanStack Query
 * fetches against the new `/api/communications/threads*` endpoints.
 *
 * The shapes returned match `shared/communicationsTypes.ts` exactly —
 * the server projects DB rows into the canonical `CommunicationThread`
 * / `CommunicationMessage` / `CommunicationCall` shape so the existing
 * presentational components are untouched.
 *
 * Visibility is enforced server-side first (same `canViewThread`
 * predicate the Phase 1 mock filter ran). The page layer still applies
 * `filterThreadsForViewer` over the result as defense-in-depth.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RESOLVE_CONTACT_QUERY_KEY } from "./useResolveContact";
import type {
  CommunicationCall,
  CommunicationMessage,
  CommunicationThread,
  ContactDetail,
  ContactDetailKind,
} from "@shared/communicationsTypes";

interface ListEnvelope<T> {
  items: T[];
}

export const COMMUNICATION_THREADS_KEY = ["/api/communications/threads"] as const;
export const COMMUNICATION_THREAD_KEY_BASE = ["/api/communications/threads/:id"] as const;
export const COMMUNICATION_MESSAGES_KEY_BASE = [
  "/api/communications/threads/:id/messages",
] as const;
export const COMMUNICATION_CALLS_KEY = ["/api/communications/calls"] as const;

export function useCommunicationThreads(opts: { enabled?: boolean } = {}) {
  return useQuery<CommunicationThread[]>({
    queryKey: [...COMMUNICATION_THREADS_KEY],
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/communications/threads", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
      const json = (await res.json()) as ListEnvelope<CommunicationThread>;
      return json.items;
    },
  });
}

export function useCommunicationMessages(threadId: string | null) {
  return useQuery<CommunicationMessage[]>({
    queryKey: [...COMMUNICATION_MESSAGES_KEY_BASE, threadId],
    enabled: !!threadId,
    staleTime: 15_000,
    queryFn: async () => {
      if (!threadId) return [];
      const res = await fetch(
        `/api/communications/threads/${encodeURIComponent(threadId)}/messages`,
        { credentials: "include" },
      );
      if (res.status === 404) {
        // Forbidden / missing thread — surface as empty rather than as an
        // error banner; the page already shows an empty-state copy when
        // a thread is selected with zero messages.
        return [];
      }
      if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
      const json = (await res.json()) as ListEnvelope<CommunicationMessage>;
      return json.items;
    },
  });
}

export function useCommunicationCalls(opts: { enabled?: boolean } = {}) {
  return useQuery<CommunicationCall[]>({
    queryKey: [...COMMUNICATION_CALLS_KEY],
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/communications/calls", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load calls (${res.status})`);
      const json = (await res.json()) as ListEnvelope<CommunicationCall>;
      return json.items;
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Phase 4 mutations
// ────────────────────────────────────────────────────────────────────

/**
 * Compose an internal note. Invalidates the thread list (preview/order)
 * and the active thread's message stream so the new bubble appears
 * without a manual refetch.
 */
export function useCreateInternalMessage() {
  const queryClient = useQueryClient();
  return useMutation<CommunicationMessage, Error, { threadId: string; body: string }>({
    mutationFn: async ({ threadId, body }) => {
      return apiRequest<CommunicationMessage>(
        `/api/communications/threads/${encodeURIComponent(threadId)}/messages/internal`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
    },
    onSuccess: (_msg, vars) => {
      queryClient.invalidateQueries({ queryKey: [...COMMUNICATION_THREADS_KEY] });
      queryClient.invalidateQueries({
        queryKey: [...COMMUNICATION_MESSAGES_KEY_BASE, vars.threadId],
      });
    },
  });
}

/**
 * 2026-05-08 Phase 5 — outbound SMS send. Provider-neutral; the route
 * resolves the tenant's active provider and adapter under the hood.
 */
export function useSendSmsMessage() {
  const queryClient = useQueryClient();
  return useMutation<
    {
      messageId: string;
      threadId: string;
      providerMessageId: string;
      status: "queued" | "sent" | "delivered" | "failed" | "undelivered";
    },
    Error,
    { threadId: string; body: string }
  >({
    mutationFn: async ({ threadId, body }) => {
      return apiRequest(
        `/api/communications/threads/${encodeURIComponent(threadId)}/messages/sms`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
    },
    onSuccess: (_msg, vars) => {
      queryClient.invalidateQueries({ queryKey: [...COMMUNICATION_THREADS_KEY] });
      queryClient.invalidateQueries({
        queryKey: [...COMMUNICATION_MESSAGES_KEY_BASE, vars.threadId],
      });
    },
  });
}

/**
 * Mark a thread read. Idempotent on the server (no-op when unread is 0).
 * Returns the updated thread DTO for optimistic-cache patches.
 */
export function useMarkCommunicationThreadRead() {
  const queryClient = useQueryClient();
  return useMutation<CommunicationThread, Error, string>({
    mutationFn: async (threadId) => {
      return apiRequest<CommunicationThread>(
        `/api/communications/threads/${encodeURIComponent(threadId)}/read`,
        { method: "POST", body: "{}" },
      );
    },
    onSuccess: () => {
      // The list query owns the unread snapshot; messages don't change.
      queryClient.invalidateQueries({ queryKey: [...COMMUNICATION_THREADS_KEY] });
    },
  });
}

export type LinkContactTargetKind =
  | "contact_person"
  | "customer_company"
  | "client_location"
  | "team_user";

/**
 * Link a thread to a canonical contact target. Invalidates the thread
 * list, the active thread's messages (subtitle / display name reflow),
 * AND the contact-resolution cache (the right panel re-resolves with
 * the new linkage).
 */
export function useLinkCommunicationThreadContact() {
  const queryClient = useQueryClient();
  return useMutation<
    CommunicationThread,
    Error,
    { threadId: string; target: { kind: LinkContactTargetKind; id: string } }
  >({
    mutationFn: async ({ threadId, target }) => {
      return apiRequest<CommunicationThread>(
        `/api/communications/threads/${encodeURIComponent(threadId)}/link-contact`,
        { method: "POST", body: JSON.stringify({ target }) },
      );
    },
    onSuccess: (_thread, vars) => {
      queryClient.invalidateQueries({ queryKey: [...COMMUNICATION_THREADS_KEY] });
      queryClient.invalidateQueries({
        queryKey: [...COMMUNICATION_MESSAGES_KEY_BASE, vars.threadId],
      });
      // Resolve-contact cache is keyed by the normalized phone — bust
      // every entry by invalidating the prefix.
      queryClient.invalidateQueries({ queryKey: [RESOLVE_CONTACT_QUERY_KEY] });
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Contact-candidate name search (unknown-mode link picker)
// ────────────────────────────────────────────────────────────────────

export interface ContactCandidate {
  kind: LinkContactTargetKind;
  id: string;
  displayName: string;
  subline?: string;
  phone?: string | null;
  email?: string | null;
}

export const CONTACT_CANDIDATES_KEY = ["/api/communications/contact-candidates"] as const;

export function useContactCandidates(query: string) {
  const trimmed = query.trim();
  return useQuery<ContactCandidate[]>({
    queryKey: [...CONTACT_CANDIDATES_KEY, trimmed],
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/communications/contact-candidates?query=${encodeURIComponent(trimmed)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load candidates (${res.status})`);
      const json = (await res.json()) as ListEnvelope<ContactCandidate>;
      return json.items;
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Phase 4B — Contacts + Team Chat module lists
// ────────────────────────────────────────────────────────────────────

export const SYSTEM_CONTACTS_KEY = ["/api/communications/contacts"] as const;
export const TEAM_MEMBERS_KEY = ["/api/communications/team-members"] as const;

export function useSystemContacts(opts: { enabled?: boolean } = {}) {
  return useQuery<ContactCandidate[]>({
    queryKey: [...SYSTEM_CONTACTS_KEY],
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/communications/contacts", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load contacts (${res.status})`);
      const json = (await res.json()) as ListEnvelope<ContactCandidate>;
      return json.items;
    },
  });
}

export interface CommunicationsTeamMember {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
}

export function useTeamMembers(opts: { enabled?: boolean } = {}) {
  return useQuery<CommunicationsTeamMember[]>({
    queryKey: [...TEAM_MEMBERS_KEY],
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/communications/team-members", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load team members (${res.status})`);
      const json = (await res.json()) as ListEnvelope<CommunicationsTeamMember>;
      return json.items;
    },
  });
}

// ────────────────────────────────────────────────────────────────────
// Phase 4E — rich contact detail for the right panel
// ────────────────────────────────────────────────────────────────────

export const CONTACT_DETAIL_KEY_BASE = ["/api/communications/contacts/detail"] as const;

export function useContactDetail(
  selection: { kind: ContactDetailKind; id: string } | null,
) {
  return useQuery<ContactDetail>({
    queryKey: [
      ...CONTACT_DETAIL_KEY_BASE,
      selection?.kind ?? null,
      selection?.id ?? null,
    ],
    enabled: !!selection,
    staleTime: 30_000,
    queryFn: async () => {
      if (!selection) throw new Error("no selection");
      const res = await fetch(
        `/api/communications/contacts/${encodeURIComponent(selection.kind)}/${encodeURIComponent(selection.id)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load contact (${res.status})`);
      return res.json();
    },
  });
}
