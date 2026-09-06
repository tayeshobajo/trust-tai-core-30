import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/tt/brand-logo";
import { PageHeader, MetaPill, TTButton } from "@/components/tt/primitives";
import { claimInvitation } from "@/lib/invite-claim";
import { canSeeApp, useWorkspace, type WorkspaceIdentity } from "@/lib/workspace";

/**
 * A verified identity with no membership may still be holding an invitation
 * that was never consumed, because the sign-in link that brought them here
 * carried no invitation context. Rather than telling that person their access
 * is not provisioned, try the claim once, driven by their own address. It
 * grants nothing on its own: the endpoint re-verifies the session and decides.
 */
function useInvitationClaim(email: string) {
  const [state, setState] = useState<{ phase: "checking" | "none"; because?: string }>({
    phase: "checking",
  });
  const tried = useRef("");

  useEffect(() => {
    if (tried.current === email) return;
    tried.current = email;
    let active = true;
    void claimInvitation().then((result) => {
      if (!active) return;
      if (result.ok) {
        /* Membership now exists, so the boundary must read it again. */
        window.location.reload();
        return;
      }
      setState({ phase: "none", because: result.because });
    });
    return () => {
      active = false;
    };
  }, [email]);

  return state;
}

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
  appId,
}: {
  children: (identity: WorkspaceIdentity) => ReactNode;
  preview?: RoomPreview;
  /**
   * The room this surface belongs to. When given, the gate closes the room for
   * anyone whose resolved access does not include it, so hiding a room from
   * the navigation and closing the door are the same act.
   */
  appId?: string;
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
        <Link to="/auth" search={{ redirect: preview?.returnTo ?? "/" }}>
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
                        ·
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
    return <NoMembershipBoundary email={state.email} />;
  }

  if (state.status === "error") {
    return (
      <Boundary
        title="We could not verify your access."
        supporting={state.message}
        pills={["Access: closed"]}
        action={
          <TTButton asChild variant="secondary">
            <Link to="/auth" search={{ redirect: "/" }}>
              Back to sign in
            </Link>
          </TTButton>
        }
      />
    );
  }

  if (appId && !canSeeApp(state.identity, appId)) {
    return (
      <Boundary
        title={`${preview?.room ?? "This room"} is not open to you.`}
        supporting="Your access to this workspace does not include this room. Nothing here is loaded, and no record is read."
        pills={["Identity: verified", "Room access: closed"]}
        note="An owner or admin can change this in Settings, People and access."
        action={
          <TTButton asChild variant="secondary">
            <Link to="/">Back to your workspace</Link>
          </TTButton>
        }
      />
    );
  }

  return <>{children(state.identity)}</>;
}

function NoMembershipBoundary({ email }: { email: string }) {
  const claim = useInvitationClaim(email);

  if (claim.phase === "checking") {
    return (
      <Boundary
        title="Checking your invitation."
        supporting={`You are signed in as ${email}. We are looking for an invitation issued to this address.`}
        pills={["Identity: verified", "Membership: checking"]}
      />
    );
  }

  return (
    <Boundary
      title="Access not provisioned."
      supporting={
        claim.because ??
        `You are signed in as ${email}, but this account is not a member of a Trust Tai organization yet.`
      }
      pills={["Identity: verified", "Membership: none"]}
      note="Membership is granted by a Trust Tai owner. Nothing is created automatically, and there is no demo access."
      action={
        <TTButton asChild variant="secondary">
          <Link to="/auth" search={{ redirect: "/" }}>
            Use a different account
          </Link>
        </TTButton>
      }
    />
  );
}
