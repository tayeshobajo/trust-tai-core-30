# Proposal-to-canonical-task link — PROPOSED, UNAPPLIED

Status: proposal only. The review surface renders overlap groups as read-only
evidence candidates with a disabled link action until this contract exists.

## Problem

One meeting can produce overlapping proposals (e.g. the phased artist-growth
roadmap passages at 39:48, 39:59 and 40:03, and the mockup passage at 53:57)
while canonical business tasks for the same deliverables already exist.
Confirming every passage would create duplicate commitments; confirming none
loses the link between what was said and the canonical work.

## Proposed contract

1. A durable link record: `(organization_id, conversation_id, proposal_id,
   task_id, decided_by, decided_at, decision)` where decision is
   `linked_existing | confirmed_new | dismissed_duplicate`.
2. Exactly one `confirmed_new` per overlap group; `linked_existing` attaches
   the proposal's source references (quote, timestamp) to the canonical task
   as provenance without changing its status, score weight or evidence.
3. No automatic confirmation: grouping is a review aid only; every decision is
   an explicit human action, attributed and append-only.
4. Re-deciding writes a new record; history is preserved, never rewritten.
5. Read path: the workroom shows linked source references on the canonical
   task's detail panel, clearly labeled as meeting provenance.

## Why it is blocked

This needs a new table (or a reviewed extension of an existing one) and RLS
policy work. Hosted schema inspection and migrations are out of scope for the
current preview work, so the UI shows the groups and keeps the save disabled
with this document as the reason.
