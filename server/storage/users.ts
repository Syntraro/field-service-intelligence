import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { users, companies } from "@shared/schema";
import type { InsertUser, User, AuthenticatedUser } from "@shared/schema";
import { BaseRepository } from "./base";

export class UserRepository extends BaseRepository {
  /**
   * Get user by ID
   */
  async getUser(id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get user by email (normalized)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const normalized = (email || "").trim().toLowerCase();
    const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Get authenticated user with company subscription data
   * Used by Passport serialization
   */
  async getAuthenticatedUser(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.getUser(id);
    if (!user) return null;

    const company = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
    if (!company[0]) return null;

    return {
      ...user,
      trialEndsAt: company[0].trialEndsAt,
      subscriptionStatus: company[0].subscriptionStatus,
      subscriptionPlan: company[0].subscriptionPlan,
      stripeCustomerId: company[0].stripeCustomerId,
      stripeSubscriptionId: company[0].stripeSubscriptionId,
      billingInterval: company[0].billingInterval,
      currentPeriodEnd: company[0].currentPeriodEnd,
      cancelAtPeriodEnd: company[0].cancelAtPeriodEnd,
    };
  }

  /**
   * Create new user
   */
  async createUser(userData: InsertUser): Promise<User> {
    const email = userData.email.trim().toLowerCase();
    const rows = await db.insert(users).values({ ...userData, email }).returning();
    return rows[0];
  }

  /**
   * Update user
   */
  async updateUser(id: string, patch: Partial<User>): Promise<User | null> {
    const rows = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    return rows[0] ?? null;
  }

  /**
   * Get company by ID
   */
  async getCompanyById(companyId: string) {
    const rows = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    return rows[0] ?? null;
  }

  // ========================================
  // ADMIN USER MANAGEMENT (tenant-scoped)
  // ========================================

  /**
   * Get user by ID within a company (tenant-scoped)
   */
  async getUserByCompany(companyId: string, userId: string): Promise<User | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Update user role (tenant-scoped)
   * @throws Error if user not found in company
   */
  async updateUserRole(companyId: string, userId: string, role: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const result = await db
      .update(users)
      .set({ role })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning({ id: users.id });

    if (!result || result.length === 0) {
      throw this.notFoundError("User");
    }

    return true;
  }

  /**
   * Disable a user (tenant-scoped)
   * @throws Error if user not found in company
   */
  async disableUser(companyId: string, userId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const result = await db
      .update(users)
      .set({ disabled: true })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning({ id: users.id });

    if (!result || result.length === 0) {
      throw this.notFoundError("User");
    }

    return true;
  }

  /**
   * Enable a user (tenant-scoped)
   * @throws Error if user not found in company
   */
  async enableUser(companyId: string, userId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(userId, "userId");

    const result = await db
      .update(users)
      .set({ disabled: false })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .returning({ id: users.id });

    if (!result || result.length === 0) {
      throw this.notFoundError("User");
    }

    return true;
  }
}

export const userRepository = new UserRepository();