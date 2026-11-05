import type { ContentImage } from "./content";

/** Existing asset readiness is not human approval or a verified production job. */
export function imageReviewStatus(image: ContentImage) {
  return image.state === "ready" && safeImageUrl(image.assetUrl)
    ? "Review required"
    : "Needs image";
}

export function safeImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function imageFileError(file: Pick<File, "size" | "type">): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a JPEG, PNG or WebP image.";
  if (file.size > 8 * 1024 * 1024) return "Choose an image smaller than 8 MB.";
  return null;
}
