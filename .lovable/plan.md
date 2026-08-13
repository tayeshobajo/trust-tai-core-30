# Comms — Trust Tai's relationship operating system

## Product thesis

Comms is not an inbox. It is the room where Trust Tai keeps relationships alive on purpose.
Its one job: **no meaningful person or message falls through, and every outreach sounds like Tai.**

Point A: contacts scattered across email, event badges, LinkedIn tabs, and Scout handoffs.
Point B: one relationship queue where every person has a state, an owner, a last touch, a
truthful reason to reconnect, and a draft that already sounds human.

v1 proves the system with data we already control (Supabase + OpenAI). No mailbox sync, no
LinkedIn API, no event feeds until the core surface is trusted.

## Information architecture

```text
/modules/comms                    Relationship queue (three-pane operating surface)
/modules/comms/r/$relationshipId  Deep link to one relationship, same shell
/modules/comms/capture            Fast in-person capture (mobile-first)
/modules/comms/voice              Voice DNA policy: rules, examples, review settings
/modules/comms/network            Networking layer (v2): people worth knowing, events
```

Ambient Identity Wash uses the Comms accent for the shell, and the company's real
brand colour on a relationship that carries one from Scout.

## Three-pane layout (adapted from the Ops surface)

```text
┌ Queue ────────────┬ Relationship workspace ─────────┬ Next move rail ──────┐
│ Needs you (SLA)   │ Identity band: person, company, │ Why now              │
│ Waiting on them   │ where we met, fit light         │ Recommended angle    │
│ Warm / nurture    │ Relationship memory timeline    │ Draft (Voice DNA)    │
│ New from Scout    │ Threads and messages            │ Review state         │
│ Met in person     │ Facts / inferred / decided tabs │ Owner + due          │
│ [Filter · search] │ Notes, commitments, people      │ Log a touch          │
└───────────────────┴─────────────────────────────────┴──────────────────────┘
```

375px: queue → relationship → rail as stacked views with a back affordance.
768px: queue collapses to a slide-over; rail becomes a drawer.

## Relationship lifecycle

`new → researching → ready_to_reach → reached_out → in_conversation → meeting_set →
opportunity → client → nurture → dormant → archived`

Lifecycle is human-owned. Nothing advances automatically; the system only recommends and
surfaces. Statuses are labelled text plus shape, never colour alone.

## Thread / conversation state model

- **Relationship** — the durable object (person + optional company). Owns lifecycle,
  owner, SLA, memory.
- **Thread** — one line of conversation (email chain, event follow-up, LinkedIn note).
  State: `open`, `waiting_on_us`, `waiting_on_them`, `scheduled`, `closed`.
- **Touch** — one logged interaction: channel, direction, at, summary, optional body,
  provenance. v1 touches are manually logged or created when a draft is marked sent.

## SLA / coverage model for the Comms Lead

Per relationship: `response_due_at` (inbound waiting on us) and `follow_up_due_at`
(outbound with no reply). Queue buckets: **Overdue**, **Due today**, **This week**,
**Dormant beyond threshold**. Coverage read at the top of the queue: how many
relationships have no owner, no next move, or no touch in N days. Truth, not gamification.

## Data model (new Supabase tables, org-scoped, RLS + explicit grants)

Existing shared tables stay authoritative: `clients`, `contacts`, `prospects`, `activities`.
Comms adds relationship state rather than duplicating people.

- `comms_relationships` — organization_id, contact_id (FK contacts), client_id, prospect_id,
  stage, owner_user_id, source (`scout_handoff` | `in_person` | `manual` | `inbound`),
  met_at, met_where, last_touch_at, next_action, response_due_at, follow_up_due_at,
  observed jsonb, inferred jsonb, decided jsonb, metadata jsonb, created_by, timestamps.
- `comms_threads` — relationship_id, channel, subject, state, last_message_at, metadata.
- `comms_touches` — thread_id, relationship_id, channel, direction, occurred_at, summary,
  body, provenance jsonb, logged_by.
- `comms_drafts` — relationship_id, thread_id, intent, register, body, voice_version,
  review_state (`draft` | `needs_human_review` | `approved` | `sent` | `discarded`),
  rationale jsonb, evidence jsonb, created_by.
- `comms_reminders` — relationship_id, reason_code, reason_text, evidence jsonb, due_at,
  state (`pending` | `acted` | `dismissed`).
- `comms_voice_profiles` — org-level Voice DNA document, versioned, same shape and
  edit rules as `icp_profiles` (owner/admin edit, active member view).

Every write also records an `activities` row (`relationship.created`, `relationship.stage_changed`,
`draft.created`, `draft.approved`, `touch.logged`, `prospect.handed_over` receipt).

Dependency: these tables live in the externally managed Supabase project, so the SQL must be
applied there before build. I will supply the exact migration for approval.

## Relationship memory and provenance

Three strictly separated tiers, reusing the Scout pattern:
**Observed** (a message exists, a page said this), **Inferred** (Scout/AI read), **Decided**
(a person chose this). Memory items carry evidence refs and an updated-at. The workspace
never blends tiers in one sentence, and drafts may only cite observed or decided items.

