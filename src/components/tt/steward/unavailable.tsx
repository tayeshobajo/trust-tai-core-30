import { StewardNotProvisionedError } from "@/data/supabase/steward-service";

/**
 * Steward's honest failure state. A missing table is a setup step, not an
 * empty room, and it is never presented as "no data".
 */
export function StewardUnavailable({ error }: { error: unknown }) {
  const provisioning = error instanceof StewardNotProvisionedError;
  const message =
    error instanceof Error ? error.message : "Steward could not reach the workspace.";

  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-8">
      <p className="tt-eyebrow">{provisioning ? "Setup required" : "Could not read"}</p>
      <h3 className="mt-3 font-display text-2xl text-foreground">
        {provisioning ? "Steward is not provisioned in this workspace yet." : "Steward is not able to read right now."}
      </h3>
      <p className="mt-3 max-w-reading text-sm text-muted-foreground">{message}</p>
      {provisioning ? (
        <p className="mt-3 max-w-reading text-sm text-muted-foreground">
          The migration is in the project at <code>docs/steward-v1-schema.sql</code>. It only adds
          Steward's own tables and leaves every shared table untouched.
        </p>
      ) : null}
    </div>
  );
}
