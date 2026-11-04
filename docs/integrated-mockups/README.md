# Local Comms + Roadmaps integration

No push, deployment, publication, external message, authentication request or live data write was performed.

## Provenance and isolation

Integration checkout: `/Users/tayeshobajo/Documents/Codex/2026-11-03/task-4/cmd-integrated-mockups`
Branch: `codex/comms-roadmaps-integrated-20261104`
Base: `62ac04f5ab1787ee29f3cf3d8999b7201486a958` (Roadmaps implementation).
Its parent `12fc84425eba83d069707b20bb1f6e8954362a66` already contains the seven-card binding candidate. It was not applied twice.

The exact original patch is `/Users/tayeshobajo/Documents/Codex/2026-10-20/task-2/restricted-cmd-seven-binding-release-20261103/minimal-release.patch`.
SHA-256: `5876ba8982362967c2dc030c31034f628558d81753a4c1b20a5bcdc0cca4567f`.
The diff from `865cf68bdf0dc74ee30b6c53339e077002aedde2` to `12fc84425eba83d069707b20bb1f6e8954362a66` has that identical hash.

Comms was imported from the uncommitted tracked diff and untracked implementation/fixture files of `../comms-worktree`, branch `feat/comms-mockup-20261104`, base `968beb6d891a221c2696bdcce910c5e07f5b9d1d`. Its tracked patch is preserved in `../integration-evidence/comms.patch`.

Byte hashes of every tracked/unignored file, dirty diffs and git statuses were recorded before and after integration for the original Comms checkout, Roadmaps checkout and seven-card checkout (`cmd-preview-integration`). All match. The original seven-card patch also remains unchanged. Evidence: `../integration-evidence/before.json` and `preservation.json`.

## Shared-file resolution

Only AppShell required a manual merge. Both `canvas?: "default" | "workroom" | "roadmap"` and independent `appearance?: "comms"` coexist. Existing canvas width, container layout, accessible Sheet navigation, default navigation and permission-derived links remain intact. Comms adds opt-in data attributes and class hooks; all its shell CSS is scoped to that attribute. No global token or authentication change was made.

All other Comms tracked changes applied cleanly to the newer Roadmaps base. Roadmaps implementation, tracker initial-field focus, concurrency guards, identity-chain checks, asynchronous scope isolation and imported-activity health invalidation remain byte-identical to the base. Added shell tests exercise all three canvas variants, Comms composition, mobile navigation and the route presentation/access gates.

## Safe previews

From this integration checkout:

```sh
./node_modules/.bin/vite --config .comms-preview/vite.config.ts --configLoader runner
./node_modules/.bin/vite --config vite.roadmap-preview.config.ts --configLoader runner --port 4346
```

Comms: http://127.0.0.1:4345/
Roadmaps: http://127.0.0.1:4346/

Both are prominently labeled fictional previews. Comms uses actual AppShell and components with empty identity IDs (no presence writes); Roadmaps uses the real workspace in its existing visual fixture shell. Neither proves authenticated integrated-route behavior. No credentials should be entered into these fixtures. Production build excludes these preview entry points.

Fresh screenshots in `../integration-evidence/`: `comms-1440.jpg`, `comms-768.jpg`, `comms-375.jpg`, `roadmaps-1440.jpg`, `roadmaps-768.jpg`, `roadmaps-375.jpg`, `roadmaps-375-queue.jpg`. All three widths were viewed. Comms tablet/mobile prioritizes the selected room and moves summary below; Roadmaps tablet keeps queue + room and mobile uses queue/room navigation. Mobile viewport equals document width. Roadmaps mobile selection/back/forward and Comms failed-save text retention were checked in the browser. Temporary viewport overrides were reset.

## Verification and limits

See adjacent `verification.md` for final results. Logs are under `../integration-evidence/`.

The exact mountain panorama is still unavailable in approved repository assets; both implementations use restrained gradient fallbacks. Comms preserves actual navigation, review gates and plain-text writing; Templates, Following, favorite/call/video remain unavailable. No mockup people, counts or roadmap associations became live records.

Roadmaps Send/attachments, Following, internal notes and persisted health overrides remain unavailable. Search covers loaded messages only. Neutral roadmap-cover fallbacks remain. Publication observations and the seven bindings remain a subset, not the full 59-roadmap directory. Prepared Roadmaps text is explicitly unsaved and clears on relationship/scope change.

Authenticated combined-screen QA and live saves/sends were not performed. Prior Comms source inspection identified the configured Supabase origin `https://okydosoacqdnursmmenf.supabase.co` and a same-origin `/auth/callback` redirect for localhost; backend allowlisting and delivered authentication links are unverified. No login request, OTP email, credential entry or session transfer was attempted. These limits are not authorization to bypass authentication.

Original Comms screenshot Library attachment (preceding integration): `libfile_96744e4f8da08191bd4dfe2826ba1c25`, `comms-final-1440.jpg`. The newer integrated screenshots above are local evidence.
