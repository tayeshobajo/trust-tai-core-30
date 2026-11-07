/** Canonical hosting Request URL only: never use client Origin/Host/forwarding headers. */
export function classifyStudioPreviewOrigin(request: Request): "preview" | "production" | "other" {
  try {
    const url = new URL(request.url);
    if (url.username || url.password || url.hash) return "other";
    if (url.origin === "https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app")
      return "preview";
    if (url.origin === "https://cmd.trusttai.com") return "production";
  } catch {
    // Unknown/internal/malformed URLs fail closed, without a header fallback.
  }
  return "other";
}

/** Temporary inert diagnostic. No configuration, environment, body or service access. */
export function studioPreviewOriginDiagnostic(request: Request) {
  return {
    build: "studio-preview-origin-check-v1",
    origin: classifyStudioPreviewOrigin(request),
  } as const;
}
