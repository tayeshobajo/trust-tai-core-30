# Studio tabs — local implementation review

Date: 2026-11-05. Work is local on `codex/studio-video-mockup`; no push, deployment, production writes, migrations, or access-policy changes.

## Design and scope

The approved Video treatment now supplies the shell, typography, cream surfaces, orange actions, cards and navigation for Overview, Posts, Ideas, People, Content DNA and Sources. The three supplied Library inspirations were materialized and visually inspected before applying their direction: `libfile_4b974363a87c81919939d8780bfcdd62` (Ideas), `libfile_03c4a344ffd081918ddc15e63adf397f` (Posts), and `libfile_2d08e2294ce08191a06a2cb92b940f94` (People). They are inspiration, not a claim of exact pixel equality.

Ideas keeps a simple thought input and optional type chips immediately above saved cards. Posts uses a profile-like reading feed beside website topics and saved ideas. People uses contact cards with a detail panel and a clearly unavailable Nashville discovery state. Other pages follow the same visual foundation. Video remains its own route. Suite navigation remains available.

## Implemented behavior

| Area        | Data and behavior                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview    | Existing workspace batches, briefs and sources; counts are explicitly limited to the returned recent records. Read failures and missing storage are distinct from empty lists.                                                                                                                                                                                                                           |
| Posts       | Original composer, generation, editorial batch review, approval and publisher paths moved from the index to `/modules/studio/posts`. Existing article editor links back to Posts. Recent workspace articles and manually saved LinkedIn text appear in the feed. Existing website-derived opportunities remain available.                                                                                |
| Ideas       | Uses the existing organization-scoped brief service, with an explicit manual-idea marker. Save, edit, archive confirmation, search and handoff to a prefilled post composer. No automatic generation or approval. Failed saves retain the input.                                                                                                                                                         |
| People      | Existing shared contacts, available only with existing Scout or Clients app access; filters and search apply to returned records. Only stored LinkedIn URLs are offered. Editable introduction template uses the user's reason and can be copied; it is never sent or saved as an outreach event. Existing read-only newsletter audience retains its server permission boundary, filters and pagination. |
| Content DNA | Displays the exact existing article voice instructions from a shared constant. The writing check uses the existing deterministic voice checker. Saved sources are selected explicitly for each post.                                                                                                                                                                                                     |
| Sources     | Existing source store supports pasted text, pasted LinkedIn/article writing, text/Markdown file intake, links, read detail, search and confirmed removal. URLs are validated as HTTP(S) and saved without claiming to fetch their content.                                                                                                                                                               |

The source composer now treats previously loaded sources as opt-in, preserving newly attached source selection. Workspace article cards identify the workspace rather than assigning every article to the current user. Imported LinkedIn references do not assert an author or synced publication date.

## Verification

- Production build: passed (`npm run build`). Existing upstream deprecation/chunk warnings remain.
- TypeScript: passed (`tsc --noEmit`).
- Targeted tests: 48 passed across five files: ideas domain, content request, content state machine, brief persistence service and audience server authorization.
- Changed Studio lint scope: zero errors; one existing Fast Refresh export warning in composer.
- Browser matrix: Overview, Posts, Ideas, People, DNA, Sources, Audience and Video at 1440, 768 and 375 pixels; all 24 cases had no page exceptions, horizontal document overflow or axe WCAG A/AA violations. Automated checks do not replace a full manual accessibility audit.
- Fixture interaction checks passed: idea save/reload/edit/archive cancel and confirm; failed save retains text; missing brief store disables save; idea-to-post prefill; pasted LinkedIn source shown in Posts; invalid URL rejection and valid link saved without extracted text; confirmed source removal; pre-existing sources remain unchecked; people filters and manual introduction; app-access restriction; voice-check results reset on edit; newsletter status filter.
- Fixed issues found during checks: hidden idea success/error paragraphs, low-contrast secondary text, changing accessible names on populated textareas, duplicate title text in idea cards and an inappropriate transcription label for unfetched links.

Browser checks used an isolated Vite harness with fictional fixtures and disconnected production services. No authenticated production database write, generation call, approval or publication was attempted. The harness is outside the production checkout under the task's `qa-tabs-harness`; screenshots and the 24-case JSON result are under `qa-results`.

## Remaining gaps

LinkedIn activity/comment sync, external curated feeds, interest matching, Nashville location discovery, social publishing and automated learning from edits are not connected. No engagement counts, match scores or fake live integrations are shown. Existing article generation/approval/publishing code is retained, but its live configuration was not verified in this review. Contact access depends on existing Scout/Clients permission; newsletter access retains its existing server checks.

Video drafts remain device-local, as in the approved Video implementation. The new Ideas and Sources pages instead call existing workspace services, whose live availability depends on the target environment. URLs are not crawled; PDF extraction and audio/video transcription are unavailable. The six tabs use available icons, initials and warm surfaces rather than inventing portraits, location facts or feed activity. Original mockup photography is not reproduced on the new inspiration-based pages.

Seven final review PNGs exist locally: Overview, Posts, Ideas, People, Content DNA, Sources and Ideas mobile, all marked as fictional design previews. The required Library upload helper failed before preparation with `Library prepare_uploads is not available`. No screenshot upload was finalized and no alternate write was attempted.

## Screenshot delivery follow-up

After the parent requested another supported creation attempt, the direct Library create workflow succeeded for Ideas, Posts and People. Each is version 0, with local Library identity persisted:

- Ideas: `libfile_b76dbcc72058819192fef5df271bf688` (`file_000000004b5c81f6a1e5d9beaee5770b`).
- Posts: `libfile_9d4d1886e8b08191988a6ad3797f2391` (`file_000000005dc481f68eda5e53f9d1d880`).
- People: `libfile_dded1764bebc8191bfcc4e06f3eb514e` (`file_000000007cf081f68f7e81608db89f37`).

The earlier prepared-upload error did not prevent this newly requested direct creation. No private storage URL was used or invented.
