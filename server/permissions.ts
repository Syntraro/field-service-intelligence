import { Request, Response, NextFunction } from "express";
import { permissionRepository, clearPermissionCache } from "./storage/permissions";
// 2026-05-04 Phase 7: removed `isPlatformRole` import. The
// platform-role bypass below was structurally impossible after the
// Phase 6 DB CHECK constraint on `users.role` — `req.user.role`
// (and during impersonation, the impersonated tenant user's role)
// is always a tenant role.

// Re-export cache clearing function
export { clearPermissionCache };

// Get effective permissions for a user
export async function getUserEffectivePermissions(userId: string): Promise<Set<string>> {
  return permissionRepository.getUserEffectivePermissions(userId);
}

// Check if user has a specific permission
export async function userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
  return permissionRepository.userHasPermission(userId, permissionKey);
}

// Express middleware to require a permission
export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;

    if (!user) {
      return res.status(401).json({
        error: "Authentication required",
        message: "You must be logged in to access this resource"
      });
    }

    // 2026-05-04 Phase 7: removed the `isPlatformRole(user.role)`
    // bypass. After the DB constraint on `users.role`, `req.user.role`
    // can never be a platform string. During impersonation, `req.user`
    // is the impersonated tenant user (also a tenant role). The
    // bypass was dead code.
    //
    // 2026-05-04 Phase 2 PR 3 hotfix: wrap the resolver call so a
    // genuine RBAC misconfiguration (resolver throws) returns a
    // structured 500 with the failing user / permission instead of
    // becoming an unhandled promise rejection. Express 4 does NOT
    // auto-route async middleware throws to the error handler; an
    // uncaught throw here becomes a hung request from the client's
    // perspective. The runtime fallback in
    // `getUserEffectivePermissions` resolves the common
    // NULL-role_id case, so this catch is the last-resort net for
    // the (rare) case where role doesn't match any seeded row.
    let hasPermission: boolean;
    try {
      hasPermission = await userHasPermission(user.id, permissionKey);
    } catch (err: any) {
      console.error(
        `[requirePermission] resolver error for user=${user.id} permission=${permissionKey}: ${err?.message ?? err}`,
      );
      return res.status(500).json({
        error: "Permission resolution failed",
        message:
          "Your account is missing role assignment. Please contact your administrator.",
        requiredPermission: permissionKey,
      });
    }

    if (!hasPermission) {
      return res.status(403).json({
        error: "Permission denied",
        message: `You do not have the required permission: ${permissionKey}`,
        requiredPermission: permissionKey
      });
    }

    next();
  };
}

// Get all roles with their permissions (for UI display)
export async function getRolesWithPermissions() {
  return permissionRepository.getRolesWithPermissions();
}

// Get all permissions grouped by group
export async function getPermissionsGrouped() {
  return permissionRepository.getPermissionsGrouped();
}

// Permission pack definitions (for quick toggles in UI)
export const PERMISSION_PACKS = {
  pricing: {
    label: "Pricing Access",
    description: "View and edit pricing, see profitability",
    permissions: ["pricing.view", "pricing.edit", "profitability.view"]
  },
  quotes_invoices: {
    label: "Quotes & Invoices",
    description: "Create quotes and invoices, record payments",
    permissions: ["quotes.create", "quotes.approve", "invoices.create", "invoices.record_payment"]
  },
  time_timesheets: {
    label: "Time & Timesheets",
    description: "Track and approve time entries",
    permissions: ["timesheets.track_own", "timesheets.approve_team"]
  },
  reports: {
    label: "Reports & Analytics",
    description: "View operational and financial reports",
    permissions: ["reports.view_basic", "reports.view_financial"]
  },
  admin: {
    label: "User & Settings Management",
    description: "Manage team members and company settings",
    permissions: ["users.manage", "settings.manage"]
  }
};
