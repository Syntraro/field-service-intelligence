import { Request, Response, NextFunction } from "express";
import { permissionRepository, clearPermissionCache } from "./storage/permissions";

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

    // Platform admins bypass permission checks
    if (user.role === "platform_admin") {
      return next();
    }

    const hasPermission = await userHasPermission(user.id, permissionKey);

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
