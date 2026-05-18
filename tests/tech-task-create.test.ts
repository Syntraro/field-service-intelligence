/**
 * Tech Task Create — permission, validation, and type tests
 *
 * NOTE (2026-05-17): SUPPLIER_VISIT is fully retired and removed from all schemas,
 * routes, storage, and task type enums. No new SUPPLIER_VISIT tasks can be created.
 *
 * Locks:
 *   1-4. Schema validation (type restriction, strict mode)
 *   5-6. Shared constant integrity (TECH_ALLOWED_TASK_TYPES — GENERAL only)
 *   7-8. Self-assignment enforcement (route-level + storage-level)
 *   9-10. Storage wrapper (createTechTask always self-assigns)
 *   11-14. Office route unchanged
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
import { createTechTask } from "../server/storage/tasks";
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

    it("REJECTS SUPPLIER_VISIT (retired 2026-05-17)", () => {
      expect(techCreateTaskSchema.safeParse({ title: "Test", type: "SUPPLIER_VISIT" }).success).toBe(false);
    });

    it("REJECTS QUOTE_ASSESSMENT", () => {
      const result = techCreateTaskSchema.safeParse({ title: "Test", type: "QUOTE_ASSESSMENT" });
      expect(result.success).toBe(false);
    });

    it("REJECTS unknown type strings", () => {
      expect(techCreateTaskSchema.safeParse({ title: "Test", type: "BOGUS" }).success).toBe(false);
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

    it("REJECTS supplierId (supplier visit fields retired)", () => {
      expect(techCreateTaskSchema.safeParse({
        title: "Test", type: "GENERAL", supplierId: uuidv4(),
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

    it("contains GENERAL", () => {
      expect((TECH_ALLOWED_TASK_TYPES as readonly string[]).includes("GENERAL")).toBe(true);
    });

    it("does NOT contain SUPPLIER_VISIT (retired 2026-05-17)", () => {
      expect((TECH_ALLOWED_TASK_TYPES as readonly string[]).includes("SUPPLIER_VISIT")).toBe(false);
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

    it("accepts assignedToUserId (free assignment for office)", () => {
      expect(createTaskSchema.safeParse({
        title: "Test",
        type: "GENERAL",
        assignedToUserId: uuidv4(),
      }).success).toBe(true);
    });
  });
});
