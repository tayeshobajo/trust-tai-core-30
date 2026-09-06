import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { PageHeader, MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { evaluateInviteAcceptance, normalizeEmail, sameEmail } from "@/domain/invite-acceptance";
import { supabase } from "@/integrations/trust-tai/supabase";
import { authRedirectUrl, sanitizeReturnPath } from "@/lib/auth-origin";
import { useWorkspace } from "@/lib/workspace";

const TITLE = "Sign in · Trust Tai OS";
const DESCRIPTION =
  "Sign in to Trust Tai OS with a one-time link sent to your Trust Tai email address.";

/** Only same-origin app paths may be restored after sign-in. */
function readRedirect(search: Record<string, unknown>): string {
  return sanitizeReturnPath(search["redirect"]);
}

function readText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { redirect: string; email?: string; invite?: string } => {
    /* Invitation context carried by the emailed link. Both stay optional so
       every existing link to /auth keeps working unchanged. The id grants
       nothing on its own: acceptance still requires a verified session on the
       invited address. */
    const email = readText(search["email"], 320);
    const invite = readText(search["invite"], 64);
    return {
      redirect: readRedirect(search),
      ...(email ? { email } : {}),
      ...(invite ? { invite } : {}),
    };
  },

  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthRoute,
});

type AcceptState =
  { phase: "idle" } | { phase: "working" } | { phase: "failed"; outcome: string; because: string };

