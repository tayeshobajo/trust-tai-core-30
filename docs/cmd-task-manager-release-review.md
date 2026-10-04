# CMD task board: exact staged release review

This is a local implementation for review. No production policy, schema, record, push or publication has occurred. The access model and proposed write permissions still require approval. This document supersedes the initial context-only review.

## Implemented locally

- `/modules/steward/board` uses the existing `steward_tasks` table. The business and private tabs are views of canonical records, not duplicate databases. Home links to the board; its New task action opens the private tab. Existing Steward and project/commitment collaboration remains available separately.
- Create, edit, search, status filters, verified owner selection, next action, blocker, one dependency, one level of parent/child work, source links, planned acceptance criteria, and optional real due dates.
- Delivered work requires a checked-result statement and a human confirmation in the editor. The database draft atomically records the actor, timestamp and evidence, refuses open dependencies/children, and retains the last receipt on reopen. Generated text or a source link alone is not proof of completion.
- Archive and restore replace deletion for classified tasks. Existing historical deletion policies remain unchanged for legacy records.
- Stable creation keys support safe retries; revision predicates prevent stale UI saves from overwriting newer work. Errors preserve the edit form. Loading, failed reads, empty views and capped results are explicit.
- Personal status summaries return only owner IDs, statuses and counts. New classified records are excluded from legacy Steward action paths so private titles do not enter org-visible legacy activity. The board deliberately does not run AI tasks or emit legacy activity records.
- Weekly-goal confirmation now verifies the signed-in user and filters by owner and proposed status. The proposed database trigger independently protects confirmation, including against service-role impersonation. Cache keys for viewer-specific Steward reads include the viewer.

## Exact database draft — not applied

`docs/cmd-task-manager-access.DRAFT.sql` changes only `steward_tasks` and introduces:

1. Ten columns: `task_visibility`, `next_action`, `blocked_because`, `depends_on_task_id`, `parent_task_id`, `archived_at`, `completion_evidence`, `completed_at`, `completed_by`, `revision`.
2. A visibility/archive index and a partial unique organization/correlation index for classified tasks.
3. A write-role helper, a trigger protecting classification/identity/assignment/receipts/dependencies, and an authenticated aggregate-only function `cmd_personal_task_counts`.
4. Replacement SELECT/INSERT/UPDATE/DELETE member policies for that table. Historical `legacy_shared` rows retain existing behavior. New personal rows are readable only by their owner. Active members can read new business rows. Classified deletion is prohibited, including through the trigger.

`task_visibility` is separate from source metadata. The database stamps creator, personal owner, verified owner label, receipt actor/time, revision and archive time. It refuses any later visibility change, even from a legacy row; historical classification therefore needs its own explicitly reviewed migration. Changing `source_app` cannot change access. Classified writes require an authenticated human identity; the existing service-role policy does not bypass the new trigger's write checks.

One dependency and one parent are allowed, within the same organization and visibility. Personal links must point to the same owner's records. Parents cannot themselves have a parent. Self-links and cycles across both parent/child completion prerequisites and dependencies are refused. Detaching or reparenting a child requires authority on the old parent as well as the new parent. Legacy rows cannot use the new relationship columns. Workspace-level transaction locking serializes dependency checks; concurrency behavior still needs the real PostgreSQL test run.

`docs/cmd-own-goal-guard.DRAFT.sql` adds one trigger function and trigger on `steward_weekly_goals`. It makes owner/org immutable, permits insertion only as a proposal, requires the owner for status/confirmation changes, stamps confirmation/completion times, and prevents completion before confirmation. Backend credentials may propose but cannot confirm a human's goal. Confirmed goal title, linked work, target, week and notes cannot be rewritten while retaining confirmation. The owner must reopen as a proposal, which clears confirmation/completion timestamps, then reconfirm. Primary task/goal IDs are immutable. Existing goal read/delete policies are not changed by this focused draft.

No project, commitment, payment, PORTAL, existing source schema, organization membership, or permission-table changes are included. These draft SQL files are outside the automatic migrations directory.

## Additional write-policy decisions requiring approval

Proposed creators/editors reuse the existing agent-execution role vocabulary: owner, admin, leadership, project_lead, client_support, team_member and member. Viewers have business read access only. A business creator or assignee can update the work; owner/admin roles can also update and manage assignments. A non-admin may initially assign to themselves or leave work unassigned, but cannot assign another teammate or reassign later. No admin override grants access to private task details. These are proposals, not permissions authorized by the pending read-visibility question.

