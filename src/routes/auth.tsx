import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PageHeader, MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { supabase } from "@/integrations/trust-tai/supabase";
import { useWorkspace } from "@/lib/workspace";

const TITLE = "Sign in — Trust Tai OS";
const DESCRIPTION =
  "Sign in to Trust Tai OS with a one-time link sent to your Trust Tai email address.";

export const Route = createFileRoute("/auth")({
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

function AuthRoute() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspace.status === "ready") void navigate({ to: "/", replace: true });
  }, [workspace.status, navigate]);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options:
        typeof window !== "undefined"
          ? { emailRedirectTo: `${window.location.origin}/auth` }
          : {},
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSentTo(address);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-reading flex-col justify-center px-6 py-16">
      <PageHeader
        appId="home"
        eyebrow="Trust Tai OS"
        title="Sign in to your workspace."
        supporting="We send a one-time link to your inbox. Use your Trust Tai email address — access itself is granted by your organization membership, not by the address you type."
      />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <MetaPill>Email link</MetaPill>
        <MetaPill>No password</MetaPill>
      </div>

      {sentTo ? (
        <div className="tt-rise mt-8 rounded-xl border border-border bg-secondary/40 p-6">
          <p className="tt-eyebrow">Check your inbox</p>
          <p className="mt-2 text-sm text-foreground">
            A sign-in link is on its way to {sentTo}. Open it on this device to enter the
            workspace.
          </p>
          <div className="mt-4">
            <TTButton variant="quiet" size="sm" onClick={() => setSentTo(null)}>
              Use a different address
            </TTButton>
          </div>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={requestLink}>
          <label htmlFor="auth-email" className="block text-sm font-medium text-foreground">
            Trust Tai email
          </label>
          <TTInput
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@trusttai.com"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <TTButton type="submit" disabled={sending || !email.trim()}>
            {sending ? "Sending link…" : "Send sign-in link"}
          </TTButton>
        </form>
      )}

      {workspace.status === "no_membership" ? (
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
