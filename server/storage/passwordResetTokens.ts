/**
 * PasswordResetTokens repository (2026-04-15).
 *
 * Thin DB layer over the pre-existing `password_reset_tokens` table
 * (`shared/schema.ts:227`). No business logic — the reset-token lifecycle
 * (expiry, issuance policy, email) lives in
 * `server/services/passwordResetService.ts`.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { passwordResetTokens } from "@shared/schema";
import { BaseRepository } from "./base";

export interface PasswordResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  requestedIp: string | null;
}

export class PasswordResetTokenRepository extends BaseRepository {
  /** Insert a newly-issued (unused) token row. */
  async insertToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<PasswordResetTokenRow> {
    this.validateUUID(input.userId, "userId");
    const rows = await db
      .insert(passwordResetTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        requestedIp: input.requestedIp,
      })
      .returning();
    return rows[0] as PasswordResetTokenRow;
  }

  /**
   * Look up an *active* token by its hash. Active = not used, not expired.
   * Returns null otherwise. Callers must still treat any non-null result
   * as single-use and mark it consumed after a successful password update.
   */
  async findActiveByHash(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const now = new Date();
    const rows = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return (rows[0] as PasswordResetTokenRow) ?? null;
  }

  /** Mark a token consumed (sets `usedAt = now`). */
  async markUsed(id: string): Promise<void> {
    this.validateUUID(id, "id");
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  /**
   * Invalidate every still-active (unused) token for a user. Called right
   * before issuing a new token so only the most recent reset link in the
   * user's inbox ever works.
   */
  async invalidateActiveForUser(userId: string): Promise<void> {
    this.validateUUID(userId, "userId");
    const now = new Date();
    await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
  }
}

export const passwordResetTokenRepository = new PasswordResetTokenRepository();
