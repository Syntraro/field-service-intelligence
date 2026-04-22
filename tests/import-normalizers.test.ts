/**
 * Canonical normalizer tests — replaces the legacy `csv-import-hardening`
 * and `csv-import-column-safety` tests that exercised the removed
 * `server/services/{client,job,product}Import.ts` modules.
 *
 * Scope: unit coverage for the shared primitives that back every adapter.
 */

import { describe, it, expect } from "vitest";

import {
  coerceBoolean,
  coerceBooleanStrict,
} from "../server/services/importPipeline/normalizers/bool";
import { parseMoney, parseInteger } from "../server/services/importPipeline/normalizers/money";
import { parseDate } from "../server/services/importPipeline/normalizers/date";
import { extractFirstEmail, splitEmails } from "../server/services/importPipeline/normalizers/email";
import { normalizeHeader } from "../server/services/importPipeline/normalizers/headers";
import { trimOrNull } from "../server/services/importPipeline/normalizers/text";
import { normalizePhoneForMatch } from "../server/services/importPipeline/normalizers/phone";

// ---------------------------------------------------------------------------
// Text / bool / money
// ---------------------------------------------------------------------------

describe("text normalizers", () => {
  it("trimOrNull returns null for empty / whitespace strings", () => {
    expect(trimOrNull("")).toBeNull();
    expect(trimOrNull("   ")).toBeNull();
    expect(trimOrNull(null)).toBeNull();
    expect(trimOrNull(undefined)).toBeNull();
  });

  it("trimOrNull trims but preserves internal spacing", () => {
    expect(trimOrNull("  Acme  Corp  ")).toBe("Acme  Corp");
  });
});

describe("coerceBoolean", () => {
  it("accepts the canonical truthy set", () => {
    for (const t of ["true", "yes", "y", "1", "active", "T"]) {
      expect(coerceBoolean(t, false)).toBe(true);
    }
  });

  it("accepts the canonical falsy set", () => {
    for (const f of ["false", "no", "n", "0", "inactive", "F"]) {
      expect(coerceBoolean(f, true)).toBe(false);
    }
  });

  it("falls back when the cell is absent or unparseable", () => {
    expect(coerceBoolean(null, true)).toBe(true);
    expect(coerceBoolean("", false)).toBe(false);
    expect(coerceBoolean("maybe", true)).toBe(true);
  });

  it("coerceBooleanStrict returns null for absent / unparseable values", () => {
    expect(coerceBooleanStrict("")).toBeNull();
    expect(coerceBooleanStrict("maybe")).toBeNull();
    expect(coerceBooleanStrict("yes")).toBe(true);
    expect(coerceBooleanStrict("no")).toBe(false);
  });
});

describe("parseMoney", () => {
  it("strips currency symbols and commas", () => {
    expect(parseMoney("$1,234.50")).toBe("1234.50");
    expect(parseMoney("€ 99")).toBe("99.00");
    expect(parseMoney("  29.9 ")).toBe("29.90");
  });

  it("returns null for blanks or non-numeric", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("-")).toBeNull();
    expect(parseMoney("not a number")).toBeNull();
  });
});

describe("parseInteger", () => {
  it("parses integer cells", () => {
    expect(parseInteger("60")).toBe(60);
    expect(parseInteger("  120 ")).toBe(120);
  });

  it("returns null for blanks", () => {
    expect(parseInteger("")).toBeNull();
    expect(parseInteger("-")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Email + headers + phone
// ---------------------------------------------------------------------------

describe("email normalizers", () => {
  it("splits on common multi-email separators", () => {
    expect(splitEmails("a@x.com, b@x.com; c@x.com | d@x.com")).toEqual([
      "a@x.com", "b@x.com", "c@x.com", "d@x.com",
    ]);
  });

  it("extractFirstEmail returns null when no token is well-formed", () => {
    expect(extractFirstEmail("not-an-email, just-a-word")).toBeNull();
  });

  it("extractFirstEmail skips garbage tokens and picks the first valid", () => {
    expect(extractFirstEmail("not-an-email ; hello@example.com")).toBe("hello@example.com");
  });
});

describe("normalizeHeader", () => {
  it("collapses separators and casing", () => {
    expect(normalizeHeader("Unit_Price")).toBe("unit price");
    expect(normalizeHeader("UNIT-PRICE")).toBe("unit price");
    expect(normalizeHeader("  Unit  Price ")).toBe("unit price");
    expect(normalizeHeader("Bill-with_Parent")).toBe("bill with parent");
  });
});

describe("normalizePhoneForMatch", () => {
  it("collapses formatting variants to a single key", () => {
    expect(normalizePhoneForMatch("(416) 555-1234")).toBe("4165551234");
    expect(normalizePhoneForMatch("+1 416-555-1234")).toBe("4165551234");
    expect(normalizePhoneForMatch("4165551234")).toBe("4165551234");
  });

  it("returns empty string for empty input", () => {
    expect(normalizePhoneForMatch("")).toBe("");
    expect(normalizePhoneForMatch(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Timezone-aware date parsing — the key fix vs. the legacy `new Date(str)`
// ---------------------------------------------------------------------------

describe("parseDate — timezone-aware", () => {
  it("returns null for empty input", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate("-")).toBeNull();
  });

  it("parses ISO date-only as tenant-local midnight", () => {
    // For America/Toronto (UTC-5 in January), "2024-01-15" wall-clock
    // midnight in Toronto is 2024-01-15T05:00:00Z.
    const d = parseDate("2024-01-15", "America/Toronto");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe("2024-01-15T05:00:00.000Z");
  });

  it("parses ISO date-only as UTC when no timezone is given (legacy fallback)", () => {
    const d = parseDate("2024-01-15");
    expect(d!.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("accepts common CSV date formats", () => {
    const tz = "America/Toronto";
    const expected = "2024-01-15T05:00:00.000Z";
    expect(parseDate("2024/01/15", tz)!.toISOString()).toBe(expected);
    expect(parseDate("01/15/2024", tz)!.toISOString()).toBe(expected);
    expect(parseDate("15-Jan-2024", tz)!.toISOString()).toBe(expected);
    expect(parseDate("Jan 15, 2024", tz)!.toISOString()).toBe(expected);
    expect(parseDate("January 15, 2024", tz)!.toISOString()).toBe(expected);
  });

  it("honors explicit offsets and Z", () => {
    const d = parseDate("2024-01-15T09:30:00-05:00", "UTC");
    expect(d!.toISOString()).toBe("2024-01-15T14:30:00.000Z");
    const z = parseDate("2024-01-15T09:30:00Z", "America/Toronto");
    expect(z!.toISOString()).toBe("2024-01-15T09:30:00.000Z");
  });

  it("returns null for unrecognized shapes", () => {
    expect(parseDate("not a date", "UTC")).toBeNull();
    expect(parseDate("15/01", "UTC")).toBeNull();
  });
});
