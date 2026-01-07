import { teamRepository } from "../storage/team";
import { createError } from "../middleware/errorHandler";

/**
 * Ensures that a company always has at least one active owner
 * Prevents deactivation or demotion of the last active owner
 *
 * @param companyId - The company ID
 * @param targetUserId - The user being modified
 * @param action - The action being performed ('deactivate' or 'demote')
 * @throws Error with status 400 if last owner protection is violated
 */
export const assertLastOwnerProtection = async (
  companyId: string,
  targetUserId: string,
  action: "deactivate" | "demote"
): Promise<void> => {
  const allMembers = await teamRepository.getTeamMembers(companyId);
  const activeOwners = allMembers.filter(
    (m) => m.role === "owner" && m.status === "active"
  );

  if (activeOwners.length <= 1) {
    const actionMessage =
      action === "deactivate"
        ? "Cannot deactivate the last active owner. Promote another user to owner first."
        : "Cannot demote the last active owner. Promote another user to owner first.";

    throw createError(400, actionMessage);
  }
};

/**
 * Checks if a specific user is the last active owner in their company
 *
 * @param companyId - The company ID
 * @param userId - The user ID to check
 * @returns true if the user is the last active owner, false otherwise
 */
export const isLastActiveOwner = async (
  companyId: string,
  userId: string
): Promise<boolean> => {
  const allMembers = await teamRepository.getTeamMembers(companyId);
  const activeOwners = allMembers.filter(
    (m) => m.role === "owner" && m.status === "active"
  );

  return activeOwners.length === 1 && activeOwners[0].id === userId;
};

/**
 * Asserts that an action can be performed on a team member
 * Combines multiple checks: existence, ownership, and last-owner protection
 *
 * @param companyId - The company ID
 * @param userId - The user being modified
 * @param currentRole - The current role of the user (if known)
 * @param newRole - The new role (for role change operations, optional)
 * @throws Error if the operation violates business rules
 */
export const assertTeamMemberActionValid = async (
  companyId: string,
  userId: string,
  options: {
    currentRole?: string;
    newRole?: string;
    isDeactivation?: boolean;
  } = {}
): Promise<void> => {
  const { currentRole, newRole, isDeactivation } = options;

  // Check if attempting to deactivate an owner
  if (isDeactivation && currentRole === "owner") {
    await assertLastOwnerProtection(companyId, userId, "deactivate");
  }

  // Check if attempting to demote an owner
  if (currentRole === "owner" && newRole && newRole !== "owner") {
    await assertLastOwnerProtection(companyId, userId, "demote");
  }
};
