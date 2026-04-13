/**
 * Template Renderer (Phase 2, 2026-04-12).
 *
 * Pure string-substitution engine for communication templates.
 * Contract:
 *   - variable format is exactly `{{VARIABLE_NAME}}` (double braces, no spaces)
 *   - case-sensitive match
 *   - missing / undefined / null values resolve to an empty string
 *   - never throws on malformed input
 *   - NO eval, NO expression evaluation, NO conditionals — pure replace
 *
 * This module is transport-agnostic: it does not know about email, SMS,
 * Resend, invoices, quotes, or jobs. It renders subject + body against a
 * flat `data` dictionary and returns the result.
 */

export interface TemplateInput {
  subjectTemplate?: string | null;
  bodyTemplate: string;
}

export type TemplateData = Record<string, string | number | null | undefined>;

export interface RenderedTemplate {
  subject: string | null;
  body: string;
}

/**
 * Matches `{{VAR_NAME}}`. Variable names are `[A-Z0-9_]+` (uppercase letters,
 * digits, underscores) — deliberately restricted so stray `{{` in user copy
 * doesn't get swept up. Case-sensitive by design (the brief).
 */
const VARIABLE_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** Convert a data value to its rendered string form. */
function toRenderedString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  // Never throw — anything unexpected becomes "".
  try {
    return String(value);
  } catch {
    return "";
  }
}

/**
 * Replace every `{{VAR}}` occurrence in `template` with the matching entry
 * from `data`. Unknown / missing keys resolve to "".
 *
 * Idempotent: if the resolved string happens to contain `{{...}}`, those are
 * left as literal characters — we only substitute once.
 */
function substitute(template: string, data: TemplateData): string {
  if (!template) return "";
  return template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    // Object prototype access (e.g. {{__proto__}}) can't match the pattern
    // (needs a leading uppercase letter), so direct indexing is safe.
    const value = Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined;
    return toRenderedString(value);
  });
}

/**
 * Canonical render entry point.
 *
 * Subject is rendered only when a non-empty `subjectTemplate` is provided;
 * otherwise the output's `subject` is `null`. This mirrors the schema
 * (email requires subject, SMS may omit).
 */
export function renderTemplate(
  template: TemplateInput,
  data: TemplateData = {},
): RenderedTemplate {
  const body = substitute(template.bodyTemplate ?? "", data);
  const hasSubject = typeof template.subjectTemplate === "string" && template.subjectTemplate.length > 0;
  const subject = hasSubject ? substitute(template.subjectTemplate as string, data) : null;
  return { subject, body };
}

/**
 * Parse a template string and return the unique set of `{{VAR}}` names it
 * references, in first-occurrence order. Returns [] on empty input; never
 * throws.
 */
export function extractVariables(template: string | null | undefined): string[] {
  if (!template) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  // Use a fresh, stateful RegExp to avoid relying on matchAll iteration,
  // which requires downlevelIteration under older TS targets.
  const re = new RegExp(VARIABLE_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export interface TemplateVariableWarning {
  /** Variable name appearing in the template but not in `allowedVariables`. */
  variable: string;
  /** Which template string the unknown name was found in. */
  location: "subject" | "body";
}

/**
 * Check a template pair against an allow-list of variable names. Returns
 * warnings (not errors) so callers can surface hints without blocking save.
 * Unknown-variable rendering still resolves to "" at render time.
 */
export function validateTemplateVariables(
  template: TemplateInput,
  allowedVariables: readonly string[],
): TemplateVariableWarning[] {
  const allowed = new Set(allowedVariables);
  const warnings: TemplateVariableWarning[] = [];

  if (template.subjectTemplate) {
    for (const v of extractVariables(template.subjectTemplate)) {
      if (!allowed.has(v)) warnings.push({ variable: v, location: "subject" });
    }
  }
  for (const v of extractVariables(template.bodyTemplate)) {
    if (!allowed.has(v)) warnings.push({ variable: v, location: "body" });
  }
  return warnings;
}
