/**
 * Canonical form-field primitives source-pin tests (2026-05-07).
 *
 * Locks the API + class contracts for the Phase 2 form-field
 * primitives in `client/src/components/ui/form-field.tsx`. These pins
 * fail if a future edit:
 *   - drops one of the 6 exported primitives
 *   - changes a default className (typography or spacing)
 *   - couples the primitives to react-hook-form
 *   - bakes a `grid-cols-N` into FormRow (callers supply that)
 *   - imposes a fieldset border on FormSection
 *   - drops the `role="alert"` accessibility hook on FormErrorText
 *   - drops the `required` asterisk affordance on FormLabel
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const FORM_FIELD_PATH = resolve(
  __dirname,
  "../client/src/components/ui/form-field.tsx",
);
const src = readFileSync(FORM_FIELD_PATH, "utf-8");

// Code-only view — strip block + line comments so the doc-comment
// commentary doesn't false-match negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. File existence + exports ───────────────────────────────────

describe("form-field.tsx — file exists at the canonical path", () => {
  it("exists", () => {
    expect(existsSync(FORM_FIELD_PATH)).toBe(true);
  });
});

describe("form-field.tsx — exports every primitive", () => {
  for (const name of [
    "FormField",
    "FormLabel",
    "FormHelperText",
    "FormErrorText",
    "FormSection",
    "FormRow",
  ]) {
    it(`exports ${name}`, () => {
      // Each primitive uses `React.forwardRef` and is bound via
      // `export const <Name> = React.forwardRef<...>`. Pin the export.
      expect(src).toMatch(
        new RegExp(`export const ${name}\\s*=\\s*React\\.forwardRef`),
      );
    });

    it(`${name} sets a displayName`, () => {
      expect(src).toMatch(new RegExp(`${name}\\.displayName\\s*=`));
    });
  }
});

// ── 2. FormField — wrapper with space-y-1.5 ──────────────────────

describe("FormField — space-y-1.5 wrapper", () => {
  it("renders a <div> with cn() merging 'space-y-1.5' + caller className", () => {
    expect(src).toMatch(
      /export const FormField[\s\S]*?<div[\s\S]*?className=\{cn\(\s*"space-y-1\.5",\s*className\s*\)\}/,
    );
  });

  it("forwards arbitrary HTML div props", () => {
    expect(src).toMatch(
      /interface FormFieldProps extends React\.HTMLAttributes<HTMLDivElement>/,
    );
  });
});

// ── 3. FormLabel — composes Label + locks text-form-label + required ─

describe("FormLabel — composes <Label> with text-form-label + required affordance", () => {
  it("imports Label from @/components/ui/label", () => {
    expect(src).toMatch(
      /import\s*\{\s*Label\s*\}\s*from\s*["']@\/components\/ui\/label["']/,
    );
  });

  it("renders <Label> as the root element", () => {
    expect(src).toMatch(
      /export const FormLabel[\s\S]*?<Label\s+ref=\{ref\}/,
    );
  });

  it("locks the text-form-label typography token as the first cn() argument", () => {
    // The cn() call's full shape (including the srOnly conditional)
    // is pinned by the dedicated srOnly test below; this pin just
    // locks that text-form-label is the first/leading class so the
    // typography contract can't be re-ordered or replaced.
    expect(src).toMatch(
      /export const FormLabel[\s\S]*?cn\(\s*"text-form-label"/,
    );
  });

  it("declares an optional `required` boolean prop", () => {
    expect(src).toMatch(/required\?:\s*boolean/);
  });

  it("renders a destructive asterisk when `required` is true", () => {
    expect(src).toMatch(
      /required\s*&&\s*\(\s*<span\s+className="ml-0\.5 text-destructive"\s+aria-hidden="true">\s*\*\s*<\/span>/,
    );
  });

  it("the asterisk is aria-hidden (the required semantic lives on the input)", () => {
    expect(src).toMatch(/aria-hidden="true"/);
  });

  // Phase 2 design rule (2026-05-07): basic text/email/phone/address/
  // number/textarea inputs use in-field placeholders for visible
  // identity but still need a real <label> with htmlFor for
  // accessibility. `srOnly` hides the visible label without breaking
  // the screen-reader contract. Pin the API.
  it("declares an optional `srOnly` boolean prop on FormLabelProps", () => {
    expect(src).toMatch(/srOnly\?:\s*boolean/);
  });

  it("merges the 'sr-only' utility into cn() when `srOnly` is true", () => {
    expect(src).toMatch(
      /cn\(\s*"text-form-label",\s*srOnly\s*&&\s*"sr-only",\s*className\s*\)/,
    );
  });

  it("documents the placeholder-first design rule referencing CLAUDE.md", () => {
    // The doc-comment on FormLabel must call out when to use srOnly
    // so future migrators know basic inputs use in-field placeholders.
    expect(src).toMatch(/placeholder-first|sr-only|srOnly/);
    expect(src).toMatch(/CLAUDE\.md/);
  });
});

// ── 4. FormHelperText — text-xs text-muted-foreground <p> ────────

describe("FormHelperText — text-xs text-muted-foreground paragraph", () => {
  it("renders a <p> element", () => {
    expect(src).toMatch(
      /export const FormHelperText[\s\S]*?<p\b/,
    );
  });

  it("locks the default className 'text-xs text-muted-foreground'", () => {
    expect(src).toMatch(
      /export const FormHelperText[\s\S]*?cn\(\s*"text-xs text-muted-foreground",\s*className\s*\)/,
    );
  });

  it("forwards arbitrary HTML paragraph props", () => {
    expect(src).toMatch(
      /interface FormHelperTextProps[\s\S]*?React\.HTMLAttributes<HTMLParagraphElement>/,
    );
  });
});

// ── 5. FormErrorText — text-xs text-destructive <p> + role="alert" ─

describe("FormErrorText — text-xs text-destructive paragraph with role=alert", () => {
  it("renders a <p> element with role='alert' for screen-reader announcement", () => {
    expect(src).toMatch(
      /export const FormErrorText[\s\S]*?<p[\s\S]*?role="alert"/,
    );
  });

  it("locks the default className 'text-xs text-destructive'", () => {
    expect(src).toMatch(
      /export const FormErrorText[\s\S]*?cn\(\s*"text-xs text-destructive",\s*className\s*\)/,
    );
  });

  it("forwards arbitrary HTML paragraph props", () => {
    expect(src).toMatch(
      /interface FormErrorTextProps[\s\S]*?React\.HTMLAttributes<HTMLParagraphElement>/,
    );
  });
});

// ── 6. FormSection — fieldset + legend ──────────────────────────

describe("FormSection — fieldset + legend pattern", () => {
  it("renders a <fieldset> as the root element", () => {
    expect(src).toMatch(
      /export const FormSection[\s\S]*?<fieldset\s+ref=\{ref\}/,
    );
  });

  it("renders a <legend> child with 'text-sm font-medium' typography", () => {
    expect(src).toMatch(
      /export const FormSection[\s\S]*?<legend\s+className=\{cn\(\s*"text-sm font-medium",\s*legendClassName\s*\)\}/,
    );
  });

  it("declares a required `title: React.ReactNode` prop", () => {
    expect(src).toMatch(/title:\s*React\.ReactNode/);
  });

  it("declares an optional `legendClassName` override prop", () => {
    expect(src).toMatch(/legendClassName\?:\s*string/);
  });

  it("uses `space-y-2` between the legend and the field stack", () => {
    expect(src).toMatch(
      /export const FormSection[\s\S]*?<fieldset[\s\S]*?className=\{cn\(\s*"space-y-2",\s*className\s*\)\}/,
    );
  });

  it("does NOT impose any border-* utility on the fieldset (callers add explicitly)", () => {
    // Pin the fieldset's className lock string from the cn() call
    // and assert it has no border utility.
    const fsectionMatch = codeOnly.match(
      /export const FormSection[\s\S]*?<fieldset[\s\S]*?cn\(\s*"([^"]+)",\s*className\s*\)/,
    );
    expect(fsectionMatch).not.toBeNull();
    expect(fsectionMatch![1]).not.toMatch(/\bborder\b/);
  });
});

// ── 7. FormRow — grid + gap-3 ───────────────────────────────────

describe("FormRow — grid wrapper with default gap-3", () => {
  it("renders a <div> with cn() merging 'grid gap-3' + caller className", () => {
    expect(src).toMatch(
      /export const FormRow[\s\S]*?<div[\s\S]*?className=\{cn\(\s*"grid gap-3",\s*className\s*\)\}/,
    );
  });

  it("does NOT bake any grid-cols-N utility (callers supply via className)", () => {
    const rowMatch = codeOnly.match(
      /export const FormRow[\s\S]*?cn\(\s*"([^"]+)",\s*className\s*\)/,
    );
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![1]).not.toMatch(/\bgrid-cols-\d/);
  });
});

// ── 8. Negative pins — no react-hook-form coupling ──────────────

describe("form-field.tsx — does NOT couple to react-hook-form", () => {
  it("does NOT import from 'react-hook-form'", () => {
    expect(codeOnly).not.toMatch(/from\s*["']react-hook-form["']/);
  });

  it("does NOT import shadcn Form primitives from @/components/ui/form", () => {
    expect(codeOnly).not.toMatch(/from\s*["']@\/components\/ui\/form["']/);
  });

  it("does NOT reference useFormContext / Controller / useForm anywhere", () => {
    expect(codeOnly).not.toMatch(/\buseFormContext\b/);
    expect(codeOnly).not.toMatch(/\bController\b/);
    expect(codeOnly).not.toMatch(/\buseForm\b/);
  });
});

// ── 9. Negative pins — does NOT wrap atomic primitives ─────────

describe("form-field.tsx — does NOT wrap atomic primitives (Input/Textarea/Select/Checkbox/Switch)", () => {
  // The whole point of these primitives is structure + typography,
  // NOT yet-another-input-flavor. Wrapping atomic primitives would
  // bloat the API and force callers through an extra indirection.
  it("does NOT import Input", () => {
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*\bInput\b[^}]*\}\s*from\s*["']@\/components\/ui\/input["']/,
    );
  });

  it("does NOT import Textarea", () => {
    expect(codeOnly).not.toMatch(
      /from\s*["']@\/components\/ui\/textarea["']/,
    );
  });

  it("does NOT import Select / SelectTrigger / SelectContent", () => {
    expect(codeOnly).not.toMatch(/from\s*["']@\/components\/ui\/select["']/);
  });

  it("does NOT import Checkbox", () => {
    expect(codeOnly).not.toMatch(/from\s*["']@\/components\/ui\/checkbox["']/);
  });

  it("does NOT import Switch", () => {
    expect(codeOnly).not.toMatch(/from\s*["']@\/components\/ui\/switch["']/);
  });
});

// ── 10. Imports — cn utility ────────────────────────────────────

describe("form-field.tsx — imports the cn utility", () => {
  it("imports cn from @/lib/utils", () => {
    expect(src).toMatch(
      /import\s*\{\s*cn\s*\}\s*from\s*["']@\/lib\/utils["']/,
    );
  });
});

// ── 11. ref forwarding ─────────────────────────────────────────

describe("form-field.tsx — every primitive forwards refs (focus management in modals)", () => {
  // Ref forwarding matters for modal focus management — callers may
  // need to focus an error field, scroll a section into view, etc.
  // Each primitive uses React.forwardRef.
  for (const name of [
    "FormField",
    "FormLabel",
    "FormHelperText",
    "FormErrorText",
    "FormSection",
    "FormRow",
  ]) {
    it(`${name} forwards refs via React.forwardRef`, () => {
      expect(src).toMatch(
        new RegExp(`export const ${name}\\s*=\\s*React\\.forwardRef<`),
      );
    });
  }
});

// ── 12. Doc-comment guidance lives at the top of the file ──────

describe("form-field.tsx — top-of-file documentation present", () => {
  it("documents the Phase 2 context + the framework-agnostic design rule", () => {
    expect(src).toMatch(/Phase 2[\s\S]*?modal canonicalization/);
    expect(src).toMatch(/framework-agnostic/);
  });

  it("calls out that these primitives do NOT couple to react-hook-form", () => {
    expect(src).toMatch(/does NOT couple|do NOT couple|NOT couple to/);
  });

  it("includes a usage example block in the doc-comment", () => {
    expect(src).toMatch(/<FormSection/);
    expect(src).toMatch(/<FormField/);
    expect(src).toMatch(/<FormLabel/);
  });
});
