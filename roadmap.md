# Trust Tai OS, execution ledger

The canonical plan is `docs/production-plan.md`. The canon in
`docs/architecture-canon.md` outranks both. This file is the live status only.

Status vocabulary: Not started, Implemented, Code/Test Verified, Runtime Verified,
Production Verified, Human Accepted. Lovable saying done is at most Implemented.

## Progress

**Production Readiness: 3%** (P0 to P7)
**Full Engine: 6%** (P0 to P9)

Working:

- P0 weight 12 (readiness) / 10 (engine), 9 gates, 2 met -> 12 x 2/9 = 2.7 and
  10 x 2/9 = 2.2
- P8 weight 8 (engine only), 5 gates, 2 met -> 8 x 2/5 = 3.2
- P1 to P7 and P9: no gate met at its required level yet -> 0
- Readiness 2.7, rounded to 3. Engine 2.2 + 3.2 = 5.4, rounded to 6.

No phase is complete, so no phase has received its completion weight.

## P0, prove the existing build

| ID | Gate | Required level | Status | Evidence |
| --- | --- | --- | --- | --- |
| P0-01 | People and activity schema live | Production Verified | **Production Verified** | `member_activity` answers 200 in the production project with the service key |
| P0-02 | Approvals schema live | Production Verified | **Production Verified** | `approval_requests` answers 200 in the production project |
| P0-03 | Invite email end to end | Human Accepted | Pending, human gate | `RESEND_API_KEY` is configured; no delivered invite has been observed here |
| P0-04 | Gmail send re-consent plus one real governed reply | Human Accepted | Pending, human gate | Requires a real re-consent and a real send; not performed |
| P0-05 | Add-to-Comms production proof | Production Verified | Pending, needs verification | Code exists (`src/routes/modules.comms.to-scout.tsx`, intake services); no production run observed |
| P0-06 | Public `content-images` bucket | Production Verified | Not started | `TRUST_TAI_IMAGE_BUCKET_PUBLIC` is not set; only `project-files` and `comms-drafts` buckets exist |
| P0-07 | Publish endpoint configured | Production Verified | Not started | `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN` are both unset |
| P0-08 | One controlled article published and independently verified | Human Accepted | Pending, human gate, blocked by P0-06 and P0-07 | Nothing published |
| P0-09 | Paperclip bridge verified | Production Verified | Pending | `PAPERCLIP_API_URL` unset, so the app is on the loopback default and stays SYNCHRONIZED (`docs/paperclip-hosting.md`) |

Agents remain paused for the whole of P0.

## P1, commercial truth

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P1-01 | Client commercial state: tier, mrr in cents, engagement dates, provenance | Production Verified | Not started |
| P1-02 | Proposals with sent and signed events on the existing prospect and roadmap lineage | Production Verified | Not started |
| P1-03 | `client.tier_changed` with a human-entered Build phase amount | Production Verified | Not started |
| P1-04 | Org-level weekly targets | Production Verified | Not started |
| P1-05 | Revenue derived at read time by the locked rules, never persisted weekly | Code/Test Verified | Not started |
| P1-06 | `meeting_kind` on a logged meeting, human set only | Production Verified | Not started |

## P2, Clients and Home

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P2-01 | Clients book grid with the fixed hierarchy, proposed companies separate | Human Accepted | Not started |
| P2-02 | Manual Add Client | Human Accepted | Not started |
| P2-03 | Client page shell: Overview, Roadmap, Projects, Relationship, Site, Files, owning no state | Human Accepted | Not started |
| P2-04 | Home This Week, four numbers, derived only, no charts | Human Accepted | Not started |
| P2-05 | Today ordering: obligation at risk, floor breach, decision opportunity | Code/Test Verified | Not started |

