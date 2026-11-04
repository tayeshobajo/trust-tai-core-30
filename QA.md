# Outreach Today release checks
Verify Chicago midnight and DST boundaries, invalid dates, hostile provenance, cross-organization and inbound rejection, conflicting duplicate holds, null assignment labels, and unknown qualification. Verify member identity before and after read, error and truncation handling. Run focused tests and production build. Independently review exact diff before publication. Verify Comms at 375px and 1440px, date changes and separate-tab identity/cache isolation. No sync controls may be clicked during QA.

# Comms verification

Verify root and legacy Dashboard/Conversations redirects preserve relationship, thread and message search parameters. Verify both navigation variants omit Dashboard. Test stored email attention across multiple threads/mailboxes and manual obligations. Test sync summary updates cannot regress dates or clear manual obligations, and database failures propagate. Check Conversations at desktop and 375px with synthetic fixtures. Production and authenticated visual verification require a separately authorized release; local checks do not establish mailbox completeness.
