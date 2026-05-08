/**
 * useResolveContact — TanStack Query hook over `/api/communications/resolve-contact`.
 *
 * Skips the network when the input is not matchable (sub-10-digit input,
 * empty, or null). Returns the canonical `ContactResolutionResult` shape
 * so the right Details panel can branch cleanly on `confidence`.
 */

import { useQuery } from "@tanstack/react-query";
import { isMatchableE164Like, normalizePhoneForMatch } from "@shared/phoneNormalization";
import type {
  ContactResolutionResult,
} from "@shared/communicationsTypes";

export const RESOLVE_CONTACT_QUERY_KEY = "/api/communications/resolve-contact" as const;

export function useResolveContact(phone: string | null | undefined) {
  const matchable = isMatchableE164Like(phone);
  const key = normalizePhoneForMatch(phone);

  return useQuery<ContactResolutionResult>({
    queryKey: [RESOLVE_CONTACT_QUERY_KEY, key],
    enabled: matchable,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/communications/resolve-contact?phone=${encodeURIComponent(phone ?? "")}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to resolve contact (${res.status})`);
      return res.json();
    },
  });
}
