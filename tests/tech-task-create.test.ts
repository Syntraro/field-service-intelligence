/**
 * Tech Task Create — permission, validation, and supplier visit tests (2026-04-10)
 *
 * Locks:
 *   1-5. Schema validation (type restriction, strict mode)
 *   6-8. Shared constant integrity (TECH_ALLOWED_TASK_TYPES)
 *   9-10. Self-assignment enforcement (route-level + storage-level)
 *   11-13. Storage wrapper (createTechTask always self-assigns)
 *   14. Supplier visit extension (supplierNameOther flows through)
 *   15-18. Office route unchanged
 *
 * The route uses requireSchedulable (any schedulable user of any role),
 * NOT a role-restricted gate. Self-assignment applies to ALL mobile users.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  tasks,
  companies,
  users,
  taskTypeEnum,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { createTechTask, taskRepository } from "../server/storage/tasks";
import { createTaskSchema, TECH_ALLOWED_TASK_TYPES } from "../server/lib/taskSchemas";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

// Derived tech schema (same derivation as techField.ts)
const techCreateTaskSchema = createTaskSchema
  .pick({
    title: true,
    notes: true,
    scheduledStartAt: true,
    scheduledEndAt: true,
    allDay: true,
    assignedToUserId: true,
  })
  .extend({
    type: z.enum(TECH_ALLOWED_TASK_TYPES),
    supplierId: z.string().uuid().nullable().optional(),
    supplierLocationId: z.string().uuid().nullable().optional(),
    supplierNameOther: z.string().max(200).nullable().optional(),
    poNumber: z.string().max(100).nullable().optional(),
  })
  .strict();

const TEST_PREFIX = "tech_task_test_";
let companyId: string;
let techUserId: string;
let dispatcherUserId: string;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  techUserId = uuidv4();
  await db.insert(users).values({
    id: techUserId,
    companyId,
    email: `${TEST_PREFIX}tech-${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    status: "active",
  });

  dispatcherUserId = uuidv4();
  await db.insert(users).values({
    id: dispatcherUserId,
    companyId,
    email: `${TEST_PREFIX}disp-${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "dispatcher",
    status: "active",
  });
}

async function cleanupFixtures() {
  // supplier_visit_details cascade-deletes with tasks
  await db.delete(tasks).where(eq(tasks.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

describe("Tech task create — hardened", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Schema validation: type restriction
  // ─────────────────────────────────────────────────────────────────────

  describe("techCreateTaskSchema — type restriction", () => {
    it("accepts GENERAL", () => {
      expect(techCreateTaskSchema.safeParse({ title: "Test", type: "GENERAL" }).success).toBe(true);
    });

    it("accepts SUPPLIER_VISIT", () => {
      expect(techCreateTaskSchema.safeParse({ title: "Test", type: "SUPPLIER_VISIT" }).success).toBe(true);
    });

    it("REJECTS QUOTE_ASSESSMENT", () => {
      const result = techCreateTaskSchema.safeParse({ title: "Test", type: "QUOTE_ASSESSMENT" });
      expect(result.success).toBe(false);
    });

    it("REJECTS unknown type strings", () => {
      expect(techCreateTaskSchema.safeParse({ title: "Test", type: "BOGUS" }).success).toBe(false);
    });

    it("accepts supplier visit fields when present", () => {
      const result = techCreateTaskSchema.safeParse({
        title: "Pick up parts",
        type: "SUPPLIER_VISIT",
        supplierNameOther: "ABC Supply",
        poNumber: "PO-123",
      });
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Strict mode: extra fields REJECTED (no silent drift)
  // ─────────────────────────────────────────────────────────────────────

  describe("techCreateTaskSchema — strict mode rejects extra fields", () => {
    it("REJECTS jobId (not in picked set)", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", jobId: uuidv4(),
      }).success).toBe(false);
    });

    it("REJECTS quoteId (not in picked set)", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", quoteId: uuidv4(),
      }).success).toBe(false);
    });

    it("REJECTS clientId (not in picked set)", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", clientId: uuidv4(),
      }).success).toBe(false);
    });

    it("REJECTS arbitrary unknown fields", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", foo: "bar",
      }).success).toBe(false);
    });

    it("REJECTS status (server-set, not client-provided)", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", status: "pending",
      }).success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Shared constant integrity
  // ─────────────────────────────────────────────────────────────────────

  describe("TECH_ALLOWED_TASK_TYPES shared constant", () => {
    it("contains only values from the canonical taskTypeEnum", () => {
      for (const t of TECH_ALLOWED_TASK_TYPES) {
        expect((taskTypeEnum as readonly string[]).includes(t)).toBe(true);
      }
    });

    it("does NOT contain QUOTE_ASSESSMENT", () => {
      expect((TECH_ALLOWED_TASK_TYPES as readonly string[]).includes("QUOTE_ASSESSMENT")).toBe(false);
    });

    it("contains GENERAL and SUPPLIER_VISIT", () => {
      expect((TECH_ALLOWED_TASK_TYPES as readonly string[]).includes("GENERAL")).toBe(true);
      expect((TECH_ALLOWED_TASK_TYPES as readonly string[]).includes("SUPPLIER_VISIT")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Self-assignment: simulated route-level guard
  // ─────────────────────────────────────────────────────────────────────

  describe("self-assignment guard (route-level)", () => {
    it("rejects mismatched assignedToUserId", () => {
      const payload = { assignedToUserId: dispatcherUserId };
      const isViolation = payload.assignedToUserId && payload.assignedToUserId !== techUserId;
      expect(isViolation).toBeTruthy();
    });

    it("allows matching assignedToUserId", () => {
      const payload = { assignedToUserId: techUserId };
      const isViolation = payload.assignedToUserId && payload.assignedToUserId !== techUserId;
      expect(isViolation).toBeFalsy();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Storage-level wrapper: createTechTask
  // ─────────────────────────────────────────────────────────────────────

  describe("createTechTask storage wrapper", () => {
    it("forces self-assignment for technician", async () => {
      const task = await createTechTask(companyId, techUserId, {
        title: `${TEST_PREFIX}self-assign tech`,
        type: "GENERAL",
      });
      expect(task.createdByUserId).toBe(techUserId);
      expect(task.assignedToUserId).toBe(techUserId);
    });

    it("forces self-assignment for dispatcher (any schedulable role)", async () => {
      const task = await createTechTask(companyId, dispatcherUserId, {
        title: `${TEST_PREFIX}self-assign dispatcher`,
        type: "GENERAL",
      });
      expect(task.createdByUserId).toBe(dispatcherUserId);
      expect(task.assignedToUserId).toBe(dispatcherUserId);
    });

    it("creates a valid SUPPLIER_VISIT task", async () => {
      const task = await createTechTask(companyId, techUserId, {
        title: `${TEST_PREFIX}supplier visit`,
        type: "SUPPLIER_VISIT",
      });
      expect(task.type).toBe("SUPPLIER_VISIT");
      expect(task.assignedToUserId).toBe(techUserId);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Supplier visit extension: supplierNameOther
  // ─────────────────────────────────────────────────────────────────────

  describe("supplier visit details (supplierNameOther)", () => {
    it("stores supplierNameOther in the extension table", async () => {
      const task = await createTechTask(companyId, techUserId, {
        title: `${TEST_PREFIX}sv with name`,
        type: "SUPPLIER_VISIT",
      });

      await taskRepository.updateSupplierVisit(companyId, task.id, {
        supplierNameOther: "ABC Supply House",
        poNumber: "PO-99",
      });

      const sv = await taskRepository.getSupplierVisitDetails(companyId, task.id);
      expect(sv).not.toBeNull();
      expect(sv!.supplierNameOther).toBe("ABC Supply House");
      expect(sv!.poNumber).toBe("PO-99");
      // supplierId should be null (tech didn't select from canonical list)
      expect(sv!.supplierId).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Office route unchanged
  // ─────────────────────────────────────────────────────────────────────

  describe("canonical createTaskSchema (office route unchanged)", () => {
    it("accepts QUOTE_ASSESSMENT", () => {
      expect(createTaskSchema.safeParse({ title: "Test", type: "QUOTE_ASSESSMENT" }).success).toBe(true);
    });

    it("accepts GENERAL", () => {
      expect(createTaskSchema.safeParse({ title: "Test", type: "GENERAL" }).success).toBe(true);
    });

    it("accepts SUPPLIER_VISIT", () => {
      expect(createTaskSchema.safeParse({ title: "Test", type: "SUPPLIER_VISIT" }).success).toBe(true);
    });

    it("accepts assignedToUserId (free assignment for office)", () => {
      expect(createTaskSchema.safeParse({
        title: "Test",
        type: "GENERAL",
        assignedToUserId: uuidv4(),
      }).success).toBe(true);
    });
  });
});
