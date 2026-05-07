/**
 * Communications Hub — role-aware access rules.
 *
 * Single source of truth for:
 *   • Which modules in the far-right rail a viewer's role can see.
 *   • Whether a viewer can read a given thread.
 *
 * Phase 1 ships with mock data; the SAME rules are intended to drive
 * Phase 2's server-side WHERE filter so we don't accidentally leak
 * threads that were hidden in the UI. Keeping this in `shared/` lets
 * both surfaces import the same predicate.
 *
 * Role taxonomy
 * -------------
 *   • OFFICE_ROLES = owner | admin | manager | dispatcher  → full access
 *   • technician                                            → restricted
 *   • anything else                                         → restricted
 *
 * Rule design
 * -----------
 *   • Technicians do NOT see Team Chat or office/tenant_global threads.
 *   • Technicians DO see threads they participate in OR are assigned to.
 *   • Office roles see every thread.
 *   • An undefined role is treated as restricted (fail closed).
 */

import type {
  CommunicationModule,
  CommunicationThreadScope,
  CommunicationThreadType,
} from "./communicationsTypes";
import { COMMUNICATION_MODULES } from "./communicationsTypes";

// ────────────────────────────────────────────────────────────────────
// Role helpers
// ────────────────────────────────────────────────────────────────────

const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"] as const;
type OfficeRole = (typeof OFFICE_ROLES)[number];

export function isOfficeRole(role: string | null | undefined): role is OfficeRole {
  return typeof role === "string" && (OFFICE_ROLES as readonly string[]).includes(role);
}

export function isTechnicianRole(role: string | null | undefined): boolean {
  return role === "technician";
}

// ────────────────────────────────────────────────────────────────────
// Module visibility — drives the far-right rail
// ────────────────────────────────────────────────────────────────────

/**
 * Modules a technician CANNOT see in Phase 1. Team Chat is excluded by
 * spec ("Technicians should NOT see Team Chat in the far-right rail yet"),
 * everything else stays available so a tech can still see their own
 * inbox / call history / contacts / settings.
 */
const MODULES_HIDDEN_FROM_TECHNICIAN: readonly CommunicationModule[] = [
  "team_chat",
];

export function getVisibleCommunicationsModules(
  role: string | null | undefined,
): CommunicationModule[] {
  if (isOfficeRole(role)) {
    return [...COMMUNICATION_MODULES];
  }
  if (isTechnicianRole(role)) {
    return COMMUNICATION_MODULES.filter(
      (m) => !MODULES_HIDDEN_FROM_TECHNICIAN.includes(m),
    );
  }
  // Unknown role — treat as restricted, mirror technician.
  return COMMUNICATION_MODULES.filter(
    (m) => !MODULES_HIDDEN_FROM_TECHNICIAN.includes(m),
  );
}

export function isModuleVisibleForRole(
  module: CommunicationModule,
  role: string | null | undefined,
): boolean {
  return getVisibleCommunicationsModules(role).includes(module);
}

// ────────────────────────────────────────────────────────────────────
// Thread visibility — same predicate Phase 1 mock filter + Phase 2 SQL use
// ────────────────────────────────────────────────────────────────────

export interface ThreadAccessViewer {
  /** Logged-in user id (used for tech "is participant / assigned" checks). */
  userId: string | null;
  role: string | null | undefined;
}

/**
 * Minimal subset of `CommunicationThread` fields needed to decide visibility.
 * Phase 2's storage layer projects these from a SQL row; Phase 1 uses the
 * mock data shape directly.
 */
export interface ThreadAccessTarget {
  threadType: CommunicationThreadType;
  scope: CommunicationThreadScope;
  participantUserIds: readonly string[];
  assignedTechnicianIds: readonly string[];
}

export function canViewThread(
  viewer: ThreadAccessViewer,
  thread: ThreadAccessTarget,
): boolean {
  if (isOfficeRole(viewer.role)) return true;
  if (!isTechnicianRole(viewer.role)) return false;

  // Technician path — no team chat, no office/tenant_global threads.
  if (thread.threadType === "team_chat") return false;
  if (thread.scope === "office" || thread.scope === "tenant_global") return false;

  if (!viewer.userId) return false;
  return (
    thread.participantUserIds.includes(viewer.userId) ||
    thread.assignedTechnicianIds.includes(viewer.userId)
  );
}

export function filterThreadsForViewer<T extends ThreadAccessTarget>(
  viewer: ThreadAccessViewer,
  threads: readonly T[],
): T[] {
  return threads.filter((t) => canViewThread(viewer, t));
}