function AuthRoute() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const { redirect, email: invitedRaw, invite = "" } = Route.useSearch();
  const invitedEmail = normalizeEmail(invitedRaw);
  const hasInvite = Boolean(invite && invitedEmail);

  const [email, setEmail] = useState(invitedEmail);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accept, setAccept] = useState<AcceptState>({ phase: "idle" });
  const [signingOut, setSigningOut] = useState(false);

  /* The session's own address, read from Supabase rather than inferred, so a
     wrong active session is recognised even before membership is resolved. */
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionKnown, setSessionKnown] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionEmail(data.session?.user?.email ?? null);
      setSessionKnown(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSessionEmail(next?.user?.email ?? null);
      setSessionKnown(true);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const wrongSession = Boolean(hasInvite && sessionEmail && !sameEmail(sessionEmail, invitedEmail));

  /* Where this invitation link should return to after the emailed sign-in
     link is opened, so the invite context survives the round trip. */
  const inviteReturnPath = hasInvite
    ? `/auth?email=${encodeURIComponent(invitedEmail)}&invite=${encodeURIComponent(invite)}`
    : redirect;

  const consume = useCallback(async () => {
    setAccept({ phase: "working" });
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setAccept({ phase: "idle" });
      return;
    }
    const response = await fetch("/api/public/settings/invite-accept", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId: invite }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      outcome?: string;
      because?: string;
    } | null;

    if (body?.ok) {
      /* Membership changed, so the workspace boundary must read it again. */
      await supabase.auth.refreshSession().catch(() => null);
      window.location.assign(redirect || "/");
      return;
    }
    setAccept({
      phase: "failed",
      outcome: body?.outcome ?? "unknown",
      because: body?.because ?? "This invitation could not be accepted right now.",
    });
  }, [invite, redirect]);

  /* Signed in as the invited address: consume the invitation once, through the
     canonical endpoint. Never runs for a different account. */
  useEffect(() => {
    if (!hasInvite || !sessionKnown || wrongSession) return;
    if (!sessionEmail || accept.phase !== "idle") return;
    if (workspace.status === "ready") return;
    void consume();
  }, [
    hasInvite,
    sessionKnown,
    wrongSession,
    sessionEmail,
    accept.phase,
    workspace.status,
    consume,
  ]);

  useEffect(() => {
    if (workspace.status === "ready" && !wrongSession)
      void navigate({ to: redirect, replace: true });
  }, [workspace.status, wrongSession, navigate, redirect]);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    const address = hasInvite ? invitedEmail : email.trim();
    if (!address) return;
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: authRedirectUrl(inviteReturnPath) },
    });

    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSentTo(address);
  }

  async function switchAccount() {
    setSigningOut(true);
    await supabase.auth.signOut().catch(() => null);
    setSigningOut(false);
    setAccept({ phase: "idle" });
  }

  const inviteDecision = hasInvite
    ? evaluateInviteAcceptance({
        invitation: { email: invitedEmail, status: "pending", expiresAt: null },
        sessionEmail,
      })
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-reading flex-col justify-center px-6 py-16">
      <BrandLogo height={30} className="mb-8" />
      <PageHeader
        appId="home"
        eyebrow={hasInvite ? "Your invitation" : "Trust Tai OS"}
        title={hasInvite ? "Accept your Trust Tai invitation." : "Sign in to your workspace."}
        supporting={
          hasInvite
            ? `This invitation is for ${invitedEmail}. Access is granted by the invitation and your organization membership, never by the address you type.`
            : "We send a one-time link to your inbox. Use your Trust Tai email address. Access itself is granted by your organization membership, not by the address you type."
        }
      />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <MetaPill>Email link</MetaPill>
        <MetaPill>No password</MetaPill>
        {hasInvite ? <MetaPill>{invitedEmail}</MetaPill> : null}
      </div>

      {wrongSession ? (
        <div className="tt-rise mt-8 rounded-xl border border-border bg-secondary/40 p-6">
          <p className="tt-eyebrow">Wrong account for this invitation</p>
          <p className="mt-2 text-sm text-foreground">
            This invitation is for {invitedEmail}. You are currently signed in as {sessionEmail}.
            Nothing has been granted to this account.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign out here, then open the invitation link again and sign in as {invitedEmail}.
          </p>
          <div className="mt-4">
            <TTButton size="sm" disabled={signingOut} onClick={() => void switchAccount()}>
              {signingOut ? "Signing out…" : "Sign out and switch account"}
            </TTButton>
          </div>
        </div>
      ) : accept.phase === "working" ? (
        <p className="mt-8 text-sm text-muted-foreground">Accepting your invitation…</p>
      ) : accept.phase === "failed" ? (
        <div className="tt-rise mt-8 rounded-xl border border-border bg-secondary/40 p-6">
          <p className="tt-eyebrow">This invitation could not be accepted</p>
          <p role="alert" className="mt-2 text-sm text-foreground">
            {accept.because}
          </p>
        </div>
      ) : sentTo ? (
        <div className="tt-rise mt-8 rounded-xl border border-border bg-secondary/40 p-6">
          <p className="tt-eyebrow">Check your inbox</p>
          <p className="mt-2 text-sm text-foreground">
            A sign-in link is on its way to {sentTo}. Open it on this device to enter the workspace.
          </p>
          {hasInvite ? null : (
            <div className="mt-4">
              <TTButton variant="quiet" size="sm" onClick={() => setSentTo(null)}>
                Use a different address
              </TTButton>
            </div>
          )}
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={requestLink}>
          <label htmlFor="auth-email" className="block text-sm font-medium text-foreground">
            {hasInvite ? "Invited email" : "Trust Tai email"}
          </label>
          <TTInput
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            readOnly={hasInvite}
            value={hasInvite ? invitedEmail : email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@trusttai.com"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {hasInvite ? (
            <p className="text-sm text-muted-foreground">
              {inviteDecision?.because ?? `Sign in as ${invitedEmail} to accept this invitation.`}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <TTButton type="submit" disabled={sending || (!hasInvite && !email.trim())}>
            {sending ? "Sending link…" : "Send sign-in link"}
          </TTButton>
        </form>
      )}

      {workspace.status === "no_membership" && !hasInvite ? (
        <p className="mt-8 text-sm text-muted-foreground">
          You are signed in as {workspace.email}, but no Trust Tai organization membership exists
          for this account yet.
        </p>
      ) : null}

      <p className="mt-10 text-sm text-muted-foreground">
        <Link to="/" className="underline underline-offset-4">
          Back to Trust Tai OS
        </Link>
      </p>
    </div>
  );
}
