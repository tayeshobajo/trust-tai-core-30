/**
 * Uploading and opening a client's own files (server route).
 *
 *   POST multipart/form-data   keep one file and record it on the company.
 *   POST { action: "open" }    mint a short lived address for one saved file.
 *
 * The path is public, so the handler proves the caller itself: a valid Trust
 * Tai token, an active membership of the workspace named, and a role allowed
 * to write before anything is kept. Opening needs active membership only.
 *
 * The bytes live in a private store. No address returned from here lasts
 * longer than ten minutes, and every file is proved to belong to this
 * workspace and this company from its own path before it is signed.
 *
 * If the file is kept but its record cannot be written, the bytes are removed
 * again, so nothing is left behind that the page cannot see.
 */

import { createFileRoute } from "@tanstack/react-router";

import { bearerToken, clientForToken, requireActiveMember } from "@/lib/context-packet.server";
import {
  ClientResourcesSchemaUnavailable,
  ClientResourcesStoreError,
  clientResourcesStore,
} from "@/lib/client-resources-store.server";
import {
  ClientFilesUnavailable,
  deleteClientFile,
  fileBelongsTo,
  signClientFile,
  storeClientFile,
} from "@/lib/client-files-store.server";
import {
  CLIENT_FILE_MAX_BYTES,
  categoryForFile,
  isUploadedFile,
  uploadedFilePath,
} from "@/domain/client-files";
import { isResourceCategory } from "@/domain/client-resources";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function failure(error: unknown): Response {
  if (error instanceof ClientFilesUnavailable) {
    return Response.json({ error: error.message, storeUnavailable: true }, { status: 503 });
  }
  if (error instanceof ClientResourcesSchemaUnavailable) {
    return Response.json({ error: error.message, schemaUnavailable: true }, { status: 503 });
  }
  if (error instanceof ClientResourcesStoreError) {
    return Response.json({ error: error.message, saved: false }, { status: 502 });
  }
  if (error instanceof Error && error.message) {
    return Response.json({ error: error.message, saved: false }, { status: 400 });
  }
  return Response.json({ error: "That file could not be saved." }, { status: 500 });
}

async function openOne(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return Response.json({ error: "Sign in to open this file." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Response.json({ error: "That request could not be read." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }

  const organizationId = str(body["organizationId"]);
  const clientId = str(body["clientId"]);
  const url = str(body["url"]);
  if (!organizationId || !clientId || !url) {
    return Response.json(
      { error: "A workspace, a company and a saved file are all needed." },
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

  if (!isUploadedFile(url) || !fileBelongsTo(url, organizationId, clientId)) {
    return Response.json(
      { error: "That file is not one this company holds, so no link was made." },
      { status: 403 },
    );
  }

  const signed = await signClientFile(uploadedFilePath(url) ?? "");
  if (!signed) {
    return Response.json(
      { error: "That file could not be opened just now. It was not changed or removed." },
      { status: 502 },
    );
  }
  return Response.json({ url: signed, expiresInSeconds: 600 });
}

export const Route = createFileRoute("/api/public/clients/files")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const kind = request.headers.get("content-type") ?? "";
        if (!kind.toLowerCase().includes("multipart/form-data")) return openOne(request);

        const token = bearerToken(request);
        if (!token) return Response.json({ error: "Sign in to upload files." }, { status: 401 });

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "That upload could not be read." }, { status: 400 });
        }

        const organizationId = String(form.get("organizationId") ?? "").trim();
        const clientId = String(form.get("clientId") ?? "").trim();
        const file = form.get("file");
        if (!organizationId || !clientId || !(file instanceof File)) {
          return Response.json(
            { error: "A workspace, a company and a file are all needed." },
            { status: 400 },
          );
        }
        if (file.size > CLIENT_FILE_MAX_BYTES) {
          return Response.json(
            { error: "That file is larger than 25 MB, so nothing was saved." },
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
        if (!caller.canWrite) {
          return Response.json(
            { error: "Your role in this workspace can open files but not add them." },
            { status: 403 },
          );
        }

        const askedCategory = String(form.get("category") ?? "").trim();
        const category = isResourceCategory(askedCategory)
          ? askedCategory
          : categoryForFile(file.name, file.type);
        const title = String(form.get("title") ?? "").trim() || file.name;
        const description = String(form.get("description") ?? "").trim();
        const meetingDate = String(form.get("meetingDate") ?? "").trim();
        const projectId = String(form.get("projectId") ?? "").trim();

        let stored: { path: string; url: string } | null = null;
        try {
          stored = await storeClientFile({
            organizationId,
            clientId,
            fileName: file.name,
            contentType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });

          const resource = await clientResourcesStore.add(
            { organizationId, clientId, userId: caller.userId },
            {
              category,
              title: title.slice(0, 200),
              url: stored.url,
              projectId: projectId ? projectId : null,
              ...(description ? { description } : {}),
              ...(meetingDate ? { meetingDate } : {}),
            },
          );
          return Response.json({ resource, saved: true });
        } catch (error) {
          // The record is what the page can see. Without it, the bytes go too.
          if (stored) await deleteClientFile(stored.url).catch(() => undefined);
          return failure(error);
        }
      },
    },
  },
});
