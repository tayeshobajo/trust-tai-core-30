/**
 * Where every auth link lands.
 *
 * Supabase hands the session back here (hash tokens or a PKCE code), the
 * client picks it up, and we restore the sanitized deep link on this same
 * origin. Nothing here ever navigates to another host.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { TTButton } from "@/components/tt/primitives";
import { supabase } from "@/integrations/trust-tai/supabase";
import { sanitizeReturnPath } from "@/lib/auth-origin";

const TITLE = "Completing sign in · Trust Tai OS";
const DESCRIPTION = "Finishing your Trust Tai OS sign-in and returning you to your workspace.";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: sanitizeReturnPath(search["redirect"]),
  }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthCallbackRoute,
});

function AuthCallbackRoute() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function finish() {
      const url = new URL(window.location.href);
      const description = url.searchParams.get("error_description");
      const code = url.searchParams.get("code");

      if (description) {
        setError(description);
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      }

      /* Hash-token links are consumed by detectSessionInUrl during client
         start-up, so the session may land a tick later than this effect. */
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session) {
          void navigate({ to: redirect, replace: true });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (active) setError("This sign-in link is no longer valid. Request a new one.");
    }

    void finish();
    return () => {
      active = false;
    };
  }, [navigate, redirect]);

  return (
    <div className="mx-auto flex min-h-screen max-w-reading flex-col justify-center px-6 py-16">
      <BrandLogo height={30} className="mb-8" />
      {error ? (
        <div className="tt-rise rounded-xl border border-border bg-secondary/40 p-6">
          <p className="tt-eyebrow">Sign-in did not complete</p>
          <p role="alert" className="mt-2 text-sm text-foreground">
            {error}
          </p>
          <div className="mt-4">
            <TTButton
              size="sm"
              onClick={() => void navigate({ to: "/auth", search: { redirect }, replace: true })}
            >
              Back to sign in
            </TTButton>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Completing sign in…</p>
      )}
    </div>
  );
}
