/**
 * Phase 3 — theme persistence guard (2026-05-11).
 *
 * File-read assertions that verify the full persistence chain is wired
 * correctly: DB schema, API shape, client hook, zero-flicker hydration,
 * and UI integration. No runtime execution — purely structural.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string) {
  return readFileSync(resolve(__dirname, rel), "utf-8");
}

const schemaSrc   = read("../shared/schema.ts");
const authSrv     = read("../server/routes/auth.ts");
const authClient  = read("../client/src/lib/auth.tsx");
const indexHtml   = read("../client/index.html");
const useThemeSrc = read("../client/src/hooks/useTheme.ts");
const appSrc      = read("../client/src/App.tsx");

// ── 1. Schema ─────────────────────────────────────────────────────────────

describe("Phase 3 — schema: appearance column", () => {
  it("shared/schema.ts exports userAppearanceEnum with 'dark' and 'light'", () => {
    expect(schemaSrc).toMatch(/userAppearanceEnum\s*=\s*\[["']dark["'],\s*["']light["']\]/);
  });

  it("shared/schema.ts users table has appearance column with default 'dark'", () => {
    expect(schemaSrc).toMatch(/appearance.*text.*notNull.*default.*dark/);
  });
});

// ── 2. Server route ───────────────────────────────────────────────────────

describe("Phase 3 — server: auth routes", () => {
  it("server/routes/auth.ts GET /me response includes appearance field", () => {
    expect(authSrv).toMatch(/appearance.*req\.user.*appearance/);
  });

  it("server/routes/auth.ts has PATCH /me/appearance endpoint", () => {
    expect(authSrv).toMatch(/router\.patch\(["']\/me\/appearance/);
  });

  it("server/routes/auth.ts PATCH /me/appearance validates z.enum(['dark','light'])", () => {
    expect(authSrv).toMatch(/z\.enum\(\[["']dark["'],\s*["']light["']\]\)/);
  });

  it("server/routes/auth.ts PATCH /me/appearance calls storage.updateUser", () => {
    expect(authSrv).toMatch(/storage\.updateUser/);
  });
});

// ── 3. Client User interface ──────────────────────────────────────────────

describe("Phase 3 — client: User interface", () => {
  it("client/src/lib/auth.tsx User interface has appearance field typed 'dark' | 'light'", () => {
    expect(authClient).toMatch(/appearance\??\s*:\s*['"]dark['"]\s*\|\s*['"]light['"]/);
  });
});

// ── 4. Zero-flicker hydration ─────────────────────────────────────────────

describe("Phase 3 — zero-flicker: index.html inline script", () => {
  it("client/index.html has inline script that reads localStorage appearance", () => {
    expect(indexHtml).toMatch(/localStorage\.getItem\(['"]appearance['"]\)/);
  });

  it("client/index.html inline script adds .light class conditionally", () => {
    expect(indexHtml).toMatch(/classList\.add\(['"]light['"]\)/);
  });

  it("client/index.html inline script is inside <head> before page content", () => {
    const headEnd = indexHtml.indexOf("</head>");
    const scriptPos = indexHtml.indexOf("localStorage.getItem('appearance')");
    expect(scriptPos).toBeGreaterThan(0);
    expect(scriptPos).toBeLessThan(headEnd);
  });
});

// ── 5. useTheme hook ──────────────────────────────────────────────────────

describe("Phase 3 — useTheme hook", () => {
  it("client/src/hooks/useTheme.ts exports applyTheme function", () => {
    expect(useThemeSrc).toMatch(/export function applyTheme/);
  });

  it("client/src/hooks/useTheme.ts exports useTheme hook", () => {
    expect(useThemeSrc).toMatch(/export function useTheme/);
  });

  it("useTheme.ts writes to localStorage.setItem('appearance', ...)", () => {
    expect(useThemeSrc).toMatch(/localStorage\.setItem\(['"]appearance['"]/);
  });

  it("useTheme.ts calls PATCH /api/auth/me/appearance for DB persistence", () => {
    expect(useThemeSrc).toMatch(/\/api\/auth\/me\/appearance/);
  });

  it("useTheme.ts uses optimistic queryClient.setQueryData update", () => {
    expect(useThemeSrc).toMatch(/queryClient\.setQueryData/);
  });

  it("useTheme.ts rolls back on PATCH failure", () => {
    expect(useThemeSrc).toMatch(/catch/);
  });

  it("useTheme.ts applies theme by toggling .light on documentElement", () => {
    expect(useThemeSrc).toMatch(/documentElement\.classList/);
  });
});

// ── 6. App.tsx UI integration ─────────────────────────────────────────────

describe("Phase 3 — App.tsx: appearance toggle in More menu", () => {
  it("App.tsx imports useTheme from @/hooks/useTheme", () => {
    expect(appSrc).toMatch(/import.*useTheme.*from.*["']@\/hooks\/useTheme["']/);
  });

  it("App.tsx calls useTheme() destructuring theme and setTheme", () => {
    expect(appSrc).toMatch(/useTheme\(\)/);
    expect(appSrc).toMatch(/setTheme/);
  });

  it("App.tsx has appearance toggle menu item with data-testid", () => {
    expect(appSrc).toMatch(/data-testid="menu-appearance-toggle"/);
  });

  it("App.tsx imports Moon and Sun from lucide-react", () => {
    expect(appSrc).toMatch(/Moon/);
    expect(appSrc).toMatch(/Sun/);
  });
});

// ── 7. No forbidden patterns ──────────────────────────────────────────────

describe("Phase 3 — no forbidden patterns in theme infrastructure", () => {
  it("useTheme.ts: no isDark / isLight conditional theming", () => {
    expect(useThemeSrc).not.toMatch(/\bisDark\b/);
    expect(useThemeSrc).not.toMatch(/\bisLight\b/);
  });

  it("useTheme.ts: no dark: Tailwind prefix (uses class toggle, not prefixes)", () => {
    expect(useThemeSrc).not.toMatch(/\bdark:/);
  });

  it("useTheme.ts: does not import ThemeProvider", () => {
    expect(useThemeSrc).not.toMatch(/ThemeProvider/);
  });
});
