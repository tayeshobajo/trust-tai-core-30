/**
 * The featured image boundary, readable from the room.
 *
 * GET says exactly what is configured and what is missing, naming variables
 * and never their values. POST refuses while the boundary is unconfigured,
 * because an invented image address would be worse than no image at all.
 */

import { createFileRoute } from "@tanstack/react-router";

import { imageProviderStatus, prepareFeaturedImage } from "@/lib/content-image.server";

export const Route = createFileRoute("/api/public/content/image")({
  server: {
    handlers: {
      GET: async () => Response.json(imageProviderStatus()),
      POST: async ({ request }) => {
        const header = request.headers.get("Authorization") ?? "";
        if (!header.startsWith("Bearer ")) {
          return Response.json({ error: "Sign in to prepare an image." }, { status: 401 });
        }
        const outcome = await prepareFeaturedImage();
        return Response.json(outcome, { status: 503 });
      },
    },
  },
});
