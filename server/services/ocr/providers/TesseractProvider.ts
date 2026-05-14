/**
 * Tesseract OCR provider — local/dev-safe implementation.
 *
 * Uses the `tesseract.js` npm package (WebAssembly Tesseract, no system
 * dependencies). No API key required.
 *
 * Install: npm install tesseract.js
 *
 * Limitations:
 *   - Accuracy is lower than cloud providers on low-quality or skewed images.
 *   - Language data (~4 MB) is downloaded on first use by the worker.
 *   - Hardcoded 30-second timeout; adjust OCR_TIMEOUT_MS env var if needed.
 *
 * Field extraction uses regex patterns trained on HVAC/R nameplate formats.
 * Per-field confidence is the provider's overall confidence ± a small bonus
 * for fields whose label was clearly detected.
 */

import type { OcrProvider, OcrNameplateResult } from "../OcrProvider";
import { parseNameplateFields } from "../parseNameplateFields";

const DEFAULT_TIMEOUT_MS = 30_000;

function getTimeoutMs(): number {
  const raw = process.env.OCR_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

export class TesseractProvider implements OcrProvider {
  readonly name = "tesseract";

  async extractNameplate(imageBuffer: Buffer, _mimeType: string): Promise<OcrNameplateResult> {
    // Dynamic import: avoids hard compile-time dependency for environments
    // that use Google Vision or Azure CV as their primary provider.
    let createWorker: (lang: string, oem?: number, options?: object) => Promise<any>;
    try {
      const mod = await import("tesseract.js");
      createWorker = mod.createWorker;
    } catch {
      throw new Error(
        "TesseractProvider: 'tesseract.js' is not installed. " +
        "Run: npm install tesseract.js",
      );
    }

    const worker = await createWorker("eng", 1, { logger: () => {} });
    let rawText = "";
    let overallConfidence = 0;

    try {
      const timeoutMs = getTimeoutMs();
      const recognizePromise = worker.recognize(imageBuffer);

      // Keep the timer handle so we can cancel it when recognizePromise
      // settles first — prevents an unhandled-rejection warning in that case.
      let timeoutHandle: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`TesseractProvider: OCR timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      // Attach a no-op handler so Node.js (and vitest) never see this promise
      // as unhandled regardless of which leg of the race wins.
      timeoutPromise.catch(() => {});

      let result: Awaited<ReturnType<typeof worker.recognize>>;
      try {
        result = await Promise.race([recognizePromise, timeoutPromise]);
      } finally {
        // If recognizePromise won, cancel the pending timer so it never fires.
        clearTimeout(timeoutHandle!);
      }
      rawText = result.data.text ?? "";
      // Tesseract reports confidence as 0–100; normalize to 0–1.
      overallConfidence = Math.max(0, Math.min((result.data.confidence ?? 0) / 100, 1));
    } finally {
      // Always terminate the worker to free the WASM memory.
      await worker.terminate().catch(() => {});
    }

    return {
      rawText,
      fields: parseNameplateFields(rawText, overallConfidence),
      overallConfidence,
      provider: this.name,
      scannedAt: new Date().toISOString(),
    };
  }
}
