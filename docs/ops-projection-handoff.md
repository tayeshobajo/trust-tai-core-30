# Ops → Trust Tai OS project projection (one live contract)

Ops (Lovable project `79444c46-d25c-47a8-a708-ff496c9d2ad2`, production
`https://ops.trusttai.com`) owns Ops truth. Trust Tai OS keeps a read-only
projection so the Ops room can list real systems and open the exact one.

There is exactly **one** projection path, and it is already live:

> Ops writes directly into `public.ops_project_projection` in Supabase project
> `okydosoacqdnursmmenf`, over PostgREST, with the signed-in Core user's access
> token received through the SSO handoff, under Core RLS.

Core never edits what arrives, and Core exposes **no** ingest endpoint or sync
secret. A second mechanism would create a competing schema, so it does not
exist.

## Live table

`public.ops_project_projection`

| Column | Notes |
| --- | --- |
| `organization_id` | Core organization uuid, from the SSO payload |
| `app_key` | `ops` |
| `ops_project_id` | Ops' own project id |
| `canonical_project_id` | Core project uuid when Ops knows one |
| `client_label` | Company/client label |
| `project_name` | Display name |
| `primary_domain` | Environment/domain label |
| `status` | Ops' own status word |
| `lifecycle_state` | `active`, `archived`, `removed` |
| `health` | Ops' health word; unreadable words read as unknown |
| `needs_attention` | boolean, Ops' own judgement |
| `owner` | owner label |
| `open_issues`, `open_approvals`, `open_recommendations`, `open_risks` | nullable counts; null means unreported |
| `last_activity_at` | newest Ops activity |
| `ops_path`, `ops_url` | deep link into the exact project |
| `source_updated_at`, `synced_at`, `created_at` | freshness stamps |

Unique key: `(organization_id, ops_project_id)`. Authenticated org members may
`SELECT`/`INSERT`/`UPDATE` through `private.is_org_member`.

Ops upserts deterministically on the unique key after a successful SSO
handoff, and marks retired projects `lifecycle_state = 'removed'` rather than
deleting them.

## Core side

| Piece | Where |
| --- | --- |
| Read | `src/data/ops/projects.ts` (member-only, RLS, excludes `lifecycle_state = 'removed'`) |
| Row shape | `src/domain/ops-projection.ts` |
| Portfolio | `opsProjectionPortfolio` in `src/data/ops/projection.ts` |
| Room | `src/routes/modules.ops.tsx` |
| Launch | `src/lib/ops-launch.ts` (`/sso` handshake, `targetPath = ops_path`) |

Rules Core holds itself to:

- Projection rows are the only membership of the portfolio. Activity rows
  enrich "Recently moved" and never invent a managed project.
- Unreported counts stay null and render as "—", never as `0`.
- Health counts as healthy only when Ops said something that plainly means
  healthy or stable. Unknown never inflates the healthy count.
- Every way into Ops is `launchOps`, which opens `https://ops.trusttai.com/sso`
  in a new tab and posts the session only after Ops answers from its own
  origin. No token in a URL, hash, storage, or window name.

## Acceptance

1. A signed-in Core user opens Ops from `cmd.trusttai.com` and is not asked to
   sign in again.
2. Ops upserts its projects; the rows appear in the Core Ops portfolio.
3. Clicking a project opens that exact Ops project through the same handshake,
   using `ops_path` as `targetPath`.
