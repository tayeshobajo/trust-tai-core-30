# Project Context Packet handoff

How an agent runtime learns what a Trust Tai project is, before it does anything.

## The idea

An agent should never be told about a project in a chat message that goes stale
the moment someone changes their mind. It reads the packet. The packet is
generated from current project state on every request, so there is no second
document for a person to maintain and nothing to keep in sync.

Small input (a project id). Deep intelligence (the whole confirmed picture).
Clear output (one JSON body).

## The endpoint

```
GET /api/public/projects/context-packet
  ?organizationId=<uuid>
  &projectId=<uuid>
  &agentId=<agent id>        # optional
Authorization: Bearer <supabase access token>
```

Stable hosts:

- `https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app` (production)
- `https://project--65944e34-ede5-4757-befb-870e1ff97444-dev.lovable.app` (preview)

Responses:

| Status | Meaning |
| --- | --- |
| 200 | `{ packet, health, generatedAt }` |
| 400 | `organizationId` or `projectId` missing |
| 401 | no bearer token |
| 403 | the token is valid but the caller is not an active member of that workspace |
| 404 | no project with that id is readable to this caller |
| 502 | the workspace backend could not be read |

## Fail closed

The packet is read under the caller's own session, so row level security
decides its contents. A valid token alone is not access: active membership of
the named organization is verified first. Nothing is ever read with a service
role key, so there is no path where a token for one workspace returns another
workspace's project.

## What the packet contains

- `project` — name, company, outcome, owner, state, due date
- `roadmap` — the roadmap and milestone this work came from, when linked
- `confirmedDecisions`, `constraints`, `requirements` — only knowledge a person
  has confirmed
- `openQuestions`, `blockers` — what is unresolved and who is holding it
- `approvedAssets` — approved mockups, designs, documents; metadata, not files
- `connections` — Lovable, GitHub, staging, production
- `thinkingSources` — where the thinking lives, with the primary one marked
- `movement` — work items and their state
- `conflicts` — where two sources disagree, so the agent stops instead of guessing
- `agent` — present only when `agentId` is passed and a person has written that
  agent's effectiveness definition: responsibility, required context,
  escalation rules, expected evidence

`health` is a level (`strong`, `needs_review`, `missing_key_context`) plus
reasons in plain words. Never a percentage.

## What the packet never contains

Transcripts. Raw file bytes. Every attachment. Unconfirmed knowledge presented
as truth. Anything from an organization the caller is not a member of.

## How an agent should use it

1. Read the packet before starting.
2. If `health.level` is `missing_key_context`, or `conflicts` is not empty, stop
   and ask a person. Do not resolve a conflict on your own.
3. Work only inside `agent.responsibility`. If the work drifts outside it, or
   hits one of `agent.escalationRules`, hand it back.
4. Produce the evidence named in `agent.evidenceExpected`.
5. An agent with no definition has context and no authority. It may read and
   propose. It may not change project truth.

Nothing consequential happens without a person authorising it. The packet
informs an agent; it never licenses one.
