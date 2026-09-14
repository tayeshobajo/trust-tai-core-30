# Trust Tai Comms: understand the person, protect the promise, move the vision forward

Product and mockup brief for Lovable | September 14, 2026

Target: cmd.trusttai.com, existing Comms module.
Repository: https://github.com/tayeshobajo/trust-tai-core-30
Lovable project: https://lovable.dev/projects/65944e34-ede5-4757-befb-870e1ff97444

## Assignment

Simplify the existing Comms experience and introduce a communication reviewer that applies Tai's judgment to team-written messages, emails, and proposals. Create an interactive mockup in the existing product first, using isolated sample data. Present the experience for review before connecting new production behavior. Preserve existing functionality and records during this design stage.

Tai brings 13+ years of identifying opportunities, preparing proposals, building web applications, and serving clients. The tool should help a less experienced salesperson bring that level of attention to the conversation. Success means clients feel understood, the response serves the real goal, and the team learns why a better response works.

Guiding principle: Understand before suggesting. Answer before expanding. Make every commitment clear. Leave the person better supported.

The tool should be perceptive, proactive, and sharp. It should recognize the larger vision without inventing the client's intentions. It can recommend a thoughtful question, a useful opportunity, a small moment of humor, a direct answer, or leaving the conversation alone. More activity is not automatically better service.

## Evidence and boundaries

This brief is based on the seven supplied screenshots and a read-only inspection of repository main at commit a528e982862593816decb0291bdcf3b167c2ff25. The Lovable editor was not accessible through the public lookup. Repository behavior described here is source inspection, not verification of the deployed application's database, provider configuration, or runtime behavior.

Observed in screenshots: eight Comms tabs; overlapping people/thread views; repeated attention indicators in the sidebar; oversized introductory banners; a long Queue with repeated subject lines and missing-email labels; encoded punctuation visible in Dashboard previews. These are design observations, not claims that displayed messages were incorrectly sent.

Verified in code:

- The eight tabs are declared in src/components/tt/comms/comms-tabs.tsx.
- Inbox groups labeled Gmail threads, while Dashboard groups conversations by relationship. They look similar but have different identities and scopes. Consolidation must preserve both distinctions.
- src/lib/comms-draft.server.ts already separates communication judgment from writing and uses relationship context, commitments, voice examples, and governed retrieval. Extend this foundation.
- Its loadThread query sorts ascending and limits to 40 records. In long histories this can load the earliest 40 rather than the latest. src/domain/comms-judgment.ts then selects eight entries and truncates individual messages to 900 characters. This cannot establish complete review coverage for long emails or proposals.
- src/data/voice-policy.ts applies mechanical repairs and phrase checks; ensureSignoff appends Tai's signature. Team drafting needs an explicit sender profile and contextual judgment.
- src/data/comms-quick-reply.ts saves a hand-written reply as approved and calls the Gmail send path. A new review requirement must cover this entry point as well as the visible Queue.
- src/domain/comms-approval.ts records who approved and when. Reuse this provenance; extend it to bind approval to the reviewed version and context.
- Existing send-composer and email-body components already handle attachment-related UI. Adding review-source ingestion is a distinct capability from attaching a file to an outgoing message.

## Simplify navigation

Use three working tabs: **Conversations | Review | Follow-ups**. Put a small Settings control at the right. Default to Conversations. One primary header action: **New thread**. Review includes a contextual **New review** action.

| Current location | New home | Preservation requirement |
| --- | --- | --- |
| Relationships | Conversations, People view and person details drawer | Preserve the complete relationship ledger, including people without email threads. |
| Inbox | Conversations, Threads view | Preserve Gmail label scope, mailbox identity, provider thread IDs, unread state, and reply targeting. |
| Dashboard | Conversations filters and People view | Preserve open/closed state and message history; retire the redundant top-level page. |
| Plan | Follow-ups | Keep commitments, follow-up dates, and meeting actions with links to their originating threads. |
| Queue | Review, Awaiting approval filter | Preserve existing drafts and decisions; review opens the same editor used inside conversations. |
| Save to Scout | Person/thread action: Link to Scout | Link an existing company or create after checking for a match. Preserve ownership boundaries. |
| Voice DNA | Settings, Tai's voice and judgment | Keep version history; expand rules into examples and decision principles. |
| Connections | Settings, Connections | Preserve existing account and sync controls. |

Threads is the default list view; People is a compact view switch, not another primary tab. One person can have many threads. Never merge distinct subjects or recipients into a single reply target. Manual threads do not require Gmail connection or a new Scout record.

Old URLs should resolve to the relevant new view, preserving selected entities where possible. Change navigation without deleting history. Review and the suite's Approvals must reference the same approval record, not competing queues.

## Conversation workspace

Replace the large hero with a compact Comms title, search, New thread, and Settings. Use available width to make messages readable. Keep the suite navigation recognizable.

