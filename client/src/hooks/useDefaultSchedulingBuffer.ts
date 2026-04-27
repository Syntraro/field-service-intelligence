/**
 * Tenant default scheduling buffer (minutes).
 *
 * Applied at the duration → scheduledEnd boundary in every NEW job/visit
 * create flow. Read-only client mirror of `company_settings.default_scheduling_buffer_minutes`
 * — the same `/api/company-settings` cache the rest of Settings reads.
 *
 * Returns 0 while the query is loading, so callers can unconditionally
 * `start + (workMins + buffer) * 60_000` without a null branch.
 */
import { useQuery } from "@tanstack/react-query";

interface CompanySettingsResponse {
  defaultSchedulingBufferMinutes?: number;
  [key: string]: unknown;
}

export function useDefaultSchedulingBuffer(): number {
  const { data } = useQuery<CompanySettingsResponse>({
    queryKey: ["/api/company-settings"],
    staleTime: 5 * 60 * 1000,
  });
  const raw = data?.defaultSchedulingBufferMinutes;
  return typeof raw === "number" && raw >= 0 ? raw : 0;
}

/**
 * Shared "Scheduled block: 75m (60m work + 15m buffer)" hint.
 * Returns null when buffer is 0 or work is non-positive — callers can
 * `{summary && <p>…</p>}` without a separate visibility check.
 */
export function formatScheduledBlockSummary(
  workMinutes: number,
  bufferMinutes: number,
): string | null {
  const work = Math.max(0, Math.round(workMinutes));
  const buffer = Math.max(0, Math.round(bufferMinutes));
  if (buffer === 0 || work <= 0) return null;
  return `Scheduled block: ${work + buffer}m (${work}m work + ${buffer}m buffer)`;
}
