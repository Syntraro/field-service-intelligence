/**
 * Route Helper Wrappers for RBAC
 * 
 * These helpers ensure RBAC is baked into route definitions,
 * preventing future developers from accidentally adding unprotected write routes.
 * 
 * Usage:
 *   import { managerWrite, restrictedWrite, techWrite, adminWrite } from "../auth/routeHelpers";
 *   
 *   // Instead of: router.post("/", requireRole(MANAGER_ROLES), async (req, res) => {...})
 *   // Use:        managerWrite(router, "post", "/", async (req, res) => {...})
 */

import { Router, Request, Response, NextFunction, RequestHandler } from "express";
import { requireRole } from "./requireRole";
import { MANAGER_ROLES, RESTRICTED_MANAGER_ROLES, ADMIN_ROLES, TECH_ROLES, RoleGroup } from "./roles";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type RouteHandler = (req: Request, res: Response, next?: NextFunction) => any;

/**
 * Creates a protected route with the specified role group
 */
function protectedRoute(
  router: Router,
  method: HttpMethod,
  path: string,
  roles: RoleGroup,
  ...handlers: RouteHandler[]
): void {
  const roleMiddleware = requireRole(roles as unknown as string[]);
  (router as any)[method](path, roleMiddleware, ...handlers);
}

/**
 * Manager-level write access (owner, admin, manager, dispatcher)
 * Use for: most CRUD operations, job management, client management
 */
export function managerWrite(
  router: Router,
  method: HttpMethod,
  path: string,
  ...handlers: RouteHandler[]
): void {
  protectedRoute(router, method, path, MANAGER_ROLES, ...handlers);
}

/**
 * Restricted manager access (owner, admin, manager) - excludes dispatcher
 * Use for: team management, company settings, technician creation
 */
export function restrictedWrite(
  router: Router,
  method: HttpMethod,
  path: string,
  ...handlers: RouteHandler[]
): void {
  protectedRoute(router, method, path, RESTRICTED_MANAGER_ROLES, ...handlers);
}

/**
 * Admin-only access (owner, admin)
 * Use for: role changes, user management, dangerous operations
 */
export function adminWrite(
  router: Router,
  method: HttpMethod,
  path: string,
  ...handlers: RouteHandler[]
): void {
  protectedRoute(router, method, path, ADMIN_ROLES, ...handlers);
}

/**
 * Tech-level access (all roles including technician)
 * Use for: task check-in/out, job completion, field work
 */
export function techWrite(
  router: Router,
  method: HttpMethod,
  path: string,
  ...handlers: RouteHandler[]
): void {
  protectedRoute(router, method, path, TECH_ROLES, ...handlers);
}

/**
 * Custom role group access
 * Use when none of the predefined groups fit
 */
export function roleWrite(
  router: Router,
  method: HttpMethod,
  path: string,
  roles: RoleGroup,
  ...handlers: RouteHandler[]
): void {
  protectedRoute(router, method, path, roles, ...handlers);
}
