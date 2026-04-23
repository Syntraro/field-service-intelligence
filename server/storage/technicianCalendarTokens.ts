/**
 * Technician Calendar Tokens — canonical repository.
 *
 * 2026-04-23 Phase 1: per-technician private calendar subscription tokens.
 * One row per user, rotation overwrites `token`, disable flips `is_active`.
 *
 * The token IS the secret — it is never embedded alongside the user id in
 * the feed URL. `resolveByToken()` is the only read path that operates
 * without a tenant scope; every other method is tenant-scoped.
 */

import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  technicianCalendarTokens,
  type TechnicianCalendarToken,
} from "@shared/schema";
import { BaseRepository } from "./base";

/** 32 random bytes → 43-char URL-safe base64. 256 bits of entropy. */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export class TechnicianCalendarTokenRepository extends BaseRepository {
  /** Read the current token row for a user. `null` if none has been created. */
  async getByUserId(
    companyId: string,
    userId: string,
  ): Promise<TechnicianCalendarToken | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const [row] = await db
      .select()
      .from(technicianCalendarTokens)
      .where(and(
        eq(technicianCalendarTokens.companyId, companyId),
        eq(technicianCalendarTokens.userId, userId),
      ))
      .limit(1);
    return row ?? null;
  }

  /**
   * Ensure a row exists for the user. If none exists, create one with a
   * fresh token and `is_active = true`. If one exists, return it unchanged
   * (even if inactive — re-enabling is a separate call).
   */
  async ensureToken(
    companyId: string,
    userId: string,
  ): Promise<TechnicianCalendarToken> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const existing = await this.getByUserId(companyId, userId);
    if (existing) return existing;

    const [row] = await db
      .insert(technicianCalendarTokens)
      .values({
        companyId,
        userId,
        token: generateToken(),
        isActive: true,
      })
      .returning();
    return row;
  }

  /**
   * Replace the current token with a fresh random value. Invalidates any
   * existing subscription URL immediately — external calendar apps will
   * start getting 404s on the old URL at their next refresh interval.
   * Creates the row if none exists (same semantics as `ensureToken` + rotate).
   */
  async rotateToken(
    companyId: string,
    userId: string,
  ): Promise<TechnicianCalendarToken> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const existing = await this.getByUserId(companyId, userId);
    if (!existing) {
      // No row yet — initial create is effectively a rotation from "nothing".
      return this.ensureToken(companyId, userId);
    }

    const [row] = await db
      .update(technicianCalendarTokens)
      .set({
        token: generateToken(),
        // Rotating re-activates if it was disabled; operators expect "new
        // link works" after pressing regenerate.
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(
        eq(technicianCalendarTokens.companyId, companyId),
        eq(technicianCalendarTokens.userId, userId),
      ))
      .returning();
    return row;
  }

  /** Flip is_active. Preserves the token string so re-enabling restores the same URL. */
  async setActive(
    companyId: string,
    userId: string,
    active: boolean,
  ): Promise<TechnicianCalendarToken | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const [row] = await db
      .update(technicianCalendarTokens)
      .set({ isActive: active, updatedAt: new Date() })
      .where(and(
        eq(technicianCalendarTokens.companyId, companyId),
        eq(technicianCalendarTokens.userId, userId),
      ))
      .returning();
    return row ?? null;
  }

  /**
   * Public-endpoint lookup — resolves an active token to a
   * `{ companyId, userId }` pair. No tenant scope by design: the token
   * IS the authentication. Returns `null` for unknown or disabled tokens
   * so the public route can respond with a consistent 404 (not 403).
   */
  async resolveByToken(
    token: string,
  ): Promise<{ companyId: string; userId: string } | null> {
    if (!token || typeof token !== "string") return null;

    const [row] = await db
      .select({
        companyId: technicianCalendarTokens.companyId,
        userId: technicianCalendarTokens.userId,
      })
      .from(technicianCalendarTokens)
      .where(and(
        eq(technicianCalendarTokens.token, token),
        eq(technicianCalendarTokens.isActive, true),
      ))
      .limit(1);
    return row ?? null;
  }

  /** Best-effort last-accessed bookkeeping. Non-fatal on failure. */
  async touchLastAccessed(token: string): Promise<void> {
    if (!token) return;
    try {
      await db
        .update(technicianCalendarTokens)
        .set({ lastAccessedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(technicianCalendarTokens.token, token));
    } catch {
      // Subscription feeds poll frequently; a transient update failure
      // must never break the ICS response.
    }
  }
}

export const technicianCalendarTokenRepository = new TechnicianCalendarTokenRepository();
