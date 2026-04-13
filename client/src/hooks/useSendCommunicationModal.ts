/**
 * useSendCommunicationModal (Phase 12, 2026-04-12).
 *
 * Hook that powers the shared Send modal used by Invoice / Quote / Job.
 * Responsibilities:
 *   - fetch default recipients from the backend (once, on open)
 *   - fetch rendered preview from the backend (once, on open)
 *   - hold editable form state (recipients / subject / body)
 *   - submit the send request with overrides
 *   - expose loading / sending / error state to the component
 *
 * NO frontend rendering. The preview endpoint is the single source of
 * truth for the initial subject/body values.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type CommunicationEntityType = "invoice" | "quote" | "job";

interface EntityEndpoints {
  recipientsPath: string;
  previewPath: string;
  sendPath: string;
}

/** 2026-04-12: invoice / quote / job each have their own URL family. */
function resolveEndpoints(entityType: CommunicationEntityType, entityId: string): EntityEndpoints {
  switch (entityType) {
    case "invoice":
      return {
        recipientsPath: `/api/invoices/${entityId}/email-recipients`,
        previewPath:    `/api/invoices/${entityId}/render-email`,
        sendPath:       `/api/invoices/${entityId}/send`,
      };
    case "quote":
      return {
        recipientsPath: `/api/quotes/${entityId}/email-recipients`,
        previewPath:    `/api/quotes/${entityId}/render-email`,
        sendPath:       `/api/quotes/${entityId}/send`,
      };
    case "job":
      return {
        recipientsPath: `/api/jobs/${entityId}/email-recipients`,
        previewPath:    `/api/jobs/${entityId}/render-email`,
        sendPath:       `/api/jobs/${entityId}/email`,
      };
  }
}

interface LoadedPreview {
  subject: string;
  body: string;
}

interface LoadedDefaults {
  recipients: string[];
}

export interface UseSendCommunicationModalOptions {
  entityType: CommunicationEntityType;
  entityId: string;
  isOpen: boolean;
  onSuccess?: () => void;
}

export interface UseSendCommunicationModalResult {
  // State
  recipients: string[];
  subject: string;
  body: string;
  loading: boolean;
  sending: boolean;
  error: string | null;

  // Mutators
  setRecipients: (next: string[]) => void;
  setSubject: (next: string) => void;
  setBody: (next: string) => void;
  addRecipient: (email: string) => void;
  removeRecipient: (email: string) => void;

  // Actions
  send: () => Promise<{ success: boolean }>;

  // Meta for the success-payload consumer.
  lastDispatch: { emailId: string | null; deliveryId?: string | null } | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of list) {
    const norm = normalizeEmail(email);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export function useSendCommunicationModal(
  options: UseSendCommunicationModalOptions,
): UseSendCommunicationModalResult {
  const { entityType, entityId, isOpen, onSuccess } = options;
  const endpoints = resolveEndpoints(entityType, entityId);

  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDispatch, setLastDispatch] =
    useState<UseSendCommunicationModalResult["lastDispatch"]>(null);

  // Track whether we've already loaded for this (entityId, open) pairing
  // so the fetch doesn't re-run while the modal is open.
  const loadedForRef = useRef<string | null>(null);

  // Reset state whenever the modal transitions closed → we want a clean
  // slate next time it opens, but we keep state while it's OPEN so the user
  // doesn't lose edits on transient re-renders.
  useEffect(() => {
    if (!isOpen) {
      loadedForRef.current = null;
      setError(null);
      // Intentionally do NOT reset recipients/subject/body here — the parent
      // unmounts the modal on close; the next mount will refetch.
    }
  }, [isOpen]);

  // Load recipients + preview when modal opens for a new entity.
  useEffect(() => {
    if (!isOpen) return;
    const key = `${entityType}:${entityId}`;
    if (loadedForRef.current === key) return;
    loadedForRef.current = key;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [defaults, preview] = await Promise.all([
          apiRequest<LoadedDefaults>(endpoints.recipientsPath),
          apiRequest<LoadedPreview>(endpoints.previewPath, {
            method: "POST",
            body: JSON.stringify({}),
          }),
        ]);
        if (cancelled) return;
        setRecipients(dedupe(defaults.recipients ?? []));
        setSubject(preview.subject ?? "");
        setBody(preview.body ?? "");
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.message ?? "Unable to load email preview";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, entityType, entityId, endpoints.recipientsPath, endpoints.previewPath]);

  const addRecipient = useCallback((email: string) => {
    const norm = normalizeEmail(email);
    if (!norm) return;
    setRecipients((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
  }, []);

  const removeRecipient = useCallback((email: string) => {
    setRecipients((prev) => prev.filter((e) => e !== email));
  }, []);

  const sendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<{
        dispatch?: { emailId?: string | null };
      }>(endpoints.sendPath, {
        method: "POST",
        body: JSON.stringify({
          recipients,
          subjectOverride: subject,
          bodyOverride: body,
        }),
      });
    },
  });

  const send = useCallback(async () => {
    setError(null);

    // Client-side guards — backend double-checks.
    if (recipients.length === 0) {
      setError("Add at least one recipient.");
      return { success: false };
    }
    if (!subject.trim()) {
      setError("Subject cannot be empty.");
      return { success: false };
    }
    if (!body.trim()) {
      setError("Message cannot be empty.");
      return { success: false };
    }

    try {
      const resp = await sendMutation.mutateAsync();
      setLastDispatch({ emailId: resp?.dispatch?.emailId ?? null });
      onSuccess?.();
      return { success: true };
    } catch (err: any) {
      // Rate limit → stable message, preserve user input.
      if (err?.status === 429 || /429|rate limit/i.test(String(err?.message))) {
        setError("Too many sends. Please try again shortly.");
      } else {
        setError(err?.message ?? "Failed to send email.");
      }
      return { success: false };
    }
  }, [recipients, subject, body, sendMutation, onSuccess]);

  return {
    recipients,
    subject,
    body,
    loading,
    sending: sendMutation.isPending,
    error,
    setRecipients,
    setSubject,
    setBody,
    addRecipient,
    removeRecipient,
    send,
    lastDispatch,
  };
}
