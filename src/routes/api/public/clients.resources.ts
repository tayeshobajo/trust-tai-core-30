/**
 * Files & Links for one client (server route).
 *
 *   POST list     read the links saved for this company.
 *   POST add      save one link. Metadata only.
 *   POST edit     change one saved link.
 *   POST remove   forget one saved link. The external thing is untouched.
 *
 * The path is public so it can be reached without the site session, so the
 * handler proves the caller itself: a valid Trust Tai token, an active
 * membership in the workspace it claims, and, for anything that writes, a role
 * allowed to write. Membership alone never grants a write.
 *
 * Every reference the request supplies is checked against the workspace the
 * caller proved. The client and the project are proved again in the database
 * by trigger, so a forged client id or another company's project cannot be
 * saved even if this handler were wrong.
 */

import { createFileRoute } from "@tanstack/react-router";

import { bearerToken, clientForToken, requireActiveMember } from "@/lib/context-packet.server";
import {
  ClientResourcesSchemaUnavailable,
  ClientResourcesStoreError,
  clientResourcesStore,
  type ResourceWrite,
} from "@/lib/client-resources-store.server";
import { isResourceCategory } from "@/domain/client-resources";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const WRITE_ACTIONS = new Set(["add", "edit", "remove"]);
const KNOWN_ACTIONS = new Set(["list", "add", "edit", "remove"]);

function storeFailure(error: unknown): Response | null {
  if (error instanceof ClientResourcesSchemaUnavailable) {
    return Response.json({ error: error.message, schemaUnavailable: true }, { status: 503 });
  }
  if (error instanceof ClientResourcesStoreError) {
    return Response.json({ error: error.message, saved: false }, { status: 502 });
  }
  return null;
}

function draftFrom(body: Record<string, unknown>): ResourceWrite | null {
  const category = body["category"];
  if (!isResourceCategory(category)) return null;
  const title = str(body["title"]).trim();
  const url = str(body["url"]).trim();
  if (!title || !url) return null;
  const projectId = str(body["projectId"]).trim();
  const description = str(body["description"]).trim();
  const meetingDate = str(body["meetingDate"]).trim();
  return {
    category,
    title,
    url,
    projectId: projectId ? projectId : null,
    ...(description ? { description } : {}),
    ...(meetingDate ? { meetingDate } : {}),
  };
}

export const Route = createFileRoute("/api/public/clients/resources")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearerToken(request);
        if (!token) {
          return Response.json({ error: "Sign in to read this company's links." }, { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "That request could not be read." }, { status: 400 });
        }

        const organizationId = str(body["organizationId"]);
        const clientId = str(body["clientId"]);
        const action = str(body["action"]);

        if (!organizationId || !clientId || !KNOWN_ACTIONS.has(action)) {
          return Response.json(
            { error: "A workspace, a company and a known action are all needed." },
            { status: 400 },
          );
        }

        const caller = await requireActiveMember(clientForToken(token), token, organizationId);
        if (!caller) {
          return Response.json(
            { error: "You are not an active member of this workspace." },
            { status: 403 },
          );
        }
        if (WRITE_ACTIONS.has(action) && !caller.canWrite) {
          return Response.json(
            { error: "Your role in this workspace can open these links but not change them." },
            { status: 403 },
          );
        }

        const scope = { organizationId, clientId, userId: caller.userId };

        try {
          if (action === "list") {
            return Response.json({ resources: await clientResourcesStore.list(scope) });
          }

          if (action === "add") {
            const draft = draftFrom(body);
            if (!draft) {
              return Response.json(
                { error: "A kind, a title and a web address are all needed." },
                { status: 400 },
              );
            }
            return Response.json({
              resource: await clientResourcesStore.add(scope, draft),
              saved: true,
            });
          }

          if (action === "edit") {
            const id = str(body["id"]);
            const draft = draftFrom(body);
            if (!id || !draft) {
              return Response.json(
                { error: "A saved link, a kind, a title and a web address are all needed." },
                { status: 400 },
              );
            }
            return Response.json({
              resource: await clientResourcesStore.edit(scope, id, draft),
              saved: true,
            });
          }

          const id = str(body["id"]);
          if (!id) return Response.json({ error: "A saved link is needed." }, { status: 400 });
          await clientResourcesStore.remove(scope, id);
          return Response.json({ removed: true });
        } catch (error) {
          const failure = storeFailure(error);
          if (failure) return failure;
          return Response.json({ error: "That request could not be finished." }, { status: 500 });
        }
      },
    },
  },
});
