/**
 * AddEquipmentDialog modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `AddEquipmentDialog` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The dialog is the
 * single canonical surface for both equipment create and edit flows
 * across the app (mounted from `JobDetailPage`, `JobEquipmentSection`,
 * `ClientDetailPage`, `EquipmentDetailModal`, `EquipmentPicker`,
 * `QuickAddJobDialog`'s equipment combobox, and `EditVisitModal`).
 *
 * What this file pins:
 *   1. Imports — Modal* primitives present, no raw Dialog.
 *   2. ModalShell composition — width override at the call-site,
 *      intercepted onOpenChange routes through resetAndClose.
 *   3. Header — ModalTitle + ModalDescription preserve the
 *      create/edit-mode-aware copy.
 *   4. Form fields preserved verbatim (Equipment Name, Type,
 *      Manufacturer, Model Number, Serial Number, Notes).
 *   5. Submit gating + loading state preserved (Name required,
 *      disabled while a mutation is pending, Loader2 + label swap).
 *   6. Mutation contract preserved (POST for create, PATCH for edit;
 *      both invalidate the location-scoped equipment query, plus the
 *      job-scoped query when `jobId` is supplied).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/AddEquipmentDialog.tsx"),
  "utf-8",
);

// Code-only view: strip block + line + JSX comments so doc commentary
// that mentions the legacy Dialog primitive (kept for context) doesn't
// false-match the negative pins below.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("AddEquipmentDialog — uses canonical ModalShell + Modal* primitives", () => {
  it("imports the canonical Modal primitive set from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of [
      "ModalShell",
      "ModalHeader",
      "ModalTitle",
      "ModalDescription",
      "ModalBody",
      "ModalFooter",
    ]) {
      expect(src).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("does NOT import any name from @/components/ui/dialog", () => {
    expect(codeOnly).not.toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
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
});

// ── 2. ModalShell composition + width contract ─────────────────────

describe("AddEquipmentDialog — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + an onOpenChange that gates close through resetAndClose", () => {
    // The unusual close pattern: any close (Esc / overlay / close X)
    // routes through resetAndClose so form state clears alongside the
    // close. Pin the exact callback shape so a refactor can't drop
    // the reset-on-close branch.
    expect(src).toMatch(
      /<ModalShell[\s\S]*?open=\{open\}[\s\S]*?onOpenChange=\{\(o\)\s*=>\s*\{\s*if\s*\(!o\)\s*resetAndClose\(\);\s*\}\}/,
    );
  });

  it("supplies width at the call-site (max-w-md) so ModalShell stays width-neutral", () => {
    expect(src).toMatch(
      /<ModalShell[\s\S]*?className="max-w-md"/,
    );
  });

  it("renders <ModalHeader> with <ModalTitle> + <ModalDescription>", () => {
    expect(src).toMatch(
      /<ModalHeader>\s*<ModalTitle>\{dialogTitle\}<\/ModalTitle>\s*<ModalDescription>\{dialogDescription\}<\/ModalDescription>\s*<\/ModalHeader>/,
    );
  });

  it("the body uses <ModalBody className=\"grid gap-3\"> (the inner py-2 was redundant after migration)", () => {
    expect(src).toMatch(/<ModalBody\s+className="grid gap-3">/);
  });

  it("<ModalFooter> wraps Cancel + Submit", () => {
    expect(src).toMatch(/<ModalFooter>[\s\S]*?Cancel[\s\S]*?<\/ModalFooter>/);
  });
});

// ── 3. Header + mode-aware copy preserved ──────────────────────────

describe("AddEquipmentDialog — create/edit mode title + description preserved", () => {
  it("dialogTitle resolves to 'Edit Equipment' or 'Add Equipment'", () => {
    expect(src).toMatch(
      /const\s+dialogTitle\s*=\s*isEdit\s*\?\s*"Edit Equipment"\s*:\s*"Add Equipment"/,
    );
  });

  it("dialogDescription resolves to the per-mode copy", () => {
    expect(src).toMatch(/Update the details for this piece of equipment\./);
    expect(src).toMatch(/Add a new piece of equipment to this location\./);
  });

  it("submitLabel resolves to 'Save Changes' or 'Add Equipment'", () => {
    expect(src).toMatch(
      /const\s+submitLabel\s*=\s*isEdit\s*\?\s*"Save Changes"\s*:\s*"Add Equipment"/,
    );
  });
});

// ── 4. Form fields preserved verbatim ──────────────────────────────

describe("AddEquipmentDialog — form fields preserved verbatim", () => {
  for (const fieldId of [
    "eq-name",
    "eq-manufacturer",
    "eq-model",
    "eq-serial",
    "eq-notes",
  ]) {
    it(`preserves the ${fieldId} field`, () => {
      expect(src).toMatch(new RegExp(`htmlFor="${fieldId}"`));
      expect(src).toMatch(new RegExp(`id="${fieldId}"`));
    });
  }

  it("Equipment Name is marked required (asterisk in the label)", () => {
    expect(src).toMatch(/Equipment Name \*/);
  });

  it("EquipmentTypeCombobox is rendered for the Type field", () => {
    expect(src).toMatch(/<EquipmentTypeCombobox/);
  });

  it("Notes field is a 2-row Textarea with non-resizable height", () => {
    // Pin the rows + className so the form's vertical rhythm doesn't
    // silently change.
    expect(src).toMatch(
      /<Textarea[\s\S]*?id="eq-notes"[\s\S]*?rows=\{2\}[\s\S]*?className="text-sm resize-none"/,
    );
  });
});

