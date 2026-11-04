const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
for (const width of [1440, 768, 430, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const mode of ["empty", "detail", "error", "loading", "readonly"]) {
    await page.goto(`http://127.0.0.1:4347/?mode=${mode}`);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`Overflow ${width} ${mode}`);
    if (mode === "detail" || mode === "empty")
      await page.screenshot({ path: `qa/rfps/${mode}-${width}.png`, fullPage: true });
    results.push({ width, mode, overflow });
  }
}
await page.goto("http://127.0.0.1:4347/?mode=detail");
await page.getByRole("button", { name: "Add opportunity", exact: true }).click();
await page.getByRole("dialog").waitFor();
await page.keyboard.press("Escape");
await page.getByRole("dialog").waitFor({ state: "detached" });
await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
const a11y = await page.evaluate(
  async () =>
    await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }),
);
fs.writeFileSync(
  "qa/rfps/browser-results.json",
  JSON.stringify(
    {
      results,
      errors,
      violations: a11y.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    },
    null,
    2,
  ),
);
await browser.close();
if (errors.length || a11y.violations.length)
  throw new Error(JSON.stringify({ errors, violations: a11y.violations.map((v) => v.id) }));
console.log(
  "PASS: 20 viewport/state checks, dialog keyboard close, no browser errors or WCAG A/AA axe violations.",
);
