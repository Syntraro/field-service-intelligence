/**
 * OCR routes — HTTP-layer integration tests (2026-05-13 Phase 1B hardening)
 *
 * Exercises the actual Express route handlers via supertest so that:
 *   - Response shape contracts are caught at the HTTP boundary (not just storage)
 *   - scanId is wired through from createScan → response body
 *   - No provider credentials or signed URLs surface in any response
 *   - PATCH with ocrScanId marks the exact persisted scan applied
 *
 * Pattern: minimal makeApp() harness with injected auth (admin role bypasses
 * assertCanAccessTechLocation assignment check) + vi.mock() for OcrService
 * (avoids R2 dependency) + real DB for fixture rows and scan verification.
 *
 * Covers:
 *   1. POST /ocr-nameplate — 200 with correct OcrNameplateResult shape
 *   2. POST — response includes scanId
 *   3. POST — scanId matches a persisted equipment_ocr_scans row
 *   4. POST — response body contains no credential-like keys
 *   5. POST — response body contains no signed-URL keys (uploadUrl, signedUrl)
 *   6. POST — 400 on missing fileId in body
 *   7. POST — 401 when unauthenticated
 *   8. POST — 404 when equipmentId does not exist in tenant
 *   9. POST — 403 when equipmentId belongs to a different tenant
 *  10. PATCH with ocrScanId — scan marked applied after successful update
 *  11. PATCH with ocrScanId — scan marked reviewed first if not already reviewed
 *  12. PATCH with ocrScanId — preserves existing reviewedAt when already reviewed
 *  13. PATCH with ocrScanId from different equipment — 400
 *  14. PATCH — 400 on unknown field in body (strict schema)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";

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
import { getScanById } from "../server/storage/equipmentOcrScans";

// ── OcrService mock ──────────────────────────────────────────────────────────
// Must be declared before the router import so vitest's module-level hoisting
// replaces the module before equipmentOcrRouter is evaluated.

vi.mock("../server/services/ocr/OcrService", () => ({
  extractNameplateFromFile: vi.fn(),
  _injectProvider: vi.fn(),
  _resetProviderCache: vi.fn(),
}));

import equipmentOcrRouter from "../server/routes/equipmentOcr";
import { extractNameplateFromFile } from "../server/services/ocr/OcrService";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PREFIX = "ocr_http_test_";
let companyId: string;
let otherCompanyId: string;
let userId: string;
let locationId: string;
let equipmentId: string;
let otherEquipmentId: string;
let fileId: string;

const MOCK_OCR_RESULT = {
  rawText: "Manufacturer: Carrier\nModel No: 50XC060\nSerial No: 1234ABCD",
  fields: {
    manufacturer: { value: "Carrier",  confidence: 0.92 },
    modelNumber:  { value: "50XC060",  confidence: 0.88 },
    serialNumber: { value: "1234ABCD", confidence: 0.85 },
  },
  overallConfidence: 0.88,
  provider: "tesseract",
  scannedAt: new Date().toISOString(),
};

async function seedFixtures() {
  companyId      = uuidv4();
  otherCompanyId = uuidv4();
  userId         = uuidv4();
  locationId     = uuidv4();
  equipmentId    = uuidv4();
  otherEquipmentId = uuidv4();
  fileId         = uuidv4();

  const custCoId = uuidv4();

  await db.insert(companies).values([
    { id: companyId,      name: `${PREFIX}co` },
    { id: otherCompanyId, name: `${PREFIX}other-co` },
  ]);

  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${PREFIX}${Date.now()}@test.com`,
    password: "hash",
    role: "admin",
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

  await db.insert(locationEquipment).values([
    {
      id: equipmentId,
      companyId,
      locationId,
      name: "RTU-HTTP-Test",
    },
    {
      id: otherEquipmentId,
      companyId,
      locationId,
      name: "AHU-HTTP-Test",
    },
  ]);

  await db.insert(files).values({
    id: fileId,
    companyId,
    storageProvider: "r2",
    bucket: "test-bucket",
    storageKey: `tenants/${companyId}/equipment/${equipmentId}/nameplates/${fileId}/plate.jpg`,
    originalName: "plate.jpg",
    mimeType: "image/jpeg",
    size: 300_000,
    status: "uploaded",
    category: "equipment_nameplate",
  });
}

async function cleanupFixtures() {
  await db.delete(equipmentOcrScans).where(eq(equipmentOcrScans.companyId, companyId));
  await db.delete(files).where(eq(files.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
  await db.delete(companies).where(eq(companies.id, otherCompanyId));
}

beforeAll(seedFixtures);
afterAll(cleanupFixtures);

// ── App harness ───────────────────────────────────────────────────────────────

let activeUser: { id: string; companyId: string; role: string } | null = null;

function makeApp() {
  const app = express();
  app.use(express.json());

  // Inject auth — bypasses real Passport session.
  // Admin role → assertCanAccessTechLocation bypasses assignment check.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!activeUser) {
      (req as any).user = undefined;
    } else {
      (req as any).user = {
        id: activeUser.id,
        companyId: activeUser.companyId,
        role: activeUser.role,
        // isSchedulable not set to false → requireSchedulable passes
      };
      (req as any).companyId = activeUser.companyId;
    }
    next();
  });

  app.use("/api/tech/equipment", equipmentOcrRouter);

  // Central error handler matching production shape.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message ?? "Server error" });
  });

  return app;
}

const app = makeApp();

// ── POST /api/tech/equipment/:equipmentId/ocr-nameplate ───────────────────────

describe("POST /api/tech/equipment/:equipmentId/ocr-nameplate — response shape", () => {
  beforeAll(() => {
    activeUser = { id: userId, companyId, role: "admin" };
    (extractNameplateFromFile as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_OCR_RESULT);
  });

  it("1. returns 200 with OcrNameplateResult shape", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rawText");
    expect(res.body).toHaveProperty("fields");
    expect(res.body).toHaveProperty("overallConfidence");
    expect(res.body).toHaveProperty("provider");
    expect(res.body).toHaveProperty("scannedAt");
  });

  it("2. response includes scanId", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("scanId");
    expect(typeof res.body.scanId).toBe("string");
    expect(res.body.scanId.length).toBeGreaterThan(0);
  });

  it("3. scanId matches a persisted equipment_ocr_scans row", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(200);
    const { scanId } = res.body;

    const row = await getScanById(companyId, scanId);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(scanId);
    expect(row!.equipmentId).toBe(equipmentId);
    expect(row!.companyId).toBe(companyId);
    expect(row!.fileId).toBe(fileId);
    expect(row!.provider).toBe("tesseract");
  });

  it("4. response body contains no credential-like keys", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(200);
    const bodyJson = JSON.stringify(res.body);
    // Ensure no API key, secret, token, password, or credential surfaces.
    expect(bodyJson).not.toMatch(/\b(apiKey|api_key|secret|password|credential)\b/i);
    // Provider-specific credential fields.
    expect(bodyJson).not.toMatch(/Authorization|Bearer/);
  });

  it("5. response body contains no signed-URL or internal storage fields", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).not.toHaveProperty("uploadUrl");
    expect(body).not.toHaveProperty("signedUrl");
    expect(body).not.toHaveProperty("storageKey");
    expect(body).not.toHaveProperty("bucket");
    // Internal OCR worker state should not leak.
    expect(body).not.toHaveProperty("workerPath");
    expect(body).not.toHaveProperty("langPath");
  });

  it("6. returns 400 on missing fileId in body", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("7. returns 401 when unauthenticated", async () => {
    activeUser = null;
    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(401);
    activeUser = { id: userId, companyId, role: "admin" };
  });

  it("8. returns 404 when equipmentId does not exist in tenant", async () => {
    const res = await request(app)
      .post(`/api/tech/equipment/${uuidv4()}/ocr-nameplate`)
      .send({ fileId });

    expect(res.status).toBe(404);
  });

  it("9. returns 404 or 403 when equipment belongs to a different tenant", async () => {
    // Set activeUser to a user in otherCompanyId.
    activeUser = { id: uuidv4(), companyId: otherCompanyId, role: "admin" };

    const res = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });

    // The equipment query filters by companyId → 404 (equipment not found for this tenant).
    expect([403, 404]).toContain(res.status);

    activeUser = { id: userId, companyId, role: "admin" };
  });
});

// ── PATCH with ocrScanId — scan lifecycle ────────────────────────────────────

describe("PATCH /api/tech/equipment/:equipmentId — ocrScanId lifecycle", () => {
  beforeAll(() => {
    activeUser = { id: userId, companyId, role: "admin" };
    (extractNameplateFromFile as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_OCR_RESULT);
  });

  it("10. PATCH with ocrScanId marks scan applied", async () => {
    // POST first to get a scanId.
    const postRes = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });
    expect(postRes.status).toBe(200);
    const { scanId } = postRes.body;

    // PATCH with the scanId.
    const patchRes = await request(app)
      .patch(`/api/tech/equipment/${equipmentId}`)
      .send({ manufacturer: "Carrier", ocrScanId: scanId });
    expect(patchRes.status).toBe(200);

    // Verify the scan row has appliedAt set.
    const row = await getScanById(companyId, scanId);
    expect(row).not.toBeNull();
    expect(row!.appliedAt).toBeInstanceOf(Date);
  });

  it("11. PATCH marks scan reviewed (reviewedById set) when not previously reviewed", async () => {
    const postRes = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });
    expect(postRes.status).toBe(200);
    const { scanId } = postRes.body;

    // Confirm scan is not yet reviewed before PATCH.
    const before = await getScanById(companyId, scanId);
    expect(before!.reviewedAt).toBeNull();

    await request(app)
      .patch(`/api/tech/equipment/${equipmentId}`)
      .send({ modelNumber: "50XC060", ocrScanId: scanId });

    const after = await getScanById(companyId, scanId);
    expect(after!.reviewedAt).toBeInstanceOf(Date);
    expect(after!.reviewedById).toBe(userId);
  });

  it("12. PATCH does not overwrite existing reviewedAt when scan already reviewed", async () => {
    const postRes = await request(app)
      .post(`/api/tech/equipment/${equipmentId}/ocr-nameplate`)
      .send({ fileId });
    const { scanId } = postRes.body;

    // Mark reviewed separately before the PATCH.
    const { markReviewed } = await import("../server/storage/equipmentOcrScans");
    const firstReview = await markReviewed(companyId, scanId, userId);
    const reviewedAtMs = firstReview.reviewedAt!.getTime();

    // PATCH — route should skip markReviewed since reviewedAt is already set.
    await request(app)
      .patch(`/api/tech/equipment/${equipmentId}`)
      .send({ serialNumber: "1234ABCD", ocrScanId: scanId });

    const after = await getScanById(companyId, scanId);
    expect(after!.reviewedAt!.getTime()).toBe(reviewedAtMs);
    expect(after!.appliedAt).toBeInstanceOf(Date);
  });

  it("13. PATCH with ocrScanId from a different equipment returns 400", async () => {
    // Create a scan against otherEquipmentId.
    const { createScan } = await import("../server/storage/equipmentOcrScans");
    const scan = await createScan({
      companyId,
      equipmentId: otherEquipmentId,
      fileId,
      rawText: "Manufacturer: Trane",
      parsedFields: null,
      confidence: 0.7,
      provider: "tesseract",
    });

    // Try to apply it via PATCH on equipmentId (different from otherEquipmentId).
    const res = await request(app)
      .patch(`/api/tech/equipment/${equipmentId}`)
      .send({ manufacturer: "Trane", ocrScanId: scan.id });

    expect(res.status).toBe(400);
  });

  it("14. PATCH returns 400 on unknown field in body (strict schema)", async () => {
    const res = await request(app)
      .patch(`/api/tech/equipment/${equipmentId}`)
      .send({ name: "Should not be accepted" });

    expect(res.status).toBe(400);
  });
});
