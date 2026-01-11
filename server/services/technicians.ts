import { technicianRepository } from "../storage/technicians";

/**
 * Create a new technician
 * @deprecated Use technicianRepository.createTechnician directly
 */
export async function createTechnician(companyId: string, name: string, userId?: string) {
  return technicianRepository.createTechnician(companyId, name, userId);
}
