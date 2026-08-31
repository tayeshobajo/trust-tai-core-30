/**
 * The person behind the conversation.
 *
 * Name, title, company — read from the shared people record, editable in
 * place, and written back to Comms, People and the Scout prospect profile in
 * one move. Nothing here is invented: a blank company stays blank.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TTButton, TTInput } from "@/components/tt/primitives";
import { ensureRelationshipPerson, saveRelationshipPerson } from "@/data/comms-people";
import type { ID } from "@/domain/entities";

export function RelationshipPersonCard({
  organizationId,
  userId,
  relationshipId,
}: {
  organizationId: ID;
  userId: ID;
  relationshipId: ID;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [companyName, setCompanyName] = useState("");

  const query = useQuery({
    queryKey: ["comms", "person", organizationId, relationshipId],
    queryFn: () => ensureRelationshipPerson({ organizationId, userId, relationshipId }),
  });

  const identity = query.data?.identity;

  useEffect(() => {
    if (!identity) return;
    setFullName(identity.fullName);
    setRoleTitle(identity.roleTitle ?? "");
    setCompanyName(identity.companyName ?? "");
  }, [identity]);

  const save = useMutation({
    mutationFn: () =>
      saveRelationshipPerson({
        organizationId,
        userId,
        relationshipId,
        identity: { fullName, roleTitle, companyName },
      }),
    onSuccess: async () => {
      setEditing(false);
      toast.success("Saved to this person's record.");
      await queryClient.invalidateQueries({ queryKey: ["comms", "person", organizationId, relationshipId] });
      await queryClient.invalidateQueries({ queryKey: ["comms", "relationships"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That could not be saved."),
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="tt-eyebrow">Person</p>
        {query.data ? (
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        ) : null}
      </div>

      {query.isLoading ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Opening their record…</p>
      ) : query.isError ? (
        <p className="mt-2 text-[13px] text-destructive">
          {query.error instanceof Error ? query.error.message : "That record could not be read."}
        </p>
      ) : editing ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <TTInput
            className="h-9"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Full name"
            aria-label="Full name"
          />
          <TTInput
            className="h-9"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
            placeholder="Title"
            aria-label="Title"
          />
          <TTInput
            className="h-9"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Company"
            aria-label="Company"
          />
          <div className="sm:col-span-3">
            <TTButton disabled={save.isPending || !fullName.trim()} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </TTButton>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-foreground">{identity?.fullName}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {[identity?.roleTitle, identity?.companyName].filter(Boolean).join(" · ") ||
              "No title or company on record yet."}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {query.data?.prospectId ? "Shared with Scout" : "Shared people record"}
          </p>
        </>
      )}
    </div>
  );
}
