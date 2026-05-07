/**
 * Communications Hub — URL state hook.
 *
 * The hub keeps three pieces of state in the URL so navigation and
 * browser back/forward survive reloads + deep links from elsewhere
 * (e.g. a "view conversation" link from a future job-detail card):
 *
 *   /communications?module=inbox&conversation=xyz
 *
 * Module defaults to `inbox`. Conversation defaults to undefined.
 * Updates use shallow `setLocation(..., { replace: true })` so the
 * conversation switch doesn't push a new entry per click — back-button
 * still leaves the hub in a single jump.
 *
 * Mirrors the URL-state pattern used in `pages/TeamHubPage.tsx`.
 */

import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import {
  isCommunicationModule,
  type CommunicationModule,
} from "@shared/communicationsTypes";

const DEFAULT_MODULE: CommunicationModule = "inbox";

export interface CommunicationsUrlState {
  module: CommunicationModule;
  conversationId: string | null;
  setModule: (module: CommunicationModule) => void;
  setConversationId: (conversationId: string | null) => void;
  /** Atomic update — useful when changing module + selecting a conv together. */
  patch: (next: { module?: CommunicationModule; conversationId?: string | null }) => void;
}

export function useCommunicationsUrlState(): CommunicationsUrlState {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const params = useMemo(() => new URLSearchParams(search), [search]);

  const module: CommunicationModule = useMemo(() => {
    const raw = params.get("module");
    return raw && isCommunicationModule(raw) ? raw : DEFAULT_MODULE;
  }, [params]);

  const conversationId = useMemo(() => {
    const raw = params.get("conversation");
    return raw && raw.length > 0 ? raw : null;
  }, [params]);

  const writeUrl = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      setLocation(`/communications${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [setLocation],
  );

  const setModule = useCallback(
    (nextModule: CommunicationModule) => {
      const next = new URLSearchParams(params);
      if (nextModule === DEFAULT_MODULE) next.delete("module");
      else next.set("module", nextModule);
      // Switching module clears any conversation that belonged to the old one.
      next.delete("conversation");
      writeUrl(next);
    },
    [params, writeUrl],
  );

  const setConversationId = useCallback(
    (nextId: string | null) => {
      const next = new URLSearchParams(params);
      if (nextId) next.set("conversation", nextId);
      else next.delete("conversation");
      writeUrl(next);
    },
    [params, writeUrl],
  );

  const patch = useCallback(
    (input: { module?: CommunicationModule; conversationId?: string | null }) => {
      const next = new URLSearchParams(params);
      if (input.module !== undefined) {
        if (input.module === DEFAULT_MODULE) next.delete("module");
        else next.set("module", input.module);
      }
      if (input.conversationId !== undefined) {
        if (input.conversationId) next.set("conversation", input.conversationId);
        else next.delete("conversation");
      }
      writeUrl(next);
    },
    [params, writeUrl],
  );

  return { module, conversationId, setModule, setConversationId, patch };
}
