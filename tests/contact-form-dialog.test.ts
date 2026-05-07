/**
 * ContactFormDialog modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `ContactFormDialog` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * single canonical surface for adding / editing client contacts and
 * managing per-location role assignments — mounted from
 * `ClientDetailPage`.
 *
 * Body-shape note. The body keeps its custom 2-section flex layout
 * (identity panel + scrolling locations list, capped at
 * `max-h-[70vh]`) directly inside `<ModalShell>` rather than being
 * wrapped in `<ModalBody>`. Wrapping would compound `<ModalBody>`'s
 * canonical `px-5 py-4` padding with the inner per-section padding
 * (`px-3 py-2.5` for identity, `px-3 pt-2 pb-1` for the locations
 * header, etc.), producing 32px horizontal gutters and breaking the
 * compact rhythm. Same precedent as `CreateNewDialog` (which mounts
 * its `<Tabs>` directly under `<ModalShell>` for the same reason).
 *
 * What this file pins:
 *   1. Imports — ModalShell + Modal* primitives present, no raw Dialog.
 *   2. ModalShell composition — width override at the call-site,
 *      `overflow-hidden` for the scrolling locations list, no inline
 *      `p-0 gap-0` (already baked into ModalShell).
 *   3. Header — preserves the `py-3` short-padding override + the
 *      `contact-modal-title` testid + the create/edit copy.
 *   4. Footer — preserves the delete-left layout (`sm:justify-between`
 *      + `bg-slate-50/50` + the inner `flex-1` Delete container).
 *   5. Identity / locations / roles fields — every existing testid
 *      preserved verbatim.
 *   6. Behavior contracts — canSave gate, save/delete mutation
 *      handlers, isPending gates on every action button, role pill
 *      generation, select-all tri-state behavior.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/ContactFormDialog.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("ContactFormDialog — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of ["ModalShell", "ModalHeader", "ModalTitle", "ModalFooter"]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*?\}\s*from\s*["']@\/components\/ui\/dialog["']/,
    );
  });

  it("does NOT render any raw <Dialog*> JSX (post-migration)", () => {
    for (const name of [
      "Dialog",
      "DialogContent",
      "DialogHeader",
      "DialogTitle",
      "DialogDescription",
      "DialogFooter",
    ]) {
      const re = new RegExp(`<${name}\\b`);
      expect(codeOnly).not.toMatch(re);
    }
  });

  it("does NOT wrap the body in <ModalBody> (the inner 2-section layout owns its own padding)", () => {
    // Pin the absence so a future "let's standardize the body wrapper"
    // pass doesn't accidentally re-introduce double padding. If a
    // future refactor genuinely needs ModalBody, it must update the
    // inner sections at the same time.
    expect(codeOnly).not.toMatch(/<ModalBody\b/);
  });
});

// ── 2. ModalShell composition + width contract ────────────────────

describe("ContactFormDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies the canonical width + overflow at the call-site (max-w-xl overflow-hidden)", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-xl overflow-hidden"/,
    );
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    // Pre-migration the DialogContent had `max-w-xl p-0 gap-0
    // overflow-hidden`. ModalShell bakes p-0 gap-0; the className
    // here must be just the width + overflow.
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header — preserves the short-padding override + canonical testid ─

describe("ContactFormDialog — header preserves the existing rhythm", () => {
  it("ModalHeader carries the className=\"py-3\" override (preserves the prior tighter header padding)", () => {
    expect(src).toMatch(/<ModalHeader\s+className="py-3">/);
  });

  it("ModalTitle preserves the data-testid='contact-modal-title' + create/edit copy", () => {
    expect(src).toMatch(
      /<ModalTitle\s+data-testid="contact-modal-title">[\s\S]*?contact\s*\?\s*"Edit Contact"\s*:\s*"Add Contact"[\s\S]*?<\/ModalTitle>/,
    );
  });
});

// ── 4. Footer — delete-left layout preserved ──────────────────────

describe("ContactFormDialog — footer preserves the delete-left layout", () => {
  it("ModalFooter carries className=\"sm:justify-between bg-slate-50/50\"", () => {
    expect(src).toMatch(
      /<ModalFooter\s+className="sm:justify-between bg-slate-50\/50">/,
    );
  });

  it("inner flex-1 div hosts the Delete button (when contact + allowDelete)", () => {
    expect(src).toMatch(
      /<div\s+className="flex-1 flex justify-start">[\s\S]*?contact\s*&&\s*allowDelete\s*&&[\s\S]*?<Button[\s\S]*?data-testid="contact-modal-delete"/,
    );
  });

  it("inner action group hosts Cancel + Save", () => {
    expect(src).toMatch(
      /<div\s+className="flex items-center gap-2">[\s\S]*?data-testid="contact-modal-cancel"[\s\S]*?data-testid="contact-modal-save"/,
    );
  });
});

// ── 5. Form fields + testids preserved ────────────────────────────

describe("ContactFormDialog — every form-field testid preserved verbatim", () => {
  for (const testid of [
    // Identity
    "contact-modal-title-select",
    "contact-modal-firstname",
    "contact-modal-lastname",
    "contact-modal-jobtitle",
    "contact-modal-phone",
    "contact-modal-email",
    "contact-modal-email-error",
    "contact-modal-isprimary",
    // Locations area
    "contact-modal-loc-count",
    "contact-modal-select-all",
    "contact-modal-loc-list",
    // Footer
    "contact-modal-cancel",
    "contact-modal-save",
    "contact-modal-delete",
  ]) {
    it(`preserves data-testid="${testid}"`, () => {
      expect(src).toMatch(new RegExp(`data-testid="${testid}"`));
    });
  }

  it("per-row location toggle + role pill testids use the loc.id template", () => {
    expect(src).toMatch(
      /data-testid=\{`contact-modal-loc-row-\$\{loc\.id\}`\}/,
    );
    expect(src).toMatch(
      /data-testid=\{`contact-modal-loc-toggle-\$\{loc\.id\}`\}/,
    );
    expect(src).toMatch(
      /data-testid=\{`contact-modal-role-\$\{loc\.id\}-\$\{role\}`\}/,
    );
  });
});

// ── 6. Behavior contracts ─────────────────────────────────────────

describe("ContactFormDialog — behavior contracts preserved", () => {
  it("canSave requires non-empty firstName + a valid email (or empty email)", () => {
    expect(src).toMatch(
      /const\s+canSave\s*=\s*form\.firstName\.trim\(\)\.length\s*>\s*0\s*&&\s*emailValid/,
    );
  });

  it("Save button is disabled when !canSave OR isSaving OR isDeleting", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*saveMutation\.mutate\(\)\}[\s\S]*?disabled=\{!canSave\s*\|\|\s*isSaving\s*\|\|\s*isDeleting\}[\s\S]*?data-testid="contact-modal-save"/,
    );
  });

  it("Cancel button is disabled while a mutation is pending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*onOpenChange\(false\)\}[\s\S]*?disabled=\{isSaving\s*\|\|\s*isDeleting\}[\s\S]*?data-testid="contact-modal-cancel"/,
    );
  });

  it("Delete button is disabled while a mutation is pending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*deleteMutation\.mutate\(\)\}[\s\S]*?disabled=\{isDeleting\s*\|\|\s*isSaving\}[\s\S]*?data-testid="contact-modal-delete"/,
    );
  });

  it("save mutation routes to PATCH on edit (with diff) or POST on create", () => {
    // Edit path
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/customer-companies\/\$\{companyId\}\/contacts\/\$\{contact\.id\}`\s*,\s*\{\s*method:\s*"PATCH"/,
    );
    // Create path
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/customer-companies\/\$\{companyId\}\/contacts`\s*,\s*\{\s*method:\s*"POST"/,
    );
    // Diff-driven assignment changes on edit
    expect(src).toMatch(/\/contacts\/\$\{contact\.id\}\/assign/);
    expect(src).toMatch(/\/assignments\/\$\{u\.assignmentId\}/);
    expect(src).toMatch(/\/assignments\/\$\{d\}/);
  });

  it("delete mutation DELETEs the contact + closes the modal on success", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/customer-companies\/\$\{companyId\}\/contacts\/\$\{contact\.id\}`\s*,\s*\{\s*method:\s*"DELETE"/,
    );
    expect(src).toMatch(
      /deleteMutation[\s\S]*?onSuccess[\s\S]*?onSuccess\(\)[\s\S]*?onOpenChange\(false\)/,
    );
  });

  it("error paths surface a destructive toast and do NOT touch form state", () => {
    const saveOnError = src.match(
      /saveMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(saveOnError).not.toBeNull();
    expect(saveOnError![1]).toMatch(/toast\(/);
    expect(saveOnError![1]).not.toMatch(/\bsetForm\b/);
    expect(saveOnError![1]).not.toMatch(/\bsetEmailTouched\b/);
  });

  it("Select-all checkbox uses Radix tri-state ('indeterminate' when partial)", () => {
    expect(src).toMatch(
      /selectAllState[\s\S]*?:\s*"indeterminate"/,
    );
  });

  it("Role pills only render for already-linked locations", () => {
    // toggleRole's defensive guard: if the row isn't linked, return f.
    expect(src).toMatch(
      /toggleRole[\s\S]*?if\s*\(!next\[locId\]\)\s*return\s+f/,
    );
    expect(src).toMatch(/isLinked\s*&&\s*\(\s*<div\s+className="flex flex-wrap gap-1/);
  });

  it("STANDARD_CONTACT_ROLES are the canonical 4 (billing, scheduling, site_contact, maintenance)", () => {
    expect(src).toMatch(
      /STANDARD_CONTACT_ROLES\s*=\s*\[\s*"billing",\s*"scheduling",\s*"site_contact",\s*"maintenance",?\s*\]/,
    );
  });
});

// ── 7. filterCanonicalRoles save-time normalization ──────────────

describe("ContactFormDialog — filterCanonicalRoles strips legacy roles on actively-touched assignments", () => {
  it("filterCanonicalRoles is applied on every save-time POST/PATCH", () => {
    // Three call sites: buildAssociation (create), assignment POST
    // (new assignment on edit), assignment PATCH (role change on edit).
    expect(src).toMatch(/buildAssociation[\s\S]*?filterCanonicalRoles\(Array\.from\(roles\)\)/);
    expect(src).toMatch(
      /method:\s*"POST"[\s\S]*?roles:\s*filterCanonicalRoles\(c\.roles\)/,
    );
    expect(src).toMatch(
      /method:\s*"PATCH"[\s\S]*?roles:\s*filterCanonicalRoles\(u\.roles\)/,
    );
  });

  it("DIFF comparison still uses the FULL role set (so untouched legacy roles aren't accidentally stripped)", () => {
    // diffAssignments compares prev vs. nextRoles where nextRoles is
    // Array.from(roleSet) — NOT filtered. Filtering happens only at
    // emit time (POST/PATCH bodies). Pin both halves of this contract.
    expect(src).toMatch(
      /diffAssignments[\s\S]*?const\s+nextRoles\s*=\s*Array\.from\(roleSet\)\.sort\(\)/,
    );
    expect(src).toMatch(
      /diffAssignments[\s\S]*?const\s+prev\s*=\s*\[\.\.\.\(existing\.roles\s*\?\?\s*\[\]\)\]\.sort\(\)/,
    );
  });
});
