/**
 * Main Storage Layer
 * 
 * This modular storage layer provides:
 * - Automatic tenant isolation (all queries filtered by companyId)
 * - Consistent error handling
 * - Type safety with TypeScript
 * - Transaction support
 * - Easy to test and maintain
 * 
 * Each repository extends BaseRepository which provides:
 * - validateTenantOwnership() - Ensures resources belong to company
 * - Standard error creators (notFoundError, validationError, etc.)
 */

import { userRepository } from "./users";
import { clientRepository } from "./clients";
import { jobRepository } from "./jobs";
import { invoiceRepository } from "./invoices";
import { partRepository } from "./parts";
import { teamRepository } from "./team";
import { templateRepository } from "./templates";
import { maintenanceRepository } from "./maintenance";
import { subscriptionRepository } from "./subscriptions";
import { companyRepository } from "./company";

/**
 * Storage interface for dependency injection
 * Useful for testing and impersonation middleware
 */
export interface IStorage {
  // User operations
  getUser: typeof userRepository.getUser;
  getUserByEmail: typeof userRepository.getUserByEmail;
  getAuthenticatedUser: typeof userRepository.getAuthenticatedUser;
  createUser: typeof userRepository.createUser;
  updateUser: typeof userRepository.updateUser;
  getCompanyById: typeof userRepository.getCompanyById;

  // Client operations
  getAllClients: typeof clientRepository.getAllClients;
  getClient: typeof clientRepository.getClient;
  createClient: typeof clientRepository.createClient;
  createClientWithParts: typeof clientRepository.createClientWithParts;
  updateClient: typeof clientRepository.updateClient;
  deleteClient: typeof clientRepository.deleteClient;
  deleteClients: typeof clientRepository.deleteClients;
  getClientReport: typeof clientRepository.getClientReport;
  getAssignmentsByClient: typeof clientRepository.getAssignmentsByClient;
  getAllCalendarAssignments: typeof clientRepository.getAllCalendarAssignments;
  getClientParts: typeof clientRepository.getClientParts;
  addClientPart: typeof clientRepository.addClientPart;
  deleteAllClientParts: typeof clientRepository.deleteAllClientParts;
  upsertClientPartsBulk: typeof clientRepository.upsertClientPartsBulk;
  getClientEquipment: typeof clientRepository.getClientEquipment;
  createEquipment: typeof clientRepository.createEquipment;
  cleanupInvalidCalendarAssignments: typeof clientRepository.cleanupInvalidCalendarAssignments;

  // Job operations
  getJobs: typeof jobRepository.getJobs;
  getJob: typeof jobRepository.getJob;
  createJob: typeof jobRepository.createJob;
  updateJob: typeof jobRepository.updateJob;
  updateJobStatus: typeof jobRepository.updateJobStatus;
  deleteJob: typeof jobRepository.deleteJob;
  getJobParts: typeof jobRepository.getJobParts;
  createJobPart: typeof jobRepository.createJobPart;
  updateJobPart: typeof jobRepository.updateJobPart;
  deleteJobPart: typeof jobRepository.deleteJobPart;
  reorderJobParts: typeof jobRepository.reorderJobParts;
  getJobEquipment: typeof jobRepository.getJobEquipment;
  createJobEquipment: typeof jobRepository.createJobEquipment;
  updateJobEquipment: typeof jobRepository.updateJobEquipment;
  deleteJobEquipment: typeof jobRepository.deleteJobEquipment;
  getLocationEquipmentItem: typeof jobRepository.getLocationEquipmentItem;
  getRecurringSeries: typeof jobRepository.getRecurringSeries;
  reconcileJobInvoiceLinks: typeof jobRepository.reconcileJobInvoiceLinks;

  // Invoice operations
  getInvoices: typeof invoiceRepository.getInvoices;
  getInvoice: typeof invoiceRepository.getInvoice;
  getInvoiceStats: typeof invoiceRepository.getInvoiceStats;
  getInvoiceLines: typeof invoiceRepository.getInvoiceLines;
  createInvoiceLine: typeof invoiceRepository.createInvoiceLine;
  deleteInvoiceLine: typeof invoiceRepository.deleteInvoiceLine;
  refreshInvoiceFromJob: typeof invoiceRepository.refreshInvoiceFromJob;

  // Parts operations
  getParts: typeof partRepository.getParts;
  getPart: typeof partRepository.getPart;
  createPart: typeof partRepository.createPart;
  updatePart: typeof partRepository.updatePart;
  deletePart: typeof partRepository.deletePart;

