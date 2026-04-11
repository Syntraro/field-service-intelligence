/**
 * Feedback Storage Layer
 *
 * CRUD for the `feedback` table. Simple internal tracking — no email, no
 * notifications. Feedback is company-scoped (multi-tenant).
 *
 * 2026-04-10: Created to back the existing FeedbackDialog + Admin feedback
 * tab that were calling non-existent endpoints.
 */

import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { feedback } from "@shared/schema";
import type { Feedback, InsertFeedback } from "@shared/schema";
import { BaseRepository } from "./base";

class FeedbackRepository extends BaseRepository {
  async create(
    companyId: string,
    userId: string,
    userEmail: string,
    input: { category: string; message: string },
  ): Promise<Feedback> {
    this.assertCompanyId(companyId);

    const [row] = await db
      .insert(feedback)
      .values({
        companyId,
        userId,
        userEmail,
        category: input.category,
        message: input.message,
        status: "new",
        archived: false,
      })
      .returning();

    return row;
  }

  async list(companyId: string): Promise<Feedback[]> {
    this.assertCompanyId(companyId);

    return db
      .select()
      .from(feedback)
      .where(eq(feedback.companyId, companyId))
      .orderBy(desc(feedback.createdAt));
  }

  async updateStatus(
    companyId: string,
    feedbackId: string,
    status: string,
  ): Promise<Feedback | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(feedbackId, "feedbackId");

    const [row] = await db
      .update(feedback)
      .set({ status })
      .where(and(eq(feedback.id, feedbackId), eq(feedback.companyId, companyId)))
      .returning();

    return row ?? null;
  }

  async updateArchived(
    companyId: string,
    feedbackId: string,
    archived: boolean,
  ): Promise<Feedback | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(feedbackId, "feedbackId");

    const [row] = await db
      .update(feedback)
      .set({ archived })
      .where(and(eq(feedback.id, feedbackId), eq(feedback.companyId, companyId)))
      .returning();

    return row ?? null;
  }

  async delete(companyId: string, feedbackId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(feedbackId, "feedbackId");

    const [row] = await db
      .delete(feedback)
      .where(and(eq(feedback.id, feedbackId), eq(feedback.companyId, companyId)))
      .returning({ id: feedback.id });

    return !!row;
  }
}

export const feedbackRepository = new FeedbackRepository();