The proposed read rule is active organization membership, not an additional per-app membership grant. Verify this matches the final approval before application.

## Historical exposure and bounded classification

Read-only aggregate inspection found two existing manual records: one human record with matching owner/creator, no source classification and no project; one Scout/prospect agent record with a creator, no owner and no project. No titles were copied into reports. The draft leaves both `legacy_shared`. Consequently it must not be described as making all historical personal work private.

Review exactly the unclassified human row in its owner's authenticated session. Ownership alone does not establish private intent. Record an explicit personal/business/leave-legacy decision and obtain approval for an ID-specific migration. Preserve the Scout source contract. Historical activity and task-state text would need review before any retrospective privacy claim. Canonical project/commitment collaboration is untouched.

## Prepared actual-work records

`docs/cmd-business-tasks.fixture.json` contains 22 review-only records: the nine sanitized business tasks plus thirteen audit children with stable AUDIT-01–AUDIT-13 references and `parentCorrelationId`. Resolve the parent to its real ID only during an approved idempotent import. All owners and due dates are unset, receipts empty, and no row is claimed delivered. Only public route references are included. The three-pilot, LinkedIn and case-study packs are awaiting owner review. The audit children separate active technical staging from commercial/legal/scope decisions. Source recheck time and prior completed article/permalink work are recorded as parent-supplied evidence, not a fresh verification by this task.

## Validation and remaining release gates

Application tests use mocked transport or pure functions and are labelled accordingly. They cover authority decisions, invalid states/URLs/identity injection, stable retries, rereads, stale writes, archive/restore, denied goal confirmation, loading/error/empty states, blocked/dependency display, focus/Escape behavior and automated accessibility. They do not prove PostgreSQL RLS or authenticated live behavior.

`docs/cmd-task-manager-tests/run-db-tests.sh` creates a disposable, synthetic, Unix-socket-only PostgreSQL cluster and removes it afterward. It accepts a local binary directory, never a production database URL. `policies.sql` includes real role-switched assertions for visibility, ownership, classification spoofing, archive/restore, completion receipts, dependencies, dedupe, inactive/cross-org/anonymous denial and own-goal confirmation. The runtime is missing at `/opt/homebrew/opt/postgresql@17/bin/initdb`; these schema-backed tests have not run. No installation was attempted.

Local verification: focused Vitest suite (96 tests), TypeScript no-emit check, scoped ESLint and production Vite build pass. Chrome checks used an isolated synthetic transport only: desktop and actual 469px/320px CSS layouts had no horizontal document overflow; creation survived fixture reload; the editor focused its title, Escape closed it, and focus returned to New task after a browser-found defect was repaired. This does not prove production persistence, RLS or mobile authentication. The temporary fixture/server/tab were removed or closed.

Before release: obtain exact access/write approval; run and review PostgreSQL tests including concurrency; apply only approved migrations; use a verified authenticated identity for approved record import; verify keyboard and responsive behavior in a real browser; recheck current remote commit and CI; coordinate the sole publisher; publish via Lovable; verify the actual authenticated live desktop/mobile app and refresh persistence. A successful local build, commit or publish badge is not that proof.

## Independent static security review

An independent reviewer inspected the cumulative application diff and both SQL drafts. Four concrete defects were found and repaired in the local drafts: confirmed goal content substitution; legacy relationship injection; removal of child work without old-parent authority; and combined hierarchy/dependency cycles. The reviewer rechecked all four repairs and found no further concrete defect. Isolated SQL regressions were added for these paths, including identity mutation. They are prepared, not executed: the PostgreSQL runtime remains unavailable. No installation or production database operation was attempted.

No additional static issue was found in classified personal visibility, role/assignment checks, count-only output, org isolation or receipt stamping. This is not a security certification or runtime RLS/concurrency result. A completed dependent's receipt remains a historical checked result if its dependency is later reopened; requiring automatic dependent reopening would be an additional product decision.

Precise decisions for approval: (1) business detail readable by all active organization members versus a narrower app grant; (2) personal details owner-only with owner/status/count aggregates to active members; (3) the seven listed writer roles, business creator/assignee/admin editing and admin-only reassignment, with no private-detail admin override; (4) apply these exact task and goal drafts, preserving legacy and existing goal read/delete policies; (5) approve the 22 sanitized rows for idempotent import without invented owners/dates. Viewer read-only applies to classified board work; inherited legacy write/delete permissions remain unchanged. Historical personal classification needs a separate owner decision and ID-specific reviewed migration.
