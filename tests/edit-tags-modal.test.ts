/**
 * EditTagsModal modal canonicalization source-pin tests (2026-05-06).
 *
 * Per CLAUDE.md Modal Taxonomy rule #2 (generic / simple modals),
 * `EditTagsModal` routes through the canonical `<ModalShell>` +
 * `<Modal*>` primitives instead of raw `<Dialog>`. The modal is the
 * canonical surface for managing tags on a single customer-company
 * or location entity — mounted from `ClientDetailPage`,
 * `Locations.tsx`, and `Clients.tsx`.
 *
 * Body-shape decision. Mirror the prior `<DialogContent>` layout:
 * the body has multiple sibling sections (current-tags chip strip,
 * search/create input + color picker + create button, available-tags
 * list, empty state) that previously relied on `<DialogContent>`'s
 * baked `gap-4`. Migration uses `<ModalBody className="space-y-4">`
 * to recreate that 16px inter-section rhythm — `<ModalShell>`'s
 * canonical `p-0 gap-0` lock means top-level children no longer get
 * implicit gap, so the rhythm has to live inside ModalBody.
 *
 * No `<ModalFooter>`. The modal has no explicit footer in the source
 * — actions trigger inline (Enter-to-create on the search input +
 * click-to-assign-or-remove on the tag chips). A regression pin
 * locks this absence so a future "let's standardize footers" pass
 * can't add a footer without coordinating with the inline-action
 * pattern.
 *
 * No `<form>` wrapper. The modal uses `onKeyDown` Enter handler on
 * the search input rather than a form-submit boundary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = readFileSync(
  resolve(__dirname, "../client/src/components/EditTagsModal.tsx"),
  "utf-8",
);

const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/[^\n]*/g, "");

// ── 1. Canonical Modal primitives + no raw Dialog ──────────────────

