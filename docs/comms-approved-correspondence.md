# Approved Roadmaps activity in Conversations — local candidate

Base: a9d22674c5d169a14e95152dab3d6107988a763b. Not deployed.

Conversations ranks risk first, then oldest activity. Bruce's already stored overdue obligation therefore stays ahead of healthy/quiet relationships. No additional Bruce mail is read or imported. Sherri's three already approved Roadmaps events were absent from the Comms touch/message sources; this read-time composition restores their activity dates and metadata timeline.

## Scope and decisions

- Existing Roadmaps authorization, caller JWT and RLS are required. The server rechecks authorization and canonical roadmap/relationship mapping before returning metadata. No service-role read or access grant.
- Only validated, reviewed correspondence metadata is returned: source identity, direction, timestamp/precision and canonical identifiers. Bodies, subjects, attachments and source URLs are excluded. Links open the existing Roadmaps view.
- Incoming and outgoing timestamps are independent. Drafts, bounces and team copies do not count as actual correspondence. Approximate timestamps remain qualified.
- Same-account provider message identities deduplicate only when relationship, organization, direction and exact time agree. Account aliases and ambiguous identities are not inferred.
- Roadmaps events lack verified thread identity. An incoming event raises review attention; a later outbound event cannot settle it. No new response due date is invented, and recorded overdue/manual obligations remain intact.
- This is read-time reconciliation only: no database migration, backfill, ingestion, Gmail read, permission change or production write.
- Reads fail closed when metadata exceeds 500 events, canonical mappings exceed 2,000, scope changes, or validation fails. The UI explicitly reports unknown coverage on unavailable access. LinkedIn/full mailbox coverage remains unverified.

## Validation

- Comms and Roadmaps suite: 125 files, 1,361 tests passed.
- Final focused reconciliation suite: 3 files, 28 tests passed.
- TypeScript and production build passed; targeted ESLint had zero errors and three existing hook dependency warnings in the relationships route.
- Fictional local desktop and 375×812 browser previews: all three records, correct separate dates, no invented response due date, explicit thread-linkage warning, working canonical link targets, no horizontal overflow at 375px. These are component previews, not authenticated production integration verification.
- Separate sync-reliability worktree remains untouched and clean.

## Release gate

Review/approve this scope before deployment. Then integrate onto the verified current production head without concurrent releases, rerun checks and publish through the existing release process. Verify the authenticated metadata endpoint, Sherri's three events and independent dates, Bruce's retained overdue state, denied-Roadmaps coverage warning, and desktop/mobile rendering. No production data reconciliation or new mailbox access is needed or authorized by this candidate.
