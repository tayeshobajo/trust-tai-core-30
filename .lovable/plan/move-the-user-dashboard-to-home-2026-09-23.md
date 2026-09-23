# Move the user dashboard to Home

## Outcome

Home becomes the signed-in user’s operating dashboard, matching the supplied reference:

1. Personal identity and current week
2. Weekly goal and confirmation
3. Streak, level, completed tasks, and time saved
4. My tasks and AI teammate activity
5. Current blockers

Steward remains the team accountability and interpretation room rather than the place a user must visit to find their own dashboard.

## Implementation

- Replace the current Home composition with the existing real per-person dashboard experience and its current data, actions, loading, empty, and unavailable states.
- Keep Home protected by the existing workspace membership gate. Reuse the current Steward dashboard reader and action boundaries rather than duplicating state or creating another data source.
- Match the supplied screen’s hierarchy and density at desktop, tablet, and mobile sizes using the existing Trust Tai shell and brand tokens.
- Remove “Your dashboard” from Steward’s section tabs. Keep Team, Meetings, Tasks, Agents, and Memory inside Steward.
- Preserve `/modules/steward/dashboard` as a compatibility redirect to `/` so bookmarks and old links do not break.
- Update Home’s page title and description to describe the personal operating view.

## Preserved behavior

- Goal confirmation remains a human action.
- Task completion and reversible activity undo remain unchanged.
- Every metric continues to come from existing workspace rows; unavailable or absent data is never presented as invented progress.
- Steward teammate detail pages continue using the same dashboard components in status-only team scope.
- No database, authentication, permissions, autonomous action, or external-send behavior changes.

## Verification

- Add or update focused tests for Home placement, the Steward tab removal, and the old-route redirect.
- Verify loading, unavailable, empty, and populated states.
- Check the page at 375px, 768px, and 1440px for hierarchy, overflow, visible focus, and usable controls.
- Confirm Home is active in the suite rail, Steward team views still work, and every dashboard link reaches the intended room.
- Run the relevant tests and confirm the preview build is clean.
