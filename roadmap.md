# Trust Tai OS, roadmap

## Now
- [x] People & access: one identity truth (auth email + last_sign_in_at via governed directory)
- [x] In-app activity (`member_activity`) so "Last activity" means work, not sign-in
- [x] Remove a person: revoke access, or delete the sign-in account so they can be created again, records always kept
- [ ] Deploy `docs/people-activity-schema.sql` to Supabase
- [ ] Confirm invite email delivery end to end
- [x] Approvals v1: contract, persistence, renderer registry, downstream adapters, room at `/modules/approvals`
- [ ] Deploy `docs/approvals-v1-schema.sql` to Supabase (room shows the migration notice until then)
- [x] Marketing source adapter: one batch, one approval card, one child per post
- [x] Content Engine v1 in Studio at `/modules/studio` (`docs/content-engine.md`)
- [x] Publish queue states: approved -> queued -> publishing -> published -> verified, with an attempt ledger
- [x] Deploy `docs/content-engine-schema.sql` to Supabase (live)
- [x] Studio resolves internal links against the real `website_pages` inventory
- [x] Prepared batches submit themselves to Approvals, idempotently on the batch id
- [x] Article page at `/modules/studio/$itemId`, linked from each approval child
- [x] First real production batch: `cbat_ffebutsjmtn2ydym`, 10 articles, one approval card
- [x] Publish boundary hardened: attempts written with a server-only key, no ledger write means no send, idempotent on the publish key
- [x] Studio composer: plain-language request read back as a correctable plan, with sources and provenance
- [ ] Deploy `docs/content-engine-maya-schema.sql` to Supabase (sources and requests; Studio reads empty until then)
- [ ] Connect a featured image provider (every article is an exception until then)
- [ ] Set `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN`, then publish one controlled article and verify its canonical URL



## Next
- [ ] First-sign-in lifecycle event in the shared activity stream
