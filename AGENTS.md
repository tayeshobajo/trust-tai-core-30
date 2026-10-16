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
- Keep the Steward design preview in an isolated mockup route with fictional fixtures and in-memory state only; this allows review without reading private tasks or activating production work.
- Steward mockup receipts are append-only fictional in-memory events, separate from production task history and session-import staging; repeated completion/reopen review must never mutate canonical task evidence.
- Imported meeting deliverables remain separate session staging and do not fetch teammate task details; task linkage needs a separately authorized narrow read contract.
