# Team RFP visibility — prepared, not live

## Root cause and current evidence

The November 9 explicit grants shared a fixed set of 34 business opportunities. No audience migration was deployed. Normal intake still inserts a creator-private row, so five November 11 captures have no team shares. This is not a date-filter bug.

Live build marker November 12: revision 419bc050cd45992e7470200b7f0db476777e6bdc, dirty false, fingerprint 1754a4e7595b68baacbb09797987cb34aa6faf53dd8f7fd3b5c7f0e46b2c1cc3. Candidate is isolated on this live base in feat/rfp-team-visibility-20261112 / rfp-visibility-fix. Connected branch head dc30b435 contains two additional Studio commits (0b149b92 and dc30b435, 76 files); DO NOT deploy that head as an RFP-only release or overwrite it.

Verified all six non-QA recipients active, each with 34 view grants and actual authenticated RLS visibility of 34 opportunities, work predicate false for all shared rows. Tai has 40 total rows, including one private QA. At database time 2026-11-12T16:32:35Z, applying the exact same current source date filter: Tai 26 visible / 14 hidden, Ayobami 20 visible / 14 hidden. Both have 3 submitted records. After the five-record repair, six recipients should have 39 business rows total / 25 visible at that time. Tai's additional QA remains intentionally private. Counts can legitimately change as deadlines pass or workflow changes; compare same filters and timestamp.

## Reviewed five records

- d6fa7158-ab5a-4c78-9d63-69b7ac7d2c8f — City of Blanco marketing/visitor website
- bae7cafc-ee8e-4f53-9300-0cf6164c6bbf — R4R grant
- 6da6c89d-28ba-4174-9354-1c6790f64787 — AI Impact grant
- df76f52f-94d2-4cd6-8f8f-3d876b59f49e — MEDA website
- c60dbd87-9c83-4a27-8ceb-eaee5bc074c1 — Small Business Boost grant

Complete row fields reviewed: public source references and internal qualification/next-action notes; no detected credentials or sensitive personal information. Zero draft/source-file/submission/amendment/approval/reference rows and zero Storage objects for these five. No external document/email contents opened. Their procurement terms and actual eligibility remain as recorded; sharing does not verify them.

## Exact proposed change

Migration 20261112163128_rfp_required_team_visibility.sql adds audience: private / team_business / qa. Existing rows start private, retaining their current explicit shares. Backfills ONLY the five reviewed records to team_business after asserting count 5, CMD organization, Tai creator, captured stage and revision 2. Existing guard increments their revision/time; other fields are unchanged. No rfp_access rows are inserted, removed or modified.

An invoker read helper requires CMD organization, active membership through existing rfp_has_access, existing workspace access, and the fixed seven UUIDs: Tai plus tayeshobajo@gmail.com, tai@trusttai.com, am.ayobamii@gmail.com, sourcing@trust-tai.com, diamond@trusttai.com, donigweemmanuel@gmail.com. QA and future/unapproved accounts are absent. No SECURITY DEFINER or broad role grant is added. Existing explicit grants, including QA's existing HAC access, stay unchanged.

New intake defaults to a clearly disclosed Team business choice, with explicit Private and Private QA alternatives. URL/pasted-text, PDF/DOCX/TXT review all use the same intake/service. The service rejects missing visibility. The database has NO audience default after initializing existing rows and rejects omitted visibility, so stale clients, direct API callers and imports cannot silently create private business rows. Importers must explicitly classify; QA/private must not be mislabeled team_business. Audience is immutable through ordinary updates. Team-business creation is limited to the approved active cohort; other users retain existing ability to create explicitly private rows under existing creation permissions.

Read visibility includes all internal fields, submission history/evidence and reading/downloading current/future attachments. Existing child/storage read rules inherit opportunity visibility. No edit/upload/approval/submission/delete/share-administration power changes. External Drive/Gmail permissions unchanged. Sensitive personal documents require Private classification; automatic content sensitivity detection is not implemented.

Old clients will get an actionable visibility error on create after migration until refreshed to the new app. Reads and existing-record updates continue. Apply migration and app release in a coordinated window. Rollback must preserve rows and any new audience choices; restore old app alone cannot create under the new required-audience schema. Do not silently reintroduce a private default or widen grants as rollback. Review policy rollback separately if team visibility needs revocation.

## Validation and remaining gates

96 RFP tests passed; TypeScript, production build, targeted lint and git diff --check passed. Rollback-only local PostgreSQL tests passed: frozen five-record backfill; all seven approved IDs; existing explicit view preservation; team row/file read; no edit/upload/submission; private/QA/inactive/future-account/cross-org denials; QA cannot team-capture; missing audience rejected; audience mutation denied. Synthetic fixtures only, server stopped. Production was read-only; no grants/migration/deployment/account deletion attempted. No retry of denied operations.

Exact-account/policy action-time approval is still required. Proposed wording:
"May I share these five reviewed RFP/grant records and enable team-business visibility for future captures for the same six accounts plus your tai@trust-tai.com account? This includes internal notes, submission evidence and current/future attachment downloads. Private/QA records and unapproved accounts remain excluded; editing, uploading, approvals and submission powers do not change. The update adds a visibility field/read policy and publishes the intake choice; stale clients must refresh before creating records."

Release-source coordination also required: live base differs from the connected branch's unpublished Studio work. Publish this isolated candidate via an approved exact-artifact route or coordinate with the release owner; do not force-push/revert the Studio commits or deploy them incidentally.

Only after approval/release: verify migration/policy definitions, each of the six actual RLS counts and five IDs, QA exclusion/unchanged grants, identical-filter business totals, normal future capture on an approved recoverable test record and positive/negative Storage read behavior. No live creation test is claimed now. Do not call this fixed until live checks pass.

## Approved action checkpoint — November 12

Tai approved Apply. Rechecked all five rows at revision 2/captured/Tai-owned and zero shares. Because the supported Lovable deploy tool cannot select a ref and the connected latest includes unpublished Studio changes, the creation-blocking required-audience migration was held until an isolated app release is available.

Completed the independent, narrower current-record repair: one checked transaction inserted exactly 30 opportunity-level view grants (five IDs above x fixed six recipients). No prior grants overwritten. Separate verification: each six account reads 39 rows, all five added rows, zero manageable rows, zero private QA rows. Each QA account still reads only HAC, zero new rows, zero work power. Anonymous table SELECT remains denied. Exactly 30 new view rows and zero other roles. All five opportunity revisions remain 2. Audience column still absent. No migration/deployment attempted; no uncertain write or retry.

Future fix remains approved but blocked on exact-artifact publication. Need a release-owner-supported route for the isolated RFP build based on live 419bc050, or coordination of the connected release source without publishing/reverting unrelated Studio work. No further access approval is being requested for the already approved scope. Do not rerun the 30-grant insert; it completed.

Backend effective RLS was verified with authenticated role/identity in read-only rollback transactions. No teammate credentials were obtained and no teammate browser login was impersonated. Normal UI may require refresh to load new data. Browser verification as the teammate and actual future creation verification remain unperformed.
