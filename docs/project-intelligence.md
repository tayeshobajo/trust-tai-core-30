# Project Intelligence + Agent Effectiveness

A project is no longer only a task container. It is the shared environment where a person or
an agent can understand what the project is, why it exists, what has been decided, where the
thinking lives, which assets are approved, where it is being built and what success looks like.

Canonical layers: Context → Knowledge → Assets → Build → Work → Intelligence → Outcomes → Learning.

## What is reused, never duplicated

Clients, projects, work items, blockers, decisions, files, agents, memberships and activity
history all stay where they already live. This phase is additive:

| Layer | Where it lives |
| --- | --- |
| Context (thinking rooms) | `public.project_thinking_sources` |
| Knowledge | `public.project_knowledge` |
| Assets | `public.project_assets`, metadata over existing `public.project_files` rows |
| Build environments | `public.project_connections` |
| Agent definition | `public.agent_effectiveness`, keyed by an existing agent id |

Schema: `docs/project-intelligence-schema.sql`. Every table grants `authenticated` and
`service_role`, enables RLS, and scopes policies through `private.is_org_member`. No anon access.

## Honesty rules the code enforces

- **A link is a link.** Saving a ChatGPT or Claude URL records `link_saved`, never "connected".
  A connection may only claim `connected` together with a real `last_synced_at`, and the database
  check constraint refuses anything else.
- **Uploading is not approving.** Every asset arrives as `draft`. Approval is a separate act by a
  person, and it is written to the shared activity stream.
- **Detected is not decided.** Knowledge captured from a meeting, thinking room or agent arrives
  as `needs_review`. Only a person moves it to `confirmed`, and only confirmed knowledge enters
  the context packet.
- **Source hierarchy.** Project decision → roadmap → confirmed knowledge → approved asset →
  meeting → thinking room → agent. Where sources disagree, the packet keeps the higher authority
  and reports the conflict rather than silently resolving it.

## The context packet

`src/data/projects/context-packet.ts` generates the packet from current state each time it is
asked for. It is never a second manual document, it carries meaning plus source references, and
it never carries transcripts or every file. Asked for on an agent's behalf, it also carries that
agent's responsibility, required context, escalation rules and an explicit `mustNotChange` list.

`contextHealth` returns Strong / Needs review / Missing key context with reasons in plain
language. There is no percentage, because a percentage would invent a judgment nobody made.

## Suggestions

`src/data/projects/suggestions.ts` only produces a suggestion when a condition is true in the
record, and each one carries its evidence and can be dismissed. Nothing acts on its own.

## Agent effectiveness

`src/data/projects/agent-effectiveness.ts` projects an agent as outcomes and evidence: what a
person said good looks like, and what actually happened. Paperclip stays the source of truth for
execution. There is no productivity score.

## Tests

`src/data/projects/context-packet.test.ts` covers source authority, exclusion of unconfirmed
knowledge, approved-asset filtering, conflict reporting, agent boundaries, the three health
levels, and grounded suggestion behaviour.
