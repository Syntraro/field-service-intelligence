/**
 * Google Vision OCR provider — cloud implementation.
 *
 * Calls the Cloud Vision API `DOCUMENT_TEXT_DETECTION` feature, then
 * normalizes the response into the canonical OcrNameplateResult shape.
 * No Google-specific types leave this file.
 *
 * Required environment variables (one of):
 *   GOOGLE_CLOUD_CREDENTIALS   — service-account JSON as a string (preferred
 *                                  in container / serverless deployments)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to a service-account JSON file
 *                                  (standard Google Cloud ADC)
 *
 * Installation (when OCR_PROVIDER=google_vision):
 *   npm install @google-cloud/vision
 */

import type { OcrProvider, OcrNameplateResult } from "../OcrProvider";
import { parseNameplateFields } from "../parseNameplateFields";

// ── Internal types — never exported ─────────────────────────────────────────
// These mirror the subset of the Vision API response we actually consume.

interface VisionWord {
  confidence?: number | null;
}

interface VisionParagraph {
  words?: VisionWord[] | null;
}

interface VisionBlock {
  paragraphs?: VisionParagraph[] | null;
}

interface VisionPage {
  blocks?: VisionBlock[] | null;
}

interface VisionFullTextAnnotation {
  text?: string | null;
  pages?: VisionPage[] | null;
}

interface VisionAnnotateResponse {
  fullTextAnnotation?: VisionFullTextAnnotation | null;
  error?: { message?: string | null; code?: number | null } | null;
}

// ── Confidence computation ───────────────────────────────────────────────────

function computeConfidence(annotation: VisionFullTextAnnotation | null | undefined): number {
  if (!annotation?.pages?.length) return 0;
  let total = 0;
  let count = 0;
  for (const page of annotation.pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          if (typeof word.confidence === "number") {
            total += word.confidence;
            count++;
          }
        }
      }
    }
  }
  return count > 0 ? Math.min(total / count, 1) : 0;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class GoogleVisionProvider implements OcrProvider {
  readonly name = "google_vision";

  async extractNameplate(imageBuffer: Buffer, _mimeType: string): Promise<OcrNameplateResult> {
    // Dynamic import — no hard compile-time dependency; only loaded when this
    // provider is actually selected via OCR_PROVIDER=google_vision.
    let ImageAnnotatorClient: new (opts?: object) => any;
    try {
      // @ts-ignore — @google-cloud/vision is an optional peer dependency; only
      // loaded at runtime when OCR_PROVIDER=google_vision. Install with:
      // npm install @google-cloud/vision
      const mod = await import("@google-cloud/vision") as { ImageAnnotatorClient: new (opts?: object) => any };
      ImageAnnotatorClient = mod.ImageAnnotatorClient;
    } catch {
      throw new Error(
        "GoogleVisionProvider: '@google-cloud/vision' is not installed. " +
        "Run: npm install @google-cloud/vision",
      );
    }

    // Credential resolution — GOOGLE_CLOUD_CREDENTIALS (JSON string) takes
    // precedence so that container deployments never need to write a file.
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS (ADC file path).
    const clientOptions: Record<string, unknown> = {};
    const credJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
    if (credJson) {
      try {
        clientOptions.credentials = JSON.parse(credJson) as unknown;
      } catch {
        throw new Error(
          "GoogleVisionProvider: GOOGLE_CLOUD_CREDENTIALS is not valid JSON",
        );
      }
    } else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        "GoogleVisionProvider: set GOOGLE_CLOUD_CREDENTIALS (JSON string) or " +
        "GOOGLE_APPLICATION_CREDENTIALS (file path) to use the google_vision provider",
      );
    }

    const client = new ImageAnnotatorClient(clientOptions);
    const [response]: [VisionAnnotateResponse] = await client.documentTextDetection({
      image: { content: imageBuffer.toString("base64") },
    });

    if (response.error?.message) {
      throw new Error(`GoogleVisionProvider: API error — ${response.error.message}`);
    }

    const rawText = response.fullTextAnnotation?.text ?? "";
    const overallConfidence = computeConfidence(response.fullTextAnnotation);

    return {
      rawText,
      fields: parseNameplateFields(rawText, overallConfidence),
      overallConfidence,
      provider: this.name,
      scannedAt: new Date().toISOString(),
    };
  }
}
