
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { invitations, users } from "@shared/schema";

const INVITE_TTL_DAYS = 7;

function normalizeEmail(email: string) {
  return (email || "").trim().toLowerCase();
}

export async function createInvitation(companyId: string, email: string, role: string) {
  const normalized = normalizeEmail(email);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const existing = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.companyId, companyId), eq(invitations.email, normalized), eq(invitations.status, "pending")))
    .limit(1);

  if (existing.length) throw new Error("Invitation already exists");

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

export async function acceptInvitation(token: string, password: string) {
  return db.transaction(async (tx) => {
    const inviteRows = await tx.select().from(invitations).where(eq(invitations.token, token)).limit(1);
    const invite = inviteRows[0];
    if (!invite || invite.status !== "pending") throw new Error("Invalid invitation");
    if (invite.expiresAt && new Date(invite.expiresAt as any) < new Date()) throw new Error("Invitation expired");

    // Create user bound to the company (single-company model)
    const created = await tx
      .insert(users)
      .values({
        companyId: invite.companyId,
        email: invite.email,
        password, // expected to be hashed by existing auth layer
        role: invite.role,
        status: "active",
      } as any)
      .returning();

    await tx
      .update(invitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id));

    return created[0];
  });
}

export async function resendInvitation(companyId: string, invitationId: string) {
  const inviteRows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), eq(invitations.companyId, companyId)))
    .limit(1);
  const invite = inviteRows[0];
  if (!invite) throw new Error("Invitation not found");
  if (invite.status !== "pending") throw new Error("Cannot resend invitation");

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.update(invitations).set({ token, expiresAt }).where(eq(invitations.id, invitationId));
  return { token, expiresAt };
}
