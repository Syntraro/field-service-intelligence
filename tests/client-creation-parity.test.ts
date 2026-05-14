/**
 * Parity pin: Lead, Quote, and Invoice create pages all use the canonical
 * CreateClientModal for new client creation.
 *
 * If any of these pages introduces an inline client form or stops wiring
 * CreateClientModal, the relevant assertion fails immediately rather than
 * silently diverging.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const pages = [
  {
    name: "CreateLeadPage",
    path: "../client/src/pages/CreateLeadPage.tsx",
  },
  {
    name: "CreateQuotePage",
    path: "../client/src/pages/CreateQuotePage.tsx",
  },
  {
    name: "NewInvoicePage",
    path: "../client/src/pages/NewInvoicePage.tsx",
  },
] as const;

const sources = pages.map(({ name, path }) => ({
  name,
  src: readFileSync(resolve(__dirname, path), "utf-8"),
}));

describe("CreateClientModal — used by all create pages", () => {
  for (const { name, src } of sources) {
    it(`${name} imports CreateClientModal from @/components/CreateClientModal`, () => {
      expect(src).toMatch(
        /from\s+["']@\/components\/CreateClientModal["']/,
      );
    });

    it(`${name} mounts <CreateClientModal open=...> at page level`, () => {
      expect(src).toMatch(/<CreateClientModal\s+open=/);
    });

    it(`${name} does NOT contain an inline /api/clients/full-create mutation`, () => {
      // The mutation lives inside CreateClientModal, not the page.
      expect(src).not.toMatch(
        /apiRequest[^(]*\(\s*["']\/api\/clients\/full-create["']/,
      );
    });
  }
});

describe("CreateLeadPage — no remnants of the retired inline form", () => {
  const leadSrc = sources.find((s) => s.name === "CreateLeadPage")!.src;

  it("does not reference showCreateClient", () => {
    expect(leadSrc).not.toMatch(/showCreateClient/);
  });

  it("does not reference newCompanyName, newPhone, newEmail, newAddress, newCity", () => {
    expect(leadSrc).not.toMatch(/newCompanyName/);
    expect(leadSrc).not.toMatch(/newPhone/);
    expect(leadSrc).not.toMatch(/newEmail/);
    expect(leadSrc).not.toMatch(/newAddress/);
    expect(leadSrc).not.toMatch(/newCity/);
  });

  it("does not use clientReplaceSlot (prop removed from CanonicalCreateHeader)", () => {
    expect(leadSrc).not.toMatch(/clientReplaceSlot/);
  });

  it("isDirty does not reference createClientOpen or showCreateClient (modal state is isolated)", () => {
    expect(leadSrc).not.toMatch(/isDirty[\s\S]{0,200}createClientOpen/);
    expect(leadSrc).not.toMatch(/isDirty[\s\S]{0,200}showCreateClient/);
  });
});
