# Approved Steward implementation — 19 October 2026

References inspected locally: Steward-meetings-overview-mockup.png and Steward-task-details-mockup.png (Library version 2). The existing AppShell and navigation are retained.

Visual tokens: white surface, navy primary text, royal blue action, pale blue selected rows, thin blue-gray dividers, green completed work, red overdue badges. Reuse CMD's foreground/royal/cloud/border/success/destructive tokens to retain suite identity. Reference hierarchy: 40px meeting title; 32px detail title; 16px body; 13px metadata. Main spacing 32px, row padding 24px, field radius 8px. Lucide calendar/search/check/chevron/link/close icons. No imagery required.

Component tree: AppShell > ApprovedMeetings > MeetingOverview (search/filter/sort, MeetingSummary rows) OR MeetingTasks (completion summary, search, expandable completed rows) + TaskPane (status/owner/due, explicit completion, roll-forward dialog, Updates/Details/Evidence). Compact layout uses an accessible Sheet for the same TaskPane.

States: loading/error remain owned by existing query layer; empty list and zero confirmed actions are explicit. All commands await persistence and disable repeated submission. URL selection retains Back/Forward and permission-aware links. Detail tools remain progressively disclosed. Mockup sample data is never imported.

Completion projection is separate from legacy verification/closure scores: unique confirmed commitments plus immutable manually required tasks, excluding released commitments and contextual business links. Completed means kept/complete. Verification does not alter this percentage. Roll-forward is an append-only activity with original meeting/task identity, chosen later meeting/date and original due date; it does not change due date, status, source links or denominator.
