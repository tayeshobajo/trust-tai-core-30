const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage();
const errors = [];
const results = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const width of [1440, 768, 430, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("http://127.0.0.1:4348/?mode=detail");
  for (const state of ["drafts", "document", "submissions", "amend"]) {
    if (state === "drafts") await page.getByRole("tab", { name: "Drafts (1)" }).click();
    if (state === "document")
      await page.getByRole("button", { name: "Link Google Doc" }).first().click();
    if (state === "submissions") await page.getByRole("tab", { name: "Submissions (1)" }).click();
    if (state === "amend")
      await page.getByRole("button", { name: "Add / correct evidence" }).click();
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
    await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
    const result = await page.evaluate(async () => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      violations: (
        await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    }));
    results.push({ width, state, ...result });
    if (width === 390)
      await page.screenshot({ path: `qa/rfps/documents-${state}-390.png`, fullPage: true });
    if (["document", "amend"].includes(state)) {
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
    }
  }
  for (const precision of ["minute", "date", "unknown"]) {
    await page.getByRole("button", { name: "Record external submission" }).click();
    await page.getByLabel("Submission time precision").selectOption(precision);
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
    if (
      precision === "minute" &&
      (await page.getByLabel("Submitted at (your browser timezone)").getAttribute("step")) !== "60"
    )
      throw Error("Minute precision step lost");
    if (
      precision === "date" &&
      (await page
        .getByLabel("Submission date (as recorded in the evidence)")
        .getAttribute("type")) !== "date"
    )
      throw Error("Date input missing");
    const result = await page.evaluate(async () => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      violations: (
        await axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    }));
    results.push({ width, state: `submission-${precision}`, ...result });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
}
await browser.close();
fs.writeFileSync(
  "qa/rfps/documents-browser-results.json",
  JSON.stringify({ results, errors }, null, 2),
);
if (errors.length || results.some((r) => r.overflow || r.violations.length))
  throw Error("Browser checks failed");
console.log(
  "PASS: 28 document/submission/precision viewport checks, axe WCAG A/AA, Escape and no overflow/errors",
);
