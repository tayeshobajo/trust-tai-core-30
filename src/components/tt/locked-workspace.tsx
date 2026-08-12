import { PageHeader, TTButton, MetaPill } from "@/components/tt/primitives";

export function LockedWorkspace({ reason }: { reason: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-reading flex-col justify-center px-6 py-16">
      <PageHeader
        eyebrow="Trust Tai OS"
        title="This workspace is not open yet."
        supporting={`${reason} Trust Tai OS fails closed: no workspace data is served until an authenticated Trust Tai identity is verified.`}
      />
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <MetaPill>Identity: not connected</MetaPill>
        <MetaPill>Access: closed</MetaPill>
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Next move: connect the shared Trust Tai backend and identity provider, then sign in with a
        Trust Tai account.
      </p>
      <div className="mt-6">
        <TTButton disabled>Sign in with Trust Tai</TTButton>
      </div>
    </div>
  );
}
