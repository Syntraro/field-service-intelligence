/**
 * Shared HVAC/R nameplate field extraction.
 *
 * Both TesseractProvider and GoogleVisionProvider reduce their raw text to the
 * canonical OcrFieldMap through this module.  Keeping the patterns here means
 * future providers (Azure CV, etc.) get identical field extraction for free.
 */

import type { OcrFieldMap, OcrFieldResult } from "./OcrProvider";

/**
 * Ordered label patterns for HVAC/R equipment nameplates.
 * More-specific patterns appear first to avoid partial label matches.
 */
export const FIELD_PATTERNS: Array<{ field: keyof OcrFieldMap; re: RegExp }> = [
  {
    field: "manufacturer",
    re: /(?:manufacturer|mfr|brand|make)[.:\s]+([A-Za-z][A-Za-z0-9 &\-.,]{1,40})/i,
  },
  {
    field: "modelNumber",
    re: /(?:model\s*(?:no|number|#)?|mdl)[.:\s#]+([A-Z0-9][A-Z0-9\-./]{2,30})/i,
  },
  {
    field: "serialNumber",
    re: /(?:serial\s*(?:no|number|#)?|s\/n|sn|ser)[.:\s#]+([A-Z0-9][A-Z0-9\-./]{4,30})/i,
  },
  {
    field: "equipmentType",
    re: /(?:type|unit\s*type|equip(?:ment)?\s*type)[.:\s]+([A-Za-z][A-Za-z0-9 \-]{1,30})/i,
  },
  {
    field: "tagNumber",
    re: /(?:asset\s*(?:tag|#)|tag\s*(?:no|#)|tag)[.:\s]+([A-Z0-9][A-Z0-9\-]{1,20})/i,
  },
  {
    field: "installDate",
    re: /(?:install(?:ation)?\s*date|installed(?:\s*on)?|date\s*installed)[.:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  },
];

/**
 * Parse nameplate fields from raw OCR text.
 *
 * @param text              Full raw text returned by the OCR provider.
 * @param overallConfidence Provider's overall confidence (0.0 – 1.0).
 *                          Used as the baseline for per-field confidence; a
 *                          small bonus is added when the label was clearly
 *                          detected (cap: 1.0).
 */
export function parseNameplateFields(text: string, overallConfidence: number): OcrFieldMap {
  const fields: OcrFieldMap = {};
  for (const { field, re } of FIELD_PATTERNS) {
    const match = text.match(re);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value.length === 0) continue;
      const confidence = Math.min(overallConfidence + 0.05, 1);
      fields[field] = { value, confidence } satisfies OcrFieldResult;
    }
  }
  return fields;
}
