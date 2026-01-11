import { auditRepository } from "../storage/audit";

/**
 * Write a company-scoped audit log entry
 * @deprecated Use auditRepository.writeCompanyAuditLog directly
 */
export async function writeAuditLog({
  companyId,
  userId,
  action,
  entity,
  entityId,
  metadata,
}: {
  companyId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: any;
}) {
  return auditRepository.writeCompanyAuditLog({
    companyId,
    userId,
    action,
    entity,
    entityId,
    metadata,
  });
}
