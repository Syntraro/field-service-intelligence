/**
 * Client-side mirrors of server isVisitActioned / isVisitEmpty
 * (server/storage/jobVisits.ts).
 *
 * Visit Reschedule Architecture: used by JobDetailPage to determine
 * whether a conflicting visit should be silently replaced (empty)
 * or requires user confirmation (actioned).
 */

const ACTIONED_STATUSES = [
  'dispatched',
  'en_route',
  'on_site',
  'in_progress',
  'on_hold',
  'completed',
];

export function isVisitActioned(visit: {
  checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null;
  actualDurationMinutes?: number | null;
  status: string;
}): boolean {
  if (visit.checkedInAt) return true;
  if (visit.checkedOutAt) return true;
  if (visit.actualDurationMinutes && visit.actualDurationMinutes > 0) return true;
  if (ACTIONED_STATUSES.includes(visit.status)) return true;
  return false;
}

/**
 * Inverse of isVisitActioned — returns true when a visit has no meaningful activity.
 * Empty visits can be silently replaced when scheduling a new visit for the same job.
 */
export function isVisitEmpty(visit: {
  checkedInAt?: Date | string | null;
  checkedOutAt?: Date | string | null;
  actualDurationMinutes?: number | null;
  status: string;
}): boolean {
  return !isVisitActioned(visit);
}
