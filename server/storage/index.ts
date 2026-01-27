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
import { identityRepository } from "./identities";
import { clientRepository } from "./clients";
import { jobRepository } from "./jobs";
import { invoiceRepository } from "./invoices";
import { itemRepository } from "./items";
import { teamRepository } from "./team";
import { templateRepository } from "./templates";
import { maintenanceRepository } from "./maintenance";
import { subscriptionRepository } from "./subscriptions";
import { companyRepository } from "./company";
import { partRepository } from "./parts";
import { customerCompanyRepository } from "./customerCompanies";
import { taskRepository } from "./tasks";
import { permissionRepository } from "./permissions";
import { clientNotesRepository } from "./clientNotes";
import { quoteRepository } from "./quotes";
import { quoteTemplateRepository } from "./quoteTemplates";
import { calendarRepository } from "./calendar";
import type { PaginationOptions, PaginatedResult } from "./clients";

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
  incrementTokenVersion: typeof userRepository.incrementTokenVersion;

  // Identity operations (email + SSO login)
  getEmailIdentity: typeof identityRepository.getEmailIdentity;
  getUserWithEmailIdentity: typeof identityRepository.getUserWithEmailIdentity;
  findUserByEmailGlobal: typeof identityRepository.findUserByEmailGlobal;
  createEmailIdentity: typeof identityRepository.createEmailIdentity;
  updateEmailIdentity: typeof identityRepository.updateEmailIdentity;
  setEmailPassword: typeof identityRepository.setEmailPassword;
  isEmailAvailable: typeof identityRepository.isEmailAvailable;
  isEmailGloballyAvailable: typeof identityRepository.isEmailGloballyAvailable;
  getUserIdentities: typeof identityRepository.getUserIdentities;
  getPrimaryEmailForUser: typeof identityRepository.getPrimaryEmailForUser;

  // Client operations
  getAllClients: typeof clientRepository.getAllClients;
  getPaginatedClients: typeof clientRepository.getPaginatedClients;
  getClient: typeof clientRepository.getClient;
  createClient: typeof clientRepository.createClient;
  createClientWithParts: typeof clientRepository.createClientWithParts;
  bulkCreateClients: typeof clientRepository.bulkCreateClients;
  updateClient: typeof clientRepository.updateClient;
  deleteClient: typeof clientRepository.deleteClient;
  deleteClients: typeof clientRepository.deleteClients;
  getClientReport: typeof clientRepository.getClientReport;
  getAssignmentsByClient: typeof clientRepository.getAssignmentsByClient;
  getAllCalendarAssignments: typeof clientRepository.getAllCalendarAssignments;
  getCalendarAssignmentsInRange: typeof clientRepository.getCalendarAssignmentsInRange;
  getClientParts: typeof clientRepository.getClientParts;
  addClientPart: typeof clientRepository.addClientPart;
  deleteAllClientParts: typeof clientRepository.deleteAllClientParts;
  upsertClientPartsBulk: typeof clientRepository.upsertClientPartsBulk;
  getClientEquipment: typeof clientRepository.getClientEquipment;
  createEquipment: typeof clientRepository.createEquipment;
  cleanupInvalidCalendarAssignments: typeof clientRepository.cleanupInvalidCalendarAssignments;
  getLocationEquipment: typeof clientRepository.getLocationEquipment;
  getLocationEquipmentById: typeof clientRepository.getLocationEquipmentById;
  createLocationEquipment: typeof clientRepository.createLocationEquipment;
  updateLocationEquipment: typeof clientRepository.updateLocationEquipment;
  deleteLocationEquipment: typeof clientRepository.deleteLocationEquipment;

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
  createRecurringJobSeries: typeof jobRepository.createRecurringJobSeries;
  createRecurringJobPhase: typeof jobRepository.createRecurringJobPhase;
  createJobStatusEvent: typeof jobRepository.createJobStatusEvent;
  getJobStatusEvents: typeof jobRepository.getJobStatusEvents;
  getJobScheduleHistory: typeof jobRepository.getJobScheduleHistory;
  getActionRequiredJobs: typeof jobRepository.getActionRequiredJobs;
  updateJobStatusWithEvent: typeof jobRepository.updateJobStatusWithEvent;
  updateJobStatusWithMultipleEvents: typeof jobRepository.updateJobStatusWithMultipleEvents;
  transitionJobStatus: typeof jobRepository.transitionJobStatus;

  // Invoice operations
  getInvoices: typeof invoiceRepository.getInvoices;
  getInvoice: typeof invoiceRepository.getInvoice;
  getInvoiceByJobId: typeof invoiceRepository.getInvoiceByJobId;
  getInvoiceStats: typeof invoiceRepository.getInvoiceStats;
  getDashboardInvoices: typeof invoiceRepository.getDashboardInvoices;
  getInvoiceLines: typeof invoiceRepository.getInvoiceLines;
  createInvoiceLine: typeof invoiceRepository.createInvoiceLine;
  deleteInvoiceLine: typeof invoiceRepository.deleteInvoiceLine;
  refreshInvoiceFromJob: typeof invoiceRepository.refreshInvoiceFromJob;
  updateInvoice: typeof invoiceRepository.updateInvoice;
  createInvoiceFromJob: typeof invoiceRepository.createInvoiceFromJob;
  
  // Items operations (products/services)
  getItems: typeof itemRepository.getItems;
  getItem: typeof itemRepository.getItem;
  createItem: typeof itemRepository.createItem;
  updateItem: typeof itemRepository.updateItem;
  deleteItem: typeof itemRepository.deleteItem;
  restoreItem: typeof itemRepository.restoreItem;

  // Parts operations (legacy parts table)
  getParts: typeof partRepository.getParts;
  getPart: typeof partRepository.getPart;
  createPart: (companyId: string, userId: string, partData: any) => Promise<any>;
  updatePart: typeof partRepository.updatePart;
  deletePart: typeof partRepository.deletePart;

  // Team operations
  createTeamMember: typeof teamRepository.createTeamMember;
  getTeamMembers: typeof teamRepository.getTeamMembers;
  getTeamMember: typeof teamRepository.getTeamMember;
  updateTeamMember: typeof teamRepository.updateTeamMember;
  deactivateTeamMember: typeof teamRepository.deactivateTeamMember;
  activateTeamMember: typeof teamRepository.activateTeamMember;
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

  createCompany: (data: { name: string; email: string }) => Promise<any>;
