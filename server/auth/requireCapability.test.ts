/**
 * Tests for the requireCapability middleware.
 *
 * 2026-04-22 Revised Phase 1: proves the capability gate allows holders
 * through, denies non-holders with the canonical 403 shape, and emits an
 * audit row on denial without blocking the response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import { requireCapability, requireAnyCapability } from "./requireCapability";

// Stub the audit service module to avoid any DB side effects. We assert the
// call site by spying on the mock after each test.
const logMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/platformAuditService", () => ({
  platformAuditService: {
    log: (...args: unknown[]) => logMock(...args),
  },
}));

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as any;
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as any;
  return res as Response & { statusCode?: number; body?: unknown };
}

function makeReq(platformUser: unknown) {
  return {
    platformUser,
    originalUrl: "/api/platform/plans",
    path: "/api/platform/plans",
    method: "POST",
  } as unknown as Request;
}

describe("requireCapability", () => {
  beforeEach(() => {
    logMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() when the user holds the required capability", async () => {
    const req = makeReq({
      id: "u1",
      email: "admin@example.com",
      capabilities: ["plan:write", "tenant:read"],
    });
    const res = makeRes();
    const next = vi.fn();

    await requireCapability("plan:write")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it("returns 403 PLATFORM_CAPABILITY_DENIED when the user lacks the capability", async () => {
    const req = makeReq({
      id: "u2",
      email: "support@example.com",
      capabilities: ["tenant:read", "feedback:triage"],
    });
    const res = makeRes();
    const next = vi.fn();

    await requireCapability("plan:write")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({
      code: "PLATFORM_CAPABILITY_DENIED",
      capability: "plan:write",
    });
  });

  it("writes an audit row on denial (fire-and-forget)", async () => {
    const req = makeReq({
      id: "u3",
      email: "support@example.com",
      capabilities: ["tenant:read"],
    });
    const res = makeRes();

    await requireCapability("bulk:write")(req, res, vi.fn());

    expect(logMock).toHaveBeenCalledOnce();
    const [payload] = logMock.mock.calls[0];
    expect(payload.action).toBe("platform_capability_denied");
    expect(payload.platformAdminId).toBe("u3");
    expect(payload.details).toMatchObject({
      capability: "bulk:write",
      method: "POST",
    });
  });

  it("returns 401 PLATFORM_NOT_AUTHED when no platformUser is present", async () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();

    await requireCapability("plan:write")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toMatchObject({ code: "PLATFORM_NOT_AUTHED" });
    expect(logMock).not.toHaveBeenCalled();
  });

  it("treats missing capabilities array as empty (deny)", async () => {
    const req = makeReq({ id: "u4", email: "x@example.com" }); // no capabilities
    const res = makeRes();
    const next = vi.fn();

    await requireCapability("tenant:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("requireAnyCapability", () => {
  beforeEach(() => {
    logMock.mockClear();
  });

  it("calls next() when ANY of the listed capabilities is held", async () => {
    const req = makeReq({
      id: "u1",
      email: "a@example.com",
      capabilities: ["feedback:triage"],
    });
    const res = makeRes();
    const next = vi.fn();

    await requireAnyCapability("plan:write", "feedback:triage")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when none of the listed capabilities is held", async () => {
    const req = makeReq({
      id: "u2",
      email: "r@example.com",
      capabilities: ["tenant:read"],
    });
    const res = makeRes();
    const next = vi.fn();

    await requireAnyCapability("plan:write", "feedback:triage")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toMatchObject({
      code: "PLATFORM_CAPABILITY_DENIED",
      capability: "plan:write|feedback:triage",
    });
  });
});
