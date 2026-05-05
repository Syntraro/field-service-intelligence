// 2026-04-20 Phase 2 Team Hub: shared type shapes.
// Mirrors server/routes/team.ts response structures; keep in sync if they drift.

export interface TeamMemberRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  phone: string | null;
  role: string;
  roleId: string | null;
  status: string;
  disabled?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// GET /api/team/technicians projection (server/routes/team.ts:273-282).
export interface TeamTechnicianRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleId: string | null;
  isSchedulable: boolean;
  color: string | null;
  laborCostPerHour: string | null;
}

export interface TeamMemberDetail extends TeamMemberRow {
  useCustomSchedule: boolean;
  isSchedulable: boolean;
  profile: {
    id: string;
    userId: string;
    laborCostPerHour: string | null;
    billableRatePerHour: string | null;
    color: string | null;
    phone: string | null;
    note: string | null;
  } | null;
  workingHours: Array<{
    id: string;
    userId: string;
    dayOfWeek: number;
    startTime: string | null;
    endTime: string | null;
    isWorking: boolean;
  }>;
  permissionOverrides: Array<{
    id: string;
    userId: string;
    permissionId: string;
    override: string;
  }>;
}

export interface Role {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  hierarchy: number;
  memberCount?: number;
  // 2026-05-04 PR 2: surfaces backend `roles.is_system_role`. The
  // server already includes this in `GET /api/roles`; the type was
  // missing it. UI uses this for the lock badge + clone-CTA branch.
  isSystemRole?: boolean;
}

export interface Permission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}
