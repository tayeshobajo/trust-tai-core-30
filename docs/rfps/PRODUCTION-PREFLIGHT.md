# RFP production preflight — 2026-11-04 20:17 UTC

Status: read-only production inspection completed. No production write, staging resource, credential, test user, charge or deployment was made. Tai's approval in principle is recorded by the parent conversation; the operations below remain unapplied.

## Release source and isolation

- Live `https://cmd.trusttai.com/steward-build.json`: revision `e0dbd8d370a4c8447d77d03910455f69bfaa2991`, dirty=false, fingerprint `0275a7061b06ae828ea16a8743716c2a15560eaa7e42a87dbab8f21c2eadbd5e`.
- Remote `codex/cmd-roadmaps-preview-source` still points at that same commit. It includes the integrated Comms/Roadmaps release.
- RFP implementation commit: `36d3362a`, isolated branch `feat/cmd-rfps-grants`.
- Separate task-4 Comms worktree still has uncommitted edits on an older `968beb6d` base. Do not copy, clean, reset, merge or publish that tree. No RFP change edits Comms/Roadmaps source.
- Recheck the live revision immediately before publishing. If it changed, integrate against the new live head and re-run relevant tests instead of overwriting it.

## Database prerequisites verified read-only

Target: `trust-tai-os`, `okydosoacqdnursmmenf`, existing Pro organization. One application organization: Trust Tai `ee683a64-e045-4226-a8ff-4ae6590d6789`.

- No `public.rfp_*` tables/functions and no `rfp-drafts` bucket exist yet.
- `organizations`, `organization_memberships`, `profiles`, `auth.users`, `storage.buckets`, `storage.objects` exist with RLS enabled.
- `authenticated` has private-schema USAGE and EXECUTE on `private.is_org_member(uuid)`.
- Existing membership helper is a stable SECURITY DEFINER function with search_path=public. It checks organization, auth.uid(), and **status='active'**. The RFP migration does not redefine it.
- Memberships reference `profiles(id)`, which references `auth.users(id)`; valid synthetic users were needed for a full standalone clone, but no users are created for this production update.
- Current storage objects policies comprise six bucket-specific policies for `comms-drafts` and `project-files`; they do not grant access to the new bucket. New restrictive RFP guards also defend against future broad permissive policies.

## Exact proposed migration operation

Migration SHA-256: `ccfbf6c287b836ed362edcdd1f3d0e946101a30517732bf0f4bd78d66c56234c`.

Apply only `supabase/migrations/20261104194348_cmd_rfps_grants.sql` to the verified production project through the migration mechanism. Do not blanket-push every local migration: remote history has 32 entries and is not a full baseline of the existing live schema.

The SQL transaction creates six new tables:
`rfp_access`, `rfp_opportunities`, `rfp_draft_versions`, `rfp_draft_approvals`, `rfp_submissions`, `rfp_discovery_checks`.

It creates five SECURITY INVOKER functions (`rfp_has_access`, `rfp_can_work`, `rfp_canonical_source`, `rfp_guard_opportunity`, `rfp_stamp_history`), integrity/history triggers, unique/foreign-key/check constraints, and per-table RLS. It grants authenticated roles only the table actions allowed by the RLS design; anonymous access is revoked. It adds a private `rfp-drafts` bucket with a 20 MB object limit and document MIME allowlist. Six new storage policies allow scoped SELECT/INSERT and restrict SELECT/INSERT/UPDATE/DELETE for this bucket. Other buckets' predicate behavior is unchanged.

No existing business table/function, production record, user, membership, role setting, secret, external submission, automation or discovery feed is changed. No RFP records or ACL grants are seeded. No data backfill or removal.

## Exact access decision still needed

Current active Trust Tai membership: 9 people (2 owners, 6 admins, 1 member). No `rfps` organization switch, role override or individual override exists. The nine active memberships include two explicitly QA-named identities and four unnamed profiles, so granting all active members would be unsafe to infer as the intended team.

