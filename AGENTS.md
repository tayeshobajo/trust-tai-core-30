<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history, force pushing, or rebasing/amending/squashing commits
> that are already pushed, as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Prototype boundaries
- Identify manually required meeting scope through the classified task's immutable correlation key (meeting UUID plus operation UUID), not editable links; include archives and suppress closure on incomplete board reads, because required work cannot disappear through generic edits.
- Associate canonical business tasks with meetings only through recognized internal context links and revision-checked board edits; discriminate task/commitment IDs and keep linked status/evidence outside commitment scores/history to preserve canonical provenance.
- Embed the real Steward workroom in AppShell's opt-in workroom canvas, with container-relative columns and a standalone view variant; global suite navigation must remain available without changing mockup presentation.
- Read Steward history only for the selected commitment UUID through the org/member activity reader with appIds ['steward']; activity records never qualify as completion receipts, because legacy writes are non-transactional.
- Automatic Steward sync compares ordered transcript text, speaker identity and source offsets before classifying unchanged reads; changed nonempty transcripts remain stored without overwrite because segment count cannot prove content preservation.
- Keep the Steward design preview in an isolated mockup route with fictional fixtures and in-memory state only; this allows review without reading private tasks or activating production work.
- Steward mockup receipts are append-only fictional in-memory events, separate from production task history and session-import staging; repeated completion/reopen review must never mutate canonical task evidence.
- Compose the Steward mockup shell inside its own route and reuse one task-details component for the desktop panel and compact drawers; this preserves production shell behavior and identical review safeguards across sizes.
- Imported meeting deliverables remain separate session staging and do not fetch teammate task details; task linkage needs a separately authorized narrow read contract.
