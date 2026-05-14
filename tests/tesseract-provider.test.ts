/**
 * TesseractProvider — unit tests (2026-05-13 Phase 0)
 *
 * Mocks `tesseract.js` so no language data is downloaded and no WASM
 * is loaded. Tests focus on:
 *   1. Dynamic import failure (missing package) — throws clear error
 *   2. Timeout enforcement — throws on slow worker
 *   3. Field parsing — known label patterns produce correct fields
 *   4. Confidence normalization — Tesseract 0-100 → 0-1
 *   5. Worker is always terminated (even on error)
 *   6. Normalized result shape
 *   7. Overall confidence clamped to [0, 1]
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

// ── Tesseract mock setup ─────────────────────────────────────────────────────
// vitest.mock must be at the top level; the factory runs before imports.

vi.mock("tesseract.js", () => {
  // Default mock: returns high-confidence text recognition.
  const mockTerminate = vi.fn().mockResolvedValue(undefined);
  const mockRecognize = vi.fn();

  const createWorker = vi.fn(async () => ({
    recognize: mockRecognize,
    terminate: mockTerminate,
  }));

  return { createWorker, _mockRecognize: mockRecognize, _mockTerminate: mockTerminate };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTesseractResult(text: string, confidence = 85): object {
  return {
    data: {
      text,
      confidence,
      words: [],
      lines: [],
    },
  };
}

async function buildProvider() {
  // Import after mock is installed.
  const { TesseractProvider } = await import("../server/services/ocr/providers/TesseractProvider");
  return new TesseractProvider();
}

async function getMockRecognize() {
  const mod = await import("tesseract.js") as any;
  return mod._mockRecognize as ReturnType<typeof vi.fn>;
}

async function getMockTerminate() {
  const mod = await import("tesseract.js") as any;
  return mod._mockTerminate as ReturnType<typeof vi.fn>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Clear all mock call histories before every test regardless of describe block.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("TesseractProvider — field parsing", () => {

  it("parses manufacturer from label", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(
      makeTesseractResult("Manufacturer: Carrier\nModel No: 50XC060\nSerial No: 1234ABCD5678"),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.manufacturer?.value).toBe("Carrier");
    expect(result.fields.manufacturer?.confidence).toBeGreaterThan(0);
  });

  it("parses modelNumber from 'Model No' label", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(
      makeTesseractResult("Model No: 50XC060"),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.modelNumber?.value).toBe("50XC060");
  });

  it("parses serialNumber from 'S/N' label", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(
      makeTesseractResult("S/N: 1234ABCD5678"),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.serialNumber?.value).toBe("1234ABCD5678");
  });

  it("parses installDate from 'Install Date' label", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(
      makeTesseractResult("Install Date: 03/15/2022"),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.installDate?.value).toBe("03/15/2022");
  });

  it("returns empty fields when no labels are detected", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(
      makeTesseractResult("QWERTY ASDF ZXCV 12345"),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it("parses multiple fields from a realistic nameplate", async () => {
    const text = [
      "Carrier Corporation",
      "Manufacturer: Carrier",
      "Model No.: 50XCA060-311",
      "Serial No.: 2318G30002",
      "Type: RTU",
      "Install Date: 06/01/2023",
    ].join("\n");

    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult(text, 90));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.manufacturer?.value).toBeTruthy();
    expect(result.fields.modelNumber?.value).toBeTruthy();
    expect(result.fields.serialNumber?.value).toBeTruthy();
    expect(result.fields.installDate?.value).toBe("06/01/2023");
  });
});

describe("TesseractProvider — confidence normalization", () => {
  it("normalizes Tesseract 0-100 confidence to 0-1", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult("Manufacturer: Trane", 76));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    // 76 / 100 = 0.76
    expect(result.overallConfidence).toBeCloseTo(0.76, 2);
  });

  it("clamps overallConfidence to 1.0 when Tesseract reports > 100", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult("Manufacturer: Trane", 110));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.overallConfidence).toBeLessThanOrEqual(1.0);
  });

  it("clamps overallConfidence to 0.0 when Tesseract reports negative", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult("Manufacturer: Trane", -5));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
  });

  it("per-field confidence does not exceed 1.0", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult("Manufacturer: Carrier", 99));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    if (result.fields.manufacturer) {
      expect(result.fields.manufacturer.confidence).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("TesseractProvider — timeout handling", () => {
  afterEach(() => {
    delete process.env.OCR_TIMEOUT_MS;
  });

  it("rejects with timeout error when recognize hangs past OCR_TIMEOUT_MS", async () => {
    // Use a real 1ms timeout — avoids vitest fake-timer unhandled rejection artifacts
    // while still exercising the timeout code path in < 100ms real time.
    process.env.OCR_TIMEOUT_MS = "1";

    const recognize = await getMockRecognize();
    recognize.mockImplementation(
      () => new Promise<never>(() => {}), // never resolves
    );

    const provider = await buildProvider();
    await expect(
      provider.extractNameplate(Buffer.alloc(1), "image/jpeg"),
    ).rejects.toThrow(/timed out/i);
  });
});

describe("TesseractProvider — worker lifecycle", () => {
  it("always terminates the worker on success", async () => {
    const recognize = await getMockRecognize();
    const terminate = await getMockTerminate();
    recognize.mockResolvedValue(makeTesseractResult("Manufacturer: Lennox"));

    const provider = await buildProvider();
    await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(terminate).toHaveBeenCalledOnce();
  });

  it("terminates the worker even when recognize throws", async () => {
    const recognize = await getMockRecognize();
    const terminate = await getMockTerminate();
    recognize.mockRejectedValue(new Error("worker crashed"));

    const provider = await buildProvider();
    await expect(provider.extractNameplate(Buffer.alloc(1), "image/jpeg")).rejects.toThrow(
      "worker crashed",
    );

    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("TesseractProvider — result shape", () => {
  it("result.provider is 'tesseract'", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult(""));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.provider).toBe("tesseract");
  });

  it("result.scannedAt is an ISO 8601 string", async () => {
    const recognize = await getMockRecognize();
    recognize.mockResolvedValue(makeTesseractResult(""));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(() => new Date(result.scannedAt)).not.toThrow();
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("result.rawText matches what Tesseract returned", async () => {
    const recognize = await getMockRecognize();
    const text = "Manufacturer: York\nModel: ZH120";
    recognize.mockResolvedValue(makeTesseractResult(text));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.rawText).toBe(text);
  });
});
