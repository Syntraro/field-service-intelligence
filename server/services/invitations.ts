import { invitationRepository } from "../storage/invitations";

/**
 * Create a new invitation
 * @deprecated Use invitationRepository.createInvitation directly
 */
export async function createInvitation(companyId: string, email: string, role: string) {
  return invitationRepository.createInvitation(companyId, email, role);
}

/**
 * Accept an invitation and create a user
 * @deprecated Use invitationRepository.acceptInvitation directly
 */
export async function acceptInvitation(token: string, password: string) {
  return invitationRepository.acceptInvitation(token, password);
}

/**
 * Resend an invitation (regenerate token)
 * SECURITY FIX: Now requires companyId for tenant isolation
 * @deprecated Use invitationRepository.resendInvitation directly
 */
export async function resendInvitation(companyId: string, invitationId: string) {
  return invitationRepository.resendInvitation(companyId, invitationId);
}
