import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Roadmap } from "@/domain/roadmap";
import { editableValues } from "@/domain/roadmap-tracker-edit";
import { listMembers } from "@/data/supabase/settings-service";
import { TTButton, TTInput } from "@/components/tt/primitives";
import { TrackerEditor } from "./editor";

export function EditableTrackerTable({
  roadmaps,
  organizationId,
  userId,
  canWork,
  loading,
  readError,
}: {
  roadmaps: Roadmap[];
  organizationId: string;
  userId: string;
  canWork: boolean;
  loading: boolean;
  readError: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const cache = useQueryClient();
  const members = useQuery({
    queryKey: ["roadmap", "tracker-owners", organizationId, userId],
    queryFn: () => listMembers(organizationId),
    retry: false,
    enabled: canWork,
  });
  const owners = (members.data ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({ userId: m.userId, label: m.name === "Unnamed person" ? m.userId : m.name }));
  const visible = roadmaps.filter((r) =>
    `${r.subjectLabel} ${r.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  const active = roadmaps.find((r) => r.id === selected);
  if (loading) return <p role="status">Reading saved tracker records…</p>;
  if (readError)
    return (
      <div role="alert">
        <p>Saved tracker records could not be read.</p>
        <TTButton onClick={() => void cache.invalidateQueries({ queryKey: ["roadmap", "list"] })}>
          Read roadmaps again
        </TTButton>
      </div>
    );
  return (
    <section aria-label="Editable roadmap tracker" className="space-y-4">
      <div>
        <p className="tt-eyebrow text-royal">Roadmap tracker</p>
        <h2 className="font-display text-3xl">Own the next move.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Update the stage, owner, next action and follow-up for an existing roadmap. Each saved
          change keeps its history.
        </p>
      </div>
      {members.isError ? (
        <p role="alert" className="text-sm">
          The owner list could not be read. Current ownership is preserved.{" "}
          <button className="underline" onClick={() => void members.refetch()}>
            Read owners again
          </button>
        </p>
      ) : null}
      <label className="block text-sm max-w-sm">
        Find a saved roadmap
        <TTInput
          className="mt-1 min-h-11"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search saved roadmaps"
        />
      </label>
      {visible.length ? (
        <div className="space-y-3 md:hidden">
          {visible.map((r) => {
            const v = editableValues(r);
            return (
              <article key={r.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h3 className="font-medium">{r.subjectLabel}</h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Pipeline stage</dt>
                    <dd>{v.pipelineStage ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Owner</dt>
                    <dd>
                      {owners.find((o) => o.userId === r.ownerUserId)?.label ??
                        (r.ownerUserId ? "Assigned · see details" : "Unassigned")}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Next action</dt>
                    <dd className="break-words">{v.nextAction ?? "Unknown"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Follow-up</dt>
                    <dd>{v.followUpDate ?? "Not scheduled"}</dd>
                  </div>
                </dl>
                <TTButton
                  variant="secondary"
                  disabled={Boolean(selected && selected !== r.id)}
                  aria-expanded={selected === r.id}
                  onClick={() => setSelected(r.id)}
                >
                  {canWork ? "Edit" : "View"} {r.subjectLabel}
                </TTButton>
              </article>
            );
          })}
        </div>
      ) : null}
      {visible.length ? (
        <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Saved roadmap tracker</caption>
            <thead className="bg-secondary">
              <tr>
                {["Roadmap", "Pipeline stage", "Owner", "Next action", "Follow-up", "Edit"].map(
                  (h) => (
                    <th key={h} className="p-3 font-medium" scope="col">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const v = editableValues(r);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <th scope="row" className="p-3 min-w-36 font-medium">
                      {r.subjectLabel}
                    </th>
                    <td className="p-3">{v.pipelineStage ?? "Unknown"}</td>
                    <td className="p-3">
                      {owners.find((o) => o.userId === r.ownerUserId)?.label ??
                        (r.ownerUserId ? "Assigned · see details" : "Unassigned")}
                    </td>
                    <td className="p-3 min-w-52 max-w-sm">{v.nextAction ?? "Unknown"}</td>
                    <td className="p-3 whitespace-nowrap">{v.followUpDate ?? "Not scheduled"}</td>
                    <td className="p-3">
                      <TTButton
                        variant="secondary"
                        disabled={Boolean(selected && selected !== r.id)}
                        aria-expanded={selected === r.id}
                        onClick={() => setSelected(r.id)}
                      >
                        {canWork ? "Edit" : "View"} {r.subjectLabel}
                      </TTButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm">
          {roadmaps.length
            ? "No saved roadmap matches this search."
            : "No canonical roadmap records are available. Review the workbook identities below before creating or binding a roadmap."}
        </p>
      )}
      {active ? (
        <>
          <TrackerEditor
            key={active.id}
            roadmap={active}
            owners={owners}
            userId={userId}
            canWork={canWork}
            onDirtyChange={setEditorDirty}
            onSaved={(saved) => {
              cache.setQueryData<Roadmap[]>(["roadmap", "list", organizationId, userId], (old) =>
                old?.map((r) => (r.id === saved.id ? saved : r)),
              );
            }}
          />
          <TTButton
            variant="quiet"
            onClick={() => {
              if (
                !editorDirty ||
                window.confirm("Close this editor? Any unsaved draft will be discarded.")
              )
                setSelected(null);
            }}
          >
            Close editor
          </TTButton>
        </>
      ) : null}
    </section>
  );
}
