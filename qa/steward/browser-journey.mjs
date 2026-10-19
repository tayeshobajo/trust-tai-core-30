import { chromium } from "playwright";
import fs from "node:fs/promises";
const dir = new URL("../../docs/steward-approved/screenshots", import.meta.url).pathname;
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const results = [];
for (const width of [1440, 768, 375]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("http://127.0.0.1:4176/qa/steward/index.html");
  await page.getByRole("heading", { name: "Meetings", exact: true }).waitFor();
  await page.screenshot({ path: `${dir}/overview-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Awaiting review", exact: true }).click();
  if (await page.getByRole("button", { name: /Website launch check-in/ }).count())
    throw Error("Filter failed");
  await page.getByRole("button", { name: "All meetings", exact: true }).click();
  await page.getByRole("button", { name: /Delivery planning/ }).click();
  await page
    .getByRole("button", { name: /Capture repeatable/ })
    .first()
    .click();
  await page.getByLabel("Task update").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/detail-${width}.png`, fullPage: width === 1440 });
  await page.getByRole("button", { name: /Roll forward/ }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Task update").fill(`Browser update ${width}`);
  await page.getByRole("button", { name: "Post update", exact: true }).dblclick();
  await page.getByText("Saved.", { exact: true }).waitFor();
  if ((await page.getByText(`Browser update ${width}`, { exact: true }).count()) !== 1)
    throw Error("Duplicate update");
  await page.reload();
  await page.getByText(`Browser update ${width}`, { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByText(/Original meeting: Delivery planning/).waitFor();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await page.getByText(/Work status does not mean/).waitFor();
  await page.getByRole("button", { name: "Close task details", exact: true }).click();
  await page.goBack();
  await page.getByLabel("Task update").waitFor();
  await page.goForward();
  if (await page.getByLabel("Task update").count()) throw Error("Forward did not close");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw Error(`Overflow ${width}`);
  results.push({
    width,
    errors,
    passed: [
      "filters",
      "task open",
      "cancel",
      "double click",
      "update refresh",
      "details",
      "evidence",
      "close",
      "back",
      "forward",
      "no horizontal overflow",
    ],
  });
  await page.close();
}
await fs.writeFile(dir + "/browser-results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
await browser.close();
