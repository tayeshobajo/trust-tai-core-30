import { expect, it } from "vitest";
import { reviewReceiptSchema } from "./roadmap-correspondence-review";
import { reviewFixture } from "./roadmap-correspondence-review.fixtures";
it("binds the current-and-future authorized-team policy and rejects the earlier fixed policy", () => {
  expect(reviewReceiptSchema.safeParse(reviewFixture).success).toBe(true);
  expect(
    reviewReceiptSchema.safeParse({
      ...reviewFixture,
      envelope: { ...reviewFixture.envelope, audiencePolicy: "fixed_initial_nine" },
    }).success,
  ).toBe(false);
});
it("retains an audit roster without imposing a nine-account cap, while rejecting duplicates", () => {
  const audience = [...reviewFixture.envelope.audience, "20000000-0000-4000-8000-000000000001"];
  expect(
    reviewReceiptSchema.safeParse({
      ...reviewFixture,
      envelope: { ...reviewFixture.envelope, audience },
    }).success,
  ).toBe(true);
  expect(
    reviewReceiptSchema.safeParse({
      ...reviewFixture,
      envelope: { ...reviewFixture.envelope, audience: [...audience, audience[0]] },
    }).success,
  ).toBe(false);
});
