import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { subscriptionService } from "../subscriptionService";

/**
 * Phase 1 extraction from server/routes.ts
 * Keep logic identical while relocating.
 */
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  // @ts-ignore passport adds isAuthenticated()
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ error: "Not authenticated" });
}

function formatDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

function deriveNextDueForClient(client: any, futureDueByClientId: Map<string, string>): string {
  const derived = futureDueByClientId.get(client.id);
  if (derived) return derived;

  const selectedMonth = client.selectedMonth;
  if (!selectedMonth) return "";
  const year = new Date().getFullYear();
  return formatDateOnly(new Date(year, selectedMonth - 1, 1));
}

function buildFutureDueIndex(assignments: any[]): Map<string, string> {
  const now = new Date();
  const index = new Map<string, string>();

  for (const a of assignments || []) {
    if (!a?.clientId || !a?.date) continue;
    const d = new Date(a.date);
    if (isNaN(d.getTime())) continue;
    if (d < now) continue;

    const current = index.get(a.clientId);
    const fd = formatDateOnly(d);
    if (!current) index.set(a.clientId, fd);
    else {
      const curD = new Date(current);
      if (d < curD) index.set(a.clientId, fd);
    }
  }
  return index;
}

const router = Router();

/** Client routes */
    router.get("/", isAuthenticated, async (req, res) => {
    try {
      const companyId = req.user!.companyId;
      const clients = await storage.getAllClients(companyId);
      const start = getISODateOrDefault(req.query.assignStart as string | undefined, -30);
const end = getISODateOrDefault(req.query.assignEnd as string | undefined, +60);
const assignmentLimit = clampInt(req.query.assignLimit as string | undefined, 5000, 1, 5000);

const assignments = await storage.getCalendarAssignmentsInRange(companyId, {
  start,
  end,
  limit: assignmentLimit,
});

      const futureDueByClientId = buildFutureDueIndex(assignments);

      const clientsWithDue = clients.map((c: any) => ({
        ...c,
        nextDue: deriveNextDueForClient(c, futureDueByClientId),
      }));

      res.json(clientsWithDue);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

    router.post("/", isAuthenticated, async (req, res) => {
    try {
      // Check subscription limits
      const limitCheck = await subscriptionService.canAddLocation(req.user!.id);
      if (!limitCheck.allowed) {
        return res.status(403).json({ 
          error: limitCheck.reason,
          current: limitCheck.current,
          limit: limitCheck.limit,
          subscriptionLimitReached: true
        });
      }

      const { parts, ...clientData } = req.body;
      const validated = insertClientSchema.parse(clientData);
      
      let client: Client;
      
      // If parts are provided, use transactional method
      if (parts && Array.isArray(parts) && parts.length > 0) {
        const partsSchema = z.array(z.object({
          partId: z.string().uuid(),
          quantity: z.number().int().positive()
        }));
        
        const validatedParts = partsSchema.parse(parts);
        client = await storage.createClientWithParts(req.user!.companyId, req.user!.id, validated, validatedParts);
      } else {
        // No parts, use regular client creation
        client = await storage.createClient(req.user!.companyId, req.user!.id, validated);
      }
      
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid client or parts data", details: error.errors });
      }
      res.status(400).json({ error: "Invalid client data" });
    }
  });

    router.post("/import-simple", isAuthenticated, async (req, res) => {
    try {
      const { clients } = req.body;
      
      if (!Array.isArray(clients) || clients.length === 0) {
        return res.status(400).json({ error: "Invalid import data: clients array is required" });
      }

      // Check if user can import this many clients
      const usage = await subscriptionService.getUsageInfo(req.user!.id);
      const availableSlots = usage.plan ? usage.plan.locationLimit - usage.usage.locations : 999999;
      
      if (subscriptionService.isEnabled() && clients.length > availableSlots) {
        return res.status(403).json({ 
          error: `Cannot import ${clients.length} clients. You have ${availableSlots} available locations on your ${usage.plan?.displayName} plan.`,
          subscriptionLimitReached: true,
          current: usage.usage.locations,
          limit: usage.plan?.locationLimit || 0,
          requested: clients.length
        });
      }

      let imported = 0;
      const errors: string[] = [];

      for (const clientData of clients) {
        try {
          const validated = insertClientSchema.parse(clientData);
          await storage.createClient(req.user!.companyId, req.user!.id, validated);
          imported++;
        } catch (error) {
          errors.push(`Failed to import ${clientData.companyName || 'unknown client'}`);
        }
      }

      res.json({ 
        imported, 
        errors: errors.length > 0 ? errors : undefined,
        total: clients.length 
      });
    } catch (error) {
      console.error('Simple import error:', error);
      res.status(500).json({ error: "Failed to import clients" });
    }
  });

    router.post("/import", isAuthenticated, async (req, res) => {
    try {
      const { clients } = req.body;
      
      if (!Array.isArray(clients) || clients.length === 0) {
        return res.status(400).json({ error: "Invalid import data: clients array is required" });
      }

      let imported = 0;
      const errors: string[] = [];

      for (const clientData of clients) {
        try {
          const { parts, equipment, ...clientInfo } = clientData;
          const validated = insertClientSchema.parse(clientInfo);
          const client = await storage.createClient(req.user!.companyId, req.user!.id, validated);
          imported++;
          
          // Import parts if present
          if (parts && Array.isArray(parts) && parts.length > 0) {
            for (const partData of parts) {
              try {
                // Create part as "other" type with the name from backup
                const part = await storage.createPart(req.user!.companyId, req.user!.id, {
                  type: 'other',
                  name: partData.name,
                  filterType: null,
                  beltType: null,
                  size: null,
                  description: null,
                });
                
                // Link part to client
                await storage.addClientPart(req.user!.companyId, req.user!.id, {
                  clientId: client.id,
                  partId: part.id,
                  quantity: partData.quantity || 1,
                });
              } catch (partError) {
                console.error(`Failed to import part for ${client.companyName}:`, partError);
              }
            }
          }
          
          // Import equipment if present
          if (equipment && Array.isArray(equipment) && equipment.length > 0) {
            for (const equipData of equipment) {
              try {
                await storage.createEquipment(req.user!.companyId, req.user!.id, {
                  clientId: client.id,
                  name: equipData.name,
                  modelNumber: equipData.modelNumber || null,
                  serialNumber: equipData.serialNumber || null,
                  notes: null,
                });
              } catch (equipError) {
                console.error(`Failed to import equipment for ${client.companyName}:`, equipError);
              }
            }
          }
        } catch (error) {
          console.error('Import client error:', error);
          errors.push(`Failed to import ${clientData.companyName || 'unknown client'}`);
        }
      }

      res.json({ 
        imported, 
        errors: errors.length > 0 ? errors : undefined,
        total: clients.length 
      });
    } catch (error) {
      console.error('Bulk import error:', error);
      res.status(500).json({ error: "Failed to import clients" });
    }
  });

    router.get("/:id", isAuthenticated, async (req, res) => {
    try {
      const companyId = req.user!.companyId;
      const client = await storage.getClient(companyId, req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const assignments = await storage.getAssignmentsByClient(companyId, client.id);
      const futureDueByClientId = buildFutureDueIndex(assignments);
      const clientWithDue = {
        ...client,
        nextDue: deriveNextDueForClient(client, futureDueByClientId),
      };

      res.json(clientWithDue);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

    router.get("/:id/report", isAuthenticated, async (req, res) => {
    try {
      const companyId = req.user!.companyId;
      const clientId = req.params.id;
      console.log(`[Report] Fetching report for companyId: ${companyId}, clientId: ${clientId}`);
      
      const report = await storage.getClientReport(companyId, clientId);
      if (!report) {
        console.log(`[Report] Client not found - companyId: ${companyId}, clientId: ${clientId}`);
        return res.status(404).json({ error: "Client not found" });
      }
      
      console.log(`[Report] Successfully generated report for: ${report.client.companyName}`);
      res.json(report);
    } catch (error) {
      console.error('[Report] Error generating report:', error);
      res.status(500).json({ error: "Failed to generate client report" });
    }
  });

  app.put("/api/clients/:id", isAuthenticated, async (req, res) => {
    try {
      const validated = insertClientSchema.partial().parse(req.body);
      const companyId = req.user!.companyId;
      const clientId = req.params.id;
      
      // Check if selectedMonths is being updated
      const isUpdatingPmMonths = validated.selectedMonths !== undefined;
      
      // Update the client
      const client = await storage.updateClient(companyId, clientId, validated);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      // If PM months were updated, cleanup invalid calendar assignments
      let cleanupResult = { removedCount: 0 };
      if (isUpdatingPmMonths && client.selectedMonths) {
        cleanupResult = await storage.cleanupInvalidCalendarAssignments(
          companyId,
          clientId,
          client.selectedMonths
        );
      }
      
      res.json({
        ...client,
        _cleanupInfo: cleanupResult
      });
    } catch (error) {
      res.status(400).json({ error: "Invalid client data" });
    }
  });

  // PATCH route for partial client updates (used by LocationFormModal)
    router.patch("/:id", isAuthenticated, async (req, res) => {
    try {
      const validated = insertClientSchema.partial().parse(req.body);
      const companyId = req.user!.companyId;
      const clientId = req.params.id;
      
      const client = await storage.updateClient(companyId, clientId, validated);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      res.json(client);
    } catch (error) {
      res.status(400).json({ error: "Invalid client data" });
    }
  });

    router.delete("/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteAllClientParts(req.user!.companyId, req.params.id);
      const deleted = await storage.deleteClient(req.user!.companyId, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

    router.post("/bulk-delete", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        ids: z.array(z.string().uuid()).min(1).max(200)
      });
      const { ids } = schema.parse(req.body);
      
      const result = await storage.deleteClients(req.user!.companyId, ids);
      
      res.json({
        deletedIds: result.deletedIds,
        notFoundIds: result.notFoundIds,
        deletedCount: result.deletedIds.length,
        notFoundCount: result.notFoundIds.length
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request: must provide 1-200 client IDs" });
      }
      res.status(500).json({ error: "Failed to delete clients" });
    }
  });


export default router;
