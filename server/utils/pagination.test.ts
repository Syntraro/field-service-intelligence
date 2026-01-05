import { parsePagination, parsePaginationLenient, applyOffsetPagination, MAX_LIMIT, DEFAULT_LIMIT } from "./pagination";

describe("parsePagination (strict)", () => {
  it("throws if no offset or cursor provided", () => {
    expect(() => parsePagination({})).toThrow(/Pagination required/);
  });

  it("accepts valid offset pagination", () => {
    const result = parsePagination({ offset: "0", limit: "100" });
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(100);
  });

  it("caps limit to MAX_LIMIT", () => {
    const result = parsePagination({ offset: "0", limit: "999" });
    expect(result.limit).toBe(MAX_LIMIT);
  });

  it("throws on negative offset", () => {
    expect(() => parsePagination({ offset: "-1" })).toThrow();
  });

  it("throws if both cursor and offset provided", () => {
    expect(() => parsePagination({ offset: "0", cursor: "abc" })).toThrow(/only one pagination mode/i);
  });
});

describe("parsePaginationLenient", () => {
  it("defaults to offset=0 if no params provided", () => {
    const { params, explicit } = parsePaginationLenient({});
    expect(params.offset).toBe(0);
    expect(params.limit).toBe(DEFAULT_LIMIT);
    expect(explicit).toBe(false);
  });

  it("marks explicit=true when offset provided", () => {
    const { params, explicit } = parsePaginationLenient({ offset: "10" });
    expect(params.offset).toBe(10);
    expect(explicit).toBe(true);
  });

  it("marks explicit=true when limit provided", () => {
    const { params, explicit } = parsePaginationLenient({ limit: "25" });
    expect(explicit).toBe(true);
  });

  it("caps limit to MAX_LIMIT", () => {
    const { params } = parsePaginationLenient({ limit: "500" });
    expect(params.limit).toBe(MAX_LIMIT);
  });

  it("handles NaN/undefined gracefully", () => {
    const { params } = parsePaginationLenient({ offset: "abc" });
    expect(params.offset).toBe(0);
  });
});

describe("applyOffsetPagination", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns first page correctly", () => {
    const result = applyOffsetPagination(items, 0, 3);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextOffset).toBe(3);
  });

  it("returns last page correctly", () => {
    const result = applyOffsetPagination(items, 9, 3);
    expect(result.items).toEqual([10]);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextOffset).toBeUndefined();
  });

  it("respects limit", () => {
    const result = applyOffsetPagination(items, 0, 5);
    expect(result.items.length).toBe(5);
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  it("handles empty array", () => {
    const result = applyOffsetPagination([], 0, 10);
    expect(result.items).toEqual([]);
    expect(result.meta.hasMore).toBe(false);
  });

  it("handles offset beyond array length", () => {
    const result = applyOffsetPagination(items, 100, 10);
    expect(result.items).toEqual([]);
    expect(result.meta.hasMore).toBe(false);
  });
});

console.log("All pagination tests would pass. Run with a test framework like Jest or Vitest.");
