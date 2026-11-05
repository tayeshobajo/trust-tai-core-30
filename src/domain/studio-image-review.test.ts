import { describe, it, expect } from "vitest";
import { imageReviewStatus, safeImageUrl, imageFileError } from "./studio-image-review";
const image = {
  state: "ready" as const,
  brief: "A specific story",
  altText: "",
  assetUrl: "https://example.com/image.png",
  provider: null,
};
describe("image readiness is not approval", () => {
  it("requires review even for a ready legacy asset", () =>
    expect(imageReviewStatus(image)).toBe("Review required"));
  it("does not invent production progress from pending", () =>
    expect(imageReviewStatus({ ...image, state: "pending", assetUrl: null })).toBe("Needs image"));
  it("does not call a ready row without an asset ready", () =>
    expect(imageReviewStatus({ ...image, assetUrl: null })).toBe("Needs image"));
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "https://user:password@example.com/image",
    "http://example.com/image",
  ])("rejects unsafe asset %s", (url) => expect(safeImageUrl(url)).toBeNull());
  it("rejects oversized and unsupported files", () => {
    expect(imageFileError({ type: "image/png", size: 9 * 1024 * 1024 })).toMatch("8 MB");
    expect(imageFileError({ type: "image/svg+xml", size: 100 })).toMatch("JPEG");
    expect(imageFileError({ type: "image/webp", size: 100 })).toBeNull();
  });
});
