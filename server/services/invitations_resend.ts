import { invitationRepository } from "../storage/invitations";

/**
 * Resend an invitation (regenerate token)
 * SECURITY FIX: Now requires companyId for tenant isolation
 * @deprecated Use invitationRepository.resendInvitation directly
 */
export async function resendInvitation(companyId: string, id: string) {
  const { token } = await invitationRepository.resendInvitation(companyId, id);
  return token;
}