  // Team operations
  getTeamMembers: typeof teamRepository.getTeamMembers;
  getTeamMember: typeof teamRepository.getTeamMember;
  updateTeamMember: typeof teamRepository.updateTeamMember;
  deactivateTeamMember: typeof teamRepository.deactivateTeamMember;
  getTechnicianProfile: typeof teamRepository.getTechnicianProfile;
  upsertTechnicianProfile: typeof teamRepository.upsertTechnicianProfile;
  getWorkingHours: typeof teamRepository.getWorkingHours;
  setWorkingHours: typeof teamRepository.setWorkingHours;
  getUserPermissionOverrides: typeof teamRepository.getUserPermissionOverrides;
  setUserPermissionOverrides: typeof teamRepository.setUserPermissionOverrides;
  getTechniciansByCompanyId: typeof teamRepository.getTechniciansByCompanyId;

  // Template operations
  getJobTemplates: typeof templateRepository.getJobTemplates;
  getJobTemplate: typeof templateRepository.getJobTemplate;
  getJobTemplateLineItems: typeof templateRepository.getJobTemplateLineItems;
  createJobTemplate: typeof templateRepository.createJobTemplate;
  updateJobTemplate: typeof templateRepository.updateJobTemplate;
  deleteJobTemplate: typeof templateRepository.deleteJobTemplate;
  setJobTemplateAsDefault: typeof templateRepository.setJobTemplateAsDefault;
  getDefaultJobTemplateForJobType: typeof templateRepository.getDefaultJobTemplateForJobType;
  applyJobTemplateToJob: typeof templateRepository.applyJobTemplateToJob;
  cloneJobTemplate: typeof templateRepository.cloneJobTemplate;

  // Maintenance operations
  getMaintenanceRecentlyCompleted: typeof maintenanceRepository.getMaintenanceRecentlyCompleted;
  getMaintenanceStatuses: typeof maintenanceRepository.getMaintenanceStatuses;

  // Subscription operations
  getSubscriptionUsage: typeof subscriptionRepository.getSubscriptionUsage;
  canAddLocation: typeof subscriptionRepository.canAddLocation;

  // Company operations
  getCompanySettings: typeof companyRepository.getCompanySettings;
  upsertCompanySettings: typeof companyRepository.upsertCompanySettings;
  getImpersonationStatus: typeof companyRepository.getImpersonationStatus;

  // Customer company operations (if needed)
  getCustomerCompany?: (companyId: string, customerCompanyId: string) => Promise<any>;
}

/**
 * Main storage object - use this in your routes
 */