describe("EditTagsModal — uses canonical ModalShell + Modal* primitives", () => {
  it("imports ModalShell + ModalHeader + ModalTitle + ModalBody from @/components/ui/modal", () => {
    expect(src).toMatch(/from\s+["']@\/components\/ui\/modal["']/);
    for (const name of ["ModalShell", "ModalHeader", "ModalTitle", "ModalBody"]) {
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

  it("does NOT render <ModalDescription> (no description in this modal)", () => {
    expect(codeOnly).not.toMatch(/<ModalDescription\b/);
  });

  it("does NOT render <ModalFooter> (no explicit footer — inline actions only)", () => {
    expect(codeOnly).not.toMatch(/<ModalFooter\b/);
  });
});

// ── 2. ModalShell composition + width contract ────────────────────

describe("EditTagsModal — ModalShell composition + width contract (Rule #5)", () => {
  it("mounts <ModalShell> with open + onOpenChange forwarded from props", () => {
    expect(src).toMatch(
      /<ModalShell\s+open=\{open\}\s+onOpenChange=\{onOpenChange\}/,
    );
  });

  it("supplies width at the call-site (max-w-md) — narrow tag-management dialog", () => {
    expect(src).toMatch(/<ModalShell[\s\S]*?className="max-w-md"/);
  });

  it("does NOT pass `p-0 gap-0` inline (already baked into ModalShell)", () => {
    const shellMatch = codeOnly.match(/<ModalShell[\s\S]*?className="([^"]+)"/);
    expect(shellMatch).not.toBeNull();
    expect(shellMatch![1]).not.toMatch(/\bp-0\b/);
    expect(shellMatch![1]).not.toMatch(/\bgap-0\b/);
  });
});

// ── 3. Header — title with icon ───────────────────────────────────

describe("EditTagsModal — header preserves the Tag icon + 'Manage Tags' copy", () => {
  it("ModalHeader contains <ModalTitle> with the flex+icon layout class", () => {
    expect(src).toMatch(
      /<ModalHeader>\s*<ModalTitle\s+className="flex items-center gap-2">/,
    );
  });

  it("ModalTitle renders the Tag icon + 'Manage Tags' copy", () => {
    expect(src).toMatch(
      /<ModalTitle[\s\S]*?<Tag\s+className="h-4 w-4"\s*\/>[\s\S]*?Manage Tags[\s\S]*?<\/ModalTitle>/,
    );
  });
});

// ── 4. Body shape: ModalBody with space-y-4 inter-section rhythm ──

describe("EditTagsModal — ModalBody recreates the prior gap-4 rhythm", () => {
  it("renders <ModalBody className=\"space-y-4\"> (replaces the prior DialogContent gap-4)", () => {
    expect(src).toMatch(/<ModalBody\s+className="space-y-4">/);
  });

  it("ModalBody className has no padding override (canonical px-5 py-4 takes over)", () => {
    const bodyMatch = codeOnly.match(/<ModalBody[\s\S]*?className="([^"]+)"/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).not.toMatch(/\bpx-/);
    expect(bodyMatch![1]).not.toMatch(/\bpy-/);
    expect(bodyMatch![1]).not.toMatch(/\bp-\d/);
  });

  it("body sections render as direct children of <ModalBody> (current-tags chips, search/create, available-tags list, empty state)", () => {
    // Pin the structural sequence — opening of ModalBody followed by
    // the conditional current-tags chip strip block.
    expect(src).toMatch(
      /<ModalBody[\s\S]*?currentTags\.length\s*>\s*0\s*&&\s*\([\s\S]*?<div\s+className="flex flex-wrap gap-1\.5 pb-2">/,
    );
    // Search/create input lives inside a `<div className="space-y-2">` block.
    expect(src).toMatch(/<div\s+className="space-y-2">[\s\S]*?Search or create tag/);
    // Available tags list is a conditional `<div className="max-h-40 overflow-y-auto space-y-1">` block.
    expect(src).toMatch(
      /availableTags\.length\s*>\s*0\s*&&\s*\([\s\S]*?<div\s+className="max-h-40 overflow-y-auto space-y-1">/,
    );
  });
});

// ── 5. Tag selection / mutation behavior preserved ───────────────

describe("EditTagsModal — selection + mutation behavior preserved", () => {
  it("Enter on the search input triggers handleCreateAndAssign when canCreate is true", () => {
    expect(src).toMatch(
      /onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?if\s*\(e\.key\s*===\s*"Enter"\s*&&\s*canCreate\)\s*\{[\s\S]*?e\.preventDefault\(\);[\s\S]*?handleCreateAndAssign\(\)/,
    );
  });

  it("search input is autoFocus", () => {
    expect(src).toMatch(/<Input[\s\S]*?autoFocus[\s\S]*?\/>/);
  });

  it("clicking a current-tag chip's X button removes the tag via assignMutation", () => {
    expect(src).toMatch(
      /onClick=\{\(\)\s*=>\s*handleRemoveTag\(tag\.id\)\}/,
    );
    expect(src).toMatch(/handleRemoveTag\s*=\s*\(tagId:\s*string\)\s*=>\s*\{[\s\S]*?assignMutation\.mutate\(\{\s*removeTagIds:\s*\[tagId\]\s*\}\)/);
  });

  it("clicking an available-tag row assigns the tag via assignMutation", () => {
    expect(src).toMatch(
      /onClick=\{\(\)\s*=>\s*handleAddTag\(tag\.id\)\}/,
    );
    expect(src).toMatch(/handleAddTag\s*=\s*\(tagId:\s*string\)\s*=>\s*\{[\s\S]*?assignMutation\.mutate\(\{\s*addTagIds:\s*\[tagId\]\s*\}\)/);
  });

  it("color-picker row is gated on canCreate (only visible while creating a new tag)", () => {
    expect(src).toMatch(
      /\{canCreate\s*&&\s*\(\s*<div\s+className="flex items-center gap-2">[\s\S]*?Color:[\s\S]*?TAG_COLORS\.map/,
    );
  });

  it("create-and-assign button is gated on canCreate + disabled while createMutation.isPending", () => {
    expect(src).toMatch(
      /<Button[\s\S]*?onClick=\{handleCreateAndAssign\}[\s\S]*?disabled=\{createMutation\.isPending\}/,
    );
  });

  it("handleCreateAndAssign no-ops when !canCreate; otherwise dispatches createMutation with trimmed name + selected color", () => {
    expect(src).toMatch(
      /handleCreateAndAssign[\s\S]*?if\s*\(!canCreate\)\s*return;[\s\S]*?createMutation\.mutate\(\{\s*name:\s*search\.trim\(\),\s*color:\s*newTagColor\s*\}\)/,
    );
  });

  it("canCreate gate: blank search returns false; existing tag-name match returns false", () => {
    expect(src).toMatch(
      /const\s+canCreate\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!q\)\s*return\s+false;[\s\S]*?return\s+!allTags\.some\(\(t\)\s*=>\s*t\.name\.toLowerCase\(\)\s*===\s*q\)/,
    );
  });
});

// ── 6. Mutation contract + invalidations preserved ──────────────

describe("EditTagsModal — mutation contract + invalidations preserved", () => {
  it("assignMutation POSTs to the entity-typed assignment URL with addTagIds / removeTagIds payload shape", () => {
    expect(src).toMatch(
      /apiRequest\(assignmentUrl,\s*\{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\(body\)/,
    );
  });

  it("assignment URL discriminates on entityType (customerCompany vs location)", () => {
    expect(src).toMatch(
      /entityType\s*===\s*"customerCompany"\s*\?\s*`\/api\/customer-companies\/\$\{entityId\}\/tags`\s*:\s*`\/api\/locations\/\$\{entityId\}\/tags`/,
    );
  });

  it("assignment-cache key discriminates on entityType (matching the URL)", () => {
    expect(src).toMatch(
      /entityType\s*===\s*"customerCompany"\s*\?\s*\[\s*"\/api\/customer-companies"\s*,\s*entityId\s*,\s*"tags"\s*\]\s*:\s*\[\s*"\/api\/locations"\s*,\s*entityId\s*,\s*"tags"\s*\]/,
    );
  });

  it("assignMutation onSuccess invalidates the assignment query key + the tag-assignments index", () => {
    expect(src).toMatch(
      /assignMutation[\s\S]*?onSuccess[\s\S]*?queryClient\.invalidateQueries\(\{\s*queryKey:\s*assignmentQueryKey/,
    );
    expect(src).toMatch(
      /queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/tags\/assignments"\s*\]/,
    );
  });

  it("createMutation POSTs to /api/tags with name + color body", () => {
    expect(src).toMatch(
      /apiRequest\(\s*"\/api\/tags",\s*\{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\(body\)/,
    );
  });

  it("createMutation onSuccess invalidates [\"/api/tags\"], auto-assigns the new tag, and clears the search input", () => {
    expect(src).toMatch(
      /createMutation[\s\S]*?onSuccess:\s*\(newTag\)\s*=>\s*\{[\s\S]*?queryClient\.invalidateQueries\(\{\s*queryKey:\s*\[\s*"\/api\/tags"\s*\]\s*\}\)[\s\S]*?assignMutation\.mutate\(\{\s*addTagIds:\s*\[newTag\.id\]\s*\}\)[\s\S]*?setSearch\(""\)/,
    );
  });
});

// ── 7. Tenant-tags fetch is gated on `open` ──────────────────────

describe("EditTagsModal — fetches tenant tags only while open", () => {
  it("useQuery for /api/tags is enabled only when `open` is truthy", () => {
    expect(src).toMatch(
      /useQuery<ClientTag\[\]>\(\{\s*queryKey:\s*\[\s*"\/api\/tags"\s*\]\s*,\s*enabled:\s*open\s*,?\s*\}\)/,
    );
  });
});
