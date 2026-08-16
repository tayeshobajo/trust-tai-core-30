# Database Table Audit — Trust Tai Core (read-only)

No code changes were made. This is the inventory you asked for, from `.from("...")` call sites in `src/` and `scripts/`, the generated types file, and every `docs/*.sql`.

## 1. Tables the runtime code expects (38 unique)

Core / shared: `activities`, `clients`, `contacts`, `organizations`, `organization_memberships`, `profiles`, `projects`

Scout: `prospects`, `prospect_evaluations`, `icp_profiles`, `scout_discovery_runs`, `scout_feedback`

Comms: `comms_threads`, `comms_messages`, `comms_relationships`, `comms_touches`, `comms_drafts`, `comms_reminders`, `comms_voice_profiles`, `comms_integrations`

Roadmap: `roadmaps`, `roadmap_stages`, `roadmap_decisions`, `roadmap_milestones`, `roadmap_artifacts`, `roadmap_artifact_versions`, `roadmap_questions`, `roadmap_research`, `roadmap_sessions`, `roadmap_strategies`

Steward: `conversations`, `commitments`, `steward_beliefs`, `steward_role_memory`

Conductor: `business_figures`, `business_intents`, `conductor_corrections`, `conductor_actions`, `conductor_receipts`

One RPC is also expected: `public.comms_put_integration_secret` (and its sibling `comms_get_integration_secret`).

## 2. Tables declared by schema SQL in this repo (29 unique)

- `docs/comms-v1-schema.sql`: comms_drafts, comms_relationships, comms_reminders, comms_threads, comms_touches, comms_voice_profiles
- `docs/comms-integrations-schema.sql`: comms_integrations, comms_messages, comms_events, comms_event_targets (+ `private` schema, 2 secret functions)
- `docs/roadmap-v1-schema.sql`: roadmaps, roadmap_stages, roadmap_decisions
- `docs/roadmap-intelligence-v2-schema.sql`: roadmap_artifacts, roadmap_milestones, roadmap_questions, roadmap_research, roadmap_sessions, roadmap_strategies
- `docs/roadmap-artifact-history.sql`: roadmap_artifact_versions
- `docs/steward-v1-schema.sql`: conversations, commitments, steward_beliefs, steward_role_memory
- `docs/conductor-v1-schema.sql`: business_figures, business_intents, conductor_corrections
- `docs/conductor-v2-schema.sql`: conductor_actions, conductor_receipts

Alter-only files (create no tables): `docs/projects-v1-schema.sql` (adds columns/policies to `public.projects`), `docs/ops-activity-idempotency.sql` (adds `activities.source_event_key` + unique index), `docs/roadmap-intelligence-v2-1-schema.sql` (alters `roadmap_artifacts`).

## 3. Expected by code, not created by any SQL in this repo (12)

`activities`, `clients`, `contacts`, `organizations`, `organization_memberships`, `profiles`, `projects`, `icp_profiles`, `prospects`, `prospect_evaluations`, `scout_discovery_runs`, `scout_feedback`

The first seven are the externally managed core tables named in the project canon, so their absence here is expected by design — but `projects` and `activities` are only ever *altered* by repo SQL, so a fresh project would fail those migrations. The four Scout tables (`prospects`, `prospect_evaluations`, `scout_discovery_runs`, `scout_feedback`) and `icp_profiles` have **no schema file anywhere in the repo** — they exist only as assumptions in `src/data/supabase/scout-service.ts`, `prospects.ts`, `scout-discovery.ts`, and `icp.ts`. That is the largest undocumented surface.

Declared in SQL but never read or written by code: `comms_events`, `comms_event_targets`.

Generated types are empty: `src/integrations/supabase/types.ts` has `Tables: { [_ in never]: never }`, so **no table is type-checked** — every `.from()` call is untyped and a wrong or missing table name only fails at runtime.

## 4. Core entities specifically

| Entity | Backing table today | Notes |
| --- | --- | --- |
| `clients` | Queried, not declared here | Read in roadmap-service.ts / roadmap-subjects.ts; external table |
| `contacts` | Queried, not declared here | Heavy use in contacts.ts / people-service.ts; external table |
| `projects` | Queried; repo SQL only alters it | projects-v1-schema.sql assumes it already exists |
| `decisions` | **No** | Canon lists `decisions` as core, but no code path ever queries it. Roadmap uses `roadmap_decisions` instead; the two are not the same table |
| `websites` | **No** | Appears only as a capability string in `src/domain/registry.ts`; no table, no query |
| `tasks` | **No** | Same — capability label only in registry.ts |
| `app_registry` | **No** | Named in project canon but never queried; app list is hardcoded in registry.ts |

## Optional follow-ups (not done, no approval implied)

1. Write the missing Scout schema file (`prospects`, `prospect_evaluations`, `scout_discovery_runs`, `scout_feedback`, `icp_profiles`) so the app's expectations are documented and reproducible.
2. Generate real Supabase types so table and column names are compile-checked instead of runtime-checked.
3. Reconcile the canon: either drop `decisions` / `websites` / `tasks` / `app_registry` from the documented core entity list, or state which app owns them.
