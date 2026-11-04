# Outreach Today architecture
Existing WorkspaceGate supplies user and organization identity. The panel uses React Query with user, organization and Chicago reporting date in its key. The existing member Supabase client performs metadata-only SELECT under RLS. A pure defensive projection rejects invalid/cross-scope records and holds conflicting provider identities. No send, sync, mutation or campaign qualification is introduced. Existing Comms consumers are unchanged.

# Comms architecture notes

See docs/architecture-canon.md for the project-wide contract. Comms owns its relationships, manual touches, stored provider messages and threads. React Query reads organization-scoped data through the member session. Provider ingestion is server-side and label-gated. Manual touches and provider messages remain separate records. UI attention is a derived reading, never a completion receipt. A message in one thread must not resolve an obligation in another thread or a manual due date.

Comms exact-message links use a separate member/RLS read constrained by organization, relationship and message ID. This avoids waiting for all historical email bodies, merges the target without duplication, and does not change provider ingestion or stored records. The bounded full-history read continues with a visible pending status. Direct relationship/message links open the mobile conversation pane.
