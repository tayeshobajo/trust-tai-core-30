import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { Markdown } from "@/components/tt/markdown";
import {
  EmptyState,
  MetaPill,
  PageHeader,
  SectionHeading,
  TTButton,
  TTInput,
} from "@/components/tt/primitives";
import { ScoutTabs } from "@/components/tt/scout-tabs";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { getCurrentIcp, saveIcp, type IcpProfile } from "@/data/supabase/icp";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "ICP settings · Scout · Trust Tai OS";
const DESCRIPTION =
  "The Ideal Client Profile Scout uses to decide who deserves deeper research.";

const ACCEPTED = [".md", ".txt"];

export const Route = createFileRoute("/modules/scout/settings")({
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
  component: IcpSettingsRoute,
});

function IcpSettingsRoute() {
  return (
    <WorkspaceGate appId="scout">
      {(identity) => (
        <AppShell identity={identity}>
          <IcpSettings identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function formatWhen(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Mode = "preview" | "edit";

function IcpSettings({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("preview");
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [stagedFilename, setStagedFilename] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const icpQuery = useQuery({
    queryKey: ["scout", "icp", identity.organizationId],
    queryFn: () => getCurrentIcp(identity.organizationId),
  });

  const save = useMutation({
    mutationFn: async (current: IcpProfile) =>
      saveIcp({
        current,
        contentMarkdown: draft,
        title: draftTitle.trim() || current.title,
        ...(stagedFilename !== null ? { sourceFilename: stagedFilename } : {}),
        userId: identity.userId,
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["scout", "icp", identity.organizationId], next);
      await queryClient.invalidateQueries({ queryKey: ["scout", "icp", identity.organizationId] });
      setMode("preview");
      setStagedFilename(null);
      setSaved(true);
    },
  });

  const icp = icpQuery.data ?? null;

  function startEdit(source: IcpProfile) {
    setDraft(source.contentMarkdown);
    setDraftTitle(source.title);
    setSaved(false);
    setMode("edit");
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    const name = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setFileError("Only .md and .txt files are supported in this version.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setFileError("That file is empty. Nothing was staged.");
        return;
      }
      setDraft(text);
      setDraftTitle(icp?.title ?? "Ideal Client Profile");
      setStagedFilename(file.name);
      setSaved(false);
      setMode("edit");
    } catch {
      setFileError("That file could not be read. Try saving it as plain text and upload again.");
    }
  }

  return (
    <div className="space-y-10">
      <PageHeader
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Ideal Client Profile"
        supporting="Scout uses this profile to decide who deserves deeper research."
        action={
          <TTButton asChild variant="quiet" size="sm">
            <Link to="/modules/scout" search={{ section: "scout" as const, fit: "all" as const }}>
              <ArrowLeft aria-hidden />
              Back to Scout
            </Link>
          </TTButton>
        }
      />

      <ScoutTabs active="settings" />

      {icpQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the current profile…
        </p>
      ) : icpQuery.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(icpQuery.error as Error).message}
        </p>
      ) : !icp ? (
        <EmptyState
          title="No ICP has been saved yet"
          belongsHere="The organization's Ideal Client Profile lives here as Markdown, versioned each time it changes."
          whyItMatters="Without it, Scout has no shared definition of who deserves deeper research."
          action={
            identity.canManage ? (
              <TTButton onClick={() => fileInput.current?.click()}>
                <Upload aria-hidden />
                Upload ICP
              </TTButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>Version {icp.version}</MetaPill>
            <MetaPill>{icp.sourceFilename ?? "No source file"}</MetaPill>
            <MetaPill>Updated {formatWhen(icp.updatedAt)}</MetaPill>
            {!identity.canManage ? <MetaPill>View only</MetaPill> : null}
          </div>

          {saved ? (
            <p
              role="status"
              className="tt-rise rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground"
            >
              Saved. Scout is now working from version {icp.version}.
            </p>
          ) : null}

          {fileError ? (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          ) : null}

          {mode === "preview" ? (
            <section>
              <SectionHeading
                eyebrow="Current profile"
                title={icp.title}
                action={
                  identity.canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <TTButton
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload aria-hidden />
                        Upload ICP
                      </TTButton>
                      <TTButton size="sm" onClick={() => startEdit(icp)}>
                        Edit
                      </TTButton>
                    </div>
                  ) : undefined
                }
              />
              <div className="tt-surface p-6 sm:p-8">
                <Markdown content={icp.contentMarkdown} />
              </div>
            </section>
          ) : (
            <section>
              <SectionHeading
                eyebrow={stagedFilename ? "Staged from upload" : "Editing"}
                title={stagedFilename ?? "Refine the profile"}
                description={
                  stagedFilename
                    ? "Nothing is saved yet. Review or adjust the text, then choose Save ICP."
                    : "Markdown. Headings, lists, and emphasis all render in the preview."
                }
              />
              <div className="tt-surface space-y-4 p-6">
                <label htmlFor="icp-title" className="block text-sm font-medium text-foreground">
                  Title
                </label>
                <TTInput
                  id="icp-title"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                <label
                  htmlFor="icp-markdown"
                  className="block text-sm font-medium text-foreground"
                >
                  Profile (Markdown)
                </label>
                <textarea
                  id="icp-markdown"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={22}
                  className="w-full rounded-lg border border-input bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                {save.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {(save.error as Error).message}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <TTButton
                    onClick={() => save.mutate(icp)}
                    disabled={save.isPending || !draft.trim()}
                  >
                    {save.isPending ? "Saving…" : "Save ICP"}
                  </TTButton>
                  <TTButton
                    variant="quiet"
                    onClick={() => {
                      setMode("preview");
                      setStagedFilename(null);
                      setFileError(null);
                    }}
                  >
                    Cancel
                  </TTButton>
                  <p className="text-xs text-muted-foreground">
                    Saving creates version {icp.version + 1}.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <p className="tt-eyebrow mb-3">Preview</p>
                <div className="tt-surface p-6 sm:p-8">
                  <Markdown content={draft} />
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        className="sr-only"
        onChange={(event) => void onFile(event)}
      />
    </div>
  );
}
