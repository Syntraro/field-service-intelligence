import { db } from "../db";
import { technicians } from "@shared/schema";

export async function createTechnician(companyId: string, name: string, userId?: string) {
  const result = await db
    .insert(technicians)
    .values({ companyId, name, userId })
    .returning();
  return result[0];
}
