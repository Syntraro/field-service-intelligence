/**
 * Technician Live State Tests (2026-04-10)
 *
 * Locks the canonical dispatcher visibility projection in
 * server/storage/timeTracking.ts:getTechnicianLiveStates.
 *
 * Single read helper, single source of truth. The office never stitches
 * attendance + visit state on the client; it consumes the rendered label
 * from this projection.
 *
 * Locked precedence (most → least specific):
 *   paused → on_site/in_progress → en_route → clocked_in (idle) → clocked_out
 *
 * Each test creates the minimum DB state for one precedence rung and asserts
 * the projection lands on the correct label.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  workSessions,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import {
  timeTrackingRepository,
  type TechnicianLiveState,
} from "../server/storage/timeTracking";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "live_state_test_";
let companyId: string;
let userId: string;
let secondUserId: string;
let customerCompanyId: string;
let locationId: string;
let jobId: string;
let visitId: string;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  // Two technicians so we can verify per-tech filtering and stable map ordering.
  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}a-${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    status: "active",
  });

  secondUserId = uuidv4();
  await db.insert(users).values({
    id: secondUserId,
    companyId,
    email: `${TEST_PREFIX}b-${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    status: "active",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    selectedMonths: [],
  });

  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    summary: `${TEST_PREFIX}job`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  jobId = job.id;

  const [visit] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.companyId, companyId), eq(jobVisits.jobId, jobId)))
    .limit(1);
  visitId = visit.id;

  // Assign tech A as the primary, leave tech B unassigned by default.
  await db
    .update(jobVisits)
    .set({ assignedTechnicianIds: [userId] })
    .where(eq(jobVisits.id, visitId));
}

async function cleanupFixtures() {
  await db.delete(workSessions).where(eq(workSessions.companyId, companyId));
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

async function resetState() {
  // Clear sessions and reset visit to scheduled before each scenario.
  await db.delete(workSessions).where(eq(workSessions.companyId, companyId));
  await db
    .update(jobVisits)
    .set({
      status: "scheduled",
      checkedInAt: null,
      previousStatus: null,
      assignedTechnicianIds: [userId],
      assignedTechnicianIds: [userId],
    })
    .where(eq(jobVisits.id, visitId));
}

async function setVisit(status: string) {
  await db
    .update(jobVisits)
    .set({ status: status as any })
    .where(eq(jobVisits.id, visitId));
}

async function openWorkSession(techId: string) {
  await db.insert(workSessions).values({
    companyId,
    technicianId: techId,
    workDate: "2026-04-10",
    clockInAt: new Date(),
    clockOutAt: null,
    source: "mobile",
  });
}

function findFor(states: TechnicianLiveState[], techId: string): TechnicianLiveState {
  const found = states.find((s) => s.technicianId === techId);
  if (!found) throw new Error(`No live state for tech ${techId}`);
  return found;
}

describe("getTechnicianLiveStates — dispatcher live state projection", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  beforeEach(async () => {
    await resetState();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge case: empty input
  // ─────────────────────────────────────────────────────────────────────
  it("returns an empty array for an empty input list", async () => {
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, []);
    expect(states).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Precedence rung 5 (default): clocked out
  // ─────────────────────────────────────────────────────────────────────
  it("clocked out, no active visit → Clocked Out", async () => {
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.attendanceStatus).toBe("clocked_out");
    expect(tech.activityStatus).toBe("idle");
    expect(tech.activeVisitId).toBeNull();
    expect(tech.activeJobId).toBeNull();
    expect(tech.label).toBe("Clocked Out");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Precedence rung 4: clocked in (idle)
  // ─────────────────────────────────────────────────────────────────────
  it("clocked in, no active visit → Clocked In (idle)", async () => {
    await openWorkSession(userId);
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.attendanceStatus).toBe("clocked_in");
    expect(tech.activityStatus).toBe("idle");
    expect(tech.activeVisitId).toBeNull();
    expect(tech.activeJobId).toBeNull();
    expect(tech.label).toBe("Clocked In");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Precedence rung 3: en_route
  // ─────────────────────────────────────────────────────────────────────
  it("active en_route visit → En Route", async () => {
    await openWorkSession(userId);
    await setVisit("en_route");
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.attendanceStatus).toBe("clocked_in");
    expect(tech.activityStatus).toBe("en_route");
    expect(tech.activeVisitId).toBe(visitId);
    expect(tech.activeJobId).toBe(jobId);
    expect(tech.label).toBe("En Route");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Precedence rung 2: in_progress / on_site
  // ─────────────────────────────────────────────────────────────────────
  it("active in_progress visit → On Site", async () => {
    await openWorkSession(userId);
    await setVisit("in_progress");
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.activityStatus).toBe("on_site");
    expect(tech.label).toBe("On Site");
  });

  it("active legacy on_site visit → On Site (normalization)", async () => {
    await openWorkSession(userId);
    await setVisit("on_site");
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.activityStatus).toBe("on_site");
    expect(tech.label).toBe("On Site");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Precedence rung 1: paused (highest)
  // ─────────────────────────────────────────────────────────────────────
  it("active paused visit → Paused (beats on_site precedence)", async () => {
    await openWorkSession(userId);
    await setVisit("paused");
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    expect(tech.activityStatus).toBe("paused");
    expect(tech.activeVisitId).toBe(visitId);
    expect(tech.label).toBe("Paused");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Bad-data resilience: active visit but no open work session
  // ─────────────────────────────────────────────────────────────────────
  it("active visit without an open work session still surfaces the activity", async () => {
    // No openWorkSession() — we report activity honestly even though attendance is "clocked_out"
    await setVisit("in_progress");
    const states = await timeTrackingRepository.getTechnicianLiveStates(companyId, [userId]);
    const tech = findFor(states, userId);
    // Attendance flag stays honest (no open session), but activity wins for the label.
    expect(tech.attendanceStatus).toBe("clocked_out");
    expect(tech.activityStatus).toBe("on_site");
    expect(tech.label).toBe("On Site");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Per-tech filtering: only requested techs are returned, in input order
  // ─────────────────────────────────────────────────────────────────────
  it("only returns rows for requested technician ids and preserves input order", async () => {
    await openWorkSession(userId);          // tech A clocked in
    // tech B left clocked out
    const states = await timeTrackingRepository.getTechnicianLiveStates(
      companyId,
      [secondUserId, userId],
    );
    expect(states).toHaveLength(2);
    expect(states[0].technicianId).toBe(secondUserId);
    expect(states[1].technicianId).toBe(userId);
    expect(states[0].label).toBe("Clocked Out");
    expect(states[1].label).toBe("Clocked In");
  });

  // ─────────────────────────────────────────────────────────────────────
  // Multi-tech assignment: tech listed in assignedTechnicianIds[] is recognized
  // ─────────────────────────────────────────────────────────────────────
  it("recognizes a tech listed only in assignedTechnicianIds[]", async () => {
    // Reassign: primary stays as A, but B is added to the array
    await db
      .update(jobVisits)
      .set({
        assignedTechnicianIds: [userId],
        assignedTechnicianIds: [userId, secondUserId],
        status: "in_progress",
      })
      .where(eq(jobVisits.id, visitId));
    await openWorkSession(secondUserId);

    const states = await timeTrackingRepository.getTechnicianLiveStates(
      companyId,
      [secondUserId],
    );
    const techB = findFor(states, secondUserId);
    expect(techB.activityStatus).toBe("on_site");
    expect(techB.activeVisitId).toBe(visitId);
  });
});
