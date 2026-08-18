import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
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
      <BrandLogo height={30} className="mb-8" />
      <PageHeader appId="home" eyebrow="Trust Tai OS" title={title} supporting={supporting} />
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
export interface RoomPreview {
  /** The room the reader was trying to open, e.g. "the Conductor". */
  room: string;
  /** What this room does once an identity is verified. */
  purpose: string;
  /** Named capabilities that stay closed while signed out. */
  unavailable: string[];
  /** Where the reader lands after signing in. */
  returnTo?: string;
}

export function WorkspaceGate({
  children,
  preview,
}: {
  children: (identity: WorkspaceIdentity) => ReactNode;
  preview?: RoomPreview;
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
    const signIn = (
      <TTButton asChild>
        <Link
          to="/auth"
          search={{ redirect: preview?.returnTo ?? "/" }}
        >
          Sign in with Trust Tai
        </Link>
      </TTButton>
    );

    if (preview) {
      return (
        <Boundary
          title={`${preview.room} is closed until you sign in.`}
          supporting={preview.purpose}
          pills={["Identity: not connected", "Access: closed"]}
          action={
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-secondary/40 p-6">
                <p className="tt-eyebrow">Unavailable while signed out</p>
                <ul className="mt-3 space-y-2">
                  {preview.unavailable.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-foreground">
                      <span aria-hidden className="text-muted-foreground">
                        —
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[13px] text-muted-foreground">
                  Nothing is previewed with sample data. Trust Tai OS fails closed: no workspace
                  record is read until an authenticated identity and an active organization
                  membership are verified.
                </p>
              </div>
              <div>
                <p className="text-sm text-foreground">
                  Sign in with a one-time link sent to your Trust Tai email. You will return to{" "}
                  {preview.room.toLowerCase()} straight after.
                </p>
                <div className="mt-4">{signIn}</div>
              </div>
            </div>
          }
        />
      );
    }

    return (
      <Boundary
        title="This workspace is closed until you sign in."
        supporting="Trust Tai OS fails closed: no workspace data is served until an authenticated Trust Tai identity is verified."
        pills={["Identity: not connected", "Access: closed"]}
        action={signIn}
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
            <Link to="/auth" search={{ redirect: "/" }}>Use a different account</Link>
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
            <Link to="/auth" search={{ redirect: "/" }}>Back to sign in</Link>
          </TTButton>
        }
      />
    );
  }

  return <>{children(state.identity)}</>;
}
