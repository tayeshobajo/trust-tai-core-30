import { expect, it } from "vitest";
import { Route } from "@/routes/api/public/settings.admin-password";
it("exposes a POST handler", () => {
  const options = (Route as unknown as { options: any }).options;
  expect(typeof options?.server?.handlers?.POST).toBe("function");
});
