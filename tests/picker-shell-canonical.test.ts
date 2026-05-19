/**
 * Canonical PickerShell primitive source-pin tests (2026-05-12).
 *
 * Pins the API + class contract for the scrollable bordered list shell
 * extracted at `client/src/components/ui/picker-shell.tsx`.
 *
 * These pins fail if a future edit:
 *   - drops the `PickerShell` export or `pickerShellClass` constant,
 *   - removes the structural shell classes (border, rounded-md, divide-y,
 *     overflow-y-auto) from the canonical base,
 *   - re-introduces the ad-hoc shell pattern in any of the 7 migrated
 *     consumers (CollectPaymentDialog, LinkContactDialog ×2,
 *     CreateMaintenancePlanDialog ×2, BatchSendInvoicesModal).
 *
 * Note: vitest runs with environment:"node" and include:"tests/**\/*.test.ts"
 * — this is a source-read pin, not a render test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function src(relPath: string) {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── 1. Primitive contract ─────────────────────────────────────────────────────

describe("picker-shell — canonical primitive contract", () => {
  const primitiveCode = src("client/src/components/ui/picker-shell.tsx");

  it("exports PickerShell component", () => {
    expect(primitiveCode).toMatch(/export\s*\{\s*PickerShell\s*\}/);
  });

  it("exports pickerShellClass constant", () => {
    expect(primitiveCode).toMatch(/export const pickerShellClass\s*=/);
  });

  it("base class includes all four structural tokens", () => {
    expect(primitiveCode).toMatch(/rounded-md/);
    expect(primitiveCode).toMatch(/\bborder\b/);
    expect(primitiveCode).toMatch(/divide-y/);
    expect(primitiveCode).toMatch(/overflow-y-auto/);
  });

  it("supports asChild via Slot", () => {
    expect(primitiveCode).toMatch(/@radix-ui\/react-slot/);
    expect(primitiveCode).toMatch(/asChild/);
  });
});

// ── 2. Migration — ad-hoc shell patterns removed ──────────────────────────────

describe("PickerShell consumers — ad-hoc shells removed", () => {
  // Each migrated file must NOT contain the raw shell combo.
  // We check that the structural tokens no longer appear together on one line.
  const adHocPattern =
    /max-h-[^"]*overflow-y-auto[^"]*rounded-md[^"]*border[^"]*divide-y|rounded-md[^"]*border[^"]*divide-y[^"]*overflow-y-auto/;

  it("CollectPaymentDialog — no raw picker-shell className", () => {
    const code = src("client/src/components/invoice/CollectPaymentDialog.tsx");
    const lines = code.split("\n").filter((l) => adHocPattern.test(l));
    expect(lines).toHaveLength(0);
  });

  it("LinkContactDialog — no raw picker-shell className", () => {
    const code = src(
      "client/src/components/communications/LinkContactDialog.tsx",
    );
    const lines = code.split("\n").filter((l) => adHocPattern.test(l));
    expect(lines).toHaveLength(0);
  });

  it("CreateMaintenancePlanDialog — no raw picker-shell className", () => {
    const code = src(
      "client/src/components/pm/CreateMaintenancePlanDialog.tsx",
    );
    const lines = code.split("\n").filter((l) => adHocPattern.test(l));
    expect(lines).toHaveLength(0);
  });

  it("BatchSendInvoicesModal — no raw picker-shell className", () => {
    const code = src(
      "client/src/components/communication/BatchSendInvoicesModal.tsx",
    );
    const lines = code.split("\n").filter((l) => adHocPattern.test(l));
    expect(lines).toHaveLength(0);
  });
});

// ── 3. Migration — PickerShell is actually used ───────────────────────────────

describe("PickerShell consumers — import confirmed", () => {
  const files = [
    "client/src/components/invoice/CollectPaymentDialog.tsx",
    "client/src/components/communications/LinkContactDialog.tsx",
    "client/src/components/pm/CreateMaintenancePlanDialog.tsx",
    "client/src/components/communication/BatchSendInvoicesModal.tsx",
  ];

  files.forEach((relPath) => {
    it(`${relPath.split("/").pop()} imports PickerShell`, () => {
      const code = src(relPath);
      expect(code).toMatch(/from\s+["']@\/components\/ui\/picker-shell["']/);
    });
  });
});
