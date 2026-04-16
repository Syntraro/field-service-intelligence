/**
 * Platform Tenants Service — Phase 2 (Ops Portal Core).
 *
 * Thin orchestration layer for /api/platform/tenants/*.
 *
 * Reuses canonical owners:
 * - `platformTenantsStorage.searchTenants` for the lightweight search list
 * - `adminRepository.getTenantDetail` for tenant detail
 * - `tenantFeaturesRepository` for feature reads/writes (single source of truth)
 * - `platformAuditService` for mutation audit
 *
 * No direct DB access. No HTTP-to-HTTP calls. No duplicate feature-flag writes.
 */

import type { Request } from "express";
import {
  platformTenantsStorage,
  type PlatformTenantRow,
  type SearchTenantsResult,
} from "../storage/platformTenantsStorage";
import { adminRepository, type TenantAccountDetail } from "../storage/admin";
import { tenantFeaturesRepository } from "../storage/tenantFeatures";
import type { TenantFeatures, UpdateTenantFeatures } from "@shared/schema";
import { platformAuditService } from "./platformAuditService";

export interface SearchTenantsInput {
  q?: string;
  status?: string;
  plan?: string;
  limit?: number;
  offset?: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

function normalizeSearchInput(input: SearchTenantsInput) {
  const limit = Math.min(
    Math.max(1, Number.isFinite(input.limit) ? Number(input.limit) : DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.max(0, Number.isFinite(input.offset) ? Number(input.offset) : 0);
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    plan: input.plan?.trim() || undefined,
    limit,
    offset,
  };
}

async function searchTenants(input: SearchTenantsInput): Promise<SearchTenantsResult & { limit: number; offset: number }> {
  const params = normalizeSearchInput(input);
  const result = await platformTenantsStorage.searchTenants(params);
  return { ...result, limit: params.limit, offset: params.offset };
}

export interface PlatformTenantDetail {
  tenant: TenantAccountDetail;
  features: TenantFeatures;
  /** Populated once support sessions land (Phase 4). */
  recentSupportAt: Date | null;
}

async function getTenantDetail(tenantId: string): Promise<PlatformTenantDetail | null> {
  const tenant = await adminRepository.getTenantDetail(tenantId);
  if (!tenant) return null;

  // Canonical feature owner — do not duplicate reads.
  const features = await tenantFeaturesRepository.getFeatures(tenantId);

  return {
    tenant,
    features,
    recentSupportAt: null,
  };
}

async function getTenantFeatures(tenantId: string): Promise<TenantFeatures | null> {
  // Verify the tenant exists before returning defaulted features.
  const tenant = await adminRepository.getTenantDetail(tenantId);
  if (!tenant) return null;
  return tenantFeaturesRepository.getFeatures(tenantId);
}

export interface UpdateTenantFeaturesInput {
  tenantId: string;
  updates: UpdateTenantFeatures;
  actor: { id: string; email: string };
  req: Request;
}

function diffFlags(
  before: TenantFeatures,
  updates: UpdateTenantFeatures,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, nextVal] of Object.entries(updates)) {
    if (nextVal === undefined) continue;
    const prevVal = (before as Record<string, unknown>)[key];
    if (prevVal !== nextVal) {
      diff[key] = { before: prevVal, after: nextVal };
    }
  }
  return diff;
}

async function updateTenantFeatures(
  input: UpdateTenantFeaturesInput,
): Promise<TenantFeatures | null> {
  const tenant = await adminRepository.getTenantDetail(input.tenantId);
  if (!tenant) return null;

  const before = await tenantFeaturesRepository.getFeatures(input.tenantId);
  const changedFlags = diffFlags(before, input.updates);

  // Canonical write path — tenantFeaturesRepository owns cache invalidation.
  const updated = await tenantFeaturesRepository.updateFeatures(input.tenantId, input.updates);

  // Only audit when a real change occurred. Still return updated record either way.
  if (Object.keys(changedFlags).length > 0) {
    await platformAuditService.logTenantFeaturesUpdated(
      input.actor.id,
      input.actor.email,
      input.tenantId,
      changedFlags,
      input.req,
    );
  }

  return updated;
}

export const platformTenantsService = {
  searchTenants,
  getTenantDetail,
  getTenantFeatures,
  updateTenantFeatures,
};
