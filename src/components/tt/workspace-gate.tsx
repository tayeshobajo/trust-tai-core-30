import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PageHeader, MetaPill, TTButton } from "@/components/tt/primitives";
import { useWorkspace, type WorkspaceIdentity } from "@/lib/workspace";

function Boundary({
  title,
  supporting,
  pills,
  action,
  note,
}: {
  title: string;
  supporting: string;
  pills: string[];
  action?: ReactNode;
  note?: string;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-reading flex-col justify-center px-6 py-16">
      <PageHeader eyebrow="Trust Tai OS" title={title} supporting={supporting} />
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {pills.map((pill) => (
          <MetaPill key={pill}>{pill}</MetaPill>
        ))}
      </div>
      {note ? <p className="mt-8 text-sm text-muted-foreground">{note}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * The workspace boundary. Children render only once Supabase Auth has a session
 * AND an organization membership has been read back through RLS.
 */
export function WorkspaceGate({
  children,
}: {
  children: (identity: WorkspaceIdentity) => ReactNode;
}) {
  const state = useWorkspace();

  if (state.status === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        role="status"
        aria-live="polite"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Verifying your Trust Tai access…
        </p>
      </div>
    );
  }

  if (state.status === "signed_out") {
    return (
      <Boundary
        title="This workspace is closed until you sign in."
        supporting="Trust Tai OS fails closed: no workspace data is served until an authenticated Trust Tai identity is verified."
        pills={["Identity: not connected", "Access: closed"]}
        action={
          <TTButton asChild>
            <Link to="/auth">Sign in with Trust Tai</Link>
          </TTButton>
        }
      />
    );
  }

  if (state.status === "no_membership") {
    return (
      <Boundary
        title="Access not provisioned."
        supporting={`You are signed in as ${state.email}, but this account is not a member of a Trust Tai organization yet.`}
        pills={["Identity: verified", "Membership: none"]}
        note="Membership is granted by a Trust Tai owner. Nothing is created automatically, and there is no demo access."
        action={
          <TTButton asChild variant="secondary">
            <Link to="/auth">Use a different account</Link>
          </TTButton>
        }
      />
    );
  }

  if (state.status === "error") {
    return (
      <Boundary
        title="We could not verify your access."
        supporting={state.message}
        pills={["Access: closed"]}
        action={
          <TTButton asChild variant="secondary">
            <Link to="/auth">Back to sign in</Link>
          </TTButton>
        }
      />
    );
  }

  return <>{children(state.identity)}</>;
}
