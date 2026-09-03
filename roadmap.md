# Trust Tai OS, roadmap

## Now
- [x] People & access: one identity truth (auth email + last_sign_in_at via governed directory)
- [x] In-app activity (`member_activity`) so "Last activity" means work, not sign-in
- [x] Remove a person: revoke access, or delete the sign-in account so they can be created again, records always kept
- [ ] Deploy `docs/people-activity-schema.sql` to Supabase
- [ ] Confirm invite email delivery end to end
- [x] Approvals v1: contract, persistence, renderer registry, downstream adapters, room at `/modules/approvals`
- [ ] Deploy `docs/approvals-v1-schema.sql` to Supabase (room shows the migration notice until then)


## Next
- [ ] First-sign-in lifecycle event in the shared activity stream