The existing CMD shell treats a missing app switch as enabled and derives room visibility from role ceilings. Consequently publishing the registry entry will display the room to those active members, **but they cannot read/create RFP database records without separate `rfp_access` grants**. They will see the access-not-provisioned message. This corrects the earlier handoff's overly broad implication that a new app switch is mandatory.

Making the workspace usable requires an explicit, reviewed list of existing user UUIDs and `view` or `work` levels, then one `rfp_access` row per approved user with organization_id=scope_id=`ee683a64-e045-4226-a8ff-4ae6590d6789`. No global role grants or new accounts are necessary. If any selected person receives only view access, also explicitly set that person's rfps app override to view so UI controls match the stricter database grant; that additional settings row must be included in the approved scope. This is a persistent database-access change and must be approved for the exact scope before execution.

Creator-owned opportunities are readable/editable only by that creator (while active and authorized). Sharing an opportunity needs a further ACL row with scope_id=that opportunity UUID. Workspace access alone does not expose everyone else's proposals. The current UI has no sharing editor; do not silently provision organization-wide proposal access or automatically grant future members access. Confirm whether initial launch is Tai-only or the explicitly named current team; do not guess. The existing owner profile labeled Tai is UUID `e1b3c843-3a91-4c27-a291-9e6ced782b9f`; an initial single `work` grant to that exact existing identity is the narrowest proposed launch scope, subject to identity/scope confirmation. Another admin is labeled Captain Tai; do not conflate those accounts.

## Backups and rollback

Read-only `supabase backups list` confirms a COMPLETED physical backup at `2026-11-04T10:05:51.817Z`, plus seven earlier completed backups. PITR is **disabled**. No new backup or restore was requested.

- DDL failure: the migration's SQL transaction rolls back; verify state before retrying an uncertain tool outcome.
- Code regression: redeploy the previously verified `e0dbd8d` artifact / forward revert the RFP code. Do not rewrite published history. Leave additive RFP data intact.
- Permission issue: revoke only the newly approved RFP ACL rows, with explicit authorization, while preserving documents and evidence.
- Do not drop tables/bucket after real uploads. A physical restore can lose unrelated changes since the backup and is not the normal rollback for this additive release. Database backups do not prove recoverability of future Storage file bytes; preserve files separately before any later destructive action.

## Security advisor baseline

Production advisors report pre-existing INFO items for six RLS tables with no direct policies, WARN items for three mutable function search paths, public `pg_net`, two anonymous-executable SECURITY DEFINER trigger functions, eight authenticated-executable SECURITY DEFINER functions, and disabled leaked-password protection. These are not introduced by RFPs; no unrelated remediation is included. Compare advisor results after the approved migration, without loosening access to suppress warnings.

References: [search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Costs, validation and publication

Uses the existing project, plan and deployment target. No new project/branch/seat/PITR add-on and no quoted fixed infrastructure fee. Draft storage and downloads consume existing storage/egress allowances and can create usage charges if those allowances are exceeded; do not change spend caps or subscriptions. Current usage headroom was not verified.

Local verification available: production build, full application TypeScript, 30 original UI/domain/access tests, local PostgreSQL migration/policy tests including legacy permissive-storage guards, and 20 browser viewport/state checks. Additional isolated-harness guard tests bring focused tests to 43. No hosted Storage round trip has been performed; this limitation remains under Tai's instruction not to create a test database.

Proposed sequence after exact access/security actions are confirmed: verify unchanged live revision and migration checksum; apply only the RFP migration; read back schema/RLS/bucket/advisors; provision only the approved ACL rows; publish the reviewed RFP code using the established CMD path; verify build metadata, existing Comms/Roadmaps navigation and authenticated RFP empty state. Do not manufacture a real proposal or upload a user file merely to validate deployment.

## Screenshot delivery blocker

Desktop/mobile screenshots contain only labeled synthetic QA data. Native Library upload remains blocked: the required helper returned `Library prepare_uploads is not available`; no Library IDs were returned. Local PNGs remain under `qa/rfps/`.
