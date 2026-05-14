/**
 * GoogleVisionProvider — unit tests (2026-05-13)
 *
 * Mocks @google-cloud/vision so no API credentials are needed and no HTTP
 * calls are made.  Tests focus on:
 *
 *   Source-pin (structure):
 *   1. Exports GoogleVisionProvider class
 *   2. provider.name === "google_vision"
 *   3. Imports parseNameplateFields from shared module (no duplication)
 *   4. Uses documentTextDetection API method
 *   5. Credential check runs before client construction
 *
 *   Unit (behaviour):
 *   6. Throws clear error when neither credential env var is set
 *   7. Parses GOOGLE_CLOUD_CREDENTIALS JSON and passes as client options
 *   8. Accepts GOOGLE_APPLICATION_CREDENTIALS as file-path fallback
 *   9. Normalizes Vision API response to OcrNameplateResult shape
 *  10. Computes overallConfidence as average of word-level confidence scores
 *  11. Returns empty fields on empty text response
 *  12. Throws on API error embedded in response body
 *  13. Throws helpful error when @google-cloud/vision is not installed
 *  14. Parses nameplate fields from Vision rawText (same patterns as Tesseract)
 *
 *   OcrService integration:
 *  15. OcrService returns GoogleVisionProvider for OCR_PROVIDER=google_vision
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Source-pin helpers ────────────────────────────────────────────────────────

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const providerSrc  = read("server/services/ocr/providers/GoogleVisionProvider.ts");
const serviceSrc   = read("server/services/ocr/OcrService.ts");
const parseSrc     = read("server/services/ocr/parseNameplateFields.ts");
const tesseractSrc = read("server/services/ocr/providers/TesseractProvider.ts");

// ── @google-cloud/vision mock ─────────────────────────────────────────────────
// vi.hoisted() runs the factory before module-level variable declarations, so
// the mock variables are available when the vi.mock() factory is evaluated.

const { mockDocumentTextDetection, MockImageAnnotatorClient } = vi.hoisted(() => {
  const mockDocumentTextDetection = vi.fn();
  // Regular (non-arrow) function so it can be called with `new`.
  const MockImageAnnotatorClient = vi.fn(function (this: any) {
    this.documentTextDetection = mockDocumentTextDetection;
  });
  return { mockDocumentTextDetection, MockImageAnnotatorClient };
});

vi.mock("@google-cloud/vision", () => ({
  ImageAnnotatorClient: MockImageAnnotatorClient,
}));

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeVisionResponse(text: string, wordConfidences: number[] = []) {
  const words = wordConfidences.map((c) => ({ confidence: c }));
  return [
    {
      fullTextAnnotation: {
        text,
        pages: [
          {
            blocks: [
              {
                paragraphs: [{ words }],
              },
            ],
          },
        ],
      },
      error: null,
    },
  ];
}

function makeErrorResponse(message: string) {
  return [{ fullTextAnnotation: null, error: { message, code: 400 } }];
}

async function buildProvider() {
  const { GoogleVisionProvider } = await import(
    "../server/services/ocr/providers/GoogleVisionProvider"
  );
  return new GoogleVisionProvider();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_CLOUD_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

afterEach(() => {
  delete process.env.GOOGLE_CLOUD_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

// ── 1–5. Source-pin (structure) ───────────────────────────────────────────────

describe("GoogleVisionProvider — source structure", () => {
  it("1. exports GoogleVisionProvider class", () => {
    expect(providerSrc).toContain("export class GoogleVisionProvider");
  });

  it("2. provider.name is 'google_vision'", () => {
    expect(providerSrc).toContain('readonly name = "google_vision"');
  });

  it("3. imports parseNameplateFields from shared module (no local duplication)", () => {
    expect(providerSrc).toContain("parseNameplateFields");
    expect(providerSrc).toMatch(/from ["']\.\.\/parseNameplateFields["']/);
    // Sanity: no inline FIELD_PATTERNS array — shared module is the single source
    expect(providerSrc).not.toContain("FIELD_PATTERNS");
    // TesseractProvider must also use the shared module now
    expect(tesseractSrc).toContain("parseNameplateFields");
    expect(tesseractSrc).not.toContain("FIELD_PATTERNS");
  });

  it("4. uses documentTextDetection API method", () => {
    expect(providerSrc).toContain("documentTextDetection");
  });

  it("5. credential check present before client construction", () => {
    // Both env-var paths must exist in the provider.
    expect(providerSrc).toContain("GOOGLE_CLOUD_CREDENTIALS");
    expect(providerSrc).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    // Check appears before the client construction line.
    const credCheckIdx = providerSrc.indexOf("GOOGLE_CLOUD_CREDENTIALS");
    const clientIdx    = providerSrc.indexOf("new ImageAnnotatorClient");
    expect(credCheckIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(-1);
    expect(credCheckIdx).toBeLessThan(clientIdx);
  });
});

describe("parseNameplateFields — shared module", () => {
  it("exports parseNameplateFields function", () => {
    expect(parseSrc).toContain("export function parseNameplateFields");
  });

  it("exports FIELD_PATTERNS array", () => {
    expect(parseSrc).toContain("export const FIELD_PATTERNS");
  });

  it("OcrService imports GoogleVisionProvider and returns it for google_vision", () => {
    expect(serviceSrc).toContain("GoogleVisionProvider");
    expect(serviceSrc).toContain("new GoogleVisionProvider()");
    expect(serviceSrc).toMatch(/case ["']google_vision["']:\s*return new GoogleVisionProvider/);
  });
});

// ── 6. Throws when no credentials are configured ─────────────────────────────

describe("GoogleVisionProvider — credential guard", () => {
  it("6. throws clear error when neither credential env var is set", async () => {
    const provider = await buildProvider();
    await expect(
      provider.extractNameplate(Buffer.alloc(1), "image/jpeg"),
    ).rejects.toThrow(/GOOGLE_CLOUD_CREDENTIALS.*GOOGLE_APPLICATION_CREDENTIALS/i);
  });

  it("7. accepts GOOGLE_CLOUD_CREDENTIALS JSON and passes credentials to client", async () => {
    const fakeCreds = { type: "service_account", project_id: "test-proj" };
    process.env.GOOGLE_CLOUD_CREDENTIALS = JSON.stringify(fakeCreds);
    mockDocumentTextDetection.mockResolvedValue(makeVisionResponse("Manufacturer: Carrier"));

    const provider = await buildProvider();
    await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(MockImageAnnotatorClient).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: fakeCreds }),
    );
  });

  it("8. accepts GOOGLE_APPLICATION_CREDENTIALS file path (no credentials key passed)", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/var/secrets/sa.json";
    mockDocumentTextDetection.mockResolvedValue(makeVisionResponse("Model No: 50XC060"));

    const provider = await buildProvider();
    await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    // Client is constructed but WITHOUT a credentials key (ADC handles it).
    const callArg = MockImageAnnotatorClient.mock.calls[0]?.[0] ?? {};
    expect(callArg).not.toHaveProperty("credentials");
  });

  it("throws when GOOGLE_CLOUD_CREDENTIALS is not valid JSON", async () => {
    process.env.GOOGLE_CLOUD_CREDENTIALS = "NOT{JSON}";
    const provider = await buildProvider();
    await expect(
      provider.extractNameplate(Buffer.alloc(1), "image/jpeg"),
    ).rejects.toThrow(/not valid JSON/i);
  });
});

// ── 9. OcrNameplateResult shape ───────────────────────────────────────────────

describe("GoogleVisionProvider — result shape", () => {
  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/sa.json";
  });

  it("9. normalizes Vision response to OcrNameplateResult shape", async () => {
    const text = "Manufacturer: Carrier\nModel No: 50XC060\nSerial No: 1234ABCD";
    mockDocumentTextDetection.mockResolvedValue(makeVisionResponse(text, [0.92, 0.88, 0.9]));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result).toHaveProperty("rawText");
    expect(result).toHaveProperty("fields");
    expect(result).toHaveProperty("overallConfidence");
    expect(result).toHaveProperty("provider", "google_vision");
    expect(result).toHaveProperty("scannedAt");
    expect(() => new Date(result.scannedAt)).not.toThrow();
  });

  it("10. computes overallConfidence as average of word-level confidence scores", async () => {
    // Three words with known confidence values: avg = (0.8 + 0.9 + 1.0) / 3 ≈ 0.9
    mockDocumentTextDetection.mockResolvedValue(
      makeVisionResponse("Manufacturer: Trane", [0.8, 0.9, 1.0]),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.overallConfidence).toBeCloseTo((0.8 + 0.9 + 1.0) / 3, 2);
  });

  it("overallConfidence is 0 when fullTextAnnotation has no pages", async () => {
    mockDocumentTextDetection.mockResolvedValue([
      { fullTextAnnotation: { text: "", pages: [] }, error: null },
    ]);

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.overallConfidence).toBe(0);
  });

  it("11. returns empty fields when Vision returns no text", async () => {
    mockDocumentTextDetection.mockResolvedValue(makeVisionResponse("", []));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.rawText).toBe("");
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it("12. throws on API error embedded in response body", async () => {
    mockDocumentTextDetection.mockResolvedValue(
      makeErrorResponse("Image is too large"),
    );

    const provider = await buildProvider();
    await expect(
      provider.extractNameplate(Buffer.alloc(1), "image/jpeg"),
    ).rejects.toThrow(/Image is too large/);
  });

  it("rawText comes from fullTextAnnotation.text", async () => {
    const text = "Serial No: ABCD1234";
    mockDocumentTextDetection.mockResolvedValue(makeVisionResponse(text, [0.95]));

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.rawText).toBe(text);
  });
});

// ── 13. Missing package error ─────────────────────────────────────────────────

describe("GoogleVisionProvider — missing package", () => {
  it("13. source contains helpful installation instruction in the import-failure path", () => {
    // The dynamic import catch block must reference the package name.
    expect(providerSrc).toContain("@google-cloud/vision");
    expect(providerSrc).toContain("npm install @google-cloud/vision");
  });
});

// ── 14. Field parsing uses shared patterns ────────────────────────────────────

describe("GoogleVisionProvider — field parsing (shared with Tesseract)", () => {
  beforeEach(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/sa.json";
  });

  it("14a. parses manufacturer from Vision text", async () => {
    mockDocumentTextDetection.mockResolvedValue(
      makeVisionResponse("Manufacturer: Trane", [0.91]),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.manufacturer?.value).toBe("Trane");
  });

  it("14b. parses modelNumber from Vision text", async () => {
    mockDocumentTextDetection.mockResolvedValue(
      makeVisionResponse("Model No: 50XC060", [0.88]),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.modelNumber?.value).toBe("50XC060");
  });

  it("14c. parses serialNumber from Vision text", async () => {
    mockDocumentTextDetection.mockResolvedValue(
      makeVisionResponse("Serial No: 1234ABCD5678", [0.9]),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.serialNumber?.value).toBe("1234ABCD5678");
  });

  it("14d. parses installDate from Vision text", async () => {
    mockDocumentTextDetection.mockResolvedValue(
      makeVisionResponse("Install Date: 03/15/2022", [0.87]),
    );

    const provider = await buildProvider();
    const result = await provider.extractNameplate(Buffer.alloc(1), "image/jpeg");

    expect(result.fields.installDate?.value).toBe("03/15/2022");
  });
});

// ── 15. OcrService integration ────────────────────────────────────────────────

describe("OcrService — google_vision provider selection", () => {
  it("15. OcrService wires google_vision to GoogleVisionProvider (not a throw)", () => {
    // Capture only the google_vision case — stop before the next `case` keyword.
    const caseBlock = serviceSrc.match(
      /case ["']google_vision["'][^:]*:([\s\S]*?)(?=case ["'])/,
    )?.[1] ?? "";
    expect(caseBlock).toContain("return new GoogleVisionProvider()");
    expect(caseBlock).not.toContain("throw");
  });
});
