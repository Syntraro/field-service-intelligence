/**
 * Recipient Resolver Service (Phase 8, 2026-04-12).
 *
 * Single public entry point for determining default email recipients for any
 * supported entity type (invoice / quote / job). Replaces the three
 * standalone resolver services with one orchestrator + strategies.
 *
 * Architecture:
 *   routes → recipientResolverService.getDefaultRecipients({ tenantId, entityType, entityId })
 *              → recipientResolverStrategies.<entityType>(tenantId, entityId)    // ordered candidate list
 *              → normalize + dedupe                                              // shared here
 *
 * Rules:
 *   - shared normalization lives here (trim, lowercase, RFC-shape check)
 *   - shared dedupe preserves first-occurrence order (case-insensitive)
 *   - empty array when no match (not an error)
 *   - strategy throws 404 only when the entity itself is missing
 */

import { createError } from "../middleware/errorHandler";
import type { CommunicationTemplateEntityType } from "@shared/schema";
import { recipientResolverStrategies } from "./recipientResolverStrategies";

export interface RecipientDefaults {
  recipients: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

export const recipientResolverService = {
  async getDefaultRecipients(input: {
    tenantId: string;
    entityType: CommunicationTemplateEntityType;
    entityId: string;
  }): Promise<RecipientDefaults> {
    const { tenantId, entityType, entityId } = input;
    if (!tenantId) throw createError(400, "tenantId is required");
    if (!entityId) throw createError(400, "entityId is required");

    const strategy = recipientResolverStrategies[entityType];
    if (!strategy) throw createError(400, `Unsupported entityType: ${entityType}`);

    // Strategy returns an ordered candidate list; may throw 404 if the entity
    // itself is missing (each strategy fetches the entity first).
    const candidates = await strategy(tenantId, entityId);

    // Centralized normalization + dedupe.
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const raw of candidates) {
      const e = cleanEmail(raw);
      if (!e) continue;
      if (seen.has(e)) continue;
      seen.add(e);
      recipients.push(e);
    }
    return { recipients };
  },
};
