# Audit: hardcoded personal "Tai" in the UI

Read-only audit. No code changed, no migrations.

## Summary

The shell, Home greeting, avatar initial and every write-path actor label already use the live signed-in identity. There is no place where a greeting or profile label prints a literal "Tai".

There is a second, real problem: several **section headings** say "Needs Tai" / "What Tai is seeing", which read as personal second-person labels but are hardcoded strings. For any user who is not Tai, these are wrong. Separately, one preview fixture contains a user named "Tai".

## 1) Where personal "Tai" is hardcoded

Personal-addressing labels (should be "you" / the current user, currently fixed strings):

| File | Line | String |
|---|---|---|
| src/components/tt/steward/team-rail.tsx | 64 | Rail card title `Needs Tai` |
| src/components/tt/conductor/conductor-right-rail.tsx | 65 | Rail section `Needs Tai` |
| src/components/tt/projects/index/rails.tsx | 121 | Rail section `Needs Tai` |
| src/data/conductor/activity-view.ts | 20 | Activity tab label `Needs Tai` |
| src/routes/modules.activity.tsx | 43 | Page `<title>`: "Activity · Today, Needs Tai, Recently moved" |
| src/components/tt/pulse/header.tsx | 75, 136 | `What Tai is seeing` (mobile + desktop) |

Fixture/demo data containing a person called Tai:

| File | Line | Note |
|---|---|---|
| src/data/memory-source.ts | 37 | `{ id: "usr_tai", name: "Tai", email: "tai@trusttai.com", role: "owner" }`, and `ownerUserId: "usr_tai"` on lines 64, 86, 101, 116. Consumed by `src/routes/index.tsx` for Home's today counts, continue list and decisions. The name "Tai" is not currently rendered (only summaries and counts are), but the record exists in a surface Home reads. |
| src/data/steward/fixture.ts | 18-39 | Rehearsal transcript speaker "Tai". Explicitly labelled as a rehearsal fixture and surfaced with `REHEARSAL_NOTICE`. Legitimate as sample content. |

Brand / product-voice uses of "Tai" that are **not** user personalization and should stay:

- `Ask Tai anything` (home-hero.tsx:26), `Ask Tai for guidance.` (guidance-card.tsx:11), `Ask Trust Tai.` (conductor-header.tsx:46) - Tai is the assistant persona.
- `How Tai sounds`, "This reads like Tai" (modules.comms.voice.tsx) and `src/domain/voice.ts`, `src/data/voice-policy.ts` sign-off rule `Trust, Tai` - founder voice DNA, business content.
- `A note from Tai` (roadmap-studio-packet.ts:284) and studio-view.tsx:296 signature - the roadmap deliverable is authored by the founder.
- `Added by Tai` appears only in a code comment (domain/comms.ts:85); the runtime value comes from `manualProvenance(identity.name)`.
- All "Trust Tai" / "Trust Tai OS" strings.

## 2) Canonical current-user source

Yes. `src/lib/workspace.tsx`:

- `WorkspaceProvider` holds the Supabase session; `useWorkspace()` returns `WorkspaceState`, and on `ready` a `WorkspaceIdentity` with `userId, email, name, firstName, organizationId, organizationName, organizationSlug, role, canManage`.
- `name` comes from `profiles.full_name / display_name / name`, falling back to the email local part.
- `workspaceAccess(identity)` builds the `AccessContext` used by `src/domain/access.ts`.

It is already used correctly by app-shell (avatar + `Signed in as`), Home hero (`firstName`), Comms, Conductor, Steward, Projects, Roadmap and Scout for `userLabel` / actor fields.

## 3) Safest pattern for name and initials

- Read identity only from `useWorkspace()`; never re-derive from the session or a fixture. Components should take `identity` (or `name`) as a prop rather than calling Supabase.
- Initials: there are already two helpers - `initialsOf(name)` in `src/domain/steward-accountability.ts` and `initials(name)` in `src/data/comms-inbox.ts`. app-shell instead does `identity.firstName.charAt(0)`. The safe pattern is one shared helper used everywhere, with a `?` fallback for empty names, matching `initialsOf`'s existing behaviour.
- For personal headings, prefer second person: "Needs you", "What you are seeing", "Waiting on you". This avoids interpolating a name into a heading and is correct for every user. Where a name is genuinely wanted, use `identity.firstName` with a neutral fallback ("Welcome home." already does this).
- Never fall back to a literal name; fall back to a role-neutral phrase.

## 4) Owner labels that are business data, not the current user

These must not be swapped for the signed-in user:

- Steward task owners: `task.owner.name / .initials` (`src/data/steward/accountability.ts`, `task-row.tsx`, `reassign-picker.tsx`) - who is accountable, from `commitments`.
- Comms interaction provenance `owner: "us" | "them"` and `editedBy` / `retractedBy` values already stored on past records; only new records take the current user.
- Project owner filter and grouping (`src/data/projects/index-projection.ts`), roadmap decision owner (`roadmap-service.ts`), route-ledger and Conductor `recordedBy` / `correctedBy` on historical rows.
- Agent owners in the Steward workforce view.
- Client / prospect / relationship names and `stewardUserId` links.
- The roadmap Studio signature and the Comms voice sign-off, which represent the founder as author, not the reader.

## Recommended follow-up (only if you want it)

A small presentation-only change: replace the six "Needs Tai" / "What Tai is seeing" strings with second-person wording, keep the activity `view=needs` param unchanged so existing links still work, and consolidate the two initials helpers into one. No data, schema or business-logic changes.
