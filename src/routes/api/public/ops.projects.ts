/**
 * The Ops → Trust Tai OS project sync.
 *
 * Ops is the canonical owner of Ops projects. This endpoint is the one door
 * through which Ops pushes a snapshot of them into Core's read-only
 * projection. Core never edits what arrives and never invents what is absent:
 * an unreported count is stored as null so the room can show "—".
 *
 * Auth is a shared secret Ops sends as `Authorization: Bearer <OPS_SYNC_SECRET>`.
 * Without the secret configured, or with the wrong one, nothing is written.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Project = z.object({
  opsProjectId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  company: z.string().trim().max(200).optional(),
  status: z.string().trim().max(80).optional(),
  health: z.enum(["healthy", "attention", "incident", "unknown"]).optional(),
  owner: z.string().trim().max(200).optional(),
  environment: z.string().trim().max(80).optional(),
  canonicalProjectId: z.string().uuid().optional(),
  /** Same-site Ops path, e.g. "/projects/abc". Never a full URL. */
  opsPath: z.string().trim().max(512).optional(),
  openIssues: z.number().int().min(0).max(100000).nullish(),
  openApprovals: z.number().int().min(0).max(100000).nullish(),
  lastActivityAt: z.string().trim().max(40).optional(),
  archived: z.boolean().optional(),
});

const Body = z.object({
  organizationId: z.string().uuid(),
  /** True when this batch is the complete list of Ops projects for the org. */
  full: z.boolean().optional(),
  projects: z.array(Project).max(1000),
});

function safePath(candidate: string | undefined): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (candidate.includes("..") || candidate.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(candidate)) return null;
  if (/^\/+\s*[a-z][a-z0-9+.-]*:/i.test(candidate)) return null;
  return candidate;
}

function timestamp(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const at = new Date(candidate);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Constant-time-ish comparison so the secret cannot be probed by timing. */
function secretMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < presented.length; index += 1) {
    diff |= presented.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

export const Route = createFileRoute("/api/public/ops/projects")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["OPS_SYNC_SECRET"];
        if (!expected) {
          return Response.json({ ok: false, because: "Ops sync is not configured." }, { status: 503 });
        }
        const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!presented || !secretMatches(presented, expected)) {
          return Response.json({ ok: false, because: "Unauthorized." }, { status: 401 });
        }

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { ok: false, because: "That payload was not understood.", issues: parsed.error.issues },
            { status: 400 },
          );
        }

        const { organizationId, projects, full } = parsed.data;
        const syncedAt = new Date().toISOString();
        const rows = projects.map((project) => ({
          organization_id: organizationId,
          ops_project_id: project.opsProjectId,
          project_name: project.name,
          client_label: project.company ?? null,
          status: project.status ?? null,
          health: project.health ?? "unknown",
          owner: project.owner ?? null,
          canonical_project_id: project.canonicalProjectId ?? null,
          ops_path: safePath(project.opsPath),
          open_issues: project.openIssues ?? null,
          open_approvals: project.openApprovals ?? null,
          last_activity_at: timestamp(project.lastActivityAt),
          synced_at: syncedAt,
          needs_attention: project.health === "attention" || project.health === "incident",
          lifecycle_state: project.archived ? "archived" : "active",
        }));

        const { trustTaiServiceRoleClient } = await import("@/lib/execution-bridge.server");
        const supabase = trustTaiServiceRoleClient();

        if (rows.length > 0) {
          const { error } = await supabase
            .from("ops_project_projection" as never)
            .upsert(rows as never, { onConflict: "organization_id,ops_project_id" });
          if (error) {
            return Response.json({ ok: false, because: error.message }, { status: 500 });
          }
        }

        // A full snapshot also retires anything Ops no longer lists, so Core
        // never keeps showing a project Ops has deleted.
        let retired = 0;
        if (full) {
          const keep = rows.map((row) => row.ops_project_id);
          let query = supabase
            .from("ops_project_projection" as never)
            .update({ lifecycle_state: "archived", synced_at: syncedAt } as never)
            .eq("organization_id", organizationId)
            .eq("lifecycle_state", "active");
          if (keep.length > 0) {
            query = query.not(
              "ops_project_id",
              "in",
              `(${keep.map((id) => `"${id.replace(/"/g, '""')}"`).join(",")})`,
            );
          }
          const { data, error } = await query.select("id");
          if (error) {
            return Response.json({ ok: false, because: error.message }, { status: 500 });
          }
          retired = (data ?? []).length;
        }

        return Response.json({ ok: true, synced: rows.length, retired, syncedAt });
      },
    },
  },
});
