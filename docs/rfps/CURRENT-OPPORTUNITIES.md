# Current opportunities and prominent source link

Display-only correction based on Tai's November 5, 2026 screenshots. No records, statuses, grants, documents, migrations or permissions are changed.

Default list hides RFPs whose recorded deadline has passed and which have neither a submission record nor a Submitted/Awarded/Declined stage. A submission record retains an opportunity even if its stage was not updated. Grants are unchanged. The same visible set feeds the dashboard counts, workflow counts, search and details. An explicit history checkbox restores past records for inspection; deduplication still checks all loaded opportunities.

Unknown or malformed dates remain visible. Known source timezone/time is used for exact cutoffs; repeated DST minutes use the later occurrence and nonexistent local times remain uncertain. Date-only deadlines remain visible through the source's calendar day. With no timezone, the recorded day must have ended everywhere (UTC−12) before the row is hidden. This conservative display boundary does not populate a source timezone or imply the opportunity is open. Invalid timezone stays visible for review. Browser clock drives filtering, refreshed every minute and on focus; no scheduled automation is created.

The top of each opportunity detail contains an HTTP(S)-only source link under its title, labeled “Open RFP source (new tab)” or “Open grant source (new tab)”, with target=_blank and rel=noopener noreferrer. Missing/unsafe URLs receive explanatory text directing users to Notes/source documents; no URL is invented.

Read-only production inspection on November 5 found 35 records including the retained closed synthetic QA record. Seven old Captured RFPs with no submission are hidden under the rule, leaving 28 visible; TWC and Iditarod remain submitted. Unknown-deadline leads and Orland Township's date-only November 5 lead remain visible. This does not label historical records lost or prove they were never submitted outside CMD.

Validation: 94 tests across 11 files passed, production build passed, targeted lint zero errors (one existing Fast Refresh warning), local desktop axe audit zero violations, 375px mobile body/scroll width375 with visible source link. Tests cover date/time and DST boundaries, uncertainty, submission evidence, grants, count/history toggle consistency, safe/missing source URLs and header placement.

Isolated in `rfp-display` / `feat/rfp-current-opportunities`, based on production `8472e36b44a940d68ff54ec65859582c91b58de7`. The separate unapproved editor-role migration remains on `rfp-intake` at `e53f41b3`; it is not part of this release. Future integration must reconcile both workspaces rather than replacing either file wholesale.
