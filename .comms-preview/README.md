# Local Comms UI preview — test data only

From the worktree root:

    npx vite --config .comms-preview/vite.config.ts --configLoader runner

Open http://127.0.0.1:4345. Uses the real AppShell, CommsTabs, CommsInbox, ConversationRoom, ReplyRecordBar and RelationshipSummary with fictional records. Empty organization/user IDs prevent presence writes; preview-only CSP blocks external connections. The header is illustrative. No save/send APIs are called. This fixture is outside src/routes and is not a production route or authentication bypass.

The full app runs with `npm run dev -- --host 127.0.0.1 --port 4342 --strictPort --configLoader runner`. Open `/modules/comms/relationships` after normal Trust Tai sign-in for authenticated end-to-end QA.