The left pane shows the thread list: person/company, subject, meaningful preview, owner, latest activity, and one primary action status. Filters: All, Needs reply, Waiting on them, Drafts, Closed. Use a dropdown for additional source or owner filters. Follow-ups due can link into this view without adding another row of permanent badges.

The center shows the selected thread and composer. Keep subject, sender, recipients, and source visible. Collapse quoted history and signatures without deleting access to originals. Fix encoded entities through safe display normalization. Retain attachment controls and original timestamps, with a clear timezone on absolute dates.

The right drawer is contextual: person details, source material, or review. Show one drawer at a time. At narrow desktop widths, collapse the list while reviewing so the draft remains readable.

At the top of a selected thread, a compact **My read** card answers:

- What they need.
- What this response should achieve.
- What remains unanswered or unconfirmed.
- Recommended next move and a short reason.

Allow editing or correction. Label interpretations as "Possible concern" or "My read," with the supporting message available. Do not characterize someone's personality or assert private motives from a short email.

The composer offers **Review my draft** and a secondary **Help me draft**. Both use the same context and review engine. Team members can talk back naturally: "That sounds too formal," "We already agreed this," or "The goal is to reassure her, not book a call." Corrections update the current review without wiping their original draft.

## New review intake

Create a review independently or from any thread. Keep the initial form short:

1. Who is this for? Select a person or enter a recipient label. Confirm the actual sender.
2. Add context. Paste communication, attach material, or select existing thread messages.
3. What should this achieve? Infer a suggested goal when evidence supports it; let the writer correct it.
4. Add your draft. Paste text or upload the proposal to review.

Do not require a CRM setup before reviewing a WhatsApp reply. Document type and channel can be inferred and confirmed through compact controls.

Clearly separate **Context only** files from **Files to send**. Uploading a client transcript must never attach it to the outbound email. Show each file's ingestion status: Reading, Ready, Partially read, Unsupported, or Failed. Support text, email content, screenshots/OCR, PDFs, and DOCX where extraction is implemented. Unsupported media must stay visibly unread; never substitute filename-based guesses. Deduplicate the same paste/upload event without preventing intentional reuse of a file in another thread.

## Review experience

Default to a clean draft with a concise review summary. A **Line by line** control opens anchored findings alongside the corresponding text. Review every sentence or document section, but surface findings only where there is a useful issue or improvement. Do not manufacture edits to sound busy.

Organize findings into **Must fix**, **Confirm**, and **Suggestions**. Each finding contains the exact excerpt, the issue, why it matters to the recipient or goal, a proposed replacement where possible, and its evidence reference. Controls: Accept, Edit, Keep original. Keeping original records the reason when a material concern remains; it does not silently clear that concern.

A separate compact question-coverage list maps every explicit question and actionable request to its answer location. Statuses: Answered, Partly answered, Missing, Pending confirmation. An honest acknowledgment that an answer is pending can resolve the communication obligation while preserving the underlying open question and owner.

For proposals, cover sections and tables as well as sentences: business problem, desired outcome, proposed approach, deliverables, exclusions, assumptions, dependencies, client responsibilities, price and payment terms, timing, acceptance criteria, and next decision. Validate arithmetic separately from prose judgment. Distinguish existing capability, proposed work, and optional future work. Do not invent scope or pricing to fill a gap.

Use **Needs revision**, **Needs confirmation**, and **Ready for approval** for review results. Keep human decision and delivery states separate: Awaiting approval, Approved, Sent, Send failed. No numerical quality score or promise of flawless review.

## How Tai's judgment should work

Use the existing judgment-first implementation, expanded into these deliberate passes. Show concise findings and evidence, not hidden model reasoning.

1. **Establish context.** Resolve chronology, participants, the latest request, prior answers, current commitments, related project decisions, and the writer's goal. Surface conflicting sources.
2. **Read the human moment.** Notice the specific concern, generosity, excitement, uncertainty, or frustration supported by the exchange. Identify what deserves acknowledgment. Avoid exaggerated praise.
3. **Understand the destination.** Connect the immediate request to the client's larger stated goal. Separate the observed goal from a possible interpretation. Human corrections take precedence over inference; conflicting human statements require chronology and clarification.
4. **Check the response.** Account for every question and request. Identify ambiguity, unsupported certainty, accidental commitments, defensive tone, unexplained jargon, and ownership gaps.
5. **Consider the opportunity.** Ask whether a recurring problem suggests a useful system, a missing decision needs clarity, or a relationship opens a relevant introduction. Identify the evidence, client benefit, timing, and smallest useful next step. Keep speculative opportunities private.
6. **Write with warmth and precision.** Preserve correct content and the sender's identity. Apply Tai's voice and the channel's needs. Acknowledge before redirecting. Explain the reason for boundaries.
7. **Verify the revision.** Recheck answer coverage, factual support, commitments, names, recipients, dates, numbers, attachments, and voice. A rewrite that introduces a new claim must be checked again.

