/**
 * Typography runtime inspector — reads computed CSS from live browser.
 * Navigates to /jobs and /pm-workspace, inspects visible cell typography.
 * Run: node scripts/inspect-typography.mjs [email] [password]
 *
 * If email/password omitted, launches headed browser and pauses at the
 * login form so you can log in manually, then continues automatically.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5000";
const [, , EMAIL, PASSWORD] = process.argv;
const HEADLESS = !!(EMAIL && PASSWORD);

async function getComputedTypography(page, selector, label) {
  try {
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      // Walk up the tree to find the winning CSS rule for font-size
      const allRules = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.style && el.matches && el.matches(rule.selectorText)) {
              allRules.push({
                selector: rule.selectorText,
                fontSize: rule.style.fontSize,
                lineHeight: rule.style.lineHeight,
                fontWeight: rule.style.fontWeight,
              });
            }
          }
        } catch (_) {}
      }
      return {
        classList: Array.from(el.classList).join(" "),
        computedFontSize: cs.fontSize,
        computedLineHeight: cs.lineHeight,
        computedFontWeight: cs.fontWeight,
        htmlTag: el.tagName.toLowerCase(),
        innerText: el.innerText?.slice(0, 60).replace(/\n/g, "↵"),
        matchingRules: allRules.slice(-5), // last 5 = highest specificity first (CSS order)
      };
    }, selector);
    console.log(`\n── ${label} ──`);
    if (!result) {
      console.log(`  ⚠  Element not found: ${selector}`);
      return;
    }
    console.log(`  tag:         <${result.htmlTag}>`);
    console.log(`  classes:     ${result.classList || "(none)"}`);
    console.log(`  innerText:   "${result.innerText}"`);
    console.log(`  font-size:   ${result.computedFontSize}  ← computed`);
    console.log(`  line-height: ${result.computedLineHeight}`);
    console.log(`  font-weight: ${result.computedFontWeight}`);
    if (result.matchingRules.length) {
      console.log(`  matching CSS rules (last wins):`);
      for (const r of result.matchingRules) {
        const parts = [r.fontSize && `font-size:${r.fontSize}`, r.lineHeight && `line-height:${r.lineHeight}`, r.fontWeight && `font-weight:${r.fontWeight}`].filter(Boolean).join("; ");
        console.log(`    { ${parts || "(no typography)"} }  ← ${r.selector}`);
      }
    }
  } catch (e) {
    console.log(`  ⚠  Error inspecting ${selector}: ${e.message}`);
  }
}

async function inspectElement(page, locatorFn, label) {
  try {
    const result = await page.evaluate((fn) => {
      // fn is a string we eval — safer to pass selector directly
    }, null);
  } catch (_) {}
}

async function checkTextHelperRule(page) {
  const result = await page.evaluate(() => {
    // Search all stylesheets for a .text-helper rule
    const hits = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes("text-helper")) {
            hits.push({
              selector: rule.selectorText,
              cssText: rule.cssText.slice(0, 200),
            });
          }
        }
      } catch (_) {}
    }
    return hits;
  });
  console.log("\n══ .text-helper rule in generated CSS ══");
  if (!result.length) {
    console.log("  ✗  NOT FOUND — Tailwind did not emit .text-helper in this build");
  } else {
    for (const r of result) {
      console.log(`  ✓  ${r.selector}  →  ${r.cssText}`);
    }
  }
}

async function checkTextTableCellRule(page) {
  const result = await page.evaluate(() => {
    const hits = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes("text-table-cell")) {
            hits.push({ selector: rule.selectorText, cssText: rule.cssText.slice(0, 200) });
          }
          if (rule.selectorText && rule.selectorText.includes("text-row") && !rule.selectorText.includes("text-row-emphasis")) {
            hits.push({ selector: rule.selectorText, cssText: rule.cssText.slice(0, 200) });
          }
        }
      } catch (_) {}
    }
    return hits;
  });
  console.log("\n══ .text-table-cell / .text-row rules in generated CSS ══");
  if (!result.length) {
    console.log("  ✗  NOT FOUND");
  } else {
    for (const r of result) {
      console.log(`  ${r.selector}  →  ${r.cssText}`);
    }
  }
}

async function getRootFontSize(page) {
  const px = await page.evaluate(() => {
    return window.getComputedStyle(document.documentElement).fontSize;
  });
  console.log(`\n══ Root font-size (html element) ══`);
  console.log(`  ${px}`);
}

async function getZoom(page) {
  const zoom = await page.evaluate(() => window.devicePixelRatio);
  console.log(`\n══ devicePixelRatio / zoom ══`);
  console.log(`  ${zoom}`);
}

// ── SELECTORS ─────────────────────────────────────────────────────────────────
// EntityListTable renders divs, not <table>/<td>. Rows are flex containers.
// These selectors target visible cell content in the first data row.
const JOBS_SELECTORS = [
  // primary cell — the EntityName or top-level name span in the first row
  ["[data-testid='job-row']:first-child, .job-row:first-child, [role='row']:first-child", "Jobs — first row container (discovery)"],
];

// ── BROAD DISCOVERY ───────────────────────────────────────────────────────────
async function discoverFirstRow(page, context) {
  const result = await page.evaluate((ctx) => {
    // EntityListTable: root is [data-testid="entity-list-table"]
    // children[0] = header div, children[1] = first data row div
    const table = document.querySelector("[data-testid='entity-list-table']");
    if (table && table.children.length >= 2) {
      const headerRow = table.children[0];
      const dataRow = table.children[1];
      return {
        matched: "[data-testid='entity-list-table'] > div:nth-child(2)",
        tag: dataRow.tagName.toLowerCase(),
        classList: Array.from(dataRow.classList).join(" "),
        childCount: dataRow.children.length,
        children: Array.from(dataRow.children).slice(0, 7).map((c) => ({
          tag: c.tagName.toLowerCase(),
          classes: Array.from(c.classList).join(" "),
          text: c.innerText?.slice(0, 50).replace(/\n/g, "↵"),
        })),
      };
    }

    // Fallback for shadcn Table (Service Plans)
    const trs = Array.from(document.querySelectorAll("tbody tr"));
    if (trs.length > 0) {
      const tr = trs[0];
      return {
        matched: "tbody tr:first-child (shadcn Table)",
        tag: tr.tagName.toLowerCase(),
        classList: Array.from(tr.classList).join(" "),
        childCount: tr.children.length,
        children: Array.from(tr.children).slice(0, 6).map((c) => ({
          tag: c.tagName.toLowerCase(),
          classes: Array.from(c.classList).join(" "),
          text: c.innerText?.slice(0, 50).replace(/\n/g, "↵"),
        })),
      };
    }
    return null;
  }, context);

  console.log(`\n══ First row discovery (${context}) ══`);
  if (!result) {
    console.log("  ⚠  No row found");
  } else {
    console.log(JSON.stringify(result, null, 2).replace(/^/gm, "  "));
  }
  return result;
}

async function inspectCells(page, rowDiscovery, context) {
  if (!rowDiscovery) return;

  const result = await page.evaluate((discovery) => {
    // Re-find the row
    let row;
    if (discovery.matched.includes("entity-list-table")) {
      const table = document.querySelector("[data-testid='entity-list-table']");
      row = table?.children[1]; // children[0]=header, children[1]=first data row
    } else if (discovery.matched.includes("shadcn")) {
      const trs = document.querySelectorAll("tbody tr");
      row = trs[0];
    } else {
      row = document.querySelector(discovery.matched);
    }

    if (!row) return [];
    const cells = Array.from(row.children).slice(0, 7); // up to 7 cells

    return cells.map((cell) => {
      const cs = window.getComputedStyle(cell);
      // Also grab first meaningful text descendant
      const textNode = cell.querySelector("span, div, p, a") ?? cell;
      const tcs = window.getComputedStyle(textNode);

      return {
        cellTag: cell.tagName.toLowerCase(),
        cellClasses: Array.from(cell.classList).join(" "),
        cellText: cell.innerText?.slice(0, 60).replace(/\n/g, "↵"),
        cell: {
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          fontWeight: cs.fontWeight,
        },
        firstTextChild: {
          tag: textNode.tagName.toLowerCase(),
          classes: Array.from(textNode.classList).join(" "),
          fontSize: tcs.fontSize,
          lineHeight: tcs.lineHeight,
          fontWeight: tcs.fontWeight,
        },
      };
    });
  }, rowDiscovery);

  console.log(`\n══ Cell-level computed styles (${context}) ══`);
  result.forEach((cell, i) => {
    console.log(`\n  Cell [${i}]  "${cell.cellText}"`);
    console.log(`    <${cell.cellTag}> classes: ${cell.cellClasses}`);
    console.log(`    computed font-size:   ${cell.cell.fontSize}`);
    console.log(`    computed line-height: ${cell.cell.lineHeight}`);
    console.log(`    computed font-weight: ${cell.cell.fontWeight}`);
    if (cell.firstTextChild.classes !== cell.cellClasses) {
      console.log(`    first text child <${cell.firstTextChild.tag}> classes: ${cell.firstTextChild.classes}`);
      console.log(`      → font-size:   ${cell.firstTextChild.fontSize}`);
      console.log(`      → line-height: ${cell.firstTextChild.lineHeight}`);
      console.log(`      → font-weight: ${cell.firstTextChild.fontWeight}`);
    }
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });

  // Check if we landed on login
  const isLogin = page.url().includes("/login") || (await page.locator('input[type="password"]').count()) > 0;

  if (isLogin && EMAIL && PASSWORD) {
    console.log("Logging in with provided credentials...");
    await page.fill('input[type="email"], input[name="email"], input[name="username"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/(?!.*login)/, { timeout: 10000 });
  } else if (isLogin) {
    console.log("\n⚠  Login page detected. Please log in manually in the browser window.");
    console.log("   The script will continue automatically once you reach the app.\n");
    await page.waitForURL(/(?!.*login)/, { timeout: 120000 });
  }

  // ── JOBS ──────────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════");
  console.log("   JOBS LIST");
  console.log("═══════════════════════════════════════════════");
  await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle", timeout: 15000 });
  // Wait for EntityListTable to mount with data (children[1] = first data row)
  try {
    await page.waitForFunction(
      () => {
        const t = document.querySelector("[data-testid='entity-list-table']");
        return t && t.children.length >= 2;
      },
      { timeout: 10000 }
    );
  } catch (_) {
    // Page might be empty/filtered — log the page body for diagnosis
    console.log("  ⚠  EntityListTable has no data rows — dumping page structure:");
    const dump = await page.evaluate(() => {
      const testIds = Array.from(document.querySelectorAll("[data-testid]")).map(
        (el) => `${el.tagName.toLowerCase()}[data-testid="${el.getAttribute("data-testid")}"] children=${el.children.length}`
      );
      const tableEl = document.querySelector("[data-testid='entity-list-table']");
      return {
        url: window.location.href,
        testIds: testIds.slice(0, 20),
        entityListTableFound: !!tableEl,
        entityListTableChildren: tableEl ? tableEl.children.length : 0,
        bodyText: document.body.innerText.slice(0, 300),
      };
    });
    console.log(JSON.stringify(dump, null, 2).replace(/^/gm, "  "));
  }
  await page.waitForTimeout(500);

  await getRootFontSize(page);
  await getZoom(page);
  await checkTextHelperRule(page);
  await checkTextTableCellRule(page);

  const jobRowDiscovery = await discoverFirstRow(page, "Jobs");
  await inspectCells(page, jobRowDiscovery, "Jobs");

  // ── SERVICE PLANS ─────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════");
  console.log("   SERVICE PLANS (PMWorkspacePage)");
  console.log("═══════════════════════════════════════════════");

  // Try /pm, /service-plans, /preventive-maintenance — common routes
  let pmLoaded = false;
  for (const route of ["/pm", "/service-plans", "/preventive-maintenance", "/pm-workspace"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 8000 }).catch(() => {});
    if (!page.url().includes("/jobs") && !page.url().includes("/login")) {
      pmLoaded = true;
      console.log(`  → Loaded at: ${page.url()}`);
      break;
    }
  }

  if (!pmLoaded) {
    console.log("  ⚠  Could not find Service Plans route. Trying to navigate via sidebar...");
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle" });
    const pmLink = page.locator('a:has-text("Service Plan"), a:has-text("PM"), a:has-text("Preventive")').first();
    if (await pmLink.count()) {
      await pmLink.click();
      await page.waitForLoadState("networkidle");
      console.log(`  → Navigated to: ${page.url()}`);
      pmLoaded = true;
    }
  }

  if (pmLoaded) {
    // Wait for either EntityListTable or shadcn tbody to have rows
    try {
      await page.waitForFunction(
        () => {
          const t = document.querySelector("[data-testid='entity-list-table']");
          if (t && t.children.length >= 2) return true;
          const trs = document.querySelectorAll("tbody tr");
          if (trs.length >= 1) return true;
          return false;
        },
        { timeout: 10000 }
      );
    } catch (_) {
      console.log("  ⚠  No data rows found on Service Plans — page may be empty");
      const dump = await page.evaluate(() => ({
        url: window.location.href,
        bodyText: document.body.innerText.slice(0, 300),
        trs: document.querySelectorAll("tbody tr").length,
      }));
      console.log(JSON.stringify(dump, null, 2).replace(/^/gm, "  "));
    }
    await page.waitForTimeout(500);
    const pmRowDiscovery = await discoverFirstRow(page, "Service Plans");
    await inspectCells(page, pmRowDiscovery, "Service Plans");

    // Also check shadcn TableCell specifically
    const tableResult = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll("td")).slice(0, 4);
      return tds.map((td) => {
        const cs = window.getComputedStyle(td);
        return {
          classes: Array.from(td.classList).join(" "),
          text: td.innerText?.slice(0, 40),
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          fontWeight: cs.fontWeight,
        };
      });
    });
    if (tableResult.length) {
      console.log("\n══ shadcn <td> elements found ══");
      tableResult.forEach((td, i) => {
        console.log(`  <td>[${i}] "${td.text}" classes="${td.classes}" → ${td.fontSize} / ${td.lineHeight} / ${td.fontWeight}`);
      });
    }
  }
} finally {
  if (!HEADLESS) {
    console.log("\n\nInspection complete. Browser window will close in 5 seconds...");
    await page.waitForTimeout(5000);
  }
  await browser.close();
}
