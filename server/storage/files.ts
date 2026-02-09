import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { files } from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * FilesRepository — tenant-scoped file metadata CRUD.
 * Manages DB records only; disk I/O handled in the upload route.
 */
export class FilesRepository extends BaseRepository {
  /** Insert file metadata row after upload. */
  async createFile(
    companyId: string,
    userId: string,
    data: { storageKey: string; originalName?: string; mimeType?: string; size?: number }
  ) {
    this.assertCompanyId(companyId);
    const [row] = await db
      .insert(files)
      .values({ companyId, createdBy: userId, ...data })
      .returning();
    return row;
  }

  /** Lookup a single file (tenant-scoped). */
  async getFile(companyId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(fileId, "fileId");
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .limit(1);
    return row ?? null;
  }

  /** Hard-delete file metadata. Returns the row so caller can remove disk file. */
  async deleteFile(companyId: string, fileId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(fileId, "fileId");
    const [row] = await db
      .delete(files)
      .where(and(eq(files.id, fileId), eq(files.companyId, companyId)))
      .returning();
    return row ?? null;
  }
}

export const filesRepository = new FilesRepository();