export const storage: IStorage = {
  // User operations
  getUser: userRepository.getUser.bind(userRepository),
  getUserByEmail: userRepository.getUserByEmail.bind(userRepository),
  getAuthenticatedUser: userRepository.getAuthenticatedUser.bind(userRepository),
  createUser: userRepository.createUser.bind(userRepository),
  updateUser: userRepository.updateUser.bind(userRepository),
  getCompanyById: userRepository.getCompanyById.bind(userRepository),

  // Client operations
  getAllClients: clientRepository.getAllClients.bind(clientRepository),
  getClient: clientRepository.getClient.bind(clientRepository),
  createClient: clientRepository.createClient.bind(clientRepository),
  createClientWithParts: clientRepository.createClientWithParts.bind(clientRepository),
  updateClient: clientRepository.updateClient.bind(clientRepository),
  deleteClient: clientRepository.deleteClient.bind(clientRepository),
  deleteClients: clientRepository.deleteClients.bind(clientRepository),
  getClientReport: clientRepository.getClientReport.bind(clientRepository),
  getAssignmentsByClient: clientRepository.getAssignmentsByClient.bind(clientRepository),
  getAllCalendarAssignments: clientRepository.getAllCalendarAssignments.bind(clientRepository),
  getClientParts: clientRepository.getClientParts.bind(clientRepository),
  addClientPart: clientRepository.addClientPart.bind(clientRepository),
  deleteAllClientParts: clientRepository.deleteAllClientParts.bind(clientRepository),
  upsertClientPartsBulk: clientRepository.upsertClientPartsBulk.bind(clientRepository),
  getClientEquipment: clientRepository.getClientEquipment.bind(clientRepository),
  createEquipment: clientRepository.createEquipment.bind(clientRepository),
  cleanupInvalidCalendarAssignments: clientRepository.cleanupInvalidCalendarAssignments.bind(clientRepository),

  // Job operations
  getJobs: jobRepository.getJobs.bind(jobRepository),
  getJob: jobRepository.getJob.bind(jobRepository),
  createJob: jobRepository.createJob.bind(jobRepository),
  updateJob: jobRepository.updateJob.bind(jobRepository),
  updateJobStatus: jobRepository.updateJobStatus.bind(jobRepository),
  deleteJob: jobRepository.deleteJob.bind(jobRepository),
  getJobParts: jobRepository.getJobParts.bind(jobRepository),
  createJobPart: jobRepository.createJobPart.bind(jobRepository),
  updateJobPart: jobRepository.updateJobPart.bind(jobRepository),
  deleteJobPart: jobRepository.deleteJobPart.bind(jobRepository),
  reorderJobParts: jobRepository.reorderJobParts.bind(jobRepository),
  getJobEquipment: jobRepository.getJobEquipment.bind(jobRepository),
  createJobEquipment: jobRepository.createJobEquipment.bind(jobRepository),
  updateJobEquipment: jobRepository.updateJobEquipment.bind(jobRepository),
  deleteJobEquipment: jobRepository.deleteJobEquipment.bind(jobRepository),
  getLocationEquipmentItem: jobRepository.getLocationEquipmentItem.bind(jobRepository),
  getRecurringSeries: jobRepository.getRecurringSeries.bind(jobRepository),
  reconcileJobInvoiceLinks: jobRepository.reconcileJobInvoiceLinks.bind(jobRepository),

  // Invoice operations
  getInvoices: invoiceRepository.getInvoices.bind(invoiceRepository),
  getInvoice: invoiceRepository.getInvoice.bind(invoiceRepository),
  getInvoiceStats: invoiceRepository.getInvoiceStats.bind(invoiceRepository),
  getInvoiceLines: invoiceRepository.getInvoiceLines.bind(invoiceRepository),
  createInvoiceLine: invoiceRepository.createInvoiceLine.bind(invoiceRepository),
  deleteInvoiceLine: invoiceRepository.deleteInvoiceLine.bind(invoiceRepository),
  refreshInvoiceFromJob: invoiceRepository.refreshInvoiceFromJob.bind(invoiceRepository),

  // Parts operations
  getParts: partRepository.getParts.bind(partRepository),
  getPart: partRepository.getPart.bind(partRepository),
  createPart: partRepository.createPart.bind(partRepository),
  updatePart: partRepository.updatePart.bind(partRepository),
  deletePart: partRepository.deletePart.bind(partRepository),

  // Team operations
  getTeamMembers: teamRepository.getTeamMembers.bind(teamRepository),
  getTeamMember: teamRepository.getTeamMember.bind(teamRepository),
  updateTeamMember: teamRepository.updateTeamMember.bind(teamRepository),
  deactivateTeamMember: teamRepository.deactivateTeamMember.bind(teamRepository),
  getTechnicianProfile: teamRepository.getTechnicianProfile.bind(teamRepository),
  upsertTechnicianProfile: teamRepository.upsertTechnicianProfile.bind(teamRepository),
  getWorkingHours: teamRepository.getWorkingHours.bind(teamRepository),
  setWorkingHours: teamRepository.setWorkingHours.bind(teamRepository),
  getUserPermissionOverrides: teamRepository.getUserPermissionOverrides.bind(teamRepository),
  setUserPermissionOverrides: teamRepository.setUserPermissionOverrides.bind(teamRepository),
  getTechniciansByCompanyId: teamRepository.getTechniciansByCompanyId.bind(teamRepository),

  // Template operations
  getJobTemplates: templateRepository.getJobTemplates.bind(templateRepository),
  getJobTemplate: templateRepository.getJobTemplate.bind(templateRepository),
  getJobTemplateLineItems: templateRepository.getJobTemplateLineItems.bind(templateRepository),
  createJobTemplate: templateRepository.createJobTemplate.bind(templateRepository),
  updateJobTemplate: templateRepository.updateJobTemplate.bind(templateRepository),
  deleteJobTemplate: templateRepository.deleteJobTemplate.bind(templateRepository),
  setJobTemplateAsDefault: templateRepository.setJobTemplateAsDefault.bind(templateRepository),
  getDefaultJobTemplateForJobType: templateRepository.getDefaultJobTemplateForJobType.bind(templateRepository),
  applyJobTemplateToJob: templateRepository.applyJobTemplateToJob.bind(templateRepository),
  cloneJobTemplate: templateRepository.cloneJobTemplate.bind(templateRepository),

  // Maintenance operations
  getMaintenanceRecentlyCompleted: maintenanceRepository.getMaintenanceRecentlyCompleted.bind(maintenanceRepository),
  getMaintenanceStatuses: maintenanceRepository.getMaintenanceStatuses.bind(maintenanceRepository),

  // Subscription operations
  getSubscriptionUsage: subscriptionRepository.getSubscriptionUsage.bind(subscriptionRepository),
  canAddLocation: subscriptionRepository.canAddLocation.bind(subscriptionRepository),

  // Company operations
  getCompanySettings: companyRepository.getCompanySettings.bind(companyRepository),
  upsertCompanySettings: companyRepository.upsertCompanySettings.bind(companyRepository),
  getImpersonationStatus: companyRepository.getImpersonationStatus.bind(companyRepository),

  // Placeholder for customer company operations
  getCustomerCompany: async (companyId: string, customerCompanyId: string) => {
    // TODO: Implement when customer companies are needed
    return null;
  },
};

// Export individual repositories for advanced use cases
export {
  userRepository,
  clientRepository,
  jobRepository,
  invoiceRepository,
  partRepository,
  teamRepository,
  templateRepository,
  maintenanceRepository,
  subscriptionRepository,
  companyRepository,
};

// Default export for convenience
export default storage;