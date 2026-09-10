# Trust Tai OS, sign-in (magic link) email

## Who owns this email

Sign-in uses `supabase.auth.signInWithOtp` (`src/routes/auth.tsx`) against the
external Supabase project `okydosoacqdnursmmenf`. That project's **Auth email
templates** own the subject and body of the magic link letter. Lovable Cloud is
not enabled here, there is no auth email hook in this repo, and no Supabase
management token is available in the runtime, so the template cannot be pushed
from code. The dashboard is the deployment step.

## Source of truth

`src/lib/auth-email-template.ts` is the canonical template. It reuses
`EMAIL_COLORS` from `src/brand/brand-contract.ts` (the same palette as the
invitation email, derived from the screen tokens) and the public lockup at
`https://cmd.trusttai.com/brand/trust-tai-logo.png`. Supabase substitution is
left intact as `{{ .ConfirmationURL }}` and `{{ .Email }}`; no concrete link is
ever hard-coded. `src/lib/auth-email-template.test.ts` guards the placeholders,
the palette, contrast and mobile safety.

Regenerate the pasteable files:

```
bun -e 'import {magicLinkEmail} from "./src/lib/auth-email-template"; const m=magicLinkEmail(); await Bun.write("/tmp/magic.html", m.html); console.log(m.subject)'
```

## Deploying it (human step)

1. Supabase dashboard, project `okydosoacqdnursmmenf`.
2. Authentication, Emails, Templates, **Magic Link**.
3. Subject: `Your Trust Tai OS sign-in link`.
4. Message body: paste the generated HTML, replacing the default template.
5. Save, then request a sign-in link to a Trust Tai test address only.

Sender identity (`Trust Tai <hello@trusttai.com>`) and SPF/DKIM are unchanged by
this work.
