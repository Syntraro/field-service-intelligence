/**
 * Unit tests for the canonical Edit Visit hydration adapter
 * (client/src/lib/visitEditorPayloadBuilder.ts).
 *
 * Guards the four invariants called out in the 2026-04-24 lockdown:
 *   1. Rich payload (partial has both customerName + locationId) → fast-path,
 *      no fetch, partial returned merged with {visitId, jobId}.
 *   2. Lean payload (no partial / missing locationId) → slow-path, fetch
 *      GET /api/jobs/:jobId once, compose full state.
 *   3. Missing locationId is repaired from the fetched job detail even when
 *      other partial fields are present.
 *   4. Header fields normalize correctly:
 *        - customerName prefers parentCompany.name, falls back to location.companyName.
 *        - customerCompanyId prefers parentCompany.id, falls back to location.parentCompanyId.
 *        - locationAddress composes from locationAddress + locationCity,
 *          omitted when both are blank.
 *        - locationName prefers the canonical top-level field over the nested label.
 *   5. Fetch failure returns minimal state + caller's partial — non-blocking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The mock must register BEFORE the adapter import because the adapter
// binds its `apiRequest` reference at module-evaluation time.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/queryClient";
import {
  enrichVisitEditorState,
  openVisitEditor,
} from "@/lib/visitEditorPayloadBuilder";

const mockApiRequest = apiRequest as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Mirrors the JobHeaderDetail the server returns (server/storage/jobsFeed.ts:119).
// Only the fields the adapter consumes are populated here.
const BASE_JOB_RESPONSE = {
  id: "job-1",
  jobNumber: 101,
  summary: "Annual PM",
  locationId: "loc-1",
  locationName: "Downtown Office",
  locationAddress: "123 Main St",
  locationCity: "Toronto",
  location: {
    id: "loc-1",
    companyName: "Main Location Co",
    location: "Building A",
    address: "123 Main St",
    city: "Toronto",
    parentCompanyId: "customer-1",
  },
  parentCompany: { id: "customer-1", name: "Acme Corporation" },
};

// ---------------------------------------------------------------------------
// enrichVisitEditorState
// ---------------------------------------------------------------------------

describe("enrichVisitEditorState — fast path (rich payload)", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("returns the partial unchanged when customerName + locationId are both present", async () => {
    const partial = {
      customerName: "Acme Corp",
      customerCompanyId: "customer-1",
      jobNumber: 101,
      jobSummary: "Annual PM",
      locationName: "Downtown",
      locationAddress: "123 Main St, Toronto",
      locationId: "loc-1",
    };

    const state = await enrichVisitEditorState("visit-1", "job-1", partial);

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(state).toEqual({ visitId: "visit-1", jobId: "job-1", ...partial });
  });

  it("does not fetch even when some optional fields in partial are undefined", async () => {
    await enrichVisitEditorState("visit-1", "job-1", {
      customerName: "Acme",
      locationId: "loc-1",
      // jobNumber / jobSummary / etc. intentionally undefined
    });

    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});

describe("enrichVisitEditorState — slow path (lean payload)", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("fetches /api/jobs/:jobId when no partial is provided", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(mockApiRequest).toHaveBeenCalledOnce();
    expect(mockApiRequest).toHaveBeenCalledWith("/api/jobs/job-1");
    expect(state).toMatchObject({
      visitId: "visit-1",
      jobId: "job-1",
      customerName: "Acme Corporation",
      customerCompanyId: "customer-1",
      jobNumber: 101,
      jobSummary: "Annual PM",
      locationId: "loc-1",
    });
  });

  it("fetches when partial has customerName but missing locationId (dashboard Operations case)", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-1", "job-1", {
      customerName: "Label Only",
    });

    expect(mockApiRequest).toHaveBeenCalledOnce();
    // locationId repaired from the fetched job detail
    expect(state.locationId).toBe("loc-1");
    // partial override wins for the field it supplied
    expect(state.customerName).toBe("Label Only");
  });

  it("fetches when partial has locationId but missing customerName", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-1", "job-1", {
      locationId: "loc-1",
    });

    expect(mockApiRequest).toHaveBeenCalledOnce();
    expect(state.customerName).toBe("Acme Corporation");
  });
});

describe("enrichVisitEditorState — header field normalization", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("prefers parentCompany.name for customerName", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.customerName).toBe("Acme Corporation");
    expect(state.customerCompanyId).toBe("customer-1");
  });

  it("falls back to location.companyName when parentCompany is null", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      parentCompany: null,
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.customerName).toBe("Main Location Co");
    // customerCompanyId falls back to location.parentCompanyId
    expect(state.customerCompanyId).toBe("customer-1");
  });

  it("leaves customerName undefined when parentCompany AND location are both null", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      parentCompany: null,
      location: null,
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.customerName).toBeUndefined();
    expect(state.customerCompanyId).toBeUndefined();
  });

  it("composes locationAddress from locationAddress + locationCity", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.locationAddress).toBe("123 Main St, Toronto");
  });

  it("composes locationAddress from just one part when the other is missing", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      locationCity: null,
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.locationAddress).toBe("123 Main St");
  });

  it("omits locationAddress when both street and city are missing", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      locationAddress: null,
      locationCity: null,
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.locationAddress).toBeUndefined();
  });

  it("prefers top-level locationName over nested location.location", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      locationName: "Canonical Name",
      location: { ...BASE_JOB_RESPONSE.location!, location: "Nested Name" },
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.locationName).toBe("Canonical Name");
  });

  it("falls back to nested location.location when top-level locationName is null", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ...BASE_JOB_RESPONSE,
      locationName: null,
    });

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state.locationName).toBe("Building A");
  });

  it("always includes visitId + jobId + locationId on a fetched result", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);

    const state = await enrichVisitEditorState("visit-xyz", "job-abc");

    expect(state.visitId).toBe("visit-xyz");
    expect(state.jobId).toBe("job-abc");
    expect(state.locationId).toBe("loc-1");
  });
});

describe("enrichVisitEditorState — failure behavior", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("returns minimal state when /api/jobs/:jobId fetch throws", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network down"));

    const state = await enrichVisitEditorState("visit-1", "job-1");

    expect(state).toEqual({ visitId: "visit-1", jobId: "job-1" });
  });

  it("preserves caller's partial on fetch failure", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network down"));

    const state = await enrichVisitEditorState("visit-1", "job-1", {
      jobNumber: 42,
      customerName: "Partial Customer",
    });

    expect(state).toEqual({
      visitId: "visit-1",
      jobId: "job-1",
      jobNumber: 42,
      customerName: "Partial Customer",
    });
  });
});

// ---------------------------------------------------------------------------
// openVisitEditor
// ---------------------------------------------------------------------------

describe("openVisitEditor", () => {
  beforeEach(() => mockApiRequest.mockReset());

  it("calls the setter with the enriched state (slow-path)", async () => {
    mockApiRequest.mockResolvedValueOnce(BASE_JOB_RESPONSE);
    const setter = vi.fn();

    await openVisitEditor(setter, "visit-1", "job-1");

    expect(setter).toHaveBeenCalledOnce();
    expect(setter.mock.calls[0][0]).toMatchObject({
      visitId: "visit-1",
      jobId: "job-1",
      customerName: "Acme Corporation",
      locationId: "loc-1",
    });
  });

  it("forwards partial context to the adapter (fast-path when rich)", async () => {
    const setter = vi.fn();

    await openVisitEditor(setter, "visit-1", "job-1", {
      customerName: "Fast Path",
      locationId: "loc-1",
    });

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(setter).toHaveBeenCalledOnce();
    expect(setter.mock.calls[0][0]).toMatchObject({
      visitId: "visit-1",
      jobId: "job-1",
      customerName: "Fast Path",
      locationId: "loc-1",
    });
  });

  it("still calls the setter on fetch failure (non-blocking contract)", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("boom"));
    const setter = vi.fn();

    await openVisitEditor(setter, "visit-1", "job-1");

    expect(setter).toHaveBeenCalledOnce();
    expect(setter.mock.calls[0][0]).toEqual({
      visitId: "visit-1",
      jobId: "job-1",
    });
  });
});