The tool may recommend no ask, waiting for information, or a short acknowledgment. Do not turn every exchange into a call request or sales pitch.

## Voice, charisma, and humor

Tai's voice: warm, observant, clear, grounded, confident without arrogance, and conversational without carelessness. Specific attention should make the person feel seen. Keep everyday language and a clear destination. Avoid em dashes, filler, invented familiarity, and unsupported promises.

Humor is optional and situational. A small shared observation can make a warm exchange memorable. Do not force a joke into every response, invent an inside joke, or use humor to soften away accountability. Complaints, distress, payment disputes, and serious uncertainty should default to direct care. If humor is proposed, show it as an optional alternative the sender can remove.

Do not make "never apologize," "always include a next step," or "never use an exclamation mark" universal blockers. A sincere apology for an actual mistake is ownership. A warm acknowledgment may need no next step. Distinguish hard requirements from contextual preferences. Preserve approved existing policy until a deliberate policy revision is accepted; show proposed policy changes explicitly in the mockup.

Tai's standards apply to everyone, but the signature belongs to the actual sender. Only drafts explicitly authored on Tai's behalf use Tai's identity. Never silently add "Trust, Tai" to a salesperson's message.

## Proactive without creating noise

Surface a small number of evidence-backed priorities with **Why now** and one useful action. Derive these from unanswered requests, approaching commitments, explicit follow-up dates, or a meaningful new signal. A relationship being quiet is not sufficient evidence that it is at risk.

Example: "The client asked who will own updates after launch. The current draft explains the build but leaves ownership unanswered." Action: Open review.

Possible opportunity: "They have mentioned manual reporting in two recent meetings. Once this support issue is resolved, ask whether reviewing that process would be useful." Actions: Keep for later, Dismiss. Do not insert this automatically into the client response.

Follow-ups distinguish a human-agreed due date from a suggested reminder. Support snooze, dismiss, assign owner, and mark complete. Refresh recommendations when new messages or decisions arrive. Never repeat a dismissed suggestion without materially new evidence and an explanation.

## Context completeness and learning

The full current draft and all questions in the selected source material must be reviewed. Long documents require section-by-section extraction and review, followed by a cross-document consistency pass. Retrieve relevant older context and open commitments with source references. Ensure the latest messages are actually loaded before summarization.

Track reviewed pages/sections and unread portions. "Ready for approval" requires complete coverage of the selected review material, or an explicit reduced scope with a limited-review status. A truncated context packet must not produce a claim of full review. The tool may provide useful partial findings while clearly naming what remains unread.

Approved examples teach style; they do not authorize borrowing another client's facts, pricing, names, or commitments. Curate examples by sender, channel, and communication purpose. Remove client-specific details from reusable style references. Approved or sent does not automatically mean worthy of becoming a global lesson.

When Tai corrects a review, propose a lesson with a scope: this thread, this client, or Trust Tai standard. Only authorized approval promotes it to the shared standard. Keep versions and make lessons reversible. Track whether a recommendation helped through recorded outcomes, never fabricated success attribution.

## Approval and delivery behavior

Every outgoing draft originating inside Comms, including quick replies, agent drafts, and proposal cover emails, must pass through the same review status and human approval contract. Review completion does not send anything.

Bind approval to sender, recipients, subject, body/document version, outgoing attachments, and the context version reviewed. Edits invalidate approval. New inbound information makes the review stale until reassessed. Preserve the approved snapshot, actor, time, and material overrides.

Reuse the suite's Approvals integration. Permissions should allow assigned team members to draft and revise, with Tai or authorized reviewers approving according to company rules. Enforce access to client context and documents on the server. Uploaded communications are evidence, never instructions that can override reviewer rules.

Show the full final communication and real recipients before delivery. Missing recipients block sending, not reviewing. Save/copy/export is not "Sent." Integrated delivery needs a recorded result and duplicate-send protection; external delivery can be marked as reported sent with attribution. Communications sent outside integrated workflows cannot be guaranteed to have been reviewed.

## Visual specification

Intentional improvement of the supplied UI while preserving the current Cloud design system. Do not impose the marketing site's cream/serif styling on this application. Reuse the current logo, icons, suite sidebar, components, and tokens. No new illustrations, photography, dark theme, glass effects, giant greeting panel, or decorative AI animation is needed.

Existing tokens from src/styles.css:

