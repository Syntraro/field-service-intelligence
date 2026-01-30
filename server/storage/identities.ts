import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { userIdentities, users } from "@shared/schema";
import type { UserIdentity, User } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Identity repository - handles user login identities (email, SSO).
 * Enables safe email changes and multiple login methods per user.
 */
export class IdentityRepository extends BaseRepository {
  /**
   * Normalize email for consistent storage/lookup
   */
  private normalizeEmail(email: string): string {
    return (email || "").trim().toLowerCase();
  }

  /**
   * Get email identity for a user in a company
   */
  async getEmailIdentity(companyId: string, email: string): Promise<UserIdentity | null> {
    this.assertCompanyId(companyId);
    const normalized = this.normalizeEmail(email);

    const rows = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.provider, "email"),
          eq(userIdentities.identifier, normalized)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get identity by provider and identifier (for SSO)
   */
  async getIdentity(
    companyId: string,
    provider: string,
    identifier: string
  ): Promise<UserIdentity | null> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.provider, provider),
          eq(userIdentities.identifier, identifier)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get all identities for a user
   */
  async getUserIdentities(companyId: string, userId: string): Promise<UserIdentity[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    return await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.userId, userId)
        )
      );
  }

  /**
   * Get primary email for a user (prefer verified, then oldest)
   */
  async getPrimaryEmailForUser(companyId: string, userId: string): Promise<string | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const identities = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, "email")
        )
      )
      .orderBy(userIdentities.verifiedAt, userIdentities.createdAt);

    // Prefer verified identity
    const verified = identities.find(i => i.verifiedAt);
    if (verified) return verified.identifier;

    // Fallback to first email identity
    return identities[0]?.identifier ?? null;
  }

  /**
   * Create email identity for a user
   */
  async createEmailIdentity(
    companyId: string,
    userId: string,
    email: string,
    passwordHash: string | null,
    verified: boolean = false
  ): Promise<UserIdentity> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const normalized = this.normalizeEmail(email);

    const rows = await db
      .insert(userIdentities)
      .values({
        companyId,
        userId,
        provider: "email",
        identifier: normalized,
        passwordHash,
        verifiedAt: verified ? new Date() : null,
      })
      .returning();

    return rows[0];
  }

  /**
   * Update email identity (change email address)
   */
  async updateEmailIdentity(
    companyId: string,
    userId: string,
    newEmail: string,
    options?: { setVerified?: boolean }
  ): Promise<UserIdentity | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const normalized = this.normalizeEmail(newEmail);

    // Find existing email identity for this user
    const existing = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, "email")
        )
      )
      .limit(1);

    if (!existing[0]) return null;

    const updateData: Partial<UserIdentity> = {
      identifier: normalized,
      updatedAt: new Date(),
    };

    if (options?.setVerified) {
      updateData.verifiedAt = new Date();
    }

    const rows = await db
      .update(userIdentities)
      .set(updateData)
      .where(eq(userIdentities.id, existing[0].id))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Set password for email identity
   */
  async setEmailPassword(
    companyId: string,
    userId: string,
    passwordHash: string,
    verify: boolean = true
  ): Promise<UserIdentity | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const updateData: Partial<UserIdentity> = {
      passwordHash,
      updatedAt: new Date(),
    };

    if (verify) {
      updateData.verifiedAt = new Date();
    }

    const rows = await db
      .update(userIdentities)
      .set(updateData)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, "email")
        )
      )
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Create SSO identity (for OAuth providers)
   */
  async createSsoIdentity(
    companyId: string,
    userId: string,
    provider: string,
    subjectId: string
  ): Promise<UserIdentity> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const rows = await db
      .insert(userIdentities)
      .values({
        companyId,
        userId,
        provider,
        identifier: subjectId,
        verifiedAt: new Date(), // SSO identities are verified by the provider
      })
      .returning();

    return rows[0];
  }

  /**
   * Delete an identity
   */
  async deleteIdentity(companyId: string, identityId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(identityId, "identityId");

    const result = await db
      .delete(userIdentities)
      .where(
        and(
          eq(userIdentities.id, identityId),
          eq(userIdentities.companyId, companyId)
        )
      )
      .returning({ id: userIdentities.id });

    return result.length > 0;
  }

  /**
   * Check if email is available in a company (for email changes)
   * @deprecated Use isEmailGloballyAvailable instead for global uniqueness
   */
  async isEmailAvailable(companyId: string, email: string, excludeUserId?: string): Promise<boolean> {
    this.assertCompanyId(companyId);

    const normalized = this.normalizeEmail(email);

    const existing = await db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.provider, "email"),
          eq(userIdentities.identifier, normalized)
        )
      )
      .limit(1);

    if (!existing[0]) return true;
    if (excludeUserId && existing[0].userId === excludeUserId) return true;

    return false;
  }

  /**
   * Check if email is available GLOBALLY across all companies.
   * Enforces policy: one email can only belong to one company.
   * Returns { available: true } or { available: false, reason: string }
   */
  async isEmailGloballyAvailable(
    email: string,
    excludeUserId?: string
  ): Promise<{ available: boolean; reason?: string; existingCompanyId?: string }> {
    const normalized = this.normalizeEmail(email);

    const existing = await db
      .select({
        userId: userIdentities.userId,
        companyId: userIdentities.companyId,
      })
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, "email"),
          eq(userIdentities.identifier, normalized)
        )
      )
      .limit(1);

    if (!existing[0]) {
      return { available: true };
    }

    // If we're excluding a userId (e.g., updating own email), allow it
    if (excludeUserId && existing[0].userId === excludeUserId) {
      return { available: true };
    }

    return {
      available: false,
      reason: "This email is already in use. Each email can only belong to one company.",
      existingCompanyId: existing[0].companyId,
    };
  }

  /**
   * Get user with identity for login
   * Returns user + identity for password verification
   */
  async getUserWithEmailIdentity(
    companyId: string,
    email: string
  ): Promise<{ user: User; identity: UserIdentity } | null> {
    this.assertCompanyId(companyId);

    const normalized = this.normalizeEmail(email);

    const result = await db
      .select({
        user: users,
        identity: userIdentities,
      })
      .from(userIdentities)
      .innerJoin(users, eq(userIdentities.userId, users.id))
      .where(
        and(
          eq(userIdentities.companyId, companyId),
          eq(userIdentities.provider, "email"),
          eq(userIdentities.identifier, normalized)
        )
      )
      .limit(1);

    if (!result[0]) return null;

    return {
      user: result[0].user,
      identity: result[0].identity,
    };
  }

  /**
   * Find user by email across all companies (for login without company context)
   * Returns the first match - should only be used when user doesn't specify company
   */
  async findUserByEmailGlobal(email: string): Promise<{ user: User; identity: UserIdentity } | null> {
    const normalized = this.normalizeEmail(email);

    const result = await db
      .select({
        user: users,
        identity: userIdentities,
      })
      .from(userIdentities)
      .innerJoin(users, eq(userIdentities.userId, users.id))
      .where(
        and(
          eq(userIdentities.provider, "email"),
          eq(userIdentities.identifier, normalized)
        )
      )
      .limit(1);

    if (!result[0]) return null;

    return {
      user: result[0].user,
      identity: result[0].identity,
    };
  }
}

export const identityRepository = new IdentityRepository();
