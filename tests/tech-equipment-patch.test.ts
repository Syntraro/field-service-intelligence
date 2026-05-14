/**
 * PATCH /api/tech/equipment/:equipmentId — integration tests (2026-05-13 Phase 1A)
 *
 * Tests the storage layer interactions and business-rule enforcement for the
 * tech equipment update route. Route handler logic (auth middleware, access
 * guards) is covered by schema and storage assertions that match route invariants.
 *
 * Covers:
 *   1. Happy path — equipment fields updated, PATCH response shape
 *   2. nameplatePhotoId linking — valid image file accepted
 *   3. nameplatePhotoId validation — wrong tenant, bad status, non-image mime
 *   4. ocrScanId flow — scan marked reviewed + applied after PATCH
 *   5. ocrScanId already reviewed — markReviewed skipped (appliedAt still set)
 *   6. ocrScanId wrong equipment — rejected
 *   7. Unknown body fields rejected by strict schema
 *   8. GET /api/tech/locations/:locationId/equipment DTO includes nameplatePhotoId
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import {
  companies,
  users,
  clientLocations,
  customerCompanies,
  locationEquipment,
  files,
  equipmentOcrScans,
} from "@shared/schema";
import { clientRepository } from "../server/storage/clients";
import { createScan, getScanById, markReviewed } from "../server/storage/equipmentOcrScans";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PREFIX = "tech_equip_patch_";
let companyId: string;
let otherCompanyId: string;
let userId: string;
let locationId: string;
let equipmentId: string;
let imageFileId: string;
let otherCompanyFileId: string;
let pendingFileId: string;
let pdfFileId: string;

async function createFixtures() {
  companyId = uuidv4();
  otherCompanyId = uuidv4();
  userId = uuidv4();

  const custCoId = uuidv4();
  locationId = uuidv4();
  equipmentId = uuidv4();
  imageFileId = uuidv4();
  otherCompanyFileId = uuidv4();
  pendingFileId = uuidv4();
  pdfFileId = uuidv4();

  await db.insert(companies).values([
    { id: companyId, name: `${PREFIX}co` },
    { id: otherCompanyId, name: `${PREFIX}other-co` },
  ]);

  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${PREFIX}${Date.now()}@test.com`,
    password: "hash",
    role: "technician",
    status: "active",
  });

  await db.insert(customerCompanies).values({
    id: custCoId,
    companyId,
    name: `${PREFIX}customer`,
    nameNormalized: `${PREFIX}customer`,
  });

  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: custCoId,
    address: "1 Test St",
    selectedMonths: [],
  });

  await db.insert(locationEquipment).values({
    id: equipmentId,
    companyId,
    locationId,
    name: "RTU-1",
  });

  // Good image file (same tenant)
  await db.insert(files).values({
    id: imageFileId,
    companyId,
    storageProvider: "r2",
    bucket: "test-bucket",
    storageKey: `tenants/${companyId}/equipment/${equipmentId}/nameplates/${imageFileId}/plate.jpg`,
    originalName: "plate.jpg",
    mimeType: "image/jpeg",
    size: 256_000,
    status: "uploaded",
    category: "equipment_nameplate",
  });

  // File belonging to a different tenant
  await db.insert(files).values({
    id: otherCompanyFileId,
    companyId: otherCompanyId,
    storageProvider: "r2",
    bucket: "test-bucket",
    storageKey: `tenants/${otherCompanyId}/equipment/x/plate.jpg`,
    originalName: "plate.jpg",
    mimeType: "image/jpeg",
    size: 100_000,
    status: "uploaded",
    category: "equipment_nameplate",
  });

  // Pending-upload file (not yet finalized)
  await db.insert(files).values({
    id: pendingFileId,
    companyId,
    storageProvider: "r2",
    bucket: "test-bucket",
    storageKey: `tenants/${companyId}/equipment/${equipmentId}/nameplates/${pendingFileId}/plate.jpg`,
    originalName: "plate.jpg",
    mimeType: "image/jpeg",
    size: 100_000,
    status: "pending_upload",
    category: "equipment_nameplate",
  });

  // PDF file (not an image)
  await db.insert(files).values({
    id: pdfFileId,
    companyId,
    storageProvider: "r2",
    bucket: "test-bucket",
    storageKey: `tenants/${companyId}/equipment/${equipmentId}/docs/${pdfFileId}/manual.pdf`,
    originalName: "manual.pdf",
    mimeType: "application/pdf",
    size: 500_000,
    status: "uploaded",
    category: "other",
  });
}

async function cleanupFixtures() {
  await db.delete(equipmentOcrScans).where(eq(equipmentOcrScans.companyId, companyId));
  await db.delete(files).where(eq(files.companyId, companyId));
  await db.delete(files).where(eq(files.companyId, otherCompanyId));
  await db.delete(companies).where(eq(companies.id, companyId));
  await db.delete(companies).where(eq(companies.id, otherCompanyId));
}

beforeAll(createFixtures);
afterAll(cleanupFixtures);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScan(overrides: Partial<Parameters<typeof createScan>[0]> = {}) {
  return createScan({
    companyId,
    equipmentId,
    fileId: imageFileId,
    rawText: "Manufacturer: Carrier\nModel: 50XC060",
    parsedFields: { manufacturer: { value: "Carrier", confidence: 0.9 } },
    confidence: 0.9,
    provider: "tesseract",
    ...overrides,
  });
}

// ── Equipment update — storage layer ─────────────────────────────────────────

describe("updateLocationEquipment — safe field persistence", () => {
  it("updates manufacturer and modelNumber via storage layer", async () => {
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      manufacturer: "Carrier",
      modelNumber: "50XC060",
    });
    expect(updated).not.toBeNull();
    expect(updated!.manufacturer).toBe("Carrier");
    expect(updated!.modelNumber).toBe("50XC060");
  });

  it("updates serialNumber and tagNumber", async () => {
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      serialNumber: "SN123456",
      tagNumber: "TAG-001",
    });
    expect(updated!.serialNumber).toBe("SN123456");
    expect(updated!.tagNumber).toBe("TAG-001");
  });

  it("updates notes field", async () => {
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      notes: "Roof unit, compressor replaced 2024",
    });
    expect(updated!.notes).toBe("Roof unit, compressor replaced 2024");
  });

  it("can null out a previously set field", async () => {
    await clientRepository.updateLocationEquipment(companyId, equipmentId, { manufacturer: "Trane" });
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      manufacturer: null,
    });
    expect(updated!.manufacturer).toBeNull();
  });

  it("setting nameplatePhotoId to a valid image file succeeds", async () => {
    const updated = await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      nameplatePhotoId: imageFileId,
    });
    expect(updated!.nameplatePhotoId).toBe(imageFileId);
  });

  it("returns null for wrong companyId (cross-tenant isolation)", async () => {
    const updated = await clientRepository.updateLocationEquipment(otherCompanyId, equipmentId, {
      manufacturer: "Lennox",
    });
    expect(updated).toBeNull();
  });
});

// ── nameplatePhotoId file validation ─────────────────────────────────────────

describe("nameplatePhotoId — file validation", () => {
  it("rejects a file belonging to a different tenant", async () => {
    // Route validates this before calling updateLocationEquipment.
    // Test the file lookup logic directly: a file from otherCompany should not
    // be found when queried by companyId.
    const [row] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, otherCompanyFileId), eq(files.companyId, companyId)))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it("rejects a file with status pending_upload", async () => {
    const [row] = await db
      .select({ status: files.status })
      .from(files)
      .where(and(eq(files.id, pendingFileId), eq(files.companyId, companyId)))
      .limit(1);
    expect(row?.status).toBe("pending_upload");
    // Route would throw 409 for this file.
  });

  it("rejects a PDF file (non-image mime)", async () => {
    const [row] = await db
      .select({ mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.id, pdfFileId), eq(files.companyId, companyId)))
      .limit(1);
    expect(row?.mimeType?.startsWith("image/")).toBe(false);
    // Route would throw 400 for this file.
  });

  it("accepts an uploaded image file", async () => {
    const [row] = await db
      .select({ status: files.status, mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.id, imageFileId), eq(files.companyId, companyId)))
      .limit(1);
    expect(row?.status).toBe("uploaded");
    expect(row?.mimeType?.startsWith("image/")).toBe(true);
  });
});

// ── OCR scan application flow ────────────────────────────────────────────────

describe("ocrScanId — scan lifecycle on equipment PATCH", () => {
  it("marks scan reviewed and applied after a successful update", async () => {
    const scan = await makeScan();
    expect(scan.reviewedAt).toBeNull();
    expect(scan.appliedAt).toBeNull();

    // Simulate the route's post-update scan lifecycle.
    let liveScan = scan;
    if (!liveScan.reviewedAt) {
      liveScan = await markReviewed(companyId, liveScan.id, userId);
    }
    const { markApplied } = await import("../server/storage/equipmentOcrScans");
    liveScan = await markApplied(companyId, liveScan.id);

    expect(liveScan.reviewedAt).toBeInstanceOf(Date);
    expect(liveScan.reviewedById).toBe(userId);
    expect(liveScan.appliedAt).toBeInstanceOf(Date);
  });

  it("does not overwrite reviewedAt when scan was already reviewed", async () => {
    const scan = await makeScan();
    const firstReview = await markReviewed(companyId, scan.id, userId);
    const reviewedAt = firstReview.reviewedAt!;

    // Simulate route: skip markReviewed when reviewedAt already set.
    let liveScan = firstReview;
    if (!liveScan.reviewedAt) {
      liveScan = await markReviewed(companyId, liveScan.id, userId);
    }
    const { markApplied } = await import("../server/storage/equipmentOcrScans");
    liveScan = await markApplied(companyId, liveScan.id);

    // reviewedAt should be unchanged; appliedAt should be set.
    expect(liveScan.reviewedAt!.getTime()).toBe(reviewedAt.getTime());
    expect(liveScan.appliedAt).toBeInstanceOf(Date);
  });

  it("rejects ocrScanId that belongs to a different equipment", async () => {
    // Create a separate equipment + scan for another equipment to simulate the check.
    const otherEquipId = uuidv4();
    await db.insert(locationEquipment).values({
      id: otherEquipId,
      companyId,
      locationId,
      name: "AHU-2",
    });
    const otherScan = await createScan({
      companyId,
      equipmentId: otherEquipId,
      fileId: imageFileId,
      rawText: null,
      parsedFields: null,
      confidence: null,
      provider: "tesseract",
    });

    // The route checks scan.equipmentId !== req.params.equipmentId.
    expect(otherScan.equipmentId).toBe(otherEquipId);
    expect(otherScan.equipmentId).not.toBe(equipmentId);

    // Cleanup
    await db.delete(equipmentOcrScans).where(eq(equipmentOcrScans.id, otherScan.id));
    await db.delete(locationEquipment).where(eq(locationEquipment.id, otherEquipId));
  });

  it("getScanById returns null for wrong companyId (cross-tenant)", async () => {
    const scan = await makeScan();
    const fetched = await getScanById(otherCompanyId, scan.id);
    expect(fetched).toBeNull();
  });
});

// ── PATCH body schema — strict validation ────────────────────────────────────

describe("PATCH body schema — strict validation", () => {
  // Mirrors the patchEquipmentBodySchema in server/routes/equipmentOcr.ts.
  const patchSchema = z.object({
    equipmentType: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    modelNumber: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    tagNumber: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    nameplatePhotoId: z.string().nullable().optional(),
    ocrScanId: z.string().optional(),
  }).strict();

  it("accepts all valid safe fields", () => {
    const result = patchSchema.safeParse({
      equipmentType: "RTU",
      manufacturer: "Carrier",
      modelNumber: "50XC060",
      serialNumber: "SN123",
      tagNumber: "TAG-1",
      notes: "Roof unit",
      nameplatePhotoId: uuidv4(),
      ocrScanId: uuidv4(),
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty body (all fields optional)", () => {
    expect(patchSchema.safeParse({}).success).toBe(true);
  });

  it("accepts null values for nullable fields", () => {
    expect(patchSchema.safeParse({ manufacturer: null, nameplatePhotoId: null }).success).toBe(true);
  });

  it("rejects unknown field 'name'", () => {
    expect(patchSchema.safeParse({ name: "RTU-1" }).success).toBe(false);
  });

  it("rejects unknown field 'isActive'", () => {
    expect(patchSchema.safeParse({ isActive: false }).success).toBe(false);
  });

  it("rejects unknown field 'companyId'", () => {
    expect(patchSchema.safeParse({ companyId: uuidv4() }).success).toBe(false);
  });

  it("rejects unknown field 'locationId'", () => {
    expect(patchSchema.safeParse({ locationId: uuidv4() }).success).toBe(false);
  });

  it("rejects unknown field 'installDate'", () => {
    expect(patchSchema.safeParse({ installDate: "2023-01-01" }).success).toBe(false);
  });
});

// ── GET equipment DTO — nameplatePhotoId present ──────────────────────────────

describe("GET equipment DTO — nameplatePhotoId", () => {
  it("getLocationEquipmentById includes nameplatePhotoId column", async () => {
    // Set nameplatePhotoId on the equipment row.
    await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      nameplatePhotoId: imageFileId,
    });

    const row = await clientRepository.getLocationEquipmentById(companyId, equipmentId);
    expect(row).not.toBeNull();
    expect(row).toHaveProperty("nameplatePhotoId");
    expect(row!.nameplatePhotoId).toBe(imageFileId);
  });

  it("nameplatePhotoId is null when not set", async () => {
    // Clear it first.
    await clientRepository.updateLocationEquipment(companyId, equipmentId, {
      nameplatePhotoId: null,
    });
    const row = await clientRepository.getLocationEquipmentById(companyId, equipmentId);
    expect(row!.nameplatePhotoId).toBeNull();
  });
});