// ── 5. Submit gating + loading state ──────────────────────────────

describe("AddEquipmentDialog — submit gating + loading state preserved", () => {
  it("Submit button is disabled when form.name is empty OR a mutation is pending", () => {
    expect(src).toMatch(
      /disabled=\{!form\.name\.trim\(\)\s*\|\|\s*isPending\}/,
    );
  });

  it("isPending tracks both create and update mutations", () => {
    expect(src).toMatch(
      /const\s+isPending\s*=\s*createMutation\.isPending\s*\|\|\s*updateMutation\.isPending/,
    );
  });

  it("Submit button shows the spinner while a mutation is pending", () => {
    expect(src).toMatch(
      /isPending\s*\?\s*\(\s*<Loader2\s+className="h-4 w-4 animate-spin mr-1"\s*\/>/,
    );
  });

  it("handleSubmit blocks empty-name submissions and trims before dispatch", () => {
    expect(src).toMatch(
      /handleSubmit\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(!form\.name\.trim\(\)\)\s*return;/,
    );
    expect(src).toMatch(/name:\s*form\.name\.trim\(\)/);
  });

  it("handleSubmit routes to update mutation when isEdit, otherwise create", () => {
    expect(src).toMatch(
      /if\s*\(isEdit\)\s*\{\s*updateMutation\.mutate\(payload\);\s*\}\s*else\s*\{\s*createMutation\.mutate\(payload\);/,
    );
  });
});

// ── 6. Mutation contract + invalidations preserved ────────────────

describe("AddEquipmentDialog — mutation contract preserved", () => {
  it("create mutation POSTs to /api/clients/:locationId/equipment", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/clients\/\$\{locationId\}\/equipment`\s*,\s*\{\s*method:\s*"POST"/,
    );
  });

  it("update mutation PATCHes /api/clients/:locationId/equipment/:equipmentId", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*`\/api\/clients\/\$\{locationId\}\/equipment\/\$\{existingEquipment\.id\}`\s*,\s*\{\s*method:\s*"PATCH"/,
    );
  });

  it("invalidateAll invalidates the location-scoped equipment query", () => {
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/clients"\s*,\s*locationId\s*,\s*"equipment"\s*\]\s*\}\)/,
    );
  });

  it("invalidateAll also invalidates the job-scoped equipment query when jobId is set", () => {
    expect(src).toMatch(
      /if\s*\(jobId\)\s*\{\s*queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/jobs"\s*,\s*jobId\s*,\s*"equipment"\s*\]/,
    );
  });

  it("create-success path calls onCreated + onSaved + resetAndClose + toast", () => {
    expect(src).toMatch(/onCreated\?\.\(\{\s*id:\s*created\.id,\s*name:\s*created\.name\s*\}\)/);
    expect(src).toMatch(/onSaved\?\.\(created\)/);
    expect(src).toMatch(/Equipment Added/);
  });

  it("update-success path calls onSaved + resetAndClose + toast", () => {
    expect(src).toMatch(/onSaved\?\.\(updated\)/);
    expect(src).toMatch(/Equipment Updated/);
  });

  it("error paths surface a destructive toast and do NOT touch form state", () => {
    // Pre-extract the create-onError block, then assert it has the
    // toast call and no setForm or resetAndClose call.
    const createOnErrorBlock = src.match(
      /createMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(createOnErrorBlock).not.toBeNull();
    const createBody = createOnErrorBlock![1];
    expect(createBody).toMatch(/toast\(/);
    expect(createBody).not.toMatch(/\bsetForm\b/);
    expect(createBody).not.toMatch(/\bresetAndClose\b/);

    const updateOnErrorBlock = src.match(
      /updateMutation\s*=\s*useMutation\(\{[\s\S]*?onError:\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}\)/,
    );
    expect(updateOnErrorBlock).not.toBeNull();
    const updateBody = updateOnErrorBlock![1];
    expect(updateBody).toMatch(/toast\(/);
    expect(updateBody).not.toMatch(/\bsetForm\b/);
    expect(updateBody).not.toMatch(/\bresetAndClose\b/);
  });
});

// ── 7. Open/close + prefill behavior ──────────────────────────────

describe("AddEquipmentDialog — open transition prefill + reset behavior", () => {
  it("on closed → open transition: edit mode hydrates from existingEquipment, create mode seeds from defaultName", () => {
    expect(src).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!open\)\s*return;[\s\S]*?if\s*\(isEdit\s*&&\s*existingEquipment\)\s*\{[\s\S]*?setForm\(fromExisting\(existingEquipment\)\);[\s\S]*?\}\s*else\s*\{[\s\S]*?setForm\(\{\s*\.\.\.emptyForm,\s*name:\s*defaultName\s*\?\?\s*""\s*\}\);/,
    );
  });

  it("resetAndClose sets emptyForm and calls onOpenChange(false)", () => {
    expect(src).toMatch(
      /resetAndClose[\s\S]*?setForm\(emptyForm\);\s*onOpenChange\(false\);/,
    );
  });
});
