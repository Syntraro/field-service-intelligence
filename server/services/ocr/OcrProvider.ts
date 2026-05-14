/**
 * Provider-neutral OCR contract for equipment nameplate extraction.
 *
 * Concrete implementations live in server/services/ocr/providers/.
 * The active provider is selected by OcrService via the OCR_PROVIDER
 * environment variable.
 *
 * All providers MUST:
 *   - Accept a raw image Buffer (fetched server-side from R2).
 *   - Return a normalized OcrNameplateResult.
 *   - Never receive or return provider API credentials.
 *   - Handle timeouts internally and throw a plain Error on timeout.
 */

/** Per-field extraction result. Confidence is in the [0, 1] range. */
export interface OcrFieldResult {
  value: string;
  /** Extraction confidence for this specific field (0.0 – 1.0). */
  confidence: number;
}

/**
 * The canonical set of fields extracted from an HVAC/R equipment nameplate.
 * All fields are optional — providers return only what they detect.
 */
export interface OcrFieldMap {
  manufacturer?: OcrFieldResult;
  modelNumber?: OcrFieldResult;
  serialNumber?: OcrFieldResult;
  equipmentType?: OcrFieldResult;
  tagNumber?: OcrFieldResult;
  installDate?: OcrFieldResult;
}

/** Complete result returned from any OCR provider. */
export interface OcrNameplateResult {
  /** Full raw text string as returned by the provider, before field parsing. */
  rawText: string;
  /** Parsed field values with per-field confidence scores. */
  fields: OcrFieldMap;
  /** Provider-reported overall confidence (0.0 – 1.0). */
  overallConfidence: number;
  /** Provider identifier string — matches the OCR_PROVIDER env value. */
  provider: string;
  /** ISO 8601 timestamp of when the extraction was performed. */
  scannedAt: string;
}

/** Interface every provider must satisfy. */
export interface OcrProvider {
  /** Stable identifier for this provider (lowercase, no spaces). */
  readonly name: string;
  /**
   * Extract nameplate fields from a raw image buffer.
   *
   * @param imageBuffer  Raw bytes of the image (jpeg/png/webp).
   * @param mimeType     MIME type of the image buffer.
   * @throws Error on timeout, network failure, or provider misconfiguration.
   */
  extractNameplate(imageBuffer: Buffer, mimeType: string): Promise<OcrNameplateResult>;
}
