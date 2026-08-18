/**
 * The intelligence layers of a project: Context, Knowledge and Assets.
 *
 * Context is where the thinking lives and where it is being built. Knowledge
 * is what the project has actually decided, with the source kept attached.
 * Assets are the visual truth, and uploading is never approving.
 */

import { useState } from "react";
import { Check, ExternalLink, FileUp, Plus, Trash2, Upload } from "lucide-react";

import { Panel } from "./overview";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import type { ContextHealth } from "@/data/projects/context-packet";
import type { ProjectContextPacket } from "@/data/projects/context-packet";
import type { ProjectSuggestion } from "@/data/projects/suggestions";
import {
  importSummary,
  parseThinkingImport,
  type ImportCandidate,
} from "@/data/projects/thinking-import";

import type { WorkItem } from "@/domain/project-delivery";
import {
  ASSET_STATUS_LABEL,
  ASSET_STATUS_TONE,
  ASSET_TYPE_LABEL,
  CONNECTION_STATUS_LABEL,
  CONNECTION_TYPE_LABEL,
  KNOWLEDGE_REVIEW_LABEL,
  KNOWLEDGE_SECTIONS,
  KNOWLEDGE_SECTION_LABEL,
  SOURCE_SYNC_LABEL,
  THINKING_SOURCE_LABEL,
  type AssetStatus,
  type AssetType,
  type ConnectionInput,
  type ConnectionType,
  type KnowledgeInput,
  type KnowledgeItem,
  type KnowledgeSection,
  type ProjectAsset,
  type ProjectConnection,
  type ThinkingSource,
  type ThinkingSourceInput,
  type ThinkingSourceType,
} from "@/domain/project-intelligence";
import { cn } from "@/lib/utils";

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="tt-surface p-8 text-center">
      <p className="font-display text-xl text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-reading text-[14px] text-muted-foreground">{body}</p>
    </div>
  );
}

const SELECT =
  "h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground";

/**
 * One linked thinking room, with the honest thing it can do next. A private
 * assistant thread cannot be read from its URL, so the only real path forward
 * is a person pasting or uploading the part that matters.
 */
