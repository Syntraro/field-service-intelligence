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
// 2026-04-08: Removed `partRepository` import — PartRepository deleted as
// part of P4 catalog consolidation. All callers route through itemRepository.
import { customerCompanyRepository } from "./customerCompanies";
import { clientContactRepository } from "./clientContacts";
import { taskRepository } from "./tasks";
import { permissionRepository } from "./permissions";
import { clientNotesRepository } from "./clientNotes";
import { filesRepository } from "./files";
import { noteAttachmentRepository } from "./noteAttachments";
import { jobNoteAttachmentRepository } from "./jobNoteAttachments";
import { quoteRepository } from "./quotes";
import { quoteTemplateRepository } from "./quoteTemplates";
import { schedulingRepository } from "./scheduling";
import { taxRepository } from "./tax";
import { businessHoursRepository } from "./businessHours";
import { pmPartRepository } from "./pmParts";
import { clientTagRepository } from "./clientTags";
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
  // 2026-03-20: getAllCalendarAssignments DELETED — zero callers, replaced by getCalendarAssignmentsInRange
  getCalendarAssignmentsInRange: typeof clientRepository.getCalendarAssignmentsInRange;
  getClientParts: typeof clientRepository.getClientParts;
  addClientPart: typeof clientRepository.addClientPart;
  deleteAllClientParts: typeof clientRepository.deleteAllClientParts;
  validateLocationOwnership: typeof clientRepository.validateLocationOwnership;
  validateItemOwnership: typeof clientRepository.validateItemOwnership;
  upsertClientPartsBulk: typeof clientRepository.upsertClientPartsBulk;
  cleanupInvalidCalendarAssignments: typeof clientRepository.cleanupInvalidCalendarAssignments;
  getLocationEquipment: typeof clientRepository.getLocationEquipment;
  getLocationEquipmentAny: typeof clientRepository.getLocationEquipmentAny;
  getLocationEquipmentById: typeof clientRepository.getLocationEquipmentById;
  createLocationEquipment: typeof clientRepository.createLocationEquipment;
  updateLocationEquipment: typeof clientRepository.updateLocationEquipment;
  deleteLocationEquipment: typeof clientRepository.deleteLocationEquipment;
  getArchivedLocationEquipment: typeof clientRepository.getArchivedLocationEquipment;
  restoreLocationEquipment: typeof clientRepository.restoreLocationEquipment;

  // Job operations
  getJobs: typeof jobRepository.getJobs;
  getJob: typeof jobRepository.getJob;
  createJob: typeof jobRepository.createJob;
  updateJob: typeof jobRepository.updateJob;
  updateJobNumber: typeof jobRepository.updateJobNumber;
  // 2026-03-18: updateJobStatus DELETED — lifecycle writes go through orchestrator
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
  // 2026-03-20: createJobStatusEvent DELETED — zero callers via barrel; events created internally by transitionJobStatus/updateJobStatusWithEvent
  getJobStatusEvents: typeof jobRepository.getJobStatusEvents;
  getJobScheduleHistory: typeof jobRepository.getJobScheduleHistory;
  getActionRequiredJobs: typeof jobRepository.getActionRequiredJobs;
  updateJobStatusWithEvent: typeof jobRepository.updateJobStatusWithEvent;
  transitionJobStatus: typeof jobRepository.transitionJobStatus;
  createJobWithExplicitNumber: typeof jobRepository.createJobWithExplicitNumber;
  resetJobNumberCounter: typeof jobRepository.resetJobNumberCounter;

  // Invoice operations
  getInvoices: typeof invoiceRepository.getInvoices;
  getInvoice: typeof invoiceRepository.getInvoice;
  getInvoiceByJobId: typeof invoiceRepository.getInvoiceByJobId;
  // 2026-03-20: getInvoiceStats DELETED — zero callers; canonical version in invoicesFeed.ts
  // 2026-03-20: getDashboardInvoices DELETED — zero callers; dashboard uses invoicesFeed.ts
  getInvoiceLines: typeof invoiceRepository.getInvoiceLines;
  createInvoiceLine: typeof invoiceRepository.createInvoiceLine;
  updateInvoiceLine: typeof invoiceRepository.updateInvoiceLine;
  batchApplyLineTax: typeof invoiceRepository.batchApplyLineTax;
  deleteInvoiceLine: typeof invoiceRepository.deleteInvoiceLine;
  refreshInvoiceFromJob: typeof invoiceRepository.refreshInvoiceFromJob;
  updateInvoice: typeof invoiceRepository.updateInvoice;
  createInvoiceFromJob: typeof invoiceRepository.createInvoiceFromJob;
  createStandaloneInvoice: typeof invoiceRepository.createStandaloneInvoice;
  bumpInvoiceCounterIfNeeded: typeof invoiceRepository.bumpInvoiceCounterIfNeeded;
  reorderInvoiceLines: typeof invoiceRepository.reorderInvoiceLines;

  // Items operations (products/services)
  getItems: typeof itemRepository.getItems;
  getItem: typeof itemRepository.getItem;
  createItem: typeof itemRepository.createItem;
  updateItem: typeof itemRepository.updateItem;
  deleteItem: typeof itemRepository.deleteItem;
  restoreItem: typeof itemRepository.restoreItem;

  // 2026-04-08: Removed legacy `parts` operations from the storage façade.
  // PartRepository was a duplicate wrapper around the same `items` table; all
  // callers now use itemRepository directly via the items operations above.

  // Team operations
  createTeamMember: typeof teamRepository.createTeamMember;
  getTeamMembers: typeof teamRepository.getTeamMembers;
  getTechnicianColors: typeof teamRepository.getTechnicianColors;
  getTechnicianRates: typeof teamRepository.getTechnicianRates;
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

  // 2026-03-20: createCompany DELETED — zero callers
  getInvitationByToken: (token: string) => Promise<any>;
  updateInvitation: (id: string, data: { status: string }) => Promise<any>;
  
  // Company operations
  getCompanySettings: typeof companyRepository.getCompanySettings;
  getCompanyTimezone: typeof companyRepository.getCompanyTimezone;
  upsertCompanySettings: (companyId: string, userId: string, settings: any) => Promise<any>;
  getImpersonationStatus: typeof companyRepository.getImpersonationStatus;

  // Business hours operations
  getCompanyBusinessHours: typeof businessHoursRepository.getCompanyBusinessHours;
  upsertCompanyBusinessHours: typeof businessHoursRepository.upsertCompanyBusinessHours;
  getBusinessHoursForDow: typeof businessHoursRepository.getBusinessHoursForDow;

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
  getCalendarScheduledJobsInDateRange: typeof schedulingRepository.getScheduledJobsInRange;
  getCalendarJob: typeof schedulingRepository.getJobById;
  scheduleCalendarJob: typeof schedulingRepository.scheduleJob;
  // 2026-03-20: validateCalendarTechnician and validateCalendarJob DELETED — zero callers.

  // Tax operations (v1 multi-tax system)
  getTaxRates: typeof taxRepository.getTaxRates;
  getTaxRate: typeof taxRepository.getTaxRate;
  createTaxRate: typeof taxRepository.createTaxRate;
  updateTaxRate: typeof taxRepository.updateTaxRate;
  deleteTaxRate: typeof taxRepository.deleteTaxRate;
  getTaxGroups: typeof taxRepository.getTaxGroups;
  getTaxGroup: typeof taxRepository.getTaxGroup;
  createTaxGroup: typeof taxRepository.createTaxGroup;
  updateTaxGroup: typeof taxRepository.updateTaxGroup;
  deleteTaxGroup: typeof taxRepository.deleteTaxGroup;
  setDefaultTaxGroup: typeof taxRepository.setDefaultTaxGroup;
  getDefaultTaxGroup: typeof taxRepository.getDefaultTaxGroup;
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
  getCalendarAssignmentsInRange: clientRepository.getCalendarAssignmentsInRange.bind(clientRepository),
  getClientParts: clientRepository.getClientParts.bind(clientRepository),
  addClientPart: clientRepository.addClientPart.bind(clientRepository),
  deleteAllClientParts: clientRepository.deleteAllClientParts.bind(clientRepository),
  validateLocationOwnership: clientRepository.validateLocationOwnership.bind(clientRepository),
  validateItemOwnership: clientRepository.validateItemOwnership.bind(clientRepository),
  upsertClientPartsBulk: clientRepository.upsertClientPartsBulk.bind(clientRepository),
  cleanupInvalidCalendarAssignments: clientRepository.cleanupInvalidCalendarAssignments.bind(clientRepository),
  getLocationEquipment: clientRepository.getLocationEquipment.bind(clientRepository),
  getLocationEquipmentAny: clientRepository.getLocationEquipmentAny.bind(clientRepository),
  getLocationEquipmentById: clientRepository.getLocationEquipmentById.bind(clientRepository),
  createLocationEquipment: clientRepository.createLocationEquipment.bind(clientRepository),
  updateLocationEquipment: clientRepository.updateLocationEquipment.bind(clientRepository),
  deleteLocationEquipment: clientRepository.deleteLocationEquipment.bind(clientRepository),
  getArchivedLocationEquipment: clientRepository.getArchivedLocationEquipment.bind(clientRepository),
  restoreLocationEquipment: clientRepository.restoreLocationEquipment.bind(clientRepository),

  // Job operations
  getJobs: jobRepository.getJobs.bind(jobRepository),
  getJob: jobRepository.getJob.bind(jobRepository),
  createJob: jobRepository.createJob.bind(jobRepository),
  updateJob: jobRepository.updateJob.bind(jobRepository),
  updateJobNumber: jobRepository.updateJobNumber.bind(jobRepository),
  // 2026-03-18: updateJobStatus DELETED — lifecycle writes go through orchestrator
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
  getJobStatusEvents: jobRepository.getJobStatusEvents.bind(jobRepository),
  getJobScheduleHistory: jobRepository.getJobScheduleHistory.bind(jobRepository),
  getActionRequiredJobs: jobRepository.getActionRequiredJobs.bind(jobRepository),
  updateJobStatusWithEvent: jobRepository.updateJobStatusWithEvent.bind(jobRepository),
  transitionJobStatus: jobRepository.transitionJobStatus.bind(jobRepository),
  createJobWithExplicitNumber: jobRepository.createJobWithExplicitNumber.bind(jobRepository),
  resetJobNumberCounter: jobRepository.resetJobNumberCounter.bind(jobRepository),

  // Invoice operations
  getInvoices: invoiceRepository.getInvoices.bind(invoiceRepository),
  getInvoice: invoiceRepository.getInvoice.bind(invoiceRepository),
  getInvoiceByJobId: invoiceRepository.getInvoiceByJobId.bind(invoiceRepository),
  getInvoiceLines: invoiceRepository.getInvoiceLines.bind(invoiceRepository),
  createInvoiceLine: invoiceRepository.createInvoiceLine.bind(invoiceRepository),
  updateInvoiceLine: invoiceRepository.updateInvoiceLine.bind(invoiceRepository),
  batchApplyLineTax: invoiceRepository.batchApplyLineTax.bind(invoiceRepository),
  deleteInvoiceLine: invoiceRepository.deleteInvoiceLine.bind(invoiceRepository),
  refreshInvoiceFromJob: invoiceRepository.refreshInvoiceFromJob.bind(invoiceRepository),
  updateInvoice: invoiceRepository.updateInvoice.bind(invoiceRepository),
  createInvoiceFromJob: invoiceRepository.createInvoiceFromJob.bind(invoiceRepository),
  createStandaloneInvoice: invoiceRepository.createStandaloneInvoice.bind(invoiceRepository),
  bumpInvoiceCounterIfNeeded: invoiceRepository.bumpInvoiceCounterIfNeeded.bind(invoiceRepository),
  reorderInvoiceLines: invoiceRepository.reorderInvoiceLines.bind(invoiceRepository),

  // Items operations (products/services)
  getItems: itemRepository.getItems.bind(itemRepository),
  getItem: itemRepository.getItem.bind(itemRepository),
  createItem: itemRepository.createItem.bind(itemRepository),
  updateItem: itemRepository.updateItem.bind(itemRepository),
  deleteItem: itemRepository.deleteItem.bind(itemRepository),
  restoreItem: itemRepository.restoreItem.bind(itemRepository),

  // 2026-04-08: Legacy parts operations removed from storage façade.
  // PartRepository was a duplicate of ItemRepository on the same `items` table.
  // All call sites now use the items operations above.

  // Team operations
  createTeamMember: teamRepository.createTeamMember.bind(teamRepository),
  getTeamMembers: teamRepository.getTeamMembers.bind(teamRepository),
  getTechnicianColors: teamRepository.getTechnicianColors.bind(teamRepository),
  getTechnicianRates: teamRepository.getTechnicianRates.bind(teamRepository),
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

  // Business hours operations
  getCompanyBusinessHours: businessHoursRepository.getCompanyBusinessHours.bind(businessHoursRepository),
  upsertCompanyBusinessHours: businessHoursRepository.upsertCompanyBusinessHours.bind(businessHoursRepository),
  getBusinessHoursForDow: businessHoursRepository.getBusinessHoursForDow.bind(businessHoursRepository),

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
  getCalendarScheduledJobsInDateRange: schedulingRepository.getScheduledJobsInRange.bind(schedulingRepository),
  getCalendarJob: schedulingRepository.getJobById.bind(schedulingRepository),
  scheduleCalendarJob: schedulingRepository.scheduleJob.bind(schedulingRepository),
  // 2026-03-20: validateCalendarTechnician and validateCalendarJob DELETED — zero callers.

  // Tax operations (v1 multi-tax system)
  getTaxRates: taxRepository.getTaxRates.bind(taxRepository),
  getTaxRate: taxRepository.getTaxRate.bind(taxRepository),
  createTaxRate: taxRepository.createTaxRate.bind(taxRepository),
  updateTaxRate: taxRepository.updateTaxRate.bind(taxRepository),
  deleteTaxRate: taxRepository.deleteTaxRate.bind(taxRepository),
  getTaxGroups: taxRepository.getTaxGroups.bind(taxRepository),
  getTaxGroup: taxRepository.getTaxGroup.bind(taxRepository),
  createTaxGroup: taxRepository.createTaxGroup.bind(taxRepository),
  updateTaxGroup: taxRepository.updateTaxGroup.bind(taxRepository),
  deleteTaxGroup: taxRepository.deleteTaxGroup.bind(taxRepository),
  setDefaultTaxGroup: taxRepository.setDefaultTaxGroup.bind(taxRepository),
  getDefaultTaxGroup: taxRepository.getDefaultTaxGroup.bind(taxRepository),
};

// Export individual repositories for advanced use cases
export {
  userRepository,
  identityRepository,
  clientRepository,
  jobRepository,
  invoiceRepository,
  itemRepository,
  teamRepository,
  templateRepository,
  maintenanceRepository,
  subscriptionRepository,
  companyRepository,
  customerCompanyRepository,
  clientContactRepository,
  taskRepository,
  permissionRepository,
  clientNotesRepository,
  filesRepository,
  noteAttachmentRepository,
  jobNoteAttachmentRepository,
  quoteRepository,
  quoteTemplateRepository,
  schedulingRepository,
  taxRepository,
  pmPartRepository,
  clientTagRepository,
};

// Subscription billing (separate export due to its size and specialized nature)
export { subscriptionBillingRepository } from "./subscriptionBilling";

// Default export for convenience
export default storage;