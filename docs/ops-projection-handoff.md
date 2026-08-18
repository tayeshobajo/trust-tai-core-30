# Ops → Trust Tai OS project sync (bounded handoff contract)

Ops (Lovable project `79444c46-d25c-47a8-a708-ff496c9d2ad2`, production
`https://ops.trusttai.com`) is the canonical owner of Ops projects. Trust Tai
OS keeps a read-only projection so the Ops room can list real systems and open
the exact one. Core never edits what arrives.

## 1. Core side (done)

| Piece | Where |
| --- | --- |
| Table | `public.ops_project_projection`, defined in `docs/ops-projection-schema.sql` |
| Read | `src/data/ops/projects.ts`, member-only under RLS |
| Merge | `mergeOpsPortfolio` in `src/data/ops/projection.ts` |
| Endpoint | `POST /api/public/ops/projects` (`src/routes/api/public/ops.projects.ts`) |
| Secret | `OPS_SYNC_SECRET` (generated in Core; share the value with Ops) |

Apply `docs/ops-projection-schema.sql` to Supabase project
`okydosoacqdnursmmenf` before the first sync. Until it exists the room stays in
its truthful empty state rather than erroring.

## 2. What Ops must implement

Send the full list of Ops projects for one organization, on a schedule (every
5 minutes is enough) and after any project create/update/delete.

```
POST https://cmd.trusttai.com/api/public/ops/projects
Authorization: Bearer <OPS_SYNC_SECRET>
Content-Type: application/json

{
  "organizationId": "<Core organization uuid>",
  "full": true,
  "projects": [
    {
      "opsProjectId": "elevate-orthodontics",
      "name": "Elevate Orthodontics",
      "company": "Elevate Orthodontics",
      "status": "in_progress",
      "health": "healthy",            // healthy | attention | incident | unknown
      "owner": "Sarah",
      "environment": "production",
      "canonicalProjectId": "<Core project uuid, when Ops knows one>",
      "opsPath": "/projects/elevate-orthodontics",
      "openIssues": 0,                 // omit or null when Ops cannot say
      "openApprovals": null,
      "lastActivityAt": "2026-02-01T09:12:00.000Z",
      "archived": false
    }
  ]
}
```

Rules Ops must honour:

- `organizationId` is the **Core** organization uuid, not the Ops one. Ops
  already receives it in the SSO handoff (`trust-tai-os:sso`); store it against
  the Ops workspace at first sign-in and reuse it here.
- `opsPath` is a same-site path only. A full URL, `//host`, or a scheme is
  rejected and the row falls back to Ops home.
- Omit a count Ops cannot compute. Do **not** send `0` to mean "unknown"; Core
  renders unknown as an em dash and would otherwise state a false zero.
- `full: true` retires anything not in the batch (marks it archived), so send
  complete lists. Use `full: false` for incremental single-project pushes.

Response: `{ "ok": true, "synced": n, "retired": n, "syncedAt": "..." }`.
`401` means the secret is wrong, `503` means Core has no secret configured.

## 3. Acceptance test

1. Ops posts one batch containing a real project (e.g. "Elevate
   Orthodontics") with `opsPath` set.
2. A signed-in Core member opens `https://cmd.trusttai.com/modules/ops` and
   sees that project, marked "synced from Ops", with `— open issues` where Ops
   reported nothing.
3. Clicking it opens `https://ops.trusttai.com/projects/...` in a new tab, with
   the session handed over in memory. No token appears in any URL.
4. A member of a different organization sees none of those rows.
5. Stopping the sync for over an hour turns the room banner into "Ops sync
   interrupted", showing the last successful sync time.

## 4. Freshness semantics in Core

| State | Meaning |
| --- | --- |
| `Ops · live` | A direct Ops read succeeded. Core has no such read yet; reserved. |
| `Ops · synchronized` | Last push within 15 minutes. Healthy, no warning. |
| `Ops · sync delayed` | 15 to 60 minutes. Soft notice only. |
| `Ops · sync interrupted` | Over 60 minutes, or the read failed. Prominent warning with the last successful timestamp and a retry. |
