/**
 * Nameplate OCR Service (2026-03-06)
 *
 * Extracts structured equipment data from nameplate photos using Claude Vision API.
 * Isolated integration point — OCR failure never blocks equipment workflows.
 *
 * Requires ANTHROPIC_API_KEY env var. Without it, returns graceful "unavailable" result.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export interface NameplateOcrResult {
  success: boolean;
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  /** Raw text from the nameplate if partial extraction */
  rawText?: string | null;
  error?: string;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_MIME: Record<string, ImageMediaType> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/**
 * Attempt OCR extraction from a nameplate image file on disk.
 * Returns partial results on partial success, { success: false } on total failure.
 */
export async function extractNameplateFields(
  filePath: string,
  mimeType: string
): Promise<NameplateOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, error: "OCR service not configured" };
  }

  const mediaType = SUPPORTED_MIME[mimeType];
  if (!mediaType) {
    return { success: false, error: `Unsupported image type: ${mimeType}` };
  }

  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    const imageData = fs.readFileSync(absolutePath);
    const base64 = imageData.toString("base64");

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `This is a photo of an HVAC/refrigeration equipment nameplate or data tag. Extract the following fields if visible. Return ONLY valid JSON with these keys:
{
  "manufacturer": "string or null",
  "modelNumber": "string or null",
  "serialNumber": "string or null",
  "rawText": "all visible text on the nameplate"
}
If a field is not visible or unreadable, use null. Return only the JSON object, no markdown.`,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON from response (handle possible markdown fencing)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, rawText: text, error: "Could not parse OCR response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const hasAnyField = parsed.manufacturer || parsed.modelNumber || parsed.serialNumber;

    return {
      success: !!hasAnyField,
      manufacturer: parsed.manufacturer || null,
      modelNumber: parsed.modelNumber || null,
      serialNumber: parsed.serialNumber || null,
      rawText: parsed.rawText || null,
    };
  } catch (err: any) {
    console.error("[nameplateOcr] OCR extraction failed:", err.message);
    return { success: false, error: err.message || "OCR extraction failed" };
  }
}
