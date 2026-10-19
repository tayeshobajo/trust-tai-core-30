import { chromium } from "playwright";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route("**/*", (route) =>
  new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
);
await page.goto("http://127.0.0.1:4176/qa/steward/index.html");
await page.getByRole("button", { name: /Delivery planning/ }).click();
await page
  .getByRole("button", { name: /Capture repeatable/ })
  .first()
  .click();
await page.getByLabel("Task status").selectOption("waiting");
await page.getByText("Status saved.", { exact: true }).waitFor();
await page.getByRole("button", { name: /Roll forward/ }).click();
await page.getByLabel("Task update").fill("Continue at the next checkpoint.");
await page.getByLabel("Later date", { exact: true }).fill("2099-01-01");
await page.getByRole("button", { name: "Save roll forward", exact: true }).click();
await page.getByText(/Rolled forward to 2099/).waitFor();
if ((await page.getByText("8 of 12 complete", { exact: true }).count()) !== 1)
  throw Error("Roll-forward changed completion");
await page.reload();
await page.getByText(/Rolled forward to 2099/).waitFor();
await page.getByRole("button", { name: /Mark complete/ }).click();
await page.getByLabel("Task update").fill("Checked the completed isolated fixture result.");
await page.getByRole("button", { name: "Confirm complete", exact: true }).click();
await page.getByText("9 of 12 complete", { exact: true }).waitFor();
await page.getByRole("button", { name: "Close task details", exact: true }).click();
await page
  .getByRole("button", { name: /Maintain complete/ })
  .first()
  .click();
await page.getByLabel("Task update").fill("Interrupted navigation preserves the correct task.");
await page.getByRole("button", { name: "Post update", exact: true }).click();
await page.getByRole("button", { name: "Close task details", exact: true }).click();
await page
  .getByRole("button", { name: /Prepare Trust Tai/ })
  .first()
  .click();
await page.waitForTimeout(500);
if (
  await page
    .getByText("Interrupted navigation preserves the correct task.", { exact: true })
    .count()
)
  throw Error("Update leaked to next selection");
await page.getByRole("button", { name: "Close task details", exact: true }).click();
await page
  .getByRole("button", { name: /Maintain complete/ })
  .first()
  .click();
await page
  .getByText("Interrupted navigation preserves the correct task.", { exact: true })
  .waitFor();
const result = {
  passed: [
    "native status selection",
    "roll-forward persistence after reload",
    "roll-forward does not complete or inflate score",
    "explicit completion recalculates percentage",
    "interrupted navigation writes only the original task",
  ],
};
console.log(JSON.stringify(result));
await fs.writeFile(
  new URL("../../docs/steward-approved/screenshots/action-results.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
await browser.close();