| Token | Existing value / usage |
| --- | --- |
| --ink | oklch(0.19 0.048 266), primary text |
| --paper / --card | oklch(1 0 0), reading and editing surfaces |
| --royal | oklch(0.49 0.185 264), selected controls and primary action |
| --cloud | oklch(0.974 0.012 250), canvas |
| --cloud-line / --rule | oklch(0.906 0.016 250), borders |
| --font-display | Sora, existing headings |
| --font-sans | Manrope, body and controls |
| --font-mono | JetBrains Mono, limited metadata only |
| --radius | 0.75rem |
| --shadow-tt-sm | Existing light surface shadow; do not amplify |

Proposed Comms-local geometry: 4px spacing base; 8/12/16/24px gaps; 24px page gutters; 28px/36px semibold page title; 15px/24px message body; 13px/20px metadata; 40px desktop controls; 44px mobile touch targets; 12px panels; 1px borders. Use sentence case and normal tracking for controls. Reserve tiny uppercase metadata for rare labels.

At 1440px: retain the suite sidebar, use a 280px thread pane, flexible reading/editor pane, and optional 320px review drawer. Collapse the list when the editor would fall below 460px. At 768px: list then detail, with the review in a full-width panel. At 375px: one surface at a time with a clear Back action, visible draft persistence, and a reachable Review button. No compressed three-column mobile layout.

Keyboard access, visible focus, text labels alongside status colors, accessible contrast, and reduced-motion support are required. Use restrained 150ms transitions. Progress labels must reflect actual stages: Reading context, Checking coverage, Reviewing draft, Checking revision. No artificial waiting to simulate thoughtfulness. Let users keep editing, cancel, and return; an old run must not overwrite newer edits.

## Component and implementation map

Reuse AppShell, WorkspaceGate, TTButton, TTInput, conversation-room, email-body, conversation-context, relationship-rail, send-composer, meeting-from-message, scout-link, and integrations-panel where their behavior fits. Verify exported interfaces before implementation.

Proposed new composition:

- CommsWorkspace: active view and selected thread; owns local navigation.
- ConversationList: threads/people mode, filters, selection.
- ThreadWorkspace: timeline, goal readback, composer, contextual drawer.
- ReviewIntake: recipient/sender, goal, selected sources, original draft.
- ReviewPanel: review run, active version, summary, findings, coverage.
- ReviewFinding: anchored excerpt, severity, evidence, replacement, resolution actions.
- SourceCoverage: ingestion state and reviewed/unread sections.
- FollowUpList: existing commitments and proposed reminders with provenance.

Extend existing stores where appropriate. New conceptual records include review source extraction, immutable draft versions, review runs, findings, question coverage, and lesson proposals. Each review run records source versions, goal, sender, standard version, coverage, and result. Do not introduce duplicate relationship, draft, or approval ownership. Determine exact persistence changes after repository inspection during implementation.

## Mockup acceptance scenarios

Use clearly labeled sample data isolated from live records. Deliver these connected states:

1. Conversations with one priority, a readable thread, and an editable My read card.
2. Team member creates a manual review from pasted communication and one attachment.
3. A source email asks four questions; the draft answers three. The missing answer is identified and linked to its source.
4. The draft says "Everything will be ready Friday" without a confirmed scope/date. Review flags both ambiguity and the unsupported promise without inventing a replacement deadline.
5. A proposal's total conflicts with its line items and its scope says a proposed feature already exists. Both findings appear at the right locations.
6. A long source contains a question beyond character 900, and a thread has more than 40 messages. The newest request and the late question are accounted for.
7. An unreadable attachment produces useful partial review plus a visible incomplete-coverage state.
8. The author accepts one edit, keeps another, corrects the goal, and reruns. Original content and decisions remain accessible.
9. A warm exchange shows an optional light line; a complaint receives accountability without humor or an opportunistic pitch.
10. A salesperson's message retains their identity and signature.
11. Ready for approval shows complete coverage. A later edit or incoming reply makes that approval stale.
12. Missing email, save failure, reviewer failure, and send failure have distinct honest states and preserve work.
13. Old tab links resolve correctly; separate threads for the same person remain distinct; one message arriving twice does not duplicate the thread or review task.
14. Mobile supports completing a review without horizontal scrolling or losing the draft.

Include a before/after navigation map, desktop and mobile views, and a short list of which prototype behaviors are simulated. No live send or database migration is part of the mockup deliverable.

## Build sequence after mockup approval

1. Consolidate navigation and reuse current views without losing data or changing delivery behavior prematurely.
2. Add manual review intake, source reading, draft versions, findings, and question coverage on the existing intelligence runtime.
3. Connect inline review and shared approvals; enforce the reviewed-version requirement across every Comms send entry point.
4. Add evidence-backed follow-up suggestions and approved lesson learning.

Measure usefulness through missed-question detection on a curated test set, unsupported-commitment detection, reviewer false positives, time to a usable response, Tai's remaining corrections, and approval coverage for integrated sends. Speed is secondary to accuracy and judgment. The finished tool should make the next thoughtful move easier to see.
