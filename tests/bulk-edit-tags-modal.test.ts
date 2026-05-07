/**
 * BulkEditTagsModal modal canonicalization source-pin tests
 * (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `BulkEditTagsModal` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for bulk tag application (add/remove tags across
 * many entities at once) — mounted from `Clients.tsx` and
 * `Locations.tsx`. Pairs with the `EditTagsModal` migration that
 * landed earlier in this Unreleased cycle. Two-step wizard with two
 * distinct returns (`step === "edit"` vs `step === "review"`) — both
 * migrated.
 *
 * Body-shape decision. Both steps use `<ModalBody className="space-y-4">`
 * to recreate the prior `<DialogContent>` `gap-4` between body
 * sections. Step 1 (edit) carries `flex flex-col max-h-[85vh]` on
 * `<ModalShell>` so the modal caps its height on small viewports;
 * step 2 (review) has no `max-h` (the review summary + name preview
 * are short enough that natural sizing works).
 *
 * Both steps have an explicit `<ModalFooter>` (unlike `EditTagsModal`'s
 * inline-action shape — this modal has step-advance / commit
 * actions). Step 1 footer: Cancel + "Review Changes". Step 2 footer:
 * Back + "Confirm & Apply".
 *
 * Step 1 has a `<ModalDescription>` (the count line "Applying to N
 * clients/locations"); step 2 has no description.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/BulkEditTagsModal.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// Pre-extract each step's return tree so per-step assertions don't
// span the wrong step. Anchor on `</ModalShell>` (which appears
// exactly twice in the file — once per step) so the non-greedy
// `[\s\S]*?` walker doesn't stop on the first `);` it sees inside
// a JSX arrow function body. Step 1 is everything inside the
// `if (step === "edit") { return ( … </ModalShell> ); }` branch;
// step 2 is the component's terminal return (the review path).
const editStepBlock = (() => {
  const m = src.match(
    /if\s*\(step\s*===\s*"edit"\)\s*\{\s*return\s*\(([\s\S]*?<\/ModalShell>)\s*\);\s*\}/,
  );
  return m ? m[1] : "";
})();
const reviewStepBlock = (() => {
  // Slice past step 1's closing `}` then anchor on the second
  // `</ModalShell>` for the review return.
  const m = src.match(
    /if\s*\(step\s*===\s*"edit"\)\s*\{\s*return\s*\([\s\S]*?<\/ModalShell>\s*\);\s*\}([\s\S]*)/,
  );
  if (!m) return "";
  const after = m[1];
  const reviewMatch = after.match(/return\s*\(([\s\S]*?<\/ModalShell>)\s*\);/);
  return reviewMatch ? reviewMatch[1] : "";
})();

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("BulkEditTagsModal — uses canonical ModalShell + Modal* primitives", () => {
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
});

// ── 2. Two-step wizard structure ─────────────────────────────────

describe("BulkEditTagsModal — two-step wizard preserved (edit + review)", () => {
  it("step state is a 'edit' | 'review' union and starts at 'edit'", () => {
    expect(src).toMatch(/type\s+Step\s*=\s*"edit"\s*\|\s*"review"/);
    expect(src).toMatch(/useState<Step>\("edit"\)/);
  });

  it("renders TWO <ModalShell> mounts (one per step)", () => {
    const matches = codeOnly.match(/<ModalShell\b/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("edit step is gated on `if (step === \"edit\")` and returns its own <ModalShell>", () => {
    expect(editStepBlock).toMatch(/<ModalShell\b/);
  });

  it("review step is the terminal return (renders the second <ModalShell>)", () => {
    expect(reviewStepBlock).toMatch(/<ModalShell\b/);
  });
});

// ── 3. Step 1 (edit) — composition + width contract ──────────────

describe("BulkEditTagsModal — step 1 (edit) composition", () => {
  it("ModalShell carries `max-w-md max-h-[85vh] flex flex-col` for the capped flex-stack layout", () => {
    expect(editStepBlock).toMatch(
      /<ModalShell[\s\S]*?className="max-w-md max-h-\[85vh\] flex flex-col"/,
    );
  });

  it("ModalShell wires onOpenChange to handleOpenChange (the close-resets-state wrapper)", () => {
    expect(editStepBlock).toMatch(
      /<ModalShell[\s\S]*?onOpenChange=\{handleOpenChange\}/,
    );
  });

  it("ModalHeader carries the icon-title + ModalDescription (count line)", () => {
    expect(editStepBlock).toMatch(
      /<ModalTitle\s+className="flex items-center gap-2">[\s\S]*?<Tag\s+className="h-4 w-4"\s*\/>[\s\S]*?Bulk Edit Tags[\s\S]*?<\/ModalTitle>/,
    );
    expect(editStepBlock).toMatch(
      /<ModalDescription>\s*Applying to \{countLabel\}\s*<\/ModalDescription>/,
    );
  });

  it("ModalBody uses className=\"space-y-4\" (recreates the prior gap-4 between body sections)", () => {
    expect(editStepBlock).toMatch(/<ModalBody\s+className="space-y-4">/);
  });

  it("step 1 ModalFooter renders Cancel + Review Changes with the gap-2 sm:gap-0 override", () => {
    expect(editStepBlock).toMatch(
      /<ModalFooter\s+className="gap-2 sm:gap-0">[\s\S]*?Cancel[\s\S]*?Review Changes/,
    );
  });

  it("Review Changes button is disabled when !hasChanges", () => {
    expect(editStepBlock).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*setStep\("review"\)\}[\s\S]*?disabled=\{!hasChanges\}/,
    );
  });
});

// ── 4. Step 2 (review) — composition ─────────────────────────────

describe("BulkEditTagsModal — step 2 (review) composition", () => {
  it("ModalShell carries `max-w-md` (no max-h — natural sizing)", () => {
    expect(reviewStepBlock).toMatch(
      /<ModalShell[\s\S]*?className="max-w-md"/,
    );
    // Negative pin: review step does NOT carry a max-h or flex stack.
    const shellMatch = reviewStepBlock.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/max-h/);
    expect(shellMatch![1]).not.toMatch(/\bflex\b/);
  });

  it("ModalHeader carries the icon-title 'Confirm Bulk Tag Changes' (no description)", () => {
    expect(reviewStepBlock).toMatch(
      /<ModalTitle\s+className="flex items-center gap-2">[\s\S]*?<Tag\s+className="h-4 w-4"\s*\/>[\s\S]*?Confirm Bulk Tag Changes[\s\S]*?<\/ModalTitle>/,
    );
    // Review step has NO ModalDescription.
    expect(reviewStepBlock).not.toMatch(/<ModalDescription\b/);
  });

  it("ModalBody uses className=\"space-y-4\" (wraps Summary + Entity name preview)", () => {
    expect(reviewStepBlock).toMatch(/<ModalBody\s+className="space-y-4">/);
  });

  it("step 2 ModalFooter renders Back + Confirm & Apply with the gap-2 sm:gap-0 override", () => {
    expect(reviewStepBlock).toMatch(
      /<ModalFooter\s+className="gap-2 sm:gap-0">[\s\S]*?Back[\s\S]*?Confirm & Apply/,
    );
  });

  it("Back button calls setStep('edit')", () => {
    expect(reviewStepBlock).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*setStep\("edit"\)\}/,
    );
  });

  it("Confirm & Apply button calls applyMutation.mutate() and is disabled while applyMutation.isPending", () => {
    expect(reviewStepBlock).toMatch(
      /<Button[\s\S]*?onClick=\{\(\)\s*=>\s*applyMutation\.mutate\(\)\}[\s\S]*?disabled=\{applyMutation\.isPending\}/,
    );
  });

  it("Confirm button label switches between 'Applying...' (pending) and 'Confirm & Apply' (idle)", () => {
    expect(reviewStepBlock).toMatch(
      /\{applyMutation\.isPending\s*\?\s*"Applying\.\.\."\s*:\s*"Confirm & Apply"\}/,
    );
  });
});

// ── 5. Width-contract regression pin (no inline p-0 gap-0) ───────

describe("BulkEditTagsModal — width contract (Rule #5)", () => {
  it("step 1 ModalShell does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = editStepBlock.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });

  it("step 2 ModalShell does NOT pass `p-0 gap-0` inline", () => {
    const shellMatch = reviewStepBlock.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });

  it("ModalBody className doesn't override padding (canonical px-5 py-4 takes over)", () => {
    const editBodyMatch = editStepBlock.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(editBodyMatch).not.toBeNull();
    expect(editBodyMatch![1]).not.toMatch(/\bpx-/);
    expect(editBodyMatch![1]).not.toMatch(/\bpy-/);

    const reviewBodyMatch = reviewStepBlock.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(reviewBodyMatch).not.toBeNull();
    expect(reviewBodyMatch![1]).not.toMatch(/\bpx-/);
    expect(reviewBodyMatch![1]).not.toMatch(/\bpy-/);
  });
});

// ── 6. Bulk state + mutation behavior preserved ─────────────────

describe("BulkEditTagsModal — bulk add/remove state preserved", () => {
  it("addTagIds and removeTagIds are Sets of strings (used as bulk-mode selection state)", () => {
    expect(src).toMatch(/useState<Set<string>>\(new Set\(\)\)/);
  });

  it("toggleAdd / toggleRemove flip membership in their respective Sets", () => {
    expect(src).toMatch(
      /toggleAdd\s*=\s*\(tagId:\s*string\)\s*=>\s*\{[\s\S]*?setAddTagIds\(\(prev\)\s*=>\s*\{[\s\S]*?if\s*\(next\.has\(tagId\)\)\s*next\.delete\(tagId\);\s*else\s*next\.add\(tagId\);/,
    );
    expect(src).toMatch(
      /toggleRemove\s*=\s*\(tagId:\s*string\)\s*=>\s*\{[\s\S]*?setRemoveTagIds\(\(prev\)\s*=>\s*\{[\s\S]*?if\s*\(next\.has\(tagId\)\)\s*next\.delete\(tagId\);\s*else\s*next\.add\(tagId\);/,
    );
  });

  it("addable tags exclude tags already in the remove list (and vice versa)", () => {
    expect(src).toMatch(
      /addableTags\s*=\s*useMemo[\s\S]*?allTags\.filter\(\(t\)\s*=>\s*!removeTagIds\.has\(t\.id\)\)/,
    );
    expect(src).toMatch(
      /removableTags\s*=\s*useMemo[\s\S]*?allTags\.filter\(\(t\)\s*=>\s*!addTagIds\.has\(t\.id\)\)/,
    );
  });

  it("hasChanges = addTagIds.size > 0 || removeTagIds.size > 0", () => {
    expect(src).toMatch(
      /const\s+hasChanges\s*=\s*addTagIds\.size\s*>\s*0\s*\|\|\s*removeTagIds\.size\s*>\s*0/,
    );
  });

  it("close handler resets step to 'edit' and clears both Sets + search", () => {
    expect(src).toMatch(
      /handleOpenChange[\s\S]*?if\s*\(!val\)\s*\{[\s\S]*?setStep\("edit"\);[\s\S]*?setAddTagIds\(new Set\(\)\);[\s\S]*?setRemoveTagIds\(new Set\(\)\);[\s\S]*?setSearch\(""\);/,
    );
  });

  it("preview names take the first 10 entity names for the review step", () => {
    expect(src).toMatch(
      /previewNames\s*=\s*useMemo[\s\S]*?for\s*\(const id of selectedIds\)\s*\{[\s\S]*?if\s*\(names\.length\s*>=\s*10\)\s*break;/,
    );
  });

  it("count label pluralizes correctly (singular vs plural based on selectedIds.length)", () => {
    expect(src).toMatch(
      /countLabel\s*=\s*`\$\{selectedIds\.length\}\s*\$\{selectedIds\.length\s*!==\s*1\s*\?\s*config\.labelPlural\s*:\s*config\.label\}`/,
    );
  });
});

// ── 7. Mutation contract + invalidations preserved ──────────────

describe("BulkEditTagsModal — mutation contracts preserved", () => {
  it("entity-type config discriminates customerCompany vs location (endpoint, idField, cacheKey, labels)", () => {
    expect(src).toMatch(
      /customerCompany:\s*\{[\s\S]*?endpoint:\s*"\/api\/customer-companies\/bulk-tags"[\s\S]*?idField:\s*"customerCompanyIds"[\s\S]*?cacheKey:\s*\[\s*"\/api\/tags\/assignments"\s*\][\s\S]*?label:\s*"client"/,
    );
    expect(src).toMatch(
      /location:\s*\{[\s\S]*?endpoint:\s*"\/api\/locations\/bulk-tags"[\s\S]*?idField:\s*"locationIds"[\s\S]*?cacheKey:\s*\[\s*"\/api\/tags\/location-assignments"\s*\][\s\S]*?label:\s*"location"/,
    );
  });

  it("applyMutation POSTs to the entity-typed bulk-tags endpoint with `[idField]: selectedIds + addTagIds + removeTagIds` payload", () => {
    expect(src).toMatch(
      /apiRequest[^(]*\(\s*config\.endpoint,\s*\{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\(\{\s*\[config\.idField\]:\s*selectedIds,[\s\S]*?addTagIds:\s*Array\.from\(addTagIds\),[\s\S]*?removeTagIds:\s*Array\.from\(removeTagIds\),?\s*\}\)/,
    );
  });

  it("applyMutation success: invalidates config.cacheKey, toasts the updatedCount, closes the modal, fires onApplied", () => {
    expect(src).toMatch(
      /applyMutation[\s\S]*?onSuccess:\s*\(result\)\s*=>\s*\{[\s\S]*?queryClient\.invalidateQueries\(\{\s*queryKey:\s*config\.cacheKey\s*\}\)[\s\S]*?toast\(\{\s*title:\s*`Updated tags for \$\{result\.updatedCount\}\s*\$\{config\.labelPlural\}`\s*\}\)[\s\S]*?handleOpenChange\(false\)[\s\S]*?onApplied\(\)/,
    );
  });

  it("applyMutation error: surfaces destructive toast with the server message", () => {
    expect(src).toMatch(
      /applyMutation[\s\S]*?onError:\s*\(err:\s*Error\)\s*=>\s*\{[\s\S]*?toast\(\{[\s\S]*?title:\s*"Failed to update tags"[\s\S]*?description:\s*err\.message[\s\S]*?variant:\s*"destructive"/,
    );
  });
});

// ── 8. Inline create-tag flow preserved ─────────────────────────

describe("BulkEditTagsModal — inline create-tag flow preserved", () => {
  it("createMutation POSTs to /api/tags with name + color body", () => {
    expect(src).toMatch(
      /apiRequest<ClientTag>\(\s*"\/api\/tags",\s*\{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\(body\)/,
    );
  });

  it("createMutation success: invalidates [\"/api/tags\"], auto-adds the new tag to the Add set, clears the search input", () => {
    expect(src).toMatch(
      /createMutation[\s\S]*?onSuccess:\s*\(newTag\)\s*=>\s*\{[\s\S]*?queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/tags"\s*\]\s*\}\)[\s\S]*?setAddTagIds\(\(prev\)\s*=>\s*new Set\(prev\)\.add\(newTag\.id\)\)[\s\S]*?setSearch\(""\)/,
    );
  });

  it("Enter on the search input triggers handleCreateAndAdd when canCreate", () => {
    expect(src).toMatch(
      /onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?if\s*\(e\.key\s*===\s*"Enter"\s*&&\s*canCreate\)\s*\{[\s\S]*?e\.preventDefault\(\);[\s\S]*?handleCreateAndAdd\(\)/,
    );
  });

  it("canCreate gate: blank search returns false; existing tag-name match returns false (mirrors EditTagsModal)", () => {
    expect(src).toMatch(
      /const\s+canCreate\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!q\)\s*return\s+false;[\s\S]*?return\s+!allTags\.some\(\(t\)\s*=>\s*t\.name\.toLowerCase\(\)\s*===\s*q\)/,
    );
  });

  it("color picker (9-color set) gated on canCreate (only visible while creating)", () => {
    expect(src).toMatch(
      /\{canCreate\s*&&\s*\(\s*<div\s+className="flex items-center gap-2">[\s\S]*?Color:[\s\S]*?TAG_COLORS\.map/,
    );
  });

  it("Create button gated on canCreate + disabled while createMutation.isPending", () => {
    expect(editStepBlock).toMatch(
      /<Button[\s\S]*?onClick=\{handleCreateAndAdd\}[\s\S]*?disabled=\{createMutation\.isPending\}/,
    );
  });
});

// ── 9. Tenant-tags fetch is gated on `open` ────────────────────

describe("BulkEditTagsModal — fetches tenant tags only while open", () => {
  it("useQuery for /api/tags is enabled only when `open` is truthy", () => {
    expect(src).toMatch(
      /useQuery<ClientTag\[\]>\(\{\s*queryKey:\s*\[\s*"\/api\/tags"\s*\]\s*,\s*enabled:\s*open\s*,?\s*\}\)/,
    );
  });
});