function ThinkingRow({
  source,
  busy,
  onPrimary,
  onRemove,
  onImport,
}: {
  source: ThinkingSource;
  busy: boolean;
  onPrimary: () => void;
  onRemove: () => void;
  onImport?: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportCandidate[]>([]);

  const canImport =
    Boolean(onImport) &&
    (source.syncState === "import_needs_upload" ||
      source.syncState === "import_available" ||
      source.syncState === "imported");

  function read(value: string) {
    setText(value);
    setPreview(parseThinkingImport(value));
  }

  return (
    <li className="border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] text-foreground">{source.title}</span>
        <MetaPill>{THINKING_SOURCE_LABEL[source.sourceType]}</MetaPill>
        <MetaPill>{SOURCE_SYNC_LABEL[source.syncState]}</MetaPill>
        {source.isPrimary ? <MetaPill className="text-royal">Primary</MetaPill> : null}
        {source.lastReviewedAt ? (
          <MetaPill>Reviewed {source.lastReviewedAt.slice(0, 10)}</MetaPill>
        ) : null}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-royal underline-offset-2 hover:underline"
        >
          Open <ExternalLink aria-hidden className="size-3.5" />
        </a>
        {source.isPrimary ? null : (
          <TTButton size="sm" variant="quiet" disabled={busy} onClick={onPrimary}>
            Make primary
          </TTButton>
        )}
        {canImport ? (
          <TTButton size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
            <FileUp aria-hidden className="size-4" />
            {source.syncState === "imported" ? "Import again" : "Import"}
          </TTButton>
        ) : null}
        <TTButton
          size="sm"
          variant="quiet"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${source.title}`}
        >
          <Trash2 aria-hidden className="size-4" />
        </TTButton>
      </div>

      {open && onImport ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-[13px] text-muted-foreground">
            Paste the part of this thread that matters, or upload a Markdown or text export.
            Everything found arrives as Needs review.
          </p>
          <textarea
            rows={5}
            aria-label={`Import from ${source.title}`}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={text}
            placeholder="Decision: we ship the calm version first…"
            onChange={(event) => read(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-royal">
              <FileUp aria-hidden className="size-4" />
              <span>Upload .md or .txt</span>
              <input
                type="file"
                accept=".md,.markdown,.txt,text/plain,text/markdown"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) read(await file.text());
                }}
              />
            </label>
            <TTButton
              size="sm"
              disabled={busy || preview.length === 0}
              onClick={() => {
                onImport(text);
                setText("");
                setPreview([]);
                setOpen(false);
              }}
            >
              Import {preview.length > 0 ? `${preview.length} candidate${preview.length === 1 ? "" : "s"}` : ""}
            </TTButton>
          </div>
          {text.trim().length > 0 ? (
            <p className="text-[13px] text-muted-foreground">{importSummary(preview)}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}


/* ---------------------------------------------------------------- context */

export function ContextTab({
  packet,
  health,
  suggestions,
  thinking,
  connections,
  busy,
  onAddThinking,
  onPrimaryThinking,
  onRemoveThinking,
  onImportThinking,
  onAddConnection,
  onRemoveConnection,
  onDismissSuggestion,
}: {
  packet: ProjectContextPacket;
  health: ContextHealth;
  suggestions: ProjectSuggestion[];
  thinking: ThinkingSource[];
  connections: ProjectConnection[];
  busy: boolean;
  onAddThinking: (input: ThinkingSourceInput) => void;
  onPrimaryThinking: (source: ThinkingSource) => void;
  onRemoveThinking: (source: ThinkingSource) => void;
  onImportThinking?: (source: ThinkingSource, text: string) => void;
  onAddConnection: (input: ConnectionInput) => void;
  onRemoveConnection: (connection: ProjectConnection) => void;
  onDismissSuggestion: (id: string) => void;

}) {
  const [sourceType, setSourceType] = useState<ThinkingSourceType>("chatgpt");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [connectionType, setConnectionType] = useState<ConnectionType>("lovable");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [connectionUrl, setConnectionUrl] = useState("");

  return (
    <div className="space-y-5">
      <Panel title="Context health" tone={health.level === "missing_key_context" ? "risk" : "plain"}>
        <p className="font-display text-xl text-foreground">
          {health.level === "strong"
            ? "Strong"
            : health.level === "needs_review"
              ? "Needs review"
              : "Missing key context"}
        </p>
        <ul className="mt-3 space-y-1.5">
          {health.reasons.map((reason) => (
            <li key={reason} className="text-[14px] text-muted-foreground">
              {reason}
            </li>
          ))}
        </ul>
      </Panel>

      {suggestions.length > 0 ? (
        <Panel title="Worth considering">
          <ul className="space-y-4">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="border-l-2 border-royal/40 pl-4">
                <p className="text-[15px] text-foreground">{suggestion.title}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{suggestion.because}</p>
                <ul className="mt-2 space-y-0.5">
                  {suggestion.evidence.map((line) => (
                    <li key={line} className="font-mono text-[12px] text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
                <TTButton
                  size="sm"
                  variant="quiet"
                  className="mt-2"
                  onClick={() => onDismissSuggestion(suggestion.id)}
                >
                  Dismiss
                </TTButton>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-muted-foreground">
            Each of these is true in the record right now. Nothing here acts on its own.
          </p>
        </Panel>
      ) : null}

      <Panel title="Thinking rooms">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!sourceTitle.trim() || !sourceUrl.trim()) return;
            onAddThinking({
              sourceType,
              title: sourceTitle.trim(),
              url: sourceUrl.trim(),
              isPrimary: thinking.length === 0,
            });
            setSourceTitle("");
            setSourceUrl("");
          }}
        >
          <select
            className={SELECT}
            aria-label="Source type"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as ThinkingSourceType)}
          >
            {Object.entries(THINKING_SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <TTInput
            value={sourceTitle}
            aria-label="Source title"
            placeholder="What this thread is about"
            onChange={(event) => setSourceTitle(event.target.value)}
          />
          <TTInput
            value={sourceUrl}
            aria-label="Source link"
            placeholder="https://"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <TTButton type="submit" size="sm" disabled={busy}>
            <Plus aria-hidden className="size-4" /> Save link
          </TTButton>
        </form>

        {thinking.length === 0 ? (
          <p className="mt-4 text-[14px] text-muted-foreground">
            No thinking room is linked yet. Link the conversation where this project was actually
            worked out.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {thinking.map((source) => (
              <ThinkingRow
                key={source.id}
                source={source}
                busy={busy}
                onPrimary={() => onPrimaryThinking(source)}
                onRemove={() => onRemoveThinking(source)}
                {...(onImportThinking
                  ? { onImport: (text: string) => onImportThinking(source, text) }
                  : {})}
              />
            ))}
          </ul>
        )}

        <p className="mt-4 text-[13px] text-muted-foreground">
          A link is a link. Nothing is read from these threads automatically, so the state shown is
          the honest one.
        </p>
      </Panel>

      <Panel title="Where this is built">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connectionLabel.trim()) return;
            onAddConnection({
              connectionType,
              label: connectionLabel.trim(),
              ...(connectionUrl.trim() ? { url: connectionUrl.trim() } : {}),
            });
            setConnectionLabel("");
            setConnectionUrl("");
          }}
        >
          <select
            className={SELECT}
            aria-label="Connection type"
            value={connectionType}
            onChange={(event) => setConnectionType(event.target.value as ConnectionType)}
          >
            {Object.entries(CONNECTION_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <TTInput
            value={connectionLabel}
            aria-label="Connection label"
            placeholder="Name this workspace"
            onChange={(event) => setConnectionLabel(event.target.value)}
          />
          <TTInput
            value={connectionUrl}
            aria-label="Connection link"
            placeholder="https://"
            onChange={(event) => setConnectionUrl(event.target.value)}
          />
          <TTButton type="submit" size="sm" disabled={busy}>
            <Plus aria-hidden className="size-4" /> Link
          </TTButton>
        </form>

        {connections.length === 0 ? (
          <p className="mt-4 text-[14px] text-muted-foreground">
            Nowhere is recorded as the build environment yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {connections.map((connection) => (
              <li key={connection.id} className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <span className="text-[15px] text-foreground">{connection.label}</span>
                <MetaPill>{CONNECTION_TYPE_LABEL[connection.connectionType]}</MetaPill>
                <MetaPill>{CONNECTION_STATUS_LABEL[connection.status]}</MetaPill>
                {connection.url ? (
                  <a
                    href={connection.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] text-royal underline-offset-2 hover:underline"
                  >
                    Open <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                ) : null}
                <TTButton
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => onRemoveConnection(connection)}
                  aria-label={`Remove ${connection.label}`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </TTButton>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px] text-muted-foreground">
          Linked means the address is on record. Connected is only ever written when something real
          has actually been read.
        </p>
      </Panel>

      <Panel title="Context packet">
        <p className="max-w-reading text-[14px] text-muted-foreground">
          This is what a person or an agent is given when they join this project. It is generated
          from the record, never written by hand, and it carries no transcripts.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <PacketStat label="Confirmed decisions" value={packet.confirmedDecisions.length} />
          <PacketStat label="Constraints" value={packet.constraints.length} />
          <PacketStat label="Open questions" value={packet.openQuestions.length} />
          <PacketStat label="Approved assets" value={packet.approvedAssets.length} />
          <PacketStat label="Active blockers" value={packet.activeBlockers.length} />
          <PacketStat label="Conflicts for a person" value={packet.conflicts.length} />
        </dl>
        {packet.conflicts.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {packet.conflicts.map((conflict) => (
              <li key={`${conflict.about}-${conflict.alsoClaims}`} className="border-l-2 border-destructive/40 pl-4">
                <p className="text-[13px] text-muted-foreground">About {conflict.about}</p>
                <p className="text-[15px] text-foreground">Kept: {conflict.kept}</p>
                <p className="text-[14px] text-muted-foreground">Also claims: {conflict.alsoClaims}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
    </div>
  );
}

function PacketStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="tt-eyebrow">{label}</dt>
      <dd className="mt-1 font-display text-2xl text-foreground">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- knowledge */

export function KnowledgeTab({
  knowledge,
  busy,
  onAdd,
  onConfirm,
  onSupersede,
}: {
  knowledge: KnowledgeItem[];
  busy: boolean;
  onAdd: (input: KnowledgeInput) => void;
  onConfirm: (item: KnowledgeItem) => void;
  onSupersede: (item: KnowledgeItem) => void;
}) {
  const [section, setSection] = useState<KnowledgeSection>("decision");
  const [body, setBody] = useState("");

  // Only confirmed items are canonical. Anything imported or detected waits in
  // the review queue above until a person agrees with it.
  const live = knowledge.filter((item) => item.reviewState !== "superseded");
  const pending = live.filter(
    (item) => item.reviewState === "needs_review" || item.reviewState === "detected",
  );
  const grouped = KNOWLEDGE_SECTIONS.map((value) => ({
    section: value,
    items: live.filter((item) => item.section === value && item.reviewState === "confirmed"),
  })).filter((group) => group.items.length > 0);


  return (
    <div className="space-y-5">
      <Panel title="Record what this project knows">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim()) return;
            onAdd({ section, body: body.trim(), origin: "human", reviewState: "confirmed" });
            setBody("");
          }}
        >
          <select
            className={SELECT}
            aria-label="Knowledge section"
            value={section}
            onChange={(event) => setSection(event.target.value as KnowledgeSection)}
          >
            {KNOWLEDGE_SECTIONS.map((value) => (
              <option key={value} value={value}>
                {KNOWLEDGE_SECTION_LABEL[value]}
              </option>
            ))}
          </select>
          <TTInput
            value={body}
            aria-label="What is true"
            placeholder="Write it in one plain sentence"
            onChange={(event) => setBody(event.target.value)}
          />
          <TTButton type="submit" size="sm" disabled={busy || body.trim().length === 0}>
            <Plus aria-hidden className="size-4" /> Record
          </TTButton>
        </form>
        <p className="mt-3 text-[13px] text-muted-foreground">
          What you write here is confirmed by you. Anything detected from another source arrives as
          Needs review until a person agrees with it.
        </p>
      </Panel>

      {pending.length > 0 ? (
        <Panel title={`Awaiting your review (${pending.length})`} tone="risk">
          <p className="max-w-reading text-[13px] text-muted-foreground">
            Imported from a thinking room, a meeting or an agent. None of it counts as project
            truth, and none of it reaches the context packet, until you confirm it.
          </p>
          <ul className="mt-4 space-y-4">
            {pending.map((item) => (
              <li key={item.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <p className="max-w-reading text-[15px] text-foreground">{item.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <MetaPill>{KNOWLEDGE_SECTION_LABEL[item.section]}</MetaPill>
                  <MetaPill>{KNOWLEDGE_REVIEW_LABEL[item.reviewState]}</MetaPill>
                  <MetaPill>
                    {item.sourceLabel ?? item.origin.replace(/_/g, " ")}
                  </MetaPill>
                  {typeof item.confidence === "number" ? (
                    <MetaPill>Read as {Math.round(item.confidence * 100)}% likely</MetaPill>
                  ) : null}
                  <TTButton size="sm" disabled={busy} onClick={() => onConfirm(item)}>
                    <Check aria-hidden className="size-4" /> Confirm
                  </TTButton>
                  <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => onSupersede(item)}>
                    Discard
                  </TTButton>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}



      {grouped.length === 0 ? (
        <Empty
          title="Nothing is written down yet."
          body="A project that only exists in a chat thread cannot be handed to anyone. Record the decisions, constraints and open questions here."
        />
      ) : (
        grouped.map((group) => (
          <Panel key={group.section} title={KNOWLEDGE_SECTION_LABEL[group.section]}>
            <ul className="space-y-4">
              {group.items.map((item) => (
                <li key={item.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                  <p className="max-w-reading text-[15px] text-foreground">{item.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <MetaPill>{KNOWLEDGE_REVIEW_LABEL[item.reviewState]}</MetaPill>
                    <MetaPill>{item.sourceLabel ?? item.origin.replace(/_/g, " ")}</MetaPill>
                    {item.capturedByLabel ? <MetaPill>{item.capturedByLabel}</MetaPill> : null}
                    {item.reviewState === "confirmed" ? null : (
                      <TTButton size="sm" disabled={busy} onClick={() => onConfirm(item)}>
                        <Check aria-hidden className="size-4" /> Confirm
                      </TTButton>
                    )}
                    <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => onSupersede(item)}>
                      No longer true
                    </TTButton>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- assets */

export function AssetsTab({
  assets,
  items,
  busy,
  onUpload,
  onStatus,
  onOpen,
}: {
  assets: ProjectAsset[];
  items: WorkItem[];
  busy: boolean;
  onUpload: (file: File, assetType: AssetType, workItemId?: string) => void;
  onStatus: (asset: ProjectAsset, status: AssetStatus) => void;
  onOpen: (asset: ProjectAsset, download: boolean) => void;
}) {
  const [assetType, setAssetType] = useState<AssetType>("mockup");
  const [workItemId, setWorkItemId] = useState("");

  return (
    <div className="space-y-5">
      <Panel title="Add an asset">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className={SELECT}
            aria-label="Asset type"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value as AssetType)}
          >
            {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className={SELECT}
            aria-label="Linked work item"
            value={workItemId}
            onChange={(event) => setWorkItemId(event.target.value)}
          >
            <option value="">Not linked to work</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-royal">
            <Upload aria-hidden className="size-4" />
            <span>Choose a file</span>
            <input
              type="file"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file, assetType, workItemId || undefined);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Everything arrives as a draft. Approving is a separate, deliberate act.
        </p>
      </Panel>

      {assets.length === 0 ? (
        <Empty
          title="No assets yet."
          body="Mockups, screenshots and design references belong here so the visual truth is one place, not a thread."
        />
      ) : (
        <Panel title="Assets">
          <ul className="space-y-4">
            {assets.map((asset) => (
              <li key={asset.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] text-foreground">{asset.title}</span>
                  <MetaPill>{ASSET_TYPE_LABEL[asset.assetType]}</MetaPill>
                  <MetaPill>v{asset.version}</MetaPill>
                  <MetaPill className={cn(ASSET_STATUS_TONE[asset.status])}>
                    {ASSET_STATUS_LABEL[asset.status]}
                  </MetaPill>
                  {asset.uploadedByLabel ? <MetaPill>{asset.uploadedByLabel}</MetaPill> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <TTButton size="sm" variant="secondary" onClick={() => onOpen(asset, false)}>
                    Open
                  </TTButton>
                  <TTButton size="sm" variant="quiet" onClick={() => onOpen(asset, true)}>
                    Download
                  </TTButton>
                  {asset.status === "approved" ? (
                    <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => onStatus(asset, "superseded")}>
                      Supersede
                    </TTButton>
                  ) : (
                    <TTButton size="sm" disabled={busy} onClick={() => onStatus(asset, "approved")}>
                      <Check aria-hidden className="size-4" /> Approve
                    </TTButton>
                  )}
                  {asset.status === "reference" ? null : (
                    <TTButton size="sm" variant="quiet" disabled={busy} onClick={() => onStatus(asset, "reference")}>
                      Mark reference
                    </TTButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
