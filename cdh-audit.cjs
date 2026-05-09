const { chromium } = require("playwright");

const BASE = "http://localhost:5000";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  // ── Navigate to login ──
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  // Dump login page inputs
  const inputs = await page.locator("input").evaluateAll(els =>
    els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log("Login inputs:", JSON.stringify(inputs, null, 2));

  await browser.close();
})();
