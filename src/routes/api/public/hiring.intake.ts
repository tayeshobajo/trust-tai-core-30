import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { publicHiring } from "@/lib/hiring-intake.server";
export const Route = createFileRoute("/api/public/hiring/intake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = { "Cache-Control": "no-store" };
        try {
          const body = await request.text();
          if (body.length > 30000)
            return Response.json({ error: "Request too large" }, { status: 413, headers });
          const p = z
            .object({
              action: z.enum(["jobs", "upload", "submit", "receipt"]),
              input: z.unknown().optional(),
            })
            .parse(JSON.parse(body));
          return Response.json(await publicHiring(p.action, p.input), { headers });
        } catch {
          return Response.json(
            { error: "Hiring is temporarily unavailable. Please retry." },
            { status: 503, headers },
          );
        }
      },
    },
  },
});
