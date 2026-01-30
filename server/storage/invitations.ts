import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { invitations, users, userIdentities } from "@shared/schema";
import { BaseRepository } from "./base";
import { identityRepository } from "./identities";

const INVITE_TTL_DAYS = 7;

/**
 * Invitation repository - handles all invitation-related database operations.
 * Ensures tenant isolation via companyId scoping.
 */
export class InvitationRepository extends BaseRepository {
  /**
   * Normalize email for consistent lookups
   */
  private normalizeEmail(email: string): string {
    return (email || "").trim().toLowerCase();
  }

  /**
   * Generate a secure invitation token
   */
  private generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Calculate expiration date
   */
  private getExpirationDate(): Date {
    return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Create a new invitation
   * @throws Error if invitation already exists or email is used in another company
   */
  async createInvitation(companyId: string, email: string, role: string) {
    this.assertCompanyId(companyId);

    const normalized = this.normalizeEmail(email);
    const token = this.generateToken();
    const expiresAt = this.getExpirationDate();

    // Check global email uniqueness - email can only belong to one company
    const globalCheck = await identityRepository.isEmailGloballyAvailable(normalized);
    if (!globalCheck.available) {
      throw new Error(
        "This email is already in use in another company. " +
        "Each email can only belong to one company. " +
        "If this person works for multiple companies, they must use a different email."
      );
    }

    // Check for existing pending invitation in this company
    const [existingInvitation] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.companyId, companyId),
          eq(invitations.email, normalized),
          eq(invitations.status, "pending")
        )
      )
      .limit(1);

    if (existingInvitation) {
      throw new Error("Invitation already exists for this email");
    }

    await db.insert(invitations).values({
      companyId,
      email: normalized,
      role,
      token,
      status: "pending",
      expiresAt,
    });

    return { token, expiresAt };
  }

  /**
   * Accept an invitation and create a user with email identity
   * @throws Error if invitation is invalid, expired, or email already exists
   */
  async acceptInvitation(token: string, password: string) {
    return db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.token, token))
        .limit(1);

      if (!invite || invite.status !== "pending") {
        throw new Error("Invalid invitation");
      }

      if (invite.expiresAt && new Date(invite.expiresAt as any) < new Date()) {
        throw new Error("Invitation expired");
      }

      const normalizedEmail = this.normalizeEmail(invite.email);

      // Double-check global email uniqueness before proceeding
      // (in case email was taken between invitation creation and acceptance)
      const globalCheck = await identityRepository.isEmailGloballyAvailable(normalizedEmail);
      if (!globalCheck.available) {
        throw new Error(
          "This email is already in use. " +
          "Each email can only belong to one company. " +
          "Please contact your administrator for assistance."
        );
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user bound to the company
      const [created] = await tx
        .insert(users)
        .values({
          companyId: invite.companyId,
          email: normalizedEmail, // Keep email on user for display/legacy
          password: passwordHash, // Legacy field - keep for backward compat
          role: invite.role,
          status: "active",
        } as any)
        .returning();

      // Create email identity for login
      await tx
        .insert(userIdentities)
        .values({
          companyId: invite.companyId,
          userId: created.id,
          provider: "email",
          identifier: normalizedEmail,
          passwordHash, // Password stored on identity
          verifiedAt: new Date(), // Verified by accepting invite
        });

      await tx
        .update(invitations)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(invitations.id, invite.id));

      return created;
    });
  }

  /**
   * Resend an invitation (regenerate token)
   * SECURITY: Requires companyId for tenant isolation
   * @throws Error if invitation not found or not pending
   */
  async resendInvitation(companyId: string, invitationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invitationId, "invitationId");

    const [invite] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.companyId, companyId) // CRITICAL: Tenant isolation
        )
      )
      .limit(1);

    if (!invite) {
      throw new Error("Invitation not found");
    }

    if (invite.status !== "pending") {
      throw new Error("Cannot resend invitation");
    }

    const token = this.generateToken();
    const expiresAt = this.getExpirationDate();

    await db
      .update(invitations)
      .set({ token, expiresAt })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.companyId, companyId) // Double-check tenant isolation
        )
      );

    return { token, expiresAt };
  }

  /**
   * Get invitation by ID (tenant-scoped)
   */
  async getInvitation(companyId: string, invitationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invitationId, "invitationId");

    const [invite] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.companyId, companyId)
        )
      )
      .limit(1);

    return invite ?? null;
  }

  /**
   * Get all invitations for a company
   */
  async getInvitationsByCompany(companyId: string) {
    this.assertCompanyId(companyId);

    return await db
      .select()
      .from(invitations)
      .where(eq(invitations.companyId, companyId));
  }

  /**
   * Cancel an invitation
   */
  async cancelInvitation(companyId: string, invitationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(invitationId, "invitationId");

    const [updated] = await db
      .update(invitations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.companyId, companyId),
          eq(invitations.status, "pending")
        )
      )
      .returning();

    return !!updated;
  }
}

export const invitationRepository = new InvitationRepository();