## Conference / in-person capture

One screen, three fields: **Name**, **Where we met**, **One thing worth remembering**.
Optional company or email. Save creates a contact + relationship in `new` with
`source = in_person`. Enrichment then runs best-effort in the background (domain lookup,
existing Scout prospect match, public-site people match) and files anything found as
Inferred with provenance. Nothing invented; no scraping.

## Voice DNA architecture

A versioned policy document plus a deterministic checker, not a prompt string buried in code.

- `src/domain/voice.ts` — rule types, register (`warm_intro`, `follow_up`, `reconnect`,
  `logistics`, `sensitive`), intents, hard bans.
- `src/data/voice-policy.ts` — deterministic pre/post pass: strips em dashes, flags
  exclamation marks, blocks "just checking in", "touching base", needy phrasing,
  fabricated familiarity (any claim without an evidence ref), unconfirmed promises;
  enforces short declarative cadence and the `Trust,\nTai` signoff.
- `src/lib/comms-draft.server.ts` — server function composing evidence + register +
  policy into a draft via the existing AI gateway. Every generated line is checked by the
  deterministic pass; violations are rewritten or the draft is held.
- Sensitive/heavy registers are always created as `needs_human_review`.

## Drafting, review, sending boundaries

Comms **drafts and holds**. v1 never sends. The rail shows draft → review → approve → mark
as sent (copy to clipboard, log a touch). Sending is a later integration behind the same
approval gate. No sequences, no automated cadences, ever.

## Networking intelligence (v2)

People worth knowing and reasons to connect are built from what we legitimately hold: Scout
research, public company pages, and human-entered notes. LinkedIn URLs are stored as links a
human pasted or an approved provider returned. No scraping of LinkedIn or any site that
forbids it. Events come only from an approved feed or a human adding one.

## Proactive reminders / reasons to reconnect

A reminder requires a truthful `reason_code` backed by evidence: `commitment_made`,
`no_reply_after_n_days`, `event_follow_up`, `company_signal` (Scout found news),
`anniversary_of_meeting`, `role_change_observed`. No reason, no reminder. A relationship
with nothing true to say sits quietly in nurture.

## Local Tennessee opportunity layer (v2)

An org-scoped locality setting (Nashville / Middle TN default) feeds a Scout-powered
"people and organisations worth knowing nearby" read plus manually curated events. Presented
as suggestions with provenance, never as a scraped directory.

## Analytics that matter

Relationships with no owner. Overdue responses. Median time to first reply. Reasons acted on
vs dismissed. Meetings set from in-person captures vs Scout handoffs. Drafts approved
unedited vs rewritten (a Voice DNA quality signal). No vanity volume counts.

## Security and privacy

Org-scoped RLS on every new table plus explicit grants; message bodies readable only by org
members; the AI gateway receives only the evidence needed for one draft; no service-role use
in client paths; sensitive notes flagged and excluded from AI context; delete/export path for
a contact's Comms record.

## Scout → Comms handoff

`HandoffDraft` already carries company, targets, intent, required context, confidence, and
blockers. "Carry to Comms" will create or match a relationship, copy targets into contacts,
file required context as memory with tiers intact, seed `next_action` from the intent,
and land it in the **New from Scout** bucket. Idempotent per prospect.

## Build sequence

**v1 (now, Supabase + OpenAI only)**
1. Migration + repositories for the six tables.
2. Three-pane shell, queue buckets, relationship workspace, next-move rail.
3. In-person capture flow.
4. Scout handoff receiver (replaces the current record-only route).
5. Voice DNA policy document, deterministic checker, draft generation with review states.
6. Manual touch logging, reminders with reason codes, SLA/coverage read.
7. Tests: policy checker, lifecycle transitions, handoff mapping, reminder reasons.

**v2 (external dependencies)**
Gmail/Outlook sync (inbound threads, real sending), Calendar (meetings set, event capture),
contact enrichment provider (verified emails), event data source, LinkedIn-compatible
provider. Each is additive behind the existing provider abstractions.

## Requires an external provider (not buildable now)

Real inbound mail, actual sending, calendar awareness, verified-email enrichment, live event
listings, LinkedIn data. v1 works fully without them.

## QA acceptance questions

1. Can a person met at a conference be captured in under fifteen seconds?
2. Does every relationship show owner, last touch, next move, and due state?
3. Does a Scout handoff arrive with company, people, evidence, why now, and angle intact?
4. Are observed, inferred, and decided never blended in one statement?
5. Does every draft pass the Voice DNA checker (no em dashes, no "just checking in",
   no fabricated familiarity, no unconfirmed promises, correct signoff)?
6. Are heavy or emotional registers always held for human review?
7. Does every reminder carry a truthful, evidence-backed reason?
8. Can the Comms Lead see, in one glance, what is overdue and what is uncovered?
9. Does nothing send without explicit human approval?
10. Do the three panes work at 375px, 768px, and 1440px with all operational states?

## Assumptions

- New `comms_*` tables can be added to the managed Supabase project; existing shared
  entities are reused, not duplicated.
- v1 sends nothing and syncs no mailbox.
- Voice DNA lives as an editable org document, mirroring ICP Settings.