## P3, Roadmap and Projects handoff

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P3-01 | Milestone outcome metric: key, label, unit, direction, baseline, target | Production Verified | Not started |
| P3-02 | Measurements with value, measured_at, source, provenance, recorded_by | Production Verified | Not started |
| P3-03 | Manual roadmap, milestone, Point A, Point B, measurement paths | Human Accepted | Not started |
| P3-04 | One-line delivery projection from Projects on the roadmap | Runtime Verified | Not started |
| P3-05 | Decisions displayed from Approvals, no duplicate controls | Code/Test Verified | Not started |

## P4, Scout and Sentinel

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P4-01 | Curated watchlist, staged upload before an explicit save | Production Verified | Not started |
| P4-02 | Bounded scheduled sweep, refresh in place | Production Verified | Not started |
| P4-03 | Movement only on an observed evidence change, with what changed and when | Code/Test Verified | Not started |
| P4-04 | Coverage reported as counts only | Runtime Verified | Not started |
| P4-05 | Existing Scout laws unchanged and passing | Code/Test Verified | Holds today, re-checked per slice |

## P5, Comms

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P5-01 | At risk means only reply owed, promise open, or a dated reason unacted | Code/Test Verified | Not started |
| P5-02 | Judgment before draft, grounding shown | Runtime Verified | Partly implemented today, not verified against this charter |
| P5-03 | Voice note as a first-class logged touch, counted as a first touch | Production Verified | Not started |
| P5-04 | Manual `meeting_kind` logging | Production Verified | Not started |
| P5-05 | Existing Comms laws unchanged and passing | Code/Test Verified | Holds today, re-checked per slice |

## P6, Pulse

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P6-01 | Canon groups only: Act now, Evaluate, Watch closely, Good to know | Code/Test Verified | Needs verification against the current projection |
| P6-02 | Deterministic momentum floors that never override a gate | Code/Test Verified | Not started |
| P6-03 | Same snapshot as Home | Runtime Verified | Not started |
| P6-04 | Feedback: Accept, Not now, Not useful, Why am I seeing this? | Runtime Verified | Implemented, not verified at this level |

## P7, Keep

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P7-01 | Review coverage, named Review coverage and never retention | Human Accepted | Not started |
| P7-02 | `next_review_at` satisfied only by a logged `roadmap_review` | Code/Test Verified | Not started |
| P7-03 | Renewal recorded by hand | Production Verified | Not started |
| P7-04 | Every manual path in the manual override law is reachable | Human Accepted | Not started |

## P8, Tell, post launch

| ID | Gate | Required level | Status | Evidence |
| --- | --- | --- | --- | --- |
| P8-01 | Content Engine v1 in Studio, composer, sources, provenance | Production Verified | **Production Verified** | `content_batches`, `content_items`, `content_sources`, `content_requests` all live; batch `cbat_ffebutsjmtn2ydym` exists with 10 articles and one approval card |
| P8-02 | Publish queue states with an attempt ledger, hardened boundary | **Production Verified** | **Production Verified** | Ledger writes through a server-only key, no ledger write means no send, idempotent on the publish key |
| P8-03 | Featured image provider connected | Production Verified | Blocked, see P0-06 | Every article is an exception until an image store exists |
| P8-04 | One article published with a verified canonical URL | Human Accepted | Blocked, see P0-07 and P0-08 | Nothing published |
| P8-05 | A published article shown to have changed something measurable | Human Accepted | Not started | Depends on P3 measurements |

## P9, intelligence expansion, post launch

| ID | Gate | Required level | Status |
| --- | --- | --- | --- |
| P9-01 | Conductor depth beyond the current room adapters | Human Accepted | Not started |
| P9-02 | Steward interpretation depth | Human Accepted | Not started |
| P9-03 | Canon governance in production use | Production Verified | Not started |
| P9-04 | Sentinel, Scribe, Herald released one gate at a time | Human Accepted | Not started, agents paused |

## Carried forward, not yet placed in a phase

- [ ] First sign-in lifecycle event in the shared activity stream
