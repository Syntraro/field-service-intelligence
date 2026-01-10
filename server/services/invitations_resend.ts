
import crypto from "crypto";
import { db } from "../db";
import { invitations } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function resendInvitation(id: string) {
  const invite = await db.query.invitations.findFirst({
    where: eq(invitations.id, id)
  });

  if (!invite || invite.status !== "pending") {
    throw new Error("Cannot resend invitation");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.update(invitations)
    .set({ token, expiresAt })
    .where(eq(invitations.id, id));

  return token;
}
