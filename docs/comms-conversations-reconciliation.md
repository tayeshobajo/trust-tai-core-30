# Conversations first: prepared locally, not released

Base: e0dbd8d370a4c8447d77d03910455f69bfaa2991.

## Changes

- Root Comms, old Dashboard and old Conversations URLs redirect to the relationship room, preserving relationship/thread/message search. Both tab variants and New Message menu omit Dashboard.
- The existing recent-email component moved into an expandable Stored email & coverage panel. Mailbox freshness/error states, label scope, exact window counts, paging and existing sync controls are retained. No sync control was exercised. A permanent coverage warning explains bounded Gmail and unverified LinkedIn coverage.
- A member/RLS, organization-scoped metadata read of stored comms_messages augments inbox and selected-room health. It pages 500 rows at a time, fails visibly if capped at 10,000, if a page fails, or if detected coverage changes. No body or provider read is introduced. This is not a transactional database snapshot; changes with unchanged counts can still require refresh.
- Attention groups by mailbox and provider thread (safe per-message fallback), retains inbound on equal-time ambiguity and never lowers existing manual health/obligations. A newer outbound in a different thread or mailbox cannot settle inbound attention. Latest displayed activity is the maximum of manual health and valid stored messages. Archived relationships remain excluded from the existing Needs you view; they remain in All and their records are not altered.
- Gmail relationship summary writes now use organization-scoped atomic timestamp filters: last_touch_at only advances; response_due_at can only be filled when null. Errors propagate. No existing due date is changed or cleared, including when the sync batch ends outbound. This may deliberately retain stale positive obligations until reviewed; it does not infer resolution.

## Diagnosis and remaining boundaries

The old per-thread relationship update unconditionally assigned each thread's last_message_at and response_due_at. Processing an older thread after a newer thread could move the person's last activity backward and erase another thread's due date. The inbox independently read comms_touches, while Gmail sync writes comms_messages. Both paths contributed to misleading summaries.

The parent investigation reported seven lagging relationship dates; that count was not re-read or independently verified against production here. Existing comms_threads summary updates still reflect a bounded provider batch, not an authoritative reconciliation. New attention derives from stored messages instead of trusting those summaries. Existing manual-touch health/cadence heuristics, closed/read flags, and provider-ingestion scope are unchanged. No claim that all messages have been ingested or that every inbound necessarily needs a reply is made.

Gmail label: Trust Tai/Comms. Existing pass limits: 60 labelled messages, 25 approved-thread refreshes, 300-message lookback; scheduled every six hours with overlapping two-day backfill. LinkedIn automatic coverage remains unverified. No provider scope, schedule, tokens, permissions or persistent access changed.

## Safe reconciliation plan (requires separate production-write authorization)

1. Take an organization-scoped, consistent read snapshot of affected relationships, all their stored message metadata grouped by mailbox/thread, manual touches, manual due dates and existing thread state. Verify read counts, source ownership, pagination and concurrent revisions. Do not infer absent messages were ingested.
2. Produce a review-only diff of each last_touch_at versus the maximum valid stored message and manual touch date. Preserve a newer existing last_touch_at. Identify every inbound-last thread separately, including equal-time ambiguities. Keep manual response/follow-up dates, next actions, explicit closures and unresolved commitments separate.
3. Have a person review the seven reported rows plus any additional discrepancies. Automatic timestamp reconciliation may only advance last_touch_at. Do not automatically null response_due_at or close threads: the legacy field lacks sufficient provenance to distinguish manually entered and sync-derived obligations.
4. If writes are separately authorized, apply an organization/id/revision-guarded transaction to only the approved timestamp deltas, preserving before-values and review evidence. Abort/recompute on concurrent changes. Re-read and compare afterward; rollback must also compare revisions rather than overwrite new work.
5. Treat removal of stale due dates as a separate, evidence-backed manual decision. Reconcile per-thread state only with complete stored-thread evidence and preserved explicit human closures; incomplete provider coverage is still a gap.

No SQL migration, production data mutation, provider sync, send, deployment, PR publication or account-permission change was performed.

## Local validation

- Vitest: 64 files, 760 tests passed across Comms domain/data/server, route redirects and visual contracts. The review-lessons suite requires a synthetic `TRUST_TAI_SUPABASE_SERVICE_KEY=synthetic-test-key`; its Supabase client is mocked. No real secret was loaded. Without this fixture environment, that suite had 10 configuration failures; the fixture rerun passed.
- The final stricter due-date preservation change was rechecked separately: 3 summary-write tests passed.
- `tsc --noEmit`: passed. `npm run build`: passed. `git diff --check`: passed.
- Logs: verification/comms-conversations/. Test runner used a local minimal Vitest config with only the @ source alias, avoiding production Vite plugins during tests.
- Original screenshot attachment references were located, but no authenticated desktop/mobile visual verification was completed. The existing layout styles were retained; the new warning and expandable coverage panel need visual acceptance before release.
- Local Codex memories directory was empty. Repository AGENTS.md, architecture canon, ARCH.md and QA.md were reviewed; the existing Outreach Today architecture/QA guidance was preserved and Comms notes appended. QA skill used: /Users/tayeshobajo/.codex/skills/qa-system/SKILL.md.
