/**
 * Scout, people research for one qualified account (server route).
 *
 * Three things happen here and nothing else:
 *   GET               tell the browser whether contact enrichment is connected
 *                     in THIS app runtime. Never a key, never part of one.
 *   POST discover     search the configured provider for people who could own
 *                     or influence the problem. Search only. No paid lookup.
 *   POST enrich       one paid work-email lookup for one named person, asked
 *                     for by a person who clicked.
 *
 * The path is public so it can be reached without the site session, so the
 * handler proves the caller itself: a valid Trust Tai token and an active
 * membership in the workspace it claims, or nothing runs.
 *
 * Nothing here writes a record, sends a message, or enriches in bulk.
 */

import { createFileRoute } from "@tanstack/react-router";

import { bearerToken, clientForToken, requireMember } from "@/lib/context-packet.server";
import {
  EnrichmentNotConfigured,
  ProviderFailure,
  enrichWorkEmail,
  enrichmentStatus,
  searchPeople,
} from "@/lib/contact-enrichment.server";
import { NOT_CONNECTED_MESSAGE, RECOMMENDED_LIMIT } from "@/domain/scout-people";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export const Route = createFileRoute("/api/public/scout/people")({
  server: {
    handlers: {
      GET: async () => Response.json(enrichmentStatus()),

      POST: async ({ request }) => {
        const token = bearerToken(request);
        if (!token) {
          return Response.json({ error: "Sign in to research people." }, { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "That request could not be read." }, { status: 400 });
        }

        const organizationId =
          typeof body["organizationId"] === "string" ? body["organizationId"] : "";
        const action = typeof body["action"] === "string" ? body["action"] : "";
        const companyName = typeof body["companyName"] === "string" ? body["companyName"] : "";
        const domain = typeof body["domain"] === "string" ? body["domain"] : undefined;

        if (!organizationId || !companyName || (action !== "discover" && action !== "enrich")) {
          return Response.json(
            { error: "A workspace, a company and a known action are all needed." },
            { status: 400 },
          );
        }

        const caller = await requireMember(clientForToken(token), token, organizationId);
        if (!caller) {
          return Response.json(
            { error: "You are not an active member of this workspace." },
            { status: 403 },
          );
        }

        const status = enrichmentStatus();
        if (!status.connected) {
          return Response.json({ error: NOT_CONNECTED_MESSAGE, connected: false }, { status: 501 });
        }

        try {
          if (action === "discover") {
            const limit = typeof body["limit"] === "number" ? body["limit"] : RECOMMENDED_LIMIT * 3;
            const result = await searchPeople({
              companyName,
              ...(domain ? { domain } : {}),
              roleFamilies: strings(body["roleFamilies"]),
              limit,
            });
            return Response.json({
              provider: result.provider,
              people: result.people,
              // Search does not buy an address. Enrichment is a separate click.
              enriched: false,
            });
          }

          const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
          if (!fullName) {
            return Response.json({ error: "A person's name is needed." }, { status: 400 });
          }
          const result = await enrichWorkEmail({
            fullName,
            companyName,
            ...(domain ? { domain } : {}),
            ...(typeof body["providerPersonId"] === "string"
              ? { providerPersonId: body["providerPersonId"] }
              : {}),
            ...(typeof body["profileUrl"] === "string" ? { profileUrl: body["profileUrl"] } : {}),
          });
          return Response.json(result);
        } catch (error) {
          if (error instanceof EnrichmentNotConfigured) {
            return Response.json({ error: error.message, connected: false }, { status: 501 });
          }
          if (error instanceof ProviderFailure) {
            return Response.json(
              {
                error: `${error.provider} could not answer. Nothing was saved.`,
                retryable: error.retryable,
              },
              { status: 502 },
            );
          }
          return Response.json(
            { error: "That lookup stopped unexpectedly. Nothing was saved." },
            { status: 500 },
          );
        }
      },
    },
  },
});