getInvitationByToken: (token: string) => Promise<any>;
updateInvitation: (id: string, data: { status: string }) => Promise<any>;
  
  // Company operations
  getCompanySettings: typeof companyRepository.getCompanySettings;
  getCompanyTimezone: typeof companyRepository.getCompanyTimezone;
  upsertCompanySettings: (companyId: string, userId: string, settings: any) => Promise<any>;
  getImpersonationStatus: typeof companyRepository.getImpersonationStatus;

  // Customer company operations
  getCustomerCompany: typeof customerCompanyRepository.getCustomerCompany;

  // Quote operations
  getQuotes: typeof quoteRepository.getQuotes;
  getQuote: typeof quoteRepository.getQuote;
  getQuoteDetails: typeof quoteRepository.getQuoteDetails;
  getQuoteLines: typeof quoteRepository.getQuoteLines;
  getQuoteStats: typeof quoteRepository.getQuoteStats;
  createQuote: typeof quoteRepository.createQuote;
  updateQuote: typeof quoteRepository.updateQuote;
  deleteQuote: typeof quoteRepository.deleteQuote;
  createQuoteLine: typeof quoteRepository.createQuoteLine;
  updateQuoteLine: typeof quoteRepository.updateQuoteLine;
  deleteQuoteLine: typeof quoteRepository.deleteQuoteLine;

  // Calendar operations
  getCalendarAssignmentsInDateRange: typeof calendarRepository.getAssignmentsInRange;
  getCalendarAssignment: typeof calendarRepository.getAssignmentById;
  createCalendarAssignment: typeof calendarRepository.createAssignment;
  updateCalendarAssignment: typeof calendarRepository.updateAssignment;
  deleteCalendarAssignment: typeof calendarRepository.deleteAssignment;
  validateCalendarTechnician: typeof calendarRepository.validateTechnicianBelongsToTenant;
  validateCalendarJob: typeof calendarRepository.validateJobBelongsToTenant;
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
  incrementTokenVersion: userRepository.incrementTokenVersion.bind(userRepository),

  // Identity operations (email + SSO login)
  getEmailIdentity: identityRepository.getEmailIdentity.bind(identityRepository),
  getUserWithEmailIdentity: identityRepository.getUserWithEmailIdentity.bind(identityRepository),
  findUserByEmailGlobal: identityRepository.findUserByEmailGlobal.bind(identityRepository),
  createEmailIdentity: identityRepository.createEmailIdentity.bind(identityRepository),
  updateEmailIdentity: identityRepository.updateEmailIdentity.bind(identityRepository),
  setEmailPassword: identityRepository.setEmailPassword.bind(identityRepository),
  isEmailAvailable: identityRepository.isEmailAvailable.bind(identityRepository),
  isEmailGloballyAvailable: identityRepository.isEmailGloballyAvailable.bind(identityRepository),
  getUserIdentities: identityRepository.getUserIdentities.bind(identityRepository),
  getPrimaryEmailForUser: identityRepository.getPrimaryEmailForUser.bind(identityRepository),

  // Client operations
  getAllClients: clientRepository.getAllClients.bind(clientRepository),
  getPaginatedClients: clientRepository.getPaginatedClients.bind(clientRepository),
  getClient: clientRepository.getClient.bind(clientRepository),
  createClient: clientRepository.createClient.bind(clientRepository),
  createClientWithParts: clientRepository.createClientWithParts.bind(clientRepository),
  bulkCreateClients: clientRepository.bulkCreateClients.bind(clientRepository),
  updateClient: clientRepository.updateClient.bind(clientRepository),
  deleteClient: clientRepository.deleteClient.bind(clientRepository),
  deleteClients: clientRepository.deleteClients.bind(clientRepository),
  getClientReport: clientRepository.getClientReport.bind(clientRepository),
  getAssignmentsByClient: clientRepository.getAssignmentsByClient.bind(clientRepository),
  getAllCalendarAssignments: clientRepository.getAllCalendarAssignments.bind(clientRepository),
  getCalendarAssignmentsInRange: clientRepository.getCalendarAssignmentsInRange.bind(clientRepository),
  getClientParts: clientRepository.getClientParts.bind(clientRepository),
  addClientPart: clientRepository.addClientPart.bind(clientRepository),
  deleteAllClientParts: clientRepository.deleteAllClientParts.bind(clientRepository),
  upsertClientPartsBulk: clientRepository.upsertClientPartsBulk.bind(clientRepository),
  getClientEquipment: clientRepository.getClientEquipment.bind(clientRepository),
  createEquipment: clientRepository.createEquipment.bind(clientRepository),
  cleanupInvalidCalendarAssignments: clientRepository.cleanupInvalidCalendarAssignments.bind(clientRepository),
  getLocationEquipment: clientRepository.getLocationEquipment.bind(clientRepository),
  getLocationEquipmentById: clientRepository.getLocationEquipmentById.bind(clientRepository),
  createLocationEquipment: clientRepository.createLocationEquipment.bind(clientRepository),
  updateLocationEquipment: clientRepository.updateLocationEquipment.bind(clientRepository),
  deleteLocationEquipment: clientRepository.deleteLocationEquipment.bind(clientRepository),

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
  createRecurringJobSeries: jobRepository.createRecurringJobSeries.bind(jobRepository),
  createRecurringJobPhase: jobRepository.createRecurringJobPhase.bind(jobRepository),
  createJobStatusEvent: jobRepository.createJobStatusEvent.bind(jobRepository),
  getJobStatusEvents: jobRepository.getJobStatusEvents.bind(jobRepository),
  getJobScheduleHistory: jobRepository.getJobScheduleHistory.bind(jobRepository),
  getActionRequiredJobs: jobRepository.getActionRequiredJobs.bind(jobRepository),
  updateJobStatusWithEvent: jobRepository.updateJobStatusWithEvent.bind(jobRepository),
  updateJobStatusWithMultipleEvents: jobRepository.updateJobStatusWithMultipleEvents.bind(jobRepository),
  transitionJobStatus: jobRepository.transitionJobStatus.bind(jobRepository),

  // Invoice operations
  getInvoices: invoiceRepository.getInvoices.bind(invoiceRepository),
  getInvoice: invoiceRepository.getInvoice.bind(invoiceRepository),
  getInvoiceByJobId: invoiceRepository.getInvoiceByJobId.bind(invoiceRepository),
  getInvoiceStats: invoiceRepository.getInvoiceStats.bind(invoiceRepository),
  getDashboardInvoices: invoiceRepository.getDashboardInvoices.bind(invoiceRepository),
  getInvoiceLines: invoiceRepository.getInvoiceLines.bind(invoiceRepository),
  createInvoiceLine: invoiceRepository.createInvoiceLine.bind(invoiceRepository),
  deleteInvoiceLine: invoiceRepository.deleteInvoiceLine.bind(invoiceRepository),
  refreshInvoiceFromJob: invoiceRepository.refreshInvoiceFromJob.bind(invoiceRepository),
  updateInvoice: invoiceRepository.updateInvoice.bind(invoiceRepository),
  createInvoiceFromJob: invoiceRepository.createInvoiceFromJob.bind(invoiceRepository),
  
  // Items operations (products/services)
  getItems: itemRepository.getItems.bind(itemRepository),
  getItem: itemRepository.getItem.bind(itemRepository),
  createItem: itemRepository.createItem.bind(itemRepository),
  updateItem: itemRepository.updateItem.bind(itemRepository),
  deleteItem: itemRepository.deleteItem.bind(itemRepository),
  restoreItem: itemRepository.restoreItem.bind(itemRepository),

  // Parts operations (legacy parts table)
  getParts: partRepository.getParts.bind(partRepository),
  getPart: partRepository.getPart.bind(partRepository),
  createPart: partRepository.createPart.bind(partRepository),
  updatePart: partRepository.updatePart.bind(partRepository),
  deletePart: partRepository.deletePart.bind(partRepository),

  // Team operations
  createTeamMember: teamRepository.createTeamMember.bind(teamRepository),
  getTeamMembers: teamRepository.getTeamMembers.bind(teamRepository),
  getTeamMember: teamRepository.getTeamMember.bind(teamRepository),
  updateTeamMember: teamRepository.updateTeamMember.bind(teamRepository),
  deactivateTeamMember: teamRepository.deactivateTeamMember.bind(teamRepository),
  activateTeamMember: teamRepository.activateTeamMember.bind(teamRepository),
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
  getCompanyTimezone: companyRepository.getCompanyTimezone.bind(companyRepository),
  upsertCompanySettings: companyRepository.upsertCompanySettings.bind(companyRepository),
  getImpersonationStatus: companyRepository.getImpersonationStatus.bind(companyRepository),
  createCompany: async (data: { name: string; email: string }) => {
    const { companies } = await import("@shared/schema");
    const { db } = await import("../db");

    const [company] = await db
      .insert(companies)
      .values({
        name: data.name,
        email: data.email,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 day trial
      })
      .returning();

    return company;
  },

  getInvitationByToken: async (token: string) => {
    const { invitations } = await import("@shared/schema");
    const { db } = await import("../db");
    const { eq } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1);

    return rows[0] || null;
  },

  updateInvitation: async (id: string, data: { status: string }) => {
    const { invitations } = await import("@shared/schema");
    const { db } = await import("../db");
    const { eq } = await import("drizzle-orm");

    const [updated] = await db
      .update(invitations)
      .set({ status: data.status })
      .where(eq(invitations.id, id))
      .returning();

    return updated;
  },
  
  // Customer company operations
  getCustomerCompany: customerCompanyRepository.getCustomerCompany.bind(customerCompanyRepository),

  // Quote operations
  getQuotes: quoteRepository.getQuotes.bind(quoteRepository),
  getQuote: quoteRepository.getQuote.bind(quoteRepository),
  getQuoteDetails: quoteRepository.getQuoteDetails.bind(quoteRepository),
  getQuoteLines: quoteRepository.getQuoteLines.bind(quoteRepository),
  getQuoteStats: quoteRepository.getQuoteStats.bind(quoteRepository),
  createQuote: quoteRepository.createQuote.bind(quoteRepository),
  updateQuote: quoteRepository.updateQuote.bind(quoteRepository),
  deleteQuote: quoteRepository.deleteQuote.bind(quoteRepository),
  createQuoteLine: quoteRepository.createQuoteLine.bind(quoteRepository),
  updateQuoteLine: quoteRepository.updateQuoteLine.bind(quoteRepository),
  deleteQuoteLine: quoteRepository.deleteQuoteLine.bind(quoteRepository),

  // Calendar operations
  getCalendarAssignmentsInDateRange: calendarRepository.getAssignmentsInRange.bind(calendarRepository),
  getCalendarAssignment: calendarRepository.getAssignmentById.bind(calendarRepository),
  createCalendarAssignment: calendarRepository.createAssignment.bind(calendarRepository),
  updateCalendarAssignment: calendarRepository.updateAssignment.bind(calendarRepository),
  deleteCalendarAssignment: calendarRepository.deleteAssignment.bind(calendarRepository),
  validateCalendarTechnician: calendarRepository.validateTechnicianBelongsToTenant.bind(calendarRepository),
  validateCalendarJob: calendarRepository.validateJobBelongsToTenant.bind(calendarRepository),
};

// Export individual repositories for advanced use cases
export {
  userRepository,
  identityRepository,
  clientRepository,
  jobRepository,
  invoiceRepository,
  itemRepository,
  partRepository,
  teamRepository,
  templateRepository,
  maintenanceRepository,
  subscriptionRepository,
  companyRepository,
  customerCompanyRepository,
  taskRepository,
  permissionRepository,
  clientNotesRepository,
  quoteRepository,
  quoteTemplateRepository,
  calendarRepository,
};

// Subscription billing (separate export due to its size and specialized nature)
export { subscriptionBillingRepository } from "./subscriptionBilling";

// Default export for convenience
export default storage;