# Scout, people and verified work email (SP v1)

Scout finds a company that matches the ICP. This capability answers the four
questions that follow, inside Scout's existing company page. There is no new
app, no parallel CRM and no second integrations system.

1. Who is most likely to own, influence or champion this problem?
2. Why does each person matter for this account?
3. Do we hold a professional address, with provenance and freshness?
4. Who moves into Comms for a human-approved message?

## What was built

| Area | File |
| --- | --- |
| Decision rules (pure) | `src/domain/scout-people.ts` |
| Decision tests | `src/domain/scout-people.test.ts` (20) |
| Provider adapters, server only | `src/lib/contact-enrichment.server.ts` |
| Adapter tests, mocked provider | `src/lib/contact-enrichment.server.test.ts` (10) |
| Authenticated route | `src/routes/api/public/scout.people.ts` |
| Browser read | `src/data/scout/people-research.ts` |
| People card | `src/components/tt/scout/detail/people-section.tsx` |
| Page wiring | `src/routes/modules.scout.prospects.$prospectId.tsx`, People tab |
| Proposed storage, UNAPPLIED | `docs/migrations/proposed/20260916180000_scout_people.sql` |

## Acceptance criteria

| Id | Criterion | Evidence |
| --- | --- | --- |
| SP01 | No people researched yet shows one CTA, "Find the right people" | CODE, card state |
| SP02 | Twelve results show at most four best supported | CODE, `recommendPeople` test |
| SP03 | The reason a person was selected is stored and shown | CODE |
| SP04 | Insufficient evidence gives buying role Unknown, never a guess | CODE, `inferBuyingRole` tests |
| SP05 | Search result with no address reads Not checked, with Find email | CODE |
| SP06 | Verified address only when provider evidence says verified, with provider and date | CODE, Apollo adapter test |
| SP07 | Address with no verification evidence reads Found, not verified | CODE |
| SP08 | Past 90 days reads Stale, address retained, warning shown | CODE |
| SP09 | Ambiguous duplicates are never merged automatically | CODE, dedupe test |
| SP10 | Provider unconfigured shows an honest setup state, never a fake result | CODE, `enrichmentStatus` test and card |
| SP11 | Apollo failure falls back to Clay only when retryable, never a charge loop | CODE, failure-policy tests |
| SP12 | Bulk enrichment states the count and the operation ceiling and asks first | CODE, `planBulkEnrichment` test |
| SP13 | Prepare outreach hands into the existing Comms flow, never sends | CODE, page wiring |
| SP14 | Unverified or stale address keeps its warning through the handoff | CODE, handoff tests and toast copy |
| SP15 | No personal address and no phone number is surfaced | CODE, `forDisplay` test and adapter sends `reveal_phone_number: false` |

## Provider state

- **Apollo**: adapter written against the Lovable connector gateway. Needs
  `APOLLO_API_KEY` plus `LOVABLE_API_KEY` in this app runtime. Search is free
  and returns no address; `people/bulk_match` is the paid lookup.
- **Clay**: adapter written for search, email enrichment and Find Thought
  Leadership. Needs `CLAY_API_KEY`, plus `CLAY_EMAIL_ROUTINE_ID` and
  `CLAY_THOUGHT_LEADERSHIP_ROUTINE_ID` for the two routines.
- **Order**: `SCOUT_ENRICHMENT_ORDER`, default `apollo,clay`.
- **Automatic enrichment**: off unless `SCOUT_AUTOMATIC_ENRICHMENT=true`.

None of these keys is present in this app runtime today, so the card shows
"Contact enrichment is not connected" with a link to integration settings.
Connectors authorised inside ChatGPT are not credentials for cmd.trusttai.com
and are not treated as such anywhere in this code.

## Evidence levels

- **CODE verified**: all fifteen criteria above, through 30 deterministic and
  mocked-adapter tests, a clean typecheck and a clean build.
- **IMPLEMENTED-UNCONNECTED**: every real provider call. No Apollo or Clay
  request has been made from this app, no credit has been spent, and no live
  response has been parsed.
- **Not persisted**: researched people currently live in page state for the
  session, and a person only becomes durable when somebody prepares outreach,
  which writes through the existing contacts path. The durable table in
  `docs/migrations/proposed/20260916180000_scout_people.sql` is UNAPPLIED and
  waits on Tai's approval and Codex applying it.
- **Awaiting Tai**: acceptance of the wording, the role families chosen per
  account, the 90-day freshness policy, and a signed-in pass over the People
  tab at 1440, 768 and 375.

## Setup needed before this is live

1. Tai decides the Apollo and Clay accounts the workspace will pay from.
2. An admin adds `APOLLO_API_KEY` and, if Clay is used, `CLAY_API_KEY` plus the
   two routine ids in Project Settings, Secrets.
3. Tai approves the proposed table; Codex applies it and Scout switches from
   session state to durable rows.
